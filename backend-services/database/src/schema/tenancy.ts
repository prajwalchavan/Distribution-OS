import { sql } from 'drizzle-orm'
import { index, pgEnum, pgPolicy, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { actorIs, id, tenantMatches, timestamps } from './columns.js'
import { appRw } from './roles.js'

export const tenantPlan = pgEnum('tenant_plan', ['pilot', 'starter', 'growth'])
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'closed'])

/** A tenant is one distributor business (e.g. Tarsun Enterprises). */
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
    pgPolicy('tenants_own_row', { for: 'all', to: appRw, using: tenantMatches('id') }),
  ],
).enableRLS()

/** Tenant roles (synthesis §9). Platform roles `curator` and `support` are not memberships; they live on users.platform_role. */
export const membershipRole = pgEnum('membership_role', [
  'owner',
  'manager',
  'salesperson',
  'delivery',
  'accountant',
  'retailer',
])
export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'disabled'])
export const platformRole = pgEnum('platform_role', ['curator', 'support'])

/**
 * Users are global identities keyed by phone (E.164). A retailer's user can hold memberships in many
 * tenants, which is how one shop buys from several distributors without a second login (ADR 0006).
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    locale: text('locale').notNull().default('hi-IN'),
    platformRole: platformRole('platform_role'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_idx').on(t.phone),
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
    pgPolicy('memberships_tenant', {
      for: 'all',
      to: appRw,
      using: tenantMatches('tenant_id'),
      withCheck: tenantMatches('tenant_id'),
    }),
  ],
).enableRLS()
