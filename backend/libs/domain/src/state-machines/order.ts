import { defineMachine } from './machine.js'

/**
 * Sales Order fulfilment (synthesis §4.3, ONDC-shaped). Approvals (MOV, credit, price variance, bargain)
 * gate submitted -> confirmed; stock reservations post on `confirm` as a side effect, not a state.
 * Delivery and invoice/payment are SEPARATE machines that reference the order.
 */
export type OrderState =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'picking'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'partially_delivered'
  | 'closed'
  | 'cancelled'

export type OrderEvent =
  | 'submit'
  | 'confirm'
  | 'start_picking'
  | 'pack'
  | 'dispatch'
  | 'deliver_all'
  | 'deliver_partial'
  | 'return_undelivered'
  | 'close'
  | 'cancel'

export const orderMachine = defineMachine<OrderState, OrderEvent>({
  name: 'order',
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  transitions: {
    draft: { submit: 'submitted', cancel: 'cancelled' },
    // rejection by the owner is `cancel` with a reason code; auto-approve is the system emitting `confirm`
    submitted: { confirm: 'confirmed', cancel: 'cancelled' },
    // authoritative stock check happens on `confirm`; the live ATP shown while ordering is only a hint
    confirmed: { start_picking: 'picking', cancel: 'cancelled' },
    /*
     * The desk (owner, manager) may cancel an order the floor is already picking (founder, QA DOS-138):
     * the hold is released, the picker's sheet shows which lines to put back, and no GST invoice is
     * burned. Reps and shops keep their own reach — the handler, not the machine, enforces that.
     */
    picking: { pack: 'packed', cancel: 'cancelled' },
    /*
     * The GST invoice is issued at `pack` and never regenerated; shortfalls become credit notes. A
     * packed order therefore carries a legal document, so it is never cancelled on its own: the BILL
     * is cancelled — number kept, stock back, money reversed — and the order goes with it in the same
     * transaction (QA DOS-139). `orders.cancel` refuses a packed order and names that route; the only
     * caller of this edge is `InvoicesService.cancel` through `OrdersService.cancelInTx`.
     */
    packed: { dispatch: 'dispatched', cancel: 'cancelled' },
    dispatched: {
      deliver_all: 'delivered',
      deliver_partial: 'partially_delivered',
      return_undelivered: 'packed',
    },
    delivered: { close: 'closed' },
    partially_delivered: { close: 'closed' },
    closed: {},
    cancelled: {},
  },
})

/** ONDC `on_status` mapping (R04 §6) so the vocabulary never needs to change for network orders. */
export const ONDC_STATUS: Readonly<
  Record<OrderState, 'Created' | 'Accepted' | 'In-progress' | 'Completed' | 'Cancelled'>
> = {
  draft: 'Created',
  submitted: 'Created',
  confirmed: 'Accepted',
  picking: 'In-progress',
  packed: 'In-progress',
  dispatched: 'In-progress',
  delivered: 'Completed',
  partially_delivered: 'Completed',
  closed: 'Completed',
  cancelled: 'Cancelled',
}
