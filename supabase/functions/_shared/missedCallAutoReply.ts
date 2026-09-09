// supabase/functions/_shared/missedCallAutoReply.ts
//
// Cuando entra una llamada perdida (WhatsApp o RingCentral):
//   1. Se fija si esta automatización está activada para ese canal
//      (la prende/apaga un admin desde Integrations — por defecto está
//      apagada, no manda nada solo porque exista una llamada perdida).
//   2. Respeta un cooldown de 30 minutos por número + canal, para no
//      mandar el mensaje de nuevo si la misma persona llama varias
//      veces seguidas.
//   3. Busca un operador disponible (presence = 'available', el de
//      menor carga activa) y le asigna la conversación directamente —
//      no espera a que el round robin normal la reparta.
//   4. Manda el mensaje preseteado con {{codigo}} reemplazado por el
//      código de ese operador, y deja la conversación pineada con él
//      (igual que si la hubiera respondido él mismo).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSetting } from "./settings.ts";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const COOLDOWN_MS = 30 * 60 * 1000;

const MESSAGE_TEMPLATE =
  "Te comunicaste con Taxi Laser, vemos que tenemos una llamada perdida de tu número, en este momento habla con {{codigo}}. ¿Cómo le puedo ayudar?";

export async function handleMissedCallAutoReply(rawPhone: string, source: "whatsapp" | "ringcentral") {
  const phone = rawPhone.trim();
  if (!phone) return;

  const settingKey =
    source === "whatsapp" ? "MISSED_CALL_AUTO_REPLY_WHATSAPP_ENABLED" : "MISSED_CALL_AUTO_REPLY_RINGCENTRAL_ENABLED";
  const enabled = await getSetting(settingKey);
  if (enabled !== "true") return; // apagado por defecto, hasta que un admin lo prenda

  // Cooldown: 30 min por número + canal, contados desde el último auto-reply mandado.
  const { data: lastReply } = await supabase
    .from("missed_call_auto_replies")
    .select("sent_at")
    .eq("phone", phone)
    .eq("channel", source)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastReply && Date.now() - new Date(lastReply.sent_at).getTime() < COOLDOWN_MS) {
    return; // ya se le mandó uno hace menos de 30 min, no se repite
  }

  // Operador disponible con menos carga activa ahora mismo.
  const { data: operator } = await supabase
    .from("operators")
    .select("id, operator_code, full_name, current_load")
    .eq("presence", "available")
    .eq("is_active", true)
    .order("current_load", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!operator) {
    console.warn(`Llamada perdida de ${phone} (${source}): no hay ningún operador disponible ahora mismo.`);
    return;
  }

  const codigo = operator.operator_code || operator.full_name;
  const text = MESSAGE_TEMPLATE.replace("{{codigo}}", codigo);
  const conversationChannel = source === "whatsapp" ? "whatsapp" : "sms";

  // Buscar o crear el contacto.
  const { data: existingContact } = await supabase.from("contacts").select("id").eq("phone", phone).maybeSingle();
  let contactId = existingContact?.id;

  if (!contactId) {
    const { data: newContact, error } = await supabase.from("contacts").insert({ phone }).select("id").single();
    if (error) throw error;
    contactId = newContact.id;
  }

  const { data: existingChannel } = await supabase
    .from("contact_channels")
    .select("id")
    .eq("channel", conversationChannel)
    .eq("external_id", phone)
    .maybeSingle();

  if (!existingChannel) {
    await supabase.from("contact_channels").insert({
      contact_id: contactId,
      channel: conversationChannel,
      external_id: phone,
    });
  }

  // Conversación de ese canal más reciente (se reabre si estaba cerrada), o una nueva.
  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id, status")
    .eq("contact_id", contactId)
    .eq("channel", conversationChannel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id;

  if (conversationId) {
    await supabase
      .from("conversations")
      .update({
        status: "esperando_cliente",
        unread: false,
        assigned_operator_id: operator.id,
        keep_with_operator: true,
      })
      .eq("id", conversationId);
  } else {
    const { data: newConversation, error } = await supabase
      .from("conversations")
      .insert({
        contact_id: contactId,
        channel: conversationChannel,
        queue_id: null,
        unread: false,
        external_thread_id: phone,
        assigned_operator_id: operator.id,
        keep_with_operator: true,
        status: "esperando_cliente",
      })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = newConversation.id;
  }

  // El round robin normal descuenta/suma carga en sus propios triggers al
  // asignar por su cuenta — acá estamos asignando "a mano" y de una, así
  // que sumamos la carga nosotros mismos para que quede contabilizada.
  await supabase
    .from("operators")
    .update({ current_load: (operator.current_load ?? 0) + 1 })
    .eq("id", operator.id);

  try {
    if (conversationChannel === "whatsapp") {
      await sendWhatsappText(phone, text);
    } else {
      await sendSms(phone, text);
    }
  } catch (err) {
    console.error(`No se pudo mandar el auto-reply de llamada perdida (${source}):`, err);
    return; // si no salió el mensaje, no registramos el cooldown ni el log
  }

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "operator",
    content: text,
    sent_via_channel: conversationChannel,
    automation_type: "missed_call_auto_reply",
  });

  await supabase.from("missed_call_auto_replies").insert({ phone, channel: source });

  await supabase.from("contact_timeline").insert({
    contact_id: contactId,
    conversation_id: conversationId,
    event_type: "missed_call_auto_reply",
    description: `Llamada perdida por ${source} — auto-reply enviado y chat asignado a ${operator.full_name}`,
  });
}
