// supabase/functions/_shared/neural.ts
//
// Lógica compartida de la integración con Neuralpreneur (IA externa).
// Toda la configuración sale de integration_settings (pantalla AI (Valeria)).
//
// Regla de oro: el HUMANO manda. La IA se calla en una conversación apenas
// un operador respondió (mensaje de operador SIN automation_type), o si la
// conversación está pausada/escalada. Ojo: "operador asignado" NO alcanza
// para saber si hay un humano atendiendo, porque el reparto 1x1 asigna un
// operador apenas entra el mensaje — por eso se mira si RESPONDIÓ.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "./settings.ts";
import { isWithinBusinessHours } from "./businessHours.ts";

export const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export const NEURAL_KEYS = [
  "NEURAL_MODE",
  "NEURAL_TEST_MODE",
  "NEURAL_TEST_NUMBERS",
  "NEURAL_WEBHOOK_URL",
  "NEURAL_WEBHOOK_SECRET",
  "NEURAL_API_KEY",
  "NEURAL_RATE_LIMIT_PER_MIN",
  "NEURAL_DELAY_MINUTES",
  "NEURAL_SCHEDULE",
  "NEURAL_CHANNELS",
  "NEURAL_MAX_AUTO_REPLIES",
  "NEURAL_LANGUAGE",
  "NEURAL_CAN_QUOTE",
  "NEURAL_CAN_BOOK",
  "NEURAL_CAN_TRIP_STATUS",
  "NEURAL_CAN_FAQ",
  "NEURAL_INSTRUCTIONS",
  "NEURAL_FORBIDDEN",
  "NEURAL_INTERNAL_SECRET",
  "NEURAL_INTERNAL_URL",
] as const;

export type NeuralSettings = Record<(typeof NEURAL_KEYS)[number], string | null>;
export type NeuralMode = "off" | "on_demand" | "all";

export async function loadNeuralSettings(): Promise<NeuralSettings> {
  return (await getSettings([...NEURAL_KEYS])) as NeuralSettings;
}

export function neuralMode(s: NeuralSettings): NeuralMode {
  const m = s.NEURAL_MODE;
  return m === "all" || m === "on_demand" ? m : "off";
}

export function intSetting(raw: string | null, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function enabledChannels(s: NeuralSettings): string[] {
  const raw = s.NEURAL_CHANNELS ?? "whatsapp,sms";
  return raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
}

// Compara teléfonos por sus últimos 10 dígitos (ignora +, espacios y el 1 de país).
function last10(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

export function isTestNumber(s: NeuralSettings, phone: string | null | undefined): boolean {
  if (!phone) return false;
  const list = (s.NEURAL_TEST_NUMBERS ?? "").split(/[\s,;]+/).map(last10).filter((x) => x.length >= 7);
  return list.includes(last10(phone));
}

/** En modo prueba (default), solo los números de la lista pasan. */
export function blockedByTestMode(s: NeuralSettings, phone: string | null | undefined): boolean {
  if (s.NEURAL_TEST_MODE === "false") return false;
  return !isTestNumber(s, phone);
}

export async function scheduleAllows(s: NeuralSettings): Promise<boolean> {
  if ((s.NEURAL_SCHEDULE ?? "always") !== "outside_hours") return true;
  return !(await isWithinBusinessHours());
}

export type HumanState = {
  paused: boolean;
  humanReplied: boolean;
  lastHumanReplyAt: string | null;
  aiRepliesSinceHuman: number;
};

/** Estado humano/IA de una conversación (ver regla de oro arriba). */
export async function getHumanState(conversationId: string): Promise<HumanState> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("ai_paused, ai_resume_at")
    .eq("id", conversationId)
    .maybeSingle();

  const resumeAt: string | null = (conv as any)?.ai_resume_at ?? null;

  let q = supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "operator")
    .is("automation_type", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (resumeAt) q = q.gt("created_at", resumeAt);
  const { data: lastHuman } = await q.maybeSingle();

  // Respuestas de la IA desde el último humano / reactivación (corta bucles).
  const since = (lastHuman as any)?.created_at ?? resumeAt;
  let aiQ = supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("automation_type", "ai_response");
  if (since) aiQ = aiQ.gt("created_at", since);
  const { count } = await aiQ;

  return {
    paused: !!(conv as any)?.ai_paused,
    humanReplied: !!lastHuman,
    lastHumanReplyAt: (lastHuman as any)?.created_at ?? null,
    aiRepliesSinceHuman: count ?? 0,
  };
}

export async function logEvent(row: {
  direction: "out" | "in";
  status: string;
  dedupe_key?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  reason?: string | null;
  http_status?: number | null;
  detail?: unknown;
}): Promise<{ duplicate: boolean }> {
  const { error } = await supabase.from("ai_dispatch_log").insert({
    direction: row.direction,
    status: row.status,
    dedupe_key: row.dedupe_key ?? null,
    conversation_id: row.conversation_id ?? null,
    message_id: row.message_id ?? null,
    reason: row.reason ?? null,
    http_status: row.http_status ?? null,
    detail: row.detail ?? null,
  });
  if (error) {
    if ((error as any).code === "23505") return { duplicate: true };
    console.error("ai_dispatch_log:", error.message);
  }
  return { duplicate: false };
}

// ---- Firma HMAC-SHA256 --------------------------------------------------

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Comparación en tiempo constante (para claves y secretos). */
export function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
