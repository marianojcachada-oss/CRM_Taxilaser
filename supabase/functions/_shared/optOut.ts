// supabase/functions/_shared/optOut.ts
//
// Cumplimiento TCPA: si alguien responde STOP (o equivalentes en
// español), hay que dejar de mandarle mensajes automáticos y
// confirmárselo — es obligatorio, no opcional. También se soporta la
// reactivación (START / equivalentes), que también es buena práctica
// aunque no siempre obligatoria.
//
// Esto NO bloquea que un operador le responda a mano si hace falta
// (por ejemplo, para confirmar la baja o resolver algo puntual) — solo
// bloquea los mensajes 100% automáticos (avisos de TaxiCaller, auto-reply
// de llamada perdida, fuera de horario).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSms } from "./ringcentral.ts";
import { sendWhatsappText } from "./channelSend.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "baja", "cancelar", "parar"];
const START_WORDS = ["start", "unstop", "subscribe", "yes", "si", "sí", "empezar", "activar"];

function normalizedWord(text: string): string {
  return text.trim().toLowerCase().replace(/[.,!¡¿?]/g, "");
}

/**
 * Revisa si el texto entrante es un pedido de baja o reactivación, y si
 * lo es, actualiza el contacto y manda la confirmación correspondiente.
 * Devuelve true si el mensaje era un comando de opt-out/in (para que el
 * que llama pueda decidir si igual quiere procesar el resto del flujo
 * normal, como asignarlo a un operador).
 */
export async function handleOptOutKeyword(
  contactId: string,
  phone: string,
  text: string,
  channel: "sms" | "whatsapp",
): Promise<boolean> {
  const word = normalizedWord(text);

  if (STOP_WORDS.includes(word)) {
    await supabase
      .from("contacts")
      .update({ do_not_contact: true, opted_out_at: new Date().toISOString() })
      .eq("id", contactId);

    const confirmation =
      "Has sido dado de baja y no recibirás más mensajes automáticos de Taxi Laser. Respondé START para volver a activarlos.";

    try {
      if (channel === "whatsapp") await sendWhatsappText(phone, confirmation);
      else await sendSms(phone, confirmation);
    } catch (err) {
      console.error("No se pudo enviar la confirmación de baja:", err);
    }

    return true;
  }

  if (START_WORDS.includes(word)) {
    await supabase.from("contacts").update({ do_not_contact: false, opted_out_at: null }).eq("id", contactId);

    const confirmation = "Listo, volvés a recibir mensajes automáticos de Taxi Laser. Respondé STOP en cualquier momento para darte de baja.";

    try {
      if (channel === "whatsapp") await sendWhatsappText(phone, confirmation);
      else await sendSms(phone, confirmation);
    } catch (err) {
      console.error("No se pudo enviar la confirmación de reactivación:", err);
    }

    return true;
  }

  return false;
}

/** Chequeo simple para usar antes de mandar cualquier mensaje automático. */
export async function isOptedOut(contactId: string): Promise<boolean> {
  const { data } = await supabase.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
  return data?.do_not_contact === true;
}
