/**
 * Catalogo de intenciones que el IntentDetector puede devolver.
 * Un mensaje puede mapear a MAS DE UNA intencion (ver RuleEngine +
 * ConflictResolver para como se resuelve eso).
 */
export const INTENT_TYPES = [
  'GREETING',
  'IMMEDIATE_RIDE',
  'SCHEDULED_RIDE',
  'CANCELLATION',
  'RIDE_STATUS',
  'LOST_ITEM',
  'DELIVERY',
  'HUMAN_OPERATOR_REQUEST',
  'FARE_INQUIRY',
  'UNKNOWN',
] as const

export type IntentType = (typeof INTENT_TYPES)[number]

export interface DetectedIntent {
  intent: IntentType
  /** 0..1, confianza del detector. El Mock la calcula por keyword-matching. */
  confidence: number
  /** Fragmento del mensaje que disparo la deteccion, para debug/simulador. */
  matchedText?: string
}

/**
 * Entidades que el IntentDetector / extractor de entidades puede sacar de un
 * mensaje. Todas opcionales -- el estado de conversacion es quien acumula
 * lo que ya se sabe turno a turno (ver state/ConversationState.ts).
 */
export interface ExtractedEntities {
  pickup?: string | null
  destination?: string | null
  date?: string | null
  /** Hora tal cual la dijo el cliente, sin resolver AM/PM todavia. */
  rawTime?: string | null
  /** true si el cliente especifico AM o PM (o un equivalente inequivoco). */
  timeHasAmPm?: boolean
  scheduled?: boolean | null
  /** Ciudad de la zona de cobertura, si el cliente la aclaro. */
  city?: string | null
  cancellationReason?: string | null
  lostItemDescription?: string | null
  language?: 'es' | 'en'

  /**
   * Flags deterministicos que calcula el (Mock)IntentDetector a partir del
   * texto + la Service Area knowledge. NO son decisiones de negocio -- solo
   * deteccion. La decision de que hacer con cada flag vive en las reglas
   * (AMBIGUOUS_LOCATION, OUT_OF_SERVICE_AREA, AM_PM_AMBIGUITY).
   */
  ambiguousLocationDetected?: boolean
  outOfServiceAreaDetected?: boolean
  /** true si se detecto una hora en el mensaje pero sin AM/PM explicito. */
  timeAmbiguous?: boolean
}
