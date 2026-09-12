import {
  check,
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
import { BACK_OFFICE_ROLES, paise, pieces, STAFF_ROLES, tenantRolePolicy, tz } from './columns.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { retailers } from './retailers.js'
import { users } from './tenancy.js'

/**
 * Pre-aggregated rows so phones and the owner dashboard never scan ledgers (docs/20 rule 9). Rebuilt by
 * the worker's rollup (`reporting.rollup.tenant`, every 15 minutes; `retailer_behaviour` nightly) by
 * upsert — `INSERT … ON CONFLICT DO UPDATE` keyed by the primary key — so a retry never doubles a number
 * (docs/plans/reporting.md §4 rule 4). Day columns are IST business dates (`businessDate()`).
 *
 * The owner's graphs (docs/22 §8, 2026-09-04; docs/23 §1.2) read these six tables and nothing else: a
 * week or a month is a grouped read of the day rows (≤ 92 day rows in, ≤ 24 points out), never a live
 * scan of invoices or receipts. Who may read which:
 *   daily_tenant_stats, daily_retailer_stats, retailer_behaviour   STAFF_ROLES — the shop is a customer of
 *                                                                  the distributorship, not a member of it,
 *                                                                  and never sees the tenant's day or another
 *                                                                  shop's habits (docs/plans/reporting.md §3.1)
 *   daily_rep_stats                                                back office, or the rep's own rows
 *   daily_owner_stats, owner_summary                               BACK_OFFICE_ROLES — they carry purchase cost
 *                                                                  and margin (docs/22 §9 never-list 1)
 */

/**
 * One mix entry per key of a day — a brand id, a `products.category`, a beat id: the money invoiced under
 * that key and how many invoices carried it. Summed across days at read time for "this month by brand",
 * "sales by beat", the brand-mix stack (docs/23 §1.2). Money in integer paise.
 */
export interface DailyMixEntry {
  invoicedPaise: number
  invoiceCount: number
}
export type DailyMix = Record<string, DailyMixEntry>

/**
 * Money collected on the day per `receipt_mode` (`cash`, `upi`, `bank_transfer`, `cheque`, …), in paise:
 * the payment-mode stack at month grain (docs/23 §1.2) without the 31-day cap of the live collections
 * register.
 */
export type DailyPaymentModeMix = Record<string, number>

/**
 * The keys `reporting.dashboard.owner` reads from `owner_summary.detail`, money in integer paise: cash
 * still on a van and the tenant's open dues per ageing bucket. Two writers fill it, the worker's rollup
 * (`refreshOwnerSummary`) and the demo seed (`seedReportingClose`), and one reader turns it into the
 * `<AgeingBuckets>` tile; all three are typed against this, so a near miss (DOS-001: the seed wrote
 * `ageingB90Plus` and the owner's Today showed 90+ as 0.00) is a compile error. A type alias rather
 * than an interface, so it stays assignable to `Record<string, unknown>`, the contract's `detail`.
 */
export type OwnerSummaryDetail = {
  cashInTransitPaise?: number
  ageingB0_7?: number
  ageingB8_15?: number
  ageingB16_30?: number
  ageingB31_60?: number
  ageingB61_90?: number
  ageingB90plus?: number
}

/**
 * The distributorship's day: sales, collections, dues, fulfilment and the last mile, one row per IST
 * business date. Everything a staff role may see (no cost, no margin). Beside the counters, three jsonb
 * mixes keyed by brand / category / beat and one by payment mode, so the owner's group-by charts are a
 * read of ≤ 92 rows.
 *   fill rate      = picked_pcs / ordered_pcs      (0/0 → 1: nothing ordered is not a fulfilment failure)
 *   on-time rate   = on_time_stops / (delivered_stops + partial_stops)
 *   POD coverage   = pod_stops / (delivered_stops + partial_stops)
 */
export const dailyTenantStats = pgTable(
  'daily_tenant_stats',
  {
    tenantId: tenantRef(),
    day: date('day', { mode: 'string' }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    invoicedPaise: paise('invoiced_paise').notNull().default(0),
    collectedPaise: paise('collected_paise').notNull().default(0),
    /** Open dues at the end of the day; `overdue_paise` is the part past its due date. */
    outstandingPaise: paise('outstanding_paise').notNull().default(0),
    overduePaise: paise('overdue_paise').notNull().default(0),
    deliveredStops: integer('delivered_stops').notNull().default(0),
    partialStops: integer('partial_stops').notNull().default(0),
    failedStops: integer('failed_stops').notNull().default(0),
    /** Delivered or partial stops that arrived inside the ETA grace, and that carry ≥ 1 proof of delivery. */
    onTimeStops: integer('on_time_stops').notNull().default(0),
    podStops: integer('pod_stops').notNull().default(0),
    /** Pieces ordered on orders that reached picking, and pieces actually picked against them. */
    orderedPcs: pieces('ordered_pcs').notNull().default(0),
    pickedPcs: pieces('picked_pcs').notNull().default(0),
    activeRetailers: integer('active_retailers').notNull().default(0),
    /** Margin is owner/manager-only, so it lives in a separate row (daily_owner_stats / owner_summary), not here. */
    byBrand: jsonb('by_brand').$type<DailyMix>(),
    byCategory: jsonb('by_category').$type<DailyMix>(),
    /** Keyed by beat id, from the order's retailer beat at rollup time (docs/23 §1.2 "beat grouping"). */
    byBeat: jsonb('by_beat').$type<DailyMix>(),
    byPaymentMode: jsonb('by_payment_mode').$type<DailyPaymentModeMix>(),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.day] }),
    check(
      'daily_tenant_stats_counts_nonnegative',
      sql`orders_count >= 0 AND delivered_stops >= 0 AND partial_stops >= 0 AND failed_stops >= 0 AND on_time_stops >= 0 AND pod_stops >= 0 AND ordered_pcs >= 0 AND picked_pcs >= 0 AND active_retailers >= 0`,
    ),
    // The tenant's whole day is staff reading; a shopkeeper token never reads the distributor's revenue.
    tenantRolePolicy('daily_tenant_stats_staff', STAFF_ROLES),
  ],
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
    /** "Every rep on day X" (repProductivity per beat, the back office's cross-rep reads): the PK leads with user_id. */
    index('daily_rep_stats_day_idx').on(t.tenantId, t.day),
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

/**
 * One shop's day: orders placed, money invoiced and collected. Rows exist only for days the shop had
 * activity (sparse: the volume follows orders, not shops × days), so a shop's 12-week sparkline is a
 * primary-key range read and "top shops this month" is one index scan on `(tenant_id, day)` grouped by
 * shop (docs/23 §1.2 "Retailer row sparkline", "top shops"). Staff only, like `retailer_behaviour`.
 */
export const dailyRetailerStats = pgTable(
  'daily_retailer_stats',
  {
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    day: date('day', { mode: 'string' }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    invoicedPaise: paise('invoiced_paise').notNull().default(0),
    collectedPaise: paise('collected_paise').notNull().default(0),
    linesSold: integer('lines_sold').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.retailerId, t.day] }),
    index('daily_retailer_stats_day_idx').on(t.tenantId, t.day),
    check('daily_retailer_stats_counts_nonnegative', sql`orders_count >= 0 AND lines_sold >= 0`),
    tenantRolePolicy('daily_retailer_stats_staff', STAFF_ROLES),
  ],
).enableRLS()

/**
 * Per-brand cost and margin of a day: `{ [brandId]: { cogsPaise, grossMarginPaise } }`, paise. Sums
 * across days into "margin by brand this month" (docs/23 §1.2).
 */
export interface DailyMarginEntry {
  cogsPaise: number
  grossMarginPaise: number
}
export type DailyMarginMix = Record<string, DailyMarginEntry>

/**
 * The cost-bearing half of the day, kept apart from `daily_tenant_stats` because that table is readable
 * by every staff role and this one never may be (docs/22 §9 never-list 1): cost of goods sold, gross
 * margin, stock at cost, scheme spend by who funds it. Serves the owner's margin trend, "stock value and
 * turns" (turns = Σ cogs over the window / average stock_value over it) and the scheme-spend split at
 * month grain — none of which the 92-day live registers can draw over a year.
 *   gross_margin_paise = net_sales_paise − cogs_paise, always (a CHECK, so the two never drift apart)
 *   net_sales_paise    = taxable value invoiced on the day, ex-GST, credit notes as negatives
 */
export const dailyOwnerStats = pgTable(
  'daily_owner_stats',
  {
    tenantId: tenantRef(),
    day: date('day', { mode: 'string' }).notNull(),
    netSalesPaise: paise('net_sales_paise').notNull().default(0),
    cogsPaise: paise('cogs_paise').notNull().default(0),
    grossMarginPaise: paise('gross_margin_paise').notNull().default(0),
    /** Closing stock at cost (landed cost else purchase rate) at the end of the day, and the part expiring inside the near-expiry window. */
    stockValuePaise: paise('stock_value_paise').notNull().default(0),
    nearExpiryValuePaise: paise('near_expiry_value_paise').notNull().default(0),
    /** Scheme redemptions on the day's invoices, split by funding source — never collapsed (docs/plans/reporting.md §4 rule 8). */
    schemeSpendCompanyPaise: paise('scheme_spend_company_paise').notNull().default(0),
    schemeSpendDistributorPaise: paise('scheme_spend_distributor_paise').notNull().default(0),
    byBrand: jsonb('by_brand').$type<DailyMarginMix>(),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.day] }),
    check(
      'daily_owner_stats_margin_identity',
      sql`gross_margin_paise = net_sales_paise - cogs_paise`,
    ),
    check(
      'daily_owner_stats_values_nonnegative',
      sql`stock_value_paise >= 0 AND near_expiry_value_paise >= 0 AND scheme_spend_company_paise >= 0 AND scheme_spend_distributor_paise >= 0`,
    ),
    tenantRolePolicy('daily_owner_stats_back_office', BACK_OFFICE_ROLES),
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
    // Every other shop's basket, lapsed-risk score and payment habit: staff reading, never the shop's.
    tenantRolePolicy('retailer_behaviour_staff', STAFF_ROLES),
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
    detail: jsonb('detail').$type<OwnerSummaryDetail>(),
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
