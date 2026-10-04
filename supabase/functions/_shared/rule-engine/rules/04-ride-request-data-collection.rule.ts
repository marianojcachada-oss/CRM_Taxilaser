import type { Rule } from '../types/index.ts'

/**
 * Fuente (AI_SYSTEM_PROMPT v4, punto 2.b):
 * "pedile los datos uno por uno, de forma natural [...] Direccion exacta
 * donde lo tenes que pasar a buscar [...] Direccion exacta de destino (si
 * la tiene) [...] NO preguntes por defecto la cantidad de pasajeros ni si
 * necesita algo especial [...] Si el cliente lo menciona por su cuenta,
 * anotalo [...] pero no lo pidas de entrada."
 *
 * NOTA DE DISEÑO (no cambia la logica, solo la estructura -- documentado
 * en /docs/business-rules.md): el prompt original trata "pedir datos" y
 * "confirmar el pedido" como un unico flujo continuo (ver punto 2
 * completo). El encargo de Rule Engine pide reglas separadas para
 * GREETING / IMMEDIATE_RIDE / SCHEDULED_RIDE / RIDE_REQUEST_DATA_COLLECTION
 * / AM_PM_AMBIGUITY / RIDE_REQUEST_CONFIRMATION, asi que ese UNICO flujo se
 * partio en sub-reglas por prioridad: primero se junta informacion (esta
 * regla), despues se resuelve ambiguedad de hora si existe
 * (AM_PM_AMBIGUITY), y recien ahi se cierra (IMMEDIATE_RIDE /
 * SCHEDULED_RIDE). Ninguna condicion ni excepcion del texto original se
 * elimino, solo se repartio entre reglas.
 */
export const rideRequestDataCollectionRule: Rule = {
  id: 'RIDE_REQUEST_DATA_COLLECTION',
  name: 'Recoleccion de datos del viaje',
  category: 'RIDE_REQUEST_DATA_COLLECTION',
  description:
    'Falta el pickup (siempre REQUIRED) y/o no se pregunto por el destino todavia. Pide los datos uno por uno, nunca junta pasajeros/necesidades especiales salvo que el cliente las mencione solo.',
  priority: 795,
  active: true,
  version: 1,
  trigger: {
    intents: ['IMMEDIATE_RIDE', 'SCHEDULED_RIDE'],
    conditions: [
      { field: 'entities.pickup', operator: 'notExists', description: 'Todavia no se sabe de donde lo recogen' },
    ],
  },
  required_information: ['pickup'],
  optional_information: ['destination'],
  information_not_required: ['passengers', 'specialNeeds'],
  actions: ['ASK_FOR_INFORMATION'],
  forbidden_actions: ['ASK_PASSENGER_COUNT', 'ASK_SPECIAL_NEEDS', 'CREATE_REQUEST', 'ESCALATE_TO_HUMAN'],
  questions: [
    {
      field: 'pickup',
      es: '¿De dónde te paso a buscar?',
      en: "What's the pickup address?",
    },
    {
      field: 'destination',
      es: '¿Y hacia dónde vas? (si no tiene destino fijo, decime nomás)',
      en: 'And where are you headed? (if there’s no fixed destination, just let me know)',
    },
  ],
  confirmation_required: false,
  escalation: { required: false, reason: null },
  response: {
    es: '¿De dónde te paso a buscar?',
    en: "What's the pickup address?",
  },
  gaps: [
    {
      field: 'required_information',
      note:
        'El prompt no aclara si destino es REQUIRED u OPTIONAL para un viaje inmediato sin destino fijo ("si es un viaje sin destino fijo, anotalo asi") -- se modelo como OPTIONAL para IMMEDIATE_RIDE. Para SCHEDULED_RIDE el prompt lista "destination" junto a pickup/date/time sin marcarlo opcional explicitamente; se mantuvo OPTIONAL por consistencia con el mismo parrafo del flujo compartido, pero queda como BUSINESS_RULE_REQUIRED -- ver /docs/business-rules-todo.md.',
    },
  ],
}
