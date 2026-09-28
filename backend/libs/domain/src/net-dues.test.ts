import { describe, expect, it } from 'vitest'
import { netDuesPaise, netOfOnAccountRollup } from './net-dues.js'

describe('netOfOnAccountRollup (DOS-312)', () => {
  it('a shop in credit owes nothing net and is late for nothing', () => {
    // R-0047 in the QA run: ₹5,000 on account beside one ₹867 bill 20 days late.
    const net = netOfOnAccountRollup({
      outstandingPaise: 86_700,
      overduePaise: 86_700,
      unallocatedCreditPaise: 500_000,
      buckets: [0, 0, 86_700, 0, 0, 0],
    })
    expect(net).toEqual({ duesPaise: 0, overduePaise: 0, buckets: [0, 0, 0, 0, 0, 0] })
  })

  it('pays the oldest bucket first and leaves the newest bills owed', () => {
    const net = netOfOnAccountRollup({
      outstandingPaise: 60_000,
      overduePaise: 50_000,
      unallocatedCreditPaise: 35_000,
      buckets: [10_000, 0, 20_000, 0, 0, 30_000],
    })
    expect(net.buckets).toEqual([10_000, 0, 15_000, 0, 0, 0])
    expect(net.duesPaise).toBe(25_000)
    expect(net.overduePaise).toBe(15_000)
  })

  it('netDuesPaise is the dues line the desk and the rep both read', () => {
    expect(netDuesPaise(86_700, 500_000)).toBe(0)
    expect(netDuesPaise(60_000, 35_000)).toBe(25_000)
    expect(netDuesPaise(1_000, -500)).toBe(1_000)
  })

  it('reads money on account below zero as none', () => {
    const net = netOfOnAccountRollup({
      outstandingPaise: 1_000,
      overduePaise: 0,
      unallocatedCreditPaise: -500,
      buckets: [1_000, 0, 0, 0, 0, 0],
    })
    expect(net).toEqual({ duesPaise: 1_000, overduePaise: 0, buckets: [1_000, 0, 0, 0, 0, 0] })
  })
})
