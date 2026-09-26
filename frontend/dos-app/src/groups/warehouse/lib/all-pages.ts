/**
 * Follow a keyset-paged read to its end (QA DOS-234).
 *
 * The godown's van check-in asked ONE page of stock balances and treated it as the whole van, so whatever
 * sorted past the page — most of Loader 2's load — was simply not there. A screen that has to show
 * everything asks every page. `maxPages` is a ceiling against a runaway cursor, not a page size: at 500
 * rows a page it is ten thousand lots, far past any vehicle; reaching it is reported (`complete: false`),
 * never hidden.
 */
export interface Paged<T> {
  items: readonly T[]
  nextCursor: string | null
}

export interface AllPages<T> {
  items: T[]
  /** False only when `maxPages` stopped the walk with a cursor still in hand. */
  complete: boolean
}

export async function allPages<T>(
  read: (cursor: string | null) => Promise<Paged<T>>,
  maxPages = 20,
): Promise<AllPages<T>> {
  const items: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const answer: Paged<T> = await read(cursor)
    items.push(...answer.items)
    if (answer.nextCursor === null || answer.nextCursor === cursor) return { items, complete: true }
    cursor = answer.nextCursor
  }
  return { items, complete: false }
}
