import { sql } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  actorRoleIn,
  id,
  paise,
  PLATFORM_ROLES,
  platformReadPolicy,
  platformWritePolicies,
  timestamps,
  tz,
} from './columns.js'
import { appRw } from './roles.js'
import { tenantPlan, tenants, users } from './tenancy.js'

/**
 * MODULE 13 — the platform console (founder decision 2026-09-05, docs/22 §2 row 7 and §8): a seventh
 * app and service, "Distribution OS - Admin" (`admin-service` :3007), for onboarding a distributor
 * organisation, recording its plan and subscription state, and granting Distribution OS staff
 * **time-boxed, owner-approved, audited** access to a tenant when support is needed.
 *
 * These four tables are the only GLOBAL, non-tenant business tables in the product. Everything else
 * hangs off `tenant_id` and is reached through `withTenant()`; these are reached the same way, but
 * their policies key on the ACTOR'S ROLE alone, because a platform admin has no membership anywhere:
 *
 *   platform_admins  who on our side may open the console at all, and at what level.
 *   subscriptions    one row per distributor: plan, state, trial end, period, seats, monthly price.
 *                    It RECORDS revenue, it never collects it — there is no fintech in the product
 *                    (docs/22 §8, docs/25 P2-22: billing, dunning and MRR are phase 2).
 *   support_grants   one request for access to one distributor's data, which only that distributor's
 *                    OWNER can approve, which expires on its own, and which is never deleted.
 *   platform_audit   append-only: every action our staff took, with the tenant it touched.
 *
 * `platform_admin` IS NOT A MEMBERSHIP ROLE. It is deliberately absent from the `membership_role`
 * enum (the hand-written migration asserts that it stays absent): a value there would let a tenant's
 * own onboarders write themselves a membership that reads every other distributor's console. It is a
 * value of `ActorRole` (src/client.ts) that only `admin-service` ever puts into `app.actor_role`,
 * because only `admin-service` accepts a token whose subject is a row of `platform_admins`.
 *
 * WHAT THE POLICIES BELOW GUARANTEE, and why each is narrower than it could be:
 *
 *   - No tenant role reads ANY of the four tables, with exactly one exception: a distributor's OWNER
 *     reads, approves and revokes the support grants against ITS OWN tenant. That exception is the
 *     whole point of "owner-approved" — a grant the owner cannot see is not a grant, it is a back door.
 *     The owner's write is held to four columns by `dos_support_grant_guard()` in the hand-written
 *     sibling, because RLS has no column granularity: an owner may approve or revoke, never re-scope
 *     a grant to `read_write` or push its expiry out.
 *   - A platform admin NEVER approves a grant, not even their own request: the approval columns are
 *     refused to a `platform_admin` actor by the same trigger. Requesting and approving are two people
 *     in two different companies.
 *   - Nothing here has a DELETE policy. A support grant is revoked and kept; an audit row is a record;
 *     an admin is disabled (`disabled_at`), never removed, or the audit trail loses its subjects.
 *   - `platform_audit` is append-only in the database (`dos_reject_mutation()`, the same trigger the
 *     stock ledger, the journal, `audit_log` and `auth_events` carry).
 *
 * The subscription is NOT readable by the distributor's own owner. The console records what we charge;
 * the owner app has no billing screen, and the founder's decision keeps revenue outside the product.
 * If an owner-facing "your plan" card is ever wanted, it is one narrow own-tenant SELECT policy — add
 * it deliberately, do not widen `subscriptions_read`.
 */

/**
 * What one of our own people may do in the console. `super` administers the console itself (creates and
 * disables admins — `dos_platform_admin_guard()` holds that to `super` alone); `support` requests access
 * to a tenant and answers tickets; `billing` maintains plans and subscription state. Values are
 * APPENDED, never reordered: the order is on disk.
 */
export const platformAdminRole = pgEnum('platform_admin_role', ['super', 'support', 'billing'])

/**
 * Where a distributor stands with us. `trial` — inside the free window (`trial_ends_at`); `active` —
 * paying; `past_due` — the invoice we raised outside the product is unpaid, the apps keep working;
 * `suspended` — sign-in is refused (paired with `tenants.status = 'suspended'`); `cancelled` — the
 * distributor left, the data stays. Values are APPENDED, never reordered.
 */
export const subscriptionStatus = pgEnum('subscription_status', [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
])

/** How much a support grant may do once the owner approves it: look, or look and act. */
export const supportGrantScope = pgEnum('support_grant_scope', ['read', 'read_write'])

/**
 * Distribution OS staff who may open the console. One row per user, so the same person cannot hold two
 * levels; `disabled_at` is how access ends (the row itself stays, or `platform_audit` would name people
 * who no longer exist).
 *
 * `created_by` is the `super` admin who added them. The first row of all is written by the seed, under
 * the migrating connection — which has no `app.actor_role`, so the guard's `super` rule does not bind
 * it. That is the deliberate bootstrap: a database owner can always create the first administrator, and
 * from then on only an active `super` can create the next.
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: platformAdminRole('role').notNull(),
    /** The `super` admin who created this one; null for the founding row written by the seed. */
    createdBy: text('created_by').references(() => users.id),
    /** Access ends here. The row is kept so the audit trail keeps its subject. */
    disabledAt: tz('disabled_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('platform_admins_user_idx').on(t.userId),
    /** "Who can still open the console", the console's own roster screen. */
    index('platform_admins_active_idx')
      .on(t.role, t.createdAt)
      .where(sql`disabled_at IS NULL`),
    platformReadPolicy('platform_admins_read'),
    ...platformWritePolicies('platform_admins_write'),
  ],
).enableRLS()

/**
 * One row per distributor: what they are on and where they stand. Kept as CURRENT STATE, not as a
 * billing history — the history of who changed what is `platform_audit`, and invoicing is phase 2
 * (docs/25 P2-22). `plan` reuses the `tenant_plan` enum that `tenants.plan` already carries, extended
 * with `standard` and `pro`, so the two can never disagree about what a plan is called.
 *
 * `price_paise_month` is integer paise like every other amount in the product (never a float, never
 * rupees), and `seats` is a plain count — neither is charged by anything we run; they are what the
 * founder agreed with the distributor, written down where support can see it.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    plan: tenantPlan('plan').notNull(),
    status: subscriptionStatus('status').notNull().default('trial'),
    /** When the free window closes. Required by trigger while `status = 'trial'`. */
    trialEndsAt: tz('trial_ends_at'),
    /** The agreed term, IST business dates (`@dos/domain` calendar), not timestamps. */
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    /** Staff seats agreed with the distributor; 0 while nothing is agreed. */
    seats: integer('seats').notNull().default(0),
    /** Integer paise per month (ADR: money is never a float, never rupees). */
    pricePaiseMonth: paise('price_paise_month').notNull().default(0),
    notes: text('notes'),
    /** The platform admin who last touched it; checked against `platform_admins` by trigger. */
    updatedBy: text('updated_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    /** One subscription row per distributor: the console edits state, it does not append periods. */
    uniqueIndex('subscriptions_tenant_idx').on(t.tenantId),
    /** The console's home list: "who is in trial, who is past due", oldest first. */
    index('subscriptions_status_idx').on(t.status, t.createdAt),
    platformReadPolicy('subscriptions_read'),
    ...platformWritePolicies('subscriptions_write'),
  ],
).enableRLS()

/**
 * One time-boxed request by one of our people to look inside one distributor's data (docs/22 §8,
 * 2026-09-05: "support access = time-boxed, owner-approved, audited"; docs/17 §B security).
 *
 * The life of a row: a `support` admin INSERTs it with a reason and the expiry they are asking for;
 * the distributor's OWNER approves it (`approved_by`, `approved_at`) or leaves it alone; access is
 * live only while `approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at > now()`; either side
 * revokes it (`revoked_at`, `revoked_by`). Nothing here is ever deleted, and every step is mirrored
 * into `platform_audit` by the service.
 *
 * The window itself is a database rule, not an app rule: `dos_support_grant_guard()` refuses an expiry
 * that is not after the request, or more than 30 days after it. "Time-boxed" that the requester can set
 * to the year 2099 is not time-boxed.
 */
export const supportGrants = pgTable(
  'support_grants',
  {
    id: id(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The person asking. Must be a row of `platform_admins` that is not disabled (trigger). */
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id),
    requestedAt: tz('requested_at').notNull().defaultNow(),
    reason: text('reason').notNull(),
    /**
     * The window our side ASKED for, in hours (1–72, `admin.support.request` defaults to 4). Kept
     * beside `expires_at` rather than derived from it, because the owner may APPROVE A SHORTER window
     * (`tenancy.support.approve.hours`), which moves `expires_at` in — and the owner's screen, and
     * anyone reading the row afterwards, still has to be able to see what was asked for against what
     * was granted. Never widened after the request: `dos_support_grant_guard()` refuses.
     */
    requestedHours: integer('requested_hours').notNull().default(4),
    /** The tenant's OWNER, and never the requester. Set together with `approved_at` (trigger). */
    approvedBy: text('approved_by').references(() => users.id),
    approvedAt: tz('approved_at'),
    /** The end of the window. Must be after `requested_at` and at most 30 days after it (trigger). */
    expiresAt: tz('expires_at').notNull(),
    /** What the owner wrote when they answered — shown back to them and to our side. */
    decisionNote: text('decision_note'),
    revokedAt: tz('revoked_at'),
    revokedBy: text('revoked_by').references(() => users.id),
    /** Why the window was refused or shut. Null while the grant is open. */
    revokeReason: text('revoke_reason'),
    scope: supportGrantScope('scope').notNull().default('read'),
    ...timestamps,
  },
  (t) => [
    /** The owner app's "who asked for access to my data", newest first. */
    index('support_grants_tenant_idx').on(t.tenantId, t.requestedAt),
    /** The console's "what am I allowed into", and the auth check on every support session. */
    index('support_grants_admin_idx').on(t.adminUserId, t.requestedAt),
    /** The sweep that closes expired grants, and the "is this live" check. */
    index('support_grants_live_idx')
      .on(t.expiresAt)
      .where(sql`revoked_at IS NULL`),
    /**
     * Our staff read every grant; the distributor's OWNER reads the grants against its own tenant and
     * nobody else's. No manager, no accountant: a support grant names our people and their reasons,
     * and answering it is the owner's own decision (docs/22 §8, accountant scope 2026-09-05).
     */
    pgPolicy('support_grants_read', {
      for: 'select',
      to: appRw,
      using: sql`(SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
    }),
    /** Only we ask. An owner cannot write itself a grant, and would have no reason to. */
    pgPolicy('support_grants_insert', {
      for: 'insert',
      to: appRw,
      withCheck: actorRoleIn(PLATFORM_ROLES),
    }),
    /**
     * Two very different updates share one policy because RLS cannot split by column: ours (widen the
     * reason, revoke) and the owner's (approve, revoke). `dos_support_grant_guard()` is what makes them
     * different — an owner may touch only the four decision columns, and a platform admin may never
     * touch the two approval ones.
     */
    pgPolicy('support_grants_update', {
      for: 'update',
      to: appRw,
      using: sql`(SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
      withCheck: sql`(SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
    }),
  ],
).enableRLS()

/**
 * Append-only trail of everything our own staff did: which admin, what action, which distributor (null
 * for console-wide work such as creating another admin), and the payload that explains it. It is the
 * "audited" third of the founder's support rule, and the reason `platform_admins` rows are disabled
 * rather than deleted.
 *
 * The INSERT check pins `admin_user_id` to the acting person exactly as `audit_log` pins `actor_id`,
 * and `dos_platform_audit_guard()` refuses a row filed under someone who is not an administrator at
 * all. There is no UPDATE and no DELETE policy, and `dos_reject_mutation()` refuses both for every
 * other role including the owner connection.
 */
export const platformAudit = pgTable(
  'platform_audit',
  {
    id: id(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id),
    /** `tenant.onboarded`, `subscription.updated`, `support.requested`, `admin.created`, … */
    action: text('action').notNull(),
    /** The distributor this touched; null for work that names no tenant. */
    tenantId: text('tenant_id').references(() => tenants.id),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('platform_audit_admin_idx').on(t.adminUserId, t.createdAt),
    index('platform_audit_tenant_idx').on(t.tenantId, t.createdAt),
    index('platform_audit_action_idx').on(t.action, t.createdAt),
    platformReadPolicy('platform_audit_read'),
    pgPolicy('platform_audit_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`((SELECT current_setting('app.actor_role', true)) = 'platform_admin'
          AND admin_user_id = (SELECT current_setting('app.actor_id', true)))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()
