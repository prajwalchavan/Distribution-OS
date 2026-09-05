/** Picking, packing, load sheets and Rule 55 delivery challans — the godown's fourteen days. */
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  deliveryChallans,
  loadSheets,
  packConfirmations,
  pickLines,
  numberingSeries,
  picklists,
  salesOrderLines,
  stockBalances,
  stockLedger,
  stockLots,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { OrderRecord, SalesResult } from './sales.js'
import type { StockResult } from './stock.js'
import { atIstTime, FY, isoDate, nth, TODAY } from './util.js'

/**
 * The paperwork the godown actually generates, keyed off the orders `seedSales` already wrote:
 *
 *   one picklist per working day  →  its pick lines (a few short, a few off-FEFO)
 *   one pack confirmation per invoiced order  →  its packages, its weight, its invoice
 *   one load sheet per (day × vehicle)  →  its delivery challan and its godown → vehicle transfer
 *
 * Everything is keyed with `demoId(...)` and inserted with `onConflictDoNothing()`, so `pnpm db:seed`
 * twice adds nothing. The stock movement is the one place that needs care: the ledger rows are keyed
 * exactly as `warehouse.loadSheets.confirm` keys them (`load:<sheetId>:<lotId>:out|in`), and the balance
 * deltas are applied ONLY for the rows this run actually inserted, so a re-seed moves no stock.
 *
 * Called once per distributor from `seed-demo/index.ts` with that tenant's own `sales` and `stock`
 * results; nothing here knows the pilot tenant's id.
 */

/** Orders whose goods really left the godown, in the order `seedSales` gives them. */
const PACKED_STATES = new Set(['packed', 'dispatched', 'delivered', 'closed'])
/** Only these leave on a vehicle: a `packed` order is still on the dock. */
const DISPATCHED_STATES = new Set(['dispatched', 'delivered', 'closed'])

const VEHICLE_KEYS = ['tempo', 'three-wheeler'] as const
const vehicleLocId = (key: string) => demoId('location-vehicle', key)
const tripIdFor = (day: Date, key: string) => demoId('trip', `${isoDate(day)}:${key}`)

/** Reasons a picker writes when a case is not on the rack. */
const SHORT_REASONS = [
  'stock not found on rack',
  'damaged carton',
  'batch expiring, held back',
] as const

const pad = (n: number) => String(n).padStart(4, '0')

export interface WarehouseResult {
  picklistIds: string[]
  loadSheetIds: string[]
  challanIds: string[]
}

export async function seedWarehouse(
  db: Db,
  tenantId: string,
  sales: SalesResult,
  stock: StockResult,
  people: PeopleResult,
): Promise<WarehouseResult> {
  const packedOrders = sales.orders.filter((o) => PACKED_STATES.has(o.state))
  if (packedOrders.length === 0) return { picklistIds: [], loadSheetIds: [], challanIds: [] }

  const invoiceByOrder = new Map(sales.invoices.map((i) => [i.orderId, i]))
  const lines = await db
    .select({
      id: salesOrderLines.id,
      orderId: salesOrderLines.orderId,
      lineNo: salesOrderLines.lineNo,
      variantId: salesOrderLines.variantId,
      qtyPcs: salesOrderLines.qtyPcs,
      freeQtyPcs: salesOrderLines.freeQtyPcs,
    })
    .from(salesOrderLines)
    .where(
      inArray(
        salesOrderLines.orderId,
        packedOrders.map((o) => o.id),
      ),
    )
    .orderBy(salesOrderLines.orderId, salesOrderLines.lineNo)
  const linesByOrder = new Map<string, (typeof lines)[number][]>()
  for (const line of lines) {
    const group = linesByOrder.get(line.orderId) ?? []
    group.push(line)
    linesByOrder.set(line.orderId, group)
  }

  // one wave per working day the godown had something to pick
  const byDay = new Map<string, OrderRecord[]>()
  for (const order of packedOrders) {
    const key = isoDate(order.day)
    const group = byDay.get(key) ?? []
    group.push(order)
    byDay.set(key, group)
  }
  const days = [...byDay.keys()].sort()

  const picklistRows: (typeof picklists.$inferInsert)[] = []
  const pickLineRows: (typeof pickLines.$inferInsert)[] = []
  const packRows: (typeof packConfirmations.$inferInsert)[] = []
  const shortOrders = new Set<string>()
  let shortsLeft = 6
  let overridesLeft = 4
  let pickerFlip = 0

  days.forEach((day, dayIndex) => {
    const orders = byDay.get(day) ?? []
    const picklistId = demoId('picklist', day)
    const isToday = dayIndex === days.length - 1
    const isYesterday = dayIndex === days.length - 2
    const picker = pickerFlip++ % 2 === 0 ? people.warehouse : people.warehouse2
    const dayDate = orders[0]?.day ?? TODAY
    picklistRows.push({
      id: picklistId,
      tenantId,
      picklistNo: `PICK-${pad(dayIndex + 1)}`,
      locationId: stock.godownId,
      status: isToday ? 'picking' : isYesterday ? 'picked' : 'packed',
      orderIds: orders.map((o) => o.id),
      pickDate: day,
      tripId: null,
      beatId: null,
      assignedTo: picker.id,
      startedAt: atIstTime(dayDate, 9, 40),
      completedAt: isToday ? null : atIstTime(dayDate, 11, 15),
    })

    for (const order of orders) {
      const orderLines = linesByOrder.get(order.id) ?? []
      let packedShort = false
      for (const line of orderLines) {
        const lots = stock.lotsByVariantId.get(line.variantId) ?? []
        // FEFO suggests the oldest batch; four lines in the whole dataset were picked off a later one.
        const suggested = lots[0]
        if (!suggested) continue
        const takeOverride = !isToday && overridesLeft > 0 && lots.length > 1 && line.lineNo === 2
        const taken = takeOverride ? nth(lots, 1) : suggested
        if (takeOverride) overridesLeft -= 1
        const requested = line.qtyPcs + line.freeQtyPcs
        const beShort =
          !isToday && shortsLeft > 0 && line.lineNo === 1 && requested > suggested.caseSize * 2
        const pickedQtyPcs = isToday ? 0 : beShort ? requested - suggested.caseSize : requested
        if (beShort) {
          shortsLeft -= 1
          packedShort = true
          shortOrders.add(order.id)
        }
        pickLineRows.push({
          id: demoId('pick-line', line.id),
          tenantId,
          picklistId,
          orderId: order.id,
          orderLineId: line.id,
          variantId: line.variantId,
          lineNo: line.lineNo,
          lotId: taken.id,
          suggestedLotId: suggested.id,
          requestedQtyPcs: requested,
          pickedQtyPcs,
          freeQtyPcs: line.freeQtyPcs,
          caseSize: taken.caseSize,
          fefoOverride: takeOverride,
          shortReason: beShort ? nth(SHORT_REASONS, shortsLeft % SHORT_REASONS.length) : null,
          pickedBy: isToday ? null : picker.id,
          pickedAt: isToday ? null : atIstTime(dayDate, 10, 30),
        })
      }
      if (isToday) continue
      const invoice = invoiceByOrder.get(order.id)
      const totalQtyPcs = (linesByOrder.get(order.id) ?? []).reduce(
        (n, l) => n + l.qtyPcs + l.freeQtyPcs,
        0,
      )
      packRows.push({
        id: demoId('pack', order.id),
        tenantId,
        orderId: order.id,
        picklistId,
        packages: Math.min(12, Math.max(1, Math.ceil(totalQtyPcs / 60))),
        weightGrams: totalQtyPcs * 55,
        shortPacked: packedShort,
        invoiceId: invoice?.id ?? null,
        packedBy: picker.id,
        packedAt: atIstTime(dayDate, 11, 30),
      })
    }
  })

  await insertMany(db, picklists, picklistRows)
  await insertMany(db, pickLines, pickLineRows)
  await insertMany(db, packConfirmations, packRows)

  // ---------------------------------------------------------------------------------------------------------------
  // load sheets and challans

  const packagesByOrder = new Map(packRows.map((p) => [p.orderId, p.packages ?? 1]))
  const pickedByOrder = new Map<string, { lotId: string; qtyPcs: number }[]>()
  for (const row of pickLineRows) {
    if ((row.pickedQtyPcs ?? 0) <= 0 || !row.lotId) continue
    const group = pickedByOrder.get(row.orderId) ?? []
    group.push({ lotId: row.lotId, qtyPcs: row.pickedQtyPcs ?? 0 })
    pickedByOrder.set(row.orderId, group)
  }
  const lotIds = [...new Set(pickLineRows.map((r) => r.lotId).filter((id): id is string => !!id))]
  const lotRows =
    lotIds.length === 0
      ? []
      : await db
          .select({
            id: stockLots.id,
            variantId: stockLots.variantId,
            mrpPaise: stockLots.mrpPaise,
          })
          .from(stockLots)
          .where(and(eq(stockLots.tenantId, tenantId), inArray(stockLots.id, lotIds)))
  const lotById = new Map(lotRows.map((l) => [l.id, l]))

  const sheetRows: (typeof loadSheets.$inferInsert)[] = []
  const challanRows: (typeof deliveryChallans.$inferInsert)[] = []
  /**
   * WHICH SHEETS ACTUALLY MOVE STOCK. Every confirmed sheet gets its paperwork — the sheet, the
   * challan, the numbers a screen shows — but only the MOST RECENT one per vehicle posts the
   * `transfer_out`/`transfer_in` pair. Two reasons, and both are about the demo staying honest: the
   * seed's godown balances are opening + GRN and were never decremented by the ~55 sales it invoices,
   * so issuing a fortnight of loads out of them would drive lots negative; and what the demo actually
   * needs is a van with real stock on it for the delivery module's van sales. The older sheets are
   * paperwork, which is what warehouse §6 sanctions ("seed the paperwork only ... note it").
   */
  const moves: { sheetId: string; key: string; dayDate: Date; byLot: Map<string, number> }[] = []
  let challanNo = 0

  days.forEach((day, dayIndex) => {
    const orders = (byDay.get(day) ?? []).filter((o) => DISPATCHED_STATES.has(o.state))
    if (orders.length === 0) return
    const dayDate = orders[0]?.day ?? TODAY
    const isToday = dayIndex === days.length - 1
    const half = Math.ceil(orders.length / 2)
    const buckets = [orders.slice(0, half), orders.slice(half)]
    buckets.forEach((bucket, vi) => {
      if (bucket.length === 0) return
      const key = nth(VEHICLE_KEYS, vi)
      const sheetId = demoId('load-sheet', `${day}:${key}`)
      // The crew loads LAST STOP FIRST, so the sheet lists the day's orders in reverse (coordination §4).
      const orderIds = [...bucket].reverse().map((o) => o.id)
      const expectedPackages = orderIds.reduce((n, id) => n + (packagesByOrder.get(id) ?? 1), 0)
      const loadValuePaise = orderIds.reduce(
        (n, id) => n + (invoiceByOrder.get(id)?.totalPaise ?? 0),
        0,
      )
      // One sheet a fortnight comes back a carton short: the count is the last chance to notice.
      const hasVariance = dayIndex === 1 && vi === 0
      const ewbRequired = loadValuePaise >= 10_000_000
      const confirmed = !isToday
      sheetRows.push({
        id: sheetId,
        tenantId,
        tripId: tripIdFor(dayDate, key),
        status: confirmed ? 'confirmed' : 'draft',
        sheetDate: day,
        fromLocationId: stock.godownId,
        toLocationId: vehicleLocId(key),
        orderIds,
        vanStock: [],
        expectedPackages,
        // Today's two sheets are counted but NOT confirmed, so the app opens on something to check out.
        countedPackages: confirmed
          ? hasVariance
            ? expectedPackages - 1
            : expectedPackages
          : expectedPackages,
        varianceNote: hasVariance ? 'one carton left on the dock, sent on the next trip' : null,
        pinVerifiedBy: hasVariance ? people.manager.id : null,
        // The manager's load-out PIN is given in the MANAGER app (docs/22 §8, 2026-09-05): every confirmed
        // sheet carries the approval the trigger in 0013 demands, and of today's two drafts the first is
        // approved and waiting for the warehouse to count it out, the second is still waiting for the manager.
        approvedBy: confirmed || vi === 0 ? people.manager.id : null,
        approvedAt: confirmed || vi === 0 ? atIstTime(dayDate, 12, 10) : null,
        loadValuePaise,
        ewbRequired,
        ewbNo: ewbRequired ? '381012345678' : null,
        confirmedBy: confirmed ? people.manager.id : null,
        confirmedAt: confirmed ? atIstTime(dayDate, 12, 15) : null,
        challanNo: null,
      })
      if (!confirmed) return

      // What physically went onto the van: the picked lots of every order on the sheet.
      const byLot = new Map<string, number>()
      for (const orderId of orderIds) {
        for (const entry of pickedByOrder.get(orderId) ?? []) {
          byLot.set(entry.lotId, (byLot.get(entry.lotId) ?? 0) + entry.qtyPcs)
        }
      }
      if (byLot.size === 0) return
      challanNo += 1
      const challanId = demoId('challan', sheetId)
      let gstPaise = 0
      const challanLines = [...byLot].map(([lotId, qtyPcs]) => {
        const lot = lotById.get(lotId)
        const taxableValuePaise = (lot?.mrpPaise ?? 0) * qtyPcs
        const gstBps = 1200
        gstPaise += Math.round((taxableValuePaise * gstBps) / 10_000)
        return { variantId: lot?.variantId ?? '', lotId, qtyPcs, taxableValuePaise, gstBps }
      })
      challanRows.push({
        id: challanId,
        tenantId,
        seriesCode: 'DC',
        challanNo: `DC-${pad(challanNo)}`,
        fy: FY,
        challanDate: day,
        loadSheetId: sheetId,
        fromLocationId: stock.godownId,
        toLocationId: vehicleLocId(key),
        vehicleNo: key === 'tempo' ? 'MH-05-AB-1234' : 'MH-05-CD-5678',
        lines: challanLines,
        valuePaise: loadValuePaise,
        loadValueGstPaise: gstPaise,
        ewbNo: ewbRequired ? '381012345678' : null,
        issuedBy: people.manager.id,
        issuedAt: atIstTime(dayDate, 12, 20),
      })
      const sheet = sheetRows[sheetRows.length - 1]
      if (sheet) sheet.challanNo = `DC-${pad(challanNo)}`

      moves.push({ sheetId, key, dayDate, byLot })
    })
  })

  await insertMany(db, loadSheets, sheetRows)
  await insertMany(db, deliveryChallans, challanRows)

  const freshest = new Map<string, (typeof moves)[number]>()
  for (const move of moves) freshest.set(move.key, move)
  const onHand = await godownOnHand(db, tenantId, stock.godownId)
  const ledgerRows: (typeof stockLedger.$inferInsert)[] = []
  for (const move of freshest.values()) {
    for (const [lotId, wanted] of move.byLot) {
      // Never drive a lot negative: `stock_balances_on_hand_nonneg` is the guarantee and a seed that
      // trips it leaves the founder with a half-applied dataset.
      const qtyPcs = Math.min(wanted, onHand.get(lotId) ?? 0)
      if (qtyPcs <= 0) continue
      onHand.set(lotId, (onHand.get(lotId) ?? 0) - qtyPcs)
      ledgerRows.push(
        {
          id: demoId('ledger', `load-out:${move.sheetId}:${lotId}`),
          tenantId,
          occurredAt: atIstTime(move.dayDate, 12, 15),
          lotId,
          locationId: stock.godownId,
          qtyDelta: -qtyPcs,
          reason: 'transfer_out',
          refType: 'load_sheet',
          refId: move.sheetId,
          actorId: people.manager.id,
          idempotencyKey: `load:${move.sheetId}:${lotId}:out`,
        },
        {
          id: demoId('ledger', `load-in:${move.sheetId}:${lotId}`),
          tenantId,
          occurredAt: atIstTime(move.dayDate, 12, 15),
          lotId,
          locationId: vehicleLocId(move.key),
          qtyDelta: qtyPcs,
          reason: 'transfer_in',
          refType: 'load_sheet',
          refId: move.sheetId,
          actorId: people.manager.id,
          idempotencyKey: `load:${move.sheetId}:${lotId}:in`,
        },
      )
    }
  }
  await postTransfers(db, tenantId, ledgerRows)

  // The counters follow the paper, exactly as `seedSales` does for SO/INV/CN. Without this the next
  // `nextDocumentNumber(tx, 'PICK')` hands out PICK-0001 again and collides with the seeded wave on
  // `picklists_no_idx` — a 409 the founder would see the first time they raised a picklist in the app.
  await advanceSeries(db, tenantId, 'PICK', 'PICK-', picklistRows.length)
  await advanceSeries(db, tenantId, 'DC', 'DC-', challanRows.length)

  return {
    picklistIds: picklistRows.map((r) => r.id),
    loadSheetIds: sheetRows.map((r) => r.id),
    challanIds: challanRows.map((r) => r.id),
  }
}

/**
 * The godown → vehicle movement, ONE ROW PER TRANSACTION.
 *
 * `stock_ledger` is append-only with `UNIQUE(tenant_id, idempotency_key)`, so re-seeding writes no row
 * twice. The balance, though, is a running total: applying a delta for a ledger row that was already
 * written would move the van stock a little further every time the founder re-ran `pnpm db:seed`. So
 * the row and its balance move together, and the INSERT's own `RETURNING` — not a separate "have I done
 * this?" query — decides whether the balance moves. Batching the ledger inserts and then walking the
 * balances is what makes a seed that dies half way leave the two permanently out of step.
 */
/** Move a numbering counter past the documents this seed wrote, never backwards. */
async function advanceSeries(
  db: Db,
  tenantId: string,
  seriesCode: string,
  prefix: string,
  written: number,
): Promise<void> {
  if (written === 0) return
  await db
    .insert(numberingSeries)
    .values({ tenantId, seriesCode, fy: FY, prefix, nextNo: written + 1 })
    .onConflictDoUpdate({
      target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
      set: { nextNo: sql`greatest(${numberingSeries.nextNo}, ${written + 1})` },
    })
}

/** What the godown can actually issue right now, lot by lot. */
async function godownOnHand(
  db: Db,
  tenantId: string,
  godownId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ lotId: stockBalances.lotId, onHand: stockBalances.onHand })
    .from(stockBalances)
    .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.locationId, godownId)))
  return new Map(rows.map((r) => [r.lotId, r.onHand]))
}

async function postTransfers(
  db: Db,
  tenantId: string,
  rows: (typeof stockLedger.$inferInsert)[],
): Promise<void> {
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const [written] = await tx
        .insert(stockLedger)
        .values(row)
        .onConflictDoNothing({ target: [stockLedger.tenantId, stockLedger.idempotencyKey] })
        .returning({ id: stockLedger.id })
      // Already posted under this key on an earlier run: its balance moved then, and moving it again
      // is exactly the drift this guard exists to prevent.
      if (!written) return
      // UPDATE FIRST, as `InventoryService.applyBalance` does and for the same reason: Postgres
      // evaluates `on_hand >= 0` on the proposed INSERT row BEFORE it looks for a conflict, so
      // `INSERT ... ON CONFLICT DO UPDATE` with a negative delta trips the check even when the row
      // that exists has plenty. A fresh row is inserted only when the pair has none.
      const moved = await tx
        .update(stockBalances)
        .set({
          onHand: sql`${stockBalances.onHand} + ${row.qtyDelta}`,
          version: sql`${stockBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockBalances.tenantId, tenantId),
            eq(stockBalances.lotId, row.lotId),
            eq(stockBalances.locationId, row.locationId),
          ),
        )
        .returning({ lotId: stockBalances.lotId })
      if (moved.length > 0) return
      await tx
        .insert(stockBalances)
        .values({
          tenantId,
          lotId: row.lotId,
          locationId: row.locationId,
          onHand: row.qtyDelta,
          reserved: 0,
          version: 1,
        })
        .onConflictDoNothing()
    })
  }
}
