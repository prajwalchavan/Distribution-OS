import { and, asc, eq, gt, gte, lte, or } from 'drizzle-orm'
import type { TargetMetric } from '@dos/contracts'
import { achievedPctBps, businessDate, uuidv7 } from '@dos/domain'
import { achievements, targets, withSystem, withTenant, type Db } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { collectedByUser } from '../receivables/index.js'
import { salesAggregate, type SalesAggregateMetric } from '../orders/index.js'
import { visitCount } from '../retailers/index.js'
import { systemCtx, type TargetRow } from './incentives.internals.js'

/**
 * THE ACHIEVEMENT CACHE (docs/plans/incentives.md §4.11, §7). `achievements` holds one row per
 * target: how much of it has been done, in the target's own unit, plus the pieces sold in the window
 * for a progress caption, plus the percentage the slab evaluator matches on.
 *
 * WORKER-ONLY, BY THE DATABASE. `achievements_write` is `system`-only and migration 0030 asserts no
 * desk role can ever be added to it, so every write below runs under a SYSTEM context — the hourly
 * sweep and the single-target recompute the relay handles for `targets.refresh`. An `app_rw` request
 * that tried to write this table would simply be refused by RLS; nothing here escalates
 * `app.actor_role` to get around that (the anti-pattern the brief names in §2).
 *
 * WHY IT IS A CACHE AT ALL. A rep's Performance tab, the owner's target list, the team leaderboard
 * and every statement read this one row instead of scanning the order book (docs/20 rule 9): a phone
 * never aggregates a ledger. The price is staleness — up to one sweep interval — which is why
 * `targets.refresh` exists and why `statements.compute` is documented as reading the cache.
 *
 * THREE PROPERTIES:
 *  1. IDEMPOTENT BY UPSERT, not by an idempotency key: `INSERT … ON CONFLICT (achievements_target_idx)
 *     DO UPDATE`. A retry, an overlapping tick or a redeploy mid-run reproduces the same numbers.
 *  2. READ-ONLY AGAINST EVERY SOURCE, and never by joining another module's tables here: the three
 *     aggregates are the plain functions their owning modules export (coordination §3.9 / §4) —
 *     `salesAggregate` (orders), `visitCount` (retailers), `collectedByUser` (receivables).
 *  3. BOUNDED (docs/20 rule 3): the sweep takes at most `SWEEP_TARGET_LIMIT` targets per run through
 *     a `(tenant_id, id)` cursor, and works one tenant per transaction, so one large distributor
 *     never holds the batch and never delays another's numbers.
 */

/** Targets recomputed in one sweep run; a bound, not a target (docs/20 rule 3). */
export const SWEEP_TARGET_LIMIT = 5_000

/** The subset of a target the computation needs; the sweep selects exactly these columns. */
export interface TargetForAchievement {
  id: string
  userId: string
  brandId: string | null
  metric: TargetMetric
  periodFrom: string
  periodTo: string
  targetValue: number
}

export interface AchievementFigures {
  /** In the target's own unit: paise for `value` / `collections`, a plain count otherwise. */
  achievedValue: number
  /** Pieces sold in the window whatever the metric — the progress caption (brief §4.1). */
  achievedPieces: number
  /** `round(achievedValue * 10000 / targetValue)`, uncapped. */
  achievedPct: number
}

/** The four dimensions that come off the order book; `visits` and `collections` have their own source. */
const ORDER_METRICS: Record<SalesAggregateMetric, true> = {
  value: true,
  pieces: true,
  lines: true,
  outlets: true,
}

const isOrderMetric = (metric: TargetMetric): metric is SalesAggregateMetric =>
  metric in ORDER_METRICS

/**
 * What one target has achieved, right now, from the source of truth rather than the cache. Runs
 * inside the caller's transaction (a tenant-scoped one — `currentTenant()` must be populated).
 *
 * At most two queries: the order-book aggregate always (it carries `achievedPieces` for every
 * metric), plus the visit count or the collection sum when that is what the target measures.
 */
export async function computeAchievement(
  tx: Db,
  target: TargetForAchievement,
): Promise<AchievementFigures> {
  const window = { from: target.periodFrom, to: target.periodTo }
  const sales = await salesAggregate(tx, {
    userId: target.userId,
    brandId: target.brandId,
    metric: isOrderMetric(target.metric) ? target.metric : 'value',
    ...window,
  })
  let achievedValue: number
  if (target.metric === 'visits') {
    achievedValue = (await visitCount(tx, { userId: target.userId, ...window })).visits
  } else if (target.metric === 'collections') {
    achievedValue = (await collectedByUser(tx, { userId: target.userId, ...window })).amountPaise
  } else if (target.metric === 'pieces') {
    achievedValue = sales.pieces
  } else if (target.metric === 'lines') {
    achievedValue = sales.lines
  } else if (target.metric === 'outlets') {
    achievedValue = sales.outlets
  } else {
    achievedValue = sales.valuePaise
  }
  return {
    achievedValue,
    achievedPieces: sales.pieces,
    achievedPct: achievedPctBps(achievedValue, target.targetValue),
  }
}

/**
 * Computes and stores one target's figures. The caller must already be inside a SYSTEM-context
 * transaction for that target's tenant (`withTenant(db, systemCtx(tenantId), …)`), because the write
 * policy names `system` and nothing else.
 */
export async function writeAchievement(
  tx: Db,
  tenantId: string,
  target: TargetForAchievement,
): Promise<AchievementFigures> {
  const figures = await computeAchievement(tx, target)
  await tx
    .insert(achievements)
    .values({
      id: uuidv7(),
      tenantId,
      targetId: target.id,
      achievedValue: figures.achievedValue,
      achievedPieces: figures.achievedPieces,
      achievedPct: figures.achievedPct,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [achievements.tenantId, achievements.targetId],
      set: {
        achievedValue: figures.achievedValue,
        achievedPieces: figures.achievedPieces,
        achievedPct: figures.achievedPct,
        computedAt: new Date(),
      },
    })
  return figures
}

const forAchievement = (row: TargetRow): TargetForAchievement => ({
  id: row.id,
  userId: row.userId,
  brandId: row.brandId,
  metric: row.metric,
  periodFrom: row.periodFrom,
  periodTo: row.periodTo,
  targetValue: row.targetValue,
})

/**
 * ONE target, now — the fast path behind `targets.refresh` (the relay handler calls this when it
 * sees an `IncentiveAchievementRecomputeRequested` row). Runs as the system actor INSIDE the target's
 * tenant, so RLS still scopes every read and write to that distributor: never `app_worker`'s
 * BYPASSRLS across tenants, exactly as reporting's rollup does it.
 *
 * A target that has been removed since the event was written is a no-op, not an error: at-least-once
 * delivery means the handler must tolerate a stale row (coordination §3.6).
 */
export async function recomputeAchievement(
  db: Db,
  input: { tenantId: string; targetId: string },
): Promise<AchievementFigures | null> {
  const ctx = systemCtx(input.tenantId)
  return tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(targets)
        .where(and(eq(targets.tenantId, input.tenantId), eq(targets.id, input.targetId)))
        .limit(1)
      if (!row) return null
      return writeAchievement(tx, input.tenantId, forAchievement(row))
    }),
  )
}

export interface SweepResult {
  /** Distributors touched. */
  tenants: number
  /** Targets recomputed. */
  targets: number
  /** True when the run filled its limit: pass `last` back as `after` to continue. */
  truncated: boolean
  /** The `(tenant_id, id)` pair the run stopped on, or null when nothing was due. */
  last: { tenantId: string; id: string } | null
}

/**
 * EVERY OPEN TARGET, HOURLY (brief §7). "Open" is a period containing today (IST): a closed period's
 * numbers never change again, so re-reading them every hour would be pure load — a statement for a
 * finished month reads the figure the last sweep of that month left, or the owner presses refresh.
 *
 * Cross-tenant, so the row list is read under `withSystem`; each tenant's recompute then runs in its
 * OWN transaction under that tenant's system context. The `(tenant_id, id)` cursor caps the run and
 * keeps the order stable, so a tenant cut off at the limit is picked up first on the next tick.
 */
export async function sweepAchievements(
  db: Db,
  opts: {
    today?: string
    limit?: number
    /** Resume point from a previous run's `last` when it reported `truncated`. */
    after?: { tenantId: string; id: string } | null
  } = {},
): Promise<SweepResult> {
  const today = opts.today ?? businessDate().date
  const limit = Math.min(opts.limit ?? SWEEP_TARGET_LIMIT, SWEEP_TARGET_LIMIT)
  const after = opts.after ?? null
  const due = await withSystem(db, (tx) =>
    tx
      .select({
        id: targets.id,
        tenantId: targets.tenantId,
        userId: targets.userId,
        brandId: targets.brandId,
        metric: targets.metric,
        periodFrom: targets.periodFrom,
        periodTo: targets.periodTo,
        targetValue: targets.targetValue,
      })
      .from(targets)
      .where(
        and(
          lte(targets.periodFrom, today),
          gte(targets.periodTo, today),
          after
            ? or(
                gt(targets.tenantId, after.tenantId),
                and(eq(targets.tenantId, after.tenantId), gt(targets.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(targets.tenantId), asc(targets.id))
      .limit(limit),
  )
  const byTenant = new Map<string, TargetForAchievement[]>()
  for (const row of due) {
    const list = byTenant.get(row.tenantId) ?? []
    list.push({
      id: row.id,
      userId: row.userId,
      brandId: row.brandId,
      metric: row.metric,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      targetValue: row.targetValue,
    })
    byTenant.set(row.tenantId, list)
  }
  let count = 0
  for (const [tenantId, list] of byTenant) {
    const ctx = systemCtx(tenantId)
    // One transaction per distributor (docs/20 rule 5): a big order book delays nobody else's numbers.
    await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, async (tx) => {
        for (const target of list) await writeAchievement(tx, tenantId, target)
      }),
    )
    count += list.length
  }
  const lastRow = due[due.length - 1]
  return {
    tenants: byTenant.size,
    targets: count,
    truncated: due.length >= limit,
    last: lastRow ? { tenantId: lastRow.tenantId, id: lastRow.id } : null,
  }
}
