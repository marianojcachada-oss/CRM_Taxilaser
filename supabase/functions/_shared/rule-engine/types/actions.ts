/**
 * Acciones que el Rule Engine puede producir como parte de un Action Plan.
 * El modelo de lenguaje NUNCA elige libremente una accion cuando existe
 * una regla de negocio explicita -- el Rule Engine es quien decide esto.
 */
export const ACTION_TYPES = [
  'ASK_FOR_INFORMATION',
  'CONFIRM_INFORMATION',
  'RESPOND',
  'ESCALATE_TO_HUMAN',
  'CREATE_REQUEST',
  'GET_INFORMATION',
  'CALL_TOOL',
  'WAIT_FOR_CONFIRMATION',
  'END_FLOW',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

/**
 * Una accion concreta dentro de un Action Plan. `payload` es intencionalmente
 * libre (Record<string, unknown>) porque cada ActionType tiene su propia
 * forma de datos (p. ej. ASK_FOR_INFORMATION lleva `field`, CALL_TOOL lleva
 * `toolName` + `args`). Los helpers tipados viven en engine/actionPlanner.ts.
 */
export interface EngineAction {
  type: ActionType
  payload?: Record<string, unknown>
  /** Para trazabilidad: que regla origino esta accion. */
  producedByRuleId: string
}
