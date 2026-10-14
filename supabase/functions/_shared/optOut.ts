// supabase/functions/_shared/optOut.ts
//
// Cumplimiento TCPA: si alguien responde STOP (o equivalentes en
// español), hay que dejar de mandarle mensajes automáticos y
// confirmárselo. También se soporta la reactivación (START).
//
// Esto NO bloquea que un operador le responda a mano — solo bloquea los
// mensajes 100% automáticos (avisos de TaxiCaller, auto-reply de llamada
// perdida, fuera de horario).
//
// Cambios respecto a la versión anterior:
//  - "cancel" / "cancelar" YA NO dan de baja: los clientes lo escriben
//    para cancelar el viaje, no para darse de baja.
//  - START solo actúa (y solo confirma) si el contacto está dado de baja.
//    Antes cualquier "si"/"yes" mandaba una confirmación de reactivación
//    (3.579 mensajes espurios en 30 días).
//  - La baja es SOLO con la palabra "STOP" sola (mayúsculas/minúsculas
//    y puntuación final no importan: "Stop.", "stop!"). Ninguna otra
//    palabra ni frase da de baja.
//  - "yes" / "si" / "sí" ya no reactivan: son respuestas normales a una
//    conversación ("¿Estás afuera?" → "si"). Reactivan START, UNSTOP,
//    SUBSCRIBE, EMPEZAR, ACTIVAR.
//  - Si el contacto ya estaba de baja y vuelve a escribir STOP, no se le
//    manda otra confirmación.
//  - Los errores al mandar la confirmación quedan en app_errors.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STOP_WORDS = ["stop"];
const START_WORDS = ["start", "unstop", "subscribe", "empezar", "activar"];

function normalizedWord(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!¡¿?]/g, "");
}

async function logError(context: string, message: string, detail: Record<string, unknown>) {
  try {
    await supabase.from("app_errors").insert({
      context,
      message,
      stack: JSON.stringify(detail, null, 2),
    });
  } catch (_) {
    // no hacer fallar el webhook por no poder loguear
  }
}

async function sendConfirmation(
  kind: "baja" | "reactivación",
  contactId: string,
  phone: string,
  text: string,
  channel: "sms" | "whatsapp",
) {
  try {
    if (channel === "whatsapp") await sendWhatsappText(phone, text);
    else await sendSms(phone, text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`No se pudo enviar la confirmación de ${kind}:`, err);
    await logError("optOut", `No se pudo enviar la confirmación de ${kind} por ${channel} a ${phone}: ${msg}`, {
      contactId,
      phone,
      channel,
      kind,
    });
  }
}

/**
 * Revisa si el texto entrante es un pedido de baja o reactivación, y si
 * lo es (y corresponde actuar), actualiza el contacto y manda la
 * confirmación. Devuelve true si el mensaje fue un comando de opt-out/in
 * que se procesó.
 */
export async function handleOptOutKeyword(
  contactId: string,
  phone: string,
  text: string,
  channel: "sms" | "whatsapp",
): Promise<boolean> {
  const word = normalizedWord(text);
  const isStop = STOP_WORDS.includes(word);
  const isStart = START_WORDS.includes(word);
  if (!isStop && !isStart) return false;

  const { data: contact, error: readErr } = await supabase
    .from("contacts")
    .select("do_not_contact")
    .eq("id", contactId)
    .maybeSingle();

  if (readErr) {
    await logError("optOut", `No se pudo leer el contacto para procesar "${word}": ${readErr.message}`, {
      contactId,
      phone,
      channel,
    });
    return false;
  }

  const currentlyOptedOut = contact?.do_not_contact === true;

  if (isStop) {
    // Ya estaba de baja: no hace falta tocar nada ni volver a confirmar.
    if (currentlyOptedOut) return true;

    const { error } = await supabase
      .from("contacts")
      .update({ do_not_contact: true, opted_out_at: new Date().toISOString() })
      .eq("id", contactId);

    if (error) {
      await logError("optOut", `No se pudo marcar la baja de ${phone}: ${error.message}`, { contactId, phone, channel });
      return false;
    }

    await sendConfirmation(
      "baja",
      contactId,
      phone,
      "Has sido dado de baja y no recibirás más mensajes automáticos de Taxi Laser. Respondé START para volver a activarlos.",
      channel,
    );
    return true;
  }

  // START: solo tiene sentido si estaba de baja.
  if (!currentlyOptedOut) return false;

  const { error } = await supabase
    .from("contacts")
    .update({ do_not_contact: false, opted_out_at: null })
    .eq("id", contactId);

  if (error) {
    await logError("optOut", `No se pudo reactivar a ${phone}: ${error.message}`, { contactId, phone, channel });
    return false;
  }

  await sendConfirmation(
    "reactivación",
    contactId,
    phone,
    "Listo, volvés a recibir mensajes automáticos de Taxi Laser. Respondé STOP en cualquier momento para darte de baja.",
    channel,
  );
  return true;
}

/** Chequeo simple para usar antes de mandar cualquier mensaje automático. */
export async function isOptedOut(contactId: string): Promise<boolean> {
  const { data } = await supabase.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
  return data?.do_not_contact === true;
}
