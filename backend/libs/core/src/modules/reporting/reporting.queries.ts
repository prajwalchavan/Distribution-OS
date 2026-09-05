import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import {
  dailyOwnerStats,
  dailyRepStats,
  dailyRetailerStats,
  dailyTenantStats,
  ownerSummary,
  retailerBehaviour,
  type DailyMarginMix,
  type DailyMix,
  type DailyPaymentModeMix,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * Every read of reporting's OWN six rollup tables (`database/src/schema/reporting.ts`). Nothing else in
 * this module touches a table: every other number comes through the owning module's exported service
 * (coordination §4). One bounded, indexed range read each — a day series is ≤ 92 rows, a month series
 * is the same ≤ 92 rows grouped in memory, never a live scan of invoices or receipts (docs/20 rule 9).
 *
 * These take the transaction, so a handler composes several of them in one `withTenant` — and the
 * transaction it passes is the REPLICA's when one is configured (docs/20 rule 10).
 */

export interface TenantDayRow {
  day: string
  ordersCount: number
  invoicedPaise: number
  collectedPaise: number
  outstandingPaise: number
  overduePaise: number
  deliveredStops: number
  partialStops: number
  failedStops: number
  onTimeStops: number
  podStops: number
  orderedPcs: number
  pickedPcs: number
  activeRetailers: number
  byBrand: DailyMix
  byCategory: DailyMix
  byBeat: DailyMix
  byPaymentMode: DailyPaymentModeMix
  computedAt: Date
}

export interface RepDayRow {
  day: string
  userId: string
  visits: number
  productiveVisits: number
  ordersCount: number
  orderValuePaise: number
  linesSold: number
  collectedPaise: number
  computedAt: Date
}

export interface OwnerDayRow {
  day: string
  netSalesPaise: number
  cogsPaise: number
  grossMarginPaise: number
  stockValuePaise: number
  nearExpiryValuePaise: number
  schemeSpendCompanyPaise: number
  schemeSpendDistributorPaise: number
  byBrand: DailyMarginMix
  computedAt: Date
}

export interface RetailerDayRow {
  day: string
  retailerId: string
  ordersCount: number
  invoicedPaise: number
  collectedPaise: number
  linesSold: number
  computedAt: Date
}

export async function tenantDays(tx: Db, from: string, to: string): Promise<TenantDayRow[]> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select()
    .from(dailyTenantStats)
    .where(
      and(
        eq(dailyTenantStats.tenantId, tenantId),
        gte(dailyTenantStats.day, from),
        lte(dailyTenantStats.day, to),
      ),
    )
    .orderBy(asc(dailyTenantStats.day))
  return rows.map((r) => ({
    day: r.day,
    ordersCount: r.ordersCount,
    invoicedPaise: r.invoicedPaise,
    collectedPaise: r.collectedPaise,
    outstandingPaise: r.outstandingPaise,
    overduePaise: r.overduePaise,
    deliveredStops: r.deliveredStops,
    partialStops: r.partialStops,
    failedStops: r.failedStops,
    onTimeStops: r.onTimeStops,
    podStops: r.podStops,
    orderedPcs: r.orderedPcs,
    pickedPcs: r.pickedPcs,
    activeRetailers: r.activeRetailers,
    byBrand: r.byBrand ?? {},
    byCategory: r.byCategory ?? {},
    byBeat: r.byBeat ?? {},
    byPaymentMode: r.byPaymentMode ?? {},
    computedAt: r.computedAt,
  }))
}

export async function repDays(
  tx: Db,
  filter: { from: string; to: string; userIds?: readonly string[] | undefined },
): Promise<RepDayRow[]> {
  const { tenantId } = currentTenant()
  if (filter.userIds?.length === 0) return []
  const rows = await tx
    .select()
    .from(dailyRepStats)
    .where(
      and(
        eq(dailyRepStats.tenantId, tenantId),
        gte(dailyRepStats.day, filter.from),
        lte(dailyRepStats.day, filter.to),
        filter.userIds ? inArray(dailyRepStats.userId, [...filter.userIds]) : undefined,
      ),
    )
    .orderBy(asc(dailyRepStats.day), asc(dailyRepStats.userId))
  return rows.map((r) => ({
    day: r.day,
    userId: r.userId,
    visits: r.visits,
    productiveVisits: r.productiveVisits,
    ordersCount: r.ordersCount,
    orderValuePaise: r.orderValuePaise,
    linesSold: r.linesSold,
    collectedPaise: r.collectedPaise,
    computedAt: r.computedAt,
  }))
}

export async function ownerDays(tx: Db, from: string, to: string): Promise<OwnerDayRow[]> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select()
    .from(dailyOwnerStats)
    .where(
      and(
        eq(dailyOwnerStats.tenantId, tenantId),
        gte(dailyOwnerStats.day, from),
        lte(dailyOwnerStats.day, to),
      ),
    )
    .orderBy(asc(dailyOwnerStats.day))
  return rows.map((r) => ({
    day: r.day,
    netSalesPaise: r.netSalesPaise,
    cogsPaise: r.cogsPaise,
    grossMarginPaise: r.grossMarginPaise,
    stockValuePaise: r.stockValuePaise,
    nearExpiryValuePaise: r.nearExpiryValuePaise,
    schemeSpendCompanyPaise: r.schemeSpendCompanyPaise,
    schemeSpendDistributorPaise: r.schemeSpendDistributorPaise,
    byBrand: r.byBrand ?? {},
    computedAt: r.computedAt,
  }))
}

export async function retailerDays(
  tx: Db,
  filter: { from: string; to: string; retailerIds?: readonly string[] | undefined },
): Promise<RetailerDayRow[]> {
  const { tenantId } = currentTenant()
  if (filter.retailerIds?.length === 0) return []
  const rows = await tx
    .select()
    .from(dailyRetailerStats)
    .where(
      and(
        eq(dailyRetailerStats.tenantId, tenantId),
        gte(dailyRetailerStats.day, filter.from),
        lte(dailyRetailerStats.day, filter.to),
        filter.retailerIds
          ? inArray(dailyRetailerStats.retailerId, [...filter.retailerIds])
          : undefined,
      ),
    )
    .orderBy(asc(dailyRetailerStats.day), asc(dailyRetailerStats.retailerId))
    .limit(20_000)
  return rows.map((r) => ({
    day: r.day,
    retailerId: r.retailerId,
    ordersCount: r.ordersCount,
    invoicedPaise: r.invoicedPaise,
    collectedPaise: r.collectedPaise,
    linesSold: r.linesSold,
    computedAt: r.computedAt,
  }))
}

/**
 * "Top shops" without pulling a row per shop per day: one grouped read of `daily_retailer_stats` on
 * `(tenant_id, day)`, ordered by the metric, capped at the ranking's own size (docs/20 rule 3).
 */
export async function retailerTotals(
  tx: Db,
  filter: {
    from: string
    to: string
    retailerIds?: readonly string[] | undefined
    /** Which column decides the ranking; the other two ride along for the tooltip. */
    orderBy?: 'invoiced' | 'orders' | 'collected' | undefined
    limit?: number | undefined
  },
): Promise<{
  items: {
    retailerId: string
    invoicedPaise: number
    ordersCount: number
    collectedPaise: number
  }[]
  totals: { invoicedPaise: number; ordersCount: number; collectedPaise: number }
}> {
  const { tenantId } = currentTenant()
  if (filter.retailerIds?.length === 0)
    return { items: [], totals: { invoicedPaise: 0, ordersCount: 0, collectedPaise: 0 } }
  const scope: SQL[] = [
    sql`tenant_id = ${tenantId}`,
    sql`day between ${filter.from} and ${filter.to}`,
  ]
  if (filter.retailerIds)
    scope.push(
      sql`retailer_id in ${sql.raw(`('${filter.retailerIds.map((id) => id.replace(/'/g, "''")).join("','")}')`)}`,
    )
  const where = sql.join(scope, sql` and `)
  const orderColumn =
    filter.orderBy === 'orders'
      ? sql`coalesce(sum(orders_count), 0)`
      : filter.orderBy === 'collected'
        ? sql`coalesce(sum(collected_paise), 0)`
        : sql`coalesce(sum(invoiced_paise), 0)`
  const result = await tx.execute(sql`
    select retailer_id,
           coalesce(sum(invoiced_paise), 0)::bigint  as invoiced_paise,
           coalesce(sum(orders_count), 0)::int       as orders_count,
           coalesce(sum(collected_paise), 0)::bigint as collected_paise
      from daily_retailer_stats
     where ${where}
     group by retailer_id
     order by ${orderColumn} desc, retailer_id asc
     limit ${Math.min(filter.limit ?? 500, 2_000)}`)
  const totalsResult = await tx.execute(sql`
    select coalesce(sum(invoiced_paise), 0)::bigint  as invoiced_paise,
           coalesce(sum(orders_count), 0)::int       as orders_count,
           coalesce(sum(collected_paise), 0)::bigint as collected_paise
      from daily_retailer_stats
     where ${where}`)
  const t = totalsResult.rows[0]
  return {
    items: result.rows.map((row: Record<string, unknown>) => ({
      retailerId: String(row.retailer_id),
      invoicedPaise: Number(row.invoiced_paise ?? 0),
      ordersCount: Number(row.orders_count ?? 0),
      collectedPaise: Number(row.collected_paise ?? 0),
    })),
    totals: {
      invoicedPaise: Number(t?.invoiced_paise ?? 0),
      ordersCount: Number(t?.orders_count ?? 0),
      collectedPaise: Number(t?.collected_paise ?? 0),
    },
  }
}

export async function ownerSummaryRow(
  tx: Db,
): Promise<typeof ownerSummary.$inferSelect | undefined> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(ownerSummary)
    .where(eq(ownerSummary.tenantId, tenantId))
    .limit(1)
  return row
}

export async function behaviourRow(
  tx: Db,
  retailerId: string,
): Promise<typeof retailerBehaviour.$inferSelect | undefined> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(retailerBehaviour)
    .where(
      and(eq(retailerBehaviour.tenantId, tenantId), eq(retailerBehaviour.retailerId, retailerId)),
    )
    .limit(1)
  return row
}

/**
 * The reactivation list, ordered on `retailer_behaviour_lapsed_idx`. The cursor is the previous page's
 * `(lapsedRisk, retailerId)` so a page boundary never repeats or skips a shop.
 */
export async function lapsedRows(
  tx: Db,
  filter: {
    minRisk: number
    retailerIds?: readonly string[] | undefined
    cursor?: { risk: number; retailerId: string } | undefined
    limit: number
  },
): Promise<(typeof retailerBehaviour.$inferSelect)[]> {
  const { tenantId } = currentTenant()
  if (filter.retailerIds?.length === 0) return []
  return tx
    .select()
    .from(retailerBehaviour)
    .where(
      and(
        eq(retailerBehaviour.tenantId, tenantId),
        gte(retailerBehaviour.lapsedRisk, filter.minRisk),
        filter.retailerIds
          ? inArray(retailerBehaviour.retailerId, [...filter.retailerIds])
          : undefined,
        filter.cursor
          ? sql`(${retailerBehaviour.lapsedRisk}, ${retailerBehaviour.retailerId}) < (${filter.cursor.risk}, ${filter.cursor.retailerId})`
          : undefined,
      ),
    )
    .orderBy(desc(retailerBehaviour.lapsedRisk), desc(retailerBehaviour.retailerId))
    .limit(filter.limit)
}
