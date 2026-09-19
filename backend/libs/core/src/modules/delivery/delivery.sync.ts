import type { CollectionMode, StopFailureReason, SyncOp } from '@dos/contracts'
import {
  PodEvidenceInput,
  RecordCollectionInput,
  RecordDeliveryInput,
  RecordExpenseInput,
} from '@dos/contracts'
import type { Db } from '@dos/db'
import { SyncRejection } from '../sync/index.js'
import type { CollectionsService } from './collections.service.js'
import type { DeliveriesService } from './deliveries.service.js'
import { lockTrip, TRIP_CASH_HANDED_OVER } from './delivery.internals.js'
import type { TripsService } from './trips.service.js'

/**
 * ADR 0007 / docs/07 §7.3 — what the delivery phone pushes after a day with no signal. Every device op
 * maps onto the same transaction-scoped method the online procedure uses, so the rules are written
 * once; every refusal is a `SyncRejection` (2xx plus a `sync_errors` row in the "needs attention"
 * tray), never a 4xx that would wedge the queue. Business faults raised deeper down (an impossible
 * stop transition, a delivered quantity above the bill, a collection on a settled trip) surface as
 * 4xx ORPCErrors, which `SyncService` already turns into rejections. Replays are handled upstream by
 * `sync_ops(tenant, device, op_id)`, and again by each row's own id.
 *
 * `trip_points` is deliberately NOT registered: breadcrumbs have their own endpoint (`/gps/points`,
 * ADR 0012) so they can never queue ahead of a cash receipt.
 *
 * The device column names are snake_case as in the device schema; a `deliveries` op carries its
 * `lines` and `pod` INLINE (the doorstep write is one fact, and a header without its lines has no
 * outcome), so `delivery_lines` has no handler of its own.
 */

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined

function putOnly(op: SyncOp, table: string): void {
  if (op.op !== 'PUT')
    throw new SyncRejection(
      'unsupported_op',
      `${table} accepts PUT from a device, not ${op.op}; a doorstep record is never edited or deleted`,
    )
}

/**
 * A malformed device row, refused in the rule's own sentence — the app shows it in the tray, where
 * Zod 4's `error.message` (the JSON array of issues) is unreadable. A refine (`custom`) or a
 * whole-row issue keeps its message exactly; any other issue names the field it is about
 * (`lines.0.deliveredQtyPcs: …`). Several issues are joined with '; '.
 */
function parsed<T>(
  result:
    | { success: true; data: T }
    | {
        success: false
        error: {
          issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[]
        }
      },
): T {
  if (result.success) return result.data
  const sentence = result.error.issues
    .map((issue) =>
      issue.code === 'custom' || issue.path.length === 0
        ? issue.message
        : `${issue.path.map((segment) => String(segment)).join('.')}: ${issue.message}`,
    )
    .join('; ')
  throw new SyncRejection('row_invalid', sentence.slice(0, 500))
}

/** `trip_stops`: PATCH `{ state: started | arrived | failed, occurred_at, lat, lng, failure_reason, failure_note }`. */
export async function applyStopSync(tx: Db, op: SyncOp, trips: TripsService): Promise<void> {
  if (op.op !== 'PATCH')
    throw new SyncRejection(
      'unsupported_op',
      'a stop is planned by the desk; a device only moves it (PATCH state)',
    )
  const data = op.data ?? {}
  const state = str(data.state)
  const key = `sync:stop:${op.opId}`
  const common = {
    idempotencyKey: key,
    id: op.id,
    occurredAt: str(data.occurred_at) ?? op.clientTime,
    deviceId: str(data.device_id),
  }
  if (state === 'started') {
    await trips.startStopInTx(tx, common)
    return
  }
  if (state === 'arrived') {
    const lat = typeof data.lat === 'number' ? data.lat : undefined
    const lng = typeof data.lng === 'number' ? data.lng : undefined
    await trips.arriveStopInTx(tx, {
      ...common,
      ...(lat === undefined ? {} : { lat }),
      ...(lng === undefined ? {} : { lng }),
    })
    return
  }
  if (state === 'failed') {
    const reason = str(data.failure_reason)
    const allowed: readonly StopFailureReason[] = [
      'shop_closed',
      'refused',
      'no_cash',
      'wrong_address',
      'damaged_goods',
      'other',
    ]
    const failureReason = allowed.find((r) => r === reason)
    if (!failureReason)
      throw new SyncRejection('reason_invalid', `${reason ?? 'no reason'} is not a failure reason`)
    await trips.failStopFromInput(tx, {
      ...common,
      failureReason,
      failureNote: str(data.failure_note),
    })
    return
  }
  throw new SyncRejection(
    'state_not_allowed',
    `a device moves a stop to started, arrived or failed, not ${state ?? 'nothing'}; delivered and partial come from the deliveries op`,
  )
}

/** `deliveries`: PUT with the lines and the proof inline, exactly the shape of `deliveries.record`. */
export async function applyDeliverySync(
  tx: Db,
  op: SyncOp,
  deliveries: DeliveriesService,
): Promise<void> {
  putOnly(op, 'deliveries')
  const data = op.data ?? {}
  const lines = Array.isArray(data.lines) ? data.lines : []
  const input = parsed(
    RecordDeliveryInput.safeParse({
      idempotencyKey: `sync:delivery:${op.opId}`,
      id: op.id,
      tripId: data.trip_id,
      stopId: data.stop_id,
      invoiceId: data.invoice_id,
      receiverName: str(data.receiver_name),
      note: str(data.note),
      deliveredAt: str(data.delivered_at) ?? op.clientTime,
      deviceId: str(data.device_id),
      lines: lines.map((l: Record<string, unknown>) => ({
        id: l.id,
        invoiceLineId: l.invoice_line_id,
        deliveredQtyPcs: l.delivered_qty_pcs,
        returnedQtyPcs: l.returned_qty_pcs ?? 0,
        returnedSaleable: l.returned_saleable ?? true,
        reason: str(l.reason),
      })),
      pod: Array.isArray(data.pod) ? data.pod.map(podFromDevice) : [],
    }),
  )
  await deliveries.recordInTx(tx, input)
}

/** `pod_evidence`: PUT one piece of proof that arrived after the delivery ("proof pending"). */
export async function applyPodSync(
  tx: Db,
  op: SyncOp,
  deliveries: DeliveriesService,
): Promise<void> {
  putOnly(op, 'pod_evidence')
  const data = op.data ?? {}
  const deliveryId = str(data.delivery_id)
  if (!deliveryId)
    throw new SyncRejection('delivery_required', 'the proof does not say which delivery it is for')
  const evidence = parsed(PodEvidenceInput.safeParse(podFromDevice({ ...data, id: op.id })))
  await deliveries.addPodInTx(tx, deliveryId, evidence)
}

/**
 * Money that reaches the office through the `collections` door after its trip has handed its cash over (QA DOS-169,
 * founder answer A, 2026-09-14): cash and a cheque are refused `trip_settled` — the crew hands them to the cashier —
 * in the sentence POST /receipts and the `receipts` op answer, character for character (amendment (l);
 * `TRIP_SETTLED_MESSAGE` in receivables.service.ts). UPI is not money for the cashier: it keeps this door's
 * `trip_not_open`, and a phone's UPI after the settlement reaches the office as a `receipts` op, which accepts it.
 */
const REFUSED_AFTER_SETTLEMENT: ReadonlySet<CollectionMode> = new Set<CollectionMode>([
  'cash',
  'cheque',
])
const TRIP_SETTLED_MESSAGE =
  'this trip has already settled; hand this money to the cashier and record it at the office, not on the trip'

/**
 * `collections`: PUT — the receipt and the collection row, one fact (docs/23 §5.4). No phone queues it: doorstep
 * money goes up as one `receipts` op, and the settlement counts the trip's receipts however they arrived.
 */
export async function applyCollectionSync(
  tx: Db,
  op: SyncOp,
  collections: CollectionsService,
): Promise<void> {
  putOnly(op, 'collections')
  const data = op.data ?? {}
  const input = parsed(
    RecordCollectionInput.safeParse({
      idempotencyKey: `sync:collection:${op.opId}`,
      id: op.id,
      receiptId: data.receipt_id,
      tripId: data.trip_id,
      stopId: str(data.stop_id),
      retailerId: data.retailer_id,
      mode: data.mode,
      amountPaise: data.amount_paise,
      reference: str(data.reference),
      upiVpa: str(data.upi_vpa),
      chequeDate: str(data.cheque_date),
      bankName: str(data.bank_name),
      proofObjectKey: str(data.proof_object_key),
      clientReceiptNo: str(data.client_receipt_no),
      collectedAt: str(data.collected_at) ?? op.clientTime,
      note: str(data.note),
      deviceId: str(data.device_id),
    }),
  )
  const trip = await lockTrip(tx, input.tripId)
  if (TRIP_CASH_HANDED_OVER.has(trip.state) && REFUSED_AFTER_SETTLEMENT.has(input.mode))
    throw new SyncRejection('trip_settled', TRIP_SETTLED_MESSAGE)
  if (trip.state !== 'active' && trip.state !== 'closing')
    throw new SyncRejection(
      'trip_not_open',
      `trip ${trip.tripNo ?? trip.id} is ${trip.state}; money is collected while the trip is out`,
    )
  await collections.collectInTx(tx, trip, { ...input, stopId: input.stopId ?? null })
}

/** `trip_expenses`: PUT. */
export async function applyExpenseSync(
  tx: Db,
  op: SyncOp,
  collections: CollectionsService,
): Promise<void> {
  putOnly(op, 'trip_expenses')
  const data = op.data ?? {}
  const input = parsed(
    RecordExpenseInput.safeParse({
      idempotencyKey: `sync:expense:${op.opId}`,
      id: op.id,
      tripId: data.trip_id,
      kind: data.kind,
      amountPaise: data.amount_paise,
      proofObjectKey: str(data.proof_object_key),
      note: str(data.note),
      incurredAt: str(data.incurred_at) ?? op.clientTime,
      deviceId: str(data.device_id),
    }),
  )
  await collections.recordExpenseInTx(tx, input)
}

/**
 * One device proof entry, in the shape `PodEvidenceInput` validates.
 *
 * `inline` is the photo a phone with no signal carries IN the op (DOS-056; docs/27 §15): the device
 * has nowhere to PUT the bytes, so they ride with the delivery. They are never kept in a row — the
 * handler's `recordInTx` → `writePod` stores them through the files platform (`storeInline`: object
 * storage plus a `file_objects` row, keyed on the delivery the stop really completes) and
 * `pod_evidence` holds only the object key, so no pull ever carries a photo back to a phone. The mime
 * allow-list, the base64 check and the 700 000-character cap are `InlineFileInput`'s.
 */
function podFromDevice(p: Record<string, unknown>): Record<string, unknown> {
  const inline =
    typeof p.inline === 'object' && p.inline !== null
      ? (p.inline as Record<string, unknown>)
      : undefined
  return {
    id: p.id,
    kind: p.kind,
    objectKey: str(p.object_key),
    inline:
      inline === undefined
        ? undefined
        : { mimeType: inline.mimeType, contentBase64: inline.contentBase64 },
    payload: p.payload,
    lat: typeof p.lat === 'number' ? p.lat : undefined,
    lng: typeof p.lng === 'number' ? p.lng : undefined,
    capturedAt: str(p.captured_at),
  }
}
