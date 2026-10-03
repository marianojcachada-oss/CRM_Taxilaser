// supabase/functions/_shared/claudeClient.ts
//
// Módulo chico para hablar con la API de Claude (Anthropic) — lo usa
// ai-respond (y cualquier otra función de IA que se agregue después).
// La API key y el modelo se leen de integration_settings (panel de
// Integrations), igual que todas las demás credenciales de este
// proyecto — nunca hardcodeados acá.

import { getSettings } from "./settings.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 1024;

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type AskClaudeResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function askClaude(opts: {
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}): Promise<AskClaudeResult> {
  const settings = await getSettings(["CLAUDE_API_KEY", "CLAUDE_MODEL"]);

  if (!settings.CLAUDE_API_KEY) {
    throw new Error("Falta CLAUDE_API_KEY en Integrations — cargá la API Key de Anthropic antes de usar la IA.");
  }

  const model = settings.CLAUDE_MODEL || DEFAULT_MODEL;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.CLAUDE_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.systemPrompt,
      messages: opts.messages,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // El mensaje de error de Anthropic trae el detalle real (API key
    // inválida, modelo inexistente, límite de uso, etc.) — se lo pasamos
    // tal cual a quien llama, en vez de un genérico "falló la IA".
    const detail = data?.error?.message ?? JSON.stringify(data);
    throw new Error(`La API de Claude devolvió un error: ${detail}`);
  }

  // El contenido viene como una lista de bloques (normalmente uno solo,
  // de tipo "text") — los unimos por si alguna vez vienen varios.
  const text = (data?.content ?? [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text)
    .join("\n")
    .trim();

  return {
    text,
    model,
    inputTokens: data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.output_tokens ?? 0,
  };
}
