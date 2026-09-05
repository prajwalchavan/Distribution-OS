/**
 * The `ai` module's only entry point (`eslint-plugin-boundaries`). Module 12 in the chain and, like
 * incentives, a LEAF: nothing downstream imports it, and nothing consumes one of its events to change
 * state elsewhere. What it imports is `orders` and `delivery`, through their own `index.ts`.
 *
 * What the worker imports lives in `worker.ts` and reaches it as `@dos/core/ai`, so the pg-boss
 * process never touches a Nest decorator.
 */
export { AiModule } from './ai.module.js'
export { IntakeService } from './intake.service.js'
export { DraftsService, orderSourceFor } from './drafts.service.js'
export { ForecastService } from './forecast.service.js'
export { RoutingService, newestPlanIds, savingMetres } from './routing.service.js'
/** The outbox events the worker registers handlers for, and the module's own configuration. */
export { AI_EVENTS, AI_SETTING_KEYS, type AiEventType } from './ai.internals.js'
export { aiConfig, type AiConfig } from './config.js'
/**
 * The pieces that are plain functions on purpose (coordination §3.9): the worker's daily forecast
 * pass, the inbound-WhatsApp handler, the parser and the SKU matcher. `docs/examples.ts` reads the
 * matcher's thresholds so a published example quotes a phrase that actually matches.
 */
export {
  estimateDemand,
  runForecastPass,
  writeForecasts,
  DEFAULT_HORIZON_DAYS as AI_DEFAULT_FORECAST_HORIZON,
  DEFAULT_LOOKBACK_DAYS as AI_DEFAULT_FORECAST_LOOKBACK,
  FORECAST_PASS_LIMIT,
  type DemandEstimate,
  type ForecastMethod,
  type ForecastPassOptions,
  type ForecastRowValues,
} from './forecast.js'
export { parseInboundMessage, type InboundParseResult } from './inbound.js'
export {
  draftStatusFor,
  lineStatus,
  parseOrderText,
  toDraftLine,
  type DraftLineStatus,
  type ParsedDraftLines,
} from './intake.js'
export {
  listingLabels,
  matchFragments,
  matchPhrase,
  shopHistory,
  AMBIGUOUS_BPS,
  CLEAR_MARGIN_BPS,
  MATCH_BPS,
  type MatchOptions,
  type VariantCandidate,
} from './matcher.js'
export {
  normaliseFragment,
  parseFragment,
  parseMessage,
  piecesFor,
  splitFragments,
  type EnteredUnit,
  type ParsedFragment,
} from './tokenise.js'
