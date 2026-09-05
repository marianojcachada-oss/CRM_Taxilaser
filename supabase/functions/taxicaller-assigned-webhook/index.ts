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
//   "vehicle_make": "[vehicle.tags.make]",
//   "eta_minutes": "[job.route.pickup.eta]"
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "../_shared/settings.ts";
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
  const expectedSecret = await getSetting("TAXICALLER_WEBHOOK_SECRET");
  const receivedSecret = req.headers.get("X-Webhook-Secret");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), { status: 401 });
  }

  const enabled = await getSetting("TAXICALLER_ASSIGNED_TRACKING_ENABLED");
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
  // job.route.pickup.eta puede venir en distintos formatos según cómo lo
  // maneje TaxiCaller — nos quedamos solo con los dígitos, por las dudas.
  const etaMinutes = parseEtaTimeToMinutes(String(body.eta_minutes ?? ""));

  const { data: existingContact } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();

  if (existingContact) {
    await supabase
      .from("contacts")
      .update({
        has_active_ride: true,
        active_ride_unit: body.vehicle_make || null,
        active_ride_eta_minutes: etaMinutes,
        active_ride_eta_received_at: new Date().toISOString(),
      })
      .eq("id", existingContact.id);
  } else {
    await supabase.from("contacts").insert({
      phone,
      has_active_ride: true,
      active_ride_unit: body.vehicle_make || null,
      active_ride_eta_minutes: etaMinutes,
      active_ride_eta_received_at: new Date().toISOString(),
    });
  }

  return new Response("OK", { status: 200 });
});