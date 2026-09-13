import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, sql } from 'drizzle-orm'
import type {
  SubscriptionItem,
  SubscriptionsList,
  SubscriptionsListInput,
  SubscriptionUpsertIn,
} from '@dos/contracts'
import type { z } from 'zod'
import { subscriptions, tenants, type Db } from '@dos/db'
import { businessDate } from '@dos/domain'
import { DB, platformIdempotent, isUniqueViolation, requireDb } from '../../platform/index.js'
import {
  addDays,
  platformActorId,
  requireActiveAdminLevel,
  statusToColumn,
  toSubscription,
  trialEndToColumn,
  withPlatform,
  writePlatformAudit,
} from './internals.js'

type ListIn = z.infer<typeof SubscriptionsListInput>

/**
 * WHAT A DISTRIBUTOR PAYS US (module 13). One row per distributor, kept as CURRENT STATE: the plan,
 * the state of the relationship, the trial end, the agreed monthly price in integer paise, the
 * interval we actually invoice on and the seats agreed. It RECORDS revenue; it never collects any —
 * there is no fintech in the product (docs/22 §8) and no invoice of ours is generated anywhere.
 *
 * This is our price to the distributor, not the distributor's price to its shops: nothing here is a
 * rupee of anybody's trade, and nothing here is readable by the distributor's own app. If an owner
 * ever wants a "your plan" card, that is one deliberate own-tenant SELECT policy on `subscriptions`,
 * added on purpose — do not widen `subscriptions_read` to get it.
 *
 * `plan` is the same enum the `tenants` row carries, so the console and the tenant can never disagree
 * about what a plan is called, and `upsert` writes both in one transaction for the same reason.
 */
@Injectable()
export class PlatformSubscriptionsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async list(input: ListIn): Promise<SubscriptionsList> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdminLevel(tx, platformActorId(), 'admin.subscriptions.list')
      // "Needs attention": trials and periods that run out inside the window the console asked for.
      const endingBy = input.endingWithinDays
        ? addDays(businessDate().date, input.endingWithinDays)
        : null
      const rows = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            input.tenantId ? eq(subscriptions.tenantId, input.tenantId) : undefined,
            input.status ? eq(subscriptions.status, statusToColumn(input.status)) : undefined,
            input.plan ? eq(subscriptions.plan, input.plan) : undefined,
            endingBy
              ? sql`(${subscriptions.periodEnd} <= ${endingBy}
                     OR ${subscriptions.trialEndsAt} <= ${trialEndToColumn(endingBy)})`
              : undefined,
            input.cursor ? sql`${subscriptions.id} > ${input.cursor}` : undefined,
          ),
        )
        .orderBy(asc(subscriptions.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page.at(-1)
      return {
        items: page.map(toSubscription),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: { id: string }): Promise<SubscriptionItem> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdminLevel(tx, platformActorId(), 'admin.subscriptions.get')
      const [row] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, input.id))
        .limit(1)
      if (!row) throw new ORPCError('NOT_FOUND', { message: `no subscription ${input.id}` })
      return { item: toSubscription(row) }
    })
  }

  /**
   * Create or replace the one subscription row of one distributor. It is an upsert on `tenant_id`
   * rather than a create/update pair because there is exactly one live subscription per distributor —
   * the console edits state, it does not append billing periods (a period history is phase 2,
   * docs/25 P2-22), and the record of who changed what is `platform_audit`.
   *
   * The database refuses the nonsense cases itself (`dos_subscription_guard`): a negative price, a
   * negative seat count, a trial with no end, a period that ends before it starts, an `updated_by`
   * who is not one of ours. The messages below exist so the console shows a sentence instead of a
   * constraint name; the guarantee is the trigger.
   */
  async upsert(input: SubscriptionUpsertIn): Promise<SubscriptionItem> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    return withPlatform(db, async (tx) => {
      // The level and the login BEFORE the key: a stored reply is handed back without running anything,
      // so a support account replaying a super's plan change with the identical body must stop here.
      await requireActiveAdminLevel(tx, actorId, 'admin.subscriptions.upsert')
      return platformIdempotent(tx, input.tenantId, input.idempotencyKey, input, async () => {
        const [tenant] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1)
        if (!tenant) {
          throw new ORPCError('NOT_FOUND', { message: `no distributor ${input.tenantId}` })
        }
        if (input.currentPeriodEnd <= input.currentPeriodStart) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'the billing period ends after it starts',
          })
        }
        const status = statusToColumn(input.status)
        if (status === 'trial' && !input.trialEndDate) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'a trial must say when it ends: send trialEndDate',
          })
        }
        const now = new Date()
        const values = {
          id: input.id,
          tenantId: input.tenantId,
          plan: input.plan,
          status,
          trialEndsAt: trialEndToColumn(input.trialEndDate ?? null),
          periodStart: input.currentPeriodStart,
          periodEnd: input.currentPeriodEnd,
          seats: input.seats ?? 0,
          pricePaiseMonth: input.amountPaise,
          billingInterval: input.billingInterval,
          // Set once and never cleared: "did this distributor ever leave" has to stay answerable.
          cancelledAt: status === 'cancelled' ? now : undefined,
          notes: input.note ?? null,
          updatedBy: actorId,
          updatedAt: now,
        }
        const [before] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.tenantId, input.tenantId))
          .limit(1)
          .for('update')
        // On conflict everything is replaced EXCEPT the row's own id: a distributor has one
        // subscription for the life of the relationship, and letting a later upsert renumber it would
        // break every `platform_audit` row and every link that already names it. A caller sending a
        // different id for a distributor that already has one is editing that row, not creating one.
        const { id: _id, ...updatable } = values
        const [row] = await tx
          .insert(subscriptions)
          .values(values)
          .onConflictDoUpdate({ target: subscriptions.tenantId, set: updatable })
          .returning()
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) {
              throw new ORPCError('CONFLICT', {
                message: `that subscription id already belongs to another distributor; ${input.tenantId} already has one`,
              })
            }
            throw error
          })
        if (!row) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'subscription upsert wrote nothing',
          })
        }
        // The plan lives in two places on purpose (the tenant row is what every service reads, the
        // subscription row is what the console edits); writing both here is what keeps them equal.
        if (tenant.plan !== input.plan) {
          await tx
            .update(tenants)
            .set({ plan: input.plan, updatedAt: now })
            .where(eq(tenants.id, input.tenantId))
        }
        await writePlatformAudit(tx, {
          action: before ? 'subscription.updated' : 'subscription.created',
          tenantId: input.tenantId,
          payload: {
            plan: input.plan,
            status: input.status,
            amountPaise: input.amountPaise,
            billingInterval: input.billingInterval,
            from: before
              ? { plan: before.plan, status: before.status, amountPaise: before.pricePaiseMonth }
              : null,
          },
        })
        return { item: toSubscription(row) }
      })
    })
  }
}
