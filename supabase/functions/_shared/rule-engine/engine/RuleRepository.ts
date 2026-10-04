import type { Rule, RuleVersionEntry } from '../types/index.ts'

/**
 * Puerto (interfaz) de almacenamiento de reglas. El RuleEngine y el panel
 * admin dependen de ESTA interfaz, nunca de MockRuleRepository
 * directamente -- asi se puede reemplazar por SupabaseRuleRepository mas
 * adelante sin tocar RuleEngine (ver /docs/rule-engine.md, "Principio
 * arquitectonico").
 */
export interface RuleRepository {
  getAll(): Promise<Rule[]>
  getActive(): Promise<Rule[]>
  getById(id: string): Promise<Rule | null>
  getHistory(id: string): Promise<RuleVersionEntry[]>
  /**
   * Reemplaza los campos editables de una regla. Incrementa `version`
   * automaticamente y guarda la version anterior en el historial -- nunca
   * borra versiones previas. Lanza si `patch` rompe el schema (ver
   * engine/ruleValidation.ts).
   */
  update(id: string, patch: Partial<Rule>): Promise<Rule>
  setActive(id: string, active: boolean): Promise<Rule>
}
