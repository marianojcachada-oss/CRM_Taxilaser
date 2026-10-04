// supabase/functions/_shared/rule-engine-adapters/staticRuleRepository.ts
//
// Implementacion de RuleRepository que sirve las 16 reglas directo desde
// codigo (rule-engine/rules/index.ts), sin base de datos.
//
// DECISION DE ALCANCE (fase 1 del port): las reglas todavia NO son
// editables desde un panel admin en produccion -- eso (SupabaseRuleRepository
// + UI, portando el panel del prototipo) queda para una segunda fase.
// Por ahora, cambiar una regla significa editar su archivo en
// rule-engine/rules/ y desplegar la funcion -- igual que cualquier otro
// cambio de logica de negocio en este proyecto.

import type { Rule, RuleVersionEntry } from "../rule-engine/types/index.ts";
import { INITIAL_RULES } from "../rule-engine/rules/index.ts";
import type { RuleRepository } from "../rule-engine/engine/RuleRepository.ts";

export class StaticRuleRepository implements RuleRepository {
  private readonly rules: Rule[] = INITIAL_RULES;

  async getAll(): Promise<Rule[]> {
    return this.rules;
  }

  async getActive(): Promise<Rule[]> {
    return this.rules.filter((r) => r.active).sort((a, b) => b.priority - a.priority);
  }

  async getById(id: string): Promise<Rule | null> {
    return this.rules.find((r) => r.id === id) ?? null;
  }

  async getHistory(_id: string): Promise<RuleVersionEntry[]> {
    return [];
  }

  async update(_id: string, _patch: Partial<Rule>): Promise<Rule> {
    throw new Error(
      "Las reglas todavia no son editables en produccion (fase 1 del port) -- editá el archivo en rule-engine/rules/ y volvé a desplegar.",
    );
  }

  async setActive(_id: string, _active: boolean): Promise<Rule> {
    throw new Error(
      "Las reglas todavia no son editables en produccion (fase 1 del port) -- editá el archivo en rule-engine/rules/ y volvé a desplegar.",
    );
  }
}
