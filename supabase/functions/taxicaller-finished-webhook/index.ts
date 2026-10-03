// supabase/functions/taxicaller-finished-webhook/index.ts
//
// Recibe el evento "Servicio terminado" de TaxiCaller y le avisa al
// pasajero por SMS con el total cobrado. De paso, suma +1 a
// "servicios_completados" del contacto — así el dato de fiabilidad del
// panel de contacto empieza a tener información real.
//
// Body esperado (configurado en el panel de TaxiCaller):
// {
//   "job_id": "[job.id]",
//   "passenger_phone": "[job.client.phone]",
//   "vehicle_make": "[vehicle.tags.make]",
//   "fare_total": "[fx.amount(pay_shares.fare.grand_total)]"
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { sendAutomatedMessage } from "../_shared/automatedMessage.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  // Ambas claves en una sola consulta — antes eran 2 consultas separadas
  // en CADA evento que manda TaxiCaller.
  const settings = await getSettings(["TAXICALLER_WEBHOOK_SECRET", "TAXICALLER_FINISHED_MESSAGE_ENABLED"]);

  const expectedSecret = settings.TAXICALLER_WEBHOOK_SECRET;
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const enabled = settings.TAXICALLER_FINISHED_MESSAGE_ENABLED;
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
      .insert({ job_id: String(body.job_id), event_type: "finished" });
    if (dedupError) {
      return new Response("OK (evento duplicado, ya procesado)", { status: 200 });
    }
  }

  const phone = normalizePhone(rawPhone);
  const make = body.vehicle_make || "";
  const fareTotal = body.fare_total || "";
  const passengerName = body.passenger_name || null;

  const text =
    `Su servicio${make ? ` con la unidad ${make}` : ""} fue finalizado` +
    (fareTotal ? ` por $${fareTotal}` : "");

  // Buscar o crear el contacto ANTES de mandar el mensaje — hace falta
  // su ID para saber por qué canal(es) prefiere recibir avisos.
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name, servicios_completados, active_ride_booked_by")
    .eq("phone", phone)
    .maybeSingle();

  let contactId = existingContact?.id;

  if (!contactId) {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({ phone, full_name: passengerName, servicios_completados: 1 })
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
        ...(!existingContact.full_name && passengerName ? { full_name: passengerName } : {}),
        servicios_completados: (existingContact.servicios_completados ?? 0) + 1,
        has_active_ride: false,
        active_ride_status: "completed",
        active_ride_fare: fareTotal || null,
        active_ride_completed_at: new Date().toISOString(),
        active_ride_eta_minutes: null,
        active_ride_eta_received_at: null,
        // Se limpia acá — ya se usó abajo para la fila de ride_history,
        // que es donde queda guardado de forma permanente.
        active_ride_booked_by: null,
      })
      .eq("id", contactId);
  }

  const { sentVia, wamid, rcMessageId } = await sendAutomatedMessage({ contactId, phone, text });

  // Historial real, de acá en adelante — una fila por viaje. booked_by
  // viene de lo que guardó taxicaller-assigned-webhook cuando se armó
  // este viaje — null si ese webhook no llegó a mandarlo (plantilla
  // vieja en TaxiCaller, o el viaje nunca pasó por "en camino").
  await supabase.from("ride_history").insert({
    contact_id: contactId,
    job_id: body.job_id ?? null,
    event_type: "completed",
    vehicle_unit: make || null,
    fare: fareTotal || null,
    booked_by: existingContact?.active_ride_booked_by ?? null,
  });

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
    automation_type: "finished",
    wamid,
    rc_message_id: rcMessageId,
    delivery_status: "sent",
  });

  await supabase.from("contact_timeline").insert({
    contact_id: contactId,
    conversation_id: conversationId,
    event_type: "ride_completed",
    description: `Servicio finalizado${fareTotal ? ` — $${fareTotal}` : ""} (job ${body.job_id ?? "?"})`,
  });

  return new Response("OK", { status: 200 });
});