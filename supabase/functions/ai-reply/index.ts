// supabase/functions/ai-reply/index.ts
//
// ENTRADA desde Neuralpreneur: es el endpoint al que la IA llama para
// (a) mandar la respuesta al cliente, o (b) pedir que un humano tome la
// conversación (escalar).
//
//   POST {SUPABASE_URL}/functions/v1/ai-reply
//   Authorization: Bearer <NEURAL_API_KEY>          (o header X-API-Key)
//   Content-Type: application/json
//
//   Responder:
//   { "conversation_id": "uuid"  (o "phone": "+14045551234"),
//     "text": "Hola, ...",
//     "idempotency_key": "abc-123",     // recomendado: reintentos seguros
//     "in_reply_to": "<message.id>" }   // opcional: elige el canal de ese mensaje
//
//   Escalar a un humano:
//   { "action": "escalate", "conversation_id": "uuid", "reason": "pidió hablar con una persona" }
//
// Respuestas:
//   200 { ok: true, status: "sent" | "escalated" | "duplicate", ... }
//   4xx/5xx { ok: false, error: { code, message } }   (códigos en la especificación)
//
// Reglas que se aplican ACÁ (no solo en el webhook de salida), porque entre
// que se mandó el webhook y llega la respuesta puede haber entrado un humano:
//  - IA apagada, modo prueba, canal habilitado, contacto bloqueado/baja.
//  - Si un operador ya respondió o la conversación está pausada -> 409 (el humano manda).

import {
  blockedByTestMode,
  enabledChannels,
  getHumanState,
  handoffToOperator,
  intSetting,
  jsonResponse,
  loadNeuralSettings,
  logEvent,
  neuralMode,
  safeEqual,
  supabase,
} from "../_shared/neural.ts";
import { sendSms } from "../_shared/ringcentral.ts";
import { sendWhatsappText, sendMetaChannelText } from "../_shared/channelSend.ts";
import { normalizePhone } from "../_shared/phone.ts";

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return jsonResponse({ ok: false, error: { code, message } }, status, extra);
}

const MAX_TEXT = 4000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Usá POST.");

  const s = await loadNeuralSettings();

  // --- Autenticación -------------------------------------------------
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("X-API-Key") ?? "";
  if (!s.NEURAL_API_KEY || !bearer || !safeEqual(bearer, s.NEURAL_API_KEY)) {
    return fail(401, "unauthorized", "API key inválida o ausente.");
  }

  // --- Límite por minuto ---------------------------------------------
  const limit = intSetting(s.NEURAL_RATE_LIMIT_PER_MIN, 120);
  if (limit > 0) {
    const { count } = await supabase
      .from("ai_dispatch_log")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .gt("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= limit) {
      return fail(429, "rate_limited", `Máximo ${limit} pedidos por minuto.`, { "Retry-After": "30" });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail(400, "bad_request", "El cuerpo debe ser JSON.");

  const action: string = body.action ?? "reply";
  if (action !== "reply" && action !== "escalate") return fail(400, "bad_request", 'action debe ser "reply" o "escalate".');
  if (action === "reply") {
    if (typeof body.text !== "string" || !body.text.trim()) return fail(400, "bad_request", "Falta text.");
    if (body.text.length > MAX_TEXT) return fail(400, "bad_request", `text supera ${MAX_TEXT} caracteres.`);
  }

  // --- Modo -----------------------------------------------------------
  if (neuralMode(s) === "off") return fail(409, "mode_off", "La IA está apagada en Qué tal?.");

  // --- Idempotencia ---------------------------------------------------
  const idem = typeof body.idempotency_key === "string" && body.idempotency_key ? body.idempotency_key.slice(0, 120) : null;

  // --- Conversación ---------------------------------------------------
  let conversationId: string | null = body.conversation_id ? String(body.conversation_id) : null;
  let contact: any = null;

  if (!conversationId && body.phone) {
    const phone = normalizePhone(String(body.phone));
    const { data: c } = await supabase.from("contacts").select("*").eq("phone", phone).maybeSingle();
    if (c) {
      contact = c;
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", (c as any).id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      conversationId = (conv as any)?.id ? String((conv as any).id) : null;
    }
  }
  if (!conversationId) return fail(404, "conversation_not_found", "No se encontró la conversación (conversation_id o phone).");

  const { data: conv } = await supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv) return fail(404, "conversation_not_found", "No se encontró la conversación.");
  if (!contact) {
    const { data: c } = await supabase.from("contacts").select("*").eq("id", (conv as any).contact_id).maybeSingle();
    contact = c;
  }
  if (!contact) return fail(404, "conversation_not_found", "La conversación no tiene contacto.");

  if (contact.blocked || contact.do_not_contact) {
    await logEvent({ direction: "in", status: "rejected", reason: "contact_blocked", conversation_id: conversationId });
    return fail(403, "contact_blocked", "Contacto bloqueado o dado de baja: no se le manda nada.");
  }
  if (blockedByTestMode(s, contact.phone)) {
    await logEvent({ direction: "in", status: "rejected", reason: "test_mode_blocked", conversation_id: conversationId });
    return fail(403, "test_mode_blocked", "Modo prueba activo: este número no está en la lista de prueba.");
  }

  if (idem) {
    const first = await logEvent({ direction: "in", status: "pending", dedupe_key: `in:${idem}`, conversation_id: conversationId, reason: action });
    if (first.duplicate) return jsonResponse({ ok: true, status: "duplicate", message: "Ya procesado con esa idempotency_key." });
  }
  const finish = async (status: string, reason: string | null, http: number, detail?: unknown) => {
    if (idem) {
      await supabase.from("ai_dispatch_log").update({ status, reason, http_status: http, detail: detail ?? null }).eq("dedupe_key", `in:${idem}`);
    } else {
      await logEvent({ direction: "in", status, reason, conversation_id: conversationId, http_status: http, detail });
    }
  };

  // --- Escalar a humano -----------------------------------------------
  if (action === "escalate") {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("conversations")
      .update({ ai_paused: true, ai_escalated_at: now, status: "esperando_operador", unread: true })
      .eq("id", conversationId);
    if (error) {
      await finish("failed", "escalate_failed", 500, { error: error.message });
      return fail(500, "internal_error", "No se pudo escalar: " + error.message);
    }
    await finish("escalated", typeof body.reason === "string" ? body.reason.slice(0, 300) : null, 200);
    return jsonResponse({ ok: true, status: "escalated", conversation_id: conversationId });
  }

  // --- Responder: el humano manda -------------------------------------
  const human = await getHumanState(conversationId);
  if (human.paused) {
    await finish("rejected", "ai_paused", 409);
    return fail(409, "ai_paused", "La conversación está pausada o escalada a un humano: la IA no puede responder.");
  }
  if (human.humanReplied) {
    await finish("rejected", "human_active", 409);
    return fail(409, "human_active", "Un operador ya respondió en esta conversación: la IA no puede responder.");
  }
  const maxAuto = intSetting(s.NEURAL_MAX_AUTO_REPLIES, 5);
  if (maxAuto > 0 && human.aiRepliesSinceHuman >= maxAuto) {
    await finish("rejected", "max_auto_replies", 409);
    return fail(409, "max_auto_replies", `Se alcanzó el máximo de ${maxAuto} respuestas seguidas de la IA. Escalá a un humano.`);
  }

  // --- Canal ----------------------------------------------------------
  let channel = "";
  if (body.in_reply_to) {
    const { data: m } = await supabase.from("messages").select("sent_via_channel").eq("id", String(body.in_reply_to)).eq("conversation_id", conversationId).maybeSingle();
    channel = String((m as any)?.sent_via_channel ?? "").toLowerCase();
  }
  if (!channel) {
    const { data: m } = await supabase
      .from("messages")
      .select("sent_via_channel")
      .eq("conversation_id", conversationId)
      .eq("sender_type", "contact")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    channel = String((m as any)?.sent_via_channel ?? "").toLowerCase();
  }
  if (!channel || !enabledChannels(s).includes(channel)) {
    await finish("rejected", "channel_disabled", 422, { channel });
    return fail(422, "channel_disabled", `El canal "${channel || "desconocido"}" no está habilitado para la IA.`);
  }

  // --- Enviar ---------------------------------------------------------
  const text = String(body.text).trim();
  let wamid: string | null = null;
  let rcMessageId: string | null = null;
  try {
    if (!contact.phone && (channel === "sms" || channel === "whatsapp")) throw new Error("El contacto no tiene teléfono.");
    if (channel === "sms") rcMessageId = (await sendSms(contact.phone, text)).id;
    else if (channel === "whatsapp") wamid = (await sendWhatsappText(contact.phone, text)).wamid;
    else if (channel === "facebook" || channel === "instagram") await sendMetaChannelText(channel, String(contact.id), text);
    else throw new Error(`Canal no soportado: ${channel}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("app_errors").insert({ context: "ai-reply", message: `No se pudo mandar la respuesta de la IA por ${channel}: ${message}` });
    await finish("failed", "send_failed", 502, { channel, error: message });
    await handoffToOperator(conversationId, `No se pudo enviar la respuesta por ${channel}: ${message}`);
    return fail(502, "send_failed", message);
  }

  // Queda guardada como mensaje automático de IA (igual que ai-respond), así el operador la ve en el chat.
  const { data: saved } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "operator",
      content: text,
      sent_via_channel: channel,
      automation_type: "ai_response",
      wamid,
      rc_message_id: rcMessageId,
      delivery_status: "sent",
    })
    .select("id")
    .maybeSingle();

  await finish("replied", null, 200, { channel, message_id: (saved as any)?.id ?? null });
  return jsonResponse({ ok: true, status: "sent", message_id: (saved as any)?.id ?? null, channel, conversation_id: conversationId });
});
