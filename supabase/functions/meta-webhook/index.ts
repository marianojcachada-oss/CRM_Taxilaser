// supabase/functions/meta-webhook/index.ts
//
// Recibe los webhooks de Meta (WhatsApp Business Platform, Messenger e
// Instagram comparten el mismo endpoint) y crea/actualiza contacto,
// conversación y mensaje. El trigger de round robin en la base se encarga
// de asignar el operador automáticamente al insertar la conversación.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { lookupPassengerName } from "../_shared/taxicaller.ts";
import { handleMissedCallAutoReply } from "../_shared/missedCallAutoReply.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role: bypassea RLS
);

const GRAPH_VERSION = "v26.0";

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
  // Freno propio: si está desactivado desde Integrations, no se procesa
  // nada — sin importar el estado real de la suscripción en Meta.
  // -----------------------------------------------------
  const intakeEnabled = await getSetting("META_INTAKE_ENABLED");
  if (intakeEnabled === "false") {
    return new Response("OK (integración desactivada)", { status: 200 });
  }

  // -----------------------------------------------------
  // Evento entrante — se verifica que la firma coincida antes de
  // procesar nada, para confirmar que el POST viene de verdad de Meta y
  // no de cualquiera que haya encontrado esta URL.
  // -----------------------------------------------------
  const rawBody = await req.text();
  const appSecret = await getSetting("META_APP_SECRET");

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

  for (const entry of payload.entry ?? []) {
    // --- WhatsApp Business Platform ---
    if (payload.object === "whatsapp_business_account") {
      for (const change of entry.changes ?? []) {
        const value = change.value;

        for (const msg of value?.messages ?? []) {
          const phone = msg.from; // ej: '5491100000000'
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
            const metaToken = await getSetting("META_ACCESS_TOKEN");
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
      }
    }

    // --- Messenger (Facebook) e Instagram comparten esta forma ---
    if (payload.object === "page" || payload.object === "instagram") {
      const channel = payload.object === "page" ? "facebook" : "instagram";

      for (const messaging of entry.messaging ?? []) {
        const senderId = messaging.sender?.id;
        const text = messaging.message?.text ?? "";
        const mid = messaging.message?.mid;

        if (!senderId || !text) continue;

        await handleIncomingMessage({
          channel,
          externalContactId: senderId,
          contactName: null, // se puede pedir a la Graph API con senderId si hace falta
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

  // 2. Si no existe, crear contacto + su contact_channel
  if (!contactId) {
    const { data: newContact, error: contactErr } = await supabase
      .from("contacts")
      .insert({
        full_name: resolvedName,
        phone: channel === "whatsapp" || channel === "sms" ? externalContactId : null,
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
  } else if (resolvedName && resolvedName !== contactName) {
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
  } else {
    const { data: convId, error: convError } = await supabase.rpc(
      "find_or_create_channel_conversation",
      { p_contact_id: contactId, p_channel: channel },
    );
    if (convError) throw convError;
    conversationId = convId;

    await supabase
      .from("conversations")
      .update({ external_thread_id: externalContactId })
      .eq("id", conversationId);
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

  // 5. Actualizar last_message_at de la conversación
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
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