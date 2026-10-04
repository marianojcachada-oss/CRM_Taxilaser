import type { Rule } from '../types/index.ts'
import { greetingRule } from './01-greeting.rule.ts'
import { immediateRideRule } from './02-immediate-ride.rule.ts'
import { scheduledRideRule } from './03-scheduled-ride.rule.ts'
import { rideRequestDataCollectionRule } from './04-ride-request-data-collection.rule.ts'
import { amPmAmbiguityRule } from './05-am-pm-ambiguity.rule.ts'
import { rideRequestConfirmationRule } from './06-ride-request-confirmation.rule.ts'
import { cancellationRule } from './07-cancellation.rule.ts'
import { rideStatusRule } from './08-ride-status.rule.ts'
import { lostItemRule } from './09-lost-item.rule.ts'
import { deliveryRule } from './10-delivery.rule.ts'
import { humanOperatorRequestRule } from './11-human-operator-request.rule.ts'
import { fareInquiryRule } from './12-fare-inquiry.rule.ts'
import { ambiguousLocationRule } from './13-ambiguous-location.rule.ts'
import { outOfServiceAreaRule } from './14-out-of-service-area.rule.ts'
import { unknownIntentRule } from './15-unknown-intent.rule.ts'
import { unsafeOrUncertainRequestRule } from './16-unsafe-or-uncertain-request.rule.ts'

/**
 * Las 16 reglas pedidas en el encargo, convertidas desde el
 * AI_SYSTEM_PROMPT v4 de Taxi Laser (ver cabecera de cada archivo para la
 * cita exacta de donde sale cada una). Este array es el seed inicial del
 * MockRuleRepository -- en produccion, SupabaseRuleRepository leeria esto
 * mismo desde una tabla editable por el panel admin.
 */
export const INITIAL_RULES: Rule[] = [
  greetingRule,
  immediateRideRule,
  scheduledRideRule,
  rideRequestDataCollectionRule,
  amPmAmbiguityRule,
  rideRequestConfirmationRule,
  cancellationRule,
  rideStatusRule,
  lostItemRule,
  deliveryRule,
  humanOperatorRequestRule,
  fareInquiryRule,
  ambiguousLocationRule,
  outOfServiceAreaRule,
  unknownIntentRule,
  unsafeOrUncertainRequestRule,
]

export {
  greetingRule,
  immediateRideRule,
  scheduledRideRule,
  rideRequestDataCollectionRule,
  amPmAmbiguityRule,
  rideRequestConfirmationRule,
  cancellationRule,
  rideStatusRule,
  lostItemRule,
  deliveryRule,
  humanOperatorRequestRule,
  fareInquiryRule,
  ambiguousLocationRule,
  outOfServiceAreaRule,
  unknownIntentRule,
  unsafeOrUncertainRequestRule,
}
