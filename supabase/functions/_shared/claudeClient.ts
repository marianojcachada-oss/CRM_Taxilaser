// supabase/functions/_shared/claudeClient.ts
//
// Módulo chico para hablar con la API de Claude (Anthropic) — lo usa
// ai-respond (y cualquier otra función de IA que se agregue después).
// La API key y el modelo se leen de integration_settings (panel de
// Integrations), igual que todas las demás credenciales de este
// proyecto — nunca hardcodeados acá.
//
// AGREGADO (port del Rule Engine): soporte opcional de tool-use, para que
// el Rule Engine pueda pedirle a Claude una extracción ESTRUCTURADA de
// intents/entidades (JSON validado por schema) en vez de parsear texto
// libre. 100% retrocompatible -- askClaude() sin `tools` se comporta
// exactamente igual que antes.

import { getSettings } from "./settings.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 1024;

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// Tool de SERVIDOR (ej. búsqueda web) -- Anthropic la ejecuta de su lado,
// no tiene input_schema propio porque no la llamamos nosotros con datos;
// Claude la invoca sola cuando la necesita. Requiere que "Permitir
// búsqueda web" esté habilitado en platform.claude.com -> Capabilities
// (confirmado prendido para esta cuenta el 4/10/2026).
export type ClaudeServerTool = {
  type: string; // ej. "web_search_20250305"
  name: string; // ej. "web_search"
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
};

export type ClaudeToolUse = { name: string; input: unknown };

export type AskClaudeResult = {
  text: string;
  /** Bloques tool_use que devolvió Claude, en orden. Vacío si no se pidieron `tools`. */
  toolUse: ClaudeToolUse[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function askClaude(opts: {
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  /** Tool-use opcional (extracción estructurada, y/o tools de servidor como web_search). Si se pasa un solo tool, se fuerza su uso con tool_choice. */
  tools?: Array<ClaudeTool | ClaudeServerTool>;
  toolChoice?: { type: "auto" } | { type: "any" } | { type: "tool"; name: string };
}): Promise<AskClaudeResult> {
  const settings = await getSettings(["CLAUDE_API_KEY", "CLAUDE_MODEL"]);

  if (!settings.CLAUDE_API_KEY) {
    throw new Error("Falta CLAUDE_API_KEY en Integrations — cargá la API Key de Anthropic antes de usar la IA.");
  }

  const model = settings.CLAUDE_MODEL || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: opts.systemPrompt,
    messages: opts.messages,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? (opts.tools.length === 1 ? { type: "tool", name: opts.tools[0].name } : { type: "auto" });
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.CLAUDE_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // El mensaje de error de Anthropic trae el detalle real (API key
    // inválida, modelo inexistente, límite de uso, etc.) — se lo pasamos
    // tal cual a quien llama, en vez de un genérico "falló la IA".
    const detail = data?.error?.message ?? JSON.stringify(data);
    throw new Error(`La API de Claude devolvió un error: ${detail}`);
  }

  const blocks: Array<{ type: string; text?: string; name?: string; input?: unknown }> = data?.content ?? [];

  // El contenido viene como una lista de bloques (normalmente uno solo,
  // de tipo "text") — los unimos por si alguna vez vienen varios.
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  const toolUse: ClaudeToolUse[] = blocks
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ name: block.name ?? "", input: block.input }));

  return {
    text,
    toolUse,
    model,
    inputTokens: data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.output_tokens ?? 0,
  };
}
