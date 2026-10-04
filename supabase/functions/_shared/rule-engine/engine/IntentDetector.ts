import type { ConversationState, DetectedIntent, ExtractedEntities } from '../types/index.ts'

export interface IntentDetectionResult {
  intents: DetectedIntent[]
  entities: ExtractedEntities
}

/**
 * Puerto (interfaz) de deteccion de intencion + extraccion de entidades.
 * El AIAgent depende de ESTA interfaz, nunca de una implementacion
 * concreta -- asi se puede reemplazar MockIntentDetector por un detector
 * real basado en Claude (via la API) sin tocar el RuleEngine ni el
 * AIAgent. Ver /docs/rule-engine.md, "Principio arquitectonico".
 */
export interface IntentDetector {
  detect(message: string, state: ConversationState): Promise<IntentDetectionResult>
}
