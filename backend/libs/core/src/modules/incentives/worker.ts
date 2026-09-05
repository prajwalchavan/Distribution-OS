/**
 * `@dos/core/incentives` — what the pg-boss worker imports (coordination §3.9: plain functions, no
 * Nest DI). Kept separate from `index.ts` so the worker never resolves the controller or a Nest
 * module: tsx emits no `design:paramtypes`, and a Nest service instantiated there would silently
 * receive `undefined` dependencies.
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
export {
  INCENTIVE_EVENTS,
  parseRecomputePayload,
  type IncentiveEvent,
} from './incentives.internals.js'
