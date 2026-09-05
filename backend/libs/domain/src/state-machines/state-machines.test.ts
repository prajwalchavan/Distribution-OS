import { describe, expect, it } from 'vitest'
import {
  documentMachine,
  invoiceMachine,
  ONDC_STATUS,
  orderMachine,
  reviewSessionMachine,
  stopMachine,
  tripMachine,
  TransitionError,
} from './index.js'

describe('state machines', () => {
  it('walks the happy path of an order', () => {
    let s = orderMachine.initial
    for (const e of [
      'submit',
      'confirm',
      'start_picking',
      'pack',
      'dispatch',
      'deliver_all',
      'close',
    ] as const) {
      s = orderMachine.next(s, e)
    }
    expect(s).toBe('closed')
    expect(orderMachine.isTerminal(s)).toBe(true)
    expect(ONDC_STATUS[s]).toBe('Completed')
  })

  it('refuses illegal transitions with a typed error', () => {
    expect(() => orderMachine.next('draft', 'dispatch')).toThrow(TransitionError)
    expect(orderMachine.can('picking', 'cancel')).toBe(false)
    expect(orderMachine.can('submitted', 'cancel')).toBe(true)
  })

  it('brings undelivered goods back to packed, not to the shop', () => {
    expect(orderMachine.next('dispatched', 'return_undelivered')).toBe('packed')
    expect(orderMachine.next('dispatched', 'deliver_partial')).toBe('partially_delivered')
  })

  it('models a trip that settles only after closing counts', () => {
    const active = tripMachine.next(tripMachine.next('planned', 'start_loading'), 'depart')
    expect(active).toBe('active')
    expect(tripMachine.can('active', 'settle')).toBe(false)
    expect(tripMachine.next(tripMachine.next(active, 'return'), 'settle_with_variance')).toBe(
      'settled_with_variance',
    )
    expect(tripMachine.can('active', 'cancel')).toBe(false)
    expect(
      stopMachine.next(
        stopMachine.next(stopMachine.next('pending', 'start'), 'arrive'),
        'deliver_partial',
      ),
    ).toBe('partial')
    expect(stopMachine.can('delivered', 'deliver')).toBe(false)
  })

  it('never edits an issued invoice', () => {
    expect(invoiceMachine.can('issued', 'issue')).toBe(false)
    expect(invoiceMachine.next('issued', 'receive_partial')).toBe('partially_paid')
    expect(invoiceMachine.next('partially_paid', 'receive_full')).toBe('paid')
  })

  /**
   * The six states are exactly the `invoice_state` enum, so `next()` can be written into the column.
   * Cancellation keeps the number (GSTR-1 Table 13) and is lawful only before money lands on the bill.
   */
  it('cancels a bill before dispatch and never after a rupee is allocated', () => {
    expect(invoiceMachine.next('draft', 'cancel')).toBe('cancelled')
    expect(invoiceMachine.next('issued', 'cancel')).toBe('cancelled')
    expect(invoiceMachine.can('partially_paid', 'cancel')).toBe(false)
    expect(invoiceMachine.can('paid', 'cancel')).toBe(false)
    expect(invoiceMachine.isTerminal('cancelled')).toBe(true)
    expect(Object.keys(invoiceMachine.transitions).sort()).toEqual([
      'cancelled',
      'draft',
      'issued',
      'paid',
      'partially_paid',
      'written_off',
    ])
  })

  /**
   * The nine states are exactly the `document_status` enum (schema/docint.ts). Document intake never
   * commits on its own (never-list 6): the only road to `committed` runs through a human's
   * `review_submitted`, and a red check keeps `needs_review` from ever reaching `reviewed` in code.
   */
  it('walks a supplier bill from capture to the booked draft, by hand only', () => {
    let s = documentMachine.initial
    for (const e of [
      'submit',
      'verified',
      'flag',
      'start_review',
      'review_submitted',
      'commit',
    ] as const) {
      s = documentMachine.next(s, e)
    }
    expect(s).toBe('committed')
    expect(documentMachine.isTerminal(s)).toBe(true)
    expect(documentMachine.next('extracting', 'extracted')).toBe('extracted')
    expect(documentMachine.can('extracting', 'commit')).toBe(false)
    expect(documentMachine.can('extracted', 'commit')).toBe(false)
    expect(documentMachine.can('uploaded', 'verified')).toBe(false)
    expect(documentMachine.next('needs_review', 'release')).toBe('extracted')
    expect(documentMachine.next('needs_review', 'start_review')).toBe('needs_review')
    expect(documentMachine.next('extracted', 'retry')).toBe('extracting')
    expect(documentMachine.can('committed', 'reject')).toBe(false)
    expect(documentMachine.can('failed', 'retry')).toBe(false)
    expect(Object.keys(documentMachine.transitions).sort()).toEqual([
      'committed',
      'extracted',
      'extracting',
      'failed',
      'needs_review',
      'rejected',
      'reviewed',
      'uploaded',
      'verifying',
    ])
    expect(reviewSessionMachine.next('open', 'submit')).toBe('submitted')
    expect(reviewSessionMachine.next('open', 'abandon')).toBe('abandoned')
    expect(reviewSessionMachine.can('submitted', 'abandon')).toBe(false)
  })
})
