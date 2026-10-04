import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 7 -- "MUY IMPORTANTE" en el encargo):
 * "Derivá a un operador humano de inmediato, apenas detectes esta
 * intención. NO le pidas direcciones de origen ni destino, NO intentes
 * calcular ninguna tarifa ni dar un número aproximado."
 *
 * Prioridad alta a proposito: en el ejemplo de multiples intenciones del
 * encargo ("...and how much will it cost?"), FARE_INQUIRY debe ganarle a
 * IMMEDIATE_RIDE/SCHEDULED_RIDE. Ver engine/ConflictResolver.ts.
 */
export const fareInquiryRule: Rule = {
  id: 'FARE_INQUIRY',
  name: 'Cotizar / cuanto sale un viaje',
  category: 'FARE_INQUIRY',
  description:
    'El cliente pregunta cuanto cuesta o pide una cotizacion. Se deriva de inmediato, sin pedir direcciones ni calcular nada -- incluso si el mismo mensaje tambien pide un viaje.',
  priority: 900,
  active: true,
  version: 1,
  trigger: { intents: ['FARE_INQUIRY'], conditions: [] },
  required_information: [],
  optional_information: [],
  information_not_required: ['pickup', 'destination', 'passengers', 'specialNeeds'],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: [
    // Nombres descriptivos tal cual los pide el ejemplo del Rule Tester
    // en el encargo ("Forbidden: REQUEST_PICKUP REQUEST_DESTINATION
    // CALCULATE_FARE") -- se muestran asi en el panel admin/simulador.
    'REQUEST_PICKUP',
    'REQUEST_DESTINATION',
    'CALCULATE_FARE',
    'ESTIMATE_FARE',
    'GIVE_FARE_RANGE',
    'GIVE_FARE_APPROXIMATION',
    // Ademas, el ActionType generico real que produciria pedir
    // pickup/destino -- se agrega para que el ConflictResolver pueda
    // suprimir mecanicamente esa accion si una regla de menor prioridad
    // (p. ej. RIDE_REQUEST_DATA_COLLECTION) tambien matcheo en el mismo
    // turno (ver ejemplo de "MULTIPLES INTENCIONES" del encargo).
    'ASK_FOR_INFORMATION',
  ],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'El precio/tarifa siempre lo confirma un operador, nunca la IA.',
    priority: 'normal',
    message: {
      es: 'Un operador te va a confirmar el precio en breve.',
      en: 'An operator will confirm the price with you shortly.',
    },
  },
  response: {
    es: 'Un operador te va a confirmar el precio en breve.',
    en: 'An operator will confirm the price with you shortly.',
  },
}
