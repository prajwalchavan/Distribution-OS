/**
 * What the pg-boss worker imports, as `@dos/core/ai`. PLAIN FUNCTIONS ONLY — no Nest decorator ever
 * reaches this file, because the worker runs under tsx, which emits no `design:paramtypes` and would
 * hand every injected constructor `undefined` (CLAUDE.md, coordination §3.9 / §13).
 *
 * Two jobs live behind it:
 *
 *   the DAILY FORECAST SWEEP — one pass per tenant per horizon, writing `ai_forecasts` as `system`;
 *   the INBOUND TEXT HANDLER — an `InboundMessageReceived` outbox row becomes a draft order, so a
 *   shop's WhatsApp message appears in the rep's and the manager's queue without anybody typing it.
 */
export { AI_EVENTS, asSystem, type AiEventType } from './ai.internals.js'
export { aiConfig, type AiConfig } from './config.js'
export {
  estimateDemand,
  runForecastPass,
  writeForecasts,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_LOOKBACK_DAYS,
  FORECAST_PASS_LIMIT,
  type DemandEstimate,
  type ForecastMethod,
  type ForecastPassOptions,
  type ForecastRowValues,
} from './forecast.js'
export {
  draftStatusFor,
  lineStatus,
  parseOrderText,
  toDraftLine,
  type DraftLineStatus,
  type ParsedDraftLines,
} from './intake.js'
export { parseInboundMessage, type InboundParseResult } from './inbound.js'
export {
  matchFragments,
  matchPhrase,
  listingLabels,
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
