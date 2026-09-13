import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type {
  Subscription,
  SupportGrant,
  TenantCreateIn,
  TenantCreateOut,
  TenantDetail,
  TenantGet,
  TenantItem,
  TenantReactivateIn,
  TenantsList,
  TenantsListInput,
  TenantSummary,
  TenantSuspendIn,
} from '@dos/contracts'
import type { z } from 'zod'
import {
  bootstrapTenant,
  hashPassword,
  memberships,
  normalizeUsername,
  subscriptions,
  supportGrants,
  tenants,
  users,
  validatePassword,
  withSystem,
  type Db,
} from '@dos/db'
import { businessDate } from '@dos/domain'
import { DB, platformIdempotent, isUniqueViolation, requireDb } from '../../platform/index.js'
import { toSupportGrant } from './support-grants.js'
import { tenantSizes } from './counts.js'
import {
  addDays,
  platformActorId,
  requireActiveAdminLevel,
  statusToWire,
  toSubscription,
  trialEndToColumn,
  withPlatform,
  writePlatformAudit,
} from './internals.js'

type ListIn = z.infer<typeof TenantsListInput>
type TenantRow = typeof tenants.$inferSelect
type SubscriptionRow = typeof subscriptions.$inferSelect

/** A new distributor's free window, in IST days, when the console does not say otherwise. */
const DEFAULT_TRIAL_DAYS = 30
/** How long the first billing period runs. Thirty days like the trial: one number, one screen. */
const DEFAULT_PERIOD_DAYS = 30

/**
 * ONBOARDING AND THE LIFE OF A DISTRIBUTORSHIP (module 13, founder decision 2026-09-05, docs/22 §2
 * row 7). Four things a distributor's own apps can never do to themselves: come into existence, be
 * switched off, be switched back on, and be listed beside everybody else.
 *
 * `create` is the only procedure in the product that creates a tenant. It does in one call what the
 * founder does by hand today: the `tenants` row, the chart of accounts / stock locations / numbering
 * series through `bootstrapTenant()`, the first OWNER login with a TEMPORARY password, and a trial
 * subscription — so the handover call is "here is your username, here is a password you must change".
 */
@Injectable()
export class PlatformTenantsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * The console's home list. Sizes come from `tenantSizes()` in one pass for the whole page — counts
   * only, never a rupee of anybody's trade (see the header of `counts.ts`).
   */
  async list(input: ListIn): Promise<TenantsList> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdminLevel(tx, platformActorId(), 'admin.tenants.list')
      const q = input.q?.trim()
      const where = and(
        input.status ? eq(tenants.status, input.status) : undefined,
        input.plan ? eq(tenants.plan, input.plan) : undefined,
        input.subscriptionStatus
          ? eq(subscriptions.status, subscriptionColumn(input.subscriptionStatus))
          : undefined,
        q
          ? or(
              ilike(tenants.slug, `%${q}%`),
              ilike(tenants.legalName, `%${q}%`),
              ilike(tenants.gstin, `%${q}%`),
            )
          : undefined,
        input.cursor ? sql`${tenants.id} > ${input.cursor}` : undefined,
      )
      const rows = await tx
        .select({ tenant: tenants, subscription: subscriptions })
        .from(tenants)
        .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .where(where)
        .orderBy(asc(tenants.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const sizes = await tenantSizes(
        db,
        page.map((r) => r.tenant.id),
      )
      const last = page.at(-1)
      return {
        items: page.map((r) => toSummary(r.tenant, r.subscription, sizes.get(r.tenant.id))),
        nextCursor: rows.length > input.limit && last ? last.tenant.id : null,
      }
    })
  }

  /** One distributor: the summary, its subscription, its support grants and what it is storing. */
  async get(input: { id: string }): Promise<TenantGet> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdminLevel(tx, platformActorId(), 'admin.tenants.get')
      const [row] = await tx
        .select({ tenant: tenants, subscription: subscriptions })
        .from(tenants)
        .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .where(eq(tenants.id, input.id))
        .limit(1)
      if (!row) throw notFound(input.id)
      const grants = await tx
        .select()
        .from(supportGrants)
        .where(eq(supportGrants.tenantId, input.id))
        .orderBy(desc(supportGrants.requestedAt))
        .limit(20)
      const sizes = await tenantSizes(db, [input.id])
      const size = sizes.get(input.id)
      const summary = toSummary(row.tenant, row.subscription, size)
      const item: TenantDetail = {
        ...summary,
        subscription: row.subscription ? toSubscription(row.subscription) : null,
        supportGrants: grants.map((g): SupportGrant => toSupportGrant(g)),
        storageBytes: size?.storageBytes ?? 0,
        invoices30d: size?.invoices30d ?? 0,
      }
      return { item }
    })
  }

  /**
   * Onboard a distributor. This is the ONE procedure in module 13 that runs under `withSystem()`
   * (BYPASSRLS), and the reason is deliberate: it writes `users` and `memberships`, which have NO
   * platform policy on purpose (`schema/tenancy.ts`). A platform administrator who could mint a
   * membership at will would never need an owner-approved support grant, and the founder's whole
   * support rule would be decoration. Creating a distributorship's FIRST owner is the one moment that
   * is legitimately ours, so it happens here, in a named function, and writes a `platform_audit` row.
   *
   * Idempotent under the caller's `idempotencyKey`, filed against the tenant being created — the row
   * has to exist before the key can point at it (the key's `tenant_id` is a foreign key), so the tenant
   * is inserted first with `onConflictDoNothing` and the guard below turns "this id is already
   * somebody else's distributorship" into a 409 rather than a silent overwrite.
   */
  async create(input: TenantCreateIn): Promise<TenantCreateOut> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    // The level and the login FIRST, in a short console transaction of their own: a support or billing
    // account never costs an argon2 hash. The check inside the onboarding transaction below is the one
    // that decides; this one only refuses early.
    await withPlatform(db, (tx) => requireActiveAdminLevel(tx, actorId, 'admin.tenants.create'))
    const weak = validatePassword(input.owner.temporaryPassword)
    if (weak) throw new ORPCError('BAD_REQUEST', { message: weak })
    const passwordHash = await hashPassword(input.owner.temporaryPassword)
    const username = normalizeUsername(input.owner.username)
    const now = new Date()
    const today = businessDate(now).date
    return withSystem(db, async (tx) => {
      // The authoritative check, inside the onboarding transaction and before the tenant insert and the
      // idempotency key: the level and the login as they stand at this moment.
      await requireActiveAdminLevel(tx, actorId, 'admin.tenants.create')
      await tx
        .insert(tenants)
        .values({
          id: input.id,
          slug: input.slug,
          legalName: input.legalName,
          gstin: input.gstin ?? null,
          stateCode: input.stateCode,
          plan: input.plan,
          status: 'active',
          onboardedAt: now,
          onboardedBy: actorId,
        })
        .onConflictDoNothing({ target: tenants.id })
        .catch(conflict(`the slug ${input.slug} is already taken by another distributor`))
      return platformIdempotent(tx, input.id, input.idempotencyKey, input, async () => {
        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.id)).limit(1)
        if (!tenant) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'tenant vanished' })
        if (tenant.slug !== input.slug) {
          throw new ORPCError('CONFLICT', {
            message: `a distributor already exists under this id (${tenant.slug}); use a new UUIDv7`,
          })
        }
        // Chart of accounts, stock locations, numbering series and the default settings — the same
        // call `pnpm db:seed` makes, so an onboarded distributorship is bootstrapped exactly like the
        // pilot rather than "nearly".
        await bootstrapTenant(tx, tenant.id, now)

        // The owner may already exist as a person: a shopkeeper who also runs a distributorship, or
        // somebody who works for two. `users.phone` is unique, so the phone is the identity and the
        // supplied `userId` is only used when the person is new (docs/22 §2: a user is global).
        const [existing] = await tx
          .select()
          .from(users)
          .where(eq(users.phone, input.owner.phone))
          .limit(1)
        const userId = existing?.id ?? input.owner.userId
        if (!existing) {
          await tx
            .insert(users)
            .values({
              id: userId,
              phone: input.owner.phone,
              name: input.owner.name,
              locale: input.owner.locale ?? 'en-IN',
              username,
              passwordHash,
              passwordChangedAt: now,
              // Nobody at Distribution OS knows this password after the handover call.
              mustChangePassword: true,
            })
            .catch(conflict(`the username ${username} is already taken`))
        }
        await tx
          .insert(memberships)
          .values({
            id: input.owner.membershipId,
            tenantId: tenant.id,
            userId,
            role: 'owner',
            status: 'active',
          })
          .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })

        const trialDays = input.subscription.trialDays
        const [subscription] = await tx
          .insert(subscriptions)
          .values({
            id: input.subscription.id,
            tenantId: tenant.id,
            plan: input.plan,
            status: trialDays > 0 ? 'trial' : 'active',
            trialEndsAt: trialDays > 0 ? trialEndToColumn(addDays(today, trialDays)) : null,
            periodStart: today,
            periodEnd: addDays(today, trialDays > 0 ? trialDays : DEFAULT_PERIOD_DAYS),
            seats: input.subscription.seats ?? 0,
            pricePaiseMonth: input.subscription.amountPaise,
            billingInterval: input.subscription.billingInterval,
            updatedBy: actorId,
          })
          .onConflictDoNothing({ target: subscriptions.tenantId })
          .returning()
        const saved = subscription ?? (await subscriptionOf(tx, tenant.id))
        if (!saved)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'subscription insert failed' })

        await insertPlatformAuditUnderSystem(tx, actorId, {
          action: 'tenant.onboarded',
          tenantId: tenant.id,
          payload: { slug: tenant.slug, plan: tenant.plan, ownerUserId: userId, trialDays },
        })
        return {
          tenant: toTenant(tenant),
          owner: {
            userId,
            membershipId: input.owner.membershipId,
            username,
            mustChangePassword: true as const,
          },
          subscription: toSubscription(saved),
        }
      })
    })
  }

  /**
   * The kill switch. Nothing is deleted and no row moves: `tenants.status` becomes `suspended`, and
   * auth-service refuses every sign-in and every refresh for that distributorship with 423 and a
   * sentence naming who to call. `reason` is mandatory because a distributorship stops working the
   * moment this returns, and "who did this and why" must never be a guess.
   */
  async suspend(input: TenantSuspendIn): Promise<TenantItem> {
    return this.setStatus(
      'admin.tenants.suspend',
      input.id,
      input.idempotencyKey,
      input,
      'suspended',
      { action: 'tenant.suspended', reason: input.reason },
    )
  }

  async reactivate(input: TenantReactivateIn): Promise<TenantItem> {
    return this.setStatus(
      'admin.tenants.reactivate',
      input.id,
      input.idempotencyKey,
      input,
      'active',
      { action: 'tenant.reactivated', reason: input.note ?? null },
    )
  }

  private async setStatus(
    path: 'admin.tenants.suspend' | 'admin.tenants.reactivate',
    id: string,
    idempotencyKey: string,
    request: unknown,
    status: 'active' | 'suspended',
    audit: { action: string; reason: string | null },
  ): Promise<TenantItem> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    return withPlatform(db, async (tx) => {
      // The level and the login BEFORE the key: a stored reply is handed back without running anything,
      // so a support account replaying a super's suspension with the identical body must stop here.
      await requireActiveAdminLevel(tx, actorId, path)
      return platformIdempotent(tx, id, idempotencyKey, request, async () => {
        const [before] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, id))
          .limit(1)
          .for('update')
        if (!before) throw notFound(id)
        if (before.status === 'closed') {
          throw new ORPCError('CONFLICT', {
            message: `${before.legalName} is closed; a closed distributorship is not reopened from the console`,
          })
        }
        const [row] = await tx
          .update(tenants)
          .set({ status, updatedAt: new Date() })
          .where(eq(tenants.id, id))
          .returning()
        const saved = row ?? before
        await writePlatformAudit(tx, {
          action: audit.action,
          tenantId: id,
          payload: { from: before.status, to: status, reason: audit.reason },
        })
        return { item: toTenant(saved) }
      })
    })
  }
}

function notFound(id: string): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message: `no distributor ${id}` })
}

/**
 * A unique index the console can actually explain (a taken slug, a taken username) becomes a 409 with
 * that sentence; anything else is re-thrown untouched, so a real fault is never dressed up as a
 * client mistake.
 */
function conflict(message: string): (error: unknown) => never {
  return (error: unknown) => {
    if (isUniqueViolation(error)) throw new ORPCError('CONFLICT', { message })
    throw error
  }
}

async function subscriptionOf(tx: Db, tenantId: string): Promise<SubscriptionRow | undefined> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1)
  return row
}

/**
 * `writePlatformAudit` files the row under the console context's actor; under `withSystem` the actor
 * role is `system` (which `platform_audit`'s INSERT policy also names), so the actor is spelled out here.
 */
async function insertPlatformAuditUnderSystem(
  tx: Db,
  actorId: string,
  entry: { action: string; tenantId: string | null; payload: Record<string, unknown> },
): Promise<void> {
  await tx.execute(sql`
    insert into platform_audit (id, admin_user_id, action, tenant_id, payload)
    values (gen_random_uuid()::text, ${actorId}, ${entry.action}, ${entry.tenantId},
            ${JSON.stringify(entry.payload)}::jsonb)
  `)
}

function toTenant(row: TenantRow): TenantItem['item'] {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legalName,
    gstin: row.gstin,
    stateCode: row.stateCode,
    plan: row.plan,
    status: row.status,
  }
}

function toSummary(
  tenant: TenantRow,
  subscription: SubscriptionRow | null,
  size:
    | { staffCount: number; retailerCount: number; orders30d: number; lastActivityAt: Date | null }
    | undefined,
): TenantSummary {
  return {
    ...toTenant(tenant),
    subscriptionStatus: subscription ? statusToWire(subscription.status) : null,
    trialEndDate: subscription?.trialEndsAt ? businessDate(subscription.trialEndsAt).date : null,
    staffCount: size?.staffCount ?? 0,
    retailerCount: size?.retailerCount ?? 0,
    orders30d: size?.orders30d ?? 0,
    lastActivityAt: size?.lastActivityAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
  }
}

function subscriptionColumn(status: Subscription['status']): SubscriptionRow['status'] {
  return status === 'trialing' ? 'trial' : status
}

export { DEFAULT_TRIAL_DAYS, DEFAULT_PERIOD_DAYS }
