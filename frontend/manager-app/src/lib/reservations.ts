/**
 * The stock an order is holding: every hold, and the pieces they add up to (DOS-130).
 *
 * The M2 order panel printed `items.length` under "Held for this order" — the number of LOTS the
 * godown reserved from, which the manager confirming the order reads as a quantity. Holds are per
 * lot, so one case can be five rows; the figure that answers "what has this order taken out of
 * stock" is the sum of `qtyPcs`.
 *
 * `warehouse.reservations.list` is a cursor page, so the sum has to follow the cursor: a first page
 * alone would under-report, and a wrong quantity is worse than the count it replaces.
 *
 * Pure on purpose: the page reader takes a function, so the screen keeps the only call to the API
 * and this file is tested without one. It is this app's own copy of the owner app's
 * `src/lib/reservations.ts` — the two apps install separately and neither imports the other's source.
 */

/** One page of a cursor list: the rows, and where the next page starts. */
export interface CursorPage<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}

/** Integer pieces held. Everything in this repo counts pieces as whole numbers. */
export function reservedPcs(holds: readonly { qtyPcs: number }[]): number {
  return holds.reduce((sum, hold) => sum + hold.qtyPcs, 0)
}

/**
 * Every hold, page by page, until the server stops handing back a cursor.
 *
 * `maxPages` is a stop, not a limit on the answer: a server that returned the same cursor for ever
 * would otherwise hang the panel. Twenty pages of holds is far past any real order.
 */
export async function readAllReservations<T>(
  fetchPage: (cursor: string | null) => Promise<CursorPage<T>>,
  maxPages = 20,
): Promise<T[]> {
  const holds: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page += 1) {
    const answer: CursorPage<T> = await fetchPage(cursor)
    holds.push(...answer.items)
    if (answer.nextCursor === null) break
    cursor = answer.nextCursor
  }
  return holds
}
