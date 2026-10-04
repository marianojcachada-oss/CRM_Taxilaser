import type { Rule } from '../types/index.ts'

/**
 * Fuente (ZONA DE COBERTURA del AI_SYSTEM_PROMPT v4 + bloque "SERVICE
 * AREA" del encargo): si el cliente menciona una ciudad claramente fuera
 * de zona, NO asumir que se cubre ni que no se cubre -- derivar a un
 * operador para que confirme.
 */
export const outOfServiceAreaRule: Rule = {
  id: 'OUT_OF_SERVICE_AREA',
  name: 'Ciudad claramente fuera de la zona de cobertura',
  category: 'OUT_OF_SERVICE_AREA',
  description:
    'El cliente menciono una ciudad que claramente no es parte de la Service Area. No se afirma que no llegamos ni que si llegamos -- se deriva.',
  priority: 820,
  active: true,
  version: 1,
  trigger: {
    intents: ['IMMEDIATE_RIDE', 'SCHEDULED_RIDE'],
    conditions: [{ field: 'extractedEntities.outOfServiceAreaDetected', operator: 'equals', value: true }],
  },
  required_information: [],
  optional_information: [],
  information_not_required: [],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: ['CONFIRM_COVERAGE', 'DENY_COVERAGE', 'CREATE_REQUEST'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'La ciudad mencionada esta claramente fuera de la Service Area conocida; solo un operador puede confirmar si se puede hacer el viaje.',
    priority: 'normal',
    message: {
      es: 'Un operador te va a confirmar si llegamos hasta ahí.',
      en: "An operator will confirm whether we're able to reach that area.",
    },
  },
  response: {
    es: 'Un operador te va a confirmar si llegamos hasta ahí.',
    en: "An operator will confirm whether we're able to reach that area.",
  },
}
