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
//   "fare_total": "[fx.amount(pay_shares.fare.grand_total)]",
//   "booked_by": "[job.extra.tags.booked_by]"
// }
//
// "booked_by" es nuevo (4/10/2026): antes esta función solo leía el
// booked_by que había quedado guardado en el contacto desde el despacho
// (contacts.active_ride_booked_by) — frágil, porque si ese webhook de
// despacho se pierde o llega fuera de orden, acá queda null y el
// servicio completado no se puede atribuir a ningún operador en
// Métricas. Ahora, si TaxiCaller manda booked_by directo en ESTE
// evento, se usa ese; el dato del contacto queda solo como respaldo.

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

  // El interruptor de Integrations apaga SOLO el aviso al pasajero. Antes
  // cortaba acá, antes de tocar nada, y eso dejaba al contacto con el
  // servicio "activo" para siempre (has_active_ride nunca volvía a false),
  // sin sumar servicios_completados ni cerrar la fila de ride_history. Ahora
  // el estado del viaje se actualiza siempre; solo se omite el mensaje.
  const messageEnabled = settings.TAXICALLER_FINISHED_MESSAGE_ENABLED !== "false";

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
  const bookedByFromBody = body.booked_by || null;

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

  const { sentVia, wamid, rcMessageId } = messageEnabled
    ? await sendAutomatedMessage({ contactId, phone, text })
    : { sentVia: [] as string[], wamid: null as string | null, rcMessageId: null as string | null };

  // La fila de este viaje en ride_history YA existe desde que
  // taxicaller-assigned-webhook la despachó (upsert_ride_dispatch crea
  // la fila con event_type="dispatched" apenas sale el móvil) — acá
  // solo la ACTUALIZAMOS con el resultado final, por job_id. Antes esto
  // era un INSERT plano, que chocaba siempre que la fila de despacho ya
  // existía (prácticamente siempre, en el flujo normal) -- 4/10/2026,
  // cambiado a upsert por el mismo motivo.
  //
  // Si por algún motivo la fila no existía (plantilla vieja en
  // TaxiCaller sin el evento "en camino", o ese webhook nunca llegó), el
  // upsert la crea recién acá, igual que antes.
  //
  // booked_by: prioridad al que manda ESTE evento (bookedByFromBody); si
  // no vino, se cae al que había quedado cacheado en el contacto desde
  // el despacho — así un dispatch perdido ya no deja el servicio sin
  // atribuir, siempre que TaxiCaller mande el tag en ambos eventos.
  await supabase.from("ride_history").upsert(
    {
      contact_id: contactId,
      job_id: body.job_id ?? null,
      event_type: "completed",
      vehicle_unit: make || null,
      fare: fareTotal || null,
      booked_by: bookedByFromBody ?? existingContact?.active_ride_booked_by ?? null,
    },
    { onConflict: "job_id" },
  );

  // Aviso apagado desde Integrations: el estado del viaje ya quedó
  // actualizado arriba (contacto + ride_history). No se manda nada ni se
  // toca ninguna conversación — solo queda constancia en el timeline.
  if (!messageEnabled) {
    await supabase.from("contact_timeline").insert({
      contact_id: contactId,
      conversation_id: null,
      event_type: "ride_completed",
      description: `Servicio finalizado${fareTotal ? ` — $${fareTotal}` : ""} — aviso automático desactivado (job ${body.job_id ?? "?"})`,
    });
    return new Response("OK (estado actualizado, aviso desactivado desde Integrations)", { status: 200 });
  }

  // Si NO salió nada por ningún canal (canal apagado desde Integrations,
  // contacto con STOP o bloqueado, o error de envío), no se guarda ningún
  // mensaje: antes se grababa igual como "enviado por SMS", o sea un
  // mensaje fantasma en la bandeja que nunca salió -- y de paso cada aviso
  // reabría la conversación (find_or_create...), el round robin se la
  // asignaba a alguien (gastándole el turno) y recién después se cerraba,
  // con todos los eventos de Realtime que eso genera.
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
      event_type: "ride_completed",
      description: `Servicio finalizado${fareTotal ? ` — $${fareTotal}` : ""} — notificación automática NO enviada (job ${body.job_id ?? "?"})`,
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