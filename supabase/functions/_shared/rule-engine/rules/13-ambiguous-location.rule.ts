import type { Rule } from '../types/index.ts'

/**
 * Fuente (ZONA DE COBERTURA del AI_SYSTEM_PROMPT v4 + bloque "SERVICE
 * AREA" del encargo): si un lugar puede existir en mas de una ciudad de
 * la zona y el nombre no es inequivoco, preguntar la ciudad -- nunca
 * asumir en silencio.
 */
export const ambiguousLocationRule: Rule = {
  id: 'AMBIGUOUS_LOCATION',
  name: 'Ubicacion ambigua entre ciudades de la zona',
  category: 'AMBIGUOUS_LOCATION',
  description:
    'El lugar mencionado (pickup o destino) podria existir en mas de una ciudad de la Service Area y no es inequivoco. Se pregunta la ciudad antes de seguir.',
  priority: 800,
  active: true,
  version: 1,
  trigger: {
    intents: ['IMMEDIATE_RIDE', 'SCHEDULED_RIDE'],
    conditions: [
      { field: 'extractedEntities.ambiguousLocationDetected', operator: 'equals', value: true },
      { field: 'entities.city', operator: 'notExists' },
    ],
  },
  required_information: ['city'],
  optional_information: [],
  information_not_required: [],
  actions: ['ASK_FOR_INFORMATION'],
  forbidden_actions: ['ASSUME_CITY_SILENTLY', 'CREATE_REQUEST'],
  questions: [
    {
      field: 'city',
      es: '¿En qué ciudad es? (puede haber un lugar con ese nombre en más de una)',
      en: 'Which city is that in? (that name could match more than one in our area)',
    },
  ],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: '¿En qué ciudad es? (puede haber un lugar con ese nombre en más de una)',
    en: 'Which city is that in? (that name could match more than one in our area)',
  },
}
