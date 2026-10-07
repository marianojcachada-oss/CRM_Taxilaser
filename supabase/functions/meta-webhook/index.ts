// supabase/functions/meta-webhook/index.ts
//
// Recibe los webhooks de Meta (WhatsApp Business Platform, Messenger e
// Instagram comparten el mismo endpoint) y crea/actualiza contacto,
// conversación y mensaje. El trigger de round robin en la base se encarga
// de asignar el operador automáticamente al insertar la conversación.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting, getSettings } from "../_shared/settings.ts";
import { lookupPassengerName } from "../_shared/taxicaller.ts";
import { handleMissedCallAutoReply } from "../_shared/missedCallAutoReply.ts";
import { handleOptOutKeyword } from "../_shared/optOut.ts";
import { maybeSendOutOfHoursNotice } from "../_shared/businessHours.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role: bypassea RLS
);

const GRAPH_VERSION = "v26.0";

// Messenger e Instagram mandan solo un ID numérico, no el nombre. Para
// pedírselo a la Graph API hace falta el token de la PÁGINA (el del System
// User no alcanza para leer perfiles). Se obtiene con el token del System
// User y se guarda un rato en memoria para no pedirlo en cada mensaje.
let cachedPageToken: { token: string; at: number } | null = null;

// ID de la Página de Taxi Laser LLC — segundo intento si /me/accounts viene
// vacío (pasa con algunos tokens de System User aunque la Página esté asignada).
const DEFAULT_PAGE_ID = "104521984578127";

async function getPageAccessToken(systemToken: string): Promise<string | null> {
  if (cachedPageToken && Date.now() - cachedPageToken.at < 30 * 60 * 1000) {
    return cachedPageToken.token;
  }
  try {
    const headers = { Authorization: `Bearer ${systemToken}` };
    const attempts: unknown[] = [];

    const r1 = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token&limit=25`,
      { headers },
    );
    const d1 = await r1.json().catch(() => ({}));
    attempts.push({ me_accounts: d1 });
    let token: string | undefined = d1?.data?.[0]?.access_token;

    if (!token) {
      const r2 = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${DEFAULT_PAGE_ID}?fields=id,name,access_token`,
        { headers },
      );
      const d2 = await r2.json().catch(() => ({}));
      attempts.push({ page_by_id: d2 });
      token = d2?.access_token;
    }

    if (!token) {
      console.warn("No se pudo obtener el token de la Página:", JSON.stringify(attempts));
      return null;
    }
    cachedPageToken = { token, at: Date.now() };
    return token;
  } catch (e) {
    console.warn("Error pidiendo el token de la Página:", e);
    return null;
  }
}

// Nombre del perfil de un contacto de Facebook/Instagram. Si falla por lo
// que sea (permiso, token, la persona no tiene nombre público) devuelve
// null y el contacto queda "Sin nombre" como hasta ahora — nunca debe
// romper la recepción del mensaje.
async function fetchSocialProfileName(
  channel: "facebook" | "instagram",
  id: string,
  systemToken: string | undefined,
): Promise<string | null> {
  if (!systemToken) return null;
  try {
    const pageToken = await getPageAccessToken(systemToken);
    if (!pageToken) return null;
    const fields = channel === "instagram" ? "name,username" : "name";
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${id}?fields=${fields}`,
      { headers: { Authorization: `Bearer ${pageToken}` } },
    );
    if (!res.ok) {
      console.warn(`No se pudo traer el nombre de ${channel} ${id}:`, await res.text());
      return null;
    }
    const d = await res.json();
    return d?.name || d?.username || null;
  } catch (e) {
    console.warn("Error trayendo el nombre del perfil:", e);
    return null;
  }
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparación en tiempo constante — comparar firmas con === deja una
// mínima ventana para un timing attack, esto lo evita.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// WhatsApp no manda el archivo en sí en el aviso — manda un ID. Hay que
// pedirle a Meta la URL real (paso 1), y bajar el archivo desde ahí con
// el mismo token (paso 2). Después lo subimos a nuestro propio Storage,
// para no depender de que ese link temporal de Meta siga vivo.
async function downloadMetaMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    if (!meta.url) return null;

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) return null;

    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
  } catch (err) {
    console.error("No se pudo bajar el adjunto de WhatsApp:", err);
    return null;
  }
}

async function uploadWhatsappAttachment(
  phone: string,
  mediaId: string,
  accessToken: string,
  extensionHint: string,
): Promise<{ url: string; mimeType: string } | null> {
  const media = await downloadMetaMedia(mediaId, accessToken);
  if (!media) return null;

  const path = `whatsapp/${phone}/${crypto.randomUUID()}.${extensionHint}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, media.bytes, { contentType: media.mimeType });
  if (error) {
    console.error("No se pudo subir el adjunto de WhatsApp al Storage:", error.message);
    return null;
  }

  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, mimeType: media.mimeType };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // -----------------------------------------------------
  // Verificación del webhook (Meta hace un GET la primera vez)
  // -----------------------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = await getSetting("META_VERIFY_TOKEN", "META_VERIFY_TOKEN");

    if (mode === "subscribe" && token === verifyToken) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // -----------------------------------------------------
  // Las tres claves que puede llegar a necesitar este webhook se piden
  // juntas, en una sola consulta — antes eran 2 o 3 consultas separadas
  // (una por getSetting()) en CADA mensaje/estado que manda Meta, que es
  // justamente el webhook con más volumen de todos. META_ACCESS_TOKEN
  // casi nunca hace falta (solo para bajar adjuntos), pero pedirla acá
  // no cuesta una consulta extra — ya viene en el mismo viaje.
  // -----------------------------------------------------
  const metaSettings = await getSettings(["META_INTAKE_ENABLED", "META_APP_SECRET", "META_ACCESS_TOKEN"]);

  // -----------------------------------------------------
  // Freno propio: si está desactivado desde Integrations, no se procesa
  // nada — sin importar el estado real de la suscripción en Meta.
  // -----------------------------------------------------
  if (metaSettings.META_INTAKE_ENABLED === "false") {
    return new Response("OK (integración desactivada)", { status: 200 });
  }

  // -----------------------------------------------------
  // Evento entrante — se verifica que la firma coincida antes de
  // procesar nada, para confirmar que el POST viene de verdad de Meta y
  // no de cualquiera que haya encontrado esta URL.
  // -----------------------------------------------------
  const rawBody = await req.text();
  const appSecret = metaSettings.META_APP_SECRET;

  if (appSecret) {
    const signatureHeader = req.headers.get("X-Hub-Signature-256") ?? "";
    const expectedSignature = "sha256=" + await hmacSha256Hex(appSecret, rawBody);
    if (!timingSafeEqual(signatureHeader, expectedSignature)) {
      console.error("Firma de Meta inválida — se descarta el evento.");
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    console.warn(
      "META_APP_SECRET no está cargado en Integrations — el webhook acepta cualquier POST sin verificar de dónde viene. Cargalo para cerrar este agujero.",
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("OK (body no era JSON)", { status: 200 });
  }

  // Rastro para poder buscar en los logs (WhatsApp tiene mucho volumen y
  // tapa todo): solo se loguea lo que NO es de WhatsApp, y sin guardar el
  // texto de los mensajes — solo la "forma" del evento.
  if (payload.object !== "whatsapp_business_account") {
    const e0 = payload.entry?.[0] ?? {};
    const m0 = e0.messaging?.[0] ?? e0.changes?.[0]?.value ?? {};
    console.log(
      `[meta-webhook] evento object=${payload.object} entries=${(payload.entry ?? []).length} ` +
        `entry_keys=${Object.keys(e0).join(",")} messaging=${(e0.messaging ?? []).length} ` +
        `changes=${(e0.changes ?? []).length} change_field=${e0.changes?.[0]?.field ?? "-"} ` +
        `has_text=${Boolean(m0.message?.text)} is_echo=${Boolean(m0.message?.is_echo)} ` +
        `mid=${m0.message?.mid ?? "-"}`,
    );
  }

  for (const entry of payload.entry ?? []) {
    // --- WhatsApp Business Platform ---
    if (payload.object === "whatsapp_business_account") {
      for (const change of entry.changes ?? []) {
        const value = change.value;

        for (const msg of value?.messages ?? []) {
          const phone = msg.from; // ej: '5491100000000'
          if (!phone || typeof phone !== "string") {
            // Evento sin remitente (p. ej. payload de prueba): se ignora para no
            // devolver 500 y evitar que Meta lo reintente en bucle.
            console.warn(`[meta-webhook] mensaje de WhatsApp sin 'from' (type=${msg?.type}), se ignora`);
            continue;
          }
          // Reacciones (emoji sobre un mensaje) y mensajes "borrados": no son
          // mensajes del cliente. Si se guardaran, reabrirían la conversación,
          // la marcarían como no leída y la reasignarían sin motivo, además de
          // mostrar el cartel de "revisar en WhatsApp". Se ignoran.
          if (msg.type === "reaction") {
            console.log(`[meta-webhook] reacción de WhatsApp ignorada (${msg.reaction?.emoji ?? "sin emoji"})`);
            continue;
          }

          const contactName = value.contacts?.[0]?.profile?.name ?? null;

          let text = "";
          let attachment: { url: string; name: string; kind: "image" | "audio" | "file" } | null = null;

          if (msg.type === "text") {
            text = msg.text?.body ?? "";
          } else if (msg.type === "location") {
            // Muy relevante para una empresa de taxis — el cliente puede
            // mandar su ubicación exacta en vez de escribir la dirección.
            const lat = msg.location?.latitude;
            const lng = msg.location?.longitude;
            const label = msg.location?.name || msg.location?.address || "";
            text =
              lat && lng
                ? `📍 Ubicación compartida${label ? ` (${label})` : ""}: https://maps.google.com/?q=${lat},${lng}`
                : "📍 Ubicación compartida (sin coordenadas)";
          } else if (msg.type === "image" || msg.type === "audio" || msg.type === "video" || msg.type === "document" || msg.type === "sticker") {
            const metaToken = metaSettings.META_ACCESS_TOKEN;
            const mediaObj = msg[msg.type];
            const mediaId = mediaObj?.id;

            if (metaToken && mediaId) {
              const kind = msg.type === "image" || msg.type === "sticker" ? "image" : msg.type === "audio" ? "audio" : "file";
              const ext = msg.type === "image" ? "jpg" : msg.type === "audio" ? "ogg" : msg.type === "video" ? "mp4" : "bin";
              const uploaded = await uploadWhatsappAttachment(phone, mediaId, metaToken, ext);

              if (uploaded) {
                attachment = {
                  url: uploaded.url,
                  name: mediaObj?.filename ?? `${msg.type}.${ext}`,
                  kind,
                };
                text = msg[msg.type]?.caption ?? "";
              } else {
                text = `[No se pudo descargar el ${msg.type} — revisar en WhatsApp directamente]`;
              }
            } else {
              text = `[Mensaje de tipo "${msg.type}" — falta META_ACCESS_TOKEN en Integrations para poder bajarlo]`;
            }
          } else if (msg.type === "contacts") {
            // El cliente comparte una tarjeta de contacto de WhatsApp (un
            // nombre + uno o más teléfonos). Se arma un texto legible en
            // vez del cartel genérico — no se descarga nada, es
            // información que ya viene completa en el propio webhook.
            const cards = msg.contacts ?? [];
            if (cards.length > 0) {
              const lines = cards.map((card: any) => {
                const name = card?.name?.formatted_name || "Contacto sin nombre";
                const phones = (card?.phones ?? [])
                  .map((p: any) => p?.phone)
                  .filter(Boolean)
                  .join(", ");
                return `👤 ${name}${phones ? ` — ${phones}` : ""}`;
              });
              text = `Contacto compartido:\n${lines.join("\n")}`;
            } else {
              text = "[Contacto de WhatsApp compartido — revisar en WhatsApp directamente]";
            }
          } else if (msg.type === "system") {
            // No es un mensaje del cliente — es un aviso que manda la propia
            // API de WhatsApp (cambió de número, cambió el código de
            // seguridad, etc.). Se intenta dar un texto legible según el
            // subtipo; si viene uno que no está contemplado, se cae al body
            // que manda Meta (en inglés, pero al menos dice algo concreto)
            // en vez del cartel genérico de "revisar en WhatsApp".
            const systemType = msg.system?.type;
            if (systemType === "user_changed_number" || systemType === "customer_changed_number") {
              const newNumber = msg.system?.wa_id ? ` (nuevo número: +${msg.system.wa_id})` : "";
              text = `⚙️ Aviso de WhatsApp: el cliente cambió el número asociado a esta cuenta${newNumber}.`;
            } else if (systemType === "customer_identity_changed" || systemType === "user_identity_changed") {
              text =
                "⚙️ Aviso de WhatsApp: cambió el código de seguridad del cliente (reinstaló WhatsApp o cambió de teléfono).";
            } else if (msg.system?.body) {
              text = `⚙️ Aviso de WhatsApp: ${msg.system.body}`;
            } else {
              text = "⚙️ Aviso automático de WhatsApp — revisar en WhatsApp directamente.";
            }
          } else if (msg.type) {
            text = `[Mensaje de tipo "${msg.type}" — revisar en WhatsApp directamente]`;
          }

          await handleIncomingMessage({
            channel: "whatsapp",
            externalContactId: phone,
            contactName,
            externalMessageId: msg.id,
            text,
            attachment,
          });
        }

        // Llamadas de WhatsApp (Calling API de Meta) — el sistema no
        // atiende, solo deja una notificación cuando una queda sin
        // responder. Ojo: los nombres exactos de campo pueden variar,
        // esto está armado sobre la estructura típica documentada por
        // Meta y conviene confirmarlo contra un evento real apenas se
        // pueda probar.
        for (const call of value?.calls ?? []) {
          const isMissed =
            call.event === "terminate" &&
            (call.status === "missed" || call.status === "MISSED" || !call.duration);

          if (isMissed) {
            await handleMissedCall(call.from);
          }
        }

        // Estados de entrega de WhatsApp ("enviado" / "entregado" /
        // "leído" / "falló") — esto es lo que permite mostrar los
        // check(s) de WhatsApp en los mensajes que mandamos nosotros.
        for (const status of value?.statuses ?? []) {
          await handleStatusUpdate(status);
        }
      }
    }

    // --- Messenger (Facebook) e Instagram comparten esta forma ---
    if (payload.object === "page" || payload.object === "instagram") {
      const channel = payload.object === "page" ? "facebook" : "instagram";

      // Meta manda los mensajes en "messaging" (formato clásico) o dentro de
      // "changes" con field="messages" (formato que usa su muestra de
      // prueba). Se aceptan los dos para no perder ninguno.
      const events = [
        ...(entry.messaging ?? []),
        ...(entry.changes ?? []).filter((c: any) => c?.field === "messages").map((c: any) => c.value),
      ];

      for (const messaging of events) {
        const senderId = messaging?.sender?.id;
        const text = messaging?.message?.text ?? "";
        const mid = messaging?.message?.mid;

        if (!senderId || !text) continue;
        // Mensajes que mandó la propia página (eco) y la muestra de prueba
        // del panel de Meta ("test_message_id") no son de un cliente.
        if (messaging?.message?.is_echo || mid === "test_message_id") continue;

        // Solo se le pregunta el nombre a Meta si todavía no lo tenemos.
        let profileName: string | null = null;
        const { data: known } = await supabase
          .from("contact_channels")
          .select("contact_id, contacts(full_name)")
          .eq("channel", channel)
          .eq("external_id", senderId)
          .maybeSingle();
        const knownName = (known as any)?.contacts?.full_name;
        if (!knownName) {
          profileName = await fetchSocialProfileName(channel, senderId, metaSettings.META_ACCESS_TOKEN);
          // Contacto que ya existía como "Sin nombre": se completa ahora.
          if (profileName && known?.contact_id) {
            await supabase.from("contacts").update({ full_name: profileName }).eq("id", known.contact_id);
          }
        }

        await handleIncomingMessage({
          channel,
          externalContactId: senderId,
          contactName: profileName,
          externalMessageId: mid,
          text,
          attachment: null,
        });
      }
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});

async function handleIncomingMessage(opts: {
  channel: "whatsapp" | "facebook" | "instagram";
  externalContactId: string;
  contactName: string | null;
  externalMessageId: string | undefined;
  text: string;
  attachment: { url: string; name: string; kind: "image" | "audio" | "file" } | null;
}) {
  const { channel, externalContactId, contactName, externalMessageId, text, attachment } = opts;

  // 1. Buscar si ya existe el mapeo de canal -> contacto
  const { data: existingChannel } = await supabase
    .from("contact_channels")
    .select("contact_id")
    .eq("channel", channel)
    .eq("external_id", externalContactId)
    .maybeSingle();

  let contactId = existingChannel?.contact_id;

  // Si es un canal con teléfono real (WhatsApp), miramos si ese número ya
  // es pasajero conocido en TaxiCaller — si TaxiCaller tiene nombre
  // cargado, se prioriza por sobre el nombre de perfil que manda el canal
  // (que puede ser un apodo, o directo no venir).
  let resolvedName = contactName;
  if (channel === "whatsapp") {
    const taxicallerName = await lookupPassengerName(externalContactId);
    if (taxicallerName) resolvedName = taxicallerName;
  }

  // 2. Si no hay mapeo de canal todavía, antes de crear un contacto nuevo
  // hay que ver si ya existe uno con este mismo teléfono (por ejemplo,
  // alguien que ya escribió por SMS y ahora escribe por WhatsApp por
  // primera vez) — si no se busca esto, cada canal nuevo de un cliente ya
  // conocido termina creando un contacto duplicado con su propia
  // conversación separada, en vez de sumarse al que ya existe.
  const normalizedPhoneForLookup =
    channel === "whatsapp" || channel === "sms" ? normalizePhone(externalContactId) : null;

  if (!contactId && normalizedPhoneForLookup) {
    const { data: existingByPhone } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", normalizedPhoneForLookup)
      .maybeSingle();
    if (existingByPhone) contactId = existingByPhone.id;
  }

  // 3. Si sigue sin existir, recién ahí se crea el contacto + su contact_channel
  let isNewContact = false;
  if (!contactId) {
    isNewContact = true;
    const { data: newContact, error: contactErr } = await supabase
      .from("contacts")
      .insert({
        full_name: resolvedName,
        // Se normaliza para que quede en el mismo formato (+1XXXXXXXXXX) que
        // usan los webhooks de TaxiCaller al buscar el contacto por teléfono
        // (ver taxicaller-assigned-webhook y los demás) — si no, un contacto
        // creado por WhatsApp nunca matchea esa búsqueda y el "en camino" (o
        // cualquier otro estado) termina creando un contacto duplicado en
        // vez de actualizar el que ya tiene la conversación activa.
        phone: normalizedPhoneForLookup,
      })
      .select("id")
      .single();

    if (contactErr) throw contactErr;
    contactId = newContact.id;

    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel,
      external_id: externalContactId,
    });
  } else if (!existingChannel) {
    // Se encontró el contacto por teléfono pero todavía no tenía este
    // canal mapeado (primer WhatsApp de un cliente que ya conocíamos por
    // SMS, típicamente) — se suma el mapeo al contacto existente en vez
    // de dejarlo suelto.
    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel,
      external_id: externalContactId,
    });
  }

  if (!isNewContact && resolvedName && resolvedName !== contactName) {
    // Contacto ya existente: si TaxiCaller nos devolvió un nombre, lo
    // pisamos aunque ya hubiera uno cargado — es la fuente de verdad.
    await supabase.from("contacts").update({ full_name: resolvedName }).eq("id", contactId);
  }

  // 3. Buscar/crear la conversación. Para WhatsApp usamos la función
  // atómica (a prueba de dos llamadas simultáneas) porque comparte
  // conversación con SMS — el mismo problema de carrera que tenía SMS.
  // Facebook e Instagram siguen con su propia lógica, sin mezclarse.
  let conversationId: string;

  if (channel === "whatsapp") {
    const { data: convId, error: convError } = await supabase.rpc(
      "find_or_create_sms_whatsapp_conversation",
      { p_contact_id: contactId, p_default_channel: "whatsapp" },
    );
    if (convError) throw convError;
    conversationId = convId;

    // Chequeo de STOP/BAJA/START, y de horario de atención — solo
    // aplica a SMS/WhatsApp (los canales que reciben avisos automáticos
    // de TaxiCaller); Facebook/Instagram quedan afuera de este chequeo.
    if (text) {
      await handleOptOutKeyword(contactId, externalContactId, text, "whatsapp");
    }
    await maybeSendOutOfHoursNotice(contactId, externalContactId, "whatsapp");
  } else {
    const { data: convId, error: convError } = await supabase.rpc(
      "find_or_create_channel_conversation",
      { p_contact_id: contactId, p_channel: channel },
    );
    if (convError) throw convError;
    conversationId = convId;

    // Solo se escribe si el dato cambió (o todavía no estaba): antes se
    // hacía un UPDATE en CADA mensaje de Facebook/Instagram aunque el valor
    // fuera el mismo, y cada UPDATE (aunque no cambie nada) genera un evento
    // de Realtime para todos los operadores conectados.
    await supabase
      .from("conversations")
      .update({ external_thread_id: externalContactId })
      .eq("id", conversationId)
      .or(`external_thread_id.is.null,external_thread_id.neq.${externalContactId}`);
  }

  // 4. Insertar el mensaje — sent_via_channel guarda el canal REAL de
  // este mensaje puntual, que puede no coincidir con conversations.channel
  // una vez que sms/whatsapp comparten conversación.
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "contact",
    content: text || null,
    external_message_id: externalMessageId,
    attachment_url: attachment?.url ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_kind: attachment?.kind ?? null,
    sent_via_channel: channel,
  });

  // (Antes había un paso 5 que volvía a actualizar last_message_at acá.
  // Sobraba: el trigger trg_update_conversation_preview ya lo pone al
  // insertar el mensaje (last_message_at = new.created_at). Y si el insert
  // fallaba — por ejemplo un mensaje duplicado que Meta reenvía — igual
  // se actualizaba. Sacarlo evita un UPDATE y un evento de Realtime por
  // cada mensaje entrante.)
}

// Orden de "avance" de un estado de WhatsApp — sirve para no pisar un
// estado más avanzado con uno viejo si los eventos llegan fuera de orden
// (Meta no garantiza el orden de entrega de los webhooks).
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

async function handleStatusUpdate(status: { id?: string; status?: string; timestamp?: string }) {
  const wamid = status.id;
  const newStatus = status.status; // 'sent' | 'delivered' | 'read' | 'failed'
  if (!wamid || !newStatus) return;

  const { data: existing } = await supabase
    .from("messages")
    .select("id, delivery_status")
    .eq("wamid", wamid)
    .maybeSingle();

  if (!existing) return; // puede llegar el status antes de que terminemos de guardar el insert, no pasa nada

  const currentRank = STATUS_RANK[existing.delivery_status ?? ""] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  // 'failed' se guarda siempre (hay que poder verlo aunque ya figurara
  // como 'sent'), el resto solo avanza, nunca retrocede.
  if (newStatus !== "failed" && newRank <= currentRank) return;

  const patch: Record<string, unknown> = { delivery_status: newStatus };
  const eventTime = status.timestamp
    ? new Date(Number(status.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  if (newStatus === "delivered") patch.delivered_at = eventTime;
  if (newStatus === "read") patch.read_at = eventTime;

  await supabase.from("messages").update(patch).eq("id", existing.id);
}

async function handleMissedCall(phone: string | undefined) {
  if (!phone) return;

  const { data: contact } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();

  await supabase.from("missed_calls").insert({
    phone,
    contact_id: contact?.id ?? null,
    channel: "whatsapp",
  });

  await handleMissedCallAutoReply(phone, "whatsapp");
}