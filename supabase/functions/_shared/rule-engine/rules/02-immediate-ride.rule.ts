import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 2 -- rama "lo necesita YA"):
 * "Si contesta que lo necesita YA (no programado): confirmale que el
 * pedido queda tomado y que un operador le va a confirmar la unidad y el
 * tiempo de espera en breve. No inventes una unidad ni un tiempo de
 * espera." + regla general de NO pedir pasajeros/necesidades especiales
 * por defecto (decision de Joaquin, 3/10, basada en analisis de
 * conversaciones reales).
 *
 * Esta regla dispara una vez que ya se sabe scheduled=false y los datos
 * REQUIRED estan completos (eso lo determina RIDE_REQUEST_DATA_COLLECTION
 * antes -- ver prioridades en /docs/business-rules.md).
 */
export const immediateRideRule: Rule = {
  id: 'IMMEDIATE_RIDE',
  name: 'Viaje inmediato (confirmacion final)',
  category: 'IMMEDIATE_RIDE',
  description:
    'El cliente pidio un taxi para YA (no programado) y ya se junto pickup/destino. Se confirma el pedido sin inventar unidad ni tiempo de espera.',
  priority: 750,
  active: true,
  version: 1,
  trigger: {
    intents: ['IMMEDIATE_RIDE'],
    conditions: [
      { field: 'entities.pickup', operator: 'exists', description: 'Ya se sabe la direccion de recogida' },
      { field: 'entities.scheduled', operator: 'equals', value: false, description: 'El cliente confirmo que lo necesita ya' },
    ],
  },
  required_information: ['pickup'],
  optional_information: ['destination'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['RESPOND', 'CREATE_REQUEST'],
  forbidden_actions: [
    'INVENT_UNIT',
    'INVENT_WAIT_TIME',
    'ASK_PASSENGER_COUNT',
    'ASK_SPECIAL_NEEDS',
    'CALCULATE_FARE',
  ],
  questions: [],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: 'Listo, ya tomamos tu pedido. Un operador te va a confirmar la unidad y el tiempo de espera en breve.',
    en: "Got it, your request is in. An operator will confirm the vehicle and wait time shortly.",
  },
}
