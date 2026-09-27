/**
 * "Show more" over a cursor-paged register (QA DOS-253), shared by every group's Stock screen.
 *
 * A register that grows with the business (a godown's lot × location rows: 1 294 at Tarsun's Godown on
 * day 7) is read ONE PAGE AT A TIME — scale rule 3 (docs/20): no screen drains an unbounded list. The
 * screens used to read one page and stop, so 8 of 29 live batches of the simulation's items were never on
 * screen and nothing said so. The rule here:
 *
 *  - the first page is an ordinary `useQuery` (cached, invalidated by writes like any other read);
 *  - every further page is read only when the reader presses "Show more", from the previous page's
 *    `nextCursor`, and appended — the rows already on screen never blank out;
 *  - when the first page is read again (a write invalidated it), the pages the reader had opened are read
 *    again from the fresh first page, and until they land the old ones stay on screen;
 *  - a change of filters (`key`) starts again at one page;
 *  - `hasMore` is true exactly while the last page read carries a cursor, so a screen can say "more below"
 *    instead of printing a partial list as if it were the whole.
 */
import type { ApiError } from '@dos/api-client'
import { useCallback, useEffect, useRef, useState } from 'react'

/** What every cursor-paged reply shares. */
export interface CursorPage<Row> {
  readonly items: readonly Row[]
  readonly nextCursor: string | null
}

/** The first page and the pages read after it, as one list; a row repeated across a page edge shows once. */
export function mergePages<Row>(
  first: CursorPage<Row> | undefined,
  more: readonly CursorPage<Row>[],
  rowKey: (row: Row) => string,
): Row[] {
  if (first === undefined) return []
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const page of [first, ...more]) {
    for (const row of page.items) {
      const key = rowKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }
  return rows
}

/** The cursor the next "Show more" reads from, or null when the last page read said nothing follows. */
export function nextCursorOf<Row>(
  first: CursorPage<Row> | undefined,
  more: readonly CursorPage<Row>[],
): string | null {
  const last = more.length > 0 ? more[more.length - 1] : first
  const cursor = last?.nextCursor
  return cursor === undefined || cursor === null || cursor === '' ? null : cursor
}

export interface MorePages<Row> {
  /** Every row on screen: the first page, then each page the reader opened. */
  rows: Row[]
  /** A further page exists behind the last one read. */
  hasMore: boolean
  /** Read the next page (a no-op while one is being read or when none follows). */
  showMore: () => void
  /** A page is being read. */
  loading: boolean
  /** The last "Show more" failed; the rows already on screen stay, and pressing again retries. */
  error: ApiError | undefined
}

interface Chain<Row> {
  key: string
  base: CursorPage<Row> | undefined
  pages: CursorPage<Row>[]
}

/**
 * Pages after the first, read on demand. `key` is the identity of the filters (a change starts again);
 * `first` is the first page's `useQuery` data; `readPage` reads one page from a cursor.
 */
export function useMorePages<Row>(
  key: string,
  first: CursorPage<Row> | undefined,
  readPage: (cursor: string) => Promise<CursorPage<Row>>,
  rowKey: (row: Row) => string,
): MorePages<Row> {
  const [chain, setChain] = useState<Chain<Row>>({ key, base: first, pages: [] })
  const [wanted, setWanted] = useState<{ key: string; count: number }>({ key, count: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | undefined>(undefined)
  const readRef = useRef(readPage)
  readRef.current = readPage

  const count = wanted.key === key ? wanted.count : 0
  // The pages that belong to THESE filters; stale ones (first page re-read) stay on screen until replaced.
  const pages = chain.key === key ? chain.pages.slice(0, count) : []
  const current = chain.key === key && chain.base === first

  useEffect(() => {
    if (first === undefined || count === 0) return
    if (current && chain.pages.length >= count) return
    let cancelled = false
    const start: CursorPage<Row>[] = current ? chain.pages : []
    setLoading(true)
    setError(undefined)
    void (async () => {
      const read = [...start]
      try {
        while (read.length < count) {
          const cursor = nextCursorOf(first, read)
          if (cursor === null) break
          read.push(await readRef.current(cursor))
        }
        if (!cancelled) setChain({ key, base: first, pages: read })
      } catch (e) {
        if (!cancelled) {
          setError(e as ApiError)
          // what was read before the failure is kept, and the count falls back to it
          setChain({ key, base: first, pages: read })
          setWanted({ key, count: read.length })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // `chain.pages` is read through `current` on purpose: re-running on its identity would loop.
  }, [key, first, count, current])

  // While the first page is being re-read, "more" is judged from the first page alone.
  const hasMore = nextCursorOf(first, current ? pages : []) !== null
  const showMore = useCallback(() => {
    if (loading) return
    setWanted((w) => ({ key, count: (w.key === key ? w.count : 0) + 1 }))
  }, [key, loading])

  return {
    rows: mergePages(first, pages, rowKey),
    hasMore,
    showMore,
    loading,
    error,
  }
}

/** `value`, once it has stopped changing for `ms` — a search box that asks the server once per pause. */
export function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, ms)
    return () => {
      clearTimeout(timer)
    }
  }, [value, ms])
  return settled
}
