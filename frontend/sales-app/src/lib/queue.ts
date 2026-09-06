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
import { useOutbox } from '@dos/offline/react'
import { useCallback } from 'react'

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
 * Queue a draft order and its lines, header first.
 *
 * The order of the two matters and is not an implementation detail: `applyLineSync` refuses a line
 * whose order "has not arrived yet", and the outbox drains in sequence, so the header has to be
 * queued before its lines or the whole order comes back as a tray full of rejections.
 */
export function useEnqueueOrder(): (input: QueueOrderInput) => Promise<void> {
  const outbox = useOutbox()
  return useCallback(
    async (input: QueueOrderInput) => {
      await outbox.enqueue({
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
      })
      for (const line of input.lines) {
        if (line.qtyPcs <= 0) continue
        await outbox.enqueue({
          table: 'sales_order_lines',
          id: line.id,
          op: 'PUT',
          data: {
            order_id: input.orderId,
            variant_id: line.variantId,
            entered_qty: line.enteredQty,
            entered_unit: line.enteredUnit,
          },
        })
      }
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
