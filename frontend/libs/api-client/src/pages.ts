/**
 * Reading every page of a window the SERVICE already bounds (DOS-095).
 *
 * A list endpoint answers one page and a `nextCursor`. A screen that prints a figure describing the
 * whole window — a statement's closing balance — must not print it under the first page alone. The
 * retailer statement did exactly that: 50 entries of 54 and a closing balance ₹27,692 below the last
 * running balance on screen, because the shop's four latest payments were on page 2.
 *
 * FOR SERVER-BOUNDED WINDOWS ONLY. Scale rule 3 (docs/20) says no endpoint hands out an unbounded list,
 * and this helper is not a way round it: use it where the service already caps the window (the ledger's
 * 400 days), never to drain a register that grows with the business. Every caller names its own
 * `maxPages` — there is deliberately no default — and a read that outgrows it says so with
 * `complete: false` instead of silently cutting the list short or looping.
 *
 *   const read = await readEveryPage(
 *     (cursor) => api.api.receivables.ledger.get({ ...window, limit: 200, ...(cursor === undefined ? {} : { cursor }) }),
 *     { maxPages: 5 },
 *   )
 *   const closing = read.complete ? read.last.closingPaise : null
 */

/** What every cursor-paged reply shares. */
export interface CursorPage {
  readonly items: readonly unknown[]
  readonly nextCursor: string | null
}

export interface EveryPage<P extends CursorPage> {
  /** The first page as the service sent it; its header figures describe the window (an opening balance). */
  first: P
  /** The last page read. When `complete`, its `nextCursor` is null and its window figures are final. */
  last: P
  /** Every item of every page read, in the service's order. */
  items: P['items'][number][]
  /** True only when the service said nothing follows the last page (`nextCursor === null`). */
  complete: boolean
  /** How many requests the read took. */
  pages: number
}

/**
 * Reads page after page, one request at a time, until the service returns `nextCursor: null`.
 *
 * Stops with `complete: false` when `maxPages` pages have been read and a cursor is still pending, or when
 * the service hands back the cursor it was just sent (a cursor that does not advance ends the read rather
 * than asking for the same page forever). Any page that fails rejects the whole read: there is no partial
 * result to print a figure over.
 */
export async function readEveryPage<P extends CursorPage>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
  options: { maxPages: number },
): Promise<EveryPage<P>> {
  const { maxPages } = options
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new RangeError(
      `readEveryPage needs a page bound: maxPages must be a whole number of at least 1, got ${String(maxPages)}`,
    )
  }
  const first = await fetchPage(undefined)
  const items: P['items'][number][] = [...first.items]
  let last = first
  let pages = 1
  let sent: string | undefined
  while (last.nextCursor !== null) {
    if (pages >= maxPages || last.nextCursor === sent) {
      return { first, last, items, complete: false, pages }
    }
    sent = last.nextCursor
    last = await fetchPage(sent)
    items.push(...last.items)
    pages += 1
  }
  return { first, last, items, complete: true, pages }
}
