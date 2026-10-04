import type { Rule } from '../types/index.ts'

/** Fuente (AI_SYSTEM_PROMPT v4, punto 4): usa datos reales de viaje activo si existen, nunca inventa. */
export const rideStatusRule: Rule = {
  id: 'RIDE_STATUS',
  name: 'Estado del taxi',
  category: 'RIDE_STATUS',
  description:
    'El cliente pregunta por el estado de su viaje (donde esta, cuanto falta, si ya salio). Usa datos reales si los hay (via CALL_TOOL), nunca inventa unidad/color/patente/ETA/estado.',
  priority: 680,
  active: true,
  version: 1,
  trigger: { intents: ['RIDE_STATUS'], conditions: [] },
  required_information: [],
  optional_information: [],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['CALL_TOOL', 'GET_INFORMATION', 'RESPOND'],
  forbidden_actions: ['INVENT_UNIT', 'INVENT_COLOR', 'INVENT_PLATE', 'INVENT_ETA', 'INVENT_STATUS'],
  questions: [],
  confirmation_required: false,
  escalation: {
    required: false,
    reason: null,
    message: {
      es: 'No encuentro un viaje activo a tu nombre en este momento. Un operador lo va a confirmar.',
      en: "I don't see an active ride under your name right now. An operator will confirm.",
    },
  },
  response: {
    es: 'Tu viaje activo: {{activeRideSummary}}',
    en: 'Your active ride: {{activeRideSummary}}',
  },
  gaps: [
    {
      field: 'escalation',
      note:
        'El prompt dice "informa que no encontras viaje activo y que un operador lo va a confirmar" cuando no hay datos -- no aclara si eso cuenta como escalamiento formal (ESCALATE_TO_HUMAN) o es solo parte de la respuesta de la IA. Se modelo como respuesta directa (RESPOND) con escalation.required=false, ya que la IA SI contesta algo util por su cuenta.',
    },
  ],
}
