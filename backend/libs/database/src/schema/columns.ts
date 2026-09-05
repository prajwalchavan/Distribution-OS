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
  'warehouse',
  'system',
] as const
export const BACK_OFFICE_ROLES = ['owner', 'manager', 'accountant', 'system'] as const
export const OWNER_ROLES = ['owner', 'system'] as const
export const CURATOR_ROLES = ['curator', 'system'] as const
/**
 * Who may write the godown's own paperwork — the picklist, the pick line, the pack confirmation, the load
 * sheet and the delivery challan (coordination §3.9, §5.3). A salesperson, an accountant and a delivery
 * crew member READ these (`staffReadPolicy`) because they answer "where is my order"; only the floor and
 * the desk above it write them. `system` is the worker.
 */
export const STOCK_KEEPER_ROLES = ['owner', 'manager', 'warehouse', 'system'] as const
/**
 * The two people who RUN the distributorship, plus the worker. Founder decision 2026-09-05 (docs/22 §8):
 * the accountant is a money desk — office receipts, deposits, bounces, write-offs, reads and exports —
 * and has NO say over prices, schemes, credit limits, approvals or settings. So every table that holds
 * one of those is written by this set and read by the wider one; `BACK_OFFICE_ROLES` (which names the
 * accountant) stays for the money and the books. Three aliases, one list, so a policy reads as what it
 * guards: a price, a decision, a person joining the network.
 */
export const MANAGEMENT_ROLES = ['owner', 'manager', 'system'] as const
/** Who sets a price list, a scheme, a retailer override, a brand's cash-discount mode. */
export const PRICE_SETTER_ROLES = MANAGEMENT_ROLES
/** Who decides an approval or a bargain, and whose token is the manager's PIN at load-out. */
export const APPROVER_ROLES = MANAGEMENT_ROLES
/** Who brings people, beats and shops into the network (permissions.ts ONBOARDERS + the worker). */
export const ONBOARDER_ROLES = MANAGEMENT_ROLES
/**
 * Who handles goods coming IN: the desk that reviews a supplier bill and the floor that counts it.
 * permissions.ts calls the same population BACK_OFFICE_OR_WAREHOUSE. Purchase COST never lives on
 * these tables (`grn_lines` is pieces only); the priced supplier invoice stays `BACK_OFFICE_ROLES`.
 */
export const INBOUND_ROLES = ['owner', 'manager', 'accountant', 'warehouse', 'system'] as const

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

const tenantAndRoles = (roles: readonly string[]) =>
  sql.raw(
    `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN (${roles
      .map((r) => `'${r}'`)
      .join(', ')})`,
  )

/** Read-only access to a tenant table for a named set of roles (no write policy implied). */
export const roleReadPolicy = (name: string, roles: readonly string[]) =>
  pgPolicy(name, { for: 'select', to: appRw, using: tenantAndRoles(roles) })

/**
 * SELECT for ANY member of the tenant, the shopkeeper included, and nothing else: the read half of
 * what `tenantPolicy` grants. Pair it with `staffWritePolicy` or `roleWritePolicies` for the write
 * half. This is the shape for reference data a shop legitimately reads while ordering — the price
 * list, the schemes, the sellable stock, the feature flags — where the old FOR ALL policy let the same
 * shopkeeper token INSERT a price or a ledger row (never-list 9, docs/22 §9).
 */
export const tenantReadPolicy = (name: string) =>
  pgPolicy(name, { for: 'select', to: appRw, using: tenantMatches('tenant_id') })

/**
 * SELECT scoped to the actor's OWN rows for the field, tenant-wide for the desk: a rep reads its own
 * auto-approve bound and its own brand authorisations, the owner and manager read everyone's. The
 * `userColumn` is the column that names the row's person.
 */
export const backOfficeOrOwnRowPolicy = (name: string, userColumn: string) =>
  pgPolicy(name, {
    for: 'select',
    to: appRw,
    using: sql.raw(
      `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN (${BACK_OFFICE_ROLES.map((r) => `'${r}'`).join(', ')})
        OR ${userColumn} = (SELECT current_setting('app.actor_id', true))
      )`,
    ),
  })

/** INSERT-only access for a named set of roles: append to a table you are not allowed to read back. */
export const roleInsertPolicy = (name: string, roles: readonly string[]) =>
  pgPolicy(name, { for: 'insert', to: appRw, withCheck: tenantAndRoles(roles) })

/** UPDATE-only access for a named set of roles (no INSERT, no DELETE implied). */
export const roleUpdatePolicy = (name: string, roles: readonly string[]) =>
  pgPolicy(name, {
    for: 'update',
    to: appRw,
    using: tenantAndRoles(roles),
    withCheck: tenantAndRoles(roles),
  })

/**
 * INSERT/UPDATE/DELETE on a tenant table for a named set of roles, split per command so a table can pair a
 * narrow write set with a wider (or narrower) read set — `tenantRolePolicy` cannot, because FOR ALL applies
 * the same predicate to reads. Used by receivables for the ledger (post-only roles) and the chart of accounts.
 */
export const roleWritePolicies = (name: string, roles: readonly string[]) => [
  roleInsertPolicy(`${name}_insert`, roles),
  roleUpdatePolicy(`${name}_update`, roles),
  pgPolicy(`${name}_delete`, { for: 'delete', to: appRw, using: tenantAndRoles(roles) }),
]

/**
 * SELECT scoped through the owning invoice, the shape `invoice_lines_read` uses: staff see the whole tenant,
 * a retailer-role actor sees a row only when the invoice it hangs off is itself visible (invoices carries
 * `tenantOrOwnRetailerPolicy`). Never join `retailer_identities` here — Postgres reports 42P17 recursion.
 */
export const invoiceScopedReadPolicy = (name: string, invoiceColumn: string, table: string) =>
  pgPolicy(name, {
    for: 'select',
    to: appRw,
    using: sql.raw(
      `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = ${table}.${invoiceColumn})
      )`,
    ),
  })

/**
 * Internal paperwork every staff role may read and a shopkeeper may not see at all: the retailer is not
 * a member of the distributor's business, it is a customer of it. `tenantPolicy` (FOR ALL, any member of
 * the tenant) is too wide for a picklist or a load sheet — a retailer-role token would read the whole
 * godown's day, including which other shops are on the same van. Pair it with `roleWritePolicies` for
 * the narrower set that may actually write (coordination §5.3); permissive policies OR together, so the
 * read policy alone never grants a write.
 */
export const staffReadPolicy = (name: string) =>
  pgPolicy(name, {
    for: 'select',
    to: appRw,
    using: sql.raw(
      `tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'`,
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
