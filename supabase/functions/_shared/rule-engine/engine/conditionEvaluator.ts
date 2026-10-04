import type { RuleCondition } from '../types/index.ts'

/** Lee un path tipo "entities.pickup" o "conversationState.waitingForConfirmation" de un objeto anidado. */
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

/**
 * Contexto contra el cual se evaluan las `conditions` de un RuleTrigger.
 * Es deliberadamente un objeto de datos simple (no una clase) para que
 * agregar un campo nuevo a una condicion de una regla NUNCA requiera
 * tocar este evaluador -- las condiciones son datos, el evaluador es
 * generico (ver encargo: "evitar logica duplicada / reglas hardcodeadas
 * dentro de multiples componentes").
 */
export interface RuleEvaluationContext {
  entities: Record<string, unknown>
  extractedEntities: Record<string, unknown>
  conversationState: Record<string, unknown>
  matchedRuleHasUnresolvedGap: boolean
}

export function evaluateCondition(condition: RuleCondition, context: RuleEvaluationContext): boolean {
  const value = getPath(context, condition.field)
  switch (condition.operator) {
    case 'exists':
      return value !== null && value !== undefined && value !== ''
    case 'notExists':
      return value === null || value === undefined || value === ''
    case 'equals':
      return value === condition.value
    case 'notEquals':
      return value !== condition.value
    case 'includesKeyword':
      return typeof value === 'string' && typeof condition.value === 'string'
        ? value.toLowerCase().includes(condition.value.toLowerCase())
        : false
    default:
      return false
  }
}

export function evaluateConditions(conditions: RuleCondition[], context: RuleEvaluationContext): boolean {
  return conditions.every((condition) => evaluateCondition(condition, context))
}
