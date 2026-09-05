import { paise, percentOf, type Paise } from '../money.js'

/**
 * Incentive slab evaluation — the one place that turns "how far along is this rep" into "what that
 * pays" (docs/plans/incentives.md §4.6–§4.7, coordination §7 q32).
 *
 * PURE AND DEPENDENCY-FREE, exactly like `priceOrder()`: no database, no clock, no contract import
 * (`@dos/domain` must bundle into Expo unchanged, CLAUDE.md). The API's `targets.whatIf`, the API's
 * `statements.compute` and the worker's achievement sweep all call the SAME functions, so an owner
 * tuning slabs on screen and the statement printed at month end can never disagree.
 *
 * THE THREE RULES THE FOUNDER ANSWERED (coordination §7 q32, docs/plans/incentives.md §8.5):
 *
 *  1. ONLY THE SLAB REACHED, NEVER CUMULATIVE. A rep at 105% of target on a table of 80% / 100% /
 *     120% earns the 100% slab's amount alone — not the 80% slab added underneath it. This is the
 *     same convention docs/17 §B fixes for pricing scheme slabs ("highest achieved slab only").
 *  2. NOTHING BELOW THE LOWEST SLAB. An achievement under every slab's `fromPct` pays 0 and matches
 *     no slab at all (`matchedSlab: null` on the wire, so a screen can say "not yet in the money").
 *  3. NO EXTRAPOLATION ABOVE THE TOP SLAB. The top tier is open-ended (`toPct` null / absent) and
 *     pays exactly its own amount however far past it the rep goes — 300% of target pays the same as
 *     121% on the table above. A cap is the absence of a further slab, not a `Math.min`.
 *
 * BASIS POINTS THROUGHOUT (the contract's `incentives.ts` header fixes the same convention):
 * `fromPct` / `toPct` / the returned `achievedPct` are basis points OF ACHIEVEMENT — 100% of target
 * is 10000 — and `achievedPct` is UNCAPPED, so a rep at 140% reads 14000. `payoutBps` is basis points
 * OF THE TARGET'S PAISE and is therefore a true 0..10000 share; the contract refuses it on any metric
 * whose target is a count rather than money, so `slabPayoutPaise` never divides a "lines" target by
 * anything.
 *
 * INTEGER ARITHMETIC ONLY. `achievedPctBps` rounds half-up to a whole basis point and `percentOf`
 * rounds half-up to the paise; no float ever reaches a statement.
 */

/** 100% of target, in basis points. A rep exactly on target reads this. */
export const ACHIEVEMENT_FULL_BPS = 10_000

/**
 * One row of a payout table. Structural on purpose: `@dos/domain` may not import `@dos/contracts`,
 * and the contract's `PayoutSlab` satisfies this shape exactly (`toPct` optional AND nullable,
 * because "the top tier" is written either way on the wire and read from `jsonb` as `null`).
 */
export interface PayoutSlabLike {
  /** Inclusive lower bound of the band, in basis points of achievement. */
  fromPct: number
  /** Exclusive upper bound; null / absent means open-ended (the top tier). */
  toPct?: number | null | undefined
  /** Basis points OF THE TARGET'S PAISE. Money metrics only (the contract enforces it). */
  payoutBps?: number | undefined
  /** A fixed amount in paise, whatever the metric measures. */
  flatPaise?: number | undefined
}

export interface PayoutEvaluation<T extends PayoutSlabLike = PayoutSlabLike> {
  /** `achievedValue / targetValue` in basis points, rounded half-up, UNCAPPED. */
  achievedPct: number
  /** The band the achievement fell in, or null when it is below every slab. */
  matchedSlab: T | null
  payoutPaise: Paise
}

export class SlabError extends Error {
  override name = 'SlabError'
}

/**
 * `round(achievedValue * 10000 / targetValue)`, the one definition of "how far along". `targetValue`
 * is `> 0` at every entry point (the contract's `z.number().int().positive()`), so this never divides
 * by zero; a non-positive target is a programming error and says so rather than answering Infinity.
 *
 * Both figures are in the SAME unit — paise for `value` / `collections`, a plain count for
 * `pieces` / `lines` / `outlets` / `visits` — so the ratio is unit-free either way.
 */
export function achievedPctBps(achievedValue: number, targetValue: number): number {
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    throw new SlabError(`targetValue must be a positive integer, got ${targetValue}`)
  }
  if (achievedValue <= 0) return 0
  return Math.round((achievedValue * ACHIEVEMENT_FULL_BPS) / targetValue)
}

/**
 * The slab an achievement falls in: `[fromPct, toPct)` half-open, open-ended when `toPct` is null.
 *
 * Slabs are NOT required to be sorted and overlapping ones are NOT refused (docs/plans/incentives.md
 * §4.6 leaves that to the owner console), so the tie-break is stated here rather than assumed: among
 * every band that contains the achievement, the one with the HIGHEST `fromPct` wins, and two bands
 * with the same `fromPct` resolve to the one written first. Deterministic, whatever order the table
 * arrived in.
 */
export function matchSlab<T extends PayoutSlabLike>(
  payoutRule: readonly T[],
  achievementBps: number,
): T | null {
  let best: T | null = null
  for (const slab of payoutRule) {
    const upper = slab.toPct ?? null
    if (achievementBps < slab.fromPct) continue
    if (upper !== null && achievementBps >= upper) continue
    if (best === null || slab.fromPct > best.fromPct) best = slab
  }
  return best
}

/**
 * What one slab pays. Exactly one of `payoutBps` and `flatPaise` carries the reward (the contract
 * refuses a slab with both or neither before any handler runs); `payoutBps` is a share of the
 * target's paise, so it is only ever set on a money metric.
 */
export function slabPayoutPaise(slab: PayoutSlabLike, targetValue: number): Paise {
  const hasBps = slab.payoutBps !== undefined && slab.payoutBps !== null
  const hasFlat = slab.flatPaise !== undefined && slab.flatPaise !== null
  if (hasBps === hasFlat) {
    throw new SlabError('a slab carries exactly one of payoutBps and flatPaise')
  }
  if (hasFlat) return paise(slab.flatPaise as number)
  return percentOf(paise(targetValue), slab.payoutBps as number)
}

/**
 * The whole computation for one target: how far along, which band, what it pays. Used by
 * `targets.whatIf` (a hypothetical the owner types), by `statements.compute` (once per target of the
 * period) and by nothing else — there is no second implementation to drift from this one.
 */
export function evaluatePayout<T extends PayoutSlabLike>(input: {
  targetValue: number
  achievedValue: number
  payoutRule: readonly T[]
}): PayoutEvaluation<T> {
  const achievedPct = achievedPctBps(input.achievedValue, input.targetValue)
  const matchedSlab = matchSlab(input.payoutRule, achievedPct)
  return {
    achievedPct,
    matchedSlab,
    payoutPaise: matchedSlab ? slabPayoutPaise(matchedSlab, input.targetValue) : paise(0),
  }
}
