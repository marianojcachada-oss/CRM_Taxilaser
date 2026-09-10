// supabase/functions/_shared/automatedMessage.ts
//
// Los mensajes automáticos (cancelación, servicio finalizado) hasta
// ahora siempre salían por SMS. Esto los manda por cada canal que el
// operador haya marcado como preferido para ese cliente en concreto
// (contacts.preferred_channels, multicheck) — y si no marcó ninguno,
// mantiene el comportamiento de siempre: solo SMS.
//
// Manda por todos los canales elegidos en paralelo, y no corta si uno
// falla — si el cliente eligió whatsapp + sms y whatsapp falla (por
// ejemplo por estar fuera de la ventana de 24hs sin template), el SMS
// tiene que salir igual.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText, sendMetaChannelText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);


/**
 * Manda `text` a un cliente por cada canal que haya elegido para
 * mensajes automáticos. `phone` se usa para SMS y WhatsApp; `contactId`
 * para buscar el ID de Messenger/Instagram si hace falta.
 */
export async function sendAutomatedMessage(opts: {
  contactId: string;
  phone: string;
  text: string;
}): Promise<{ sentVia: string[]; errors: { channel: string; error: string }[] }> {
  const { contactId, phone, text } = opts;

  const { data: contact } = await supabase
    .from("contacts")
    .select("preferred_channels, do_not_contact")
    .eq("id", contactId)
    .maybeSingle();

  // Cumplimiento STOP: si pidió baja, no se le manda ningún mensaje
  // automático — ni por SMS ni por WhatsApp.
  if (contact?.do_not_contact) {
    return { sentVia: [], errors: [{ channel: "*", error: "Contacto dado de baja (STOP) — no se manda nada" }] };
  }

  const channels: string[] =
    contact?.preferred_channels && contact.preferred_channels.length > 0
      ? contact.preferred_channels
      : ["sms"]; // sin preferencia cargada -> comportamiento de siempre

  const sentVia: string[] = [];
  const errors: { channel: string; error: string }[] = [];

  await Promise.all(
    channels.map(async (channel) => {
      try {
        if (channel === "sms") {
          await sendSms(phone, text);
        } else if (channel === "whatsapp") {
          await sendWhatsappText(phone, text);
        } else if (channel === "facebook" || channel === "instagram") {
          await sendMetaChannelText(channel, contactId, text);
        } else {
          throw new Error(`Canal desconocido: ${channel}`);
        }
        sentVia.push(channel);
      } catch (err) {
        errors.push({ channel, error: err instanceof Error ? err.message : String(err) });
        console.error(`No se pudo mandar el mensaje automático por ${channel}:`, err);
      }
    }),
  );

  return { sentVia, errors };
}
