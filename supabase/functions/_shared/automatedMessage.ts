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
import { getSettings } from "./settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Ventana de atención al cliente de WhatsApp (24 hs desde su último mensaje).
// Se usa un margen de 1 minuto para no apurar el límite justo.
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000 - 60 * 1000;

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
  // true SOLO para los avisos de TaxiCaller (llegó / cancelado / terminado):
  // únicos que obedecen el selector "Avisos automáticos" de Integrations
  // (AUTOMATED_MESSAGES_MODE). Las respuestas de la IA no lo pasan, así que
  // siguen contestando por donde escribió el cliente, sin importar el modo.
  notice?: boolean;
}): Promise<{
  sentVia: string[];
  errors: { channel: string; error: string }[];
  // IDs que devuelven RingCentral/Meta al mandar — sin guardar esto en
  // el mensaje, los webhooks de estado de entrega no tienen forma de
  // encontrarlo después para marcarlo como "entregado".
  wamid: string | null;
  rcMessageId: string | null;
}> {
  const { contactId, phone, text, notice = false } = opts;

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

  // Selector de 4 modos para los avisos de TaxiCaller (Integrations):
  //   "sms"          -> siempre por SMS (RingCentral)
  //   "whatsapp"     -> siempre por WhatsApp, nada por SMS
  //   "last_channel" -> por donde escribió el cliente la última vez
  //                     (comportamiento de siempre, más Facebook/Instagram
  //                     si el contacto los tiene tildados)
  //   "none"         -> no se manda ningún aviso automático
  // Si todavía no se eligió ninguno, se deduce de los dos interruptores
  // viejos (AUTOMATED_MESSAGES_*_ENABLED) para que nada cambie solo.
  let mode: "sms" | "whatsapp" | "last_channel" | "none" = "last_channel";
  if (notice) {
    const modeSettings = await getSettings([
      "AUTOMATED_MESSAGES_MODE",
      "AUTOMATED_MESSAGES_RINGCENTRAL_ENABLED",
      "AUTOMATED_MESSAGES_WHATSAPP_ENABLED",
    ]);
    const saved = modeSettings.AUTOMATED_MESSAGES_MODE;
    if (saved === "sms" || saved === "whatsapp" || saved === "last_channel" || saved === "none") {
      mode = saved;
    } else {
      const smsOff = modeSettings.AUTOMATED_MESSAGES_RINGCENTRAL_ENABLED === "false";
      const waOff = modeSettings.AUTOMATED_MESSAGES_WHATSAPP_ENABLED === "false";
      mode = smsOff && waOff ? "none" : smsOff ? "whatsapp" : waOff ? "sms" : "last_channel";
    }
  }

  if (mode === "none") {
    console.log(`sendAutomatedMessage: avisos automáticos desactivados desde Integrations (contacto ${contactId}).`);
    return { sentVia: [], errors: [], wamid: null, rcMessageId: null };
  }

  // SMS y WhatsApp comparten una misma conversación por cliente (ver
  // find_or_create_sms_whatsapp_conversation), así que el canal se
  // decide mirando por cuál escribió la ÚLTIMA vez — no un checkbox
  // guardado aparte que puede quedar desactualizado.
  let smsWhatsappChannel: "sms" | "whatsapp" | null = null;

  const { data: conv } =
    mode === "last_channel"
      ? await supabase
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

  if (mode === "last_channel" && conv?.id) {
    const { data: lastMsg } = await supabase
      .from("messages")
      .select("sent_via_channel, created_at")
      .eq("conversation_id", conv.id)
      .eq("sender_type", "contact")
      .in("sent_via_channel", ["sms", "whatsapp"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg?.sent_via_channel === "sms" || lastMsg?.sent_via_channel === "whatsapp") {
      smsWhatsappChannel = lastMsg.sent_via_channel;

      // Ventana de 24 hs de WhatsApp: Meta solo deja mandar texto libre
      // (sin plantilla) hasta 24 hs después del último mensaje del cliente.
      // Si el último mensaje del cliente fue por WhatsApp y ya pasó ese
      // plazo, el aviso por WhatsApp fallaría — se manda por SMS. Apenas el
      // cliente vuelva a escribir por WhatsApp, ese mensaje pasa a ser el
      // último y los avisos vuelven a ir por WhatsApp solos.
      if (smsWhatsappChannel === "whatsapp") {
        const ageMs = Date.now() - new Date(lastMsg.created_at).getTime();
        if (Number.isFinite(ageMs) && ageMs > WHATSAPP_WINDOW_MS) {
          console.log(
            `sendAutomatedMessage: último mensaje de WhatsApp de ${contactId} fue hace más de 24 hs — se manda por SMS.`,
          );
          smsWhatsappChannel = "sms";
        }
      }
    }
  }

  // Facebook/Instagram no comparten conversación con nada, ahí sigue
  // valiendo el checkbox manual tal como estaba.
  const metaChannels = (contact?.preferred_channels ?? []).filter(
    (c: string) => c === "facebook" || c === "instagram",
  );

  const channels: string[] =
    mode === "sms"
      ? ["sms"]
      : mode === "whatsapp"
        ? ["whatsapp"]
        : [
            smsWhatsappChannel ?? "sms", // sin historial todavía -> comportamiento de siempre
            ...metaChannels,
          ];

  const sentVia: string[] = [];
  const errors: { channel: string; error: string }[] = [];
  let wamid: string | null = null;
  let rcMessageId: string | null = null;

  await Promise.all(
    channels.map(async (channel) => {
      try {
        if (channel === "sms") {
          const result = await sendSms(phone, text);
          rcMessageId = result.id;
        } else if (channel === "whatsapp") {
          const result = await sendWhatsappText(phone, text);
          wamid = result.wamid;
        } else if (channel === "facebook" || channel === "instagram") {
          await sendMetaChannelText(channel, contactId, text);
        } else {
          throw new Error(`Canal desconocido: ${channel}`);
        }
        sentVia.push(channel);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        errors.push({ channel, error: errorMessage });
        console.error(`No se pudo mandar el mensaje automático por ${channel}:`, err);

        // Antes esto solo quedaba en los logs de la Edge Function (nadie
        // los mira en el momento) — se deja también en app_errors para
        // que aparezca en el panel de administración, que es donde se
        // puede notar de verdad que un aviso automático no llegó.
        await supabase.from("app_errors").insert({
          context: "sendAutomatedMessage",
          message: `No se pudo mandar el mensaje automático por ${channel} a ${phone}: ${errorMessage}`,
          stack: JSON.stringify({ contactId, phone, channel, text }, null, 2),
        });
      }
    }),
  );

  return { sentVia, errors, wamid, rcMessageId };
}