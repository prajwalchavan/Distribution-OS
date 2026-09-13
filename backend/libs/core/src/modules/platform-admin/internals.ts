import { and, eq, isNull } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import {
  platformAdmins,
  platformAudit,
  users,
  withTenant,
  type Db,
  type subscriptionStatus,
  type TenantContext,
} from '@dos/db'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  levelAllows,
  type AdminProcedurePath,
  type Subscription,
  type SubscriptionStatus,
} from '@dos/contracts'
import { currentTenant } from '../../platform/index.js'
import { PLATFORM_SCOPE } from '../tenancy/index.js'

/**
 * The two ways module 13 reaches the database, and the difference between them is the whole security
 * argument of the platform console — so it is written down here once and referred to everywhere else.
 *
 * `withPlatform()` — `app_rw`, `app.actor_role = 'platform_admin'`, `app.tenant_id = ''`. This is the
 * normal path and it is under RLS. The four console tables (`platform_admins`, `subscriptions`,
 * `support_grants`, `platform_audit`) plus `tenants` have policies that key on the ACTOR'S ROLE with
 * no tenant predicate, so a console session reads and writes exactly those. Everything else in the
 * database compares `tenant_id` to `app.tenant_id`, which is the empty string here, so a console query
 * that strays into a business table reads ZERO rows rather than somebody's — the guarantee is the
 * policy, not this code.
 *
 * `withSystem()` — `app_worker`, BYPASSRLS. Used by exactly two procedures, each with a comment at the
 * call site saying why: `admin.tenants.create` (which writes `users`, `memberships` and the tenant's
 * chart of accounts through `bootstrapTenant`) and `admin.users.disable` (which writes `users` and
 * `auth_sessions`). Those tables deliberately have NO platform policy: a platform administrator who
 * could mint a membership would not need an owner-approved support grant, and the whole founder rule
 * would be theatre. Onboarding is the one moment the console legitimately creates a distributor's
 * first login, so it is the one place that reaches past RLS, under a named function, audited.
 *
 * Cross-tenant COUNTS (`admin.metrics.overview`, the sizes on `admin.tenants.list/get`) also run under
 * `withSystem` — see `counts.ts`, where every query is a COUNT or a MAX and no row of a distributor's
 * trade is ever returned.
 */
export async function withPlatform<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return withTenant(db, platformContext(), fn)
}

/** The console session's context. Throws outside a `platform_admin` request, which is the point. */
export function platformContext(): TenantContext {
  const ctx = currentTenant()
  if (ctx.actorRole !== 'platform_admin') {
    throw new ORPCError('FORBIDDEN', {
      message: 'This action needs a Distribution OS console session',
    })
  }
  return { tenantId: PLATFORM_SCOPE, actorId: ctx.actorId, actorRole: 'platform_admin' }
}

/** The signed-in administrator's user id, which every audit row and every grant is filed under. */
export function platformActorId(): string {
  return platformContext().actorId
}

/**
 * The console's own trail (`platform_audit`, append-only). Every mutation in module 13 writes one, and
 * `admin.audit.list` reads them back. It is filed under the ACTING administrator: the table's INSERT
 * policy pins `admin_user_id` to `app.actor_id`, so it cannot be written in somebody else's name.
 */
export async function writePlatformAudit(
  tx: Db,
  entry: { action: string; tenantId?: string | null; payload?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(platformAudit).values({
    id: uuidv7(),
    adminUserId: platformActorId(),
    action: entry.action,
    tenantId: entry.tenantId ?? null,
    payload: entry.payload ?? {},
  })
}

/**
 * THE ONE CHECK every `admin.*` handler makes, as the first statement of its own transaction (DOS-106).
 *
 * The token says `platform_admin` and was signed at most fifteen minutes ago. What it cannot say is
 * whether, since then, this person's console row was closed (`platform_admins.disabled_at`), their
 * login was locked (`users.status`, which `admin.users.disable` sets), or their LEVEL changed
 * (`platform_admins.role`). So the level and the login are read HERE, from the database, on every
 * console call — the reads as well as the writes — and a lock or a demotion bites on the next request
 * instead of fifteen minutes later. The token stays role-only.
 *
 * The level is checked against `ADMIN_LEVELS` in the contract, the same table the console hides its
 * buttons by: a `super` does everything, `support` reads and asks for (or withdraws) a support window,
 * `billing` reads and keeps what a distributor pays us. Handlers call this BEFORE `platformIdempotent`:
 * a stored reply is returned without running anything, so a lower level replaying a super's key with
 * the identical body would otherwise be handed the super's answer.
 *
 * One indexed row. It reads correctly on both paths: under `withPlatform` the actor sees their own
 * `platform_admins` row (the console's read policy) and their own `users` row (`users_visible` admits
 * `id = app.actor_id`); under `withSystem` RLS is bypassed.
 */
export async function requireActiveAdminLevel(
  tx: Db,
  actorId: string,
  procedure: AdminProcedurePath,
): Promise<void> {
  const [row] = await tx
    .select({ level: platformAdmins.role, loginStatus: users.status })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .where(and(eq(platformAdmins.userId, actorId), isNull(platformAdmins.disabledAt)))
    .limit(1)
  if (!row || row.loginStatus !== 'active') {
    throw new ORPCError('FORBIDDEN', { message: 'This console account is no longer active' })
  }
  if (!levelAllows(procedure, row.level)) {
    throw new ORPCError('FORBIDDEN', {
      message: `a ${row.level} console account may not call ${procedure}; ask a super administrator`,
    })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// wire ↔ column mappings the contract and the schema disagree about, in one place

/**
 * The wire says `trialing`, the column says `trial`. Neither is wrong: `trialing` is the word the
 * console's own screens use (it reads as a state, beside `active` and `past_due`), and `trial` is what
 * `subscription_status` was created with and is on disk in a hundred places. Mapping in one pair of
 * functions is cheaper than a migration that renames an enum value, and it is the same trick
 * `tenancy.support.*` uses for `read` ↔ `read_only`.
 */
export function statusToWire(value: string): SubscriptionStatus {
  return value === 'trial' ? 'trialing' : (value as SubscriptionStatus)
}

export type SubscriptionStatusColumn = (typeof subscriptionStatus.enumValues)[number]

export function statusToColumn(value: SubscriptionStatus): SubscriptionStatusColumn {
  return value === 'trialing' ? 'trial' : value
}

/**
 * A trial end is an IST BUSINESS DATE on the wire and a timestamp in the column, because it is
 * displayed as a day ("the trial ends on the 6th") and compared as an instant. Stored at the last
 * millisecond of that IST day, so "ends on the 6th" means the 6th is still inside the trial.
 */
export function trialEndToColumn(date: string | null | undefined): Date | null {
  if (!date) return null
  // 18:29:59.999Z of the previous UTC day is 23:59:59.999 IST of `date`.
  return new Date(`${date}T23:59:59.999+05:30`)
}

export function trialEndToWire(at: Date | null): string | null {
  return at ? businessDate(at).date : null
}

type SubscriptionRow = {
  id: string
  tenantId: string
  plan: string
  status: string
  trialEndsAt: Date | null
  periodStart: string | null
  periodEnd: string | null
  seats: number
  pricePaiseMonth: number
  billingInterval: string
  cancelledAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * One subscription row on the wire. `seats: 0` in the column means "not capped in this plan" and is
 * `null` on the wire; the period dates are never null in practice (both `upsert` and onboarding write
 * them) but the column allows it, so a row written before this module existed falls back to the day it
 * was created rather than failing its own output schema.
 */
export function toSubscription(row: SubscriptionRow): Subscription {
  const created = businessDate(row.createdAt).date
  return {
    id: row.id,
    tenantId: row.tenantId,
    plan: row.plan as Subscription['plan'],
    status: statusToWire(row.status),
    amountPaise: row.pricePaiseMonth,
    billingInterval: row.billingInterval as Subscription['billingInterval'],
    seats: row.seats > 0 ? row.seats : null,
    currentPeriodStart: row.periodStart ?? created,
    currentPeriodEnd: row.periodEnd ?? created,
    trialEndDate: trialEndToWire(row.trialEndsAt),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    note: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** `2026-09-06` + 30 days, still an IST business date. Used for trial ends and billing periods. */
export function addDays(date: string, days: number): string {
  return businessDate(new Date(`${date}T00:00:00+05:30`).getTime() + days * 86_400_000).date
}
