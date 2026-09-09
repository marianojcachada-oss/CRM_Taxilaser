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
import { getSettings } from "./settings.ts";
import { sendSms } from "./ringcentral.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GRAPH_VERSION = "v26.0";

async function sendWhatsappText(phone: string, text: string) {
  const settings = await getSettings(["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID"]);
  if (!settings.META_ACCESS_TOKEN || !settings.META_PHONE_NUMBER_ID) {
    throw new Error("Falta META_ACCESS_TOKEN o META_PHONE_NUMBER_ID en Integrations");
  }
  const toNumber = phone.replace(/[^\d]/g, "");

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${settings.META_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.META_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Meta (WhatsApp) rechazó el envío: ${JSON.stringify(errData)}`);
  }
}

async function sendMetaChannelText(channel: "facebook" | "instagram", contactId: string, text: string) {
  const { data: contactChannel } = await supabase
    .from("contact_channels")
    .select("external_id")
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .maybeSingle();

  if (!contactChannel?.external_id) {
    throw new Error(`El cliente no tiene una conversación de ${channel} conocida — no hay a quién mandarle.`);
  }

  const settings = await getSettings(["META_ACCESS_TOKEN"]);
  if (!settings.META_ACCESS_TOKEN) throw new Error("Falta META_ACCESS_TOKEN en Integrations");

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.META_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      recipient: { id: contactChannel.external_id },
      message: { text },
      messaging_type: "MESSAGE_TAG",
      tag: "CONFIRMED_EVENT_UPDATE",
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Meta (${channel}) rechazó el envío: ${JSON.stringify(errData)}`);
  }
}

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
    .select("preferred_channels")
    .eq("id", contactId)
    .maybeSingle();

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
