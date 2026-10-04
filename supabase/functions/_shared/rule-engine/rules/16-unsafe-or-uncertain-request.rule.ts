import type { Rule } from '../types/index.ts'

/**
 * Fuente (REGLA FUNDAMENTAL + "REGLA UNSAFE_OR_UNCERTAIN_REQUEST" del
 * encargo): "Si una situación no está definida o existe incertidumbre
 * sobre una acción empresarial: no improvisar. Escalar a operador."
 *
 * [POLICY TO BE DEFINED] El AI_SYSTEM_PROMPT v4 (la fuente de verdad
 * comercial) no tiene una categoria propia distinta de "no encaja en
 * ningun caso" (que es UNKNOWN_INTENT) para distinguir "mensaje raro que
 * no se entiende" de "situacion entendida pero sin politica de negocio
 * definida para resolverla". El encargo del Rule Engine SI pide esta
 * regla como algo separado, asi que se crea aca como el mecanismo
 * generico de seguridad para cuando UNA REGLA INDIVIDUAL detecta una
 * condicion de negocio sin politica definida (gap marcado con
 * BUSINESS_RULE_REQUIRED en su propio `gaps`) -- no se le agrego logica
 * de deteccion propia por texto, porque inventar esa deteccion seria
 * inventar una regla comercial. Queda documentada en
 * /docs/business-rules-todo.md como pendiente de precisar la diferencia
 * exacta con UNKNOWN_INTENT.
 */
export const unsafeOrUncertainRequestRule: Rule = {
  id: 'UNSAFE_OR_UNCERTAIN_REQUEST',
  name: 'Situacion no definida / incertidumbre sobre una accion comercial',
  category: 'UNSAFE_OR_UNCERTAIN_REQUEST',
  description:
    'Mecanismo de seguridad generico: cuando una regla matcheada tiene un gap de politica de negocio sin definir (BUSINESS_RULE_REQUIRED) para el caso puntual, se escala en vez de improvisar.',
  priority: 1000,
  active: true,
  version: 1,
  trigger: {
    intents: [
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
    ],
    conditions: [
      {
        field: 'matchedRuleHasUnresolvedGap',
        operator: 'equals',
        value: true,
        description: 'La regla que hubiera aplicado tiene un gap de politica de negocio sin definir para este caso puntual',
      },
    ],
  },
  required_information: [],
  optional_information: [],
  information_not_required: [],
  actions: ['ESCALATE_TO_HUMAN'],
  forbidden_actions: ['IMPROVISE_RESPONSE', 'INVENT_BUSINESS_POLICY', 'CREATE_REQUEST', 'CONFIRM_INFORMATION'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'Existe incertidumbre sobre una accion comercial no definida en el prompt original (BUSINESS_RULE_REQUIRED).',
    priority: 'normal',
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
