import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, regla general): "Si el pedido del cliente
 * no encaja en ninguno de los casos de abajo, o tenés dudas sobre qué
 * quiere, derivá a un operador humano con una respuesta breve y cordial
 * [...] no improvises una solución." Prioridad minima: es el catch-all
 * final, solo se aplica cuando ninguna otra regla matcheo.
 */
export const unknownIntentRule: Rule = {
  id: 'UNKNOWN_INTENT',
  name: 'Intencion no determinada',
  category: 'UNKNOWN_INTENT',
  description: 'No se puede determinar con claridad que quiere el cliente. No se improvisa -- se deriva.',
  priority: 10,
  active: true,
  version: 1,
  trigger: { intents: ['UNKNOWN'], conditions: [] },
  required_information: [],
  optional_information: [],
  information_not_required: [],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: ['IMPROVISE_RESPONSE', 'GUESS_INTENT', 'CREATE_REQUEST'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'No se pudo determinar la intencion del cliente con suficiente confianza.',
    priority: 'low',
    message: {
      es: 'Ya te va a contestar uno de nuestros operadores.',
      en: 'One of our operators will reply to you shortly.',
    },
  },
  response: {
    es: 'Ya te va a contestar uno de nuestros operadores.',
    en: 'One of our operators will reply to you shortly.',
  },
}
