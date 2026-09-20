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
import { useAccepted, useOutbox, useSyncEngine } from '@dos/offline/react'
import type { EnqueueInput } from '@dos/offline'
import { useCallback } from 'react'

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
 * DOS-086 — THE DRAFT SUBMITS ITSELF THE MOMENT IT REACHES THE OFFICE.
 *
 * An order written in a dead spot goes into the outbox as a `draft`, because that is the only state
 * `orders.sync.ts` accepts from a device: the SO number, the credit check and the stock reservation
 * are the server's to decide and it will not take them from a phone. That is right. What was wrong
 * is what happened next — the draft landed, and then sat there, numberless, until the rep happened
 * to open My orders and press "Submit order" on each one. A rep who forgets has an order the office
 * cannot see, and nothing on any screen says so.
 *
 * So the device finishes what it started. `useAccepted` names the row the office has just taken; a
 * `sales_orders` row this app queued is always a draft header (`useEnqueueOrder` writes no other
 * kind), so the second half of the intent — the online `orders.submit`, under the SAME
 * `${id}:submit` key the order screen uses — goes out for it at once, and the pull after it brings
 * the number down.
 *
 * ONE CALL PER ORDER, whichever screens are mounted: the ids in flight are held at module scope
 * rather than in a ref, so the beat, My orders and the order screen together still make one request.
 * A submit the server refuses (a credit hold, an approval) changes nothing — the order stays a draft
 * with its "Submit order" button, which is exactly where the rep was before.
 */
const submitting = new Set<string>()

export function useSubmitAcceptedDrafts(): void {
  const api = useApi()
  const engine = useSyncEngine()
  useAccepted((ops) => {
    for (const op of ops) {
      if (op.table !== 'sales_orders' || op.op !== 'PUT') continue
      const orderId = op.rowId
      if (submitting.has(orderId)) continue
      submitting.add(orderId)
      void api.api.orders
        .submit({ id: orderId, idempotencyKey: `${orderId}:submit`, deviceId: deviceId() })
        .then(
          () => engine?.sync('queued order submitted'),
          /*
           * Left as a draft on purpose. The office refused the submit (credit, an approval, a
           * state it has already moved past) and the rep's own screen is the place that says so —
           * never a toast over a beat list from a call nobody asked for.
           */
          () => undefined,
        )
        .finally(() => {
          submitting.delete(orderId)
        })
    }
  })
}
