// supabase/functions/taxicaller-cancel-webhook/index.ts
//
// Recibe el evento "Cancelado por la empresa" de TaxiCaller y le avisa
// automáticamente al pasajero por SMS. Mismo patrón que
// taxicaller-webhook (el de "Esperando al pasajero"), función separada
// porque es un evento distinto con su propio mensaje.
//
// Body esperado (configurado en el panel de TaxiCaller):
// {
//   "job_id": "[job.id]",
//   "passenger_phone": "[job.client.phone]",
//   "booked_by": "[job.extra.tags.booked_by]"
// }
//
// "booked_by" es nuevo (4/10/2026) — mismo motivo que en
// taxicaller-finished-webhook: antes solo se leía el dato cacheado en
// el contacto desde el despacho, frágil si ese webhook se pierde.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { sendAutomatedMessage } from "../_shared/automatedMessage.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  // Las 3 claves que puede llegar a necesitar esta función se piden juntas
  // en una sola consulta — antes eran 3 consultas separadas (una por
  // getSetting()) en CADA evento que manda TaxiCaller.
  const settings = await getSettings([
    "TAXICALLER_WEBHOOK_SECRET",
    "TAXICALLER_CANCEL_MESSAGE_ENABLED",
    "RINGCENTRAL_FROM_NUMBER",
  ]);

  const expectedSecret = settings.TAXICALLER_WEBHOOK_SECRET;
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const enabled = settings.TAXICALLER_CANCEL_MESSAGE_ENABLED;
  if (enabled === "false") {
    return new Response("OK (desactivado desde Integrations)", { status: 200 });
  }

  const rawBody = await req.text();
  if (!rawBody) return new Response("OK", { status: 200 });

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Body no es JSON válido" }), { status: 400 });
  }

  const rawPhone = body.passenger_phone;
  if (!rawPhone) {
    return new Response("OK (sin teléfono)", { status: 200 });
  }

  if (body.job_id) {
    const { error: dedupError } = await supabase
      .from("taxicaller_processed_events")
      .insert({ job_id: String(body.job_id), event_type: "cancelled" });
    if (dedupError) {
      return new Response("OK (evento duplicado, ya procesado)", { status: 200 });
    }
  }

  const phone = normalizePhone(rawPhone);
  const passengerName = body.passenger_name || null;
  const dispatchNumber = settings.RINGCENTRAL_FROM_NUMBER ?? "";
  const bookedByFromBody = body.booked_by || null;

  const text =
    `Su servicio ha sido cancelado. Para solicitarlo nuevamente por favor llame o envíe un SMS` +
    (dispatchNumber ? ` al ${dispatchNumber}` : "");

  // Buscar o crear el contacto ANTES de mandar el mensaje — hace falta
  // su ID para saber por qué canal(es) prefiere recibir avisos.
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name, servicios_cancelados, active_ride_booked_by")
    .eq("phone", phone)
    .maybeSingle();

  let contactId = existingContact?.id;

  if (!contactId) {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({ phone, full_name: passengerName, servicios_cancelados: 1 })
      .select("id")
      .single();
    if (error) throw error;
    contactId = newContact.id;

    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel: "sms",
      external_id: phone,
    });
  } else {
    await supabase
      .from("contacts")
      .update({
        // El nombre solo se completa una vez, si todavía no lo
        // teníamos — si ya tiene uno cargado (por acá o a mano), no se
        // toca más.
        ...(!existingContact.full_name && passengerName ? { full_name: passengerName } : {}),
        servicios_cancelados: (existingContact.servicios_cancelados ?? 0) + 1,
        has_active_ride: false,
        active_ride_status: "cancelled",
        active_ride_completed_at: new Date().toISOString(),
        active_ride_eta_minutes: null,
        active_ride_eta_received_at: null,
        // Se limpia acá — ya se usó abajo para la fila de ride_history.
        active_ride_booked_by: null,
      })
      .eq("id", contactId);
  }

  const { sentVia, wamid, rcMessageId } = await sendAutomatedMessage({ contactId, phone, text });

  // La fila de este viaje en ride_history YA existe desde que
  // taxicaller-assigned-webhook la despachó (upsert_ride_dispatch crea
  // la fila con event_type="dispatched" apenas sale el móvil) — acá
  // solo la ACTUALIZAMOS con el resultado final, por job_id. Antes esto
  // era un INSERT plano, que chocaba siempre que la fila de despacho ya
  // existía (prácticamente siempre, en el flujo normal) -- 4/10/2026,
  // cambiado a upsert por el mismo motivo.
  //
  // booked_by: prioridad al que manda ESTE evento; si no vino, se cae al
  // que había quedado cacheado en el contacto desde el despacho (null si
  // ese webhook no llegó a mandarlo).
  await supabase.from("ride_history").upsert(
    {
      contact_id: contactId,
      job_id: body.job_id ?? null,
      event_type: "cancelled",
      booked_by: bookedByFromBody ?? existingContact?.active_ride_booked_by ?? null,
    },
    { onConflict: "job_id" },
  );

  // Si NO salió nada por ningún canal (canal apagado desde Integrations,
  // contacto con STOP o bloqueado, o error de envío), no se guarda ningún
  // mensaje: antes se grababa igual como "enviado por SMS", o sea un
  // mensaje fantasma en la bandeja que nunca salió -- y de paso cada aviso
  // reabría la conversación (find_or_create...), el round robin se la
  // asignaba a alguien (gastándole el turno) y recién después se cerraba,
  // con todos los eventos de Realtime que eso genera.
  //
  // Acá solo se cierra la conversación de SMS/WhatsApp que YA esté abierta
  // (si hay una) -- no se crea ni se reabre ninguna.
  if (sentVia.length === 0) {
    const { data: openConv } = await supabase
      .from("conversations")
      .select("id, assigned_operator_id")
      .eq("contact_id", contactId)
      .in("channel", ["sms", "whatsapp"])
      .neq("status", "cerrada")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (openConv?.id) {
      await supabase
        .from("conversations")
        .update({
          status: "cerrada",
          unread: false,
          assigned_operator_id: null,
          needs_assignment: false,
          preferred_operator_id: openConv.assigned_operator_id ?? null,
        })
        .eq("id", openConv.id);
    }

    await supabase.from("contact_timeline").insert({
      contact_id: contactId,
      conversation_id: openConv?.id ?? null,
      event_type: "ride_cancelled",
      description: `Servicio cancelado por la empresa — notificación automática NO enviada (job ${body.job_id ?? "?"})`,
    });

    return new Response("OK (sin envío: ningún canal disponible)", { status: 200 });
  }

  // Conversación de SMS/WhatsApp (se reabre si estaba cerrada), de forma
  // atómica — a prueba de dos llamadas simultáneas.
  const { data: conversationId, error: convRpcError } = await supabase.rpc(
    "find_or_create_sms_whatsapp_conversation",
    { p_contact_id: contactId, p_default_channel: "sms" },
  );
  if (convRpcError) throw convRpcError;

  // Antes esto solo se ejecutaba si YA estaba cerrada (no hacia nada
  // nuevo) -- ahora cierra de una cualquier conversacion existente que
  // reciba uno de estos avisos automaticos, y la desasigna (para que no
  // quede pegada a un operador ni cuente para nadie).
  //
  // Guardamos quién la tenía asignada justo antes de desasignarla, en
  // preferred_operator_id — si el cliente responde algo y el chat se
  // reabre, el round robin le va a dar prioridad a esa misma persona
  // (si sigue disponible) en vez de repartirlo a cualquiera del turno.
  const { data: convBeforeClose } = await supabase
    .from("conversations")
    .select("assigned_operator_id")
    .eq("id", conversationId)
    .maybeSingle();

  await supabase
    .from("conversations")
    .update({
      status: "cerrada",
      unread: false,
      assigned_operator_id: null,
      needs_assignment: false,
      preferred_operator_id: convBeforeClose?.assigned_operator_id ?? null,
    })
    .eq("id", conversationId);

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "operator",
    content: text,
    sent_via_channel: sentVia.join(",") || "sms",
    automation_type: "cancelled",
    wamid,
    rc_message_id: rcMessageId,
    delivery_status: "sent",
  });

  await supabase.from("contact_timeline").insert({
    contact_id: contactId,
    conversation_id: conversationId,
    event_type: "ride_cancelled",
    description: `Servicio cancelado por la empresa — notificación automática enviada (job ${body.job_id ?? "?"})`,
  });

  return new Response("OK", { status: 200 });
});