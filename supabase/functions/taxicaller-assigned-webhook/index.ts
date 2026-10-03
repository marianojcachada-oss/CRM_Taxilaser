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
//   "booked_by": "[job.extra.tags.booked_by]"
// }
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
// "vehicle_color" y "vehicle_plate" son los otros dos agregados: antes
// este webhook solo guardaba vehicle_make (el texto combinado
// "indicativo + auto + año" que ya manda TaxiCaller armado, ej. "D1112
// TYT Camry 2026"), así que el panel de contacto y las plantillas de
// respuesta rápida ({{color}} / {{placa}}) nunca tenían estos datos —
// quedaban siempre vacíos aunque el panel ya estaba armado para
// mostrarlos. Ahora se guardan aparte en active_ride_color /
// active_ride_plate, igual que ya se guarda active_ride_unit.

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

  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("phone", phone)
    .maybeSingle();

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
    await supabase.from("contacts").insert({
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
    });
  }

  return new Response("OK", { status: 200 });
});