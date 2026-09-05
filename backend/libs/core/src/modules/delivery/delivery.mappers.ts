import { and, asc, eq, inArray } from 'drizzle-orm'
import type {
  Collection,
  CollectionMode,
  Delivery,
  DeliveryDetail,
  DeliveryLine,
  DeliveryLineReason,
  DeliveryRef,
  LocationConsent,
  PodEvidence,
  PodEvidenceView,
  Stop,
  StopRetailer,
  Trip,
  TripDetail,
  TripExpense,
  TripExpenseKind,
  TripPolicy,
  TripSettlement,
  Vehicle,
  VehicleKind,
} from '@dos/contracts'
import {
  collections,
  creditNotes,
  deliveries,
  deliveryLines,
  type locationConsents,
  podEvidence,
  tripExpenses,
  trips,
  tripSettlements,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import type { InvoiceRef } from '../billing/index.js'
import {
  iso,
  loadVehicles,
  receiptRefs,
  retailerNames,
  signedReadUrl,
  STOP_TERMINAL,
  stopsOf,
  type RetailerRow,
  type StopRow,
  type TripRow,
  type VehicleRow,
} from './delivery.internals.js'

/**
 * Row → wire. Every mapper is money-free beyond the sale totals a crew hands over, and two of them
 * narrow for the RETAILER role: a shop gets an ETA and its own bills, never a coordinate, the crew's
 * cash plan, who delivered or from which phone (docs/17 B, DPDP). RLS has already narrowed the ROWS;
 * the mappers narrow the COLUMNS.
 */

export type DeliveryRow = typeof deliveries.$inferSelect
export type DeliveryLineRow = typeof deliveryLines.$inferSelect
export type PodRow = typeof podEvidence.$inferSelect
export type CollectionRow = typeof collections.$inferSelect
export type ExpenseRow = typeof tripExpenses.$inferSelect
export type SettlementRow = typeof tripSettlements.$inferSelect
export type ConsentRow = typeof locationConsents.$inferSelect

const VEHICLE_KINDS: readonly VehicleKind[] = ['tempo', 'three_wheeler', 'pickup', 'truck', 'bike']
const EXPENSE_KINDS: readonly TripExpenseKind[] = [
  'diesel',
  'toll',
  'parking',
  'loading',
  'food',
  'repair',
  'other',
]
const LINE_REASONS: readonly DeliveryLineReason[] = [
  'refused',
  'damaged',
  'expired',
  'wrong_item',
  'short_loaded',
  'other',
]
const COLLECTION_MODES: readonly CollectionMode[] = ['cash', 'upi', 'cheque']

const isRetailer = (): boolean => currentTenant().actorRole === 'retailer'

/** A row written before the enum existed (a free-text seed) reads as `other`; never a 500 on a list. */
const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

export function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    regNo: row.regNo,
    name: row.name,
    kind: oneOf(row.kind, VEHICLE_KINDS, 'tempo'),
    capacityCases: row.capacityCases,
    locationId: row.locationId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toConsent(row: ConsentRow): LocationConsent {
  return {
    id: row.id,
    userId: row.userId,
    granted: row.granted,
    noticeVersion: row.policyVersion,
    locale: oneOf(row.locale, ['en-IN', 'hi-IN', 'mr-IN'] as const, 'en-IN'),
    grantedAt: row.grantedAt.toISOString(),
    withdrawnAt: iso(row.withdrawnAt),
  }
}

export function toTrip(
  row: TripRow,
  vehicle: VehicleRow | undefined,
  stops: readonly { state: StopRow['state'] }[],
): Trip {
  return {
    id: row.id,
    tripNo: row.tripNo,
    tripDate: row.tripDate,
    vehicleId: row.vehicleId,
    vehicleRegNo: vehicle?.regNo ?? '',
    vehicleLocationId: vehicle?.locationId ?? '',
    driverId: row.driverId,
    helperId: row.helperId,
    state: row.state,
    vanSalesEnabled: row.vanSalesEnabled,
    plannedStops: row.plannedStops,
    stopsCompleted: stops.filter((s) => STOP_TERMINAL.has(s.state)).length,
    startOdometerKm: row.startOdometerKm,
    endOdometerKm: row.endOdometerKm,
    openingCashPaise: row.openingCashPaise,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toDeliveryRef(row: DeliveryRow, invoice: InvoiceRef | undefined): DeliveryRef {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNo: invoice?.invoiceNo ?? null,
    orderId: row.orderId,
    invoiceTotalPaise: invoice?.totalPaise ?? 0,
    outcome: row.outcome,
    deliveredAt: iso(row.deliveredAt),
    creditNoteId: null,
  }
}

export function toStop(
  row: StopRow,
  retailerName: string,
  vehicleRegNo: string | null,
  refs: DeliveryRef[],
): Stop {
  const shop = isRetailer()
  return {
    id: row.id,
    tripId: row.tripId,
    sequence: row.sequence,
    retailerId: row.retailerId,
    retailerName,
    state: row.state,
    failureReason: row.failureReason,
    failureNote: row.failureNote,
    plannedCollectionPaise: shop ? null : row.plannedCollectionPaise,
    etaAt: iso(row.etaAt),
    startedAt: iso(row.startedAt),
    arrivedAt: iso(row.arrivedAt),
    completedAt: iso(row.completedAt),
    arrivedLat: shop ? null : row.arrivedLat,
    arrivedLng: shop ? null : row.arrivedLng,
    vehicleRegNo: shop ? null : vehicleRegNo,
    deliveries: refs,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The shop at the door: where it is, who to call, its terms. No code, tier or credit limit (docs/23 §5.3). */
export function toStopRetailer(row: RetailerRow): StopRetailer {
  return {
    id: row.id,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    address:
      row.address !== null && typeof row.address === 'object' && !Array.isArray(row.address)
        ? (row.address as Record<string, unknown>)
        : null,
    lat: row.lat,
    lng: row.lng,
    gstin: row.gstin,
    paymentTerms: row.paymentTerms,
  }
}

export function toCollection(
  row: CollectionRow,
  retailerName: string,
  receipt: { receiptNo: string | null; reference: string | null } | undefined,
): Collection {
  return {
    id: row.id,
    tripId: row.tripId,
    stopId: row.stopId,
    retailerId: row.retailerId,
    retailerName,
    receiptId: row.receiptId,
    receiptNo: receipt?.receiptNo ?? null,
    mode: oneOf(row.mode, COLLECTION_MODES, 'cash'),
    amountPaise: row.amountPaise,
    reference: receipt?.reference ?? null,
    collectedBy: row.collectedBy,
    collectedAt: row.collectedAt.toISOString(),
  }
}

export function toExpense(row: ExpenseRow): TripExpense {
  return {
    id: row.id,
    tripId: row.tripId,
    kind: oneOf(row.kind, EXPENSE_KINDS, 'other'),
    amountPaise: row.amountPaise,
    proofObjectKey: row.proofObjectKey,
    note: row.note,
    recordedBy: row.recordedBy,
    recordedAt: row.createdAt.toISOString(),
  }
}

export function toSettlement(row: SettlementRow, chequeCollectedPaise: number): TripSettlement {
  return {
    id: row.id,
    tripId: row.tripId,
    expectedCashPaise: row.expectedCashPaise,
    handedOverCashPaise: row.handedOverCashPaise,
    cashVariancePaise: row.cashVariancePaise,
    upiCollectedPaise: row.upiCollectedPaise,
    chequeCollectedPaise,
    expensesPaise: row.expensesPaise,
    stockVariance: row.stockVariance.map((v) => ({
      lotId: v.lotId,
      expectedPcs: v.expectedPcs,
      countedPcs: v.countedPcs,
      deltaPcs: v.countedPcs - v.expectedPcs,
    })),
    hasVariance: row.hasVariance,
    settledBy: row.settledBy,
    settledAt: row.settledAt.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    note: row.note,
  }
}

export function toDeliveryLine(row: DeliveryLineRow): DeliveryLine {
  return {
    id: row.id,
    invoiceLineId: row.invoiceLineId,
    deliveredQtyPcs: row.deliveredQtyPcs,
    returnedQtyPcs: row.returnedQtyPcs,
    returnedSaleable: row.returnedSaleable,
    reason: row.reason === null ? null : oneOf(row.reason, LINE_REASONS, 'other'),
  }
}

export function toDelivery(
  row: DeliveryRow,
  lines: DeliveryLineRow[],
  podKinds: PodRow['kind'][],
  invoice: InvoiceRef | undefined,
  creditNoteId: string | null,
): Delivery {
  const shop = isRetailer()
  const returned = lines.reduce((n, l) => n + l.returnedQtyPcs, 0)
  return {
    id: row.id,
    tripId: row.tripId,
    stopId: row.stopId,
    orderId: row.orderId,
    invoiceId: row.invoiceId,
    invoiceNo: invoice?.invoiceNo ?? null,
    retailerId: row.retailerId,
    outcome: row.outcome,
    deliveredBy: shop ? null : row.deliveredBy,
    deliveredAt: iso(row.deliveredAt),
    receiverName: row.receiverName,
    note: shop ? null : row.note,
    deviceId: shop ? null : row.deviceId,
    shortPcs: returned,
    returnedPcs: returned,
    creditNoteId,
    podKinds: [...new Set(podKinds)],
    createdAt: row.createdAt.toISOString(),
  }
}

export function toPod(row: PodRow): PodEvidence {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    kind: row.kind,
    objectKey: row.objectKey,
    payload:
      row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : null,
    lat: row.lat,
    lng: row.lng,
    capturedAt: row.capturedAt.toISOString(),
  }
}

/** How long a signed POD read URL stays good: fifteen minutes, the storage default (`files.readUrl`). */
export const POD_READ_TTL_SECONDS = 15 * 60

export async function toPodView(row: PodRow): Promise<PodEvidenceView> {
  const base = toPod(row)
  const signed = row.objectKey ? await signedReadUrl(row.objectKey, POD_READ_TTL_SECONDS) : null
  return {
    ...base,
    readUrl: signed?.url ?? null,
    readUrlExpiresAt: signed?.expiresAt ?? null,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// loaders

/** The `deliveries` rows of many stops in one query, grouped by stop. */
export async function deliveriesByStop(
  tx: Db,
  stopIds: readonly string[],
): Promise<Map<string, DeliveryRow[]>> {
  const ids = [...new Set(stopIds)]
  const out = new Map<string, DeliveryRow[]>()
  if (ids.length === 0) return out
  const rows = await tx
    .select()
    .from(deliveries)
    .where(inArray(deliveries.stopId, ids))
    .orderBy(asc(deliveries.id))
  for (const row of rows) {
    const group = out.get(row.stopId) ?? []
    group.push(row)
    out.set(row.stopId, group)
  }
  return out
}

/** The one credit note raised for each of these deliveries (billing's `credit_notes.delivery_id`). */
export async function creditNotesByDelivery(
  tx: Db,
  deliveryIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(deliveryIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: creditNotes.id, deliveryId: creditNotes.deliveryId })
    .from(creditNotes)
    .where(and(inArray(creditNotes.deliveryId, ids), eq(creditNotes.state, 'issued')))
    .orderBy(asc(creditNotes.id))
  const out = new Map<string, string>()
  for (const row of rows)
    if (row.deliveryId && !out.has(row.deliveryId)) out.set(row.deliveryId, row.id)
  return out
}

export async function podKindsByDelivery(
  tx: Db,
  deliveryIds: readonly string[],
): Promise<Map<string, PodRow['kind'][]>> {
  const ids = [...new Set(deliveryIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ deliveryId: podEvidence.deliveryId, kind: podEvidence.kind })
    .from(podEvidence)
    .where(inArray(podEvidence.deliveryId, ids))
  const out = new Map<string, PodRow['kind'][]>()
  for (const row of rows) out.set(row.deliveryId, [...(out.get(row.deliveryId) ?? []), row.kind])
  return out
}

export async function linesByDelivery(
  tx: Db,
  deliveryIds: readonly string[],
): Promise<Map<string, DeliveryLineRow[]>> {
  const ids = [...new Set(deliveryIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select()
    .from(deliveryLines)
    .where(inArray(deliveryLines.deliveryId, ids))
    .orderBy(asc(deliveryLines.id))
  const out = new Map<string, DeliveryLineRow[]>()
  for (const row of rows) out.set(row.deliveryId, [...(out.get(row.deliveryId) ?? []), row])
  return out
}

export interface StopDeps {
  invoiceRefs: (tx: Db, ids: readonly string[]) => Promise<Map<string, InvoiceRef>>
}

/** Stops with their planned/attempted bills, for a trip screen or a stop list page. */
export async function mapStops(
  tx: Db,
  rows: StopRow[],
  deps: StopDeps,
  vehicleRegNoOf: (tripId: string) => string | null,
): Promise<Stop[]> {
  if (rows.length === 0) return []
  const names = await retailerNames(
    tx,
    rows.map((r) => r.retailerId),
  )
  const byStop = await deliveriesByStop(
    tx,
    rows.map((r) => r.id),
  )
  const allDeliveries = [...byStop.values()].flat()
  const invoices = await deps.invoiceRefs(
    tx,
    allDeliveries.map((d) => d.invoiceId),
  )
  const notes = await creditNotesByDelivery(
    tx,
    allDeliveries.map((d) => d.id),
  )
  return rows.map((row) =>
    toStop(
      row,
      names.get(row.retailerId) ?? '',
      vehicleRegNoOf(row.tripId),
      (byStop.get(row.id) ?? []).map((d) => ({
        ...toDeliveryRef(d, invoices.get(d.invoiceId)),
        creditNoteId: notes.get(d.id) ?? null,
      })),
    ),
  )
}

export async function mapDeliveries(
  tx: Db,
  rows: DeliveryRow[],
  deps: StopDeps,
): Promise<Delivery[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [lines, kinds, invoices, notes] = await Promise.all([
    linesByDelivery(tx, ids),
    podKindsByDelivery(tx, ids),
    deps.invoiceRefs(
      tx,
      rows.map((r) => r.invoiceId),
    ),
    creditNotesByDelivery(tx, ids),
  ])
  return rows.map((row) =>
    toDelivery(
      row,
      lines.get(row.id) ?? [],
      kinds.get(row.id) ?? [],
      invoices.get(row.invoiceId),
      notes.get(row.id) ?? null,
    ),
  )
}

export async function loadDeliveryDetail(
  tx: Db,
  row: DeliveryRow,
  deps: StopDeps,
): Promise<DeliveryDetail> {
  const [summary] = await mapDeliveries(tx, [row], deps)
  if (!summary) throw new Error('delivery mapper returned nothing')
  const lines = await tx
    .select()
    .from(deliveryLines)
    .where(eq(deliveryLines.deliveryId, row.id))
    .orderBy(asc(deliveryLines.id))
  const pod = await tx
    .select()
    .from(podEvidence)
    .where(eq(podEvidence.deliveryId, row.id))
    .orderBy(asc(podEvidence.capturedAt), asc(podEvidence.id))
  const note = summary.creditNoteId
    ? (
        await tx.select().from(creditNotes).where(eq(creditNotes.id, summary.creditNoteId)).limit(1)
      )[0]
    : undefined
  return {
    ...summary,
    lines: lines.map(toDeliveryLine),
    pod: await Promise.all(pod.map(toPodView)),
    creditNote: note
      ? {
          id: note.id,
          creditNoteNo: note.creditNoteNo,
          noteDate: note.noteDate,
          reason: note.reason,
          state: note.state,
          totalPaise: note.totalPaise,
        }
      : null,
  }
}

export async function mapCollections(tx: Db, rows: CollectionRow[]): Promise<Collection[]> {
  if (rows.length === 0) return []
  const names = await retailerNames(
    tx,
    rows.map((r) => r.retailerId),
  )
  const refs = await receiptRefs(
    tx,
    rows.map((r) => r.receiptId),
  )
  return rows.map((row) =>
    toCollection(row, names.get(row.retailerId) ?? '', refs.get(row.receiptId)),
  )
}

/** Σ cheque collections of a trip — the settlement row has no cheque column, so it is derived on read. */
export async function chequeCollectedOf(tx: Db, tripId: string): Promise<number> {
  const rows = await tx
    .select({ amountPaise: collections.amountPaise })
    .from(collections)
    .where(and(eq(collections.tripId, tripId), eq(collections.mode, 'cheque')))
  return rows.reduce((n, r) => n + r.amountPaise, 0)
}

export interface TripDetailDeps extends StopDeps {
  loadConfirmed: (tx: Db, tripId: string) => Promise<{ id: string; confirmedAt: string | null }[]>
  policy: (tx: Db) => Promise<TripPolicy>
  vanSalesFlag: (tx: Db) => Promise<boolean>
}

/**
 * Everything the crew's trip screen and the owner's drill-down need in one call. `expectedCashPaise`
 * is recomputed from the tables on every read (docs/20 rule 1); nothing is held in process memory.
 */
export async function loadTripDetail(
  tx: Db,
  trip: TripRow,
  deps: TripDetailDeps,
): Promise<TripDetail> {
  const vehicles = await loadVehicles(tx, [trip.vehicleId])
  const vehicle = vehicles.get(trip.vehicleId)
  const stopRows = await stopsOf(tx, trip.id)
  const stops = await mapStops(tx, stopRows, deps, () => vehicle?.regNo ?? null)
  const collectionRows = await tx
    .select()
    .from(collections)
    .where(eq(collections.tripId, trip.id))
    .orderBy(asc(collections.collectedAt), asc(collections.id))
  const expenseRows = await tx
    .select()
    .from(tripExpenses)
    .where(eq(tripExpenses.tripId, trip.id))
    .orderBy(asc(tripExpenses.id))
  const [settlementRow] = await tx
    .select()
    .from(tripSettlements)
    .where(eq(tripSettlements.tripId, trip.id))
    .limit(1)
  const sheets = await deps.loadConfirmed(tx, trip.id)
  const cash = collectionRows
    .filter((c) => c.mode === 'cash')
    .reduce((n, c) => n + c.amountPaise, 0)
  const cheque = collectionRows
    .filter((c) => c.mode === 'cheque')
    .reduce((n, c) => n + c.amountPaise, 0)
  const expenses = expenseRows.reduce((n, e) => n + e.amountPaise, 0)
  const policy = await deps.policy(tx)
  const flag = await deps.vanSalesFlag(tx)
  return {
    ...toTrip(trip, vehicle, stopRows),
    stops,
    collections: await mapCollections(tx, collectionRows),
    expenses: expenseRows.map(toExpense),
    settlement: settlementRow ? toSettlement(settlementRow, cheque) : null,
    loadConfirmedAt: sheets.map((s) => s.confirmedAt).find((at) => at !== null) ?? null,
    loadSheetIds: sheets.map((s) => s.id),
    vanSalesAllowed: trip.vanSalesEnabled && flag,
    expectedCashPaise: trip.openingCashPaise + cash - expenses,
    policy,
  }
}

/** Stops of one page, each with the plate of its trip, without a per-row vehicle query. */
export async function stopsWithVehicles(tx: Db, rows: StopRow[], deps: StopDeps): Promise<Stop[]> {
  if (rows.length === 0) return []
  const tripIds = [...new Set(rows.map((r) => r.tripId))]
  // A shop cannot see `trips` at all (RLS): the plate is null for it, and the mapper nulls it anyway.
  const tripVehicle = await tx
    .select({ id: trips.id, vehicleId: trips.vehicleId })
    .from(trips)
    .where(inArray(trips.id, tripIds))
  const vehicles = await loadVehicles(
    tx,
    tripVehicle.map((t) => t.vehicleId),
  )
  const plateOfTrip = new Map(
    tripVehicle.map((t) => [t.id, vehicles.get(t.vehicleId)?.regNo ?? null]),
  )
  return mapStops(tx, rows, deps, (tripId) => plateOfTrip.get(tripId) ?? null)
}
