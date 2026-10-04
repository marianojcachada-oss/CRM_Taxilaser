import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 1):
 * "Si el cliente solo saluda o escribe algo genérico sin pedir nada
 * concreto todavía, respondé con un saludo breve y cordial en nombre de
 * Taxi Laser, y preguntale en qué lo podés ayudar [...]. No listes
 * opciones como si fuera un menú rígido, hacelo de forma natural."
 */
export const greetingRule: Rule = {
  id: 'GREETING',
  name: 'Saludo / inicio de conversación',
  category: 'GREETING',
  description:
    'El cliente solo saluda o escribe algo generico sin pedir nada concreto todavia.',
  priority: 60,
  active: true,
  version: 1,
  trigger: {
    intents: ['GREETING'],
    conditions: [],
  },
  required_information: [],
  optional_information: [],
  information_not_required: [],
  actions: ['RESPOND'],
  forbidden_actions: ['ESCALATE_TO_HUMAN', 'CALL_TOOL', 'CREATE_REQUEST'],
  questions: [],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: 'Hola, gracias por escribir a Taxi Laser. ¿En qué te puedo ayudar? (pedir un taxi, reservar uno, o saber el estado de tu viaje)',
    en: 'Hi, thanks for reaching out to Taxi Laser. How can I help you? (request a taxi, schedule one, or check your ride status)',
  },
  gaps: [
    {
      field: 'response',
      note:
        'El prompt pide tono "natural, no como menu rigido" -- la respuesta de abajo es una plantilla fija para el caso de prueba automatizado; en produccion la redaccion exacta la genera el modelo de lenguaje a partir de esta regla, no un string fijo (ver /docs/rule-engine.md, "Responses vs Templates").',
    },
  ],
}
