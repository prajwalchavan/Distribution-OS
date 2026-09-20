import type { z } from 'zod'
import type { OrdersRegisterInput } from '@dos/contracts'
import { businessDate } from '@dos/domain'
import type { Db } from '@dos/db'
import { listOrders } from './orders.internals.js'

/**
 * The orders register (DOS-014): the orders LIST, flattened one row per order for a CSV.
 *
 * "Export CSV" on the owner's Orders screen used to queue the daily-sales register, because there was no
 * orders register to queue. The owner brief says every list is exportable, so this is that list — read
 * through `listOrders`, the same query and the same reach rules the screen uses, never a second join of
 * `sales_orders` from reporting (coordination §4: a register is built from the owning module's read).
 *
 * A plain exported function, so the worker's renderer reaches it without Nest DI; reporting names the
 * shop and the rep beside the ids it returns.
 */

export interface OrderRegisterRow {
  orderId: string
  orderNo: string | null
  /** The IST business date the order was placed on — the date the window filtered by. */
  orderDate: string
  retailerId: string
  state: string
  source: string
  salespersonId: string | null
  paymentTerms: string
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  /** The gates the order was held by, space-joined, so one CSV cell holds them all. */
  approvalFlags: string
  expectedDeliveryDate: string | null
  cancelReason: string | null
}

export async function orderRegisterRows(
  tx: Db,
  input: z.infer<typeof OrdersRegisterInput>,
): Promise<{ rows: OrderRegisterRow[]; nextCursor: string | null }> {
  const page = await listOrders(tx, {
    from: input.from,
    to: input.to,
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.states ? { states: input.states } : {}),
    ...(input.retailerId ? { retailerId: input.retailerId } : {}),
    ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
    ...(input.q ? { q: input.q } : {}),
  })
  return {
    rows: page.items.map((order) => ({
      orderId: order.id,
      orderNo: order.orderNo,
      orderDate: businessDate(new Date(order.createdAt)).date,
      retailerId: order.retailerId,
      state: order.state,
      source: order.source,
      salespersonId: order.salespersonId,
      paymentTerms: order.paymentTerms,
      subtotalPaise: order.subtotalPaise,
      discountPaise: order.discountPaise,
      taxPaise: order.taxPaise,
      roundOffPaise: order.roundOffPaise,
      totalPaise: order.totalPaise,
      approvalFlags: order.approvalFlags.join(' '),
      expectedDeliveryDate: order.expectedDeliveryDate,
      cancelReason: order.cancelReason,
    })),
    nextCursor: page.nextCursor,
  }
}
