import { z } from 'npm:zod@3.23.8'
import { ACTION_TYPES } from '../types/actions.ts'
import { INTENT_TYPES } from '../types/intent.ts'

/**
 * Validacion de schema con zod. Se usa en dos lugares:
 *  1. MockRuleRepository.update() -- nunca persiste una regla invalida.
 *  2. admin/server -- valida el body antes de aceptar una edicion desde
 *     el panel web (ver encargo: "NO permitir que una edicion accidental
 *     destruya el schema. Validar los datos.").
 */
const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'notEquals', 'exists', 'notExists', 'includesKeyword']),
  value: z.unknown().optional(),
  description: z.string().optional(),
})

const triggerSchema = z.object({
  intents: z.array(z.enum(INTENT_TYPES)),
  conditions: z.array(conditionSchema),
})

const questionSchema = z.object({
  field: z.string().min(1),
  es: z.string().min(1),
  en: z.string().min(1),
})

const escalationSchema = z.object({
  required: z.boolean(),
  reason: z.string().nullable(),
  priority: z.enum(['low', 'normal', 'high']).nullable().optional(),
  message: z
    .object({ en: z.string(), es: z.string() })
    .nullable()
    .optional(),
})

const responseSchema = z.object({
  en: z.string(),
  es: z.string(),
})

const gapSchema = z.object({
  field: z.string().min(1),
  note: z.string().min(1),
})

export const ruleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int(),
  active: z.boolean(),
  version: z.number().int().positive(),
  trigger: triggerSchema,
  required_information: z.array(z.string()),
  optional_information: z.array(z.string()),
  information_not_required: z.array(z.string()),
  actions: z.array(z.enum(ACTION_TYPES)),
  forbidden_actions: z.array(z.string()),
  questions: z.array(questionSchema),
  confirmation_required: z.boolean(),
  escalation: escalationSchema,
  response: responseSchema,
  gaps: z.array(gapSchema).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type RuleValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] }

export function validateRule(candidate: unknown): RuleValidationResult {
  const result = ruleSchema.safeParse(candidate)
  if (result.success) return { ok: true }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}
