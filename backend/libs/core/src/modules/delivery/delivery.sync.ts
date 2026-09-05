import type { StopFailureReason, SyncOp } from '@dos/contracts'
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
import { lockTrip } from './delivery.internals.js'
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

/** Zod's own message when a device row is malformed — the app shows it in the tray. */
function parsed<T>(
  result: { success: true; data: T } | { success: false; error: { message: string } },
): T {
  if (result.success) return result.data
  throw new SyncRejection('row_invalid', result.error.message.slice(0, 500))
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

/** `collections`: PUT — the receipt and the collection row, one fact (docs/23 §5.4). */
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

function podFromDevice(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id: p.id,
    kind: p.kind,
    objectKey: str(p.object_key),
    payload: p.payload,
    lat: typeof p.lat === 'number' ? p.lat : undefined,
    lng: typeof p.lng === 'number' ? p.lng : undefined,
    capturedAt: str(p.captured_at),
  }
}
