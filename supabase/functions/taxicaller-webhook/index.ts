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
//   "passenger_phone": "[job.client.phone]",
//   "passenger_name": "[job.client.name]"
// }
//
// OJO con passenger_name: en TaxiCaller el pasajero se guarda como un
// solo campo de nombre completo (no separado en nombre/apellido). Si tu
// plantilla no tiene este tag agregado todavía, entrá al panel de
// TaxiCaller → esa notificación → pestaña de Tags, buscá el tag del
// nombre del cliente (algo como [job.client.name] o similar) y agregalo
// al payload con la clave exacta "passenger_name" — mientras no esté en
// la plantilla, este campo va a llegar vacío siempre, sin importar lo
// que haga este código.
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

  // Deduplicación: si TaxiCaller manda este mismo job dos veces (reintento,
  // o dos notificaciones apuntando acá), la segunda vez choca contra la
  // clave única y se corta antes de mandar nada de nuevo o crear un chat
  // duplicado.
  if (body.job_id) {
    const { error: dedupError } = await supabase
      .from("taxicaller_processed_events")
      .insert({ job_id: String(body.job_id), event_type: "wait" });
    if (dedupError) {
      return new Response("OK (evento duplicado, ya procesado)", { status: 200 });
    }
  } else {
    console.warn("Evento 'wait' sin job_id — no se puede deduplicar este en particular.");
  }

  const phone = normalizePhone(rawPhone);
  // TaxiCaller guarda al pasajero con un solo campo de nombre completo
  // (no separado en nombre/apellido) — probá con "passenger_name"
  // primero; dejamos "passenger_first_name" como respaldo por si tu
  // plantilla ya lo tenía armado así.
  const passengerName = body.passenger_name || body.passenger_first_name || null;
  if (!passengerName) {
    console.warn("Evento 'wait' sin passenger_name — revisar si TaxiCaller lo está mandando. Body completo:", JSON.stringify(body));
  }

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

  // Buscar el contacto ANTES de mandar nada — hace falta para el chequeo
  // de seguridad de acá abajo.
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name, has_active_ride, do_not_contact")
    .eq("phone", phone)
    .maybeSingle();

  // -----------------------------------------------------------------
  // Freno de seguridad: si TaxiCaller manda este evento con los datos
  // del vehículo vacíos, o para un número que no tiene un servicio
  // activo registrado (nunca pasó por "Servicio asignado"), es una
  // señal fuerte de que el evento está mal — un número equivocado, un
  // job de prueba, algo mal cargado del lado de TaxiCaller. En vez de
  // mandarle un SMS confuso o directamente falso a un cliente real, se
  // deja registrado en Errores para que lo revise un admin, y no se
  // manda nada.
  // -----------------------------------------------------------------
  const hasVehicleData = Boolean(make || color || plate);
  const hasActiveRide = existingContact?.has_active_ride === true;

  if (existingContact?.do_not_contact) {
    return new Response("OK (contacto dado de baja, STOP)", { status: 200 });
  }

  if (!hasVehicleData || !hasActiveRide) {
    const reasons = [
      !hasVehicleData ? "sin datos del vehículo (make/color/plate vacíos)" : null,
      !hasActiveRide ? "el contacto no tiene un servicio activo registrado" : null,
    ].filter(Boolean).join(" y ");

    console.error(`Evento 'wait' sospechoso para ${phone} — ${reasons}. Body completo:`, JSON.stringify(body));

    await supabase.from("app_errors").insert({
      context: "taxicaller-webhook (wait)",
      message: `Aviso de "taxi llegó" NO enviado — ${reasons}. Teléfono: ${phone}, job_id: ${body.job_id ?? "?"}`,
      stack: JSON.stringify(body, null, 2),
    });

    return new Response(JSON.stringify({ warning: "Evento sospechoso, no se mandó nada", reasons }), {
      status: 200,
    });
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

  // El contacto ya se buscó más arriba (para el chequeo de seguridad) —
  // llegado a este punto, sabemos que existe y tiene un servicio activo,
  // así que solo falta completar el nombre si todavía no lo tenía.
  const contactId = existingContact!.id;

  if (!existingContact!.full_name && passengerName) {
    await supabase.from("contacts").update({ full_name: passengerName }).eq("id", contactId);
  }

  // Conversación de SMS/WhatsApp más reciente con este contacto (se
  // reabre si estaba cerrada), de forma atómica — a prueba de dos
  // llamadas simultáneas.
  const { data: conversationId, error: convRpcError } = await supabase.rpc(
    "find_or_create_sms_whatsapp_conversation",
    { p_contact_id: contactId, p_default_channel: "sms" },
  );
  if (convRpcError) throw convRpcError;

  // Antes esto solo se ejecutaba si YA estaba cerrada (no hacia nada
  // nuevo) -- ahora cierra de una cualquier conversacion existente que
  // reciba uno de estos avisos automaticos, y la desasigna (para que no
  // quede pegada a un operador ni cuente para nadie).
  await supabase
    .from("conversations")
    .update({ status: "cerrada", unread: false, assigned_operator_id: null, needs_assignment: false })
    .eq("id", conversationId);

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