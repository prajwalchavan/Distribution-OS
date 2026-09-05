import { defineMachine } from './machine.js'

/**
 * Invoice / payment. "Overdue" is derived from due date + outstanding, never stored as a state.
 * Outstanding = AR balance per party from the money ledger (issued amount - allocations - credit notes).
 * An issued GST invoice is immutable: corrections are credit/debit notes, never edits or regeneration.
 *
 * The states are exactly the values of the `invoice_state` Postgres enum (schema/billing.ts), which is
 * what makes `machine.next()` safe to write straight into the column. `void` used to be the sixth state
 * here and is not one of them — it was replaced by `cancelled` when billing landed
 * (docs/plans/00-coordination.md §3.9).
 *
 * WHO MOVES WHAT. Billing owns `issue` and `cancel`; receivables owns the derived payment part
 * (`receive_partial`, `receive_full`, `write_off`) and writes the column directly under the documented
 * exception in coordination §3.2. Cancellation is lawful from `draft` (nothing was ever printed) and
 * from `issued` — before dispatch and before a rupee is allocated, which billing checks — and the
 * number survives it (GSTR-1 Table 13, docs/17 item 26). Once money has landed on the bill it is
 * `partially_paid` or `paid` and the only correction left is a credit note.
 */
export type InvoiceState =
  'draft' | 'issued' | 'partially_paid' | 'paid' | 'written_off' | 'cancelled'
export type InvoiceEvent = 'issue' | 'receive_partial' | 'receive_full' | 'write_off' | 'cancel'

export const invoiceMachine = defineMachine<InvoiceState, InvoiceEvent>({
  name: 'invoice',
  initial: 'draft',
  terminal: ['paid', 'written_off', 'cancelled'],
  transitions: {
    draft: { issue: 'issued', cancel: 'cancelled' },
    issued: {
      receive_partial: 'partially_paid',
      receive_full: 'paid',
      write_off: 'written_off',
      cancel: 'cancelled',
    },
    // Money has been allocated to this bill: it can no longer be cancelled, only credited.
    partially_paid: {
      receive_partial: 'partially_paid',
      receive_full: 'paid',
      write_off: 'written_off',
    },
    paid: {},
    written_off: {},
    cancelled: {},
  },
})
