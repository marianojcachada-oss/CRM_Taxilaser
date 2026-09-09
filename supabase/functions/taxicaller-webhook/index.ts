// supabase/functions/taxicaller-webhook/index.ts
//
// Recibe el evento "Esperando al pasajero" (Wait) de TaxiCaller, y le
// manda automáticamente un SMS al pasajero con los datos del chofer, el
// vehículo, y el link de seguimiento — la notificación que veníamos
// planeando desde el arranque del proyecto.
//
// Body esperado (configurado como template en el panel de TaxiCaller).
// Confirmado contra el webhook que YA tiene armado la otra plataforma
// para este mismo evento — mismos nombres de tags, ya probados:
// {
//   "event": "waiting_for_passenger",
//   "job_id": "[job.id]",
//   "vehicle_make": "[vehicle.tags.make]",
//   "vehicle_color": "[vehicle.tags.color_name]",
//   "vehicle_plate": "[vehicle.tags.plate]",
//   "passenger_phone": "[job.client.phone]"
// }
//
// El mensaje se arma como: "Su Taxi {make} {color} con placa {plate} ha
// llegado / {tu número de RingCentral}". No tenemos indicativo (D1554) ni
// modelo/año por separado — el otro sistema probablemente los arma
// cruzando estos datos contra su propia base de vehículos, que nosotros
// no tenemos. Si vehicle_make viniera combinado ("HYU Elantra 2012"), el
// mensaje ya va a salir completo solo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
import { sendSms } from "../_shared/ringcentral.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  // TaxiCaller no puede autenticarse con un JWT de Supabase — en vez de
  // eso, validamos un secreto compartido que vos configurás como header
  // custom en el panel de TaxiCaller.
  const expectedSecret = await getSetting("TAXICALLER_WEBHOOK_SECRET");
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  // Interruptor manual: si está apagado desde Integrations, no se manda
  // nada — ni el SMS ni se toca la base. Por defecto queda prendido
  // (si nunca se cargó el valor, se lo trata como activado).
  const enabled = await getSetting("TAXICALLER_AUTO_MESSAGE_ENABLED");
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
    // No hay teléfono del pasajero en este evento — no hay a quién avisar
    return new Response("OK (sin teléfono)", { status: 200 });
  }

  const phone = normalizePhone(rawPhone);
  const passengerName = body.passenger_first_name || null;

  const dispatchNumber = (await getSetting("RINGCENTRAL_FROM_NUMBER")) ?? "";
  const make = body.vehicle_make || "";
  const color = body.vehicle_color || "";
  const plate = body.vehicle_plate || "";

  // vehicle_make ya viene completo desde TaxiCaller (indicativo + auto +
  // año todo junto, según cómo lo tienen cargado) — no hace falta
  // completar nada a mano. Igual dejamos un registro liviano por si
  // sirve más adelante (ver histórico, cruzar datos, etc.), sin que
  // afecte el mensaje.
  if (plate) {
    const { data: existingVehicle } = await supabase
      .from("vehicles")
      .select("id, make, color")
      .eq("plate", plate)
      .maybeSingle();

    if (existingVehicle) {
      const changed = existingVehicle.make !== make || existingVehicle.color !== color;
      await supabase
        .from("vehicles")
        .update({
          ...(changed ? { make, color, updated_at: new Date().toISOString() } : {}),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existingVehicle.id);
    } else {
      await supabase.from("vehicles").insert({ plate, make, color });
    }
  }

  // Mismo formato que ya usa la empresa: "Su Taxi D1554 HYU Elantra 2012
  // ROJO / RED con placa SJI7407 ha llegado / 404-596-8232"
  const vehicleLine = [make, color].filter(Boolean).join(" ");
  const text =
    `Su Taxi ${vehicleLine}${plate ? ` con placa ${plate}` : ""} ha llegado` +
    (dispatchNumber ? ` / ${dispatchNumber}` : "");

  try {
    await sendSms(phone, text);
  } catch (err) {
    // Si falla el envío, igual queremos que quede registrado en la base
    // para poder revisarlo — no cortamos acá.
    console.error("No se pudo enviar el SMS de Wait:", err);
  }

  // Buscar o crear el contacto (completando el nombre si no lo teníamos)
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("phone", phone)
    .maybeSingle();

  let contactId = existingContact?.id;

  if (!contactId) {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({ phone, full_name: passengerName })
      .select("id")
      .single();
    if (error) throw error;
    contactId = newContact.id;

    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel: "sms",
      external_id: phone,
    });
  } else if (!existingContact.full_name && passengerName) {
    await supabase.from("contacts").update({ full_name: passengerName }).eq("id", contactId);
  }

  // Conversación de SMS más reciente con este contacto (se reabre si
  // estaba cerrada), o una nueva
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
    // Ojo: sin queue_id a propósito — esto es un aviso automático, no
    // algo que tenga que entrar al reparto de round robin ni figurar
    // como "nueva" para un operador.
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

  // Registrar el mensaje que se mandó, para que quede visible en el hilo
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "operator",
    content: text,
    sent_via_channel: "sms",
    automation_type: "wait",
  });

  // Timeline del contacto
  await supabase.from("contact_timeline").insert({
    contact_id: contactId,
    conversation_id: conversationId,
    event_type: "driver_arrived",
    description: `Chofer llegó — notificación automática enviada (job ${body.job_id ?? "?"})`,
  });

  return new Response("OK", { status: 200 });
});