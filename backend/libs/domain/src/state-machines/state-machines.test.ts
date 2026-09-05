import { describe, expect, it } from 'vitest'
import {
  invoiceMachine,
  ONDC_STATUS,
  orderMachine,
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
})
