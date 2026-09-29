// supabase/functions/ringcentral-webhook/index.ts
//
// Recibe SMS entrantes de RingCentral. A diferencia de lo que asumíamos
// al principio, RingCentral manda el mensaje completo directo dentro de
// "body" (from, subject con el texto, direction, etc.) — no hace falta
// una segunda consulta a la API para traer el contenido.
//
// También recibe eventos de "telephony/sessions" para detectar llamadas
// perdidas (suscripto aparte en setup-ringcentral-subscription, con el
// filtro ?missedCall=true a nivel de cuenta). La forma exacta del body
// para este evento no está 100% fija en la documentación pública de
// RingCentral — revisar los Logs de esta función después de la primera
// llamada perdida real para confirmar que el teléfono se está leyendo
// del campo correcto, y ajustar si hace falta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { lookupPassengerName } from "../_shared/taxicaller.ts";
import { handleMissedCallAutoReply } from "../_shared/missedCallAutoReply.ts";
import { handleOptOutKeyword } from "../_shared/optOut.ts";
import { maybeSendOutOfHoursNotice } from "../_shared/businessHours.ts";
import { getRingCentralAccessToken } from "../_shared/ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const validationToken = req.headers.get("Validation-Token");
  if (validationToken) {
    return new Response(null, {
      status: 200,
      headers: { "Validation-Token": validationToken },
    });
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return new Response("OK", { status: 200 });
  }

  // Freno propio: si está desactivado desde Integrations, no se procesa
  // nada — ni SMS ni llamadas perdidas — sin importar si RingCentral
  // todavía nos está mandando eventos por su lado.
  const intakeEnabled = await getSetting("RINGCENTRAL_INTAKE_ENABLED");
  if (intakeEnabled === "false") {
    return new Response("OK (integración desactivada)", { status: 200 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("OK", { status: 200 });
  }

  const body = payload.body;
  console.log(`ringcentral-webhook: evento recibido, event=${payload.event ?? "?"}, type=${body?.type ?? "?"}`);

  if (body?.direction === "Inbound" && body?.type === "SMS") {
    const phone = body.from?.phoneNumber;
    const text = body.subject ?? "";
    // RingCentral manda el nombre de como está agendado el contacto en
    // su libreta (caller ID / contactos del teléfono), cuando lo tiene.
    const contactName = body.from?.name?.trim() || null;

    // MMS: RingCentral manda el/los adjuntos reales en "attachments" — el
    // item de tipo "Text" es el texto (ya viene en subject, se ignora acá
    // para no duplicarlo), cualquier otro tipo (Picture, Video,
    // AudioRecording, etc.) es el contenido real. Antes esto se ignoraba
    // por completo: el mensaje llegaba sin texto y sin nada más, y el
    // módulo de IA respondía "no puedo visualizar imágenes" sin haber
    // recibido ninguna imagen de verdad.
    const mediaAttachment = (body.attachments ?? []).find((a: any) => a.type !== "Text");
    let attachment: { url: string; name: string; kind: "image" | "audio" | "file" } | null = null;

    if (mediaAttachment?.uri) {
      attachment = await downloadAndStoreMmsAttachment(phone, mediaAttachment);
    }

    if (phone) {
      await handleIncomingSms({
        phone,
        contactName,
        externalMessageId: String(body.id),
        text,
        attachment,
      });
    }
  }

  // Llamada perdida: el evento de telephony/sessions trae un array
  // "parties" con el estado de cada parte de la llamada. Buscamos una
  // parte entrante marcada como llamada perdida.
  //
  // Si esto no está andando, lo primero es mirar los Logs de esta
  // función después de una llamada de prueba: con este console.log de
  // acá abajo vas a ver el JSON completo que mandó RingCentral, y así
  // confirmamos si el evento ni siquiera está llegando (problema de
  // permisos/suscripción) o si está llegando con una forma distinta a
  // la que esperamos (ahí ajustamos el parseo).
  const parties = body?.parties;
  if (Array.isArray(parties)) {
    console.log("Evento de telephony/sessions recibido:", JSON.stringify(body));

    const missedParty = parties.find((p: any) => p?.missedCall === true);
    const phone = missedParty?.from?.phoneNumber;
    if (missedParty && phone) {
      const { data: contact } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();
      await supabase.from("missed_calls").insert({
        phone,
        contact_id: contact?.id ?? null,
        channel: "ringcentral",
      });
      await handleMissedCallAutoReply(phone, "ringcentral");
    }
  }

  return new Response("OK", { status: 200 });
});

// Baja el adjunto de MMS desde el message-store de RingCentral (el "uri"
// del attachment devuelve el binario directo, igual que la documentación
// de "Get Message Attachment") y lo sube a nuestro propio Storage, para no
// depender de que ese link siga siendo accesible después.
async function downloadAndStoreMmsAttachment(
  phone: string,
  mediaAttachment: { uri: string; contentType?: string; type?: string },
): Promise<{ url: string; name: string; kind: "image" | "audio" | "file" } | null> {
  try {
    const accessToken = await getRingCentralAccessToken();
    const fileRes = await fetch(mediaAttachment.uri, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      console.error("No se pudo bajar el adjunto de RingCentral:", fileRes.status, await fileRes.text());
      return null;
    }

    const mimeType = mediaAttachment.contentType ?? fileRes.headers.get("content-type") ?? "application/octet-stream";
    const bytes = new Uint8Array(await fileRes.arrayBuffer());

    const kind: "image" | "audio" | "file" = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "file";
    const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
    const filename = `${mediaAttachment.type ?? "adjunto"}.${ext}`;
    const path = `sms/${phone}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from("attachments").upload(path, bytes, { contentType: mimeType });
    if (error) {
      console.error("No se pudo subir el adjunto de RingCentral al Storage:", error.message);
      return null;
    }

    const { data } = supabase.storage.from("attachments").getPublicUrl(path);
    return { url: data.publicUrl, name: filename, kind };
  } catch (err) {
    console.error("Error bajando/subiendo adjunto de RingCentral:", err);
    return null;
  }
}

async function handleIncomingSms(opts: {
  phone: string;
  contactName: string | null;
  externalMessageId: string;
  text: string;
  attachment: { url: string; name: string; kind: "image" | "audio" | "file" } | null;
}) {
  const { phone, contactName, externalMessageId, text, attachment } = opts;

  // SMS ya viaja con el teléfono real — si ese número es pasajero
  // conocido en TaxiCaller, se prioriza ese nombre por sobre el que
  // manda RingCentral (que muchas veces no manda ninguno).
  const taxicallerName = await lookupPassengerName(phone);
  const resolvedName = taxicallerName ?? contactName;

  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("phone", phone)
    .maybeSingle();

  let contactId = existingContact?.id;

  if (!contactId) {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({ phone, full_name: resolvedName })
      .select("id")
      .single();
    if (error) throw error;
    contactId = newContact.id;

    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel: "sms",
      external_id: phone,
    });
  } else if (taxicallerName && existingContact.full_name !== taxicallerName) {
    // TaxiCaller es la fuente de verdad — se pisa aunque ya hubiera un
    // nombre cargado.
    await supabase.from("contacts").update({ full_name: taxicallerName }).eq("id", contactId);
  } else if (!existingContact.full_name && contactName) {
    // Ya lo conocíamos pero sin nombre, y TaxiCaller tampoco lo tiene —
    // si ahora RingCentral nos lo manda, lo completamos.
    await supabase.from("contacts").update({ full_name: contactName }).eq("id", contactId);
  }

  // Buscamos o creamos, de forma atómica (a prueba de dos llamadas
  // simultáneas), la conversación de SMS/WhatsApp de este contacto —
  // comparten conversación (misma asignación de operador para los dos).
  const { data: conversationId, error: convError } = await supabase.rpc(
    "find_or_create_sms_whatsapp_conversation",
    { p_contact_id: contactId, p_default_channel: "sms" },
  );
  if (convError) throw convError;

  // Chequeo de STOP/BAJA/START — si el mensaje era uno de estos comandos,
  // ya se actualizó el contacto y se mandó la confirmación obligatoria.
  // Igual seguimos y guardamos el mensaje normal, para que quede en el
  // historial.
  await handleOptOutKeyword(contactId, phone, text, "sms");

  // Si es fuera de horario de atención, avisa una sola vez (con
  // cooldown) — no interfiere con el flujo normal de todos modos.
  await maybeSendOutOfHoursNotice(contactId, phone, "sms");

  // Ya no reabrimos acá a mano — el trigger centralizado en `messages`
  // (trg_reopen_and_reassign_on_client_message) lo hace solo apenas se
  // inserte el mensaje, para cualquier canal, sin duplicar esta lógica.

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "contact",
    content: text || null,
    external_message_id: externalMessageId,
    sent_via_channel: "sms",
    attachment_url: attachment?.url ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_kind: attachment?.kind ?? null,
  });
}