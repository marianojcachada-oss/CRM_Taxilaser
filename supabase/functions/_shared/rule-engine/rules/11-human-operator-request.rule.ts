import type { Rule } from '../types/index.ts'

/** Fuente (AI_SYSTEM_PROMPT v4, punto 6, mitad "hablar con operador"): deriva de inmediato, no intenta resolver antes. */
export const humanOperatorRequestRule: Rule = {
  id: 'HUMAN_OPERATOR_REQUEST',
  name: 'Pedido explicito de hablar con un operador',
  category: 'HUMAN_OPERATOR_REQUEST',
  description: 'El cliente pide explicitamente hablar con una persona/operador.',
  priority: 950,
  active: true,
  version: 1,
  trigger: { intents: ['HUMAN_OPERATOR_REQUEST'], conditions: [] },
  required_information: [],
  optional_information: [],
  information_not_required: ['pickup', 'destination', 'passengers', 'specialNeeds'],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: ['ASK_FOR_INFORMATION', 'ATTEMPT_TO_RESOLVE', 'CREATE_REQUEST'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'Pedido explicito del cliente de hablar con una persona.',
    priority: 'high',
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
