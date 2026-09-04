import { sql } from 'drizzle-orm'
import { bigint, integer, pgPolicy, text, timestamp } from 'drizzle-orm/pg-core'
import { appRw } from './roles.js'

/** ADR 0001: every synced table uses a client-generated UUIDv7 `id text` (PowerSync requires text ids). */
export const id = () => text('id').primaryKey()

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}

export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** Money is integer paise (bigint so monthly totals above ₹2.1 crore never overflow int4). */
export const paise = (name: string) => bigint(name, { mode: 'number' })
/** Quantities are integer pieces; cases are display only (ADR 0003). */
export const pieces = (name: string) => integer(name)
/** Percentages are basis points: 8.33% = 833. */
export const bps = (name: string) => integer(name)

/** `tenant_id` column. FK to tenants is added by each module through `tenantRef` to avoid import cycles here. */
export const tenantIdColumn = () => text('tenant_id').notNull()

/**
 * ADR 0002 RLS predicates. Each unit of work runs inside a transaction that starts with
 * set_config('app.tenant_id' | 'app.actor_id' | 'app.actor_role', ..., true); policies read those settings.
 * The `(SELECT ...)` form lets Postgres evaluate the setting once per statement instead of per row.
 */
export const tenantMatches = (column: string) =>
  sql.raw(`${column} = (SELECT current_setting('app.tenant_id', true))`)
export const actorIs = (column: string) =>
  sql.raw(`${column} = (SELECT current_setting('app.actor_id', true))`)
export const actorRoleIn = (roles: readonly string[]) =>
  sql.raw(
    `(SELECT current_setting('app.actor_role', true)) IN (${roles.map((r) => `'${r}'`).join(', ')})`,
  )

export const STAFF_ROLES = [
  'owner',
  'manager',
  'salesperson',
  'delivery',
  'accountant',
  'system',
] as const
export const BACK_OFFICE_ROLES = ['owner', 'manager', 'accountant', 'system'] as const
export const OWNER_ROLES = ['owner', 'system'] as const
export const CURATOR_ROLES = ['curator', 'system'] as const

/** Plain tenant isolation: any role that is a member of the tenant. */
export const tenantPolicy = (name: string) =>
  pgPolicy(name, {
    for: 'all',
    to: appRw,
    using: tenantMatches('tenant_id'),
    withCheck: tenantMatches('tenant_id'),
  })

/** Tenant isolation plus a role predicate (e.g. purchase cost is owner/manager/accountant only). */
export const tenantRolePolicy = (name: string, roles: readonly string[]) => {
  const predicate = sql.raw(
    `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN (${roles
      .map((r) => `'${r}'`)
      .join(', ')})`,
  )
  return pgPolicy(name, { for: 'all', to: appRw, using: predicate, withCheck: predicate })
}

/**
 * Staff see every row of the tenant; a retailer-role actor sees only rows whose `retailerColumn` is one of the
 * retailers linked to their identity (ADR 0006), via the denormalised retailer_links.user_id (a policy that joined
 * retailer_identities would recurse: Postgres 42P17). Retailer-role WRITE access is granted per table explicitly.
 */
export const tenantOrOwnRetailerPolicy = (name: string, retailerColumn: string) =>
  pgPolicy(name, {
    for: 'select',
    to: appRw,
    using: sql.raw(
      `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR ${retailerColumn} IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      )`,
    ),
  })

/** Writes on a tenant table are staff-only (retailer role is read-only there). */
export const staffWritePolicy = (name: string) => {
  const predicate = sql.raw(
    `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'`,
  )
  return [
    pgPolicy(`${name}_insert`, { for: 'insert', to: appRw, withCheck: predicate }),
    pgPolicy(`${name}_update`, {
      for: 'update',
      to: appRw,
      using: predicate,
      withCheck: predicate,
    }),
    pgPolicy(`${name}_delete`, { for: 'delete', to: appRw, using: predicate }),
  ]
}

/** Global (non-tenant) reference data: readable by every role, writable only by the curator/system role. */
export const globalCuratedPolicies = (name: string) => {
  const curate = actorRoleIn(CURATOR_ROLES)
  return [
    pgPolicy(`${name}_read`, { for: 'select', to: appRw, using: sql`true` }),
    pgPolicy(`${name}_curate_insert`, { for: 'insert', to: appRw, withCheck: curate }),
    pgPolicy(`${name}_curate_update`, {
      for: 'update',
      to: appRw,
      using: curate,
      withCheck: curate,
    }),
    pgPolicy(`${name}_curate_delete`, { for: 'delete', to: appRw, using: curate }),
  ]
}
