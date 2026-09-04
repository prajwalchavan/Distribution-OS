import { defineMachine } from './machine.js'

/**
 * Invoice / payment. "Overdue" is derived from due date + outstanding, never stored as a state.
 * Outstanding = AR balance per party from the money ledger (issued amount - allocations - credit notes).
 * An issued GST invoice is immutable: corrections are credit/debit notes, never edits or regeneration.
 */
export type InvoiceState = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'written_off' | 'void'
export type InvoiceEvent = 'issue' | 'receive_partial' | 'receive_full' | 'write_off' | 'void'

export const invoiceMachine = defineMachine<InvoiceState, InvoiceEvent>({
  name: 'invoice',
  initial: 'draft',
  terminal: ['paid', 'written_off', 'void'],
  transitions: {
    // `void` is only possible before issue (a numbered, printed invoice is reversed with a credit note)
    draft: { issue: 'issued', void: 'void' },
    issued: { receive_partial: 'partially_paid', receive_full: 'paid', write_off: 'written_off' },
    partially_paid: {
      receive_partial: 'partially_paid',
      receive_full: 'paid',
      write_off: 'written_off',
    },
    paid: {},
    written_off: {},
    void: {},
  },
})
