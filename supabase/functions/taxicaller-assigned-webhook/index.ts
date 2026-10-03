// supabase/functions/taxicaller-assigned-webhook/index.ts
//
// Recibe el evento "Servicio esta en camino" de TaxiCaller (no
// "Servicio asignado" — ese solo dice que un chofer lo aceptó, puede
// quedar en cola sin arrancar; "en camino" es cuando ya va de verdad
// hacia el pasajero, con un tiempo estimado real). No manda ningún
// mensaje al pasajero — solo actualiza el estado interno del contacto,
// para que los operadores vean en el panel si ya tiene un viaje en
// curso (y así no le arman uno duplicado) y el tiempo estimado.
//
// El tiempo estimado NO se actualiza solo en vivo — se guarda el valor
// y la hora en que llegó, y la cuenta regresiva se calcula en el
// navegador con una resta simple. Así no hace falta ninguna consulta
// constante al servidor.
//
// Body esperado (configurado en el panel de TaxiCaller):
// {
//   "job_id": "[job.id]",
//   "passenger_phone": "[job.client.phone]",
//   "passenger_name": "[job.client.name]",
//   "vehicle_make": "[vehicle.tags.make]",
//   "vehicle_color": "[vehicle.tags.color_name]",
//   "vehicle_plate": "[vehicle.tags.plate]",
//   "eta_minutes": "[job.route.pickup.eta]",
//   "booked_by": "[job.extra.tags.booked_by]",
//   "job_started_at": "[job.stimes.start]"
// }
//
// "job_started_at" es la hora REAL (de TaxiCaller) en que arrancó el
// viaje — se usa como created_at de la fila de ride_history en vez de
// la hora en que nos llega esta notificación, para que el conteo de
// "servicios enviados por hora" en Métricas sea exacto. No sabíamos de
// antemano en qué formato manda TaxiCaller este tag (con eta_minutes ya
// pasó que esperábamos un número y llegó como texto "02:24 AM"), así
// que parseJobStartedAt() de abajo prueba varios formatos posibles; si
// ninguno matchea, cae de vuelta a la hora de recepción (el
// comportamiento de antes) y deja un console.error con el valor crudo
// para poder ajustar el parser puntual sin que nada se rompa mientras
// tanto.
//
// "booked_by" es el agregado nuevo: el código del operador/dispatcher
// que mandó el servicio (tal cual lo tiene cargado TaxiCaller en ese
// tag), para poder atribuir "servicios enviados" a cada operador en
// Métricas — antes esto era imposible porque ninguna tabla de
// TaxiCaller guardaba quién lo había mandado. Se guarda en el
// contacto mientras el viaje está activo (active_ride_booked_by) y se
// traslada a ride_history recién cuando el viaje termina o se cancela
// (en los otros dos webhooks), que es donde se calculan las métricas.
//
// "vehicle_color" y "vehicle_plate" son dos tags NUEVOS para esta
// notificación en particular — hay que agregarlos en el panel de
// TaxiCaller (pestaña de Tags de la notificación de "Servicio en
// camino"), con esas claves exactas, igual que ya está cargado
// vehicle_make. Mientras no estén agregados ahí, estos dos campos van
// a llegar vacíos siempre, sin que afecte nada más de esta función (el
// resto sigue andando igual).
//
// Guardar acá color/placa (en vez de en taxicaller-webhook, el evento
// de "esperando al pasajero") es a propósito: esta función no depende
// del interruptor TAXICALLER_AUTO_MESSAGE_ENABLED del SMS automático de
// "taxi llegó" — así que aunque se apague ese SMS para que los
// operadores lo manden a mano con una plantilla, estos datos se siguen
// completando solos, sin cambiar en nada el webhook del SMS automático.
// Se guardan en active_ride_color / active_ride_plate, igual que ya se
// guarda active_ride_unit — para que el panel de contacto y las
// plantillas de respuesta rápida ({{color}} / {{placa}}) tengan datos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "../_shared/settings.ts";
import { normalizePhone } from "../_shared/phone.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// TaxiCaller manda la hora de llegada como texto ("02:24 AM"), no una
// cantidad de minutos — hay que calcular la diferencia contra la hora
// actual, en el huso horario de la empresa (Atlanta, GA).
function parseEtaTimeToMinutes(etaTimeStr: string): number | null {
  const match = etaTimeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let targetHour = parseInt(match[1], 10) % 12;
  const targetMinute = parseInt(match[2], 10);
  if (match[3].toUpperCase() === "PM") targetHour += 12;

  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const nowHour = parseInt(nowParts.find((p) => p.type === "hour")!.value, 10);
  const nowMinute = parseInt(nowParts.find((p) => p.type === "minute")!.value, 10);

  let diff = targetHour * 60 + targetMinute - (nowHour * 60 + nowMinute);
  if (diff < -60) diff += 24 * 60; // cruzó medianoche — asumimos que es dentro de las próximas horas

  return diff;
}

// Intenta varios formatos posibles para "job_started_at" y devuelve un
// ISO timestamp, o null si no pudo interpretarlo (en ese caso el
// llamador cae de vuelta a la hora de recepción del webhook).
function parseJobStartedAt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1) Fecha/hora completa en un formato que JS entiende de por sí
  //    (ISO 8601, "2026-10-03 20:13:00", etc.)
  const direct = new Date(trimmed);
  if (!isNaN(direct.getTime())) return direct.toISOString();

  // 2) Timestamp numérico (epoch) — en segundos (10 dígitos) o
  //    milisegundos (13 dígitos).
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = trimmed.length > 10 ? n : n * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 3) Solo la hora, como vino eta_minutes ("08:13 PM") — se arma con
  //    la fecha de hoy en el huso horario de la empresa. El viaje ya
  //    arrancó (es un evento pasado, no futuro como el ETA), así que si
  //    da más de 2 horas en el futuro asumimos que cruzó medianoche y
  //    en realidad es de ayer.
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let targetHour = parseInt(match[1], 10) % 12;
    const targetMinute = parseInt(match[2], 10);
    if (match[3].toUpperCase() === "PM") targetHour += 12;

    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => nowParts.find((p) => p.type === type)!.value;

    const candidate = new Date(
      `${get("year")}-${get("month")}-${get("day")}T${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}:00`,
    );
    if (candidate.getTime() - Date.now() > 2 * 60 * 60 * 1000) {
      candidate.setDate(candidate.getDate() - 1);
    }
    if (!isNaN(candidate.getTime())) return candidate.toISOString();
  }

  console.error("job_started_at en formato desconocido, uso la hora de recepción:", raw);
  return null;
}

Deno.serve(async (req) => {
  // Ambas claves en una sola consulta — antes eran 2 consultas separadas
  // en CADA evento que manda TaxiCaller.
  const settings = await getSettings(["TAXICALLER_WEBHOOK_SECRET", "TAXICALLER_ASSIGNED_TRACKING_ENABLED"]);

  const expectedSecret = settings.TAXICALLER_WEBHOOK_SECRET;
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const enabled = settings.TAXICALLER_ASSIGNED_TRACKING_ENABLED;
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
  // job.route.pickup.eta puede venir en distintos formatos según cómo lo
  // maneje TaxiCaller — nos quedamos solo con los dígitos, por las dudas.
  const etaMinutes = parseEtaTimeToMinutes(String(body.eta_minutes ?? ""));
  const bookedBy = body.booked_by || null;
  const vehicleColor = body.vehicle_color || null;
  const vehiclePlate = body.vehicle_plate || null;
  const jobStartedAt = body.job_started_at ? parseJobStartedAt(String(body.job_started_at)) : null;

  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("phone", phone)
    .maybeSingle();

  let contactId = existingContact?.id;

  if (existingContact) {
    await supabase
      .from("contacts")
      .update({
        // Igual que en los otros 3 webhooks: el nombre solo se completa
        // si todavía no lo teníamos, una sola vez.
        ...(!existingContact.full_name && passengerName ? { full_name: passengerName } : {}),
        has_active_ride: true,
        active_ride_status: "active",
        active_ride_unit: body.vehicle_make || null,
        active_ride_color: vehicleColor,
        active_ride_plate: vehiclePlate,
        active_ride_eta_minutes: etaMinutes,
        active_ride_eta_received_at: new Date().toISOString(),
        active_ride_fare: null,
        active_ride_completed_at: null,
        active_ride_booked_by: bookedBy,
      })
      .eq("id", existingContact.id);
  } else {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({
        phone,
        full_name: passengerName,
        has_active_ride: true,
        active_ride_status: "active",
        active_ride_unit: body.vehicle_make || null,
        active_ride_color: vehicleColor,
        active_ride_plate: vehiclePlate,
        active_ride_eta_minutes: etaMinutes,
        active_ride_eta_received_at: new Date().toISOString(),
        active_ride_booked_by: bookedBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    contactId = newContact.id;
  }

  // Acá nace la fila de ride_history del viaje — no cuando termina o se
  // cancela. Así "created_at" queda guardado con la hora REAL en que el
  // operador despachó el móvil, que es la hora correcta para atribuir
  // "servicios enviados" a un turno/hora puntual (antes se guardaba la
  // hora de cierre del viaje, que podía caer en otra hora distinta a
  // cuando el operador lo trabajó). taxicaller-finished-webhook y
  // taxicaller-cancel-webhook solo ACTUALIZAN esta misma fila (por
  // job_id) para ponerle el resultado final — nunca tocan created_at.
  //
  // upsert_ride_dispatch() (función de Postgres) a propósito NO pisa
  // event_type si la fila ya existe — cubre el caso rarísimo de que el
  // webhook de "terminado"/"cancelado" llegue antes que este por algún
  // desorden de red, para no perder el resultado final ya guardado.
  if (body.job_id) {
    const { error: dispatchError } = await supabase.rpc("upsert_ride_dispatch", {
      p_job_id: String(body.job_id),
      p_contact_id: contactId,
      p_booked_by: bookedBy,
      p_created_at: jobStartedAt,
    });
    if (dispatchError) console.error("No se pudo guardar el despacho en ride_history:", dispatchError.message);
  }

  return new Response("OK", { status: 200 });
});