/**
 * THE GOODS RIDE THE VAN, in the demo data as in the service (QA DOS-195).
 *
 * `seedSales` and `seedPlatformGaps` stage every packed order rack → dock, exactly as
 * `InventoryService.postPick` does. This module writes the rest of the journey the way the services
 * write it, read back from the paper the other seeds have already put in the database:
 *
 *   every CONFIRMED load sheet     dock → vehicle per lot, keyed `load:<sheetId>:<lotId>:pack:out|in`
 *                                  (`loadSheets.confirm`), for the packed lots of the orders on it;
 *   every SETTLED trip             the bills that came back undelivered on it (a `deliveries` row with
 *                                  `outcome = failed`, its order counted out on that trip's sheet) go
 *                                  van → DOCK, keyed `settle:<tripId>:<lotId>:out` + `…:dock`
 *                                  (`delivery.settlement`, ruling S1) — staged for the next sheet, which
 *                                  the re-attempt two days later then loads again;
 *   every OPENED door              a delivery with an outcome that opened the shutter (`delivered`,
 *                                  `partial`, `returned`) relieves the VEHICLE of the whole bill as
 *                                  `sale`, keyed `delivery:<deliveryId>:<lotId>` (`deliveries.record`);
 *                                  what a partial door sent back is the credit note's own restock rows,
 *                                  which `seedSales` already wrote.
 *
 * So after this: an undelivered bill on the ACTIVE trip stands on its van, an undelivered bill on a
 * settled trip stands on the dock, a delivered bill stands nowhere (sold), and a packed bill no sheet
 * has confirmed stands on the dock — and no location is ever negative. Every quantity is the order's
 * own pack rows (per lot), the same figure `packedLotsByOrder` gives the load sheet, so a vehicle's
 * loads and its doors always tally to the piece.
 *
 * All rows go through ONE `postLedger` call: it folds the deltas per (lot, location) before touching
 * `stock_balances`, so a bill that rode out, came back to the dock and rode out again never drives the
 * dock below zero between two of its own legs. Keyed with `demoId` + the service's idempotency keys and
 * inserted `onConflictDoNothing`, so a second `pnpm db:seed` writes nothing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { tenants, type stockLedger } from '../schema/index.js'
import { postLedger } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { StockResult } from './stock.js'

type LedgerRow = typeof stockLedger.$inferInsert

interface SheetRow {
  id: string
  tripId: string | null
  toLocationId: string
  confirmedAt: Date | string | null
  orderIds: string[]
}

export async function seedDispatchStock(
  db: Db,
  tenantId: string,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  // What each order's pack took off the rack, per lot — the one figure every leg below is sized by.
  const packed = new Map<string, Map<string, number>>()
  const packRows = (
    await db.execute(sql`
      SELECT ref_id AS order_id, lot_id, -sum(qty_delta)::int AS pcs
        FROM stock_ledger
       WHERE tenant_id = ${tenantId} AND ref_type = 'pack' AND qty_delta < 0 AND ref_id IS NOT NULL
       GROUP BY ref_id, lot_id`)
  ).rows as { order_id: string; lot_id: string; pcs: number }[]
  for (const r of packRows) {
    const byLot = packed.get(r.order_id) ?? new Map<string, number>()
    byLot.set(r.lot_id, (byLot.get(r.lot_id) ?? 0) + Number(r.pcs))
    packed.set(r.order_id, byLot)
  }
  if (packed.size === 0) return

  const sheets = (
    await db.execute(sql`
      SELECT id, trip_id, to_location_id, confirmed_at, order_ids
        FROM load_sheets
       WHERE tenant_id = ${tenantId} AND status = 'confirmed'
       ORDER BY confirmed_at, id`)
  ).rows.map((r) => {
    const row = r as {
      id: string
      trip_id: string | null
      to_location_id: string
      confirmed_at: Date | string | null
      order_ids: unknown
    }
    return {
      id: row.id,
      tripId: row.trip_id,
      toLocationId: row.to_location_id,
      confirmedAt: row.confirmed_at,
      orderIds: Array.isArray(row.order_ids) ? (row.order_ids as string[]) : [],
    } satisfies SheetRow
  })
  if (sheets.length === 0) return
  /** The confirmed sheet an order rode out on for a given trip: which van, and that it really was counted out. */
  const sheetOf = new Map<string, SheetRow>()
  for (const sheet of sheets) {
    if (sheet.tripId === null) continue
    for (const orderId of sheet.orderIds) sheetOf.set(`${sheet.tripId}:${orderId}`, sheet)
  }

  const rows: LedgerRow[] = []
  const at = (value: Date | string | null | undefined, fallback: Date): Date =>
    value === null || value === undefined ? fallback : new Date(value)

  // What each (sheet, lot) already carries on the van — under the service's own key, the back-fill's
  // (migration 0064 stages a database migrated from the old model, but loads its DISPATCHED bills
  // only) or an earlier seed's top-up. The seed sizes every load by the whole sheet and writes the
  // difference under its own stem, `load:<sheetId>:<lotId>:pack:seed:out|in`, exactly as 0064 tops up
  // a sheet the service already loaded; a second run finds nothing left to add and writes no row.
  const loaded = new Map<string, number>()
  const loadedRows = (
    await db.execute(sql`
      SELECT idempotency_key, qty_delta
        FROM stock_ledger
       WHERE tenant_id = ${tenantId} AND ref_type = 'load_sheet'
         AND idempotency_key LIKE 'load:%:pack%:in'`)
  ).rows as { idempotency_key: string; qty_delta: number }[]
  for (const r of loadedRows) {
    const stem = r.idempotency_key.replace(/:pack(?::\w+)?:in$/, ':pack')
    loaded.set(stem, (loaded.get(stem) ?? 0) + Number(r.qty_delta))
  }

  // 1. Every confirmed sheet: dock → vehicle, per lot across its orders.
  for (const sheet of sheets) {
    const byLot = new Map<string, number>()
    for (const orderId of sheet.orderIds) {
      for (const [lotId, pcs] of packed.get(orderId) ?? []) {
        byLot.set(lotId, (byLot.get(lotId) ?? 0) + pcs)
      }
    }
    const when = at(sheet.confirmedAt, new Date())
    for (const [lotId, need] of byLot) {
      const stem = `load:${sheet.id}:${lotId}:pack`
      const already = loaded.get(stem) ?? 0
      const pcs = need - already
      if (pcs <= 0) continue
      const key = already === 0 ? stem : `${stem}:seed`
      rows.push(
        {
          id: demoId('ledger', `${key}:out`),
          tenantId,
          occurredAt: when,
          lotId,
          locationId: stock.transitId,
          qtyDelta: -pcs,
          reason: 'transfer_out',
          refType: 'load_sheet',
          refId: sheet.id,
          actorId: people.warehouse.id,
          idempotencyKey: `${key}:out`,
        },
        {
          id: demoId('ledger', `${key}:in`),
          tenantId,
          occurredAt: when,
          lotId,
          locationId: sheet.toLocationId,
          qtyDelta: pcs,
          reason: 'transfer_in',
          refType: 'load_sheet',
          refId: sheet.id,
          actorId: people.warehouse.id,
          idempotencyKey: `${key}:in`,
        },
      )
    }
  }

  // 2. Every settled trip: the bills that came back undelivered go van → dock at the check-in.
  const settled = (
    await db.execute(sql`
      SELECT t.id AS trip_id, s.id AS settlement_id, s.settled_at, t.ended_at,
             d.order_id, d.invoice_id
        FROM trips t
        JOIN deliveries d ON d.trip_id = t.id AND d.tenant_id = t.tenant_id AND d.outcome = 'failed'
        JOIN invoices i ON i.id = d.invoice_id AND i.state <> 'cancelled'
        LEFT JOIN trip_settlements s ON s.trip_id = t.id AND s.tenant_id = t.tenant_id
       WHERE t.tenant_id = ${tenantId}
         AND t.state IN ('settled', 'settled_with_variance')
       ORDER BY t.id, d.id`)
  ).rows as {
    trip_id: string
    settlement_id: string | null
    settled_at: Date | string | null
    ended_at: Date | string | null
    order_id: string | null
    invoice_id: string
  }[]
  const returnsByTrip = new Map<
    string,
    { refId: string; when: Date; vehicleLocationId: string; byLot: Map<string, number> }
  >()
  for (const r of settled) {
    if (r.order_id === null) continue
    const sheet = sheetOf.get(`${r.trip_id}:${r.order_id}`)
    if (!sheet) continue // never counted out on this trip: nothing rode, nothing comes back
    const entry = returnsByTrip.get(r.trip_id) ?? {
      refId: r.settlement_id ?? r.trip_id,
      when: at(r.settled_at, at(r.ended_at, new Date())),
      vehicleLocationId: sheet.toLocationId,
      byLot: new Map<string, number>(),
    }
    for (const [lotId, pcs] of packed.get(r.order_id) ?? []) {
      entry.byLot.set(lotId, (entry.byLot.get(lotId) ?? 0) + pcs)
    }
    returnsByTrip.set(r.trip_id, entry)
  }
  for (const [tripId, entry] of returnsByTrip) {
    for (const [lotId, pcs] of entry.byLot) {
      const key = `settle:${tripId}:${lotId}`
      rows.push(
        {
          id: demoId('ledger', `${key}:out`),
          tenantId,
          occurredAt: entry.when,
          lotId,
          locationId: entry.vehicleLocationId,
          qtyDelta: -pcs,
          reason: 'van_unload',
          refType: 'trip_settlement',
          refId: entry.refId,
          actorId: people.accountant.id,
          idempotencyKey: `${key}:out`,
        },
        {
          id: demoId('ledger', `${key}:dock`),
          tenantId,
          occurredAt: entry.when,
          lotId,
          locationId: stock.transitId,
          qtyDelta: pcs,
          reason: 'transfer_in',
          refType: 'trip_settlement',
          refId: entry.refId,
          actorId: people.accountant.id,
          idempotencyKey: `${key}:dock`,
          note: 'undelivered bill staged for its next trip at check-in',
        },
      )
    }
  }

  // 3. Every opened door: the sale leaves the vehicle.
  const doors = (
    await db.execute(sql`
      SELECT d.id, d.trip_id, d.order_id, d.delivered_at, d.delivered_by
        FROM deliveries d
       WHERE d.tenant_id = ${tenantId}
         AND d.outcome IN ('delivered', 'partial', 'returned')
       ORDER BY d.id`)
  ).rows as {
    id: string
    trip_id: string
    order_id: string | null
    delivered_at: Date | string | null
    delivered_by: string | null
  }[]
  for (const d of doors) {
    if (d.order_id === null) continue
    const sheet = sheetOf.get(`${d.trip_id}:${d.order_id}`)
    if (!sheet) continue // a bill no sheet counted out onto this van cannot be sold off it
    const when = at(d.delivered_at, new Date())
    for (const [lotId, pcs] of packed.get(d.order_id) ?? []) {
      const key = `delivery:${d.id}:${lotId}`
      rows.push({
        id: demoId('ledger', key),
        tenantId,
        occurredAt: when,
        lotId,
        locationId: sheet.toLocationId,
        qtyDelta: -pcs,
        reason: 'sale',
        refType: 'delivery',
        refId: d.id,
        actorId: d.delivered_by ?? people.delivery.ganesh.id,
        idempotencyKey: key,
      })
    }
  }

  await postLedger(db, tenantId, rows)
}

/**
 * The invariants the dock model promises, read off one tenant's tables as sentences; empty means
 * they hold. Shared by the seed specs and the migration proof: (a) no undelivered bill on a trip out
 * of the godown needs more of a lot than its van holds; (b) no packed or dispatched order has pieces
 * standing in no location — its pack legs balance onto the dock, packed bills stand on the dock and
 * dispatched bills on their van; (c) no balance is negative.
 */
export async function dispatchStockFaults(db: Db, tenantId: string): Promise<string[]> {
  const faults: string[] = []

  // (a) The verifier's query: (lot, vehicle) pairs behind undelivered bills on trips that left the
  // godown, holding LESS on the van than the bills need.
  const short = (
    await db.execute(sql`
      WITH need AS (
        SELECT loc.id AS location_id, p.lot_id, sum(-p.qty_delta)::int AS pcs
          FROM deliveries d
          JOIN trips t ON t.id = d.trip_id
          JOIN locations loc ON loc.vehicle_id = t.vehicle_id AND loc.tenant_id = t.tenant_id
          JOIN sales_orders o ON o.id = d.order_id
          JOIN stock_ledger p ON p.ref_type = 'pack' AND p.ref_id = o.id AND p.qty_delta < 0
         WHERE d.tenant_id = ${tenantId} AND d.outcome IS NULL
           AND t.state IN ('loading', 'active', 'closing')
           AND o.state = 'dispatched'
         GROUP BY loc.id, p.lot_id)
      SELECT n.location_id, n.lot_id, n.pcs AS needed, coalesce(b.on_hand, 0)::int AS on_van
        FROM need n
        LEFT JOIN stock_balances b
          ON b.tenant_id = ${tenantId} AND b.location_id = n.location_id AND b.lot_id = n.lot_id
       WHERE coalesce(b.on_hand, 0) < n.pcs
       ORDER BY 1, 2`)
  ).rows as { location_id: string; lot_id: string; needed: number; on_van: number }[]
  for (const r of short)
    faults.push(
      `(a) vehicle ${r.location_id} holds ${String(r.on_van)} pc of lot ${r.lot_id}; the undelivered bills on it need ${String(r.needed)}`,
    )

  // (b1) Every pack OUT leg of a packed or dispatched order has its IN leg onto the dock, to the piece.
  const unstaged = (
    await db.execute(sql`
      SELECT o.id AS order_id, o.state::text AS state, p.lot_id,
             sum(CASE WHEN p.qty_delta < 0 THEN -p.qty_delta ELSE 0 END)::int AS out_pcs,
             sum(CASE WHEN p.qty_delta > 0 AND loc.kind = 'in_transit' THEN p.qty_delta ELSE 0 END)::int AS dock_pcs
        FROM sales_orders o
        JOIN stock_ledger p ON p.ref_type = 'pack' AND p.ref_id = o.id AND p.tenant_id = o.tenant_id
        JOIN locations loc ON loc.id = p.location_id
       WHERE o.tenant_id = ${tenantId} AND o.state IN ('packed', 'dispatched')
       GROUP BY o.id, o.state, p.lot_id
      HAVING sum(CASE WHEN p.qty_delta < 0 THEN -p.qty_delta ELSE 0 END)
          <> sum(CASE WHEN p.qty_delta > 0 AND loc.kind = 'in_transit' THEN p.qty_delta ELSE 0 END)
       ORDER BY 1, 3`)
  ).rows as { order_id: string; state: string; lot_id: string; out_pcs: number; dock_pcs: number }[]
  for (const r of unstaged)
    faults.push(
      `(b) ${r.state} order ${r.order_id}: ${String(r.out_pcs)} pc of lot ${r.lot_id} left the rack but ${String(r.dock_pcs)} landed on the dock`,
    )

  // (b2) The dock holds every packed bill that is not riding a van (not on a confirmed sheet of a trip
  // out of the godown), lot by lot …
  const dockShort = (
    await db.execute(sql`
      WITH riding AS (
        SELECT DISTINCT oid.order_id
          FROM load_sheets ls
          JOIN trips t ON t.id = ls.trip_id
          CROSS JOIN LATERAL jsonb_array_elements_text(ls.order_ids) AS oid(order_id)
         WHERE ls.tenant_id = ${tenantId} AND ls.status = 'confirmed'
           AND t.state IN ('loading', 'active', 'closing')),
      need AS (
        SELECT p.lot_id, sum(-p.qty_delta)::int AS pcs
          FROM sales_orders o
          JOIN stock_ledger p ON p.ref_type = 'pack' AND p.ref_id = o.id AND p.qty_delta < 0
         WHERE o.tenant_id = ${tenantId} AND o.state = 'packed'
           AND o.id NOT IN (SELECT order_id FROM riding)
         GROUP BY p.lot_id)
      SELECT n.lot_id, n.pcs AS needed, coalesce(b.on_hand, 0)::int AS on_dock
        FROM need n
        LEFT JOIN stock_balances b
          ON b.tenant_id = ${tenantId} AND b.lot_id = n.lot_id
         AND b.location_id = (SELECT id FROM locations WHERE tenant_id = ${tenantId} AND kind = 'in_transit' AND active ORDER BY id LIMIT 1)
       WHERE coalesce(b.on_hand, 0) < n.pcs
       ORDER BY 1`)
  ).rows as { lot_id: string; needed: number; on_dock: number }[]
  for (const r of dockShort)
    faults.push(
      `(b) the dock holds ${String(r.on_dock)} pc of lot ${r.lot_id}; the packed bills waiting there need ${String(r.needed)}`,
    )

  // … and every van holds every dispatched bill counted out onto it on a trip out of the godown.
  const vanShort = (
    await db.execute(sql`
      WITH riding AS (
        SELECT ls.to_location_id AS location_id, oid.order_id
          FROM load_sheets ls
          JOIN trips t ON t.id = ls.trip_id
          CROSS JOIN LATERAL jsonb_array_elements_text(ls.order_ids) AS oid(order_id)
         WHERE ls.tenant_id = ${tenantId} AND ls.status = 'confirmed'
           AND t.state IN ('loading', 'active', 'closing')),
      need AS (
        SELECT r.location_id, p.lot_id, sum(-p.qty_delta)::int AS pcs
          FROM riding r
          JOIN sales_orders o ON o.id = r.order_id AND o.state = 'dispatched'
          JOIN stock_ledger p ON p.ref_type = 'pack' AND p.ref_id = o.id AND p.qty_delta < 0
         GROUP BY r.location_id, p.lot_id)
      SELECT n.location_id, n.lot_id, n.pcs AS needed, coalesce(b.on_hand, 0)::int AS on_van
        FROM need n
        LEFT JOIN stock_balances b
          ON b.tenant_id = ${tenantId} AND b.location_id = n.location_id AND b.lot_id = n.lot_id
       WHERE coalesce(b.on_hand, 0) < n.pcs
       ORDER BY 1, 2`)
  ).rows as { location_id: string; lot_id: string; needed: number; on_van: number }[]
  for (const r of vanShort)
    faults.push(
      `(b) vehicle ${r.location_id} holds ${String(r.on_van)} pc of lot ${r.lot_id}; the dispatched bills counted out onto it need ${String(r.needed)}`,
    )

  // (c) Nothing anywhere is negative.
  const negative = (
    await db.execute(sql`
      SELECT b.location_id, b.lot_id, b.on_hand
        FROM stock_balances b
       WHERE b.tenant_id = ${tenantId} AND b.on_hand < 0
       ORDER BY 1, 2`)
  ).rows as { location_id: string; lot_id: string; on_hand: number }[]
  for (const r of negative)
    faults.push(`(c) location ${r.location_id} holds ${String(r.on_hand)} pc of lot ${r.lot_id}`)

  return faults
}

/** The demo distributors on this database, by the slugs `pnpm db:seed` writes. */
export async function demoTenants(db: Db): Promise<{ id: string; slug: string }[]> {
  return db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(
      and(
        inArray(tenants.slug, ['tarsun', 'sai-distributors', 'kalyan-agencies']),
        eq(tenants.status, 'active'),
      ),
    )
    .orderBy(tenants.slug)
}
