import type { Rule } from '../types/index.ts'

/** Fuente (AI_SYSTEM_PROMPT v4, punto 6, mitad delivery): deriva de inmediato, no junta datos. */
export const deliveryRule: Rule = {
  id: 'DELIVERY',
  name: 'Delivery / encomiendas',
  category: 'DELIVERY',
  description: 'El cliente pide un servicio de delivery/encomienda.',
  priority: 880,
  active: true,
  version: 1,
  trigger: { intents: ['DELIVERY'], conditions: [] },
  required_information: [],
  optional_information: [],
  information_not_required: ['pickup', 'destination', 'passengers', 'specialNeeds'],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: ['ASK_FOR_INFORMATION', 'COLLECT_RIDE_DATA', 'CREATE_REQUEST'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'Delivery/encomiendas se derivan siempre, sin que la IA intente resolverlo.',
    priority: 'normal',
    message: {
      es: 'Ya te va a contestar uno de nuestros operadores para coordinar el envío.',
      en: 'One of our operators will reach out shortly to coordinate the delivery.',
    },
  },
  response: {
    es: 'Ya te va a contestar uno de nuestros operadores para coordinar el envío.',
    en: 'One of our operators will reach out shortly to coordinate the delivery.',
  },
}
