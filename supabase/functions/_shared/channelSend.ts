// supabase/functions/_shared/channelSend.ts
//
// Envío de texto por WhatsApp y por Messenger/Instagram, sacado a un
// módulo aparte porque lo usan varias automatizaciones (mensajes
// automáticos de TaxiCaller, auto-reply de llamada perdida) y no
// queremos tener la misma llamada a la Graph API copiada en cada una.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "./settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GRAPH_VERSION = "v26.0";

export async function sendWhatsappText(phone: string, text: string) {
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

export async function sendMetaChannelText(channel: "facebook" | "instagram", contactId: string, text: string) {
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
