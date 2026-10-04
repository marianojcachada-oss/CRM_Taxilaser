import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 2.c y bloque "CONFIRMACION DE
 * DATOS" del encargo):
 * "Si da una hora sin aclarar AM o PM [...] resolve cual es la proxima
 * ocurrencia logica de esa hora tomando como referencia la fecha y hora
 * actual de Atlanta [...] Decile esa hora resuelta, con AM o PM ya
 * puestos, y pedile una confirmacion corta antes de dar el pedido por
 * anotado [...] Si el cliente corrige, usa la hora que te confirme."
 *
 * IMPORTANTE (igual que en el AI_SYSTEM_PROMPT v4 real): esto depende de
 * que el AI Agent le pase la hora actual de Atlanta (America/New_York) al
 * momento de resolver la ocurrencia logica. El Rule Engine NUNCA inventa
 * esa hora -- la resolucion real de "proxima ocurrencia" es
 * responsabilidad del AIAgent/IntentDetector (ver agent/AIAgent.ts), esta
 * regla solo exige que, si es ambigua, se muestre y se confirme.
 */
export const amPmAmbiguityRule: Rule = {
  id: 'AM_PM_AMBIGUITY',
  name: 'Hora ambigua (sin AM/PM)',
  category: 'AM_PM_AMBIGUITY',
  description:
    'El cliente dio una hora de reserva sin aclarar AM/PM. Se resuelve la proxima ocurrencia logica y se le pide confirmacion explicita -- nunca se da por confirmada en silencio.',
  priority: 790,
  active: true,
  version: 1,
  trigger: {
    intents: ['SCHEDULED_RIDE'],
    conditions: [
      { field: 'entities.scheduled', operator: 'equals', value: true },
      {
        field: 'conversationState.waitingForConfirmationField',
        operator: 'equals',
        value: 'time',
        description:
          'Se dispara mientras el AIAgent mantenga una hora ambigua pendiente de confirmar (seteado en el merge de entidades del turno en que se detecto, y se mantiene activo turno a turno -- p. ej. mientras primero se termina de pedir el pickup -- hasta que el cliente confirma o corrige).',
      },
    ],
  },
  required_information: ['time'],
  optional_information: [],
  information_not_required: [],
  actions: ['CONFIRM_INFORMATION', 'WAIT_FOR_CONFIRMATION'],
  forbidden_actions: ['CREATE_REQUEST', 'CONFIRM_EXACT_ARRIVAL_TIME', 'ASSUME_TIME_SILENTLY'],
  questions: [
    {
      field: 'time',
      es: 'Te lo dejo programado para las {{proposedTime}}, ¿así está bien?',
      en: "I'll schedule it for {{proposedTime}}, does that work?",
    },
  ],
  confirmation_required: true,
  escalation: { required: false, reason: null },
  response: {
    es: 'Te lo dejo programado para las {{proposedTime}}, ¿así está bien?',
    en: "I'll schedule it for {{proposedTime}}, does that work?",
  },
}
