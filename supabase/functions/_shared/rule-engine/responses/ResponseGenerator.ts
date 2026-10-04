import type { Rule, RuleResponse } from '../types/index.ts'

/**
 * Genera el texto final de respuesta a partir de una regla + el idioma de
 * la conversacion + variables dinamicas (templates). Las respuestas FIJAS
 * (comportamiento que no depende de datos dinamicos) viven como string
 * literal en `rule.response.{en,es}`; cuando dependen de un dato dinamico
 * (hora propuesta, resumen de viaje activo) se usa un placeholder
 * `{{variable}}` que esta funcion reemplaza -- nunca se inventa el valor
 * aca, lo provee quien llama (agent/AIAgent.ts) a partir de un provider
 * real o mock (encargo, "RESPUESTAS": "Cuando la respuesta dependa de
 * informacion dinamica, usar templates.").
 */
export function renderResponse(
  response: RuleResponse,
  language: 'es' | 'en',
  variables: Record<string, string> = {},
): string {
  const template = response[language] ?? response.es
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? `{{${key}}}`)
}

export function renderRuleResponse(rule: Rule, language: 'es' | 'en', variables: Record<string, string> = {}): string {
  return renderResponse(rule.response, language, variables)
}

export function renderEscalationMessage(
  rule: Rule,
  language: 'es' | 'en',
  variables: Record<string, string> = {},
): string | null {
  if (!rule.escalation.message) return null
  return renderResponse(rule.escalation.message, language, variables)
}
