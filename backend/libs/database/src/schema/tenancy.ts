import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  actorIs,
  id,
  ONBOARDER_ROLES,
  roleWritePolicies,
  tenantMatches,
  tenantReadPolicy,
  timestamps,
  tz,
} from './columns.js'
import { appRw } from './roles.js'

export const tenantPlan = pgEnum('tenant_plan', ['pilot', 'starter', 'growth'])
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'closed'])

/**
 * A tenant is one distributor business (e.g. Tarsun Enterprises). Every member reads its own tenant's
 * row (`tenancy.me`); only the owner edits it (`tenancy.tenant.update`, docs/23 §8.13 — legal name,
 * GSTIN, state code, all of which print on a tax document). Creation and closure run as the system
 * role: there is no owner yet when a distributor signs up.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text('slug').notNull(),
    legalName: text('legal_name').notNull(),
    gstin: text('gstin'),
    stateCode: text('state_code').notNull(),
    plan: tenantPlan('plan').notNull().default('pilot'),
    status: tenantStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    pgPolicy('tenants_read', { for: 'select', to: appRw, using: tenantMatches('id') }),
    pgPolicy('tenants_owner_update', {
      for: 'update',
      to: appRw,
      using: sql`id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')`,
      withCheck: sql`id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')`,
    }),
    pgPolicy('tenants_system_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`(SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()

/**
 * Tenant roles (synthesis §9), one app per role. `warehouse` is the stock keeper (picking, packing,
 * GRNs, cycle counts) and never sees purchase cost. Platform roles `curator` and `support` are not
 * memberships; they live on users.platform_role. New values are APPENDED — the enum order is on disk.
 */
export const membershipRole = pgEnum('membership_role', [
  'owner',
  'manager',
  'salesperson',
  'delivery',
  'accountant',
  'retailer',
  'warehouse',
])
export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'disabled'])
export const platformRole = pgEnum('platform_role', ['curator', 'support'])
/** A disabled user cannot sign in on any device and every existing session is revoked. */
export const userStatus = pgEnum('user_status', ['active', 'disabled'])

/**
 * Users are global identities keyed by phone (E.164). A retailer's user can hold memberships in many
 * tenants, which is how one shop buys from several distributors without a second login (ADR 0006).
 *
 * Sign-in is username + password (auth-service). `username`/`password_hash` are nullable so a user
 * created by invite exists before credentials are set; such a user simply cannot sign in yet. The
 * phone stays a profile field (OTP is a later enhancement).
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    locale: text('locale').notNull().default('hi-IN'),
    platformRole: platformRole('platform_role'),
    /** Lowercase, 3–32 chars of [a-z0-9._]; unique across the platform (see users_username_idx). */
    username: text('username'),
    /** argon2id (see src/auth/password.ts). Never leaves the database except to verifyPassword(). */
    passwordHash: text('password_hash'),
    passwordChangedAt: tz('password_changed_at'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Consecutive failures; 5 → locked_until = now + 15 min. Reset by a successful login. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tz('locked_until'),
    status: userStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_idx').on(t.phone),
    uniqueIndex('users_username_idx')
      .on(sql`lower(${t.username})`)
      .where(sql`username is not null`),
    // visible to itself and to members of the current tenant (through memberships)
    pgPolicy('users_visible', {
      for: 'select',
      to: appRw,
      using: sql`id = (SELECT current_setting('app.actor_id', true)) OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = (SELECT current_setting('app.tenant_id', true))
      )`,
    }),
    pgPolicy('users_self_update', { for: 'update', to: appRw, using: actorIs('id') }),
    pgPolicy('users_insert', { for: 'insert', to: appRw, withCheck: sql`true` }),
  ],
).enableRLS()

/**
 * Who belongs to which distributor, as what. Every member reads the roster of its own tenant (the
 * owner app's staff list, a retailer app's "which distributors am I linked to" through the auth
 * service); only the onboarders write it — the old FOR ALL policy let any member, a shopkeeper
 * included, INSERT a membership and make itself the owner.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: membershipRole('role').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_idx').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    tenantReadPolicy('memberships_read'),
    ...roleWritePolicies('memberships_write', ONBOARDER_ROLES),
  ],
).enableRLS()
