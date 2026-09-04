import {
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { paise, pieces, tenantPolicy, tz } from './columns.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { retailers } from './retailers.js'
import { users } from './tenancy.js'

/** Pre-aggregated rows so phones and the owner dashboard never scan ledgers. Rebuilt by the worker. */

export const dailyTenantStats = pgTable(
  'daily_tenant_stats',
  {
    tenantId: tenantRef(),
    day: date('day', { mode: 'string' }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    invoicedPaise: paise('invoiced_paise').notNull().default(0),
    collectedPaise: paise('collected_paise').notNull().default(0),
    outstandingPaise: paise('outstanding_paise').notNull().default(0),
    deliveredStops: integer('delivered_stops').notNull().default(0),
    failedStops: integer('failed_stops').notNull().default(0),
    activeRetailers: integer('active_retailers').notNull().default(0),
    /** Margin is owner/manager-only, so it lives in a separate row (owner_summary), not here. */
    byBrand: jsonb('by_brand'),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] }), tenantPolicy('daily_tenant_stats_tenant')],
).enableRLS()

export const dailyRepStats = pgTable(
  'daily_rep_stats',
  {
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    day: date('day', { mode: 'string' }).notNull(),
    visits: integer('visits').notNull().default(0),
    productiveVisits: integer('productive_visits').notNull().default(0),
    ordersCount: integer('orders_count').notNull().default(0),
    orderValuePaise: paise('order_value_paise').notNull().default(0),
    linesSold: integer('lines_sold').notNull().default(0),
    collectedPaise: paise('collected_paise').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.day] }),
    // a rep sees only their own rows; owner/manager see all
    pgPolicy('daily_rep_stats_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR user_id = (SELECT current_setting('app.actor_id', true)))`,
    }),
    pgPolicy('daily_rep_stats_write', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system'`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()

/** Per-retailer behaviour the rep app shows on the shop card: last order, usual basket, days since visit, payment habit. */
export const retailerBehaviour = pgTable(
  'retailer_behaviour',
  {
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    lastOrderAt: tz('last_order_at'),
    lastVisitAt: tz('last_visit_at'),
    lastPaymentAt: tz('last_payment_at'),
    ordersLast30: integer('orders_last_30').notNull().default(0),
    valueLast30Paise: paise('value_last_30_paise').notNull().default(0),
    avgDaysToPay: integer('avg_days_to_pay'),
    /** Top variants with usual pieces: [{variantId, avgPcs}] — powers "repeat last order". */
    usualBasket: jsonb('usual_basket')
      .$type<{ variantId: string; avgPcs: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lapsedRisk: integer('lapsed_risk').notNull().default(0),
    unitsLast30: pieces('units_last_30').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.retailerId] }),
    index('retailer_behaviour_lapsed_idx').on(t.tenantId, t.lapsedRisk),
    tenantPolicy('retailer_behaviour_tenant'),
  ],
).enableRLS()

/** One synced row per tenant for the owner's home screen; includes margin, so owner/manager/accountant only. */
export const ownerSummary = pgTable(
  'owner_summary',
  {
    tenantId: tenantRef(),
    asOf: tz('as_of').notNull().defaultNow(),
    todayInvoicedPaise: paise('today_invoiced_paise').notNull().default(0),
    todayCollectedPaise: paise('today_collected_paise').notNull().default(0),
    totalOutstandingPaise: paise('total_outstanding_paise').notNull().default(0),
    overduePaise: paise('overdue_paise').notNull().default(0),
    mtdSalesPaise: paise('mtd_sales_paise').notNull().default(0),
    mtdGrossMarginPaise: paise('mtd_gross_margin_paise').notNull().default(0),
    stockValuePaise: paise('stock_value_paise').notNull().default(0),
    nearExpiryValuePaise: paise('near_expiry_value_paise').notNull().default(0),
    pendingApprovals: integer('pending_approvals').notNull().default(0),
    activeTrips: integer('active_trips').notNull().default(0),
    detail: jsonb('detail'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId] }),
    pgPolicy('owner_summary_back_office', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')`,
    }),
  ],
).enableRLS()
