import { sql } from 'drizzle-orm'
import {
  dailyOwnerStats,
  dailyTenantStats,
  ownerSummary,
  withSystem,
  withTenant,
  type DailyMarginMix,
  type DailyMix,
  type DailyPaymentModeMix,
  type Db,
  type TenantContext,
} from '@dos/db'
import { businessDate } from '@dos/domain'
import { tenantStorage } from '../../platform/index.js'
import { addDays } from './reporting.internals.js'

/**
 * THE ROLLUP (docs/plans/reporting.md §7). Everything the six apps read from this module is a row one
 * of these functions wrote: a phone or a dashboard never scans a ledger (docs/20 rule 9).
 *
 * FOUR PROPERTIES THIS FILE EXISTS TO KEEP:
 *  1. IDEMPOTENT BY UPSERT, not by an idempotency key. Every write is `INSERT … ON CONFLICT (pk) DO
 *     UPDATE`, so a crash, a retry, a redeploy mid-run or two overlapping runs reproduce the same
 *     numbers and never double one (docs/plans/reporting.md §4 rule 4). `idempotent()` guards ONLINE
 *     mutations against a client replay; a background recompute has no client key to replay against.
 *  2. PER-TENANT FAIRNESS (docs/20 rule 5): the scheduler fans out ONE job per tenant; nothing here
 *     loops over tenants inside a single transaction, so one distributor's big order book cannot
 *     delay another's dashboard.
 *  3. READ-ONLY AGAINST EVERY SOURCE. This is the one place in reporting that reads another module's
 *     tables directly, and it is authorised by the brief (§7: "grouped queries over `sales_orders`,
 *     `invoices`, `receipts`, `trip_stops`"): a rollup cannot go through six Nest services in a worker
 *     that has no DI. It writes ONLY reporting's own six tables.
 *  4. A PAST DAY IS NEVER ZEROED. Dues are a stock, not a flow: for a day whose ageing snapshot is
 *     gone, the recompute keeps the value already stored rather than replacing a real number with 0.
 */

/** IST midnight of a business date as an instant, `plusDays` later. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

const systemCtx = (tenantId: string): TenantContext => ({
  tenantId,
  actorId: 'system',
  actorRole: 'system',
})

/** Every active distributor, for the scheduler's fan-out. Cross-tenant, so it runs as `app_worker`. */
export async function activeTenantIds(db: Db, limit = 5_000): Promise<string[]> {
  const rows = await withSystem(db, (tx) =>
    tx.execute(sql`select id from tenants where status = 'active' order by id limit ${limit}`),
  )
  return rows.rows.map((r: Record<string, unknown>) => String(r.id))
}

export interface RollupResult {
  tenantId: string
  day: string
  tenantRows: number
  repRows: number
  retailerRows: number
}

/**
 * ONE tenant, ONE business date: `daily_tenant_stats`, `daily_rep_stats`, `daily_retailer_stats`,
 * `daily_owner_stats` and the single `owner_summary` row. Runs as the SYSTEM role for that tenant, so
 * RLS still scopes every read and write to it (never `app_worker`'s BYPASSRLS across tenants).
 */
export async function rollupTenantDay(
  db: Db,
  tenantId: string,
  day: string = businessDate().date,
): Promise<RollupResult> {
  const ctx = systemCtx(tenantId)
  return tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const start = istInstant(day)
      const end = istInstant(day, 1)

      // --- the day's flows -----------------------------------------------------------------------
      const orders = await tx.execute(sql`
        select count(*)::int                       as orders_count,
               count(distinct retailer_id)::int    as active_retailers
          from sales_orders
         where tenant_id = ${tenantId}
           and state not in ('draft', 'cancelled')
           and created_at >= ${start} and created_at < ${end}`)
      const invoiced = await tx.execute(sql`
        select coalesce(sum(total_paise), 0)::bigint as invoiced_paise
          from invoices
         where tenant_id = ${tenantId}
           and invoice_date = ${day}
           and state not in ('draft', 'cancelled')`)
      const collected = await tx.execute(sql`
        select coalesce(sum(amount_paise), 0)::bigint as collected_paise,
               mode::text                             as mode
          from receipts
         where tenant_id = ${tenantId}
           and status in ('collected', 'deposited')
           and received_at >= ${start} and received_at < ${end}
         group by mode`)
      const byPaymentMode: DailyPaymentModeMix = {}
      let collectedPaise = 0
      for (const row of collected.rows) {
        const paise = n(row.collected_paise)
        byPaymentMode[String(row.mode)] = paise
        collectedPaise += paise
      }

      // --- the last mile -------------------------------------------------------------------------
      const stops = await tx.execute(sql`
        select count(*) filter (where s.state = 'delivered')::int as delivered_stops,
               count(*) filter (where s.state = 'partial')::int   as partial_stops,
               count(*) filter (where s.state = 'failed')::int    as failed_stops,
               count(*) filter (where s.completed_at is not null and s.eta_at is not null
                                  and s.completed_at <= s.eta_at)::int as on_time_stops,
               count(*) filter (where s.state in ('delivered', 'partial') and exists (
                 select 1 from deliveries d
                   join pod_evidence pe on pe.delivery_id = d.id and pe.tenant_id = d.tenant_id
                  where d.tenant_id = t.tenant_id and d.stop_id = s.id))::int as pod_stops
          from trips t
          join trip_stops s on s.trip_id = t.id and s.tenant_id = t.tenant_id
         where t.tenant_id = ${tenantId} and t.state <> 'cancelled' and t.trip_date = ${day}`)

      // --- fill rate -----------------------------------------------------------------------------
      const fill = await tx.execute(sql`
        select coalesce(sum(l.qty_pcs), 0)::bigint        as ordered_pcs,
               coalesce(sum(l.picked_qty_pcs), 0)::bigint as picked_pcs
          from sales_order_lines l
          join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
         where l.tenant_id = ${tenantId}
           and o.state in ('picking', 'packed', 'dispatched', 'delivered', 'partially_delivered', 'closed')
           and o.created_at >= ${start} and o.created_at < ${end}`)

      // --- the mixes -----------------------------------------------------------------------------
      const brandMix = await mix(
        tx,
        sql`
        select p.brand_id::text as key,
               coalesce(sum(l.line_total_paise), 0)::bigint as paise,
               count(distinct l.invoice_id)::int            as cnt
          from invoice_lines l
          join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
          join product_variants v on v.id = l.variant_id
          join products p on p.id = v.product_id
         where l.tenant_id = ${tenantId} and i.invoice_date = ${day}
           and i.state not in ('draft', 'cancelled') and p.brand_id is not null
         group by 1`,
      )
      const categoryMix = await mix(
        tx,
        sql`
        select coalesce(p.category, 'Uncategorised') as key,
               coalesce(sum(l.line_total_paise), 0)::bigint as paise,
               count(distinct l.invoice_id)::int            as cnt
          from invoice_lines l
          join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
          join product_variants v on v.id = l.variant_id
          join products p on p.id = v.product_id
         where l.tenant_id = ${tenantId} and i.invoice_date = ${day}
           and i.state not in ('draft', 'cancelled')
         group by 1`,
      )
      const beatMix = await mix(
        tx,
        sql`
        select r.beat_id::text as key,
               coalesce(sum(i.total_paise), 0)::bigint as paise,
               count(*)::int                           as cnt
          from invoices i
          join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
         where i.tenant_id = ${tenantId} and i.invoice_date = ${day}
           and i.state not in ('draft', 'cancelled') and r.beat_id is not null
         group by 1`,
      )

      // --- dues: today's from the live rollup, a past day's from its own snapshot, else keep -------
      const existing = await tx.execute(sql`
        select outstanding_paise, overdue_paise
          from daily_tenant_stats where tenant_id = ${tenantId} and day = ${day}`)
      const snapshot = await tx.execute(sql`
        select coalesce(sum(outstanding_paise), 0)::bigint as outstanding_paise,
               coalesce(sum(overdue_paise), 0)::bigint     as overdue_paise,
               count(*)::int                               as rows
          from ageing_snapshots where tenant_id = ${tenantId} and as_of = ${day}`)
      const live = await tx.execute(sql`
        select coalesce(sum(outstanding_paise), 0)::bigint as outstanding_paise,
               coalesce(sum(overdue_paise), 0)::bigint     as overdue_paise,
               coalesce(sum(bucket_0_7_paise), 0)::bigint     as b0_7,
               coalesce(sum(bucket_8_15_paise), 0)::bigint    as b8_15,
               coalesce(sum(bucket_16_30_paise), 0)::bigint   as b16_30,
               coalesce(sum(bucket_31_60_paise), 0)::bigint   as b31_60,
               coalesce(sum(bucket_61_90_paise), 0)::bigint   as b61_90,
               coalesce(sum(bucket_90_plus_paise), 0)::bigint as b90plus
          from retailer_outstanding_summary where tenant_id = ${tenantId}`)
      const snapRow = snapshot.rows[0]
      const liveRow = live.rows[0]
      const existingRow = existing.rows[0]
      const isToday = day === businessDate().date
      const dues =
        n(snapRow?.rows) > 0
          ? { outstanding: n(snapRow?.outstanding_paise), overdue: n(snapRow?.overdue_paise) }
          : isToday
            ? { outstanding: n(liveRow?.outstanding_paise), overdue: n(liveRow?.overdue_paise) }
            : {
                outstanding: n(existingRow?.outstanding_paise),
                overdue: n(existingRow?.overdue_paise),
              }

      const orderRow = orders.rows[0]
      const stopRow = stops.rows[0]
      const fillRow = fill.rows[0]
      await tx
        .insert(dailyTenantStats)
        .values({
          tenantId,
          day,
          ordersCount: n(orderRow?.orders_count),
          invoicedPaise: n(invoiced.rows[0]?.invoiced_paise),
          collectedPaise,
          outstandingPaise: dues.outstanding,
          overduePaise: dues.overdue,
          deliveredStops: n(stopRow?.delivered_stops),
          partialStops: n(stopRow?.partial_stops),
          failedStops: n(stopRow?.failed_stops),
          onTimeStops: n(stopRow?.on_time_stops),
          podStops: n(stopRow?.pod_stops),
          orderedPcs: n(fillRow?.ordered_pcs),
          pickedPcs: n(fillRow?.picked_pcs),
          activeRetailers: n(orderRow?.active_retailers),
          byBrand: brandMix,
          byCategory: categoryMix,
          byBeat: beatMix,
          byPaymentMode,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [dailyTenantStats.tenantId, dailyTenantStats.day],
          set: {
            ordersCount: sql`excluded.orders_count`,
            invoicedPaise: sql`excluded.invoiced_paise`,
            collectedPaise: sql`excluded.collected_paise`,
            outstandingPaise: sql`excluded.outstanding_paise`,
            overduePaise: sql`excluded.overdue_paise`,
            deliveredStops: sql`excluded.delivered_stops`,
            partialStops: sql`excluded.partial_stops`,
            failedStops: sql`excluded.failed_stops`,
            onTimeStops: sql`excluded.on_time_stops`,
            podStops: sql`excluded.pod_stops`,
            orderedPcs: sql`excluded.ordered_pcs`,
            pickedPcs: sql`excluded.picked_pcs`,
            activeRetailers: sql`excluded.active_retailers`,
            byBrand: sql`excluded.by_brand`,
            byCategory: sql`excluded.by_category`,
            byBeat: sql`excluded.by_beat`,
            byPaymentMode: sql`excluded.by_payment_mode`,
            computedAt: sql`excluded.computed_at`,
          },
        })

      const repRows = await rollupRepDay(tx, tenantId, day, start, end)
      const retailerRows = await rollupRetailerDay(tx, tenantId, day, start, end)
      await rollupOwnerDay(tx, tenantId, day)
      await refreshOwnerSummary(tx, tenantId, day, liveRow)
      return { tenantId, day, tenantRows: 1, repRows, retailerRows }
    }),
  )
}

/** One row per rep who did anything that day: visits, orders, and the money a delivery user took. */
async function rollupRepDay(
  tx: Db,
  tenantId: string,
  day: string,
  start: Date,
  end: Date,
): Promise<number> {
  const result = await tx.execute(sql`
    insert into daily_rep_stats
      (tenant_id, user_id, day, visits, productive_visits, orders_count, order_value_paise,
       lines_sold, collected_paise, computed_at)
    select ${tenantId}, u.user_id, ${day}::date,
           coalesce(v.visits, 0), coalesce(v.productive_visits, 0),
           coalesce(o.orders_count, 0), coalesce(o.order_value_paise, 0),
           coalesce(o.lines_sold, 0), coalesce(r.collected_paise, 0), now()
      from (
        select user_id from visits
         where tenant_id = ${tenantId} and started_at >= ${start} and started_at < ${end}
        union
        select salesperson_id as user_id from sales_orders
         where tenant_id = ${tenantId} and salesperson_id is not null
           and state not in ('draft', 'cancelled')
           and created_at >= ${start} and created_at < ${end}
        union
        select received_by as user_id from receipts
         where tenant_id = ${tenantId} and status in ('collected', 'deposited')
           and received_at >= ${start} and received_at < ${end}
      ) u
      left join (
        select user_id,
               count(*)::int                                          as visits,
               count(*) filter (where outcome = 'ordered')::int        as productive_visits
          from visits
         where tenant_id = ${tenantId} and started_at >= ${start} and started_at < ${end}
         group by user_id
      ) v on v.user_id = u.user_id
      left join (
        select o.salesperson_id as user_id,
               count(*)::int                                        as orders_count,
               coalesce(sum(o.total_paise), 0)::bigint               as order_value_paise,
               coalesce(sum(l.lines), 0)::int                        as lines_sold
          from sales_orders o
          left join lateral (
            select count(*)::int as lines from sales_order_lines sl
             where sl.tenant_id = o.tenant_id and sl.order_id = o.id
          ) l on true
         where o.tenant_id = ${tenantId} and o.salesperson_id is not null
           and o.state not in ('draft', 'cancelled')
           and o.created_at >= ${start} and o.created_at < ${end}
         group by o.salesperson_id
      ) o on o.user_id = u.user_id
      left join (
        select received_by as user_id, coalesce(sum(amount_paise), 0)::bigint as collected_paise
          from receipts
         where tenant_id = ${tenantId} and status in ('collected', 'deposited')
           and received_at >= ${start} and received_at < ${end}
         group by received_by
      ) r on r.user_id = u.user_id
     where u.user_id is not null
    on conflict (tenant_id, user_id, day) do update set
      visits = excluded.visits,
      productive_visits = excluded.productive_visits,
      orders_count = excluded.orders_count,
      order_value_paise = excluded.order_value_paise,
      lines_sold = excluded.lines_sold,
      collected_paise = excluded.collected_paise,
      computed_at = excluded.computed_at`)
  return result.rowCount ?? 0
}

/** One sparse row per shop that ordered, was billed or paid that day. */
async function rollupRetailerDay(
  tx: Db,
  tenantId: string,
  day: string,
  start: Date,
  end: Date,
): Promise<number> {
  const result = await tx.execute(sql`
    insert into daily_retailer_stats
      (tenant_id, retailer_id, day, orders_count, invoiced_paise, collected_paise, lines_sold, computed_at)
    select ${tenantId}, k.retailer_id, ${day}::date,
           coalesce(o.orders_count, 0), coalesce(i.invoiced_paise, 0),
           coalesce(r.collected_paise, 0), coalesce(o.lines_sold, 0), now()
      from (
        select retailer_id from sales_orders
         where tenant_id = ${tenantId} and state not in ('draft', 'cancelled')
           and created_at >= ${start} and created_at < ${end}
        union
        select retailer_id from invoices
         where tenant_id = ${tenantId} and invoice_date = ${day} and state not in ('draft', 'cancelled')
        union
        select retailer_id from receipts
         where tenant_id = ${tenantId} and status in ('collected', 'deposited')
           and received_at >= ${start} and received_at < ${end}
      ) k
      left join (
        select o.retailer_id,
               count(*)::int                           as orders_count,
               coalesce(sum(l.lines), 0)::int          as lines_sold
          from sales_orders o
          left join lateral (
            select count(*)::int as lines from sales_order_lines sl
             where sl.tenant_id = o.tenant_id and sl.order_id = o.id
          ) l on true
         where o.tenant_id = ${tenantId} and o.state not in ('draft', 'cancelled')
           and o.created_at >= ${start} and o.created_at < ${end}
         group by o.retailer_id
      ) o on o.retailer_id = k.retailer_id
      left join (
        select retailer_id, coalesce(sum(total_paise), 0)::bigint as invoiced_paise
          from invoices
         where tenant_id = ${tenantId} and invoice_date = ${day} and state not in ('draft', 'cancelled')
         group by retailer_id
      ) i on i.retailer_id = k.retailer_id
      left join (
        select retailer_id, coalesce(sum(amount_paise), 0)::bigint as collected_paise
          from receipts
         where tenant_id = ${tenantId} and status in ('collected', 'deposited')
           and received_at >= ${start} and received_at < ${end}
         group by retailer_id
      ) r on r.retailer_id = k.retailer_id
    on conflict (tenant_id, retailer_id, day) do update set
      orders_count = excluded.orders_count,
      invoiced_paise = excluded.invoiced_paise,
      collected_paise = excluded.collected_paise,
      lines_sold = excluded.lines_sold,
      computed_at = excluded.computed_at`)
  return result.rowCount ?? 0
}

/**
 * The cost-bearing half of the day (BACK_OFFICE at the database): net sales ex-GST, cost of goods sold
 * at landed cost (else purchase rate), the margin identity the CHECK enforces, closing stock at cost,
 * and scheme spend split by who funds it — never collapsed.
 */
async function rollupOwnerDay(tx: Db, tenantId: string, day: string): Promise<void> {
  const margin = await tx.execute(sql`
    with cost as (
      select distinct on (variant_id) variant_id,
             case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
        from tenant_product_costs
       where tenant_id = ${tenantId}
       order by variant_id, (lot_id is null) desc, effective_from desc
    )
    select coalesce(sum(l.taxable_paise), 0)::bigint                                    as net_sales,
           coalesce(sum((l.qty_pcs + l.free_qty_pcs) * coalesce(c.unit_cost, 0)), 0)::bigint as cogs
      from invoice_lines l
      join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
      left join cost c on c.variant_id = l.variant_id
     where l.tenant_id = ${tenantId} and i.invoice_date = ${day}
       and i.state not in ('draft', 'cancelled')`)
  const byBrandResult = await tx.execute(sql`
    with cost as (
      select distinct on (variant_id) variant_id,
             case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
        from tenant_product_costs
       where tenant_id = ${tenantId}
       order by variant_id, (lot_id is null) desc, effective_from desc
    )
    select p.brand_id::text as brand_id,
           coalesce(sum((l.qty_pcs + l.free_qty_pcs) * coalesce(c.unit_cost, 0)), 0)::bigint as cogs,
           coalesce(sum(l.taxable_paise), 0)::bigint as net_sales
      from invoice_lines l
      join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
      join product_variants v on v.id = l.variant_id
      join products p on p.id = v.product_id
      left join cost c on c.variant_id = l.variant_id
     where l.tenant_id = ${tenantId} and i.invoice_date = ${day}
       and i.state not in ('draft', 'cancelled') and p.brand_id is not null
     group by 1`)
  const stock = await tx.execute(sql`
    with cost as (
      select distinct on (variant_id) variant_id,
             case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
        from tenant_product_costs
       where tenant_id = ${tenantId}
       order by variant_id, (lot_id is null) desc, effective_from desc
    )
    select coalesce(sum(b.on_hand * coalesce(c.unit_cost, 0)), 0)::bigint as stock_value,
           coalesce(sum(case when lo.expiry_date is not null and lo.expiry_date <= (${day}::date + 90)
                             then b.on_hand * coalesce(c.unit_cost, 0) else 0 end), 0)::bigint as near_expiry_value
      from stock_balances b
      join stock_lots lo on lo.id = b.lot_id and lo.tenant_id = b.tenant_id
      left join cost c on c.variant_id = lo.variant_id
     where b.tenant_id = ${tenantId} and b.on_hand > 0`)
  const schemes = await tx.execute(sql`
    select coalesce(s.funding_source::text, 'company') as funding_source,
           coalesce(sum(coalesce((rule ->> 'amountPaise')::bigint, 0)), 0)::bigint as amount_paise
      from invoice_lines l
      join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
      cross join lateral jsonb_array_elements(l.applied_rules) as rule
      left join schemes s on s.id = rule ->> 'ruleId' and s.tenant_id = l.tenant_id
     where l.tenant_id = ${tenantId} and i.invoice_date = ${day}
       and i.state not in ('draft', 'cancelled')
       and rule ->> 'ruleId' is not null
     group by 1`)

  const marginRow = margin.rows[0]
  const stockRow = stock.rows[0]
  const netSales = n(marginRow?.net_sales)
  const cogs = n(marginRow?.cogs)
  const byBrand: DailyMarginMix = {}
  for (const row of byBrandResult.rows) {
    byBrand[String(row.brand_id)] = {
      cogsPaise: n(row.cogs),
      grossMarginPaise: n(row.net_sales) - n(row.cogs),
    }
  }
  let company = 0
  let distributor = 0
  for (const row of schemes.rows) {
    if (String(row.funding_source) === 'distributor') distributor += n(row.amount_paise)
    else company += n(row.amount_paise)
  }
  await tx
    .insert(dailyOwnerStats)
    .values({
      tenantId,
      day,
      netSalesPaise: netSales,
      cogsPaise: cogs,
      grossMarginPaise: netSales - cogs,
      stockValuePaise: n(stockRow?.stock_value),
      nearExpiryValuePaise: n(stockRow?.near_expiry_value),
      schemeSpendCompanyPaise: Math.max(0, company),
      schemeSpendDistributorPaise: Math.max(0, distributor),
      byBrand,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyOwnerStats.tenantId, dailyOwnerStats.day],
      set: {
        netSalesPaise: sql`excluded.net_sales_paise`,
        cogsPaise: sql`excluded.cogs_paise`,
        grossMarginPaise: sql`excluded.gross_margin_paise`,
        stockValuePaise: sql`excluded.stock_value_paise`,
        nearExpiryValuePaise: sql`excluded.near_expiry_value_paise`,
        schemeSpendCompanyPaise: sql`excluded.scheme_spend_company_paise`,
        schemeSpendDistributorPaise: sql`excluded.scheme_spend_distributor_paise`,
        byBrand: sql`excluded.by_brand`,
        computedAt: sql`excluded.computed_at`,
      },
    })
}

/**
 * The single `owner_summary` row: today's tiles, month to date, stock at cost, what is waiting for the
 * owner — plus the ageing buckets and the cash a crew is still carrying, in `detail` so a new tile
 * needs no migration (expand-only by construction).
 */
async function refreshOwnerSummary(
  tx: Db,
  tenantId: string,
  day: string,
  dues: Record<string, unknown> | undefined,
): Promise<void> {
  const monthStart = `${day.slice(0, 7)}-01`
  const mtd = await tx.execute(sql`
    select coalesce(sum(invoiced_paise), 0)::bigint as mtd_sales
      from daily_tenant_stats
     where tenant_id = ${tenantId} and day between ${monthStart} and ${day}`)
  const mtdMargin = await tx.execute(sql`
    select coalesce(sum(gross_margin_paise), 0)::bigint as mtd_margin,
           coalesce(max(stock_value_paise) filter (where day = ${day}), 0)::bigint as stock_value,
           coalesce(max(near_expiry_value_paise) filter (where day = ${day}), 0)::bigint as near_expiry_value
      from daily_owner_stats
     where tenant_id = ${tenantId} and day between ${monthStart} and ${day}`)
  const todayRow = await tx.execute(sql`
    select invoiced_paise, collected_paise
      from daily_tenant_stats where tenant_id = ${tenantId} and day = ${day}`)
  const pending = await tx.execute(sql`
    select count(*)::int as pending from approvals where tenant_id = ${tenantId} and status = 'pending'`)
  const active = await tx.execute(sql`
    select count(*)::int as active from trips
     where tenant_id = ${tenantId} and state in ('planned', 'loading', 'active', 'closing')`)
  const inTransit = await tx.execute(sql`
    select coalesce(sum(r.amount_paise), 0)::bigint as paise
      from receipts r
      join trips t on t.id = r.trip_id and t.tenant_id = r.tenant_id
     where r.tenant_id = ${tenantId} and r.mode = 'cash' and r.status in ('collected', 'deposited')
       and t.state not in ('settled', 'settled_with_variance', 'cancelled')`)

  const today = todayRow.rows[0]
  const marginRow = mtdMargin.rows[0]
  await tx
    .insert(ownerSummary)
    .values({
      tenantId,
      asOf: new Date(),
      todayInvoicedPaise: n(today?.invoiced_paise),
      todayCollectedPaise: n(today?.collected_paise),
      totalOutstandingPaise: n(dues?.outstanding_paise),
      overduePaise: n(dues?.overdue_paise),
      mtdSalesPaise: n(mtd.rows[0]?.mtd_sales),
      mtdGrossMarginPaise: n(marginRow?.mtd_margin),
      stockValuePaise: n(marginRow?.stock_value),
      nearExpiryValuePaise: n(marginRow?.near_expiry_value),
      pendingApprovals: n(pending.rows[0]?.pending),
      activeTrips: n(active.rows[0]?.active),
      detail: {
        cashInTransitPaise: n(inTransit.rows[0]?.paise),
        ageingB0_7: n(dues?.b0_7),
        ageingB8_15: n(dues?.b8_15),
        ageingB16_30: n(dues?.b16_30),
        ageingB31_60: n(dues?.b31_60),
        ageingB61_90: n(dues?.b61_90),
        ageingB90plus: n(dues?.b90plus),
      },
    })
    .onConflictDoUpdate({
      target: [ownerSummary.tenantId],
      set: {
        asOf: sql`excluded.as_of`,
        todayInvoicedPaise: sql`excluded.today_invoiced_paise`,
        todayCollectedPaise: sql`excluded.today_collected_paise`,
        totalOutstandingPaise: sql`excluded.total_outstanding_paise`,
        overduePaise: sql`excluded.overdue_paise`,
        mtdSalesPaise: sql`excluded.mtd_sales_paise`,
        mtdGrossMarginPaise: sql`excluded.mtd_gross_margin_paise`,
        stockValuePaise: sql`excluded.stock_value_paise`,
        nearExpiryValuePaise: sql`excluded.near_expiry_value_paise`,
        pendingApprovals: sql`excluded.pending_approvals`,
        activeTrips: sql`excluded.active_trips`,
        detail: sql`excluded.detail`,
      },
    })
}

/**
 * The nightly, heavier pass (00:20 IST): every shop's habits over a rolling 30 days — last order, last
 * visit, last payment, the usual basket that powers "repeat last order", and a 0–100 lapsed-risk score.
 * Deliberately not run every 15 minutes: it touches every retailer of the tenant.
 */
export async function rollupBehaviour(
  db: Db,
  tenantId: string,
  asOf: string = businessDate().date,
): Promise<number> {
  const ctx = systemCtx(tenantId)
  const since = addDays(asOf, -30)
  return tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const result = await tx.execute(sql`
        insert into retailer_behaviour
          (tenant_id, retailer_id, last_order_at, last_visit_at, last_payment_at, orders_last_30,
           value_last_30_paise, avg_days_to_pay, usual_basket, lapsed_risk, units_last_30, computed_at)
        select r.id, x.last_order_at, x.last_visit_at, x.last_payment_at,
               coalesce(x.orders_last_30, 0), coalesce(x.value_last_30, 0), x.avg_days_to_pay,
               coalesce(x.usual_basket, '[]'::jsonb),
               -- 0 (ordered this week) … 100 (never ordered and never visited)
               case
                 when x.last_order_at is null and x.last_visit_at is null then 100
                 when x.last_order_at is null then 80
                 else least(100, greatest(0,
                   (extract(day from (${asOf}::date - x.last_order_at::date)) * 100 / 60)::int))
               end,
               coalesce(x.units_last_30, 0), now()
          from retailers r
          left join lateral (
            select
              (select max(o.created_at) from sales_orders o
                where o.tenant_id = r.tenant_id and o.retailer_id = r.id
                  and o.state not in ('draft', 'cancelled'))                       as last_order_at,
              (select max(v.started_at) from visits v
                where v.tenant_id = r.tenant_id and v.retailer_id = r.id)          as last_visit_at,
              (select max(rc.received_at) from receipts rc
                where rc.tenant_id = r.tenant_id and rc.retailer_id = r.id
                  and rc.status in ('collected', 'deposited'))                     as last_payment_at,
              (select count(*)::int from sales_orders o
                where o.tenant_id = r.tenant_id and o.retailer_id = r.id
                  and o.state not in ('draft', 'cancelled')
                  and o.created_at >= ${istInstant(since)})                        as orders_last_30,
              (select coalesce(sum(o.total_paise), 0)::bigint from sales_orders o
                where o.tenant_id = r.tenant_id and o.retailer_id = r.id
                  and o.state not in ('draft', 'cancelled')
                  and o.created_at >= ${istInstant(since)})                        as value_last_30,
              (select coalesce(sum(l.qty_pcs), 0)::int
                 from sales_order_lines l join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
                where l.tenant_id = r.tenant_id and o.retailer_id = r.id
                  and o.state not in ('draft', 'cancelled')
                  and o.created_at >= ${istInstant(since)})                        as units_last_30,
              (select round(avg(extract(day from (a.allocated_at - i.invoice_date::timestamptz))))::int
                 from allocations a join invoices i on i.id = a.invoice_id and i.tenant_id = a.tenant_id
                where a.tenant_id = r.tenant_id and i.retailer_id = r.id
                  and a.receipt_id is not null)                                    as avg_days_to_pay,
              (select coalesce(jsonb_agg(jsonb_build_object('variantId', b.variant_id, 'avgPcs', b.avg_pcs)), '[]'::jsonb)
                 from (
                   select l.variant_id, round(avg(l.qty_pcs))::int as avg_pcs
                     from sales_order_lines l
                     join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
                    where l.tenant_id = r.tenant_id and o.retailer_id = r.id
                      and o.state not in ('draft', 'cancelled')
                      and o.created_at >= ${istInstant(addDays(asOf, -90))}
                    group by l.variant_id
                    order by count(*) desc, l.variant_id
                    limit 8
                 ) b)                                                              as usual_basket
          ) x on true
         where r.tenant_id = ${tenantId}
        on conflict (tenant_id, retailer_id) do update set
          last_order_at = excluded.last_order_at,
          last_visit_at = excluded.last_visit_at,
          last_payment_at = excluded.last_payment_at,
          orders_last_30 = excluded.orders_last_30,
          value_last_30_paise = excluded.value_last_30_paise,
          avg_days_to_pay = excluded.avg_days_to_pay,
          usual_basket = excluded.usual_basket,
          lapsed_risk = excluded.lapsed_risk,
          units_last_30 = excluded.units_last_30,
          computed_at = excluded.computed_at`)
      return result.rowCount ?? 0
    }),
  )
}

/** `{ key: { invoicedPaise, invoiceCount } }` from a `(key, paise, cnt)` query. */
async function mix(tx: Db, query: ReturnType<typeof sql>): Promise<DailyMix> {
  const result = await tx.execute(query)
  const out: DailyMix = {}
  for (const row of result.rows) {
    out[String(row.key)] = { invoicedPaise: n(row.paise), invoiceCount: n(row.cnt) }
  }
  return out
}

/** Re-run yesterday too: a device that synced after midnight still lands in the right day (§7). */
export async function rollupTenant(
  db: Db,
  tenantId: string,
  day: string = businessDate().date,
): Promise<RollupResult> {
  return rollupTenantDay(db, tenantId, day)
}
