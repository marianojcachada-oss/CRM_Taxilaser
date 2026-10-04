import type { IntentType } from './intent.ts'

/**
 * Datos del viaje que se van acumulando turno a turno. Coincide con el
 * ejemplo del encargo (pickup/destination/date/time/scheduled) mas los
 * campos que necesita el resto del flujo (city, timeConfirmed, etc).
 */
export interface RideEntities {
  pickup: string | null
  destination: string | null
  date: string | null
  /** Hora ya resuelta con AM/PM (ej. "9:50 PM"). Null hasta confirmar. */
  time: string | null
  /** Hora cruda tal como la dijo el cliente, antes de resolver AM/PM. */
  rawTime: string | null
  scheduled: boolean | null
  city: string | null
  passengers: string | null
  specialNeeds: string | null
  cancellationReason: string | null
  lostItemDescription: string | null
}

export function emptyRideEntities(): RideEntities {
  return {
    pickup: null,
    destination: null,
    date: null,
    time: null,
    rawTime: null,
    scheduled: null,
    city: null,
    passengers: null,
    specialNeeds: null,
    cancellationReason: null,
    lostItemDescription: null,
  }
}

/** Una pregunta pendiente de respuesta, en cola para el proximo turno. */
export interface PendingQuestion {
  field: keyof RideEntities
  es: string
  en: string
  /** Que regla la genero, para trazabilidad. */
  ruleId: string
}

/**
 * Estado completo de una conversacion. Vive en memoria en esta etapa
 * (ver state/ConversationStateStore.ts) -- en produccion esto se
 * persistiria junto a la conversacion real de "Que tal?" (tabla
 * `conversations`), pero esa integracion no se crea todavia.
 */
export interface ConversationState {
  conversationId: string
  language: 'es' | 'en'

  intent: IntentType | null
  /** Todas las intenciones detectadas en el ULTIMO mensaje del cliente. */
  detectedIntents: IntentType[]

  entities: RideEntities
  /** Campos de `entities` que el cliente ya confirmo explicitamente. */
  confirmedEntities: Array<keyof RideEntities>

  pendingQuestions: PendingQuestion[]

  currentRuleId: string | null

  /**
   * true cuando el motor esta esperando un si/no del cliente sobre un dato
   * ambiguo (hora sin AM/PM, ciudad ambigua, etc) antes de poder avanzar.
   */
  waitingForConfirmation: boolean
  /** Que campo especifico esta esperando confirmar, si corresponde. */
  waitingForConfirmationField: keyof RideEntities | null
  /** Valor propuesto que el motor le mostro al cliente para confirmar. */
  proposedValue: string | null

  /** Historial de que reglas se aplicaron en esta conversacion, en orden. */
  appliedRuleIds: string[]

  escalated: boolean
  escalationReason: string | null

  updatedAt: string
}

export function createInitialConversationState(
  conversationId: string,
  language: 'es' | 'en' = 'es',
): ConversationState {
  return {
    conversationId,
    language,
    intent: null,
    detectedIntents: [],
    entities: emptyRideEntities(),
    confirmedEntities: [],
    pendingQuestions: [],
    currentRuleId: null,
    waitingForConfirmation: false,
    waitingForConfirmationField: null,
    proposedValue: null,
    appliedRuleIds: [],
    escalated: false,
    escalationReason: null,
    updatedAt: new Date().toISOString(),
  }
}
