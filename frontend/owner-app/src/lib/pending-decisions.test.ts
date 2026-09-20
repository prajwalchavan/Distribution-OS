/**
 * DOS-019 — "Needs you (5)" listed six rows, and the badge stayed at 5 after two decisions.
 *
 * The heading and the rail badge both read `owner_summary.pendingApprovals`: a rollup the worker
 * rewrites every 15 minutes, and one that counts APPROVALS only. The panel below it lists approvals
 * AND ungated rate requests, so the two disagreed on sight — and with the worker stopped, deciding
 * two of them changed neither number.
 *
 * `pendingDecisions()` is the count both places now state: one per pending approval, plus one per
 * requested rate request that no approval on the page is already gating (a bargain gate and its
 * request are one decision, DOS-005). Each read is a cursor page of five, so the answer is a LOWER
 * bound whenever a cursor is left over, and says so with `more` — the screen prints "10+".
 *
 * Pure on purpose: no query, no React. The screen passes the two reads it already makes.
 */
import { describe, expect, it } from 'vitest'

import { pendingDecisions, type PendingApproval, type RequestedBargain } from './pending-decisions'

function approval(id: string, entityId?: string): PendingApproval {
  return entityId === undefined
    ? { entityType: 'sales_order', entityId: `so-${id}` }
    : { entityType: 'bargain_request', entityId }
}

function page<T>(
  items: readonly T[],
  nextCursor: string | null = null,
): {
  items: readonly T[]
  nextCursor: string | null
} {
  return { items, nextCursor }
}

describe('pendingDecisions', () => {
  it('DOS-019: the count is the approvals plus the rate requests no approval already gates', () => {
    // Five gates, one of them the gate on request r1; r1 and r2 are the two requested rates.
    const approvals = page([
      approval('a1'),
      approval('a2'),
      approval('a3'),
      approval('a4'),
      approval('a5', 'r1'),
    ])
    const bargains = page<RequestedBargain>([{ id: 'r1' }, { id: 'r2' }])

    // Six decisions: five gates and the one ungated request. Not 5 (the rollup) and not 7 (r1 twice).
    expect(pendingDecisions(approvals, bargains)).toEqual({ count: 6, more: false })
  })

  it('DOS-019: a left-over cursor makes the count a bound, not a claim', () => {
    const approvals = page([approval('a1'), approval('a2')], 'cursor-2')
    const bargains = page<RequestedBargain>([{ id: 'r1' }])

    expect(pendingDecisions(approvals, bargains)).toEqual({ count: 3, more: true })
    // A cursor on either read is enough.
    expect(pendingDecisions(page([approval('a1')]), page([{ id: 'r1' }], 'c'))).toEqual({
      count: 2,
      more: true,
    })
  })

  it('DOS-019: deciding two drops the count by two', () => {
    const before = pendingDecisions(
      page([approval('a1'), approval('a2'), approval('a3')]),
      page<RequestedBargain>([]),
    )
    const after = pendingDecisions(page([approval('a3')]), page<RequestedBargain>([]))

    expect(before?.count).toBe(3)
    expect(after?.count).toBe(1)
  })

  it('DOS-019: nothing waiting is stated as nothing, not withheld', () => {
    expect(pendingDecisions(page<PendingApproval>([]), page<RequestedBargain>([]))).toEqual({
      count: 0,
      more: false,
    })
  })

  it('DOS-019: a read that has not answered is never counted as zero', () => {
    // Neither answered: there is no count to state, so the heading drops the number entirely.
    expect(pendingDecisions(undefined, undefined)).toBeUndefined()
    // One answered: what it holds is a floor, and the other read may add to it.
    expect(pendingDecisions(page([approval('a1')]), undefined)).toEqual({ count: 1, more: true })
    expect(pendingDecisions(undefined, page<RequestedBargain>([{ id: 'r1' }]))).toEqual({
      count: 1,
      more: true,
    })
  })
})
