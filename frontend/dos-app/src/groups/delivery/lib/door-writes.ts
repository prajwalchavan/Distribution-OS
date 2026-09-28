/**
 * THE DOORSTEP WRITES, BUILT IN ONE PLACE (founder, 2026-09-28: "every app opens on its work").
 *
 * The home now records a full delivery, an arrival and money at the door from the card itself, and the
 * rule for that round is that the business logic is NOT rewritten: the home must write exactly what
 * the stop (D3), the door (D4) and the money (D5) screens write. So what those three screens used to
 * build inline — the delivery lines, the arrival point as proof, the `deliveries.record` input and its
 * outbox twin, the `collections.record` input and its outbox twin, the one fix "I am here" takes — was
 * lifted out of the screens into this file, and BOTH places call it. A change here changes the home and
 * the screen together, which is the point: two copies of a doorstep write are how the office ends up
 * with two different stories about one shop.
 *
 * Pure TypeScript, the pattern `doorstep.ts` and `pod.ts` set: no component, no platform module, no
 * React, so it runs under vitest with no Metro. Ids and the clock are handed in, so a test can pin the
 * exact payload.
 */
import type { CollectionMode, DeliveryLineReason } from '@dos/contracts'

import type { TaggedAllocation } from './allocate'
import type { LocalDelivery, LocalInvoiceLine, LocalStop } from './local'
import type { ProofMimeType } from './proof'
import type { QueueReceiptInput, QueuedPod, RecordDeliveryInput } from './queue'

// ---------------------------------------------------------------------------
// The lines of one bill
// ---------------------------------------------------------------------------

/** Free pieces are delivered and returned like any other piece (`RecordDeliveryInput`'s own rule). */
export function billedPieces(line: Pick<LocalInvoiceLine, 'qty_pcs' | 'free_qty_pcs'>): number {
  return line.qty_pcs + line.free_qty_pcs
}

/** What the driver set on one bill line at the door (D4 keeps one per line while the screen is open). */
export interface DoorLineEntry {
  /** Client id of the `delivery_lines` row; stable so a retry writes the same row. */
  id: string
  deliveredQtyPcs: number
  returnedQtyPcs: number
  returnedSaleable: boolean
  reason: DeliveryLineReason | null
}

/** Exactly `RecordDeliveryInput.lines[]`, so one array serves the online call and the outbox op. */
export interface DeliveryLinePayload {
  id: string
  invoiceLineId: string
  deliveredQtyPcs: number
  returnedQtyPcs: number
  returnedSaleable: boolean
  reason?: DeliveryLineReason
}

/**
 * The lines that go to the office for one bill: the driver's entry where there is one, and THE WHOLE
 * LINE where there is none. That default is what makes "Delivered, all items" on the home the same
 * write as opening D4 and pressing record without touching anything — D4 opens on the likeliest
 * outcome, every piece going in, and this is the rule that says so.
 */
export function deliveryLinePayload(
  lines: readonly LocalInvoiceLine[],
  entries: Readonly<Record<string, DoorLineEntry | undefined>>,
  newId: () => string,
): DeliveryLinePayload[] {
  return lines.map((line) => {
    const entry = entries[line.id]
    const billed = billedPieces(line)
    return {
      id: entry?.id ?? newId(),
      invoiceLineId: line.id,
      deliveredQtyPcs: entry?.deliveredQtyPcs ?? billed,
      returnedQtyPcs: entry?.returnedQtyPcs ?? 0,
      returnedSaleable: entry?.returnedSaleable ?? true,
      ...(entry?.reason === null || entry?.reason === undefined ? {} : { reason: entry.reason }),
    }
  })
}

/**
 * DOS-070 — WHERE THE DRIVER STOOD, AS EVIDENCE, NEVER A BLOCK (the geofence is amber, not a gate).
 *
 * What travels is the ONE fix taken when the crew tapped "I am here" (`trip_stops.arrived_lat/lng`).
 * No arrival fix, no `geo` row — and `geoProofLine` in `at-the-door.ts` says nothing either, so the
 * sentence on D4 and the row in the payload can never disagree.
 */
export function arrivalGeoProof(
  stop: Pick<LocalStop, 'arrived_lat' | 'arrived_lng'> | null | undefined,
  newId: () => string,
): QueuedPod[] {
  return stop?.arrived_lat !== null && stop?.arrived_lat !== undefined && stop.arrived_lng !== null
    ? [{ id: newId(), kind: 'geo', lat: stop.arrived_lat, lng: stop.arrived_lng ?? undefined }]
    : []
}

// ---------------------------------------------------------------------------
// deliveries.record — the online write, and its outbox twin
// ---------------------------------------------------------------------------

/** One piece of proof exactly as `PodEvidenceInput` takes it. */
export interface PodWire {
  id: string
  kind: QueuedPod['kind']
  objectKey?: string
  inline?: { mimeType: ProofMimeType; contentBase64: string }
  payload?: Record<string, unknown>
  lat?: number
  lng?: number
}

/**
 * The proof as the office takes it.
 *
 * `PodEvidenceInput` refines to "a photo or signature carries EXACTLY ONE of objectKey / inline".
 * `storeProof` answers whichever the SERVER asked for, and dropping the `objectKey` half of that answer
 * sent a photo evidence row carrying neither — a 400 on the one write a driver cannot skip, reading
 * "Input validation failed" at a shop door.
 */
export function podWire(pod: readonly QueuedPod[]): PodWire[] {
  return pod.map((one) => ({
    id: one.id,
    kind: one.kind,
    ...(one.objectKey === undefined ? {} : { objectKey: one.objectKey }),
    ...(one.contentBase64 === undefined
      ? {}
      : {
          inline: {
            mimeType: one.mimeType ?? 'image/jpeg',
            contentBase64: one.contentBase64,
          },
        }),
    ...(one.payload === undefined ? {} : { payload: one.payload }),
    ...(one.lat === undefined ? {} : { lat: one.lat }),
    ...(one.lng === undefined ? {} : { lng: one.lng }),
  }))
}

/** `delivery.deliveries.record`'s input, field for field. */
export interface DeliveryRecordWire {
  idempotencyKey: string
  id: string
  tripId: string
  stopId: string
  invoiceId: string
  receiverName?: string
  note?: string
  deliveredAt: string
  deviceId: string
  lines: DeliveryLinePayload[]
  pod: PodWire[]
}

/**
 * The online doorstep write. The OUTCOME is never sent: the office derives it from the lines — every
 * line full is `delivered`, one short is `partial`, all zero is `failed` — so a shortfall and a return
 * can never disagree with the credit note it raises.
 */
export function deliveryRecordInput(input: {
  idempotencyKey: string
  /** The planned `deliveries` row, or null for a bill added at the door (then `fallbackId`). */
  delivery: Pick<LocalDelivery, 'id' | 'trip_id' | 'stop_id' | 'invoice_id'> | null
  fallbackId: string
  receiver: string
  note: string
  deliveredAt: string
  deviceId: string
  lines: DeliveryLinePayload[]
  pod: readonly QueuedPod[]
}): DeliveryRecordWire {
  const receiver = input.receiver.trim()
  const note = input.note.trim()
  return {
    idempotencyKey: input.idempotencyKey,
    id: input.delivery?.id ?? input.fallbackId,
    tripId: input.delivery?.trip_id ?? '',
    stopId: input.delivery?.stop_id ?? '',
    invoiceId: input.delivery?.invoice_id ?? '',
    ...(receiver === '' ? {} : { receiverName: receiver }),
    ...(note === '' ? {} : { note }),
    deliveredAt: input.deliveredAt,
    deviceId: input.deviceId,
    lines: input.lines,
    pod: podWire(input.pod),
  }
}

/**
 * The SAME delivery as one outbox op, for no signal or a call the office never answered (DOS-056):
 * header, lines and proof together, because `delivery.sync.ts` reads them off one op.
 */
export function queuedDelivery(input: {
  delivery: LocalDelivery
  receiver: string
  note: string
  lines: readonly DeliveryLinePayload[]
  pod: readonly QueuedPod[]
  deviceId: string
}): RecordDeliveryInput {
  const row = input.delivery
  return {
    id: row.id,
    tripId: row.trip_id,
    stopId: row.stop_id,
    invoiceId: row.invoice_id,
    retailerId: row.retailer_id,
    orderId: row.order_id,
    receiverName: input.receiver.trim(),
    note: input.note.trim(),
    lines: input.lines.map((line) => ({
      id: line.id,
      invoiceLineId: line.invoiceLineId,
      deliveredQtyPcs: line.deliveredQtyPcs,
      returnedQtyPcs: line.returnedQtyPcs,
      returnedSaleable: line.returnedSaleable,
      reason: line.reason,
    })),
    pod: input.pod,
    deviceId: input.deviceId,
    existing: row,
  }
}

// ---------------------------------------------------------------------------
// collections.record — money at the door, and its outbox twin
// ---------------------------------------------------------------------------

/** Cash, UPI with its UTR, or a cheque (`CollectionModeSchema`, docs/22 §4 D6). */
export type DoorMoneyMode = CollectionMode

/** What the driver typed about one payment. The amount is ALWAYS typed; nothing here pre-fills it. */
export interface DoorMoney {
  mode: DoorMoneyMode
  amountPaise: number
  /** The UPI UTR or the cheque number. */
  reference: string
  /** Sent for a cheque only. */
  chequeDate: string
  bankName: string
  /** The crew's paper book number. */
  bookNo: string
}

/** `delivery.collections.record`'s input, field for field. */
export interface CollectionRecordWire {
  idempotencyKey: string
  id: string
  receiptId: string
  tripId: string
  stopId: string
  retailerId: string
  mode: DoorMoneyMode
  amountPaise: number
  reference?: string
  chequeDate?: string
  bankName?: string
  clientReceiptNo?: string
  allocations?: TaggedAllocation[]
  collectedAt: string
  deviceId: string
  /** DOS-310: the crew has seen that this cheque number stands on another shop's receipt and says it is a different cheque. */
  confirmReference?: true
}

/** A UPI payment needs its UTR and a cheque its number; cash needs neither (`RecordCollectionInput`). */
export function moneyNeedsReference(money: Pick<DoorMoney, 'mode' | 'reference'>): boolean {
  return money.mode !== 'cash' && money.reference.trim() === ''
}

/**
 * The online money write: ONE call, and the receipt, its allocations and the journal happen in one
 * transaction at the office.
 *
 * DOS-062 — "unless tagged". An empty split is not sent at all: the server reads the presence of
 * `allocations` as `strategy: 'explicit'`, and an empty explicit split would allocate nothing rather
 * than falling back to the office's oldest-bill-first rule.
 */
export function collectionRecordInput(input: {
  idempotencyKey: string
  id: string
  receiptId: string
  stop: Pick<LocalStop, 'id' | 'trip_id' | 'retailer_id'> | null
  money: DoorMoney
  allocations: TaggedAllocation[] | null
  collectedAt: string
  deviceId: string
  /** DOS-310: sent only when the crew has confirmed another shop's cheque number on the screen. */
  confirmReference?: boolean
}): CollectionRecordWire {
  const { money } = input
  const reference = money.reference.trim()
  const bank = money.bankName.trim()
  const bookNo = money.bookNo.trim()
  return {
    idempotencyKey: input.idempotencyKey,
    id: input.id,
    receiptId: input.receiptId,
    tripId: input.stop?.trip_id ?? '',
    stopId: input.stop?.id ?? '',
    retailerId: input.stop?.retailer_id ?? '',
    mode: money.mode,
    amountPaise: money.amountPaise,
    ...(reference === '' ? {} : { reference }),
    ...(money.mode === 'cheque' ? { chequeDate: money.chequeDate } : {}),
    ...(bank === '' ? {} : { bankName: bank }),
    ...(bookNo === '' ? {} : { clientReceiptNo: bookNo }),
    ...(input.allocations === null || input.allocations.length === 0
      ? {}
      : { allocations: input.allocations }),
    collectedAt: input.collectedAt,
    deviceId: input.deviceId,
    ...(input.confirmReference === true ? { confirmReference: true as const } : {}),
  }
}

/**
 * The same money with no signal: a `receipts` op carrying `trip_id`, allocated oldest bill first when
 * it lands (queue.ts says what that costs). A tag never travels offline.
 */
export function queuedReceipt(input: {
  stop: Pick<LocalStop, 'trip_id' | 'retailer_id'>
  money: DoorMoney
  deviceId: string
  receivedBy: string | null
}): QueueReceiptInput {
  const { money } = input
  return {
    tripId: input.stop.trip_id,
    retailerId: input.stop.retailer_id,
    mode: money.mode,
    amountPaise: money.amountPaise,
    reference: money.reference.trim(),
    ...(money.mode === 'cheque' ? { chequeDate: money.chequeDate } : {}),
    bankName: money.bankName.trim(),
    clientReceiptNo: money.bookNo.trim(),
    deviceId: input.deviceId,
    receivedBy: input.receivedBy,
  }
}

/** The number a receipt is read out by: the office's, else the crew's book, else the head of its id. */
export function receiptNumber(input: {
  officeNo?: string | null | undefined
  bookNo: string
  id: string
}): string {
  if (input.officeNo !== null && input.officeNo !== undefined && input.officeNo !== '')
    return input.officeNo
  const book = input.bookNo.trim()
  return book === '' ? input.id.slice(0, 8) : book
}

// ---------------------------------------------------------------------------
// "I am here" — one fix, never a block
// ---------------------------------------------------------------------------

/** What `platform.location.current()` answers, narrowed to what an arrival carries. */
export interface ArrivalReading {
  latitude: number
  longitude: number
}

/**
 * The fix an arrival carries, or nothing. It is evidence for the geofence — never a block
 * (`ArriveStopOutput.distanceM` is amber beyond the tenant's `geofenceMetres`) — so a phone that
 * refuses, times out or has no GPS still arrives. It is asked for on the tap, never on mount: UX-00
 * §12 has no permission prompts in front of a task.
 */
export async function arrivalFix(
  locate: () => Promise<ArrivalReading | null>,
): Promise<{ lat?: number; lng?: number }> {
  const fix = await locate().catch(() => null)
  return fix === null ? {} : { lat: fix.latitude, lng: fix.longitude }
}
