// supabase/functions/ai-dispatch/index.ts
//
// SALIDA hacia Neuralpreneur: manda un webhook firmado (POST JSON) cada vez
// que entra un mensaje de un cliente y las reglas de la pantalla
// AI (Valeria) dicen que la IA puede contestar.
//
// Quién la llama:
//  - El trigger de la base (neural_notify_inbound) con x-internal-secret
//    cuando NEURAL_MODE = "all"  -> { message_id, trigger: "inbound" }
//  - pg_cron cada minuto (opcional, para NEURAL_DELAY_MINUTES > 0)
//    con x-internal-secret                     -> { sweep: true }
//  - Un operador desde el chat (JWT)            -> { conversationId, force: true }
//    (botón "Pedir respuesta a la IA": modo "solo cuando un humano lo pide")
//  - Un operador desde el chat (JWT)            -> { conversationId, action: "pause" | "resume" }
//  - Un operador desde el chat (JWT)            -> { conversationId, action: "assign_ai" | "release_ai" }
//    (reasignar la conversación a "Valeria (IA)" desde el menú "Asignada a")
//  - El superadmin desde la pantalla (JWT)      -> { test: true }  (evento "ping")
//  - pg_cron cada minuto, con x-internal-secret -> { watchdog: true }
//    (si Neuralpreneur recibió el evento y no contestó a tiempo, la conversación vuelve a los operadores)
//
// Verifica en la función, no en el gateway (verify_jwt = false en config.toml).

import {
  blockedByTestMode,
  clearAiError,
  enabledChannels,
  getHumanState,
  handoffToOperator,
  hmacHex,
  intSetting,
  jsonResponse,
  loadNeuralSettings,
  logEvent,
  neuralMode,
  safeEqual,
  scheduleAllows,
  supabase,
  type NeuralSettings,
} from "../_shared/neural.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Max-Age": "86400",
};

function respond(body: unknown, status = 200) {
  return jsonResponse(body, status, corsHeaders);
}

type Caller = { kind: "internal" } | { kind: "operator"; id: string; isSuperadmin: boolean };

async function authenticate(req: Request, s: NeuralSettings): Promise<Caller | null> {
  const internal = req.headers.get("x-internal-secret");
  if (internal && s.NEURAL_INTERNAL_SECRET && safeEqual(internal, s.NEURAL_INTERNAL_SECRET)) {
    return { kind: "internal" };
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  const { data: op } = await supabase
    .from("operators")
    .select("id, is_superadmin")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (!op) return null;
  return { kind: "operator", id: (op as any).id, isSuperadmin: !!(op as any).is_superadmin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ ok: false, error: "Método no permitido" }, 405);

  const body = await req.json().catch(() => ({}));
  const settings = await loadNeuralSettings();

  const caller = await authenticate(req, settings);
  if (!caller) return respond({ ok: false, error: "No autorizado" }, 401);

  try {
    // --- Estado de una conversación (para el chat) --------------------
    if (body.action === "status") {
      if (caller.kind !== "operator" || !body.conversationId) return respond({ ok: false, error: "Pedido inválido" }, 400);
      const human = await getHumanState(String(body.conversationId));
      const { data: c } = await supabase.from("conversations").select("ai_escalated_at").eq("id", body.conversationId).maybeSingle();
      const { data: cv } = await supabase.from("conversations").select("ai_assigned").eq("id", body.conversationId).maybeSingle();
      // Aviso rojo del chat: por qué la IA no pudo contestar (si las columnas todavía no existen, no hay aviso).
      const { data: er } = await supabase.from("conversations").select("ai_error, ai_error_at").eq("id", body.conversationId).maybeSingle();
      return respond({
        ok: true,
        mode: neuralMode(settings),
        paused: human.paused,
        humanReplied: human.humanReplied,
        escalated: !!(c as any)?.ai_escalated_at && human.paused,
        assigned: !!(cv as any)?.ai_assigned,
        error: (er as any)?.ai_error ? { message: (er as any).ai_error, at: (er as any).ai_error_at ?? null } : null,
      });
    }

    // --- Asignar la conversación a Valeria (IA) / soltarla -------------
    if (body.action === "assign_ai" || body.action === "release_ai") {
      if (caller.kind !== "operator" || !body.conversationId) return respond({ ok: false, error: "Pedido inválido" }, 400);
      const conversationId = String(body.conversationId);

      if (body.action === "release_ai") {
        await supabase.from("conversations").update({ ai_assigned: false }).eq("id", conversationId);
        return respond({ ok: true, assigned: false });
      }

      if (neuralMode(settings) === "off") return respond({ ok: false, error: "La IA está apagada (AI (Valeria) → Modo)." }, 409);
      if (!settings.NEURAL_WEBHOOK_URL) return respond({ ok: false, error: "Falta cargar la URL del webhook en AI (Valeria)." }, 409);

      const { data: cv } = await supabase.from("conversations").select("contact_id").eq("id", conversationId).maybeSingle();
      if (!cv) return respond({ ok: false, error: "Conversación no encontrada" }, 404);
      const { data: ct } = await supabase.from("contacts").select("*").eq("id", (cv as any).contact_id).maybeSingle();
      const contact = (ct ?? {}) as any;
      if (contact.blocked || contact.do_not_contact) return respond({ ok: false, error: "Contacto bloqueado o dado de baja: la IA no le escribe." }, 409);
      if (blockedByTestMode(settings, contact.phone)) {
        return respond({ ok: false, error: "Modo prueba activo: este número no está en la lista de prueba." }, 409);
      }

      // Asignar = invitar a la IA: reactiva y arranca de cero el conteo de "un humano respondió".
      const { error: upErr } = await supabase
        .from("conversations")
        .update({ ai_assigned: true, ai_paused: false, ai_resume_at: new Date().toISOString(), ai_escalated_at: null })
        .eq("id", conversationId);
      if (upErr) return respond({ ok: false, error: upErr.message }, 500);
      await clearAiError(conversationId);

      // Si el último mensaje de la conversación es del cliente (está esperando respuesta), se le manda ya a la IA.
      const { data: latest } = await supabase
        .from("messages")
        .select("id, sender_type")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((latest as any)?.sender_type === "contact") {
        const r = await evaluateAndDispatch(settings, (latest as any).id, "assigned_to_ai", caller.id);
        return respond({ ok: true, assigned: true, dispatched: r.status === "sent", reason: r.reason });
      }
      return respond({ ok: true, assigned: true, dispatched: false, reason: "waiting_next_customer_message" });
    }

    // --- Pausar / reactivar (humano) ---------------------------------
    if (body.action === "pause" || body.action === "resume") {
      if (caller.kind !== "operator" || !body.conversationId) return respond({ ok: false, error: "Pedido inválido" }, 400);
      const patch =
        body.action === "pause"
          ? { ai_paused: true }
          : { ai_paused: false, ai_resume_at: new Date().toISOString(), ai_escalated_at: null };
      const { error } = await supabase.from("conversations").update(patch).eq("id", body.conversationId);
      if (error) return respond({ ok: false, error: error.message }, 500);
      if (body.action === "resume") await clearAiError(String(body.conversationId));
      return respond({ ok: true, paused: body.action === "pause" });
    }

    // --- Prueba de conexión (ping) -----------------------------------
    if (body.test) {
      if (caller.kind !== "operator" || !caller.isSuperadmin) return respond({ ok: false, error: "Solo el superadmin" }, 403);
      if (!settings.NEURAL_WEBHOOK_URL) return respond({ ok: false, error: "Falta la URL del webhook" }, 400);
      const result = await postToNeural(settings, {
        event: "ping",
        event_id: crypto.randomUUID(),
        sent_at: new Date().toISOString(),
        trigger: "test",
        test_mode: settings.NEURAL_TEST_MODE !== "false",
        message: "Evento de prueba de Qué tal?. No hay ninguna conversación real asociada.",
      });
      await logEvent({ direction: "out", status: result.ok ? "sent" : "failed", reason: "ping", http_status: result.status, detail: { error: result.error } });
      return respond({ ok: result.ok, httpStatus: result.status, error: result.error });
    }

    // --- Barrido (esperas en minutos) --------------------------------
    if (body.sweep) {
      if (caller.kind !== "internal") return respond({ ok: false, error: "Solo interno" }, 403);
      if (neuralMode(settings) !== "all") return respond({ ok: true, skipped: "mode_not_all" });
      const delay = intSetting(settings.NEURAL_DELAY_MINUTES, 0);
      if (delay <= 0) return respond({ ok: true, skipped: "no_delay" });

      const { data: pending } = await supabase.rpc("neural_pending_messages", {
        min_age: `${delay} minutes`,
        max_age: "6 hours",
      });
      const results: unknown[] = [];
      for (const row of (pending ?? []) as { message_id: string }[]) {
        results.push(await evaluateAndDispatch(settings, row.message_id, "sweep"));
      }
      // Limpieza: el registro solo guarda 30 días.
      await supabase.from("ai_dispatch_log").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
      return respond({ ok: true, processed: results.length });
    }

    // --- Red de seguridad: Neuralpreneur recibió el evento y no contestó --
    if (body.watchdog) {
      if (caller.kind !== "internal") return respond({ ok: false, error: "Solo interno" }, 403);
      if (neuralMode(settings) === "off") return respond({ ok: true, skipped: "mode_off" });
      const timeout = intSetting(settings.NEURAL_REPLY_TIMEOUT_SECONDS, 60);
      if (timeout <= 0) return respond({ ok: true, skipped: "disabled" });
      const cutoff = new Date(Date.now() - timeout * 1000).toISOString();
      const since = new Date(Date.now() - 6 * 3600_000).toISOString();
      const { data: waiting } = await supabase
        .from("ai_dispatch_log")
        .select("id, conversation_id, created_at")
        .eq("direction", "out")
        .eq("status", "sent")
        .lt("created_at", cutoff)
        .gt("created_at", since)
        .limit(50);
      let handed = 0;
      for (const row of (waiting ?? []) as { id: string; conversation_id: string | null; created_at: string }[]) {
        if (!row.conversation_id) continue; // evento de prueba (ping)
        const mark = (status: string) =>
          supabase.from("ai_dispatch_log").update(status === "no_reply" ? { status, reason: `sin respuesta en ${timeout} s` } : { status }).eq("id", row.id);
        const { data: conv } = await supabase.from("conversations").select("ai_paused").eq("id", row.conversation_id).maybeSingle();
        if ((conv as any)?.ai_paused) { await mark("closed"); continue; } // escalada o pausada: ya la tiene un humano
        const { data: after } = await supabase
          .from("messages")
          .select("automation_type")
          .eq("conversation_id", row.conversation_id)
          .eq("sender_type", "operator")
          .gt("created_at", row.created_at)
          .limit(20);
        const answered = ((after ?? []) as { automation_type: string | null }[]).some((m) => m.automation_type == null || m.automation_type === "ai_response");
        if (answered) { await mark("answered"); continue; }
        await mark("no_reply");
        await handoffToOperator(row.conversation_id, `Neuralpreneur recibió el aviso pero no contestó en ${timeout} segundos.`);
        handed++;
      }
      return respond({ ok: true, checked: (waiting ?? []).length, handed });
    }

    // --- Pedido de un operador ---------------------------------------
    if (body.force) {
      if (caller.kind !== "operator" || !body.conversationId) return respond({ ok: false, error: "Pedido inválido" }, 400);
      if (neuralMode(settings) === "off") return respond({ ok: false, error: "La IA está apagada (AI (Valeria) → Modo)." }, 409);
      const { data: last } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", body.conversationId)
        .eq("sender_type", "contact")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last) return respond({ ok: false, error: "No hay mensajes del cliente para responder." }, 400);
      const r = await evaluateAndDispatch(settings, (last as any).id, "operator_request", caller.id);
      return respond({ ok: r.status === "sent", ...r }, r.status === "sent" ? 200 : 409);
    }

    // --- Mensaje entrante (trigger) ----------------------------------
    if (body.message_id) {
      if (caller.kind !== "internal") return respond({ ok: false, error: "Solo interno" }, 403);
      const r = await evaluateAndDispatch(settings, String(body.message_id), "inbound");
      return respond({ ok: true, ...r });
    }

    return respond({ ok: false, error: "Pedido inválido" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("ai-dispatch:", message);
    await supabase.from("app_errors").insert({ context: "ai-dispatch", message, stack: err instanceof Error ? err.stack : null });
    return respond({ ok: false, error: message }, 500);
  }
});

type Trigger = "inbound" | "sweep" | "operator_request" | "assigned_to_ai";

async function evaluateAndDispatch(
  s: NeuralSettings,
  messageId: string,
  trigger: Trigger,
  requestedBy?: string,
): Promise<{ status: string; reason?: string }> {
  const skip = async (reason: string, conversationId?: string | null) => {
    // Los "no" rutinarios no se guardan uno por uno (serían miles); solo los pedidos de un operador y los fallos.
    if (trigger === "operator_request" || trigger === "assigned_to_ai") {
      await logEvent({ direction: "out", status: "skipped", reason, conversation_id: conversationId ?? null, message_id: messageId });
    }
    return { status: "skipped", reason };
  };

  const mode = neuralMode(s);
  if (mode === "off") return skip("mode_off");
  if (!s.NEURAL_WEBHOOK_URL) return skip("no_webhook_url");

  const { data: msg } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (!msg || (msg as any).sender_type !== "contact") return skip("not_inbound");
  const message = msg as any;
  const conversationId = String(message.conversation_id);

  const { data: conv } = await supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv) return skip("no_conversation", conversationId);
  const conversation = conv as any;

  // Una conversación asignada a Valeria se atiende aunque el modo sea "solo cuando un humano la pide".
  const assignedToAi = conversation.ai_assigned === true;
  if (trigger !== "operator_request" && trigger !== "assigned_to_ai" && mode !== "all" && !assignedToAi) return skip("mode_not_all");

  const { data: ct } = await supabase.from("contacts").select("*").eq("id", conversation.contact_id).maybeSingle();
  const contact = (ct ?? {}) as any;

  if (contact.blocked || contact.do_not_contact) return skip("contact_blocked", conversationId);

  const channel = String(message.sent_via_channel ?? "").toLowerCase();
  if (!enabledChannels(s).includes(channel)) return skip("channel_disabled", conversationId);

  if (blockedByTestMode(s, contact.phone)) return skip("test_mode_not_whitelisted", conversationId);

  // force: pedido a mano o recién asignada -> se saltea horario, espera y "humano activo".
  const force = trigger === "operator_request" || trigger === "assigned_to_ai";
  // Si ya está asignada a Valeria, un mensaje nuevo también se atiende sin esperar ni mirar el horario
  // (pero igual se calla si un humano escribió o se pausó).
  const explicit = force || assignedToAi;

  // Un pedido de un operador es una INVITACIÓN: reactiva la IA en esa conversación
  // (si no, ai-reply la rechazaría con human_active porque el propio operador ya
  // escribió). Si después el humano vuelve a escribir, la IA se vuelve a callar.
  if (force) {
    await supabase
      .from("conversations")
      .update({ ai_paused: false, ai_resume_at: new Date().toISOString(), ai_escalated_at: null })
      .eq("id", conversationId);
    await clearAiError(conversationId);
  }
  const human = await getHumanState(conversationId);

  if (!force) {
    if (human.paused) return skip("paused", conversationId);
    if (human.humanReplied) return skip("human_active", conversationId);
    if (!explicit && !(await scheduleAllows(s))) return skip("in_business_hours", conversationId);

    const maxAuto = intSetting(s.NEURAL_MAX_AUTO_REPLIES, 5);
    if (maxAuto > 0 && human.aiRepliesSinceHuman >= maxAuto) return skip("max_auto_replies", conversationId);

    const delay = intSetting(s.NEURAL_DELAY_MINUTES, 0);
    if (!explicit && trigger === "inbound" && delay > 0) return skip("delayed_for_sweep", conversationId);

    if (trigger === "sweep") {
      // Solo si ese sigue siendo el último mensaje de la conversación (nadie respondió mientras tanto).
      const { data: latest } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((latest as any)?.id !== messageId) return skip("superseded", conversationId);
    }
  }

  // Idempotencia: un mismo mensaje se manda una sola vez (salvo pedido manual).
  const dedupe = force ? `out:${messageId}:req:${Date.now()}` : `out:${messageId}`;
  const claim = await logEvent({ direction: "out", status: "pending", dedupe_key: dedupe, conversation_id: conversationId, message_id: messageId, reason: trigger });
  if (claim.duplicate) return { status: "skipped", reason: "duplicate" };

  const payload = await buildPayload(s, { message, conversation, contact, human, trigger, requestedBy });
  const result = await postToNeural(s, payload);

  // Actualiza la fila del registro con el resultado real.
  await supabase
    .from("ai_dispatch_log")
    .update({
      status: result.ok ? "sent" : "failed",
      http_status: result.status,
      detail: result.ok ? { event_id: payload.event_id } : { event_id: payload.event_id, error: result.error },
    })
    .eq("dedupe_key", dedupe);

  if (!result.ok) {
    // No llegó el aviso a Neuralpreneur: la conversación pasa a los operadores
    // con el motivo a la vista (y queda en el registro de errores).
    await handoffToOperator(conversationId, `Neuralpreneur no recibió el aviso: ${result.error ?? "HTTP " + result.status}`);
    return { status: "failed", reason: result.error ?? `http_${result.status}` };
  }
  return { status: "sent" };
}

async function buildPayload(
  s: NeuralSettings,
  a: { message: any; conversation: any; contact: any; human: Awaited<ReturnType<typeof getHumanState>>; trigger: Trigger; requestedBy?: string },
) {
  const { message, conversation, contact, human, trigger } = a;

  let operator: { id: string; name: string | null } | null = null;
  if (conversation.assigned_operator_id) {
    const { data: op } = await supabase.from("operators").select("id, full_name").eq("id", conversation.assigned_operator_id).maybeSingle();
    operator = { id: String(conversation.assigned_operator_id), name: (op as any)?.full_name ?? null };
  }

  const { data: hist } = await supabase
    .from("messages")
    .select("id, sender_type, content, sent_via_channel, automation_type, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const history = ((hist ?? []) as any[])
    .reverse()
    .filter((m) => m.content && String(m.content).trim())
    .map((m) => ({
      id: String(m.id),
      role:
        m.sender_type === "contact"
          ? "customer"
          : m.automation_type === "ai_response"
            ? "ai"
            : m.automation_type
              ? "system"
              : "agent",
      text: m.content,
      channel: m.sent_via_channel ?? null,
      timestamp: m.created_at,
    }));

  const eventId = crypto.randomUUID();
  return {
    event: "message.inbound",
    event_id: eventId,
    sent_at: new Date().toISOString(),
    trigger, // inbound | sweep | operator_request
    test_mode: s.NEURAL_TEST_MODE !== "false",
    conversation: {
      id: String(conversation.id),
      status: conversation.status ?? null,
      created_at: conversation.created_at ?? null,
      channels_available: conversation.channels_available ?? [],
      assigned_to_ai: conversation.ai_assigned === true,
    },
    contact: {
      id: String(conversation.contact_id),
      phone: contact.phone ?? null,
      name: contact.name ?? contact.full_name ?? null,
      has_active_ride: !!contact.has_active_ride,
      active_ride: contact.has_active_ride
        ? {
            unit: contact.active_ride_unit ?? null,
            color: contact.active_ride_color ?? null,
            plate: contact.active_ride_plate ?? null,
            eta_minutes: contact.active_ride_eta_minutes ?? null,
            status: contact.active_ride_status ?? null,
          }
        : null,
    },
    message: {
      id: String(message.id),
      text: message.content ?? "",
      channel: message.sent_via_channel ?? null, // whatsapp | sms | facebook | instagram
      direction: "inbound",
      timestamp: message.created_at,
      has_attachment: !!(message.attachment_url ?? null),
      attachment_kind: message.attachment_kind ?? null,
    },
    human: {
      // OJO: "assigned" es solo el reparto automático; lo que importa es has_replied.
      assigned: !!operator,
      assigned_operator: operator,
      has_replied: human.humanReplied,
      last_human_reply_at: human.lastHumanReplyAt,
      ai_paused: human.paused,
      // Si es true, la IA NO debe contestar (el humano manda).
      ai_must_stay_silent: human.humanReplied || human.paused,
    },
    history,
    policy: {
      language: s.NEURAL_LANGUAGE ?? "auto", // auto = responder en el idioma del cliente
      languages: ["es", "en"],
      capabilities: {
        quote_ride: s.NEURAL_CAN_QUOTE === "true",
        book_ride: s.NEURAL_CAN_BOOK !== "false",
        trip_status: s.NEURAL_CAN_TRIP_STATUS !== "false",
        faq: s.NEURAL_CAN_FAQ !== "false",
      },
      instructions: s.NEURAL_INSTRUCTIONS ?? "",
      forbidden: s.NEURAL_FORBIDDEN ?? "",
      schedule: s.NEURAL_SCHEDULE ?? "always",
    },
    reply: {
      url: `${SUPABASE_URL}/functions/v1/ai-reply`,
      auth: "Authorization: Bearer <API key que te dimos>",
      rate_limit_per_minute: intSetting(s.NEURAL_RATE_LIMIT_PER_MIN, 120),
    },
  };
}

async function postToNeural(s: NeuralSettings, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; error?: string }> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "QueTal-Webhook/1.0",
    "X-QueTal-Event": String(payload.event),
    "X-QueTal-Event-Id": String(payload.event_id),
  };
  if (s.NEURAL_WEBHOOK_SECRET) {
    // Firma: HMAC-SHA256 de "<timestamp>.<cuerpo>" con el secreto compartido.
    const t = Math.floor(Date.now() / 1000);
    headers["X-QueTal-Signature"] = `t=${t},v1=${await hmacHex(s.NEURAL_WEBHOOK_SECRET, `${t}.${raw}`)}`;
  }

  let last: { ok: boolean; status: number; error?: string } = { ok: false, status: 0, error: "sin intentar" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(s.NEURAL_WEBHOOK_URL!, { method: "POST", headers, body: raw, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return { ok: true, status: res.status };
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      if (res.status < 500) return last; // 4xx: no tiene sentido reintentar
    } catch (err) {
      clearTimeout(timer);
      last = { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}
