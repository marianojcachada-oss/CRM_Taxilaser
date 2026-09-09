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
import { lookupPassengerName } from "../_shared/taxicaller.ts";
import { handleMissedCallAutoReply } from "../_shared/missedCallAutoReply.ts";

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

    if (phone) {
      await handleIncomingSms({
        phone,
        contactName,
        externalMessageId: String(body.id),
        text,
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

async function handleIncomingSms(opts: {
  phone: string;
  contactName: string | null;
  externalMessageId: string;
  text: string;
}) {
  const { phone, contactName, externalMessageId, text } = opts;

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

  // Buscamos la conversación más reciente con este contacto por SMS o
  // WhatsApp (comparten conversación — misma asignación de operador
  // para los dos), sin importar si está cerrada.
  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("contact_id", contactId)
    .in("channel", ["sms", "whatsapp"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id;

  // Ya no reabrimos acá a mano — el trigger centralizado en `messages`
  // (trg_reopen_and_reassign_on_client_message) lo hace solo apenas se
  // inserte el mensaje, para cualquier canal, sin duplicar esta lógica.

  if (!conversationId) {
    const { data: queue } = await supabase.from("queues").select("id").eq("name", "sms_general").maybeSingle();

    const { data: newConversation, error } = await supabase
      .from("conversations")
      .insert({
        contact_id: contactId,
        channel: "sms",
        channels_available: ["sms", "whatsapp"],
        queue_id: queue?.id ?? null,
        external_thread_id: phone,
      })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = newConversation.id;
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "contact",
    content: text,
    external_message_id: externalMessageId,
    sent_via_channel: "sms",
  });
}