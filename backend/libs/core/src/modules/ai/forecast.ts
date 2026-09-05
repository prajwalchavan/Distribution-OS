import { sql } from 'drizzle-orm'
import { aiForecasts, type Db } from '@dos/db'
import { businessDate, uuidv7 } from '@dos/domain'
import { currentTenant } from '../../platform/index.js'
import { asSystem, clampBps } from './ai.internals.js'

/**
 * Demand forecasting for purchase planning (founder decision 2026-09-05, docs/22 §8). Plain
 * functions with no Nest DI, because the daily pass runs in the pg-boss worker (coordination §3.9 /
 * §13) and the request path only ever ENQUEUES one.
 *
 * WHAT IT IS. For each variant at each godown: how many pieces are expected to leave over the next
 * `horizonDays`, how many are on hand, how many days that lasts, and therefore how many to buy. It
 * is a SUGGESTION and the table says so — `ai_forecasts` is written by the `system` role alone, so
 * no request path can write one, and nothing anywhere turns one into a purchase order. A human reads
 * the list and raises the PO through `procurement.purchaseOrders.upsert`.
 *
 * NO MONEY, ANYWHERE. Not a purchase rate, not a stock value, not a margin. That is what lets the
 * warehouse role read the list at all (docs/22 §9 non-negotiable 1: purchase cost never reaches the
 * godown, the field or the shop), and it is why the demand source is the STOCK LEDGER's `sale` rows
 * rather than invoice lines: pieces that left a location, with no rupees attached.
 *
 * THE ESTIMATORS, chosen for FMCG distribution rather than for elegance:
 *
 *   `moving_average_28`  the default: mean daily pieces over the lookback, shaped by a DAY-OF-WEEK
 *                        factor, because a Kalyan beat is not flat across a week — the market day
 *                        and the Sunday matter, and a flat mean under-buys before one and over-buys
 *                        before the other.
 *   `croston`            for INTERMITTENT SKUs (a sale on fewer than a third of the days): the
 *                        classic Croston split of average demand SIZE by average INTERVAL, which is
 *                        the standard answer to "a moving average of mostly zeroes is meaningless".
 *   `new_sku`            too little history to estimate at all: expectation 0, confidence 0, and the
 *                        row still exists so the buyer sees the SKU and decides for themselves.
 *
 * Confidence is BASIS POINTS and honest: it falls with a short history and with a jumpy one, so a
 * SKU sold twice in ninety days can never present itself as a firm number.
 */

export interface ForecastPassOptions {
  /** IST business date the pass is for; history is read up to and including the day before. */
  asOfDate?: string
  /** One location, or every warehouse-kind location of the tenant. */
  locationId?: string | null
  /** Days of history to read. */
  lookbackDays?: number
  /** Days to forecast forward. */
  horizonDays?: number
  /** Variants per location considered in one pass — bounded work (docs/20 rule 1). */
  limit?: number
}

export interface ForecastRowValues {
  variantId: string
  locationId: string
  horizonDays: number
  expectedQtyPcs: number
  reorderQtyPcs: number
  onHandPcs: number
  daysCover: number | null
  method: ForecastMethod
  confidenceBps: number
}

export type ForecastMethod = 'moving_average_28' | 'croston' | 'new_sku'

export const DEFAULT_LOOKBACK_DAYS = 90
export const DEFAULT_HORIZON_DAYS = 14
/** Variant × location rows one pass may write. A tenant with more SKUs gets more passes, not a slower one. */
export const FORECAST_PASS_LIMIT = 5_000

interface DemandRow {
  variantId: string
  locationId: string
  /** One entry per day that had a sale: the IST date and the pieces that left. */
  days: { day: string; pcs: number }[]
}

/**
 * Run a pass and write the rows. Returns how many it wrote. Idempotent by construction: the unique
 * key `(tenant, variant, location, horizon)` makes every write an upsert, so a retried job rewrites
 * the same rows rather than doubling anything.
 */
export async function runForecastPass(
  tx: Db,
  options: ForecastPassOptions = {},
): Promise<{ written: number; asOfDate: string; horizonDays: number }> {
  const asOfDate = options.asOfDate ?? businessDate().date
  const horizonDays = clampInt(options.horizonDays, 1, 90, DEFAULT_HORIZON_DAYS)
  const lookbackDays = clampInt(options.lookbackDays, 7, 365, DEFAULT_LOOKBACK_DAYS)
  const limit = Math.min(options.limit ?? FORECAST_PASS_LIMIT, FORECAST_PASS_LIMIT)

  const demand = await readDemand(tx, {
    asOfDate,
    lookbackDays,
    locationId: options.locationId ?? null,
    limit,
  })
  const onHand = await readOnHand(tx, options.locationId ?? null)
  const openPo = await readOpenPurchaseOrders(tx)
  const primaryGodown = await primaryWarehouseId(tx)

  // Every variant × location we have EITHER history or stock for: a SKU that stopped selling still
  // needs a row (its cover is enormous, which is exactly what a buyer wants to see), and one that
  // sells with nothing on the rack needs one most of all.
  const keys = new Map<string, { variantId: string; locationId: string }>()
  for (const row of demand) keys.set(`${row.variantId}|${row.locationId}`, row)
  for (const [key, value] of onHand) if (!keys.has(key)) keys.set(key, value)

  const values: ForecastRowValues[] = []
  const demandByKey = new Map(demand.map((row) => [`${row.variantId}|${row.locationId}`, row]))
  for (const [key, { variantId, locationId }] of keys) {
    const history = demandByKey.get(key)?.days ?? []
    const estimate = estimateDemand(history, { asOfDate, lookbackDays, horizonDays })
    const stock = onHand.get(key)?.onHandPcs ?? 0
    // Open purchase orders have no location of their own, so they count against the primary godown
    // only — counting them at every location would make a second warehouse look stocked twice.
    const incoming = locationId === primaryGodown ? (openPo.get(variantId) ?? 0) : 0
    values.push({
      variantId,
      locationId,
      horizonDays,
      expectedQtyPcs: estimate.expectedQtyPcs,
      onHandPcs: stock,
      reorderQtyPcs: Math.max(0, estimate.expectedQtyPcs - stock - incoming),
      daysCover:
        estimate.dailyRate > 0 ? Math.max(0, Math.floor(stock / estimate.dailyRate)) : null,
      method: estimate.method,
      confidenceBps: estimate.confidenceBps,
    })
  }
  if (values.length === 0) return { written: 0, asOfDate, horizonDays }
  await writeForecasts(tx, values)
  return { written: values.length, asOfDate, horizonDays }
}

/** The upsert. Runs as `system` because `ai_forecasts` is system-write by policy, and only ever here. */
export async function writeForecasts(tx: Db, values: readonly ForecastRowValues[]): Promise<void> {
  const { tenantId } = currentTenant()
  const now = new Date()
  await asSystem(tx, async () => {
    // Chunked so one pass never builds a multi-megabyte statement (docs/20 rule 1).
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500)
      await tx
        .insert(aiForecasts)
        .values(
          chunk.map((row) => ({
            id: uuidv7(),
            tenantId,
            variantId: row.variantId,
            locationId: row.locationId,
            horizonDays: row.horizonDays,
            expectedQtyPcs: row.expectedQtyPcs,
            reorderQtyPcs: row.reorderQtyPcs,
            onHandPcs: row.onHandPcs,
            daysCover: row.daysCover,
            method: row.method,
            confidenceBps: row.confidenceBps,
            computedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [
            aiForecasts.tenantId,
            aiForecasts.variantId,
            aiForecasts.locationId,
            aiForecasts.horizonDays,
          ],
          set: {
            expectedQtyPcs: sql`excluded.expected_qty_pcs`,
            reorderQtyPcs: sql`excluded.reorder_qty_pcs`,
            onHandPcs: sql`excluded.on_hand_pcs`,
            daysCover: sql`excluded.days_cover`,
            method: sql`excluded.method`,
            confidenceBps: sql`excluded.confidence_bps`,
            computedAt: sql`excluded.computed_at`,
          },
        })
    }
  })
}

export interface DemandEstimate {
  expectedQtyPcs: number
  dailyRate: number
  method: ForecastMethod
  confidenceBps: number
}

/**
 * The estimator. PURE — history in, an expectation out — so the arithmetic is testable without a
 * database and a change to it is visible in a diff rather than in a query plan.
 */
export function estimateDemand(
  history: readonly { day: string; pcs: number }[],
  options: { asOfDate: string; lookbackDays: number; horizonDays: number },
): DemandEstimate {
  const { lookbackDays, horizonDays } = options
  const soldDays = history.filter((d) => d.pcs > 0)
  if (soldDays.length === 0)
    return { expectedQtyPcs: 0, dailyRate: 0, method: 'new_sku', confidenceBps: 0 }

  const totalPcs = soldDays.reduce((sum, d) => sum + d.pcs, 0)
  const density = soldDays.length / lookbackDays

  if (density < 1 / 3) {
    // Croston: size ÷ interval. With sales on 6 of 90 days, a flat mean says "0.4 a day" and buys
    // nothing; Croston says "when it moves, it moves 30, about every 15 days", which is the truth.
    const meanSize = totalPcs / soldDays.length
    const meanInterval = lookbackDays / soldDays.length
    const dailyRate = meanSize / meanInterval
    return {
      expectedQtyPcs: Math.round(dailyRate * horizonDays),
      dailyRate,
      method: 'croston',
      // Few observations, so never confident: 6 sales days out of 90 is about 30 %.
      confidenceBps: clampBps(2_000 + Math.min(soldDays.length, 20) * 200),
    }
  }

  // Moving average with a day-of-week shape. The factor is bounded to [0.5, 2] so one freak market
  // day in the lookback cannot triple next week's purchase.
  const dailyRate = totalPcs / lookbackDays
  const byWeekday = new Map<number, { pcs: number; days: number }>()
  for (const entry of history) {
    const weekday = weekdayOf(entry.day)
    const bucket = byWeekday.get(weekday) ?? { pcs: 0, days: 0 }
    bucket.pcs += entry.pcs
    bucket.days += 1
    byWeekday.set(weekday, bucket)
  }
  let expected = 0
  for (let offset = 1; offset <= horizonDays; offset++) {
    const day = addDays(options.asOfDate, offset)
    const bucket = byWeekday.get(weekdayOf(day))
    const factor =
      bucket && bucket.days > 0 && dailyRate > 0
        ? clamp(bucket.pcs / bucket.days / dailyRate, 0.5, 2)
        : 1
    expected += dailyRate * factor
  }
  // Confidence falls with volatility: a steady SKU is trustworthy, a spiky one is not.
  const mean = totalPcs / soldDays.length
  const variance =
    soldDays.reduce((sum, d) => sum + (d.pcs - mean) ** 2, 0) / Math.max(1, soldDays.length)
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
  return {
    expectedQtyPcs: Math.round(expected),
    dailyRate,
    method: 'moving_average_28',
    confidenceBps: clampBps((0.55 + 0.4 * density) * (1 - Math.min(0.6, cv * 0.4)) * 10_000),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// reads

/**
 * Pieces that LEFT each location per IST business day: the `sale` rows of the append-only stock
 * ledger, resolved to the variant through the lot. `van_load` is a transfer, not demand, and is
 * deliberately absent — a van that loads 200 pieces and returns 40 sold 160, and those 160 are
 * `sale` rows at the vehicle, not at the godown.
 */
async function readDemand(
  tx: Db,
  i: { asOfDate: string; lookbackDays: number; locationId: string | null; limit: number },
): Promise<DemandRow[]> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select
      l.variant_id                                                as variant_id,
      sl.location_id                                              as location_id,
      to_char((sl.occurred_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
      sum(-sl.qty_delta)::int                                     as pcs
    from stock_ledger sl
    join stock_lots l on l.id = sl.lot_id
    join locations loc on loc.id = sl.location_id
    where sl.tenant_id = ${tenantId}
      and sl.reason = 'sale'
      and sl.qty_delta < 0
      and (sl.occurred_at at time zone 'Asia/Kolkata')::date
            between (${i.asOfDate}::date - ${i.lookbackDays}::int) and (${i.asOfDate}::date - 1)
      ${i.locationId ? sql`and sl.location_id = ${i.locationId}` : sql`and loc.kind = 'warehouse'`}
    group by 1, 2, 3
    order by 1, 2, 3
    limit ${i.limit * 30}
  `)
  const byKey = new Map<string, DemandRow>()
  for (const raw of result.rows) {
    const variantId = String(raw.variant_id)
    const locationId = String(raw.location_id)
    const key = `${variantId}|${locationId}`
    const row = byKey.get(key) ?? { variantId, locationId, days: [] }
    row.days.push({ day: String(raw.day), pcs: Number(raw.pcs) })
    byKey.set(key, row)
  }
  return [...byKey.values()].slice(0, i.limit)
}

/** On-hand pieces per variant × location, from the derived balances. No value, no cost. */
async function readOnHand(
  tx: Db,
  locationId: string | null,
): Promise<Map<string, { variantId: string; locationId: string; onHandPcs: number }>> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select l.variant_id as variant_id, b.location_id as location_id, sum(b.on_hand)::int as on_hand
    from stock_balances b
    join stock_lots l on l.id = b.lot_id
    join locations loc on loc.id = b.location_id
    where b.tenant_id = ${tenantId}
      ${locationId ? sql`and b.location_id = ${locationId}` : sql`and loc.kind = 'warehouse'`}
    group by 1, 2
    having sum(b.on_hand) <> 0
  `)
  const out = new Map<string, { variantId: string; locationId: string; onHandPcs: number }>()
  for (const raw of result.rows) {
    const variantId = String(raw.variant_id)
    const loc = String(raw.location_id)
    out.set(`${variantId}|${loc}`, {
      variantId,
      locationId: loc,
      onHandPcs: Math.max(0, Number(raw.on_hand)),
    })
  }
  return out
}

/** Pieces already on order: a buyer must not be told to buy what is on a lorry. Back-office read. */
async function readOpenPurchaseOrders(tx: Db): Promise<Map<string, number>> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select line->>'variantId' as variant_id, sum((line->>'qtyPcs')::int)::int as pcs
    from purchase_orders po, jsonb_array_elements(po.lines) as line
    where po.tenant_id = ${tenantId}
      and po.status in ('sent', 'partially_received')
      and line->>'variantId' is not null
    group by 1
  `)
  const out = new Map<string, number>()
  for (const raw of result.rows) out.set(String(raw.variant_id), Math.max(0, Number(raw.pcs)))
  return out
}

/** The godown open purchase orders are assumed to arrive at: the first warehouse, deterministically. */
async function primaryWarehouseId(tx: Db): Promise<string | null> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select id from locations
    where tenant_id = ${tenantId} and kind = 'warehouse' and active = true
    order by id asc limit 1
  `)
  const row = result.rows[0]
  return row ? String(row.id) : null
}

// ---------------------------------------------------------------------------------------------------------------

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 0 = Sunday, matching `Date.getUTCDay()`; the date string is already an IST calendar date. */
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay()
}

function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
