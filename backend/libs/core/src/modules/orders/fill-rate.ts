import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The fill-rate source (coordination §3.9: "9 reporting → `modules/orders` `fillRateLines`"). Pieces
 * ordered against pieces actually picked, per variant, for the orders that reached PICKING or later
 * inside the window — reporting must never join `sales_order_lines` itself (coordination §4).
 *
 * One grouped query with a bounded window and a bounded page (docs/20 rule 3); the window filter is on
 * `created_at` as an instant, not a casted date, so `sales_orders_state_idx` still serves it.
 *
 * A plain exported function, so the worker's rollup sweep uses it without Nest DI (coordination §3.9
 * worker rule); `OrdersService.fillRateLines` delegates here.
 */

/** The order states that mean "the godown had a go at this" — anything earlier was never picked. */
const PICKED_STATES = [
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
] as const

export interface FillRateFilter {
  /** IST business dates, inclusive. */
  from: string
  to: string
  /** The godown the order was to be fulfilled from (`sales_orders.fulfil_from_location_id`). */
  locationId?: string | undefined
  salespersonId?: string | undefined
  limit?: number | undefined
}

export interface FillRateLineRow {
  variantId: string
  orderedPcs: number
  pickedPcs: number
  /** Orders that carried this variant in the window — the denominator nobody has to recount. */
  orderCount: number
}

/** IST midnight of a business date as an instant, `plusDays` later. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

export async function fillRateLines(tx: Db, filter: FillRateFilter): Promise<FillRateLineRow[]> {
  const { tenantId } = currentTenant()
  const limit = Math.min(filter.limit ?? 500, 2_000)
  const result = await tx.execute(sql`
    select l.variant_id,
           coalesce(sum(l.qty_pcs), 0)::bigint        as ordered_pcs,
           coalesce(sum(l.picked_qty_pcs), 0)::bigint as picked_pcs,
           count(distinct l.order_id)::int            as order_count
      from sales_order_lines l
      join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
     where l.tenant_id = ${tenantId}
       and o.state in ${sql.raw(`('${PICKED_STATES.join("','")}')`)}
       and o.created_at >= ${istInstant(filter.from)}
       and o.created_at < ${istInstant(filter.to, 1)}
       and (${filter.locationId ?? null}::text is null or o.fulfil_from_location_id = ${filter.locationId ?? null})
       and (${filter.salespersonId ?? null}::text is null or o.salesperson_id = ${filter.salespersonId ?? null})
     group by l.variant_id
     order by (coalesce(sum(l.qty_pcs), 0) - coalesce(sum(l.picked_qty_pcs), 0)) desc, l.variant_id asc
     limit ${limit}`)
  return result.rows.map((row: Record<string, unknown>) => ({
    variantId: String(row.variant_id),
    orderedPcs: Number(row.ordered_pcs ?? 0),
    pickedPcs: Number(row.picked_pcs ?? 0),
    orderCount: Number(row.order_count ?? 0),
  }))
}

/**
 * The same numbers, one row per IST business date rather than per variant — what the rollup writes into
 * `daily_tenant_stats.ordered_pcs` / `picked_pcs` so the fill-rate TREND is a read of the rollup and
 * never of this join (docs/20 rule 9).
 */
export async function fillRateByDay(
  tx: Db,
  filter: Pick<FillRateFilter, 'from' | 'to'>,
): Promise<{ day: string; orderedPcs: number; pickedPcs: number }[]> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select (o.created_at at time zone 'Asia/Kolkata')::date::text as day,
           coalesce(sum(l.qty_pcs), 0)::bigint        as ordered_pcs,
           coalesce(sum(l.picked_qty_pcs), 0)::bigint as picked_pcs
      from sales_order_lines l
      join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
     where l.tenant_id = ${tenantId}
       and o.state in ${sql.raw(`('${PICKED_STATES.join("','")}')`)}
       and o.created_at >= ${istInstant(filter.from)}
       and o.created_at < ${istInstant(filter.to, 1)}
     group by 1
     order by 1`)
  return result.rows.map((row: Record<string, unknown>) => ({
    day: String(row.day),
    orderedPcs: Number(row.ordered_pcs ?? 0),
    pickedPcs: Number(row.picked_pcs ?? 0),
  }))
}
