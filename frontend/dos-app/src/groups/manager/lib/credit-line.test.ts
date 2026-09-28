import { describe, expect, it } from 'vitest'

import { creditAskTotal, owedNet, promisedPaise } from './credit-line'

describe('QA DOS-312/313 the desk credit line reads the rep’s figures', () => {
  it('owes the dues net of money on account, never below zero', () => {
    // R-0047 in the QA run: ₹5,000 on account beside one ₹867 bill.
    expect(owedNet({ outstandingPaise: 86_700, unallocatedCreditPaise: 500_000 })).toBe(0)
    expect(owedNet({ outstandingPaise: 86_700, unallocatedCreditPaise: 6_700 })).toBe(80_000)
    // a stored notice from before the field existed reads the gross dues
    expect(owedNet({ outstandingPaise: 86_700 })).toBe(86_700)
  })

  it('names the confirmed orders not billed yet', () => {
    expect(promisedPaise({ outstandingPaise: 0, unbilledOrdersPaise: 59_500 })).toBe(59_500)
    expect(promisedPaise({ outstandingPaise: 0 })).toBe(0)
  })

  it('asks with the order total only while the order waits, so a confirmed order is not counted twice', () => {
    expect(creditAskTotal({ state: 'submitted', totalPaise: 59_500 })).toEqual({
      totalPaise: 59_500,
      waiting: true,
    })
    expect(creditAskTotal({ state: 'draft', totalPaise: 59_500 }).totalPaise).toBe(59_500)
    for (const state of ['confirmed', 'picking', 'packed', 'dispatched', 'delivered', 'cancelled'])
      expect(creditAskTotal({ state, totalPaise: 59_500 })).toEqual({
        totalPaise: 0,
        waiting: false,
      })
  })
})
