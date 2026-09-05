import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type {
  ConsolidatedPickLot,
  ConsolidatedPickRow,
  DeliveryChallan,
  DeliveryChallanLine,
  DeliveryChallanSummary,
  LoadSheetDetail,
  LoadSheetLot,
  LoadSheetOrder,
  LoadSheetSummary,
  PackConfirmation,
  PackLine,
  PickLine,
  PicklistDetail,
  PicklistOrder,
  PicklistSummary,
  SellerBranding,
} from '@dos/contracts'
import {
  deliveryChallans,
  packConfirmations,
  pickLines,
  stockLedger,
  type Db,
  type loadSheets,
  type picklists,
} from '@dos/db'
import type { InvoiceRef } from '../billing/index.js'
import type { FulfilmentLine, FulfilmentOrder, OrdersService } from '../orders/index.js'
import {
  casesAndLoose,
  loadLots,
  loadVariantInfo,
  vehicleRegNos,
  type LotRow,
  type VariantInfo,
} from './warehouse.internals.js'

/**
 * Row → wire shape, and the two "load the whole document" readers (`picklistDetail`,
 * `loadSheetDetail`). Nothing here writes; every service that mutates re-reads through these so the
 * response a picker sees is the state the transaction actually committed.
 */

export type PicklistRow = typeof picklists.$inferSelect
export type PickLineRow = typeof pickLines.$inferSelect
export type PackRow = typeof packConfirmations.$inferSelect
export type LoadSheetRow = typeof loadSheets.$inferSelect
export type ChallanRow = typeof deliveryChallans.$inferSelect

export interface PicklistTotals {
  orderCount: number
  lineCount: number
  requestedQtyPcs: number
  pickedQtyPcs: number
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

// ---------------------------------------------------------------------------------------------------------------
// picklists

export function toPicklistSummary(row: PicklistRow, totals: PicklistTotals): PicklistSummary {
  return {
    id: row.id,
    picklistNo: row.picklistNo,
    status: row.status,
    locationId: row.locationId,
    pickDate: row.pickDate,
    tripId: row.tripId,
    beatId: row.beatId,
    note: row.note,
    orderCount: totals.orderCount,
    lineCount: totals.lineCount,
    requestedQtyPcs: totals.requestedQtyPcs,
    pickedQtyPcs: totals.pickedQtyPcs,
    assignedTo: row.assignedTo,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The aggregates the list needs, in one grouped query rather than one per sheet. */
export async function picklistTotals(
  tx: Db,
  picklistIds: readonly string[],
): Promise<Map<string, PicklistTotals>> {
  const ids = [...new Set(picklistIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      picklistId: pickLines.picklistId,
      lineCount: sql<number>`count(distinct ${pickLines.orderLineId})`,
      orderCount: sql<number>`count(distinct ${pickLines.orderId})`,
      requestedQtyPcs: sql<number>`coalesce(sum(${pickLines.requestedQtyPcs}), 0)`,
      pickedQtyPcs: sql<number>`coalesce(sum(${pickLines.pickedQtyPcs}), 0)`,
    })
    .from(pickLines)
    .where(inArray(pickLines.picklistId, ids))
    .groupBy(pickLines.picklistId)
  return new Map(
    rows.map((r) => [
      r.picklistId,
      {
        orderCount: Number(r.orderCount),
        lineCount: Number(r.lineCount),
        requestedQtyPcs: Number(r.requestedQtyPcs),
        pickedQtyPcs: Number(r.pickedQtyPcs),
      },
    ]),
  )
}

export function pickLinesOf(tx: Db, picklistId: string): Promise<PickLineRow[]> {
  return tx
    .select()
    .from(pickLines)
    .where(eq(pickLines.picklistId, picklistId))
    .orderBy(asc(pickLines.orderId), asc(pickLines.lineNo), asc(pickLines.id))
}

/**
 * The picking sheet: the header, the orders on the wave, every recorded row, and the wave CONSOLIDATED
 * BY SKU (docs/06) so the picker walks the rack once. Each lot under a SKU shows its own cases + loose
 * from THAT lot's case size (docs/17 A2); the SKU row shows the sell-side pack.
 */
export async function picklistDetail(
  tx: Db,
  row: PicklistRow,
  orders: OrdersService,
): Promise<PicklistDetail> {
  const lines = await pickLinesOf(tx, row.id)
  const variants = await loadVariantInfo(
    tx,
    lines.map((l) => l.variantId),
  )
  const lots = await loadLots(
    tx,
    lines.flatMap((l) => [l.lotId, l.suggestedLotId].filter((id): id is string => id !== null)),
  )
  const orderRows = await orders.fulfilmentOrders(tx, row.orderIds)
  return {
    ...toPicklistSummary(row, {
      orderCount: new Set(lines.map((l) => l.orderId)).size,
      lineCount: new Set(lines.map((l) => l.orderLineId)).size,
      requestedQtyPcs: lines.reduce((n, l) => n + l.requestedQtyPcs, 0),
      pickedQtyPcs: lines.reduce((n, l) => n + l.pickedQtyPcs, 0),
    }),
    orders: orderRows.map(toPicklistOrder),
    lines: lines.map((l) => toPickLine(l, variants, lots)),
    consolidated: consolidate(lines, variants, lots),
  }
}

const toPicklistOrder = (o: FulfilmentOrder): PicklistOrder => ({
  orderId: o.orderId,
  orderNo: o.orderNo,
  retailerId: o.retailerId,
  retailerName: o.retailerName,
  state: o.state,
  lineCount: o.lineCount,
})

function toPickLine(
  row: PickLineRow,
  variants: Map<string, VariantInfo>,
  lots: Map<string, LotRow>,
): PickLine {
  const variant = variants.get(row.variantId)
  const lot = row.lotId === null ? undefined : lots.get(row.lotId)
  return {
    id: row.id,
    orderId: row.orderId,
    orderLineId: row.orderLineId,
    lineNo: row.lineNo,
    variantId: row.variantId,
    variantName: variant?.variantName ?? '',
    productName: variant?.productName ?? '',
    lotId: row.lotId,
    suggestedLotId: row.suggestedLotId,
    batchNo: lot ? (lot.batchNo === '' ? null : lot.batchNo) : null,
    expiryDate: lot?.expiryDate ?? null,
    caseSize: row.caseSize !== null && row.caseSize > 0 ? row.caseSize : null,
    requestedQtyPcs: row.requestedQtyPcs,
    pickedQtyPcs: row.pickedQtyPcs,
    freeQtyPcs: row.freeQtyPcs,
    shortReason: row.shortReason,
    fefoOverride: row.fefoOverride,
    pickedBy: row.pickedBy,
    pickedAt: iso(row.pickedAt),
  }
}

function consolidate(
  lines: readonly PickLineRow[],
  variants: Map<string, VariantInfo>,
  lots: Map<string, LotRow>,
): ConsolidatedPickRow[] {
  const bySku = new Map<string, PickLineRow[]>()
  for (const line of lines) {
    const group = bySku.get(line.variantId) ?? []
    group.push(line)
    bySku.set(line.variantId, group)
  }
  const out: ConsolidatedPickRow[] = []
  for (const [variantId, group] of bySku) {
    const variant = variants.get(variantId)
    const requestedQtyPcs = group.reduce((n, l) => n + l.requestedQtyPcs, 0)
    const pickedQtyPcs = group.reduce((n, l) => n + l.pickedQtyPcs, 0)
    const sellCaseSize = variant?.sellCaseSize ?? null
    const byLot = new Map<string, ConsolidatedPickLot>()
    for (const line of group) {
      if (line.lotId === null) continue
      // What the picker will physically carry is what was PICKED; before anyone picks, the ask stands in
      // for it so the sheet is not blank on the way to the rack.
      const qtyPcs = line.pickedQtyPcs > 0 ? line.pickedQtyPcs : line.requestedQtyPcs
      if (qtyPcs <= 0) continue
      const lot = lots.get(line.lotId)
      const caseSize = line.caseSize !== null && line.caseSize > 0 ? line.caseSize : sellCaseSize
      const existing = byLot.get(line.lotId)
      const total = (existing?.qtyPcs ?? 0) + qtyPcs
      byLot.set(line.lotId, {
        lotId: line.lotId,
        batchNo: lot ? (lot.batchNo === '' ? null : lot.batchNo) : null,
        expiryDate: lot?.expiryDate ?? null,
        qtyPcs: total,
        caseSize,
        ...casesAndLoose(total, caseSize),
        fefoWarning: (existing?.fefoWarning ?? false) || line.fefoOverride,
      })
    }
    out.push({
      variantId,
      variantName: variant?.variantName ?? '',
      productName: variant?.productName ?? '',
      requestedQtyPcs,
      pickedQtyPcs,
      caseSize: sellCaseSize,
      ...casesAndLoose(requestedQtyPcs, sellCaseSize),
      lots: [...byLot.values()].sort((a, b) => a.lotId.localeCompare(b.lotId)),
    })
  }
  return out.sort((a, b) => a.variantName.localeCompare(b.variantName))
}

// ---------------------------------------------------------------------------------------------------------------
// packs

export function toPackConfirmation(row: PackRow): PackConfirmation {
  return {
    id: row.id,
    orderId: row.orderId,
    picklistId: row.picklistId,
    packages: row.packages,
    weightGrams: row.weightGrams,
    invoiceId: row.invoiceId,
    shortPacked: row.shortPacked,
    packedBy: row.packedBy,
    packedAt: row.packedAt.toISOString(),
  }
}

/**
 * What actually went into the cartons for one order, per line and per lot. The ledger is the physical
 * truth — one negative `sale` row per (line, lot) written by `InventoryService.postPick` at pack — and
 * the order's own lines say what was asked for, so `shortQtyPcs` is the difference and never an edit.
 */
export async function packLines(
  tx: Db,
  orderId: string,
  orders: OrdersService,
): Promise<PackLine[]> {
  const lines = await orders.fulfilmentLines(tx, [orderId])
  const moved = await packedLotsByOrder(tx, [orderId])
  const rows = await pickedLotsPerLine(tx, orderId)
  const variants = await loadVariantInfo(
    tx,
    lines.map((l) => l.variantId),
  )
  const lots = await loadLots(tx, [
    ...(moved.get(orderId)?.map((m) => m.lotId) ?? []),
    ...rows.map((r) => r.lotId),
  ])
  const byLine = new Map<string, { lotId: string; qtyPcs: number }[]>()
  for (const row of rows) {
    const group = byLine.get(row.orderLineId) ?? []
    group.push({ lotId: row.lotId, qtyPcs: row.qtyPcs })
    byLine.set(row.orderLineId, group)
  }
  return lines.map((line: FulfilmentLine) => {
    const perLot = byLine.get(line.orderLineId) ?? []
    const packedQtyPcs = perLot.reduce((n, l) => n + l.qtyPcs, 0)
    const orderedQtyPcs = line.qtyPcs + line.freeQtyPcs
    return {
      orderLineId: line.orderLineId,
      variantId: line.variantId,
      variantName: variants.get(line.variantId)?.variantName ?? '',
      orderedQtyPcs,
      packedQtyPcs,
      shortQtyPcs: Math.max(0, orderedQtyPcs - packedQtyPcs),
      lots: perLot.map((l) => ({
        lotId: l.lotId,
        batchNo: lots.get(l.lotId)?.batchNo || null,
        qtyPcs: l.qtyPcs,
      })),
    }
  })
}

/** Recorded picks per (line, lot) for one order — paper, and the only per-line lot split we keep. */
async function pickedLotsPerLine(
  tx: Db,
  orderId: string,
): Promise<{ orderLineId: string; lotId: string; qtyPcs: number }[]> {
  const rows = await tx
    .select({
      orderLineId: pickLines.orderLineId,
      lotId: pickLines.lotId,
      qtyPcs: sql<number>`sum(${pickLines.pickedQtyPcs})`,
    })
    .from(pickLines)
    .where(and(eq(pickLines.orderId, orderId), sql`${pickLines.pickedQtyPcs} > 0`))
    .groupBy(pickLines.orderLineId, pickLines.lotId)
  return rows
    .filter((r): r is typeof r & { lotId: string } => r.lotId !== null)
    .map((r) => ({ orderLineId: r.orderLineId, lotId: r.lotId, qtyPcs: Number(r.qtyPcs) }))
}

/**
 * WHAT PHYSICALLY LEFT THE RACK for each order, from the `sale` ledger rows the pack wrote
 * (`ref_type = 'pack'`, `ref_id = <order id>`).
 *
 * // module-boundary: `stock_ledger` is INVENTORY's append-only table (coordination §4 lists
 * `postPick` / `post` / `releaseReservation` / `listReservations` as the warehouse → inventory edge).
 * This is a READ of quantities only — no cost, no rate, nothing `tenant_product_costs` touches — and it
 * is the only source that is right in both cases: an order packed off a picklist and an order a small
 * distributor packed straight off its reservations, which has no `pick_lines` at all. Replace it with
 * `InventoryService.ledgerRowsByReason(tx, …)` when the claims slice adds that method (§3.9).
 */
export async function packedLotsByOrder(
  tx: Db,
  orderIds: readonly string[],
): Promise<Map<string, { lotId: string; qtyPcs: number }[]>> {
  const ids = [...new Set(orderIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      orderId: stockLedger.refId,
      lotId: stockLedger.lotId,
      qtyPcs: sql<number>`-sum(${stockLedger.qtyDelta})`,
    })
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.refType, 'pack'),
        eq(stockLedger.reason, 'sale'),
        inArray(stockLedger.refId, ids),
      ),
    )
    .groupBy(stockLedger.refId, stockLedger.lotId)
  const out = new Map<string, { lotId: string; qtyPcs: number }[]>()
  for (const row of rows) {
    if (row.orderId === null) continue
    const qtyPcs = Number(row.qtyPcs)
    if (qtyPcs <= 0) continue
    const group = out.get(row.orderId) ?? []
    group.push({ lotId: row.lotId, qtyPcs })
    out.set(row.orderId, group)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// load sheets

export function toLoadSheetSummary(
  row: LoadSheetRow,
  regNo: string | null,
  orderCount: number,
): LoadSheetSummary {
  return {
    id: row.id,
    status: row.status,
    sheetDate: row.sheetDate,
    tripId: row.tripId,
    fromLocationId: row.fromLocationId,
    toLocationId: row.toLocationId,
    vehicleRegNo: regNo,
    orderCount,
    expectedPackages: row.expectedPackages,
    countedPackages: row.countedPackages,
    varianceNote: row.varianceNote,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    pinVerifiedBy: row.pinVerifiedBy,
    loadValuePaise: row.loadValuePaise ?? 0,
    ewbRequired: row.ewbRequired,
    ewbNo: row.ewbNo,
    challanNo: row.challanNo,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

export interface LoadSheetDeps {
  orders: OrdersService
  invoiceRefs: (tx: Db, ids: readonly string[]) => Promise<Map<string, InvoiceRef>>
  seller: (tx: Db) => Promise<SellerBranding>
}

/** The load-out sheet: its orders in the order the caller loaded them, its lots, and its challan. */
export async function loadSheetDetail(
  tx: Db,
  row: LoadSheetRow,
  deps: LoadSheetDeps,
): Promise<LoadSheetDetail> {
  const regNos = await vehicleRegNos(tx, [row.toLocationId])
  const orderRows = await deps.orders.fulfilmentOrders(tx, row.orderIds)
  const byOrderId = new Map(orderRows.map((o) => [o.orderId, o]))
  const packs =
    row.orderIds.length === 0
      ? []
      : await tx
          .select()
          .from(packConfirmations)
          .where(inArray(packConfirmations.orderId, row.orderIds))
  const packByOrder = new Map(packs.map((p) => [p.orderId, p]))
  const invoices = await deps.invoiceRefs(
    tx,
    packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
  )
  const orders: LoadSheetOrder[] = row.orderIds.map((orderId, index) => {
    const order = byOrderId.get(orderId)
    const pack = packByOrder.get(orderId)
    const invoice = pack?.invoiceId ? invoices.get(pack.invoiceId) : undefined
    return {
      orderId,
      orderNo: order?.orderNo ?? null,
      retailerId: order?.retailerId ?? orderId,
      retailerName: order?.retailerName ?? '',
      invoiceId: pack?.invoiceId ?? null,
      invoiceNo: invoice?.invoiceNo ?? null,
      packages: pack?.packages ?? 0,
      // The caller loads last stop first (coordination §4 item 3); the position on the sheet IS the
      // sequence. Warehouse never reads `trip_stops` — that would make it depend on delivery.
      stopSequence: index + 1,
    }
  })
  const challan = await challanOfSheet(tx, row.id, deps.seller)
  return {
    ...toLoadSheetSummary(row, regNos.get(row.toLocationId) ?? null, row.orderIds.length),
    orders,
    lots: await loadSheetLots(tx, row),
    challan,
  }
}

/** The packed orders' pieces merged with the loose van stock, consolidated per lot. */
export async function loadSheetLots(tx: Db, row: LoadSheetRow): Promise<LoadSheetLot[]> {
  const packed = await packedLotsByOrder(tx, row.orderIds)
  const byLot = new Map<string, { qtyPcs: number; source: 'order' | 'van' }>()
  for (const entries of packed.values()) {
    for (const entry of entries) {
      const existing = byLot.get(entry.lotId)
      byLot.set(entry.lotId, {
        qtyPcs: (existing?.qtyPcs ?? 0) + entry.qtyPcs,
        source: existing?.source ?? 'order',
      })
    }
  }
  for (const van of row.vanStock) {
    const existing = byLot.get(van.lotId)
    byLot.set(van.lotId, {
      qtyPcs: (existing?.qtyPcs ?? 0) + van.qtyPcs,
      source: existing?.source ?? 'van',
    })
  }
  const lots = await loadLots(tx, [...byLot.keys()])
  const variants = await loadVariantInfo(
    tx,
    [...lots.values()].map((l) => l.variantId),
  )
  const out: LoadSheetLot[] = []
  for (const [lotId, entry] of byLot) {
    const lot = lots.get(lotId)
    if (!lot) continue
    const variant = variants.get(lot.variantId)
    const caseSize = lot.caseSize ?? variant?.sellCaseSize ?? null
    out.push({
      lotId,
      variantId: lot.variantId,
      variantName: variant?.variantName ?? '',
      batchNo: lot.batchNo === '' ? null : lot.batchNo,
      expiryDate: lot.expiryDate,
      qtyPcs: entry.qtyPcs,
      caseSize,
      ...casesAndLoose(entry.qtyPcs, caseSize),
      source: entry.source,
    })
  }
  return out.sort(
    (a, b) => a.variantName.localeCompare(b.variantName) || (a.lotId < b.lotId ? -1 : 1),
  )
}

// ---------------------------------------------------------------------------------------------------------------
// delivery challans

export function toChallanSummary(row: ChallanRow): DeliveryChallanSummary {
  return {
    id: row.id,
    challanNo: row.challanNo,
    seriesCode: row.seriesCode,
    fy: row.fy,
    challanDate: row.challanDate,
    loadSheetId: row.loadSheetId,
    fromLocationId: row.fromLocationId,
    toLocationId: row.toLocationId,
    vehicleNo: row.vehicleNo,
    valuePaise: row.valuePaise,
    gstPaise: row.loadValueGstPaise,
    ewbNo: row.ewbNo,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt.toISOString(),
  }
}

/**
 * Everything GST Rule 55 prints, including the DISTRIBUTOR's own name and logo — the challan is a
 * white-labelled document like the invoice (docs/17 §D6), so the seller block comes from billing's one
 * `tenant_settings` loader rather than a second copy here.
 */
export async function challanDetail(
  tx: Db,
  row: ChallanRow,
  seller: (tx: Db) => Promise<SellerBranding>,
): Promise<DeliveryChallan> {
  const lots = await loadLots(
    tx,
    row.lines.map((l) => l.lotId),
  )
  const variants = await loadVariantInfo(
    tx,
    row.lines.map((l) => l.variantId),
  )
  const lines: DeliveryChallanLine[] = row.lines.map((line) => {
    const lot = lots.get(line.lotId)
    const variant = variants.get(line.variantId)
    const caseSize = lot?.caseSize ?? variant?.sellCaseSize ?? null
    return {
      variantId: line.variantId,
      variantName: variant?.variantName ?? '',
      hsnCode: variant?.hsnCode ?? null,
      lotId: line.lotId,
      batchNo: lot ? (lot.batchNo === '' ? null : lot.batchNo) : null,
      qtyPcs: line.qtyPcs,
      caseSize,
      ...casesAndLoose(line.qtyPcs, caseSize),
      taxableValuePaise: line.taxableValuePaise,
      gstBps: line.gstBps,
    }
  })
  return {
    ...toChallanSummary(row),
    seller: await seller(tx),
    lines,
    pdfObjectKey: row.pdfObjectKey,
  }
}

export async function challanOfSheet(
  tx: Db,
  loadSheetId: string,
  seller: (tx: Db) => Promise<SellerBranding>,
): Promise<DeliveryChallan | null> {
  const [row] = await tx
    .select()
    .from(deliveryChallans)
    .where(eq(deliveryChallans.loadSheetId, loadSheetId))
    .orderBy(asc(deliveryChallans.id))
    .limit(1)
  return row ? challanDetail(tx, row, seller) : null
}
