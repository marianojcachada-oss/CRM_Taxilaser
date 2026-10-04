/**
 * KNOWLEDGE, no RULES (ver /docs/rule-engine.md -- seccion "Knowledge vs
 * Rules"). Esto es informacion factual de la empresa: que ciudades cubre
 * Taxi Laser. El Rule Engine consulta esto, pero el dato en si no vive
 * hardcodeado dentro del motor ni de ninguna regla -- vive aca, como un
 * modulo de conocimiento separado, tal como pide el encargo.
 *
 * Fuente: AI_SYSTEM_PROMPT v4, seccion "ZONA DE COBERTURA" (3/10/2026).
 */
export interface ServiceAreaKnowledge {
  /** Ciudades de Georgia donde opera Taxi Laser. */
  coveredCities: string[]
  /** Texto libre: "y alrededores" -- el prompt original no define un radio exacto. */
  coverageNote: string
}

export const SERVICE_AREA: ServiceAreaKnowledge = {
  coveredCities: [
    'Norcross',
    'Peachtree Corners',
    'Duluth',
    'Lawrenceville',
    'Suwanee',
    'Tucker',
    'Chamblee',
  ],
  coverageNote: 'y alrededores',
}

/**
 * NOTA (BUSINESS_RULE_REQUIRED, ver /docs/business-rules-todo.md):
 * el prompt original no define una lista de lugares/comercios conocidos por
 * ciudad, ni un radio concreto para "y alrededores", ni un listado de
 * ciudades fuera de zona pero cercanas que SI se cubren a veces. Esta
 * knowledge base queda intencionalmente minima -- solo lo que el prompt
 * define -- hasta que el negocio lo precise.
 */
export function isKnownCoveredCity(city: string): boolean {
  const normalized = city.trim().toLowerCase()
  return SERVICE_AREA.coveredCities.some((c) => c.toLowerCase() === normalized)
}
