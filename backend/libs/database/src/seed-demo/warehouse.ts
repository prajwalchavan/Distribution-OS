/** Picking, packing, load sheets and Rule 55 delivery challans — the godown's ninety days. */
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  deliveryChallans,
  loadSheets,
  packConfirmations,
  pickLines,
  numberingSeries,
  picklists,
  salesOrderLines,
  stockLots,
} from '../schema/index.js'
import type { stockLedger } from '../schema/index.js'
import type { Db } from '../client.js'
import { insertMany, postLedger } from './db-helpers.js'
import { currentDemoScope, demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { InvoiceLineRecord, OrderRecord, SalesResult } from './sales.js'
import type { StockResult } from './stock.js'
import { activeTripId, bucketise, tripIdFor, vehiclesForDay } from './trip-plan.js'
import { atIstTime, FY, isoDate, nth, occurred, TODAY } from './util.js'

/**
 * The paperwork the godown actually generates, keyed off the orders `seedSales` already wrote:
 *
 *   one picklist per working day  →  its pick lines (what FEFO suggested, what was taken, the shorts)
 *   one pack confirmation per invoiced order  →  its packages, its weight, its invoice
 *   one load sheet per (day × vehicle)  →  its delivery challan
 *
 * The stock itself left the rack at PACK — the sales seed posts one `sale` row per (order, line,
 * batch) exactly as `InventoryService.postPick` does — so a load sheet here is the document, not a
 * second movement. The tempo's counter stock for today's van sales is a `van_load` from the godown.
 *
 * Everything is keyed with `demoId(...)` and inserted with `onConflictDoNothing()`, so `pnpm db:seed`
 * twice adds nothing. Called once per distributor from `seed-demo/index.ts` with that tenant's own
 * `sales` and `stock` results; nothing here knows the pilot tenant's id.
 */

/** Orders the godown has picked or is picking, in the order `seedSales` gives them. */
const PACKED_STATES = new Set([
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
])

const vehicleLocId = (key: string) => demoId('location-vehicle', key)
const ageOf = (day: Date): number => Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)

/** Reasons a picker writes when a case is not on the rack. */
const SHORT_REASONS = [
  'stock not found on rack',
  'damaged carton',
  'batch expiring, held back',
] as const

const pad = (n: number) => String(n).padStart(4, '0')

type RegNos = { tempo: string; 'three-wheeler': string; loader: string }
const PILOT_REG: RegNos = {
  tempo: 'MH-05-AB-1234',
  'three-wheeler': 'MH-05-CD-5678',
  loader: 'MH-05-EF-9012',
}
const VEHICLE_REG: Record<string, RegNos> = {
  'sai:': { tempo: 'MH-05-BQ-4471', 'three-wheeler': 'MH-05-DK-0915', loader: 'MH-05-CR-7732' },
  'kalyan:': { tempo: 'MH-05-DH-2260', 'three-wheeler': 'MH-05-AZ-6108', loader: 'MH-05-EM-3384' },
}

/** The registration plates of a distributor's three vehicles, by demo scope (the pilot's are the originals). */
export function vehicleRegNos(scope: string): RegNos {
  return VEHICLE_REG[scope] ?? PILOT_REG
}

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
  // the orders still being picked have no invoice: their lines come from the order book
  const pickingIds = packedOrders.filter((o) => o.state === 'picking').map((o) => o.id)
  const pickingLines =
    pickingIds.length === 0
      ? []
      : await db
          .select({
            id: salesOrderLines.id,
            orderId: salesOrderLines.orderId,
            lineNo: salesOrderLines.lineNo,
            variantId: salesOrderLines.variantId,
            qtyPcs: salesOrderLines.qtyPcs,
            freeQtyPcs: salesOrderLines.freeQtyPcs,
          })
          .from(salesOrderLines)
          .where(inArray(salesOrderLines.orderId, pickingIds))
          .orderBy(salesOrderLines.orderId, salesOrderLines.lineNo)
  const pickingByOrder = new Map<string, (typeof pickingLines)[number][]>()
  for (const line of pickingLines) {
    const group = pickingByOrder.get(line.orderId) ?? []
    group.push(line)
    pickingByOrder.set(line.orderId, group)
  }
  /** FEFO's suggestion for a line being picked right now: the oldest batch in date today. */
  const fefoToday = (variantId: string) =>
    (stock.lotsByVariantId.get(variantId) ?? [])
      .filter(
        (l) =>
          l.availableFrom.getTime() <= TODAY.getTime() && l.expiryDate.getTime() > TODAY.getTime(),
      )
      .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime() || (a.id < b.id ? -1 : 1))[0]

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
  const plannedLotById = new Map(stock.plan.lots.map((l) => [l.id, l]))
  let pickerFlip = 0
  let shortSeq = 0

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
      // today's wave is still on the floor: two orders are being picked right now
      status: isToday ? 'picking' : isYesterday ? 'picked' : 'packed',
      orderIds: orders.map((o) => o.id),
      pickDate: day,
      tripId: null,
      beatId: null,
      assignedTo: picker.id,
      startedAt: occurred(atIstTime(dayDate, 9, 40)),
      completedAt: isToday ? null : occurred(atIstTime(dayDate, 11, 15)),
      createdAt: occurred(atIstTime(dayDate, 9, 30)),
    })

    for (const order of orders) {
      // an order still `picking` has its lines on the sheet and nothing picked yet — no pack either
      if (order.state === 'picking') {
        for (const line of pickingByOrder.get(order.id) ?? []) {
          const suggested = fefoToday(line.variantId)
          if (!suggested) continue
          pickLineRows.push({
            id: demoId('pick-line', line.id),
            tenantId,
            picklistId,
            orderId: order.id,
            orderLineId: line.id,
            variantId: line.variantId,
            lineNo: line.lineNo,
            lotId: suggested.id,
            suggestedLotId: suggested.id,
            requestedQtyPcs: line.qtyPcs + line.freeQtyPcs,
            pickedQtyPcs: 0,
            freeQtyPcs: line.freeQtyPcs,
            caseSize: suggested.caseSize,
            fefoOverride: false,
            shortReason: null,
            pickedBy: null,
            pickedAt: null,
          })
        }
        continue
      }
      const invoice = invoiceByOrder.get(order.id)
      if (!invoice) continue
      let packedShort = false
      let totalQtyPcs = 0
      invoice.lines.forEach((line: InvoiceLineRecord, i) => {
        const requested = line.qtyPcs + line.freeQtyPcs
        const picked = line.pickedQtyPcs + line.freeQtyPcs
        const short = picked < requested
        if (short) packedShort = true
        totalQtyPcs += picked
        const taken = line.lotId ? plannedLotById.get(line.lotId) : undefined
        pickLineRows.push({
          id: demoId('pick-line', line.orderLineId),
          tenantId,
          picklistId,
          orderId: order.id,
          orderLineId: line.orderLineId,
          variantId: line.variantId,
          lineNo: i + 1,
          lotId: line.lotId,
          suggestedLotId: line.suggestedLotId ?? line.lotId,
          requestedQtyPcs: requested,
          pickedQtyPcs: picked,
          freeQtyPcs: line.freeQtyPcs,
          caseSize: taken?.caseSize ?? null,
          fefoOverride: line.fefoOverride,
          shortReason: short ? nth(SHORT_REASONS, shortSeq++ % SHORT_REASONS.length) : null,
          pickedBy: picker.id,
          pickedAt: occurred(atIstTime(dayDate, 10, 30)),
        })
      })
      packRows.push({
        id: demoId('pack', order.id),
        tenantId,
        orderId: order.id,
        picklistId,
        packages: Math.min(12, Math.max(1, Math.ceil(totalQtyPcs / 60))),
        weightGrams: totalQtyPcs * 55,
        shortPacked: packedShort,
        invoiceId: invoice.id,
        packedBy: picker.id,
        packedAt: occurred(atIstTime(dayDate, 11, 30)),
        createdAt: occurred(atIstTime(dayDate, 11, 30)),
      })
    }
  })

  await insertMany(db, picklists, picklistRows)
  await insertMany(db, pickLines, pickLineRows)
  await insertMany(db, packConfirmations, packRows)

  // ---------------------------------------------------------------------------------------------------------------
  // load sheets and challans: one per (day a load left × vehicle); an order that failed at the door and went
  // out again two days later is on both days' sheets.

  const packagesByOrder = new Map(packRows.map((p) => [p.orderId, p.packages ?? 1]))
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

  interface Load {
    order: OrderRecord
    onRoad: boolean
  }
  const loadsByDay = new Map<string, Load[]>()
  for (const order of packedOrders) {
    if (order.stops.length === 0) {
      // packed on the dock today: tomorrow's draft sheet, for the app to check out
      if (ageOf(order.day) === 0 && order.state === 'packed') {
        const key = isoDate(order.day)
        const group = loadsByDay.get(key) ?? []
        group.push({ order, onRoad: false })
        loadsByDay.set(key, group)
      }
      continue
    }
    order.stops.forEach((stop, i) => {
      // the first attempt left on the order's own day (a stop dated later is the tempo still out
      // with it); a second attempt left again on its own day
      const leftOn = i === 0 ? order.day : stop.day
      const key = isoDate(leftOn)
      const group = loadsByDay.get(key) ?? []
      group.push({
        order,
        onRoad: stop.outcome === 'on_road' || (i === 0 && stop.day.getTime() > order.day.getTime()),
      })
      loadsByDay.set(key, group)
    })
  }
  const loadDays = [...loadsByDay.keys()].sort()

  const sheetRows: (typeof loadSheets.$inferInsert)[] = []
  const challanRows: (typeof deliveryChallans.$inferInsert)[] = []
  let challanNo = 0
  const regNos = vehicleRegNos(currentDemoScope())

  loadDays.forEach((day, dayIndex) => {
    const loads = loadsByDay.get(day) ?? []
    if (loads.length === 0) return
    const dayDate = new Date(`${day}T00:00:00.000Z`)
    const ageDays = ageOf(dayDate)
    // One sheet a fortnight comes back a carton short: the count is the last chance to notice.
    const varianceDay = dayIndex % 12 === 7
    const isToday = ageDays === 0
    const buckets = bucketise(loads, vehiclesForDay(dayDate, ageDays, loads.length), dayDate)
    buckets.forEach(({ key, items: bucket }, vi) => {
      if (bucket.length === 0) return
      const sheetId = demoId('load-sheet', `${day}:${key}`)
      // The crew loads LAST STOP FIRST, so the sheet lists the day's orders in reverse (coordination §4).
      const orderIds = [...bucket].reverse().map((l) => l.order.id)
      const expectedPackages = orderIds.reduce((n, id) => n + (packagesByOrder.get(id) ?? 1), 0)
      const loadValuePaise = orderIds.reduce(
        (n, id) => n + (invoiceByOrder.get(id)?.totalPaise ?? 0),
        0,
      )
      const hasVariance = varianceDay && vi === 0 && !isToday
      const ewbRequired = loadValuePaise >= 10_000_000
      const confirmed = !isToday
      sheetRows.push({
        id: sheetId,
        tenantId,
        tripId: tripIdFor(dayDate, key, ageDays),
        status: confirmed ? 'confirmed' : 'draft',
        sheetDate: day,
        fromLocationId: stock.godownId,
        toLocationId: vehicleLocId(key),
        orderIds,
        vanStock: [],
        expectedPackages,
        // Today's sheet is counted but NOT confirmed, so the app opens on something to check out.
        countedPackages: confirmed
          ? hasVariance
            ? expectedPackages - 1
            : expectedPackages
          : expectedPackages,
        varianceNote: hasVariance ? 'one carton left on the dock, sent on the next trip' : null,
        pinVerifiedBy: hasVariance ? people.manager.id : null,
        // The manager's load-out PIN is given in the MANAGER app (docs/22 §8, 2026-09-05): every confirmed
        // sheet carries the approval the trigger in 0013 demands; today's draft is approved and waiting
        // for the warehouse to count it out.
        approvedBy: people.manager.id,
        approvedAt: occurred(atIstTime(dayDate, 12, 10)),
        loadValuePaise,
        ewbRequired,
        ewbNo: ewbRequired ? '381012345678' : null,
        confirmedBy: confirmed ? people.manager.id : null,
        confirmedAt: confirmed ? occurred(atIstTime(dayDate, 12, 15)) : null,
        challanNo: null,
        createdAt: occurred(atIstTime(dayDate, 11, 50)),
      })
      if (!confirmed) return

      // What physically went onto the van: the picked batches of every order on the sheet.
      const byLot = new Map<string, number>()
      for (const orderId of orderIds) {
        for (const line of invoiceByOrder.get(orderId)?.lines ?? []) {
          if (!line.lotId) continue
          byLot.set(line.lotId, (byLot.get(line.lotId) ?? 0) + line.pickedQtyPcs + line.freeQtyPcs)
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
        vehicleNo: regNos[key],
        lines: challanLines,
        valuePaise: loadValuePaise,
        loadValueGstPaise: gstPaise,
        ewbNo: ewbRequired ? '381012345678' : null,
        issuedBy: people.manager.id,
        issuedAt: occurred(atIstTime(dayDate, 12, 20)),
        createdAt: occurred(atIstTime(dayDate, 12, 20)),
      })
      const sheet = sheetRows[sheetRows.length - 1]
      if (sheet) sheet.challanNo = `DC-${pad(challanNo)}`
    })
  })

  await insertMany(db, loadSheets, sheetRows)
  await insertMany(db, deliveryChallans, challanRows)

  // The tempo's counter stock for today's van sales: a case each of the fast movers, from the godown.
  const vanRows: (typeof stockLedger.$inferInsert)[] = []
  for (const e of stock.plan.events) {
    if (e.kind !== 'van_load' || !e.lotId || e.qtyPcs <= 0) continue
    vanRows.push(
      {
        id: demoId('ledger', `van-load-out:${e.lotId}`),
        tenantId,
        occurredAt: e.at,
        lotId: e.lotId,
        locationId: stock.godownId,
        qtyDelta: -e.qtyPcs,
        reason: 'van_load',
        refType: 'trip',
        refId: activeTripId(),
        actorId: people.warehouse.id,
        idempotencyKey: `van-load:${activeTripId()}:${e.lotId}:out`,
        note: e.note,
      },
      {
        id: demoId('ledger', `van-load-in:${e.lotId}`),
        tenantId,
        occurredAt: e.at,
        lotId: e.lotId,
        locationId: vehicleLocId('tempo'),
        qtyDelta: e.qtyPcs,
        reason: 'van_load',
        refType: 'trip',
        refId: activeTripId(),
        actorId: people.warehouse.id,
        idempotencyKey: `van-load:${activeTripId()}:${e.lotId}:in`,
        note: e.note,
      },
    )
  }
  await postLedger(db, tenantId, vanRows)

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
