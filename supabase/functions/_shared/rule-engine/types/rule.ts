import type { ActionType } from './actions.ts'
import type { IntentType } from './intent.ts'

/** Nivel de necesidad de un dato dentro de una regla. */
export const INFO_REQUIREMENT = ['REQUIRED', 'OPTIONAL', 'NOT_REQUIRED'] as const
export type InfoRequirement = (typeof INFO_REQUIREMENT)[number]

/**
 * Condicion adicional de disparo de una regla, mas alla del listado de
 * intents. Se evalua contra el ConversationState + ExtractedEntities del
 * turno actual. `field`/`operator`/`value` es deliberadamente generico para
 * no tener que tocar el motor cada vez que se agrega una condicion nueva --
 * las condiciones reales viven como datos en cada regla, no como codigo.
 */
export interface RuleCondition {
  /** Campo del ConversationState o de las entidades extraidas a evaluar. */
  field: string
  operator: 'equals' | 'notEquals' | 'exists' | 'notExists' | 'includesKeyword'
  value?: unknown
  /** Explicacion humana de la condicion, para el panel admin. */
  description?: string
}

export interface RuleTrigger {
  intents: IntentType[]
  conditions: RuleCondition[]
}

/**
 * Una pregunta que la regla puede necesitar hacerle al cliente para juntar
 * un dato REQUIRED/OPTIONAL. `field` referencia una clave de
 * ConversationState.entities.
 */
export interface RuleQuestion {
  field: string
  es: string
  en: string
}

export interface RuleEscalation {
  required: boolean
  reason: string | null
  /** Prioridad de atencion del escalamiento para el operador humano. */
  priority?: 'low' | 'normal' | 'high' | null
  message?: {
    en: string
    es: string
  } | null
}

export interface RuleResponse {
  en: string
  es: string
}

/**
 * Marcador explicito para comportamiento que el prompt original de Taxi
 * Laser NO define con suficiente precision. Nunca se inventa una decision
 * de negocio -- se deja marcada aca y documentada en
 * /docs/business-rules-todo.md (ver REGLA FUNDAMENTAL del encargo).
 */
export interface BusinessRuleGap {
  field: string
  note: string
}

/**
 * Forma completa de una regla de negocio. Superset de la estructura minima
 * pedida (se agregaron `category` como union tipada, `tags`, `gaps` y
 * metadatos de auditoria) -- no se elimino ninguna capacidad pedida.
 */
export interface Rule {
  id: string
  name: string
  category:
    | IntentType
    | 'RIDE_REQUEST_DATA_COLLECTION'
    | 'AM_PM_AMBIGUITY'
    | 'RIDE_REQUEST_CONFIRMATION'
    | 'AMBIGUOUS_LOCATION'
    | 'OUT_OF_SERVICE_AREA'
    | 'UNSAFE_OR_UNCERTAIN_REQUEST'
    | 'UNKNOWN_INTENT'
  description: string

  priority: number
  active: boolean
  version: number

  trigger: RuleTrigger

  required_information: string[]
  optional_information: string[]
  information_not_required: string[]

  actions: ActionType[]
  forbidden_actions: string[]

  questions: RuleQuestion[]

  confirmation_required: boolean

  escalation: RuleEscalation

  response: RuleResponse

  /** Puntos donde el prompt original no alcanza a definir el comportamiento. */
  gaps?: BusinessRuleGap[]

  /** Metadatos de auditoria, no pedidos explicitamente pero necesarios para versioning real. */
  createdAt?: string
  updatedAt?: string
}

/** Entrada de historial de versiones de una regla (para el admin panel). */
export interface RuleVersionEntry {
  version: number
  snapshot: Rule
  savedAt: string
}
