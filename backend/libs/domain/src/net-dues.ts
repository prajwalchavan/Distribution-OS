/**
 * WHAT A SHOP OWES NET OF ITS MONEY ON ACCOUNT (QA DOS-312, architect ruling 3, 2026-09-28).
 *
 * The dues rollup (`retailer_outstanding_summary`) stays GROSS — `outstanding`, `overdue` and the six ageing
 * buckets are what the bills say — and the money the shop has paid that no bill has claimed yet is carried
 * beside them as "on account". What the shop is chased for, held for and aged by is its bills AFTER that
 * money has paid its OLDEST bills first, the FIFO order the allocation walks. This is that rule over a
 * rollup row, stated ONCE: the server's registers and cards use it, and so do the phones, which read the
 * same row from their own synced copy and must never compute a second answer. Pure and dependency-free.
 *
 * Overdue bills are the earliest due, and each bucket is a band of due dates, so paying the oldest bills
 * first is taking the money off the oldest bucket first. Money on account below zero is treated as none.
 *
 * `buckets` are in the rollup's own order: 0–7, 8–15, 16–30, 31–60, 61–90, 90+ days past due.
 */
export interface NetOfOnAccount {
  /** `max(0, outstanding − on account)`: what the shop is asked for; bills on a van are not in it. */
  readonly duesPaise: number
  /** The overdue part of that: the money on account pays the overdue bills before any other. */
  readonly overduePaise: number
  /** The six buckets once the oldest were paid first. */
  readonly buckets: readonly number[]
}

export function netOfOnAccountRollup(row: {
  readonly outstandingPaise: number
  readonly overduePaise: number
  readonly unallocatedCreditPaise: number
  readonly buckets: readonly number[]
}): NetOfOnAccount {
  const credit = Math.max(0, row.unallocatedCreditPaise)
  const buckets = [0, 0, 0, 0, 0, 0]
  let left = credit
  for (let i = 5; i >= 0; i -= 1) {
    const gross = row.buckets[i] ?? 0
    const covered = Math.min(left, Math.max(0, gross))
    left -= covered
    buckets[i] = gross - covered
  }
  return {
    duesPaise: Math.max(0, row.outstandingPaise - credit),
    overduePaise: Math.max(0, row.overduePaise - credit),
    buckets,
  }
}
