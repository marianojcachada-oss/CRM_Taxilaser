// supabase/functions/_shared/automatedMessage.ts
//
// Los mensajes automáticos (cancelación, servicio finalizado, etc.) se
// mandan por el canal REAL que el cliente usó la última vez que
// escribió, para SMS y WhatsApp — no por un checkbox manual
// (contacts.preferred_channels) que se puede desincronizar (por
// ejemplo, un contacto que quedó con los dos tildados tras fusionar
// duplicados, o con el que no corresponde). Como SMS y WhatsApp
// comparten una misma conversación para un mismo cliente, esto
// garantiza que nunca le llegue duplicado por los dos canales ni por
// el que no usa.
//
// Facebook/Instagram no comparten conversación con nada, así que ahí
// sí se sigue respetando el check manual de "canal preferido" tal
// como lo dejó el operador en la ficha del contacto.
//
// Manda por todos los canales que correspondan en paralelo, y no
// corta si uno falla — si whatsapp falla (por ejemplo por estar fuera
// de la ventana de 24hs sin template), el intento por el otro canal
// tiene que seguir igual.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText, sendMetaChannelText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);


/**
 * Manda `text` a un cliente: por SMS o WhatsApp (el que haya usado la
 * última vez), más Facebook/Instagram si los tiene tildados a mano.
 * `phone` se usa para SMS y WhatsApp; `contactId` para buscar el
 * historial y el ID de Messenger/Instagram si hace falta.
 */
export async function sendAutomatedMessage(opts: {
  contactId: string;
  phone: string;
  text: string;
}): Promise<{ sentVia: string[]; errors: { channel: string; error: string }[] }> {
  const { contactId, phone, text } = opts;

  const { data: contact } = await supabase
    .from("contacts")
    .select("preferred_channels, do_not_contact, blocked")
    .eq("id", contactId)
    .maybeSingle();

  // Cumplimiento STOP: si pidió baja, no se le manda ningún mensaje
  // automático — ni por SMS ni por WhatsApp.
  if (contact?.do_not_contact) {
    return { sentVia: [], errors: [{ channel: "*", error: "Contacto dado de baja (STOP) — no se manda nada" }] };
  }

  // Bloqueado a mano por un operador desde la ficha del contacto — no se
  // le manda absolutamente nada, ni automático ni (aparte, en
  // send-message) manual.
  if (contact?.blocked) {
    return { sentVia: [], errors: [{ channel: "*", error: "Contacto bloqueado — no se manda nada" }] };
  }

  // SMS y WhatsApp comparten una misma conversación por cliente (ver
  // find_or_create_sms_whatsapp_conversation), así que el canal se
  // decide mirando por cuál escribió la ÚLTIMA vez — no un checkbox
  // guardado aparte que puede quedar desactualizado.
  let smsWhatsappChannel: "sms" | "whatsapp" | null = null;

  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (conv?.id) {
    const { data: lastMsg } = await supabase
      .from("messages")
      .select("sent_via_channel")
      .eq("conversation_id", conv.id)
      .eq("sender_type", "contact")
      .in("sent_via_channel", ["sms", "whatsapp"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg?.sent_via_channel === "sms" || lastMsg?.sent_via_channel === "whatsapp") {
      smsWhatsappChannel = lastMsg.sent_via_channel;
    }
  }

  // Facebook/Instagram no comparten conversación con nada, ahí sigue
  // valiendo el checkbox manual tal como estaba.
  const metaChannels = (contact?.preferred_channels ?? []).filter(
    (c: string) => c === "facebook" || c === "instagram",
  );

  const channels: string[] = [
    smsWhatsappChannel ?? "sms", // sin historial todavía -> comportamiento de siempre
    ...metaChannels,
  ];

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