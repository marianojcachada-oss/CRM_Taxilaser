import type { ConversationState, DetectedIntent, ExtractedEntities, IntentType, Rule } from '../types/index.ts'
import type { RuleRepository } from './RuleRepository.ts'
import { evaluateConditions, type RuleEvaluationContext } from './conditionEvaluator.ts'
import { resolveConflicts, type RuleConflict } from './ConflictResolver.ts'

export interface RuleMatch {
  rule: Rule
  matchedIntents: IntentType[]
}

export interface RuleEngineResult {
  matchedRules: RuleMatch[]
  selectedRule: Rule | null
  conflicts: RuleConflict[]
  /** required_information de la regla seleccionada que todavia esta en null en el estado. */
  missingRequiredInformation: string[]
}

/**
 * El Rule Engine en si: Rule Matching -> Priority Resolution -> (salida
 * lista para que agent/AIAgent.ts arme el Action Plan). No genera texto
 * ni toca el ConversationState -- solo decide QUE regla manda. "El modelo
 * interpreta el lenguaje natural. El Rule Engine determina el
 * comportamiento empresarial." (encargo, seccion ARQUITECTURA).
 */
export class RuleEngine {
  constructor(private readonly repository: RuleRepository) {}

  async evaluate(
    detectedIntents: DetectedIntent[],
    extractedEntities: ExtractedEntities,
    state: ConversationState,
  ): Promise<RuleEngineResult> {
    const activeRules = await this.repository.getActive()
    const intentSet = new Set(detectedIntents.map((d) => d.intent))

    const context: RuleEvaluationContext = {
      entities: state.entities as unknown as Record<string, unknown>,
      extractedEntities: extractedEntities as unknown as Record<string, unknown>,
      conversationState: state as unknown as Record<string, unknown>,
      matchedRuleHasUnresolvedGap: false,
    }

    const matchedRules: RuleMatch[] = []
    for (const rule of activeRules) {
      const matchedIntents = rule.trigger.intents.filter((i) => intentSet.has(i))
      if (matchedIntents.length === 0) continue
      if (!evaluateConditions(rule.trigger.conditions, context)) continue
      matchedRules.push({ rule, matchedIntents })
    }

    // Ya vienen ordenadas por prioridad desc desde el repository.getActive(),
    // pero lo reafirmamos aca porque el orden es el corazon de la
    // resolucion de conflictos.
    matchedRules.sort((a, b) => b.rule.priority - a.rule.priority)

    const { selectedRule, conflicts } = resolveConflicts(matchedRules.map((m) => m.rule))

    const missingRequiredInformation = selectedRule
      ? selectedRule.required_information.filter((field) => {
          const value = (state.entities as unknown as Record<string, unknown>)[field]
          return value === null || value === undefined || value === ''
        })
      : []

    return { matchedRules, selectedRule, conflicts, missingRequiredInformation }
  }
}
