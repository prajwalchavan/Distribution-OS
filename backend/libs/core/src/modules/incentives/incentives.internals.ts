import { ORPCError } from '@orpc/server'
import { and, eq, sql } from 'drizzle-orm'
import type { PayoutSlab, TargetMetric } from '@dos/contracts'
import { uuidv7, type PayoutSlabLike } from '@dos/domain'
import {
  achievements,
  computedPayouts,
  memberships,
  outboxEvents,
  targets,
  type ActorRole,
  type Db,
  type TenantContext,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The plumbing every incentives procedure and the worker sweep share: who may do what, the shape of
 * a target row, the membership rule, the overlap rule, the outbox events, and the small parsers that
 * turn a `jsonb` column back into typed slabs.
 *
 * NOTHING HERE WRITES A LEDGER, A DOCUMENT OR A JOURNAL (docs/plans/incentives.md §1): incentives is
 * compute only. Its three tables are the whole of its write surface.
 */

// ---------------------------------------------------------------------------------------------------------------
// roles — the same lists `permissions.ts` declares, plus `system` for the worker (coordination §6)

/**
 * Who may READ a target or a statement: the desk, and the rep or crew member the row is about.
 * `permissions.ts`'s `INCENTIVE_READERS` without `system`; RLS then narrows a field role to its own
 * rows (`targets_read`, `achievements_read`, `computed_payouts_read`), so this list is the courtesy
 * 403 and the database is the guarantee.
 */
export const INCENTIVE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
  'system',
]

/**
 * Who reads their OWN progress and nothing else (`ROLE_GROUPS.FIELD`): `progress.mine` has no
 * `userId` input to get wrong, and an owner holds no target — the desk uses `progress.team`.
 */
export const INCENTIVE_FIELD: readonly ActorRole[] = ['salesperson', 'delivery', 'system']

/** The two membership roles a target may name (brief §1): incentives is staff performance, field only. */
export const TARGETABLE_ROLES = ['salesperson', 'delivery'] as const
export type TargetableRole = (typeof TARGETABLE_ROLES)[number]

/** Beat work: a crew member runs no beat, so neither of these may be a delivery target (brief §4.3). */
export const BEAT_METRICS: readonly TargetMetric[] = ['visits', 'outlets']

// ---------------------------------------------------------------------------------------------------------------
// outbox events (brief §7). Nothing consumes these to change state — incentives is a leaf.

export const INCENTIVE_EVENTS = {
  /** A statement was (re)computed: notifications tells the rep, reporting may chart it. */
  statementComputed: 'IncentiveStatementComputed',
  /** The owner signed it off. Still not a payment — the money leaves the business outside the system. */
  statementApproved: 'IncentiveStatementApproved',
  /**
   * `targets.refresh` asking the worker to recompute ONE target's achievement cache. The cache's
   * write policy is `system`-only, so an `app_rw` request may never write it itself (brief §4.11):
   * it records the request and the relay's handler does the work as the worker.
   */
  achievementRecompute: 'IncentiveAchievementRecomputeRequested',
} as const

export type IncentiveEvent = (typeof INCENTIVE_EVENTS)[keyof typeof INCENTIVE_EVENTS]

export async function emitIncentiveEvent(
  tx: Db,
  aggregateType: 'computed_payout' | 'target',
  aggregateId: string,
  eventType: IncentiveEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  })
}

/** The `{tenantId, targetId}` a recompute event carries, validated on the way back out of `jsonb`. */
export function parseRecomputePayload(
  value: unknown,
): { tenantId: string; targetId: string } | null {
  const p = value as Partial<{ tenantId: string; targetId: string }> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.tenantId !== 'string' || typeof p.targetId !== 'string') return null
  return { tenantId: p.tenantId, targetId: p.targetId }
}

// ---------------------------------------------------------------------------------------------------------------
// rows

export type TargetRow = typeof targets.$inferSelect
export type AchievementRow = typeof achievements.$inferSelect
export type StatementRow = typeof computedPayouts.$inferSelect

/** The context the worker runs a tenant's sweep under: `system`, so `achievements_write` accepts it. */
export const systemCtx = (tenantId: string): TenantContext => ({
  tenantId,
  actorId: 'system',
  actorRole: 'system',
})

/**
 * `payout_rule` comes back from `jsonb` as `unknown`. It went in through `PayoutRuleSchema`, so the
 * shape is already guaranteed; this only re-types it and drops anything that is not an object, so a
 * hand-edited row can never crash the evaluator on a screen.
 */
export function payoutRuleOf(value: unknown): PayoutSlab[] {
  if (!Array.isArray(value)) return []
  return value.filter((slab): slab is PayoutSlab => typeof slab === 'object' && slab !== null)
}

/** The same, as the structural type `@dos/domain` evaluates (it may not import `@dos/contracts`). */
export const asSlabs = (rule: readonly PayoutSlab[]): PayoutSlabLike[] => [...rule]

// ---------------------------------------------------------------------------------------------------------------
// the rules a target must satisfy that need the database (the rest are Zod, in the contract)

/** 400 with a machine-readable code, the way every other module answers a rule the schema cannot check. */
export function badRequest(code: string, message: string): never {
  throw new ORPCError('BAD_REQUEST', { message, data: { code } })
}

export function conflict(code: string, message: string): never {
  throw new ORPCError('CONFLICT', { message, data: { code } })
}

export function notFound(what: string, id: string): never {
  throw new ORPCError('NOT_FOUND', { message: `${what} ${id} not found` })
}

/**
 * A target names a person of THIS distributorship who actually does the work: an ACTIVE
 * `salesperson` or `delivery` member (brief §2). `users` is global (ADR 0006) and `memberships` is
 * the only place the pair (person, distributor) exists, so this is a single-row read of tenancy's
 * table — the sanctioned `orders/credit.ts` pattern of a plain, commented, read-only cross-module
 * join, used because tenancy exports nothing membership-shaped.
 *
 * The database agrees separately: `targets_member_guard` (migration 0030) refuses a row naming a
 * non-member whatever the application does. This is the clear 400 in front of that guard.
 */
export async function assertTargetableMember(tx: Db, userId: string): Promise<TargetableRole> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1)
  if (!row) badRequest('not_a_member', `user ${userId} is not a member of this distributorship`)
  if (row.status !== 'active')
    badRequest('member_not_active', `user ${userId} is not an active member`)
  if (!(TARGETABLE_ROLES as readonly string[]).includes(row.role)) {
    badRequest(
      'role_not_targetable',
      `a target belongs to a salesperson or a delivery member, not a ${row.role}`,
    )
  }
  return row.role as TargetableRole
}

/**
 * A crew member does not run a beat, so `visits` and `outlets` are refused for a `delivery` member
 * (brief §4.3). `value` / `pieces` / `lines` / `collections` apply to both roles — for a crew member
 * the first three read van-sale orders, attributed through `salesAggregate`'s creator fallback.
 */
export function assertMetricFitsRole(metric: TargetMetric, role: TargetableRole): void {
  if (role === 'delivery' && BEAT_METRICS.includes(metric)) {
    badRequest(
      'metric_not_for_delivery',
      `a delivery member runs no beat: '${metric}' is a salesperson metric`,
    )
  }
}

/**
 * A rep may hold several simultaneous targets — a value target and a visits target, or one per brand
 * — but never two competing ones for the same `(userId, brandId, metric)` with overlapping periods
 * (brief §2): which one would a statement pay? `brand_id` is compared with `IS NOT DISTINCT FROM` so
 * two tenant-wide targets (both null) collide exactly like two Campa ones.
 */
export async function assertNoOverlappingTarget(
  tx: Db,
  input: {
    id: string
    userId: string
    brandId: string | null
    metric: TargetMetric
    periodFrom: string
    periodTo: string
  },
): Promise<void> {
  const { tenantId } = currentTenant()
  const [clash] = await tx
    .select({ id: targets.id, periodFrom: targets.periodFrom, periodTo: targets.periodTo })
    .from(targets)
    .where(
      and(
        eq(targets.tenantId, tenantId),
        eq(targets.userId, input.userId),
        eq(targets.metric, input.metric),
        sql`${targets.brandId} is not distinct from ${input.brandId}`,
        sql`${targets.id} <> ${input.id}`,
        sql`${targets.periodFrom} <= ${input.periodTo}`,
        sql`${targets.periodTo} >= ${input.periodFrom}`,
      ),
    )
    .limit(1)
  if (clash) {
    conflict(
      'overlapping_target',
      `target ${clash.id} already covers ${clash.periodFrom}..${clash.periodTo} for this user, brand and metric`,
    )
  }
}

/**
 * A target that has already been paid out against is not deleted; the NEXT period's target is
 * corrected instead (brief §2 `remove`). "Paid out against" is a `computed_payouts` row for this
 * target's rep covering this target's EXACT period — the same window `statements.compute` sums.
 */
export async function assertNoCoveringStatement(tx: Db, target: TargetRow): Promise<void> {
  const { tenantId } = currentTenant()
  const [statement] = await tx
    .select({ id: computedPayouts.id })
    .from(computedPayouts)
    .where(
      and(
        eq(computedPayouts.tenantId, tenantId),
        eq(computedPayouts.userId, target.userId),
        eq(computedPayouts.periodFrom, target.periodFrom),
        eq(computedPayouts.periodTo, target.periodTo),
      ),
    )
    .limit(1)
  if (statement) {
    conflict(
      'statement_exists',
      `statement ${statement.id} already covers ${target.periodFrom}..${target.periodTo} for this user: correct the next period's target instead`,
    )
  }
}

// ---------------------------------------------------------------------------------------------------------------
// loaders

export async function findTarget(tx: Db, id: string): Promise<TargetRow | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(targets)
    .where(and(eq(targets.tenantId, tenantId), eq(targets.id, id)))
    .limit(1)
  return row ?? null
}

/** RLS narrows a field role to its own rows, so "someone else's target" reads as NOT_FOUND, never a leak. */
export async function loadTarget(tx: Db, id: string): Promise<TargetRow> {
  const row = await findTarget(tx, id)
  if (!row) notFound('target', id)
  return row
}

export async function findStatement(tx: Db, id: string): Promise<StatementRow | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(computedPayouts)
    .where(and(eq(computedPayouts.tenantId, tenantId), eq(computedPayouts.id, id)))
    .limit(1)
  return row ?? null
}

export async function loadStatement(tx: Db, id: string): Promise<StatementRow> {
  const row = await findStatement(tx, id)
  if (!row) notFound('statement', id)
  return row
}

/** The cached achievement of one target, or null before the worker's first sweep (brief §4.11). */
export async function findAchievement(tx: Db, targetId: string): Promise<AchievementRow | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(achievements)
    .where(and(eq(achievements.tenantId, tenantId), eq(achievements.targetId, targetId)))
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------------------------------------------
// the shared read shape

/**
 * Every target read selects exactly these columns plus the two names, so `toTarget` /
 * `toTargetSummary` take one row shape wherever it came from. Spread into a `.select({...})` next to
 * `userName: users.name` and `brandName: brands.name`.
 */
export const targetColumns = {
  id: targets.id,
  tenantId: targets.tenantId,
  userId: targets.userId,
  brandId: targets.brandId,
  metric: targets.metric,
  periodFrom: targets.periodFrom,
  periodTo: targets.periodTo,
  targetValue: targets.targetValue,
  payoutRule: targets.payoutRule,
  name: targets.name,
  createdBy: targets.createdBy,
  createdAt: targets.createdAt,
  updatedAt: targets.updatedAt,
}

// ---------------------------------------------------------------------------------------------------------------
// paging

/**
 * Pages a list that is ALREADY in the order the reader wants and whose order is NOT its id — the
 * leaderboard, ranked by achievement. A keyset cursor on `id` would silently drop rows from such a
 * list (the same trap reporting's `pageByOffset` documents), so the honest cursor is the offset into
 * that one bounded, fully materialised order. Every id-ordered list here keeps its keyset cursor.
 */
export function pageByOffset<T>(
  rows: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0)
  const items = rows.slice(start, start + limit)
  const next = start + items.length
  return { items, nextCursor: next < rows.length ? String(next) : null }
}

/** IST midnight of a business date as an instant, `plusDays` later. */
export function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}
