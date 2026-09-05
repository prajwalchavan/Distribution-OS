import { ORPCError } from '@orpc/server'
import type { SeriesCompare, SeriesGrain } from '@dos/contracts'
import { businessDate } from '@dos/domain'

/**
 * The small shared pieces of reporting: bucket arithmetic, the comparison window, ratios that never
 * answer `NaN`, and the read-path helpers.
 *
 * EVERY DATE HERE IS AN IST BUSINESS DATE (`businessDate()` — docs/plans/reporting.md §4 rule 2). The
 * arithmetic is done on `Date.UTC` of the calendar parts, never on a local `new Date(string)`, so the
 * machine's own zone can never move a bucket by a day.
 */

export const DAY_MS = 86_400_000

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
export { n as num }

/** Today as an IST business date. */
export const today = (): string => businessDate().date

export function utcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

export function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export const addDays = (iso: string, days: number): string => isoOf(utcDay(iso) + days * DAY_MS)

/** Inclusive calendar days from `from` to `to`. */
export const windowDayCount = (from: string, to: string): number =>
  Math.round((utcDay(to) - utcDay(from)) / DAY_MS) + 1

/** The Monday of the week a date falls in (ISO weeks: Monday is the first day). */
export function mondayOf(iso: string): string {
  const t = utcDay(iso)
  const dow = (new Date(t).getUTCDay() + 6) % 7
  return isoOf(t - dow * DAY_MS)
}

export const firstOfMonth = (iso: string): string => `${iso.slice(0, 7)}-01`

/** The bucket a business date belongs to: the day itself, its Monday, or the first of its month. */
export function bucketOf(grain: SeriesGrain, iso: string): string {
  if (grain === 'day') return iso.slice(0, 10)
  if (grain === 'week') return mondayOf(iso)
  return firstOfMonth(iso)
}

/**
 * Every bucket the window touches, oldest first, WITH NO GAPS — a chart that skips an empty Tuesday
 * lies about the shape of the week, so a bucket with no rollup row is a zero, not a missing point.
 */
export function bucketList(grain: SeriesGrain, from: string, to: string): string[] {
  const out: string[] = []
  if (grain === 'month') {
    let [y, m] = firstOfMonth(from).split('-').map(Number) as [number, number, number]
    const [ty, tm] = firstOfMonth(to).split('-').map(Number) as [number, number, number]
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
    return out
  }
  const step = grain === 'week' ? 7 : 1
  const start = grain === 'week' ? mondayOf(from) : from.slice(0, 10)
  const end = grain === 'week' ? mondayOf(to) : to.slice(0, 10)
  for (let t = utcDay(start); t <= utcDay(end); t += step * DAY_MS) out.push(isoOf(t))
  return out
}

/**
 * The window a `compare` reads its `previous` from: the same window shifted back by its own length
 * (`previousPeriod`) or by one calendar year (`previousYear`). Null for `none` — nothing is read and
 * every `previous` is null.
 */
export function compareWindow(
  compare: SeriesCompare,
  from: string,
  to: string,
): { from: string; to: string } | null {
  if (compare === 'none') return null
  if (compare === 'previousPeriod') {
    const span = windowDayCount(from, to)
    return { from: addDays(from, -span), to: addDays(to, -span) }
  }
  const back = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
    // 29 February one year back is 28 February, never 1 March.
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
    return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
  }
  return { from: back(from), to: back(to) }
}

/** The month `basis` months back, keeping the day of month clamped (for `series.growth`). */
export function monthsBack(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) - months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`
}

/**
 * A rate on the wire, never `NaN` or `Infinity` (docs/plans/reporting.md §4 rule 1). `emptyValue` is
 * what 0/0 means: 1 for fill rate (nothing ordered is not a fulfilment failure), 0 for everything else.
 * At week / month grain the numerator and the denominator are summed first and divided once — an
 * average of daily rates would weight a quiet Sunday like a busy Monday.
 */
export function ratio(numerator: number, denominator: number, emptyValue = 0): number {
  if (denominator === 0) return numerator === 0 ? emptyValue : 0
  const value = numerator / denominator
  return Number.isFinite(value) ? value : emptyValue
}

/** `(value − previous) / previous` in basis points; null when there is no base to grow from. */
export function growthBps(value: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return Math.round(((value - previous) / Math.abs(previous)) * 10_000)
}

/** `value / total` in basis points, 0 when the tenant sold nothing in the window. */
export function shareBps(value: number, total: number): number {
  if (total === 0) return 0
  return Math.max(0, Math.min(10_000, Math.round((value / total) * 10_000)))
}

/** 400 with a machine-readable code, the way every other module answers a bad window. */
export function badRequest(code: string, message: string, data?: Record<string, unknown>): never {
  throw new ORPCError('BAD_REQUEST', { message, data: { code, ...data } })
}

/** The freshest `computed_at` inside the window — the chart's "as of". Now when the window is empty. */
export function asOfOf(rows: readonly { computedAt: Date | string | null }[]): string {
  let best = 0
  for (const row of rows) {
    if (!row.computedAt) continue
    const at =
      row.computedAt instanceof Date ? row.computedAt.getTime() : Date.parse(row.computedAt)
    if (Number.isFinite(at) && at > best) best = at
  }
  return new Date(best === 0 ? Date.now() : best).toISOString()
}

/** The literal group key for everything past `topGroups` (the `<CompareBars>` fold). */
export const OTHER_GROUP = 'other'

/**
 * Pages a list that is ALREADY in the order the reader wants — worst fill rate first, biggest scheme
 * spend first, trips by date — and whose order is therefore NOT its cursor key.
 *
 * A keyset cursor (`id > cursor`) is only correct on a list sorted by that id. On a list sorted by
 * anything else it silently drops rows: on the demo data the fill-rate register answered 29 variants
 * unpaged and 5 when walked a page at a time, and scheme spend 72 against 11 (gate, 2026-09-05). These
 * reads are bounded and fully materialised before paging, so the honest cursor is the OFFSET into that
 * one order: page 2 is literally the rows after page 1, and no row is ever lost or repeated.
 *
 * Registers whose source really is ordered by the cursor key (collections, stock value, rep
 * productivity, the day registers) keep their keyset cursor — it survives a row inserted mid-scroll.
 */
export function pageByOffset<T>(
  rows: readonly T[],
  cursor: string | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0)
  const items = rows.slice(start, start + limit)
  const next = start + items.length
  return { items, nextCursor: next < rows.length ? String(next) : null }
}
