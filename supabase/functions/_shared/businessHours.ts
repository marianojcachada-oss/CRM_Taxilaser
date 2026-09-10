// supabase/functions/_shared/businessHours.ts
//
// Horario de atención configurable desde Integrations:
//   BUSINESS_HOURS_ENABLED       "true"/"false" — apagado por defecto
//   BUSINESS_HOURS_START         "08:00" (24hs)
//   BUSINESS_HOURS_END           "22:00" (24hs)
//   BUSINESS_HOURS_TIMEZONE      ej: "America/New_York" (default)
//   BUSINESS_HOURS_MESSAGE       texto del aviso automático
//
// Si alguien escribe fuera de ese rango, se le manda el aviso UNA vez
// (cooldown de 6 horas por contacto, para no repetirlo en cada mensaje
// si sigue escribiendo de madrugada).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "./settings.ts";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

const DEFAULT_MESSAGE =
  "Gracias por escribirnos a Taxi Laser. En este momento estamos fuera de nuestro horario de atención — te vamos a responder apenas abramos.";

async function isWithinBusinessHours(): Promise<boolean> {
  const start = (await getSetting("BUSINESS_HOURS_START")) || "08:00";
  const end = (await getSetting("BUSINESS_HOURS_END")) || "22:00";
  const timezone = (await getSetting("BUSINESS_HOURS_TIMEZONE")) || "America/New_York";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const nowHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const nowMinute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  const nowTotal = nowHour * 60 + nowMinute;

  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (startTotal <= endTotal) {
    return nowTotal >= startTotal && nowTotal < endTotal;
  }
  // Rango que cruza la medianoche (ej: 22:00 a 06:00)
  return nowTotal >= startTotal || nowTotal < endTotal;
}

export async function maybeSendOutOfHoursNotice(
  contactId: string,
  phone: string,
  channel: "sms" | "whatsapp",
): Promise<void> {
  const enabled = await getSetting("BUSINESS_HOURS_ENABLED");
  if (enabled !== "true") return; // apagado por defecto

  if (await isWithinBusinessHours()) return;

  const { data: contact } = await supabase
    .from("contacts")
    .select("last_out_of_hours_notice_at, do_not_contact")
    .eq("id", contactId)
    .maybeSingle();

  if (contact?.do_not_contact) return; // respeta el opt-out también acá

  if (contact?.last_out_of_hours_notice_at) {
    const elapsed = Date.now() - new Date(contact.last_out_of_hours_notice_at).getTime();
    if (elapsed < COOLDOWN_MS) return;
  }

  const message = (await getSetting("BUSINESS_HOURS_MESSAGE")) || DEFAULT_MESSAGE;

  try {
    if (channel === "whatsapp") await sendWhatsappText(phone, message);
    else await sendSms(phone, message);
  } catch (err) {
    console.error("No se pudo mandar el aviso de fuera de horario:", err);
    return;
  }

  await supabase.from("contacts").update({ last_out_of_hours_notice_at: new Date().toISOString() }).eq("id", contactId);
}
