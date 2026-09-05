import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'

/**
 * Incentives — what a rep is aiming at, how far along they are, and what that would pay (docs/plans/
 * incentives.md, coordination §1 slot 10, the last module in the downstream chain). It owns `targets`,
 * `achievements` and `computed_payouts` in `database/src/schema/incentives.ts` and nothing else.
 *
 * COMPUTE ONLY, NEVER PAYROLL (brief §1). Nothing on this contract is a legal or accounting document:
 * no series, no GST, no invoice or credit-note reference, no journal entry, no "mark disbursed". A
 * statement is a NUMBER the owner signs off; the money leaves the business outside the system. That is
 * why `statements.approve` is the last thing that ever happens to a statement here.
 *
 * WHICH SERVICES MOUNT `incentives` (docs/plans/00-coordination.md §6 table; `auth-service` mounts nothing):
 *
 *   owner :3001      YES — the whole surface (O20): assign a target, bulk-assign a team's month, tune
 *                    slabs with `targets.whatIf`, watch the leaderboard, compute a period, APPROVE it
 *                    and reopen it. The only service where the five OWNER_ONLY procedures answer
 *   manager :3002    YES — manager + accountant (M21), READ AND RUN THE NUMBERS ONLY: `targets.get/list`,
 *                    `progress.team`, `statements.compute/get/list`, `targets.refresh/whatIf`. Neither
 *                    may create a target or approve a payout — money promised to staff is the owner's
 *                    decision (brief §4.8, coordination §7 q20), and `targets_write` RLS agrees
 *   sales :3003      YES — ITS OWN PROGRESS ONLY (S9 Performance tab): `progress.mine` (no `userId`
 *                    input exists to get wrong), plus `targets.get/list` and `statements.get/list`,
 *                    which RLS (`targets_read`, `achievements_read`, the 0024 `computed_payouts_read`
 *                    split) narrows to the caller's own rows. Every write refuses the role
 *   warehouse :3004  NO — not mounted. The module's scope is salesperson and delivery (brief §1); a
 *                    warehouse-role caller is absent from every row below and gets the same refusal a
 *                    shopkeeper does. Mounting the key there would add dead surface only
 *   delivery :3005   YES — same as sales (D12 "me"): `progress.mine` for the crew's own collections and
 *                    van-sale targets, its own targets and its own statements
 *   retailer :3006   NO — not mounted, and no row below names the role. This is entirely internal staff
 *                    performance data; a shopkeeper never sees what the crew at their door earns
 *
 * FOUNDER ANSWERS (docs/17 §D, docs/22 §8, coordination §7) THAT SHAPE THIS FILE:
 *
 *  1. ACHIEVEMENT IS WHAT WAS BOOKED, not billed and not collected (coordination §7 q6, brief §8.1):
 *     `value` / `pieces` / `lines` / `outlets` read `sales_orders` past `confirmed` and excluding
 *     `cancelled`. A rep still earns on an order that later comes back as a return — the assumption is
 *     recorded, not hidden, and revisiting it changes the worker's aggregate, never this contract.
 *  2. ONLY THE SLAB REACHED, AND NO EXTRAPOLATION ABOVE THE TOP ONE (coordination §7 q32, brief §4.6,
 *     the same convention docs/17 §B fixes for pricing scheme slabs): the matching slab is the one whose
 *     `[fromPct, toPct)` contains `achievedPct`; below every slab's `fromPct` the payout is 0; the top
 *     slab is open-ended and pays exactly its own amount however far past it the rep goes.
 *  3. A REP SEES THE FIGURE BEFORE IT IS APPROVED (coordination §7 q19, brief §8.8): a computed statement
 *     is readable by its own rep with `approvedBy: null`, not hidden until sign-off. The Performance tab
 *     reads it as a live figure, not a payslip.
 *  4. ONLY THE OWNER ASSIGNS A TARGET (coordination §7 q20): the manager and the accountant see the whole
 *     team and run the numbers; they never create, edit, remove or approve.
 *  5. THE SALESPERSON NEVER COLLECTS (docs/17 §D4): a `collections` target for a rep would be a target on
 *     money the rep may not take. It is not refused here — the membership-role check at `targets.upsert`
 *     is a database read (brief §2) — but no `collections` figure on this contract is a rep's own.
 *  6. ENGLISH ONLY (docs/22 §8 2026-09-04): `name` and `userName` on the wire are the rows' own English
 *     text; nothing here is localised.
 *  7. WHITE-LABEL (§D6): nothing on this contract names the platform. A target belongs to a distributor.
 *
 * CONVENTIONS THIS FILE FIXES, so a screen and a handler read the same numbers:
 *
 *  - `targetValue` IS METRIC-TYPED (brief §4.1). Paise for the two MONEY metrics (`value`, `collections`);
 *    a plain unscaled count for `pieces`, `lines`, `outlets` and `visits`. `isMoneyMetric()` below is the
 *    one place that decides, so a screen never formats "5000 lines" as ₹50.00. `achievedValue` follows
 *    the identical convention; `achievedPieces` is filled in ADDITION on every target whatever its
 *    metric, so a progress caption can say "3,120 of 5,000 pcs" even on a value target.
 *  - `fromPct` / `toPct` / `achievedPct` ARE BASIS POINTS, not percent, despite the names the brief gives
 *    them: 100% = 10000. `achievedPct = round(achievedValue * 10000 / targetValue)` and is UNCAPPED — a
 *    rep at 140% reads 14000 — which is why slab boundaries allow more than 10000 while `payoutBps` (a
 *    share OF the target) is a true 0..10000 `BpsSchema`.
 *  - `payoutBps` ONLY MEANS ANYTHING FOR `metric = 'value'` (brief §4.5): basis points of `targetValue`
 *    paise. Every other metric may only pay `flatPaise` per slab, and a `payoutBps` slab on one is a 400
 *    from the schema itself, before any handler runs.
 *  - BOUNDED WORK EVERYWHERE (docs/20 rule 3, brief §4.12): `payoutRule ≤ 10` slabs, `bulkAssign ≤ 50`
 *    reps, every list `limit ≤ 200` on a `cursor`, every target period ≤ `MAX_TARGET_PERIOD_DAYS`.
 *  - `achievements` IS A WORKER-ONLY CACHE (brief §4.11): its write policy is `system`-only, so
 *    `targets.refresh` ENQUEUES `incentives.achievement.recompute` and answers `queued` rather than
 *    writing the row from an `app_rw` request. `achievement` on a detail is null until the first sweep,
 *    and every figure here may be up to one sweep interval (≤ 1 hour) stale — a normal state, not an error.
 *  - `targets.whatIf` IS A PURE COMPUTATION with no `idempotencyKey` and no side effect, exactly like
 *    `pricing.quote`. It is the only mutation-shaped procedure on this contract that writes nothing.
 */

const IsoDateSchema = z.iso.date()
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

/** At most ten slabs on one target (docs/20 rule 3): a payout table nobody can read is not a scheme. */
export const MAX_PAYOUT_SLABS = 10
/** One `bulkAssign` covers a team, not a company (brief §4.12). */
export const MAX_BULK_ASSIGN_USERS = 50
/**
 * The longest period one target may cover. A target is a month, a quarter or at most a year; the
 * worker's aggregate window is this wide, so it is also the bound on one achievement computation.
 */
export const MAX_TARGET_PERIOD_DAYS = 366
/**
 * The highest slab boundary the schema accepts, in basis points of achievement (1000% of target).
 * `achievedPct` itself is uncapped; this only stops a typo like `fromPct: 100000000` becoming a slab.
 */
export const MAX_SLAB_BPS = 100_000

/**
 * What a target measures (brief §4.2, the `target_metric` enum after migration 0023 adds `visits`):
 *
 *   value        Σ `sales_order_lines.line_total_paise`             — PAISE
 *   pieces       Σ `sales_order_lines.qty_pcs`                      — count
 *   lines        count(`sales_order_lines`)                         — count
 *   outlets      count(distinct `sales_orders.retailer_id`)         — count, distinct shops BILLED
 *   visits       count(`visits`)                                    — count, beat calls MADE
 *   collections  Σ `receipts.amount_paise` (collected + deposited)  — PAISE
 *
 * `outlets` and `visits` are different questions and both are useful, which is why the enum keeps both.
 */
export const TargetMetricSchema = z.enum([
  'value',
  'pieces',
  'lines',
  'outlets',
  'visits',
  'collections',
])
export type TargetMetric = z.infer<typeof TargetMetricSchema>

/**
 * The metrics whose `targetValue` / `achievedValue` are INTEGER PAISE. Everything else is an unscaled
 * count in the same column (`targets.target_value` is `paise()` for every metric, brief §4.1). A screen
 * that formats a `lines` target as currency is a bug this predicate exists to prevent.
 */
export const MONEY_METRICS = ['value', 'collections'] as const satisfies readonly TargetMetric[]

/** True when `targetValue` and `achievedValue` of this metric are paise rather than a plain count. */
export function isMoneyMetric(metric: TargetMetric): boolean {
  return (MONEY_METRICS as readonly TargetMetric[]).includes(metric)
}

/**
 * The metrics for which a brand scope is meaningless (brief §4.2): a beat call is not made to one brand,
 * and money arriving against a bill is not attributable to a brand. Refused at `upsert` / `bulkAssign`.
 */
export const BRANDLESS_METRICS = [
  'visits',
  'collections',
] as const satisfies readonly TargetMetric[]

// ---------------------------------------------------------------------------------------------------------------
// the payout table

/**
 * One slab of a payout table. `fromPct` and `toPct` are BASIS POINTS OF ACHIEVEMENT (100% = 10000) and
 * the range is half-open `[fromPct, toPct)`; a slab with no `toPct` is the open-ended top tier. Exactly
 * one of `payoutBps` (basis points of `targetValue` paise, `metric = 'value'` only) and `flatPaise` (a
 * fixed rupee amount) carries the reward — a slab with both, or with neither, is a 400.
 *
 * Overlapping slabs are NOT refused (brief §4.6: a console concern, not a server one); if two match, the
 * one with the highest `fromPct` wins. Ordering the array is not required either.
 */
export const PayoutSlabSchema = z
  .object({
    fromPct: z.number().int().min(0).max(MAX_SLAB_BPS),
    toPct: z.number().int().min(0).max(MAX_SLAB_BPS).nullable().optional(),
    payoutBps: BpsSchema.optional(),
    flatPaise: PaiseSchema.nonnegative().optional(),
  })
  .superRefine((s, ctx) => {
    const rewards = [s.payoutBps, s.flatPaise].filter((v) => v !== undefined).length
    if (rewards !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['payoutBps'],
        message: 'a slab carries exactly one of payoutBps and flatPaise',
      })
    }
    if (s.toPct !== undefined && s.toPct !== null && s.toPct <= s.fromPct) {
      ctx.addIssue({
        code: 'custom',
        path: ['toPct'],
        message: 'toPct must be above fromPct: [fromPct, toPct) is half-open and never empty',
      })
    }
  })
export type PayoutSlab = z.infer<typeof PayoutSlabSchema>

/** The whole table: 1..10 slabs, in any order (brief §4.12 bounds it, §4.6 leaves it unsorted). */
export const PayoutRuleSchema = z.array(PayoutSlabSchema).min(1).max(MAX_PAYOUT_SLABS)

// ---------------------------------------------------------------------------------------------------------------
// output shapes

/**
 * The worker's cached achievement for one target (`achievements`), null on a detail until the first
 * sweep has run. `achievedPct` is basis points and UNCAPPED (over-achievement exceeds 10000).
 * `achievedPieces` is the pieces sold in the window whatever the target's own metric, for the caption.
 */
export const TargetAchievementSchema = z.object({
  achievedValue: PaiseSchema.nonnegative(),
  achievedPieces: PiecesSchema,
  achievedPct: z.number().int().nonnegative(),
  computedAt: z.string(),
})
export type TargetAchievement = z.infer<typeof TargetAchievementSchema>

/** One target row. `targetValue` is paise or a count per `isMoneyMetric(metric)`. */
export const TargetSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  /** The rep's own name, so a list row reads as a person rather than a uuid (English, docs/22). */
  userName: z.string(),
  /** Scoped to one brand, or tenant-wide when null. Never set for `visits` / `collections`. */
  brandId: IdSchema.nullable(),
  brandName: z.string().nullable(),
  metric: TargetMetricSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  targetValue: z.number().int().positive(),
  /** A short label ("Diwali Push — Campa"); null on a target assigned before the column existed. */
  name: z.string().nullable(),
  payoutRule: PayoutRuleSchema,
  /** Who assigned it (owner). Null for a row created before `targets.created_by` existed. */
  createdBy: IdSchema.nullable(),
  createdAt: z.string(),
})
export type Target = z.infer<typeof TargetSchema>

/** A target with its cached achievement: the rep's progress card and the owner's target detail. */
export const TargetDetailSchema = TargetSchema.extend({
  achievement: TargetAchievementSchema.nullable(),
})
export type TargetDetail = z.infer<typeof TargetDetailSchema>

/** The lean list row: no `payoutRule` (the slab table is a detail), achievement flattened for a bar. */
export const TargetSummarySchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  userName: z.string(),
  brandId: IdSchema.nullable(),
  brandName: z.string().nullable(),
  metric: TargetMetricSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  targetValue: z.number().int().positive(),
  name: z.string().nullable(),
  /** 0 until the worker's first sweep for this target (brief §4.11), never null. */
  achievedValue: PaiseSchema.nonnegative(),
  achievedPct: z.number().int().nonnegative(),
})
export type TargetSummary = z.infer<typeof TargetSummarySchema>

/**
 * One row of the team leaderboard: one rep's target for the requested metric, ranked by `achievedPct`
 * desc and `achievedValue` desc. `targetId` is carried so a bar can be tapped through to the target.
 */
export const TeamProgressRowSchema = z.object({
  rank: z.number().int().positive(),
  targetId: IdSchema,
  userId: IdSchema,
  userName: z.string(),
  brandId: IdSchema.nullable(),
  metric: TargetMetricSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  targetValue: z.number().int().positive(),
  achievedValue: PaiseSchema.nonnegative(),
  achievedPct: z.number().int().nonnegative(),
})
export type TeamProgressRow = z.infer<typeof TeamProgressRowSchema>

/** One line of a statement: what this target contributed to the period's total. */
export const StatementBreakdownRowSchema = z.object({
  targetId: IdSchema,
  metric: TargetMetricSchema,
  brandId: IdSchema.nullable(),
  name: z.string().nullable(),
  targetValue: z.number().int().positive(),
  achievedValue: PaiseSchema.nonnegative(),
  achievedPct: z.number().int().nonnegative(),
  /** The matched slab's amount in paise; 0 below the lowest slab (brief §8.5). */
  payoutPaise: PaiseSchema.nonnegative(),
})
export type StatementBreakdownRow = z.infer<typeof StatementBreakdownRowSchema>

/**
 * A computed payout for one (user, period). `amountPaise` is the sum of every target's slab payout.
 * `approvedBy` / `approvedAt` are null until the owner signs off — and a rep reads the row in that state
 * (coordination §7 q19). Nothing here is a payment: no mode, no reference, no journal (brief §1).
 */
export const StatementSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  userName: z.string(),
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  amountPaise: PaiseSchema.nonnegative(),
  approvedBy: IdSchema.nullable(),
  approvedAt: z.string().nullable(),
  computedAt: z.string(),
})
export type Statement = z.infer<typeof StatementSchema>

export const StatementDetailSchema = StatementSchema.extend({
  breakdown: z.array(StatementBreakdownRowSchema),
})
export type StatementDetail = z.infer<typeof StatementDetailSchema>

const TargetItemOutput = z.object({ item: TargetDetailSchema })
const StatementItemOutput = z.object({ item: StatementDetailSchema })

// ---------------------------------------------------------------------------------------------------------------
// shared input rules

type TargetRuleShape = {
  metric: TargetMetric
  periodFrom: string
  periodTo: string
  brandId?: string | null | undefined
  payoutRule: PayoutSlab[]
}
type Issue = { code: 'custom'; path: (string | number)[]; message: string }

const DAY_MS = 86_400_000

/** Inclusive calendar days between two ISO dates, 0 when `to` is before `from`. */
function periodDays(from: string, to: string): number {
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return span < 0 ? 0 : Math.round(span / DAY_MS) + 1
}

/**
 * `payoutBps` is a share of `targetValue` PAISE, so it is meaningless on a metric whose target is a
 * count (brief §4.5). Shared by `upsert` / `bulkAssign` (which also carry a period and a brand) and by
 * `whatIf` (which carries neither), so the same slab table is refused identically wherever it is typed.
 */
function payoutBpsIssues(metric: TargetMetric, payoutRule: readonly PayoutSlab[]): Issue[] {
  if (metric === 'value') return []
  const out: Issue[] = []
  payoutRule.forEach((slab, i) => {
    if (slab.payoutBps !== undefined) {
      out.push({
        code: 'custom',
        path: ['payoutRule', i, 'payoutBps'],
        message: `payoutBps is a share of the target's paise: metric '${metric}' may only use flatPaise`,
      })
    }
  })
  return out
}

/**
 * The rules a target must satisfy before any handler runs: a real period no longer than
 * `MAX_TARGET_PERIOD_DAYS`, no brand scope on a brandless metric, and no `payoutBps` off `value`.
 * Keeps the schema's own type, exactly like reporting's `seriesWindow`.
 *
 * What is deliberately NOT here, because each needs the database: the target user must be an ACTIVE
 * salesperson or delivery member (400), `visits` / `outlets` are refused for a delivery member (400),
 * and an overlapping `(userId, brandId, metric)` period is a 409 (brief §2).
 */
function targetRules<S extends z.ZodType<TargetRuleShape>>(schema: S): S {
  return schema.superRefine((v, ctx) => {
    const days = periodDays(v.periodFrom, v.periodTo)
    if (days < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodTo'],
        message: 'periodTo is before periodFrom',
      })
    } else if (days > MAX_TARGET_PERIOD_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodTo'],
        message: `period_too_long: at most ${MAX_TARGET_PERIOD_DAYS} days; this one has ${days}`,
      })
    }
    if (v.brandId && (BRANDLESS_METRICS as readonly TargetMetric[]).includes(v.metric)) {
      ctx.addIssue({
        code: 'custom',
        path: ['brandId'],
        message: `a '${v.metric}' target is never scoped to one brand`,
      })
    }
    for (const issue of payoutBpsIssues(v.metric, v.payoutRule)) ctx.addIssue(issue)
  })
}

/** Everything that defines WHAT a target measures, shared by `upsert` and `bulkAssign`. */
const targetShape = {
  brandId: IdSchema.nullable().optional(),
  metric: TargetMetricSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  /** Paise when `isMoneyMetric(metric)`, otherwise a plain count. Always > 0 (brief §4.7). */
  targetValue: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).nullable().optional(),
  payoutRule: PayoutRuleSchema,
}

// ---------------------------------------------------------------------------------------------------------------
// inputs — targets

/**
 * Creates or replaces one target. 400 unless `userId` is an ACTIVE salesperson or delivery member of the
 * tenant, and 400 for a `visits` / `outlets` target on a delivery member (they run no beat, brief §4.3).
 * 409 when another target of the same `(userId, brandId, metric)` covers an intersecting period — a rep
 * may hold several simultaneous targets, never two competing ones for the same thing.
 */
export const UpsertTargetInput = targetRules(
  MutationBase.extend({
    id: IdSchema,
    userId: IdSchema,
    ...targetShape,
  }),
)
export const UpsertTargetOutput = TargetItemOutput

/** One rep of a `bulkAssign`: the client generates a UUIDv7 per row, as `TripStopInput` does. */
export const BulkTargetAssignmentInput = z.object({
  id: IdSchema,
  userId: IdSchema,
})

/**
 * The same target — same metric, period and slabs — applied to a whole team in ONE transaction: the
 * owner console's "assign this month's target to every rep". Each assignment carries its own client
 * UUIDv7 (coordination §8 rule 2: every created row has a client id, so a retry is deterministic).
 * All-or-nothing: one failing row aborts the batch and writes nothing.
 */
export const BulkAssignTargetsInput = targetRules(
  MutationBase.extend({
    assignments: z.array(BulkTargetAssignmentInput).min(1).max(MAX_BULK_ASSIGN_USERS),
    ...targetShape,
  }),
)
export const BulkAssignTargetsOutput = z.object({ items: z.array(TargetDetailSchema) })

export const TargetGetInput = z.object({ id: IdSchema })
export const TargetGetOutput = TargetItemOutput

/**
 * The owner's target list and the rep's own. RLS (`targets_read`) narrows a salesperson or delivery
 * caller to its own rows whatever `userId` it sent; a back-office caller may filter by any rep.
 * `activeOn` defaults to today (IST): only targets whose period contains that date.
 */
export const TargetsListInput = z.object({
  userId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  metric: TargetMetricSchema.optional(),
  activeOn: IsoDateSchema.optional(),
  /** Off to see closed periods too; on (the default) only the targets running on `activeOn`. */
  activeOnly: QueryBoolSchema.default(true),
  ...CursorInput,
})
export const TargetsListOutput = z.object({
  items: z.array(TargetSummarySchema),
  nextCursor: z.string().nullable(),
})

/**
 * Hard delete, with the reason recorded in the audit trail. 409 once a `computed_payouts` statement
 * covering this target's exact period exists for its rep: the target has already been paid out against,
 * so correct the NEXT period's target instead. Cascades the target's own `achievements` row.
 */
export const RemoveTargetInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const RemoveTargetOutput = z.object({ removed: z.boolean() })

/**
 * Enqueues `incentives.achievement.recompute` for this one target and answers immediately. It does NOT
 * write `achievements` itself: that table's write policy is `system`-only (worker / `app_worker`), and an
 * API request must never satisfy it by escalating `app.actor_role` (brief §2). Gives the owner near-
 * immediate freshness before computing a statement, instead of waiting for the hourly sweep.
 */
export const RefreshTargetInput = MutationBase.extend({ id: IdSchema })
export const RefreshTargetOutput = z.object({ status: z.literal('queued') })

/**
 * A pure computation with no `idempotencyKey` and no side effect, exactly like `pricing.quote`: tune the
 * slab boundaries before saving a target, or ask "what would Rahul earn if I raised the target 10%".
 * Give `achievedValue` for a hypothetical, or `targetId` to run against that target's live cached figure;
 * one of the two is required. Runs the same slab evaluator `statements.compute` uses.
 */
export const TargetWhatIfInput = z
  .object({
    metric: TargetMetricSchema,
    targetValue: z.number().int().positive(),
    payoutRule: PayoutRuleSchema,
    achievedValue: PaiseSchema.nonnegative().optional(),
    targetId: IdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.achievedValue === undefined && v.targetId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['achievedValue'],
        message: 'give achievedValue for a hypothetical, or targetId to use the cached figure',
      })
    }
    for (const issue of payoutBpsIssues(v.metric, v.payoutRule)) ctx.addIssue(issue)
  })
export const TargetWhatIfOutput = z.object({
  /** The figure used: the input's, or the target's cached `achievements.achieved_value`. */
  achievedValue: PaiseSchema.nonnegative(),
  achievedPct: z.number().int().nonnegative(),
  /** Null when `achievedPct` is below every slab's `fromPct` — the rep earns nothing (brief §8.5). */
  matchedSlab: PayoutSlabSchema.nullable(),
  payoutPaise: PaiseSchema.nonnegative(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — progress

/**
 * The rep's own Performance tab (S9, D12). There is NO `userId` input to get wrong: `requireRole` plus
 * RLS mean this can never return another rep's row, even by accident.
 */
export const MyProgressInput = z.object({
  /** On by default: only the targets running today (IST). Off to include closed periods. */
  activeOnly: QueryBoolSchema.default(true),
  ...CursorInput,
})
export const MyProgressOutput = z.object({
  items: z.array(TargetDetailSchema),
  nextCursor: z.string().nullable(),
})

/**
 * The desk's team leaderboard (O20, M21 `<CompareBars>`). `metric` is REQUIRED because ranking a rep on
 * pieces against a rep on rupees is meaningless. Ranked by `achievedPct` desc, ties by `achievedValue`
 * desc. A target on a different metric is excluded, never zero-filled. Defaults to today's open targets.
 */
export const TeamProgressInput = z.object({
  metric: TargetMetricSchema,
  brandId: IdSchema.optional(),
  periodFrom: IsoDateSchema.optional(),
  periodTo: IsoDateSchema.optional(),
  ...CursorInput,
})
export const TeamProgressOutput = z.object({
  items: z.array(TeamProgressRowSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — statements

/**
 * Sums every target of `userId` whose period EXACTLY matches the input (no partial-overlap aggregation,
 * brief §4.9), reading each target's CURRENT cached achievement — call `targets.refresh` first, or rely
 * on the hourly sweep, when freshness matters. Upserts one row per `(user, period)`; `approvedBy` and
 * `approvedAt` are never cleared by a recompute. 409 once approved (`reopen` first); 400 for a rep with
 * no target in that exact period, rather than an empty statement.
 */
export const ComputeStatementInput = MutationBase.extend({
  id: IdSchema,
  userId: IdSchema,
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
}).superRefine((v, ctx) => {
  if (periodDays(v.periodFrom, v.periodTo) < 1) {
    ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'periodTo is before periodFrom' })
  }
})
export const ComputeStatementOutput = StatementItemOutput

/**
 * The owner's sign-off. Owner-only at the application layer even though `computed_payouts`' RLS write
 * policy (back office) would let a manager or an accountant through: the last word on money promised to
 * staff stays the owner's, the same way only the owner and the manager may cancel a numbered invoice.
 * 409 if already approved.
 */
export const ApproveStatementInput = MutationBase.extend({ id: IdSchema })
export const ApproveStatementOutput = StatementItemOutput

/**
 * Clears the approval so `compute` can run again — a slab was wrong, a target was corrected. Nothing
 * downstream has paid anything (brief §1), so no history beyond the outbox events is kept.
 */
export const ReopenStatementInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const ReopenStatementOutput = StatementItemOutput

export const StatementGetInput = z.object({ id: IdSchema })
export const StatementGetOutput = StatementItemOutput

/**
 * The owner's payout register and the rep's own statement history — including the computed-but-not-yet-
 * approved one (coordination §7 q19). `from` / `to` filter on `periodFrom`. RLS narrows a rep to its own.
 */
export const StatementsListInput = z.object({
  userId: IdSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  approvedOnly: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const StatementsListOutput = z.object({
  items: z.array(StatementSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `incentives: incentivesContract` in contract.ts

export const incentivesContract = {
  targets: {
    upsert: oc
      .route({
        method: 'POST',
        path: '/incentives/targets',
        summary: "Assign or replace one rep's target with its payout slabs (owner)",
      })
      .input(UpsertTargetInput)
      .output(UpsertTargetOutput),
    bulkAssign: oc
      .route({
        method: 'POST',
        path: '/incentives/targets/bulk',
        summary: 'Assign the same target to a whole team in one transaction (owner)',
      })
      .input(BulkAssignTargetsInput)
      .output(BulkAssignTargetsOutput),
    whatIf: oc
      .route({
        method: 'POST',
        path: '/incentives/targets/what-if',
        summary: 'What a slab table would pay at a given achievement (pure, writes nothing)',
      })
      .input(TargetWhatIfInput)
      .output(TargetWhatIfOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/incentives/targets/{id}',
        summary: 'One target with its cached achievement (a rep: its own)',
      })
      .input(TargetGetInput)
      .output(TargetGetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/incentives/targets',
        summary: 'Targets running on a date, with achievement (a rep: its own)',
      })
      .input(TargetsListInput)
      .output(TargetsListOutput),
    remove: oc
      .route({
        method: 'POST',
        path: '/incentives/targets/{id}/remove',
        summary: 'Delete a target that has not been paid out against (owner)',
      })
      .input(RemoveTargetInput)
      .output(RemoveTargetOutput),
    refresh: oc
      .route({
        method: 'POST',
        path: '/incentives/targets/{id}/refresh',
        summary: "Queue a recompute of this target's achievement cache",
      })
      .input(RefreshTargetInput)
      .output(RefreshTargetOutput),
  },
  progress: {
    mine: oc
      .route({
        method: 'GET',
        path: '/incentives/progress',
        summary: 'My own targets and how far along I am (salesperson, delivery)',
      })
      .input(MyProgressInput)
      .output(MyProgressOutput),
    team: oc
      .route({
        method: 'GET',
        path: '/incentives/progress/team',
        summary: 'The team leaderboard for one metric, ranked by achievement',
      })
      .input(TeamProgressInput)
      .output(TeamProgressOutput),
  },
  statements: {
    compute: oc
      .route({
        method: 'POST',
        path: '/incentives/statements/compute',
        summary: "Compute one rep's payout for a period (compute only, never payroll)",
      })
      .input(ComputeStatementInput)
      .output(ComputeStatementOutput),
    approve: oc
      .route({
        method: 'POST',
        path: '/incentives/statements/{id}/approve',
        summary: 'Approve a computed statement (owner)',
      })
      .input(ApproveStatementInput)
      .output(ApproveStatementOutput),
    reopen: oc
      .route({
        method: 'POST',
        path: '/incentives/statements/{id}/reopen',
        summary: 'Clear an approval so the statement can be computed again (owner)',
      })
      .input(ReopenStatementInput)
      .output(ReopenStatementOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/incentives/statements/{id}',
        summary: 'One statement with its per-target breakdown (a rep: its own)',
      })
      .input(StatementGetInput)
      .output(StatementGetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/incentives/statements',
        summary: "The payout register and a rep's own statement history (a rep: its own)",
      })
      .input(StatementsListInput)
      .output(StatementsListOutput),
  },
}
