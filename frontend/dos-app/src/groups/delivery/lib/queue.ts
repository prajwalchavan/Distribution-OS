/**
 * The write path with no signal — putting a doorstep fact into the outbox.
 *
 * `backend/libs/core/src/modules/delivery/delivery.sync.ts` decides exactly what a crew phone may
 * push, and this file sends that and nothing else:
 *
 *   `trip_stops`  PATCH { state: started | arrived | failed, occurred_at, lat, lng, failure_* }
 *   `deliveries`  PUT   the doorstep write, with its LINES and its PROOF inline
 *   `receipts`    PUT   money taken at the door, carrying `trip_id`
 *
 * Every op maps onto the same transaction-scoped method the online procedure uses, so an offline
 * delivery and an online one cannot drift apart: the server re-derives the outcome from the lines,
 * raises the one credit note, moves the order and the stop, and posts the receipt through
 * `ReceivablesService` exactly as it would have. A business refusal comes back as a rejection in the
 * tray (2xx + `sync_errors`, ADR 0007), never as a 4xx that would wedge the queue behind an op it can
 * never get past.
 *
 * `enqueue` also writes the row into the device's own table, so the screen repaints on the instant —
 * UX-00 §9.4: "every tap persists on the instant; there is no Save step".
 */
import { useOutbox } from '@dos/offline/react'
import { uuidv7 } from '@dos/domain'
import { useCallback } from 'react'

import type { DeliveryLineReason, PodKind } from '@dos/contracts'

import type { LocalDelivery, LocalStop } from './local'
import type { ProofMimeType } from './proof'

/**
 * The `updated_at` the device holds, as an instant `sync.upload` will actually accept.
 *
 * `sync.pull` hands a device Postgres's own text form — `2026-09-05 07:12:11.711714+05:30`, a SPACE
 * where ISO-8601 puts a `T` — and `SyncOpSchema.baseUpdatedAt` is `z.iso.datetime({ offset: true })`,
 * which refuses it. A device echoing back the timestamp it was given therefore gets a 400, and a 400
 * is the one answer `/sync/upload` must never give (ADR 0007): the outbox releases the batch, retries
 * for ever, and every write queued behind it is stuck too. Converting through `Date` keeps the same
 * INSTANT — which is all the last-writer-wins veto compares — and gives the schema the shape it asks
 * for. Found and fixed in the warehouse app; the two halves of one protocol still disagree about the
 * format, which is a backend item, not a frontend one.
 */
function isoInstant(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

// ---------------------------------------------------------------------------
// trip_stops — the three moves a device may make
// ---------------------------------------------------------------------------

export interface StopMoveInput {
  stop: LocalStop
  state: 'started' | 'arrived' | 'failed'
  lat?: number | undefined
  lng?: number | undefined
  failureReason?: string | undefined
  failureNote?: string | undefined
  deviceId: string
}

/**
 * A stop moved on the phone. `occurred_at` is the moment the DRIVER tapped, not the moment the batch
 * reaches the office: an out-of-order replay whose `occurredAt` is older than what is stored answers
 * the stored row unchanged rather than a 409 (docs/07 §7.3), which only works if the app sends the
 * real instant.
 */
export function useMoveStop(): (input: StopMoveInput) => Promise<void> {
  const outbox = useOutbox()
  return useCallback(
    async ({ stop, state, lat, lng, failureReason, failureNote, deviceId }: StopMoveInput) => {
      const base = isoInstant(stop.updated_at)
      const at = new Date().toISOString()
      await outbox.enqueue({
        table: 'trip_stops',
        id: stop.id,
        op: 'PATCH',
        ...(base === undefined ? {} : { baseUpdatedAt: base }),
        data: {
          state,
          occurred_at: at,
          device_id: deviceId,
          ...(state === 'started' ? { started_at: at } : {}),
          ...(state === 'arrived' ? { arrived_at: at } : {}),
          ...(lat === undefined ? {} : { lat, arrived_lat: lat }),
          ...(lng === undefined ? {} : { lng, arrived_lng: lng }),
          ...(failureReason === undefined
            ? {}
            : { failure_reason: failureReason, completed_at: at }),
          ...(failureNote === undefined || failureNote === '' ? {} : { failure_note: failureNote }),
        },
      })
    },
    [outbox],
  )
}

// ---------------------------------------------------------------------------
// deliveries — the doorstep write
// ---------------------------------------------------------------------------

export interface QueuedDeliveryLine {
  id: string
  invoiceLineId: string
  deliveredQtyPcs: number
  returnedQtyPcs: number
  returnedSaleable: boolean
  reason?: DeliveryLineReason | undefined
}

export interface QueuedPod {
  id: string
  kind: PodKind
  /** From `files.uploadUrl` when the bytes went to a bucket; never both this and `contentBase64`. */
  objectKey?: string | undefined
  mimeType?: ProofMimeType | undefined
  contentBase64?: string | undefined
  payload?: Record<string, unknown> | undefined
  lat?: number | undefined
  lng?: number | undefined
}

export interface RecordDeliveryInput {
  /** The PLANNED delivery row created with the stop, or a fresh client id for a bill added at the door. */
  id: string
  tripId: string
  stopId: string
  invoiceId: string
  retailerId: string
  orderId: string | null
  receiverName?: string | undefined
  note?: string | undefined
  lines: readonly QueuedDeliveryLine[]
  pod: readonly QueuedPod[]
  deviceId: string
  /** The row the device already holds, when there is one — for the last-writer-wins veto. */
  existing?: LocalDelivery | null | undefined
}

/**
 * ONE op for the whole doorstep fact: header, lines and proof together.
 *
 * `delivery.sync.ts` reads `lines` and `pod` off the SAME op — "a header without its lines has no
 * outcome" — so `delivery_lines` and `pod_evidence` have no handler of their own and this must never
 * be split into three. The bytes of a photo ride inline because `files.uploadUrl` answers
 * `inline: true` on the local object-storage driver and, more to the point, because a phone with no
 * signal has nowhere to PUT them; the capture path compresses to ≤ 1600 px / ~200 KB first
 * (UX-00 §8.2).
 */
export function useQueueDelivery(): (input: RecordDeliveryInput) => Promise<void> {
  const outbox = useOutbox()
  return useCallback(
    async (input: RecordDeliveryInput) => {
      const base = isoInstant(input.existing?.updated_at)
      const at = new Date().toISOString()
      await outbox.enqueue({
        table: 'deliveries',
        id: input.id,
        op: 'PUT',
        ...(base === undefined ? {} : { baseUpdatedAt: base }),
        data: {
          trip_id: input.tripId,
          stop_id: input.stopId,
          invoice_id: input.invoiceId,
          retailer_id: input.retailerId,
          order_id: input.orderId,
          delivered_at: at,
          device_id: input.deviceId,
          ...(input.receiverName === undefined || input.receiverName === ''
            ? {}
            : { receiver_name: input.receiverName }),
          ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
          lines: input.lines.map((line) => ({
            id: line.id,
            invoice_line_id: line.invoiceLineId,
            delivered_qty_pcs: line.deliveredQtyPcs,
            returned_qty_pcs: line.returnedQtyPcs,
            returned_saleable: line.returnedSaleable,
            ...(line.reason === undefined ? {} : { reason: line.reason }),
          })),
          pod: input.pod.map((proof) => ({
            id: proof.id,
            kind: proof.kind,
            ...(proof.objectKey === undefined ? {} : { object_key: proof.objectKey }),
            ...(proof.contentBase64 === undefined
              ? {}
              : {
                  inline: {
                    mimeType: proof.mimeType ?? 'image/jpeg',
                    contentBase64: proof.contentBase64,
                  },
                }),
            ...(proof.payload === undefined ? {} : { payload: proof.payload }),
            ...(proof.lat === undefined ? {} : { lat: proof.lat }),
            ...(proof.lng === undefined ? {} : { lng: proof.lng }),
            captured_at: at,
          })),
        },
      })
    },
    [outbox],
  )
}

// ---------------------------------------------------------------------------
// receipts — money at the door with no signal
// ---------------------------------------------------------------------------

export interface QueueReceiptInput {
  tripId: string
  retailerId: string
  mode: 'cash' | 'upi' | 'cheque'
  amountPaise: number
  reference?: string | undefined
  chequeDate?: string | undefined
  bankName?: string | undefined
  /** The crew's paper book number: with `deviceId` it is the offline dedupe key of the receipt. */
  clientReceiptNo?: string | undefined
  note?: string | undefined
  deviceId: string
  receivedBy: string | null
}

/**
 * The offline half of "take money at the door", and the one place this app is honestly narrower than
 * the online path.
 *
 * `delivery.collections.record` writes the receipt AND the trip's `collections` row in one
 * transaction. `collections` is not a writable table in the delivery manifest (it is registered as a
 * sync HANDLER but is absent from `SYNC_PULL_TABLES`, so `writable` can never be true and
 * `engine.enqueue` refuses it by name), so with no signal the app queues the RECEIPT — which the
 * receivables handler posts against the trip, allocating oldest bill first, cash to the van's cash
 * account, exactly as the online call would. What is missing until the backend publishes
 * `collections` is the trip's own collection row, which is what `trips.settlementPreview` adds up.
 * The collect screen says so in one line rather than letting a driver find out at check-in.
 *
 * The receipt NUMBER is the office's; the crew's paper book number is what carries identity until
 * then, which is why it is offered on the screen and dedupes the receipt server-side.
 */
export function useQueueReceipt(): (input: QueueReceiptInput) => Promise<string> {
  const outbox = useOutbox()
  return useCallback(
    async (input: QueueReceiptInput) => {
      const id = uuidv7()
      await outbox.enqueue({
        table: 'receipts',
        id,
        op: 'PUT',
        data: {
          retailer_id: input.retailerId,
          trip_id: input.tripId,
          mode: input.mode,
          amount_paise: input.amountPaise,
          received_at: new Date().toISOString(),
          received_by: input.receivedBy,
          device_id: input.deviceId,
          status: 'collected',
          ...(input.reference === undefined || input.reference === ''
            ? {}
            : { reference: input.reference }),
          ...(input.chequeDate === undefined ? {} : { cheque_date: input.chequeDate }),
          ...(input.bankName === undefined || input.bankName === ''
            ? {}
            : { bank_name: input.bankName }),
          ...(input.clientReceiptNo === undefined || input.clientReceiptNo === ''
            ? {}
            : { client_receipt_no: input.clientReceiptNo }),
          ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
        },
      })
      return id
    },
    [outbox],
  )
}
