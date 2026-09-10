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
//   "passenger_phone": "[job.client.phone]"
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { sendAutomatedMessage } from "../_shared/automatedMessage.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const expectedSecret = await getSetting("TAXICALLER_WEBHOOK_SECRET");
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const enabled = await getSetting("TAXICALLER_CANCEL_MESSAGE_ENABLED");
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

  const phone = normalizePhone(rawPhone);
  const passengerName = body.passenger_name || null;
  const dispatchNumber = (await getSetting("RINGCENTRAL_FROM_NUMBER")) ?? "";

  const text =
    `Su servicio ha sido cancelado. Para solicitarlo nuevamente por favor llame o envíe un SMS` +
    (dispatchNumber ? ` al ${dispatchNumber}` : "");

  // Buscar o crear el contacto ANTES de mandar el mensaje — hace falta
  // su ID para saber por qué canal(es) prefiere recibir avisos.
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name, servicios_cancelados")
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
      })
      .eq("id", contactId);
  }

  const { sentVia } = await sendAutomatedMessage({ contactId, phone, text });

  // Historial real, de acá en adelante — una fila por viaje
  await supabase.from("ride_history").insert({
    contact_id: contactId,
    job_id: body.job_id ?? null,
    event_type: "cancelled",
  });

  // Conversación de SMS más reciente (se reabre si estaba cerrada), o nueva
  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("contact_id", contactId)
    .eq("channel", "sms")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id;

  // Antes esto solo se ejecutaba si YA estaba cerrada (no hacia nada
  // nuevo) -- ahora cierra de una cualquier conversacion existente que
  // reciba uno de estos avisos automaticos, y la desasigna (para que no
  // quede pegada a un operador ni cuente para nadie).
  if (conversationId) {
    await supabase
      .from("conversations")
      .update({ status: "cerrada", unread: false, assigned_operator_id: null, needs_assignment: false })
      .eq("id", conversationId);
  }

  if (!conversationId) {
    const { data: newConversation, error } = await supabase
      .from("conversations")
      .insert({
        contact_id: contactId,
        channel: "sms",
        queue_id: null,
        needs_assignment: false, // aviso informativo, no necesita que un operador lo tome
        // Cerrada de una: si el cliente no vuelve a escribir, no queda
        // dando vueltas en ninguna bandeja activa (ni Mias, ni Sin
        // asignar, ni Pendientes) — solo se ve en Todos. Si el cliente
        // SI escribe algo despues, el trigger de reapertura la reabre y
        // reparte normal, como cualquier conversacion cerrada.
        status: 'cerrada',
        unread: false,
        external_thread_id: phone,
      })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = newConversation.id;
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "operator",
    content: text,
    sent_via_channel: sentVia.join(",") || "sms",
    automation_type: "cancelled",
  });

  await supabase.from("contact_timeline").insert({
    contact_id: contactId,
    conversation_id: conversationId,
    event_type: "ride_cancelled",
    description: `Servicio cancelado por la empresa — notificación automática enviada (job ${body.job_id ?? "?"})`,
  });

  return new Response("OK", { status: 200 });
});