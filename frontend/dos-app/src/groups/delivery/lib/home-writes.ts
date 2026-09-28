/**
 * The three writes the home makes from a card — "I am here", "Delivered, all items" and "Take money" —
 * as hooks that return one async step each.
 *
 * NOTHING HERE IS A NEW WRITE (founder, 2026-09-28: "the business logic is not rewritten"). Each step is
 * the call the stop (D3), the door (D4) or the money (D5) screen already makes, built with the same
 * functions (`door-writes.ts`) and sent through the same paths:
 *
 *   arrive       `useMoveStop` → one `trip_stops` PATCH in the outbox, with the one fix `arrivalFix`
 *                takes, exactly as D3's "I am at the shop". Works with no signal.
 *   deliverAll   for each open bill of the stop, a FULL delivery: `deliveryLinePayload` with no entries
 *                (every piece goes in), `arrivalGeoProof`, then `recordOrSave` — `deliveries.record`
 *                with a signal, the SAME delivery as one `deliveries` op when there is none or the
 *                office never answers (DOS-056). With a signal the office's copy of each order is read
 *                first and a bill the office would refuse is never written (DOS-148, D4's own gate).
 *   takeMoney    `collections.record` with a signal, one `receipts` op without — D5's own two halves.
 *
 * After a write the office answered, the phone pulls (`pullAfterDoorstepWrite`, DOS-063) so the card
 * changes in place; a write kept on the phone changes the card on the instant, because `enqueue`
 * writes the device's own row.
 */
import { useApi, useMutation } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import { uuidv7 } from '@dos/domain'
import { location as platformLocation } from '@dos/ui/platform'
import { useCallback } from 'react'

import { deviceId } from '../../../api'
import { doorstepOrderBlock, pullAfterDoorstepWrite, type DoorstepOrderBlock } from './at-the-door'
import {
  arrivalFix,
  arrivalGeoProof,
  collectionRecordInput,
  deliveryLinePayload,
  deliveryRecordInput,
  queuedDelivery,
  queuedReceipt,
  receiptNumber,
  type DeliveryLinePayload,
  type DoorMoney,
} from './door-writes'
import { recordOrSave } from './doorstep'
import type { LocalDelivery, LocalInvoiceLine, LocalStop } from './local'
import { useMoveStop, useQueueDelivery, useQueueReceipt, type QueuedPod } from './queue'
import { useMyUserId } from './ui'

// ---------------------------------------------------------------------------
// I am here
// ---------------------------------------------------------------------------

export function useArrive(): (stop: LocalStop) => Promise<void> {
  const moveStop = useMoveStop()
  return useCallback(
    async (stop: LocalStop) => {
      const fix = await arrivalFix(() => platformLocation.current())
      await moveStop({ stop, state: 'arrived', deviceId: deviceId(), ...fix })
    },
    [moveStop],
  )
}

// ---------------------------------------------------------------------------
// Delivered, all items
// ---------------------------------------------------------------------------

/** One bill the tap records in full: its planned `deliveries` row and every line of it on this phone. */
export interface FullBill {
  delivery: LocalDelivery
  lines: readonly LocalInvoiceLine[]
}

export type DeliverAllOutcome =
  /** Every bill is recorded: `office` of them at the office, `phone` of them kept for the outbox. */
  | { kind: 'done'; office: number; phone: number; creditNotes: string[] }
  /** The office's copy of an order says it is not on this van; NOTHING was written. */
  | { kind: 'notOnVan'; block: DoorstepOrderBlock }
  /** The office refused a bill; the bills before it are recorded, this one and the rest are not. */
  | { kind: 'refused'; message: string; office: number; phone: number }

export function useDeliverAll(): (
  stop: LocalStop,
  bills: readonly FullBill[],
) => Promise<DeliverAllOutcome> {
  const api = useApi()
  const status = useSyncStatus()
  const engine = useSyncEngine()
  const queueDelivery = useQueueDelivery()

  const record = useMutation(
    (input: { delivery: LocalDelivery; lines: DeliveryLinePayload[]; pod: QueuedPod[] }, meta) =>
      api.api.delivery.deliveries.record(
        deliveryRecordInput({
          idempotencyKey: meta.idempotencyKey,
          delivery: input.delivery,
          fallbackId: meta.id,
          receiver: '',
          note: '',
          deliveredAt: new Date().toISOString(),
          deviceId: deviceId(),
          lines: input.lines,
          pod: input.pod,
        }),
      ),
    { invalidates: [['trip'], ['stops']] },
  )
  const { mutateAsync } = record
  const online = status.online

  return useCallback(
    async (stop: LocalStop, bills: readonly FullBill[]): Promise<DeliverAllOutcome> => {
      /*
       * DOS-148 — WHAT THE OFFICE HAS EACH ORDER AS, before anything is written. With no signal this
       * answers nothing and the office still refuses at the door, exactly as on D4: the phone never
       * refuses more than the server would. A read that fails is not a refusal either.
       */
      if (online) {
        const states = await Promise.all(
          bills.map(async ({ delivery }) =>
            delivery.order_id === null
              ? null
              : api.api.orders
                  .get({ id: delivery.order_id })
                  .then((answer) => answer.item.state as string)
                  .catch(() => null),
          ),
        )
        for (const state of states) {
          const block = doorstepOrderBlock(state, 'delivered')
          if (block !== null) return { kind: 'notOnVan', block }
        }
      }

      let office = 0
      let phone = 0
      const creditNotes: string[] = []
      for (const bill of bills) {
        /* No entries: every piece on the bill goes in — D4's own default, recorded as it stands. */
        const lines = deliveryLinePayload(bill.lines, {}, uuidv7)
        const pod = arrivalGeoProof(stop, uuidv7)
        try {
          const result = await recordOrSave({
            online,
            send: () => mutateAsync({ delivery: bill.delivery, lines, pod }),
            save: () =>
              queueDelivery(
                queuedDelivery({
                  delivery: bill.delivery,
                  receiver: '',
                  note: '',
                  lines,
                  pod,
                  deviceId: deviceId(),
                }),
              ),
          })
          if (result.via === 'office') {
            office += 1
            const note = result.value.item.creditNote?.creditNoteNo ?? null
            if (note !== null) creditNotes.push(note)
          } else {
            phone += 1
          }
        } catch (thrown) {
          if (office > 0) void pullAfterDoorstepWrite(engine, 'delivery recorded')
          return {
            kind: 'refused',
            message: thrown instanceof Error ? thrown.message : String(thrown),
            office,
            phone,
          }
        }
      }
      if (office > 0) void pullAfterDoorstepWrite(engine, 'delivery recorded')
      return { kind: 'done', office, phone, creditNotes }
    },
    [api, online, engine, mutateAsync, queueDelivery],
  )
}

// ---------------------------------------------------------------------------
// Take money
// ---------------------------------------------------------------------------

export type TakeMoneyOutcome =
  | { kind: 'office'; no: string }
  | { kind: 'phone'; no: string }
  | { kind: 'refused'; message: string }

export function useTakeMoney(): (stop: LocalStop, money: DoorMoney) => Promise<TakeMoneyOutcome> {
  const api = useApi()
  const status = useSyncStatus()
  const engine = useSyncEngine()
  const queueReceipt = useQueueReceipt()
  const myUserId = useMyUserId()

  const collect = useMutation(
    (input: { stop: LocalStop; money: DoorMoney }, meta) =>
      api.api.delivery.collections.record(
        collectionRecordInput({
          idempotencyKey: meta.idempotencyKey,
          id: meta.id,
          receiptId: uuidv7(),
          stop: input.stop,
          money: input.money,
          /* No tag from the home: untagged money goes oldest bill first, and the sheet says so. */
          allocations: null,
          collectedAt: new Date().toISOString(),
          deviceId: deviceId(),
        }),
      ),
    { invalidates: [['trip'], ['settlement'], ['collections'], ['outstanding']] },
  )
  const { mutateAsync } = collect
  const online = status.online

  return useCallback(
    async (stop: LocalStop, money: DoorMoney): Promise<TakeMoneyOutcome> => {
      /* D5's own split: with a signal the office numbers the receipt; without, the outbox keeps it. */
      if (online) {
        try {
          const result = await mutateAsync({ stop, money })
          void pullAfterDoorstepWrite(engine, 'payment recorded')
          return {
            kind: 'office',
            no: receiptNumber({
              officeNo: result.receipt.receiptNo,
              bookNo: money.bookNo,
              id: result.receipt.id,
            }),
          }
        } catch (thrown) {
          return {
            kind: 'refused',
            message: thrown instanceof Error ? thrown.message : String(thrown),
          }
        }
      }
      const id = await queueReceipt(
        queuedReceipt({ stop, money, deviceId: deviceId(), receivedBy: myUserId }),
      )
      return { kind: 'phone', no: receiptNumber({ bookNo: money.bookNo, id }) }
    },
    [online, mutateAsync, engine, queueReceipt, myUserId],
  )
}
