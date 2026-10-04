import type { ConversationState, DetectedIntent, ExtractedEntities, Rule, RideEntities } from '../types/index.ts'
import { RuleEngine } from '../engine/RuleEngine.ts'
import type { IntentDetector } from '../engine/IntentDetector.ts'
import type { RuleConflict } from '../engine/ConflictResolver.ts'
import { resolveNextOccurrence, parseRawTime } from '../engine/dateUtil.ts'
import type { ConversationStateStore } from '../state/ConversationStateStore.ts'
import type { ReservationProvider } from '../providers/ReservationProvider.ts'
import type { MessagingProvider } from '../providers/MessagingProvider.ts'
import { renderRuleResponse, renderEscalationMessage } from '../responses/ResponseGenerator.ts'

export interface AgentTurnResult {
  customerMessage: string
  detectedIntents: DetectedIntent[]
  extractedEntities: ExtractedEntities
  matchedRules: Array<{ id: string; priority: number }>
  selectedRule: Rule | null
  conflicts: RuleConflict[]
  actions: string[]
  forbiddenActions: string[]
  requiredInformationMissing: string[]
  escalation: { required: boolean; reason: string | null }
  finalResponse: string
  state: ConversationState
}

const AFFIRMATIVE_WORDS = new Set(['si', 'sí', 'yes', 'ok', 'okay', 'dale', 'correcto', 'perfecto'])

/**
 * Chequeo de "si, confirmo" deliberadamente simple (set de palabras +
 * un par de frases cortas), sin \b de regex: los acentos del espanol
 * (si/sí) no cuentan como caracteres de palabra para JS, asi que un \b
 * despues de una vocal acentuada al final del string NUNCA matchea -- se
 * evita ese problema normalizando y comparando como texto plano.
 */
function isAffirmativeReply(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.,!?¡¿]/g, '')
    .trim()
  if (AFFIRMATIVE_WORDS.has(normalized)) return true
  return /^(asi esta bien|as[ií] est[aá] bien|that works|sounds good)/.test(normalized)
}

/**
 * Intenciones que SIEMPRE interrumpen un flujo en curso (p. ej. el
 * cliente estaba respondiendo "de donde te paso a buscar" y de repente
 * pregunta el precio) -- si el detector encuentra alguna de estas, NO se
 * trata el mensaje como respuesta a la pregunta pendiente.
 */
const INTERRUPT_INTENTS = new Set([
  'FARE_INQUIRY',
  'CANCELLATION',
  'RIDE_STATUS',
  'LOST_ITEM',
  'DELIVERY',
  'HUMAN_OPERATOR_REQUEST',
])

/**
 * Orquestador del pipeline completo pedido en el encargo:
 *   AI Agent -> Intent Detection -> Rule Engine -> Rule Matching ->
 *   Priority Resolution -> Action Plan -> Tool / Mock Tool ->
 *   Response Generation
 *
 * El modelo de lenguaje (IntentDetector, mockeado hoy) SOLO interpreta el
 * mensaje. Esta clase nunca decide una accion por su cuenta cuando el
 * RuleEngine ya determino cual regla aplica -- solo ejecuta el Action Plan
 * que la regla seleccionada define.
 */
export class AIAgent {
  private readonly ruleEngine: RuleEngine

  constructor(
    ruleEngineDeps: ConstructorParameters<typeof RuleEngine>[0],
    private readonly intentDetector: IntentDetector,
    private readonly stateStore: ConversationStateStore,
    private readonly reservationProvider: ReservationProvider,
    private readonly messagingProvider: MessagingProvider,
  ) {
    this.ruleEngine = new RuleEngine(ruleEngineDeps)
  }

  async processMessage(conversationId: string, message: string): Promise<AgentTurnResult> {
    const state = await this.stateStore.get(conversationId)

    const detection = await this.intentDetector.detect(message, state)

    // --- Paso especial: hay una confirmacion de hora ambigua pendiente.
    // Solo se interpreta el mensaje como respuesta a ESA pregunta cuando
    // no hay a su vez una ASK_FOR_INFORMATION pendiente (p. ej. todavia
    // esperando el pickup) -- si ambas estuvieran activas, el pickup se
    // pregunto primero (ver prioridades de reglas) y tiene que
    // resolverse primero. ---
    if (
      state.waitingForConfirmation &&
      state.waitingForConfirmationField === 'time' &&
      state.pendingQuestions.length === 0
    ) {
      const resolved = this.resolvePendingTimeConfirmation(state, message)
      if (resolved && state.intent) {
        // La confirmacion/correccion ya actualizo el estado; se fuerza la
        // intencion al flujo que seguia abierto para que el RuleEngine
        // decida el siguiente paso (cierre de la reserva, o volver a
        // pedir confirmacion si la correccion seguia siendo ambigua) en
        // vez de tratar "si" o "10am" como un mensaje nuevo sin intencion.
        detection.intents = [{ intent: state.intent, confidence: 1, matchedText: 'continued flow (time confirmation)' }]
      }
    }
    if (detection.entities.language) {
      state.language = detection.entities.language
    }

    // --- Conversation State awareness (encargo, seccion "ESTADO DE LA
    // CONVERSACION"): si hay una pregunta pendiente (p. ej. "cual es tu
    // direccion de recogida?") y el mensaje no interrumpe con otra
    // intencion explicita, se interpreta el mensaje entero como la
    // respuesta a esa pregunta -- la IA NO debe volver a preguntar lo
    // mismo. ---
    if (state.pendingQuestions.length > 0 && !detection.intents.some((d) => INTERRUPT_INTENTS.has(d.intent))) {
      const pending = state.pendingQuestions[0]!
      const trimmed = message.trim()
      if (trimmed.length > 0) {
        ;(state.entities as unknown as Record<string, unknown>)[pending.field] = trimmed
        state.pendingQuestions = []
        if (state.intent) {
          detection.intents = [{ intent: state.intent, confidence: 1, matchedText: 'continued flow (pending question answered)' }]
        }
      }
    }

    this.mergeEntities(state, detection.entities)

    const engineResult = await this.ruleEngine.evaluate(detection.intents, detection.entities, state)
    const { selectedRule, matchedRules, conflicts, missingRequiredInformation } = engineResult

    let finalResponse = ''
    const forbiddenActions = selectedRule?.forbidden_actions ?? []

    if (selectedRule) {
      // El intent "oficial" de la conversacion se toma de las intenciones
      // REALMENTE detectadas este turno que hicieron matchear la regla
      // ganadora (no del orden arbitrario de `rule.trigger.intents`) --
      // asi una reserva programada no se "degrada" a IMMEDIATE_RIDE solo
      // porque una regla generica (RIDE_REQUEST_DATA_COLLECTION,
      // AM_PM_AMBIGUITY) lista ambos intents en su trigger.
      const winningMatch = matchedRules.find((m) => m.rule.id === selectedRule.id)
      state.intent = winningMatch?.matchedIntents[0] ?? state.intent
      state.detectedIntents = detection.intents.map((d) => d.intent)
      state.currentRuleId = selectedRule.id
      state.appliedRuleIds = [...state.appliedRuleIds, selectedRule.id]

      finalResponse = await this.executeActions(selectedRule, state)

      if (selectedRule.escalation.required) {
        state.escalated = true
        state.escalationReason = selectedRule.escalation.reason
      }
    } else {
      finalResponse =
        state.language === 'en'
          ? 'One of our operators will reply to you shortly.'
          : 'Ya te va a contestar uno de nuestros operadores.'
    }

    state.updatedAt = new Date().toISOString()
    await this.stateStore.save(state)
    await this.messagingProvider.send(conversationId, finalResponse)

    return {
      customerMessage: message,
      detectedIntents: detection.intents,
      extractedEntities: detection.entities,
      matchedRules: matchedRules.map((m) => ({ id: m.rule.id, priority: m.rule.priority })),
      selectedRule,
      conflicts,
      actions: selectedRule?.actions ?? [],
      forbiddenActions,
      requiredInformationMissing: missingRequiredInformation,
      escalation: {
        required: selectedRule?.escalation.required ?? false,
        reason: selectedRule?.escalation.reason ?? null,
      },
      finalResponse,
      state,
    }
  }

  /**
   * Intenta resolver una confirmacion pendiente de hora ambigua (ver
   * regla AM_PM_AMBIGUITY). Devuelve true si pudo interpretar el mensaje
   * como confirmacion/correccion; deja el ConversationState listo para
   * que el resto del pipeline (deteccion + RuleEngine) decida el proximo
   * paso con la hora ya resuelta (o siga esperando si la correccion
   * tampoco trajo un AM/PM claro).
   */
  private resolvePendingTimeConfirmation(state: ConversationState, message: string): boolean {
    if (isAffirmativeReply(message)) {
      state.entities.time = state.proposedValue
      state.confirmedEntities = [...new Set([...state.confirmedEntities, 'time' as const])]
      state.waitingForConfirmation = false
      state.waitingForConfirmationField = null
      state.proposedValue = null
      return true
    }

    // Correccion: buscar una hora explicita (con o sin AM/PM) en el mensaje.
    const correctionMatch = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
    if (correctionMatch) {
      const hour = Number(correctionMatch[1])
      const minute = correctionMatch[2] ? Number(correctionMatch[2]) : 0
      const ampm = correctionMatch[3]?.toUpperCase() as 'AM' | 'PM' | undefined
      if (ampm) {
        state.entities.time = `${hour}:${String(minute).padStart(2, '0')} ${ampm}`
        state.confirmedEntities = [...new Set([...state.confirmedEntities, 'time' as const])]
        state.waitingForConfirmation = false
        state.waitingForConfirmationField = null
        state.proposedValue = null
        return true
      }
      // Sigue ambigua -> se vuelve a proponer con la nueva hora cruda.
      const resolved = resolveNextOccurrence(hour, minute)
      state.proposedValue = resolved.label
      state.entities.rawTime = `${hour}:${String(minute).padStart(2, '0')}`
      return true
    }

    // No se encontro ninguna hora nueva en la correccion -- se mantiene en
    // espera (el AIAgent va a volver a preguntar via AM_PM_AMBIGUITY si el
    // RuleEngine la vuelve a matchear).
    return false
  }

  private mergeEntities(state: ConversationState, extracted: ExtractedEntities): void {
    const entities: RideEntities = state.entities

    if (extracted.pickup) entities.pickup = extracted.pickup
    if (extracted.destination) entities.destination = extracted.destination
    if (extracted.date) entities.date = extracted.date
    if (extracted.city) entities.city = extracted.city
    if (typeof extracted.scheduled === 'boolean') entities.scheduled = extracted.scheduled
    if (extracted.cancellationReason) entities.cancellationReason = extracted.cancellationReason
    if (extracted.lostItemDescription) entities.lostItemDescription = extracted.lostItemDescription

    if (extracted.rawTime) {
      if (extracted.timeHasAmPm) {
        entities.time = extracted.rawTime
        entities.rawTime = extracted.rawTime
        state.confirmedEntities = [...new Set([...state.confirmedEntities, 'time' as const])]
      } else {
        // Hora ambigua: se guarda cruda, NUNCA se confirma sola (ver
        // AM_PM_AMBIGUITY). Se propone la proxima ocurrencia logica para
        // que la regla se la muestre al cliente.
        entities.rawTime = extracted.rawTime
        const parsed = parseRawTime(extracted.rawTime)
        if (parsed) {
          const resolved = resolveNextOccurrence(parsed.hour, parsed.minute)
          state.proposedValue = resolved.label
          state.waitingForConfirmation = true
          state.waitingForConfirmationField = 'time'
        }
      }
    }
  }

  private async executeActions(rule: Rule, state: ConversationState): Promise<string> {
    const language = state.language

    if (rule.actions.includes('CONFIRM_INFORMATION') && rule.id === 'AM_PM_AMBIGUITY') {
      return renderRuleResponse(rule, language, { proposedTime: state.proposedValue ?? '' })
    }

    if (rule.id === 'RIDE_STATUS') {
      const activeRide = await this.reservationProvider.getActiveRide(state.conversationId)
      if (!activeRide) {
        return (
          renderEscalationMessage(rule, language) ??
          (language === 'en'
            ? "I don't see an active ride under your name right now. An operator will confirm."
            : 'No encuentro un viaje activo a tu nombre en este momento. Un operador lo va a confirmar.')
        )
      }
      // Nunca se inventa un campo que falte -- si contacts.active_ride_*
      // no tiene un dato puntual, se muestra "sin dato" en vez de omitirlo
      // en silencio o completarlo con un valor plausible.
      const sinDato = language === 'en' ? 'no data' : 'sin dato'
      const color = activeRide.color ?? sinDato
      const plate = activeRide.plate ?? sinDato
      const unit = activeRide.unit ?? sinDato
      const status = activeRide.status ?? sinDato
      const eta = activeRide.etaMinutes ?? sinDato
      const summary =
        language === 'en'
          ? `${color} taxi, unit ${unit}, plate ${plate} -- ${status}, ETA ${eta} min.`
          : `Taxi ${color}, unidad ${unit}, patente ${plate} -- ${status}, ETA ${eta} min.`
      return renderRuleResponse(rule, language, { activeRideSummary: summary })
    }

    if (rule.actions.includes('CREATE_REQUEST')) {
      await this.reservationProvider.createReservation({
        conversationId: state.conversationId,
        pickup: state.entities.pickup ?? '',
        destination: state.entities.destination,
        scheduledFor: state.entities.scheduled ? `${state.entities.date ?? ''} ${state.entities.time ?? ''}`.trim() : null,
      })
    }

    if (rule.escalation.required) {
      return renderEscalationMessage(rule, language) ?? renderRuleResponse(rule, language)
    }

    if (rule.actions.includes('ASK_FOR_INFORMATION') && rule.questions.length > 0) {
      const missingField = rule.required_information.find(
        (field) => !(state.entities as unknown as Record<string, unknown>)[field],
      )
      const question = rule.questions.find((q) => q.field === missingField) ?? rule.questions[0]!
      state.pendingQuestions = [{ field: question.field as keyof RideEntities, es: question.es, en: question.en, ruleId: rule.id }]
      return question[language]
    }

    return renderRuleResponse(rule, language)
  }
}
