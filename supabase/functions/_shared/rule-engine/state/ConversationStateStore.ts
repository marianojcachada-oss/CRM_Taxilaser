import type { ConversationState } from '../types/index.ts'
import { createInitialConversationState } from '../types/index.ts'

/**
 * Puerto de persistencia del estado de conversacion. Async (a diferencia
 * del prototipo original, que era sincrono/en memoria) porque en
 * "Que tal?" esto vive en Postgres (tabla `ai_conversation_state`) -- la
 * Edge Function no mantiene nada "caliente" entre invocaciones, asi que el
 * estado tiene que leerse y guardarse en cada turno via red.
 */
export interface ConversationStateStore {
  get(conversationId: string, defaultLanguage?: 'es' | 'en'): Promise<ConversationState>
  save(state: ConversationState): Promise<void>
  reset(conversationId: string): Promise<void>
}

/** Solo para tests/desarrollo local -- no se usa en "Que tal?". */
export class InMemoryConversationStateStore implements ConversationStateStore {
  private states = new Map<string, ConversationState>()

  async get(conversationId: string, defaultLanguage: 'es' | 'en' = 'es'): Promise<ConversationState> {
    const existing = this.states.get(conversationId)
    if (existing) return existing
    const fresh = createInitialConversationState(conversationId, defaultLanguage)
    this.states.set(conversationId, fresh)
    return fresh
  }

  async save(state: ConversationState): Promise<void> {
    this.states.set(state.conversationId, state)
  }

  async reset(conversationId: string): Promise<void> {
    this.states.delete(conversationId)
  }
}
