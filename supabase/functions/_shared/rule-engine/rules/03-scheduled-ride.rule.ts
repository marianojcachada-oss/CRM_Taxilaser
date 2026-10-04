import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 2 -- rama "SI quiere programarlo"):
 * "pedile fecha y hora. Si da una hora sin aclarar AM o PM [...] resolve
 * cual es la proxima ocurrencia logica [...] Decile esa hora resuelta,
 * con AM o PM ya puestos, y pedile una confirmacion corta [...] Una vez
 * confirmada, decile que un operador le va a confirmar la reserva en
 * breve." + "En ningun caso [...] confirmes vos una unidad, un precio, ni
 * una hora exacta de llegada".
 *
 * Esta regla cubre el cierre de una reserva YA confirmada (hora sin
 * ambiguedad, o ya resuelta y confirmada por AM_PM_AMBIGUITY). Mientras la
 * hora este pendiente de confirmar, quien maneja el turno es
 * AM_PM_AMBIGUITY (mayor prioridad).
 */
export const scheduledRideRule: Rule = {
  id: 'SCHEDULED_RIDE',
  name: 'Viaje programado (confirmacion final)',
  category: 'SCHEDULED_RIDE',
  description:
    'El cliente quiere reservar un taxi para otro momento. Se recopila pickup, destino, fecha y hora; la hora ambigua la resuelve AM_PM_AMBIGUITY antes de llegar aca.',
  priority: 770,
  active: true,
  version: 1,
  trigger: {
    intents: ['SCHEDULED_RIDE'],
    conditions: [
      { field: 'entities.pickup', operator: 'exists' },
      { field: 'entities.scheduled', operator: 'equals', value: true },
      { field: 'entities.time', operator: 'exists', description: 'La hora ya esta resuelta (con AM/PM) y, si era ambigua, confirmada' },
    ],
  },
  required_information: ['pickup', 'date', 'time'],
  optional_information: ['destination'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['RESPOND', 'CREATE_REQUEST'],
  forbidden_actions: [
    'INVENT_UNIT',
    'INVENT_PRICE',
    'INVENT_ETA',
    'CONFIRM_UNIT',
    'CONFIRM_PRICE',
    'CONFIRM_EXACT_ARRIVAL_TIME',
    'ASK_PASSENGER_COUNT',
    'ASK_SPECIAL_NEEDS',
  ],
  questions: [],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: 'Perfecto, queda tu reserva anotada. Un operador te la va a confirmar en breve.',
    en: "Perfect, your reservation is noted. An operator will confirm it with you shortly.",
  },
}
