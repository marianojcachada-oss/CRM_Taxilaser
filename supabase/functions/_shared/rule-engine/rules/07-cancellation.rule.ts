import type { Rule } from '../types/index.ts'

/** Fuente (AI_SYSTEM_PROMPT v4, punto 3): cancelacion siempre confirma-y-deriva, nunca cancela de verdad. */
export const cancellationRule: Rule = {
  id: 'CANCELLATION',
  name: 'Cancelacion de un taxi',
  category: 'CANCELLATION',
  description:
    'El cliente pide cancelar un viaje (inmediato o programado). La IA nunca cancela de verdad ni dice que ya quedo cancelado.',
  priority: 840,
  active: true,
  version: 1,
  trigger: { intents: ['CANCELLATION'], conditions: [] },
  required_information: [],
  optional_information: ['cancellationReason'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['ASK_FOR_INFORMATION', 'GET_INFORMATION', 'RESPOND'],
  forbidden_actions: ['CANCEL_RIDE_FOR_REAL', 'CONFIRM_CANCELLATION_COMPLETED', 'INVENT_RIDE_DATA'],
  questions: [
    {
      field: 'cancellationReason',
      es: '¿Me contás brevemente el motivo, para dejarlo anotado?',
      en: 'Could you tell me briefly why, just to have it on record?',
    },
  ],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'Solo un operador puede confirmar una cancelacion real.',
    priority: 'normal',
    message: {
      es: 'Entendido, anoté tu pedido de cancelación. Un operador lo va a revisar y confirmar.',
      en: 'Got it, I noted your cancellation request. An operator will review and confirm it.',
    },
  },
  response: {
    es: 'Entendido, anoté tu pedido de cancelación. Un operador lo va a revisar y confirmar.',
    en: 'Got it, I noted your cancellation request. An operator will review and confirm it.',
  },
  gaps: [
    {
      field: 'required_information',
      note:
        '[POLICY TO BE DEFINED] El prompt no dice si el motivo de cancelacion es obligatorio para avanzar o si alcanza con preguntarlo una vez sin insistir -- se modelo como OPTIONAL, igual que el patron usado para "necesita algo especial" en el flujo de pedido.',
    },
  ],
}
