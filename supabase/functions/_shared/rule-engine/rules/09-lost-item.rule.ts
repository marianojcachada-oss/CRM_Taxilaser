import type { Rule } from '../types/index.ts'

/** Fuente (AI_SYSTEM_PROMPT v4, punto 5): empatia + datos basicos + deriva siempre, nunca promete recuperacion. */
export const lostItemRule: Rule = {
  id: 'LOST_ITEM',
  name: 'Objetos perdidos',
  category: 'LOST_ITEM',
  description: 'El cliente escribe porque se le perdio algo en un taxi.',
  priority: 860,
  active: true,
  version: 1,
  trigger: { intents: ['LOST_ITEM'], conditions: [] },
  required_information: [],
  optional_information: ['lostItemDescription'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['ASK_FOR_INFORMATION', 'ESCALATE_TO_HUMAN'],
  forbidden_actions: ['PROMISE_ITEM_RECOVERY', 'MANAGE_RETURN_LOGISTICS'],
  questions: [
    {
      field: 'lostItemDescription',
      es: '¿Qué se te perdió y en qué viaje (más o menos a qué hora)?',
      en: 'What did you lose, and on which ride (roughly what time)?',
    },
  ],
  confirmation_required: false,
  escalation: {
    required: true,
    reason: 'El seguimiento de objetos perdidos siempre lo maneja un operador humano.',
    priority: 'normal',
    message: {
      es: 'Lamento el inconveniente. Ya anoté los datos y un operador le va a dar seguimiento a tu objeto perdido.',
      en: "Sorry about that. I've noted the details and an operator will follow up on your lost item.",
    },
  },
  response: {
    es: 'Lamento el inconveniente. Ya anoté los datos y un operador le va a dar seguimiento a tu objeto perdido.',
    en: "Sorry about that. I've noted the details and an operator will follow up on your lost item.",
  },
}
