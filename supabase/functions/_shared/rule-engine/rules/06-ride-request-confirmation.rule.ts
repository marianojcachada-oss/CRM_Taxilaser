import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 2.c, cierre de ambas ramas, y punto
 * 2.d): una vez que el pedido esta completo (y, si era programado, la
 * hora ya fue confirmada por el cliente), se avisa que el pedido/reserva
 * quedo tomado, sin confirmar nunca unidad/precio/ETA en firme.
 *
 * Esta regla es el punto de entrada comun antes de que IMMEDIATE_RIDE o
 * SCHEDULED_RIDE generen el mensaje final especifico -- registra que la
 * recoleccion de datos (y la confirmacion de hora, si aplicaba) ya
 * terminaron, habilitando CREATE_REQUEST (mock).
 */
export const rideRequestConfirmationRule: Rule = {
  id: 'RIDE_REQUEST_CONFIRMATION',
  name: 'Confirmacion de pedido/reserva completos',
  category: 'RIDE_REQUEST_CONFIRMATION',
  description:
    'Todos los datos REQUIRED estan completos y, si la hora era ambigua, ya fue confirmada por el cliente. Habilita el cierre (IMMEDIATE_RIDE o SCHEDULED_RIDE) sin confirmar unidad, precio ni ETA.',
  priority: 700,
  active: true,
  version: 1,
  trigger: {
    intents: ['IMMEDIATE_RIDE', 'SCHEDULED_RIDE'],
    conditions: [
      { field: 'entities.pickup', operator: 'exists' },
      { field: 'entities.scheduled', operator: 'exists', description: 'Ya se sabe si es ya o programado' },
    ],
  },
  required_information: ['pickup', 'scheduled'],
  optional_information: ['destination'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['CREATE_REQUEST', 'RESPOND'],
  forbidden_actions: [
    'CONFIRM_UNIT',
    'CONFIRM_PRICE',
    'CONFIRM_EXACT_ARRIVAL_TIME',
    'INVENT_UNIT',
    'INVENT_PRICE',
    'INVENT_ETA',
  ],
  questions: [],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: 'Listo, tu pedido quedó anotado. Un operador te confirma los detalles en breve.',
    en: 'Done, your request is noted. An operator will confirm the details shortly.',
  },
}
