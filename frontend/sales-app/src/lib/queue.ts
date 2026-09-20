/**
 * Putting an order into the outbox — the write path with no signal.
 *
 * ADR 0007 and `backend/libs/core/src/modules/orders/orders.sync.ts` between them decide exactly what
 * a device may push, and this file sends that and nothing else:
 *
 *   `sales_orders`      retailer_id · state (`draft`, refused past it) · source · pricing_date_mode
 *                       · note · expected_delivery_date · fulfil_from_location_id
 *   `sales_order_lines` order_id · variant_id · entered_qty · entered_unit
 *
 * NO TOTAL, NO RATE, NO STATE PAST `draft` — the server re-prices the whole order the moment the
 * lines land, because a price is decided against the price lists, the schemes and the bargains AS
 * THEY ARE WHEN IT LANDS, not as this phone last saw them. So the queued order carries the rep's
 * intent and the server carries the money, which is the only division that survives a phone that has
 * been out of signal for a day.
 *
 * What the rep sees in the meantime is the DEVICE's own quote (`src/lib/pricing.ts`), recomputed from
 * the same local lines by the same engine, and every screen marks it as waiting rather than placed.
 */
import { useApi } from '@dos/api-client/react'
import { useAccepted, useOutbox, useSyncEngine, useSyncStatus } from '@dos/offline/react'
import type { EnqueueInput, OutboxRow } from '@dos/offline'
import { useCallback, useEffect } from 'react'

import { deviceId } from '../api'
import type { CatalogItem } from './local'
import type { DraftLine } from './pricing'

export interface QueueOrderInput {
  orderId: string
  retailerId: string
  note: string
  expectedDeliveryDate: string | null
  lines: readonly DraftLine[]
  catalog: Map<string, CatalogItem>
}

/**
 * Queue a draft order and its lines as ONE write, header first.
 *
 * The order of the two matters and is not an implementation detail: `applyLineSync` refuses a line
 * whose order "has not arrived yet", and the outbox drains in sequence, so the header has to be
 * queued before its lines or the whole order comes back as a tray full of rejections.
 *
 * And ONE write, not one per line (DOS-167 ruling 2 (u)): queued one by one, a sign-out that began
 * between the header and its lines refused the lines after the header had landed, and the office got a
 * draft with no lines. `enqueueMany` holds the phone and the office to the whole order or none of it.
 */
export function useEnqueueOrder(): (input: QueueOrderInput) => Promise<void> {
  const outbox = useOutbox()
  return useCallback(
    async (input: QueueOrderInput) => {
      const header: EnqueueInput = {
        table: 'sales_orders',
        id: input.orderId,
        op: 'PUT',
        data: {
          retailer_id: input.retailerId,
          state: 'draft',
          source: 'salesperson',
          pricing_date_mode: 'order',
          note: input.note.trim() === '' ? null : input.note.trim(),
          expected_delivery_date: input.expectedDeliveryDate,
        },
      }
      const lines = input.lines
        .filter((line) => line.qtyPcs > 0)
        .map((line): EnqueueInput => ({
          table: 'sales_order_lines',
          id: line.id,
          op: 'PUT',
          data: {
            order_id: input.orderId,
            variant_id: line.variantId,
            entered_qty: line.enteredQty,
            entered_unit: line.enteredUnit,
          },
        }))
      await outbox.enqueueMany([header, ...lines])
    },
    [outbox],
  )
}

/**
 * Pieces of a line the device wrote itself.
 *
 * A queued line carries what the rep TYPED (`2`, `case`) because that is all the server accepts; the
 * pieces behind it are the tenant's own sell-side pack size, which is on the phone. Once the order
 * lands, `qty_pcs` arrives from the server and this is not used for that row again.
 */
export function piecesOfLine(
  line: { entered_qty: number; entered_unit: string; qty_pcs: number | null },
  caseSize: number,
): number {
  if (line.qty_pcs !== null && line.qty_pcs > 0) return line.qty_pcs
  return line.entered_unit === 'case' ? line.entered_qty * Math.max(1, caseSize) : line.entered_qty
}

/**
 * DOS-086 — THE DRAFT SUBMITS ITSELF THE MOMENT THE WHOLE OF IT HAS REACHED THE OFFICE.
 *
 * An order written in a dead spot goes into the outbox as a `draft`, because that is the only state
 * `orders.sync.ts` accepts from a device: the SO number, the credit check and the stock reservation
 * are the server's to decide and it will not take them from a phone. That is right. What was wrong
 * is what happened next — the draft landed, and then sat there, numberless, until the rep happened
 * to open My orders and press "Submit order" on each one. A rep who forgets has an order the office
 * cannot see, and nothing on any screen says so.
 *
 * So the device finishes what it started, under the SAME `${id}:submit` key the order screen's
 * button uses, and the pull after it brings the number down.
 *
 * TWO THINGS THE FIRST VERSION GOT WRONG, both found in review:
 *
 * 1. IT COULD SUBMIT HALF AN ORDER. `useEnqueueOrder` queues one header and N lines, and the engine
 *    claims at most 50 ops per upload — so a full offline beat can put the header in one batch and
 *    its lines in the next. Firing on the header's acceptance raced the second batch, and a submit
 *    that won left every remaining line refused for ever with `order_not_draft`: a short order at
 *    the shop and rejections in the tray, which the rep pressing the button by hand could never
 *    cause. The gate is now the WHOLE order — `ordersToSubmit` below returns an order only when its
 *    header has landed and NOTHING of that order is still queued, sending or refused — and the next
 *    batch's acceptance runs the sweep again, so the submit simply happens one batch later.
 *
 * 2. IT ONLY FIRED WHILE ONE OF FOUR SCREENS HAPPENED TO BE MOUNTED. `useAccepted` is a live
 *    subscription with no replay, so an order that landed while the rep was on the catalog, the
 *    inbox or Me reached no listener and nothing looked again. There is now a CATCH-UP SWEEP on
 *    mount (and when the engine becomes ready, since the outbox is unreadable before that), reading
 *    the same rule off the outbox the device already keeps: an `acked` header whose order the local
 *    table still calls a `draft` is an order this device queued and nobody submitted.
 *
 * ONE CALL PER ORDER, whichever screens are mounted: the ids are held at module scope rather than in
 * a ref, and claimed before the first `await`, so the beat, My orders and the order screen together
 * make one request. A submit the server refuses (a credit hold, an approval) changes nothing — the
 * order stays a draft with its "Submit order" button, which is exactly where the rep was before, and
 * it is not tried again unasked in this session.
 */
const claimed = new Set<string>()

/** The outbox fields this rule reads — `engine.outbox()` rows, and nothing else. */
export type QueuedOp = Pick<OutboxRow, 'table' | 'rowId' | 'op' | 'status' | 'data'>

/** Which order an op belongs to: a header by its own id, a line by the `order_id` it carries. */
function orderOf(row: QueuedOp): string | null {
  if (row.table === 'sales_orders') return row.rowId
  if (row.table !== 'sales_order_lines') return null
  const orderId: unknown = row.data?.order_id
  return typeof orderId === 'string' ? orderId : null
}

/**
 * The orders whose every queued piece is now at the office.
 *
 * An order qualifies when its header op is `acked` AND no op of that order is still `queued` or
 * `sending` (the second upload batch) or `rejected` (a line the office refused — a short order is
 * the rep's decision, never this hook's). Everything it needs is in the outbox the device keeps, so
 * it is the same answer on a fresh mount as on the acceptance itself.
 */
export function ordersToSubmit(rows: readonly QueuedOp[]): string[] {
  const landed: string[] = []
  const held = new Set<string>()
  for (const row of rows) {
    const orderId = orderOf(row)
    if (orderId === null) continue
    if (row.status !== 'acked') {
      held.add(orderId)
      continue
    }
    if (row.table === 'sales_orders' && row.op === 'PUT') landed.push(orderId)
  }
  return landed.filter((orderId) => !held.has(orderId))
}

/**
 * What the sweep needs, named rather than reached for, so the whole rule is testable in Node — the
 * app's ESLint forbids a renderer in app sources (docs/08 §0), so a test cannot mount the hook here.
 */
export interface LandedDraftDeps {
  /** The device's own outbox, newest state. */
  outbox: () => Promise<readonly QueuedOp[]>
  /** The order's state as the device last pulled it, or null when it has not been pulled yet. */
  orderState: (orderId: string) => Promise<string | null>
  submit: (input: { id: string; idempotencyKey: string; deviceId: string }) => Promise<unknown>
  /** Fetch what the submit just changed — the SO number above all. */
  pull: () => Promise<void>
  deviceId: string
}

/**
 * Submit every draft this device queued that has now landed whole. Returns the ids it submitted,
 * which is what a test reads; nothing on screen depends on the answer.
 */
export async function submitLandedDrafts(deps: LandedDraftDeps): Promise<string[]> {
  const submitted: string[] = []
  for (const orderId of ordersToSubmit(await deps.outbox())) {
    // Claimed with no `await` in between, so two mounted screens cannot both take the same order.
    if (claimed.has(orderId)) continue
    claimed.add(orderId)
    /*
     * The office may already have moved this order on — the rep pressed the button, or the desk
     * confirmed it — in which case the pulled row says so and there is nothing to finish. A row that
     * has not been pulled yet is the normal case straight after the acceptance: this device queued
     * it as a draft and no other state can have reached it, so it is submitted.
     */
    const state = await deps.orderState(orderId)
    if (state !== null && state !== 'draft') continue
    try {
      await deps.submit({
        id: orderId,
        idempotencyKey: `${orderId}:submit`,
        deviceId: deps.deviceId,
      })
      submitted.push(orderId)
      await deps.pull()
    } catch {
      /*
       * Left as a draft on purpose. The office refused the submit (credit, an approval, a state it
       * has already moved past) and the rep's own screen is the place that says so — never a toast
       * over a beat list from a call nobody asked for. The id stays claimed, so a screen change does
       * not turn one refusal into a call on every mount.
       */
    }
  }
  return submitted
}

export function useSubmitAcceptedDrafts(): void {
  const api = useApi()
  const engine = useSyncEngine()
  const ready = useSyncStatus().ready

  const sweep = useCallback(async (): Promise<void> => {
    if (engine === null) return
    await submitLandedDrafts({
      outbox: () => engine.outbox(),
      orderState: async (orderId) => {
        const row = await engine.getRow<{ state?: unknown }>('sales_orders', orderId)
        if (row === null) return null
        return typeof row.state === 'string' ? row.state : null
      },
      submit: (input) => api.api.orders.submit(input),
      pull: () => engine.sync('queued order submitted'),
      deviceId: deviceId(),
    })
  }, [api, engine])

  // The landing itself, and the batch after it: every acceptance asks the whole-order question again.
  useAccepted(() => {
    void sweep()
  })

  // The catch-up: what landed while no screen with this hook was mounted, or before the store opened.
  useEffect(() => {
    if (!ready) return
    void sweep()
  }, [ready, sweep])
}
