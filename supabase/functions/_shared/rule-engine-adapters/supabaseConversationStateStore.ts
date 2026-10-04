// supabase/functions/_shared/rule-engine-adapters/supabaseConversationStateStore.ts
//
// Implementacion REAL del puerto ConversationStateStore para "Que tal?":
// persiste el ConversationState completo como JSONB en la tabla
// ai_conversation_state (una fila por conversation_id). Necesario porque
// la Edge Function no mantiene nada en memoria entre invocaciones.
//
// Ver migration 2026-10-03_ai_conversation_state.sql para el schema.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ConversationState } from "../rule-engine/types/index.ts";
import { createInitialConversationState } from "../rule-engine/types/index.ts";
import type { ConversationStateStore } from "../rule-engine/state/ConversationStateStore.ts";

export class SupabaseConversationStateStore implements ConversationStateStore {
  constructor(private readonly client: SupabaseClient) {}

  async get(conversationId: string, defaultLanguage: "es" | "en" = "es"): Promise<ConversationState> {
    const { data, error } = await this.client
      .from("ai_conversation_state")
      .select("state")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (error) {
      // No se bloquea la conversacion por un problema de lectura del
      // estado -- se arranca de cero (en el peor caso, se repite alguna
      // pregunta ya hecha, lo cual es mucho mejor que cortar la
      // respuesta al cliente).
      console.error("[rule-engine] no se pudo leer ai_conversation_state:", error.message);
      return createInitialConversationState(conversationId, defaultLanguage);
    }

    if (!data?.state) {
      return createInitialConversationState(conversationId, defaultLanguage);
    }

    return data.state as ConversationState;
  }

  async save(state: ConversationState): Promise<void> {
    const { error } = await this.client.from("ai_conversation_state").upsert(
      {
        conversation_id: state.conversationId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" },
    );
    if (error) {
      console.error("[rule-engine] no se pudo guardar ai_conversation_state:", error.message);
    }
  }

  async reset(conversationId: string): Promise<void> {
    const { error } = await this.client.from("ai_conversation_state").delete().eq("conversation_id", conversationId);
    if (error) {
      console.error("[rule-engine] no se pudo borrar ai_conversation_state:", error.message);
    }
  }
}
