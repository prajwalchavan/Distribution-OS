import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * What one staff member SOLD in a window (coordination §3.9: "10 incentives → `modules/orders`
 * `salesAggregate(tx, {userId, brandId?, metric, from, to})` as a plain exported function, not a
 * method — the incentives worker sweep imports it and cannot resolve Nest DI").
 *
 * Incentives must never join `sales_order_lines` itself (coordination §4): the order book is orders'
 * table, and the definition of "what counts" — which states, which attribution, which window — lives
 * here, once, next to the aggregate it describes.
 *
 * WHAT COUNTS (docs/plans/incentives.md §4.2, coordination §7 q6 — the founder's assumption is
 * BOOKED, not billed and not collected):
 *
 *  - STATE: every order past `confirmed`, i.e. `confirmed / picking / packed / dispatched /
 *    delivered / partially_delivered / closed`. A `draft` is a device's scratchpad, a `submitted`
 *    order may still be rejected at approval, and a `cancelled` one never happened. A return that
 *    arrives later does NOT claw the achievement back — flagged in the brief §8.1 as the thing to
 *    revisit now that billing and delivery have shipped.
 *  - ATTRIBUTION: `salesperson_id = userId`, the rep the order is credited to — OR, when the order
 *    names no rep at all, `created_by = userId`. The second half is what makes a DELIVERY member's
 *    van sale count: `OrdersService.create` sets `salesperson_id` only for a salesperson-role actor
 *    (`orders.internals.ts` `createDraft`), so a crew member's van sale carries a null rep and its
 *    creator is the crew member. It is strictly narrower than `coalesce(salesperson_id, created_by)`
 *    would be for an order that DOES name a rep: a desk-keyed order stays the rep's, never the
 *    manager's. Brief §8.2 assumed the delivery slice would set `salesperson_id` and it does not;
 *    this is that gap closed from the reading side, without rewriting orders anyone already booked.
 *  - WINDOW: the BOOKING instant — `confirmed_at`, falling back to `created_at` for the (impossible
 *    today) booked order that carries none — inside `[from 00:00 IST, to+1 00:00 IST)`. An order is
 *    booked when it is confirmed, so that is the date it belongs to: a draft keyed on the 31st and
 *    confirmed on the 1st is next month's work, and an order confirmed on the 31st counts this
 *    month however long it sat as a draft. `created_at` would date an order by when a device first
 *    scratched it down, which is neither what the rep is measured on nor what the demo data carries.
 *    Instant comparisons, never a `::date` cast, so `sales_orders_salesperson_idx`'s equality prefix
 *    still narrows the scan.
 *  - BRAND: when `brandId` is given, only lines whose variant's product carries that brand. A line
 *    of another brand contributes nothing — not to value, not to pieces, not to the line count — and
 *    an order with no line of the brand is not one of its `outlets`.
 *
 * ONE QUERY, EVERY DIMENSION. The caller passes the `metric` it cares about (the coordination
 * signature) but gets all four back plus `pieces`, because incentives fills
 * `achievements.achieved_pieces` on EVERY target whatever its metric (brief §4.1: a progress caption
 * reads "3,120 of 5,000 pcs" even on a value target) and a second round trip for the same window
 * would be pure waste.
 */

/** The states that mean the order is real work the rep did (see the header). */
const BOOKED_STATES = [
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
] as const

/** The dimensions a target may measure off the order book (`visits` and `collections` are elsewhere). */
export type SalesAggregateMetric = 'value' | 'pieces' | 'lines' | 'outlets'

export interface SalesAggregateFilter {
  /** The rep or crew member credited with the order (see ATTRIBUTION above). */
  userId: string
  /** Restrict to one brand's lines; tenant-wide when absent. */
  brandId?: string | null | undefined
  /**
   * Which dimension the caller is targeting. Every dimension comes back regardless — the field
   * documents the intent and keeps the signature coordination §3.9 published.
   */
  metric?: SalesAggregateMetric | undefined
  /** IST business dates, inclusive. */
  from: string
  to: string
}

export interface SalesAggregateRow {
  /** Σ `line_total_paise` — PAISE. */
  valuePaise: number
  /** Σ `qty_pcs` — pieces billed (free goods are their own column and are not sold value). */
  pieces: number
  /** `count(sales_order_lines)`. */
  lines: number
  /** `count(distinct sales_orders.retailer_id)` — distinct shops billed. */
  outlets: number
  /** Orders behind the numbers; not a target dimension, but it makes a debug log readable. */
  orders: number
}

/** IST midnight of a business date as an instant, `plusDays` later. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

/**
 * A plain exported function, so the incentives worker sweep uses it without Nest DI (coordination
 * §3.9 worker rule). Runs inside whatever transaction the caller opened: `withTenant` for a request,
 * `withTenant` under a system context for the sweep (the same shape reporting's rollup uses), so RLS
 * scopes it either way and `currentTenant()` is always populated.
 */
export async function salesAggregate(
  tx: Db,
  filter: SalesAggregateFilter,
): Promise<SalesAggregateRow> {
  const { tenantId } = currentTenant()
  const brandId = filter.brandId ?? null
  const result = await tx.execute(sql`
    select coalesce(sum(l.line_total_paise), 0)::bigint as value_paise,
           coalesce(sum(l.qty_pcs), 0)::bigint          as pieces,
           count(l.id)::int                             as lines,
           count(distinct o.retailer_id)::int           as outlets,
           count(distinct o.id)::int                    as orders
      from sales_order_lines l
      join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
      ${
        brandId
          ? sql`join product_variants v on v.id = l.variant_id
      join products p on p.id = v.product_id and p.brand_id = ${brandId}`
          : sql``
      }
     where l.tenant_id = ${tenantId}
       and o.state in ${sql.raw(`('${BOOKED_STATES.join("','")}')`)}
       and (o.salesperson_id = ${filter.userId}
            or (o.salesperson_id is null and o.created_by = ${filter.userId}))
       and coalesce(o.confirmed_at, o.created_at) >= ${istInstant(filter.from)}
       and coalesce(o.confirmed_at, o.created_at) < ${istInstant(filter.to, 1)}`)
  const row: Record<string, unknown> = result.rows[0] ?? {}
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  return {
    valuePaise: n(row.value_paise),
    pieces: n(row.pieces),
    lines: n(row.lines),
    outlets: n(row.outlets),
    orders: n(row.orders),
  }
}
