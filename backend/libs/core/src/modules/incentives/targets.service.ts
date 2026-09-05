import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  BulkAssignTargetsInput,
  BulkAssignTargetsOutput,
  MyProgressInput,
  MyProgressOutput,
  RefreshTargetInput,
  RefreshTargetOutput,
  RemoveTargetInput,
  RemoveTargetOutput,
  TargetGetInput,
  TargetGetOutput,
  TargetMetric,
  TargetsListInput,
  TargetsListOutput,
  TargetWhatIfInput,
  TargetWhatIfOutput,
  TeamProgressInput,
  TeamProgressOutput,
  TeamProgressRow,
  UpsertTargetInput,
  UpsertTargetOutput,
} from '@dos/contracts'
import { businessDate, evaluatePayout } from '@dos/domain'
import { achievements, brands, targets, users, withSystem, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  OWNER,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import {
  asSlabs,
  assertMetricFitsRole,
  assertNoCoveringStatement,
  assertNoOverlappingTarget,
  assertTargetableMember,
  badRequest,
  conflict,
  emitIncentiveEvent,
  findAchievement,
  INCENTIVE_EVENTS,
  INCENTIVE_FIELD,
  INCENTIVE_READERS,
  loadTarget,
  pageByOffset,
  targetColumns,
  type TargetRow,
} from './incentives.internals.js'
import { recomputeAchievement } from './achievements.js'
import { toTargetDetail, toTargetSummary, type TargetNames } from './incentives.mappers.js'

type UpsertIn = z.infer<typeof UpsertTargetInput>
type UpsertOut = z.infer<typeof UpsertTargetOutput>
type BulkIn = z.infer<typeof BulkAssignTargetsInput>
type BulkOut = z.infer<typeof BulkAssignTargetsOutput>
type GetIn = z.infer<typeof TargetGetInput>
type GetOut = z.infer<typeof TargetGetOutput>
type ListIn = z.infer<typeof TargetsListInput>
type ListOut = z.infer<typeof TargetsListOutput>
type RemoveIn = z.infer<typeof RemoveTargetInput>
type RemoveOut = z.infer<typeof RemoveTargetOutput>
type RefreshIn = z.infer<typeof RefreshTargetInput>
type RefreshOut = z.infer<typeof RefreshTargetOutput>
type WhatIfIn = z.infer<typeof TargetWhatIfInput>
type WhatIfOut = z.infer<typeof TargetWhatIfOutput>
type MineIn = z.infer<typeof MyProgressInput>
type MineOut = z.infer<typeof MyProgressOutput>
type TeamIn = z.infer<typeof TeamProgressInput>
type TeamOut = z.infer<typeof TeamProgressOutput>

/** One row of the target reads: the columns plus the two joined names. */
type TargetJoined = TargetRow & TargetNames

/**
 * How many targets the leaderboard materialises before ranking and paging. A distributor with more
 * simultaneous targets than this on ONE metric does not exist (three reps, a handful of brands);
 * the bound is docs/20 rule 3, not a product limit.
 */
const TEAM_SCAN_LIMIT = 500

/**
 * TARGETS AND PROGRESS (docs/plans/incentives.md §2, §4). What the owner assigns, what a rep is
 * measured on, how far along everyone is.
 *
 * Every handler is `requireRole → requireDb → withTenant` and every mutation adds
 * `idempotent(tx, input.idempotencyKey, input, …)`. `targets.whatIf` is the one exception on both
 * counts: a pure computation with no key and no write, exactly like `pricing.quote`.
 *
 * WHO WRITES WHAT. Only the owner assigns, edits or removes a target (`OWNER`, matching
 * `targets_write` RLS verbatim — coordination §7 q20: money promised to staff is the owner's word).
 * The desk (`BACK_OFFICE`) may look at the whole team and run the numbers. A rep reads its own rows
 * and nothing else, and `progress.mine` has no `userId` input to get wrong.
 *
 * NOTHING HERE WRITES `achievements`. Its policy is `system`-only (brief §4.11): `targets.refresh`
 * records a request on the outbox and the worker does the work as the system actor.
 */
@Injectable()
export class TargetsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // =============================================================================================================
  // assigning
  // =============================================================================================================

  /**
   * Creates or replaces one target. The four rules the schema cannot check are the database's:
   * the user is an ACTIVE salesperson or delivery member, a crew member gets no beat metric, no
   * competing target already covers the same `(user, brand, metric)` period, and the id is free.
   */
  async upsert(input: UpsertIn): Promise<UpsertOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const before = await this.writeOne(tx, input)
        return { item: before }
      }),
    )
  }

  /**
   * The same target — metric, period, slabs — applied to a whole team in ONE transaction (the owner
   * console's "assign this month's target to every rep"). All-or-nothing: a single failing row
   * aborts the batch and writes nothing, so the owner never has to work out which half landed.
   */
  async bulkAssign(input: BulkIn): Promise<BulkOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const seenUsers = new Set<string>()
        const seenIds = new Set<string>()
        for (const a of input.assignments) {
          if (seenUsers.has(a.userId))
            badRequest('duplicate_user', `user ${a.userId} appears twice in this batch`)
          if (seenIds.has(a.id))
            badRequest('duplicate_id', `id ${a.id} appears twice in this batch`)
          seenUsers.add(a.userId)
          seenIds.add(a.id)
        }
        const items = []
        for (const a of input.assignments) {
          items.push(await this.writeOne(tx, { ...input, id: a.id, userId: a.userId }))
        }
        return { items }
      }),
    )
  }

  /** The one write path both `upsert` and `bulkAssign` go through, so the rules cannot diverge. */
  private async writeOne(
    tx: Db,
    input: {
      id: string
      userId: string
      brandId?: string | null | undefined
      metric: TargetMetric
      periodFrom: string
      periodTo: string
      targetValue: number
      name?: string | null | undefined
      payoutRule: z.infer<typeof UpsertTargetInput>['payoutRule']
    },
  ) {
    const ctx = currentTenant()
    const brandId = input.brandId ?? null
    const role = await assertTargetableMember(tx, input.userId)
    assertMetricFitsRole(input.metric, role)
    if (brandId) {
      const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId))
      if (!brand) badRequest('brand_not_found', `brand ${brandId} not found`)
    }
    await assertNoOverlappingTarget(tx, {
      id: input.id,
      userId: input.userId,
      brandId,
      metric: input.metric,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
    })
    const before = await tx
      .select({ id: targets.id })
      .from(targets)
      .where(and(eq(targets.tenantId, ctx.tenantId), eq(targets.id, input.id)))
      .limit(1)
    const values = {
      userId: input.userId,
      brandId,
      metric: input.metric,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      targetValue: input.targetValue,
      payoutRule: input.payoutRule,
      name: input.name ?? null,
      // Who assigned THIS version of the target: a replace is a fresh promise, made by whoever is
      // signed in now (always the owner — `targets_write` and `requireRole(OWNER)` both say so).
      createdBy: ctx.actorId,
      updatedAt: new Date(),
    }
    const [row] = await tx
      .insert(targets)
      .values({ id: input.id, tenantId: ctx.tenantId, ...values })
      .onConflictDoUpdate({ target: targets.id, set: values })
      .returning()
    // RLS filters the UPDATE branch, so an id already held by ANOTHER distributor returns nothing
    // rather than silently overwriting it: a clash on a client-generated UUIDv7, answered as a 409.
    if (!row) conflict('id_taken', `target id ${input.id} is already in use`)
    await writeAudit(tx, {
      action: before.length > 0 ? 'incentives.target.replace' : 'incentives.target.assign',
      entityType: 'target',
      entityId: row.id,
      after: {
        userId: row.userId,
        brandId: row.brandId,
        metric: row.metric,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        targetValue: row.targetValue,
        name: row.name,
      },
    })
    const names = await this.namesFor(tx, [row])
    const achievement = await findAchievement(tx, row.id)
    return toTargetDetail(row, names.get(row.id) ?? UNKNOWN_NAMES, achievement)
  }

  /**
   * Hard delete. Refused (409) once a statement covers this target's exact period: it has already
   * been paid out against, so the NEXT period's target is what gets corrected.
   *
   * THREE STEPS, and the middle one is the interesting part. `achievements.target_id` is a foreign
   * key to `targets`, and a foreign-key check bypasses row security — but the cache row's write
   * policy is `system`-only, so the owner's own transaction cannot clear it and the delete would
   * fail with a 23503 nobody can act on. So the cache row is dropped first, the way the worker
   * would, in its own `withSystem` transaction SCOPED TO THE CALLER'S OWN TENANT (never the id
   * alone: an owner of another distributorship must not be able to touch this one's cache). It is a
   * derived row: if step 3 then refuses, step 4 puts it straight back rather than leaving the target
   * standing with no cached figure. That matters because the hourly sweep only revisits OPEN
   * periods: a CLOSED one — exactly the kind a statement is struck against — would otherwise stay at
   * 0 until somebody thought to press refresh, and `statements.compute` reads the cache, so the rep
   * would be paid short with nothing on screen saying why. The validation in step 1 keeps step 3
   * from refusing on a normal 409; step 4 covers the two paths it cannot (an idempotency key reused
   * with a different payload, and a statement that lands between step 1 and step 3).
   */
  async remove(input: RemoveIn): Promise<RemoveOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    // 1. Under the caller's own RLS: does it exist, and may it go? A missing target falls through to
    //    step 3, which answers 404 — or replays the stored response when this key already ran.
    const existing = await withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(targets)
        .where(and(eq(targets.tenantId, ctx.tenantId), eq(targets.id, input.id)))
        .limit(1)
      if (row) await assertNoCoveringStatement(tx, row)
      return row ?? null
    })
    // 2. The worker's cache row, so the foreign key does not block the delete (see above).
    if (existing) {
      await withSystem(db, (tx) =>
        tx
          .delete(achievements)
          .where(and(eq(achievements.tenantId, ctx.tenantId), eq(achievements.targetId, input.id))),
      )
    }
    // 3. The delete itself: idempotent, audited, and re-checked inside the transaction that does it.
    try {
      return await withTenant(db, ctx, (tx) =>
        idempotent(tx, input.idempotencyKey, input, async () => {
          const row = await loadTarget(tx, input.id)
          await assertNoCoveringStatement(tx, row)
          await writeAudit(tx, {
            action: 'incentives.target.remove',
            entityType: 'target',
            entityId: row.id,
            before: {
              userId: row.userId,
              brandId: row.brandId,
              metric: row.metric,
              periodFrom: row.periodFrom,
              periodTo: row.periodTo,
              targetValue: row.targetValue,
            },
            after: { reason: input.reason },
          })
          await tx
            .delete(targets)
            .where(and(eq(targets.tenantId, ctx.tenantId), eq(targets.id, input.id)))
          return { removed: true }
        }),
      )
    } catch (error) {
      // 4. The delete did not happen, so step 2 dropped the cache of a target that is still there.
      //    Recompute it the way the worker would — best effort, and never in place of the real
      //    error, which is what the caller must see.
      if (existing) {
        await recomputeAchievement(db, { tenantId: ctx.tenantId, targetId: input.id }).catch(
          () => null,
        )
      }
      throw error
    }
  }

  /**
   * Asks the worker to recompute ONE target's achievement now, instead of waiting up to an hour for
   * the sweep. It writes an outbox row and NOTHING ELSE — `achievements` is `system`-only, and an
   * API request must never satisfy that by escalating `app.actor_role` (brief §2). The relay picks
   * the event up on its next tick and runs the same computation the sweep runs.
   */
  async refresh(input: RefreshIn): Promise<RefreshOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await loadTarget(tx, input.id)
        await emitIncentiveEvent(tx, 'target', row.id, INCENTIVE_EVENTS.achievementRecompute, {
          tenantId: ctx.tenantId,
          targetId: row.id,
        })
        return { status: 'queued' as const }
      }),
    )
  }

  // =============================================================================================================
  // reading
  // =============================================================================================================

  async get(input: GetIn): Promise<GetOut> {
    requireRole(INCENTIVE_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await loadTarget(tx, input.id)
      const names = await this.namesFor(tx, [row])
      const achievement = await findAchievement(tx, row.id)
      return { item: toTargetDetail(row, names.get(row.id) ?? UNKNOWN_NAMES, achievement) }
    })
  }

  /**
   * The owner's target list and the rep's own. RLS narrows a field role to its own rows whatever
   * `userId` it sent, so there is no branch here that could get the scoping wrong.
   */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(INCENTIVE_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await this.page(tx, {
        userId: input.userId,
        brandId: input.brandId,
        metric: input.metric,
        activeOn: input.activeOnly ? (input.activeOn ?? businessDate().date) : undefined,
        limit: input.limit,
        cursor: input.cursor,
      })
      const figures = await this.achievementFigures(
        tx,
        rows.map((r) => r.id),
      )
      return {
        items: rows.map((row) => toTargetSummary(row, row, figures.get(row.id) ?? null)),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      }
    })
  }

  /**
   * The rep's own Performance tab (S9) and the crew's "me" tab (D12). `requireRole` admits only the
   * two field roles, and the query pins `user_id` to the caller — belt and braces on top of RLS.
   */
  async mine(input: MineIn): Promise<MineOut> {
    requireRole(INCENTIVE_FIELD)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const rows = await this.page(tx, {
        userId: ctx.actorId,
        activeOn: input.activeOnly ? businessDate().date : undefined,
        limit: input.limit,
        cursor: input.cursor,
      })
      const cached = await this.achievementRows(
        tx,
        rows.map((r) => r.id),
      )
      return {
        items: rows.map((row) => toTargetDetail(row, row, cached.get(row.id) ?? null)),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      }
    })
  }

  /**
   * The desk's leaderboard for ONE metric (O20, M21). `metric` is required because ranking a rep on
   * pieces against a rep on rupees is meaningless; a target on another metric is excluded, never
   * zero-filled. Ranked by `achievedPct` desc, ties by `achievedValue` desc, then by id so the order
   * is total and a page boundary never wobbles.
   *
   * Bounded and fully materialised before paging, so the cursor is the OFFSET into that one order —
   * a keyset cursor on `id` would silently drop rows from a list sorted by anything else.
   */
  async team(input: TeamIn): Promise<TeamOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const today = businessDate().date
      const from = input.periodFrom ?? (input.periodTo ? undefined : today)
      const to = input.periodTo ?? (input.periodFrom ? undefined : today)
      const result = await tx.execute(sql`
        select t.id, t.user_id, u.name as user_name, t.brand_id, t.metric,
               t.period_from, t.period_to, t.target_value,
               coalesce(a.achieved_value, 0)   as achieved_value,
               coalesce(a.achieved_pct_bps, 0) as achieved_pct
          from targets t
          join users u on u.id = t.user_id
          left join achievements a on a.tenant_id = t.tenant_id and a.target_id = t.id
         where t.tenant_id = ${ctx.tenantId}
           and t.metric = ${input.metric}
           and (${input.brandId ?? null}::text is null or t.brand_id = ${input.brandId ?? null})
           and (${to ?? null}::date is null or t.period_from <= ${to ?? null}::date)
           and (${from ?? null}::date is null or t.period_to >= ${from ?? null}::date)
         order by achieved_pct desc, achieved_value desc, t.id asc
         limit ${TEAM_SCAN_LIMIT}`)
      const ranked: TeamProgressRow[] = result.rows.map((raw, index) => {
        const row: Record<string, unknown> = raw
        return {
          rank: index + 1,
          targetId: String(row.id),
          userId: String(row.user_id),
          userName: String(row.user_name),
          brandId: typeof row.brand_id === 'string' ? row.brand_id : null,
          metric: row.metric as TargetMetric,
          periodFrom: String(row.period_from).slice(0, 10),
          periodTo: String(row.period_to).slice(0, 10),
          targetValue: Number(row.target_value),
          achievedValue: Number(row.achieved_value),
          achievedPct: Number(row.achieved_pct),
        }
      })
      return pageByOffset(ranked, input.cursor, input.limit)
    })
  }

  /**
   * A pure computation, no `idempotencyKey` and no write (`pricing.quote`'s twin): tune the slabs
   * before saving, or ask what a rep would earn at a different number. `targetId` runs it against
   * that target's CACHED achievement — the same figure a statement would use — while
   * `achievedValue` runs it against a hypothetical. The database is touched only for the first.
   */
  async whatIf(input: WhatIfIn): Promise<WhatIfOut> {
    requireRole(BACK_OFFICE)
    let achievedValue = input.achievedValue ?? 0
    if (input.targetId !== undefined) {
      const db = requireDb(this.db)
      const targetId = input.targetId
      achievedValue = await withTenant(db, currentTenant(), async (tx) => {
        const row = await loadTarget(tx, targetId)
        const cached = await findAchievement(tx, row.id)
        return input.achievedValue ?? cached?.achievedValue ?? 0
      })
    }
    const result = evaluatePayout({
      targetValue: input.targetValue,
      achievedValue,
      payoutRule: asSlabs(input.payoutRule),
    })
    return {
      achievedValue,
      achievedPct: result.achievedPct,
      matchedSlab: result.matchedSlab,
      payoutPaise: result.payoutPaise,
    }
  }

  // =============================================================================================================
  // shared reads
  // =============================================================================================================

  /** One page of targets with their two joined names, newest id first. */
  private async page(
    tx: Db,
    filter: {
      userId?: string | undefined
      brandId?: string | undefined
      metric?: TargetMetric | undefined
      /** When set, only targets whose period contains this IST business date. */
      activeOn?: string | undefined
      limit: number
      cursor?: string | undefined
    },
  ): Promise<TargetJoined[]> {
    const { tenantId } = currentTenant()
    const where: (SQL | undefined)[] = [
      eq(targets.tenantId, tenantId),
      filter.userId ? eq(targets.userId, filter.userId) : undefined,
      filter.brandId ? eq(targets.brandId, filter.brandId) : undefined,
      filter.metric ? eq(targets.metric, filter.metric) : undefined,
      filter.activeOn ? lte(targets.periodFrom, filter.activeOn) : undefined,
      filter.activeOn ? gte(targets.periodTo, filter.activeOn) : undefined,
      filter.cursor ? sql`${targets.id} < ${filter.cursor}` : undefined,
    ]
    const rows = await tx
      .select({ ...targetColumns, userName: users.name, brandName: brands.name })
      .from(targets)
      .innerJoin(users, eq(users.id, targets.userId))
      .leftJoin(brands, eq(brands.id, targets.brandId))
      .where(and(...where))
      .orderBy(desc(targets.id))
      .limit(filter.limit)
    return rows.map((row) => ({ ...row, brandName: row.brandName ?? null }))
  }

  /** The names for a set of already-loaded target rows (the write paths, which do not join). */
  private async namesFor(tx: Db, rows: TargetRow[]): Promise<Map<string, TargetNames>> {
    const out = new Map<string, TargetNames>()
    if (rows.length === 0) return out
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const brandIds = [...new Set(rows.map((r) => r.brandId).filter((b): b is string => !!b))]
    const userRows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds))
    const brandRows =
      brandIds.length > 0
        ? await tx
            .select({ id: brands.id, name: brands.name })
            .from(brands)
            .where(inArray(brands.id, brandIds))
        : []
    const userNames = new Map(userRows.map((r) => [r.id, r.name]))
    const brandNames = new Map(brandRows.map((r) => [r.id, r.name]))
    for (const row of rows) {
      out.set(row.id, {
        userName: userNames.get(row.userId) ?? UNKNOWN_NAMES.userName,
        brandName: row.brandId ? (brandNames.get(row.brandId) ?? null) : null,
      })
    }
    return out
  }

  /** The cached achievement rows for a page of targets, keyed by target id. */
  private async achievementRows(tx: Db, targetIds: string[]) {
    const out = new Map<string, typeof achievements.$inferSelect>()
    if (targetIds.length === 0) return out
    const { tenantId } = currentTenant()
    const rows = await tx
      .select()
      .from(achievements)
      .where(and(eq(achievements.tenantId, tenantId), inArray(achievements.targetId, targetIds)))
    for (const row of rows) out.set(row.targetId, row)
    return out
  }

  /** The two numbers a summary row needs, keyed by target id. */
  private async achievementFigures(tx: Db, targetIds: string[]) {
    const rows = await this.achievementRows(tx, targetIds)
    const out = new Map<string, { achievedValue: number; achievedPct: number }>()
    for (const [id, row] of rows) {
      out.set(id, { achievedValue: row.achievedValue, achievedPct: row.achievedPct })
    }
    return out
  }
}

/**
 * A target whose user row is not visible (a member removed from the tenant while the target stands).
 * `users_visible` scopes reads to the current tenant's members, so this is reachable and must read
 * as something rather than crashing a list.
 */
const UNKNOWN_NAMES: TargetNames = { userName: '', brandName: null }

/** Re-exported for the statements service, which needs the same fallback. */
export { UNKNOWN_NAMES }
