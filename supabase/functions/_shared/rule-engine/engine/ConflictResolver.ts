import type { Rule } from '../types/index.ts'

export interface RuleConflict {
  /** Regla de menor prioridad cuyas acciones chocaron con la regla ganadora. */
  suppressedRuleId: string
  /** Acciones de esa regla que se descartaron por estar prohibidas por la ganadora. */
  suppressedActions: string[]
  reason: string
}

export interface ConflictResolution {
  selectedRule: Rule | null
  conflicts: RuleConflict[]
}

/**
 * Estrategia de resolucion de conflictos (encargo, seccion "MULTIPLES
 * INTENCIONES"): entre las reglas que matchearon (`matchedRules`, ya
 * ordenadas de mayor a menor prioridad por el RuleRepository/RuleEngine),
 * la de mayor prioridad numerica gana y pasa a ser `selectedRule`. Para
 * cada regla de menor prioridad que tambien matcheo, cualquier accion
 * suya que figure en `forbidden_actions` de la ganadora se registra como
 * conflicto detectado y se descarta -- nunca se ejecutan dos acciones
 * incompatibles sin que quede registrado.
 *
 * Ejemplo del encargo: "I need a taxi [...] and how much will it cost?"
 * -> matchean FARE_INQUIRY (900) e IMMEDIATE_RIDE/RIDE_REQUEST_DATA_COLLECTION
 * (700/740). FARE_INQUIRY gana. IMMEDIATE_RIDE tiene `ASK_FOR_INFORMATION`
 * entre sus acciones implicitas de flujo, que no esta en su propio
 * forbidden_actions pero SI heredaria el intento de pedir pickup/destino
 * -- eso queda prohibido explicitamente por FARE_INQUIRY.forbidden_actions
 * (REQUEST_PICKUP, REQUEST_DESTINATION), asi que se suprime y se
 * registra el conflicto.
 */
export function resolveConflicts(matchedRules: Rule[]): ConflictResolution {
  if (matchedRules.length === 0) {
    return { selectedRule: null, conflicts: [] }
  }

  const [selectedRule, ...rest] = matchedRules
  const conflicts: RuleConflict[] = []

  for (const rule of rest) {
    const suppressedActions = rule.actions.filter((action) =>
      selectedRule!.forbidden_actions.includes(action),
    )
    const selectedActions: string[] = selectedRule!.actions
    const suppressedForbidden = rule.forbidden_actions.filter((forbidden) =>
      selectedActions.includes(forbidden),
    )
    const allSuppressed = [...new Set([...suppressedActions, ...suppressedForbidden])]
    if (allSuppressed.length > 0) {
      conflicts.push({
        suppressedRuleId: rule.id,
        suppressedActions: allSuppressed,
        reason: `"${selectedRule!.id}" (prioridad ${selectedRule!.priority}) le gana a "${rule.id}" (prioridad ${rule.priority}); se suprimen sus acciones incompatibles.`,
      })
    }
  }

  return { selectedRule: selectedRule ?? null, conflicts }
}
