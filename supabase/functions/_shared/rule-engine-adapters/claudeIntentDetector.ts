// supabase/functions/_shared/rule-engine-adapters/claudeIntentDetector.ts
//
// Implementacion REAL del puerto IntentDetector (ver
// rule-engine/engine/IntentDetector.ts) para "Que tal?". Reemplaza al
// MockIntentDetector del prototipo (regex/keywords) por una llamada a
// Claude con tool-use forzado: Claude SOLO interpreta lenguaje natural y
// devuelve JSON estructurado (intents + entidades) -- nunca decide que
// regla de negocio aplica ni redacta la respuesta final. Esa decision la
// sigue tomando el RuleEngine, como pide la arquitectura del encargo.
//
// Los flags deterministicos (ambiguousLocationDetected,
// outOfServiceAreaDetected, timeAmbiguous) NO se le piden a Claude -- se
// calculan en codigo a partir de la Service Area knowledge y de si vino
// AM/PM explicito, igual que hacia el detector mock, porque son
// comparaciones de datos, no interpretacion de lenguaje.

import { askClaude, type ClaudeMessage, type ClaudeTool } from "../claudeClient.ts";
import { isKnownCoveredCity } from "../rule-engine/knowledge/serviceArea.ts";
import { parseRawTime } from "../rule-engine/engine/dateUtil.ts";
import { INTENT_TYPES } from "../rule-engine/types/intent.ts";
import type {
  ConversationState,
  DetectedIntent,
  ExtractedEntities,
  IntentType,
} from "../rule-engine/types/index.ts";
import type { IntentDetectionResult, IntentDetector } from "../rule-engine/engine/IntentDetector.ts";

const EXTRACTION_TOOL: ClaudeTool = {
  name: "extract_ride_intent",
  description:
    "Extrae las intenciones del cliente y las entidades mencionadas en su ultimo mensaje de WhatsApp/SMS a una empresa de taxis. NUNCA inventes un dato que el cliente no dijo -- dejalo null. Un mensaje puede tener mas de una intencion (ej: pregunta precio Y pide un viaje).",
  input_schema: {
    type: "object",
    properties: {
      intents: {
        type: "array",
        description: "Una o mas intenciones detectadas en el mensaje, de mayor a menor confianza.",
        items: {
          type: "object",
          properties: {
            intent: { type: "string", enum: [...INTENT_TYPES] },
            confidence: { type: "number", description: "0 a 1" },
            matched_text: { type: "string", description: "Fragmento del mensaje que motivo esta intencion." },
          },
          required: ["intent", "confidence"],
        },
      },
      entities: {
        type: "object",
        properties: {
          pickup: { type: ["string", "null"], description: "Direccion o lugar de recogida, si lo dijo." },
          destination: { type: ["string", "null"], description: "Destino, si lo dijo." },
          date: { type: ["string", "null"], description: "Fecha del viaje si lo programo (texto tal cual lo dijo)." },
          raw_time: { type: ["string", "null"], description: "Hora tal cual la dijo el cliente, sin resolver AM/PM." },
          time_has_am_pm: { type: "boolean", description: "true si el cliente aclaro AM o PM (o algo inequivoco como 'de la tarde')." },
          scheduled: { type: ["boolean", "null"], description: "true si es programado, false si lo quiere YA, null si todavia no se sabe." },
          city: { type: ["string", "null"], description: "Ciudad que el cliente menciono, si la dijo." },
          cancellation_reason: { type: ["string", "null"] },
          lost_item_description: { type: ["string", "null"] },
          language: { type: "string", enum: ["es", "en"], description: "Idioma del mensaje del cliente." },
        },
        required: ["language"],
      },
    },
    required: ["intents", "entities"],
  },
};

interface ExtractionToolInput {
  intents: Array<{ intent: string; confidence: number; matched_text?: string }>;
  entities: {
    pickup?: string | null;
    destination?: string | null;
    date?: string | null;
    raw_time?: string | null;
    time_has_am_pm?: boolean;
    scheduled?: boolean | null;
    city?: string | null;
    cancellation_reason?: string | null;
    lost_item_description?: string | null;
    language?: "es" | "en";
  };
}

const EXTRACTION_SYSTEM_PROMPT = `Sos un extractor de datos para el sistema de atencion al cliente de Taxi Laser (empresa de taxis en Atlanta). Tu UNICA tarea es llamar a la herramienta extract_ride_intent con lo que el cliente dijo en su ULTIMO mensaje -- no respondas como si fueras el asistente, no converses, no inventes ningun dato que el cliente no haya dicho explicitamente. Usa el historial solo como contexto para entender referencias ("ahi mismo", "a la misma hora"), pero extraé datos solo del ultimo mensaje salvo que una referencia clara apunte a algo dicho antes.`;

function isValidIntent(value: string): value is IntentType {
  return (INTENT_TYPES as readonly string[]).includes(value);
}

export class ClaudeIntentDetector implements IntentDetector {
  /**
   * `history` son los mensajes previos de la conversacion (ya en formato
   * Claude, mas viejo primero) -- se usan como contexto, el mensaje a
   * interpretar siempre es el ultimo turno "user".
   */
  constructor(private readonly history: ClaudeMessage[] = []) {}

  async detect(message: string, _state: ConversationState): Promise<IntentDetectionResult> {
    const messages: ClaudeMessage[] = [...this.history, { role: "user", content: message }];

    const result = await askClaude({
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      messages,
      maxTokens: 1024,
      tools: [EXTRACTION_TOOL],
    });

    const toolCall = result.toolUse.find((t) => t.name === "extract_ride_intent");
    if (!toolCall) {
      // Claude no devolvio el tool esperado (raro con tool_choice forzado,
      // pero no imposible) -- se trata como "no se entendio nada", nunca
      // se improvisa una intencion.
      return { intents: [], entities: { language: "es" } };
    }

    const parsed = toolCall.input as ExtractionToolInput;

    const intents: DetectedIntent[] = (parsed.intents ?? [])
      .filter((i) => isValidIntent(i.intent))
      .map((i) => ({
        intent: i.intent as IntentType,
        confidence: typeof i.confidence === "number" ? i.confidence : 0.5,
        matchedText: i.matched_text,
      }));

    const e = parsed.entities ?? {};
    const entities: ExtractedEntities = {
      pickup: e.pickup ?? null,
      destination: e.destination ?? null,
      date: e.date ?? null,
      rawTime: e.raw_time ?? null,
      timeHasAmPm: e.time_has_am_pm ?? false,
      scheduled: e.scheduled ?? null,
      city: e.city ?? null,
      cancellationReason: e.cancellation_reason ?? null,
      lostItemDescription: e.lost_item_description ?? null,
      language: e.language === "en" ? "en" : "es",
    };

    // --- Flags deterministicos, calculados en codigo (no por Claude) ---
    if (entities.city) {
      entities.ambiguousLocationDetected = false; // la desambiguacion puntual queda para una iteracion futura (ver business-rules-todo)
      entities.outOfServiceAreaDetected = !isKnownCoveredCity(entities.city);
    }
    if (entities.rawTime && !entities.timeHasAmPm) {
      const parsedTime = parseRawTime(entities.rawTime);
      entities.timeAmbiguous = parsedTime !== null;
    }

    return { intents, entities };
  }
}
