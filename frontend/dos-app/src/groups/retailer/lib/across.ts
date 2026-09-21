/**
 * DOS-102 — what the shop's home is allowed to SAY about the money it owes across its distributors.
 *
 * `auth.memberships.summary` is ONE read, and a read can fail: no signal in the godown, a service
 * restarting, a token the client could not renew. `across.data?.totalOutstandingPaise ?? 0` collapsed
 * every one of those into ₹0.00 — a FIGURE, not an absence — under the sentence "You owe {total}
 * across {count} distributors". A shop that owes lakhs was told it owed nothing, and nothing on the
 * screen said otherwise: the connection strip is fed by a different read, which was healing normally.
 *
 * So the three states are named here, and the screen renders all three. A figure already in hand wins
 * over a failed REVALIDATION — the strip is what tells the reader how old it is — but a read that has
 * never landed is never a number.
 */

/** The shape of `useQuery(['memberships','summary'], ...)`, narrowed to what the decision needs. */
export interface AcrossRead {
  data?: { totalOutstandingPaise: number } | undefined
  error?: unknown
}

export type AcrossTotal =
  { kind: 'known'; totalPaise: number } | { kind: 'reading' } | { kind: 'unread' }

export function acrossTotal(read: AcrossRead): AcrossTotal {
  if (read.data !== undefined) return { kind: 'known', totalPaise: read.data.totalOutstandingPaise }
  return read.error === undefined || read.error === null ? { kind: 'reading' } : { kind: 'unread' }
}
