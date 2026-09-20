/**
 * How many decisions are actually waiting on the owner (DOS-019).
 *
 * The Today heading and the rail badge both stated `owner_summary.pendingApprovals`. That number is
 * written by the worker every 15 minutes and counts APPROVALS alone, while the panel under the
 * heading lists approvals AND ungated rate requests — so "Needs you (5)" sat over six rows, and two
 * decisions later, with the worker stopped, both the heading and the badge still said 5.
 *
 * The rollup is not wrong; it is the wrong source for this one figure. It stays where its 15 minutes
 * cost nothing (the money tiles, the connection strip's "updated at"). The count of things waiting
 * comes from the two lists the Approvals screen itself decides from, which the decision's own
 * `invalidates: [['approvals'], ['bargains']]` already refreshes.
 *
 * Pure on purpose: no query, no React. Both callers pass the reads they already make, under the same
 * query keys, so the cache serves one request to the pair.
 */

/** One page of a cursor list: the rows, and whether the server kept more. */
export interface DecisionPage<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}

/** A row of `orders.approvals.list`, narrowed to what "is this request already gated" needs. */
export interface PendingApproval {
  readonly entityType: string
  readonly entityId: string
}

/** A row of `pricing.bargains.list`, narrowed the same way. */
export interface RequestedBargain {
  readonly id: string
}

export interface Waiting {
  /** Decisions waiting. A floor, never a guess: see `more`. */
  readonly count: number
  /** True when a read left a cursor or has not answered, so the true number is `count` or higher. */
  readonly more: boolean
}

/**
 * The decisions waiting, counted once each.
 *
 * A bargain gate and the rate request it decides are ONE decision (DOS-005 pairs them, and the Today
 * panel draws them as one row), so a request already named by an approval on this page is not counted
 * twice. Every other requested rate is a decision of its own, gate or no gate.
 *
 * Each read is a page of five, so the answer is a lower bound whenever a cursor is left over — and a
 * bound whenever one of the two has not answered at all, because the rows it is holding can only add.
 * A request gated by an approval beyond the page counts here as ungated, which keeps the answer a
 * floor: that gate is one of the approvals the cursor is still holding.
 *
 * `undefined` when NEITHER read has answered: there is nothing to state, and stating 0 over a panel
 * that is reporting a refusal would claim the safer of the two possible facts.
 */
export function pendingDecisions(
  approvals: DecisionPage<PendingApproval> | undefined,
  bargains: DecisionPage<RequestedBargain> | undefined,
): Waiting | undefined {
  if (approvals === undefined && bargains === undefined) return undefined

  const gated = new Set(
    (approvals?.items ?? [])
      .filter((row) => row.entityType === 'bargain_request')
      .map((row) => row.entityId),
  )
  const ungated = (bargains?.items ?? []).filter((row) => !gated.has(row.id))

  return {
    count: (approvals?.items.length ?? 0) + ungated.length,
    more:
      approvals === undefined ||
      bargains === undefined ||
      approvals.nextCursor !== null ||
      bargains.nextCursor !== null,
  }
}
