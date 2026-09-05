import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApproveStatementInput,
  ApproveStatementOutput,
  ComputeStatementInput,
  ComputeStatementOutput,
  ReopenStatementInput,
  ReopenStatementOutput,
  StatementBreakdownRow,
  StatementGetInput,
  StatementGetOutput,
  StatementsListInput,
  StatementsListOutput,
} from '@dos/contracts'
import { evaluatePayout, sum, type Paise } from '@dos/domain'
import { achievements, computedPayouts, targets, users, withTenant, type Db } from '@dos/db'
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
  badRequest,
  conflict,
  emitIncentiveEvent,
  INCENTIVE_EVENTS,
  INCENTIVE_READERS,
  loadStatement,
  payoutRuleOf,
} from './incentives.internals.js'
import { toStatement, toStatementDetail } from './incentives.mappers.js'
import { UNKNOWN_NAMES } from './targets.service.js'

type ComputeIn = z.infer<typeof ComputeStatementInput>
type ComputeOut = z.infer<typeof ComputeStatementOutput>
type ApproveIn = z.infer<typeof ApproveStatementInput>
type ApproveOut = z.infer<typeof ApproveStatementOutput>
type ReopenIn = z.infer<typeof ReopenStatementInput>
type ReopenOut = z.infer<typeof ReopenStatementOutput>
type GetIn = z.infer<typeof StatementGetInput>
type GetOut = z.infer<typeof StatementGetOutput>
type ListIn = z.infer<typeof StatementsListInput>
type ListOut = z.infer<typeof StatementsListOutput>

/**
 * STATEMENTS (docs/plans/incentives.md §2, §4.9–§4.10): one number per rep per period, and the
 * owner's sign-off on it.
 *
 * COMPUTE ONLY, NEVER PAYROLL (brief §1, docs/22 never-list). Approving a statement is the LAST
 * thing that ever happens to it here: no journal entry, no receipt, no series, no GST, no
 * "mark disbursed". The money leaves the business outside the system, and that is deliberate — this
 * module must never be mistaken for an accounting document.
 *
 * ONE STATEMENT PER (USER, PERIOD), summed across every target of that user whose period matches the
 * request EXACTLY (§4.9: no partial-overlap aggregation, ever — a half-covered target would pay half
 * a slab nobody agreed to). The row is upserted on `computed_payouts_idx`, so recomputing after a
 * corrected target rewrites the number instead of stacking a second statement beside it.
 *
 * IT READS THE CACHE, NOT THE ORDER BOOK. Each target's figure is its `achievements` row, which the
 * worker owns (brief §4.11): call `targets.refresh` first, or rely on the hourly sweep, when
 * freshness matters. A statement is struck at period end, not on every screen open, so being one
 * sweep behind is a normal state — and a target the sweep has never reached contributes 0, which is
 * the honest answer, not a hidden failure.
 *
 * IMMUTABLE ONCE APPROVED, mirroring the invoice rule: `compute` is a 409 while `approved_by` is
 * set, and only the owner may `reopen` it. A recompute NEVER clears an approval by itself.
 */
@Injectable()
export class StatementsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Strikes (or re-strikes) the number for one rep and one period. Back office may run it; only the
   * owner may then approve it.
   */
  async compute(input: ComputeIn): Promise<ComputeOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const rows = await tx
          .select()
          .from(targets)
          .where(
            and(
              eq(targets.tenantId, ctx.tenantId),
              eq(targets.userId, input.userId),
              eq(targets.periodFrom, input.periodFrom),
              eq(targets.periodTo, input.periodTo),
            ),
          )
          .orderBy(targets.id)
        if (rows.length === 0) {
          // A statement of ₹0 for a rep who was never given a target is a lie, not an empty result:
          // it would read on the Performance tab as "you earned nothing", which is a different thing.
          badRequest(
            'no_targets',
            `user ${input.userId} holds no target for ${input.periodFrom}..${input.periodTo}`,
          )
        }
        const existing = await this.findByPeriod(tx, input.userId, input.periodFrom, input.periodTo)
        if (existing?.approvedBy) {
          conflict(
            'statement_approved',
            `statement ${existing.id} is approved and immutable: reopen it first`,
          )
        }
        const cached = new Map<string, typeof achievements.$inferSelect>()
        for (const row of await tx
          .select()
          .from(achievements)
          .where(
            and(
              eq(achievements.tenantId, ctx.tenantId),
              inArray(
                achievements.targetId,
                rows.map((r) => r.id),
              ),
            ),
          )) {
          cached.set(row.targetId, row)
        }
        const breakdown: StatementBreakdownRow[] = rows.map((target) => {
          const achievement = cached.get(target.id)
          const evaluation = evaluatePayout({
            targetValue: target.targetValue,
            achievedValue: achievement?.achievedValue ?? 0,
            payoutRule: asSlabs(payoutRuleOf(target.payoutRule)),
          })
          return {
            targetId: target.id,
            metric: target.metric,
            brandId: target.brandId,
            name: target.name,
            targetValue: target.targetValue,
            achievedValue: achievement?.achievedValue ?? 0,
            achievedPct: evaluation.achievedPct,
            payoutPaise: evaluation.payoutPaise,
          }
        })
        const amountPaise = sum(breakdown.map((b) => b.payoutPaise as Paise))
        const now = new Date()
        const [row] = await tx
          .insert(computedPayouts)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            userId: input.userId,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            amountPaise,
            breakdown,
            computedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              computedPayouts.tenantId,
              computedPayouts.userId,
              computedPayouts.periodFrom,
              computedPayouts.periodTo,
            ],
            // `approved_by` / `approved_at` are deliberately absent: a recompute never clears an
            // approval (the 409 above is what stops one landing on an approved statement at all),
            // and `id` stays whatever the first compute gave it so an existing link keeps working.
            set: { amountPaise, breakdown, computedAt: now },
          })
          .returning()
        if (!row) conflict('statement_id_taken', `statement id ${input.id} is already in use`)
        await emitIncentiveEvent(
          tx,
          'computed_payout',
          row.id,
          INCENTIVE_EVENTS.statementComputed,
          {
            computedPayoutId: row.id,
            userId: row.userId,
            periodFrom: row.periodFrom,
            periodTo: row.periodTo,
            amountPaise: row.amountPaise,
          },
        )
        return { item: toStatementDetail(row, await this.userName(tx, row.userId)) }
      }),
    )
  }

  /**
   * The owner's sign-off. Owner-only at the application layer even though `computed_payouts`' write
   * policy admits the whole back office: the last word on money promised to staff stays the owner's,
   * the same narrowing billing applies to cancelling a numbered invoice.
   */
  async approve(input: ApproveIn): Promise<ApproveOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await loadStatement(tx, input.id)
        if (row.approvedBy) conflict('already_approved', `statement ${row.id} was already approved`)
        const now = new Date()
        const [updated] = await tx
          .update(computedPayouts)
          .set({ approvedBy: ctx.actorId, approvedAt: now })
          .where(and(eq(computedPayouts.tenantId, ctx.tenantId), eq(computedPayouts.id, row.id)))
          .returning()
        if (!updated) conflict('not_updatable', `statement ${row.id} could not be approved`)
        await writeAudit(tx, {
          action: 'incentives.statement.approve',
          entityType: 'computed_payout',
          entityId: updated.id,
          after: {
            userId: updated.userId,
            periodFrom: updated.periodFrom,
            periodTo: updated.periodTo,
            amountPaise: updated.amountPaise,
          },
        })
        await emitIncentiveEvent(
          tx,
          'computed_payout',
          updated.id,
          INCENTIVE_EVENTS.statementApproved,
          {
            computedPayoutId: updated.id,
            userId: updated.userId,
            periodFrom: updated.periodFrom,
            periodTo: updated.periodTo,
            amountPaise: updated.amountPaise,
            approvedBy: updated.approvedBy,
          },
        )
        return { item: toStatementDetail(updated, await this.userName(tx, updated.userId)) }
      }),
    )
  }

  /**
   * Clears the approval so `compute` can run again — a slab was wrong, a target was corrected. The
   * reason goes in the audit trail; nothing downstream has paid anything, so no further history is
   * kept (brief §2). Reopening a statement nobody approved is a 409, not a silent success: it means
   * the caller believes something happened that did not.
   */
  async reopen(input: ReopenIn): Promise<ReopenOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await loadStatement(tx, input.id)
        if (!row.approvedBy)
          conflict(
            'not_approved',
            `statement ${row.id} is not approved: there is nothing to reopen`,
          )
        const [updated] = await tx
          .update(computedPayouts)
          .set({ approvedBy: null, approvedAt: null })
          .where(and(eq(computedPayouts.tenantId, ctx.tenantId), eq(computedPayouts.id, row.id)))
          .returning()
        if (!updated) conflict('not_updatable', `statement ${row.id} could not be reopened`)
        await writeAudit(tx, {
          action: 'incentives.statement.reopen',
          entityType: 'computed_payout',
          entityId: updated.id,
          before: { approvedBy: row.approvedBy, amountPaise: row.amountPaise },
          after: { reason: input.reason },
        })
        return { item: toStatementDetail(updated, await this.userName(tx, updated.userId)) }
      }),
    )
  }

  /** RLS narrows a rep to its own statement, so another rep's id reads as NOT_FOUND, never a leak. */
  async get(input: GetIn): Promise<GetOut> {
    requireRole(INCENTIVE_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await loadStatement(tx, input.id)
      return { item: toStatementDetail(row, await this.userName(tx, row.userId)) }
    })
  }

  /**
   * The owner's payout register and a rep's own history — INCLUDING the computed-but-not-yet-approved
   * one (coordination §7 q19: a rep sees the live figure marked "pending approval", not a payslip
   * revealed at month end).
   */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(INCENTIVE_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const where: (SQL | undefined)[] = [
        eq(computedPayouts.tenantId, ctx.tenantId),
        input.userId ? eq(computedPayouts.userId, input.userId) : undefined,
        input.from ? gte(computedPayouts.periodFrom, input.from) : undefined,
        input.to ? lte(computedPayouts.periodFrom, input.to) : undefined,
        input.approvedOnly === true ? sql`${computedPayouts.approvedBy} is not null` : undefined,
        input.approvedOnly === false ? sql`${computedPayouts.approvedBy} is null` : undefined,
        input.cursor ? sql`${computedPayouts.id} < ${input.cursor}` : undefined,
      ]
      const rows = await tx
        .select()
        .from(computedPayouts)
        .where(and(...where))
        .orderBy(desc(computedPayouts.id))
        .limit(input.limit)
      const names = await this.userNames(
        tx,
        rows.map((r) => r.userId),
      )
      return {
        items: rows.map((row) => toStatement(row, names.get(row.userId) ?? UNKNOWN_NAMES.userName)),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      }
    })
  }

  // =============================================================================================================

  private async findByPeriod(tx: Db, userId: string, from: string, to: string) {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(computedPayouts)
      .where(
        and(
          eq(computedPayouts.tenantId, tenantId),
          eq(computedPayouts.userId, userId),
          eq(computedPayouts.periodFrom, from),
          eq(computedPayouts.periodTo, to),
        ),
      )
      .limit(1)
    return row ?? null
  }

  private async userName(tx: Db, userId: string): Promise<string> {
    const names = await this.userNames(tx, [userId])
    return names.get(userId) ?? UNKNOWN_NAMES.userName
  }

  private async userNames(tx: Db, userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const unique = [...new Set(userIds)]
    if (unique.length === 0) return out
    for (const row of await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, unique))) {
      out.set(row.id, row.name)
    }
    return out
  }
}
