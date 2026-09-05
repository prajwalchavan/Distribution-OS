/**
 * Incentives' only entry point (`eslint-plugin-boundaries`). It is the LEAF of the module chain
 * (CLAUDE.md's order ends `… → reporting → integrations → incentives`): nothing downstream imports
 * it, and nothing consumes one of its events to change state elsewhere.
 *
 * What the worker imports lives in `worker.ts` and reaches it as `@dos/core/incentives`, so the
 * pg-boss process never touches a Nest decorator.
 */
export { IncentivesModule } from './incentives.module.js'
export { TargetsService } from './targets.service.js'
export { StatementsService } from './statements.service.js'
/** The outbox event names notifications and reporting may one day translate (brief §7). */
export {
  INCENTIVE_EVENTS,
  parseRecomputePayload,
  type IncentiveEvent,
} from './incentives.internals.js'
/**
 * The achievement cache: computed by the worker, read by every screen. Exported so the worker's job
 * file and the docs examples can reach them; every one is a plain function (coordination §3.9).
 */
export {
  computeAchievement,
  recomputeAchievement,
  sweepAchievements,
  writeAchievement,
  SWEEP_TARGET_LIMIT,
  type AchievementFigures,
  type SweepResult,
  type TargetForAchievement,
} from './achievements.js'
