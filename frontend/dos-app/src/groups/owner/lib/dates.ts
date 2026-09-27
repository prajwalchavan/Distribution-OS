/**
 * Every date this app sends or prints is an IST business date (`@dos/domain/calendar`).
 *
 * Nothing here re-implements a calendar: `businessDate()` and `financialYear()` are the domain's, and
 * the only arithmetic is on the ISO string's own UTC midnight — which is exactly what the backend's
 * own `windowDays()` does, so a window the app asks for is the window the register caps.
 */
import { businessDate, daysBetween, financialYear } from '@dos/domain'

const DAY_MS = 86_400_000

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** Today, as the IST calendar date the contract's `from` / `to` parameters take. */
export function today(): string {
  return businessDate().date
}

/** `2026-09-06` shifted by whole days, still an IST calendar date. */
export function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
  return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`
}

/** The first day of the Indian financial year containing `isoDate` (1 April). */
export function startOfFinancialYear(isoDate: string = today()): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number]
  return `${String(m >= 4 ? y : y - 1)}-04-01`
}

export function currentFinancialYear(): string {
  return financialYear()
}

/** The last day of the month containing `isoDate`. */
export function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number]
  const at = new Date(Date.UTC(y, m, 1) - DAY_MS)
  return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`
}

/** `2026-09-06` → `6 Sep`. The axis label and every date cell in a register. */
export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 10) return '—'
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return `${String(Number(isoDate.slice(8, 10)))} ${month}`
}

/** `2026-09-06` → `6 Sep 2026`. Detail panels, where the year matters. */
export function longDate(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 10) return '—'
  return `${shortDate(isoDate)} ${isoDate.slice(0, 4)}`
}

/** An ISO instant (`2026-09-05T17:15:25.273Z`) → its IST business date, printed short. */
export function shortInstant(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return shortDate(businessDate(ms).date)
}

/** An ISO instant → `6 Sep, 4:45 pm` IST. Used for "as of" and for audit rows. */
export function instantWithClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const ist = new Date(ms + 330 * 60_000)
  const hours = ist.getUTCHours()
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0')
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${shortDate(businessDate(ms).date)}, ${String(hour12)}:${minutes} ${suffix}`
}

/**
 * The ranges the owner's charts and registers offer, as `{ from, to }` IST dates. `today` is the one a
 * register opened from the home's flow strip lands on (UX-O-1): "today's bills", "today's receipts".
 */
export type RangeId = 'today' | 'd7' | 'd30' | 'd90' | 'fy'

const RANGE_IDS: readonly RangeId[] = ['today', 'd7', 'd30', 'd90', 'fy']

/**
 * The windows `<RangeSegments>` draws as segments. The kit's `<Segments>` takes "two or three options"
 * and renders only the first three (`items.slice(0, 3)` in both renderers), so this list is exactly the
 * three a reader can pick — FY was the fourth and never drew. **Today is not one of them**: putting it in
 * front pushed 90 days off the end on Orders, Bills & GST and Receipts (owner-ux repair, verifier finding
 * 1). A register that offers Today draws it as its own chip beside these three.
 */
export const RANGE_SEGMENT_IDS = ['d7', 'd30', 'd90'] as const satisfies readonly RangeId[]

/** The most options the kit's `<Segments>` draws (`SegmentsProps`: "Two or three options"). */
export const SEGMENTS_MAX = 3

/** A `?range=` query parameter as a range, or `fallback` when it is absent or not one of ours. */
export function rangeParam(value: unknown, fallback: RangeId): RangeId {
  return typeof value === 'string' && (RANGE_IDS as readonly string[]).includes(value)
    ? (value as RangeId)
    : fallback
}

export interface DateRange {
  from: string
  to: string
}

export function rangeOf(id: RangeId, now: string = today()): DateRange {
  switch (id) {
    case 'today':
      return { from: now, to: now }
    case 'd7':
      return { from: shiftDays(now, -6), to: now }
    case 'd30':
      return { from: shiftDays(now, -29), to: now }
    case 'd90':
      return { from: shiftDays(now, -89), to: now }
    case 'fy':
      return { from: startOfFinancialYear(now), to: now }
  }
}

/** Inclusive calendar days in a window — the same arithmetic the contract's own `windowDays()` does. */
export function windowDays(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1
}

/**
 * The grain a window can actually be served at.
 *
 * `SERIES_POINT_CAPS` in `@dos/contracts` is day <= 92, week <= 53, month <= 24, and a wider ask is a
 * 400 `window_too_wide` rather than a truncated chart. So the screen picks the grain instead of
 * hard-coding `day` and discovering the cap in production: a financial year is 365 days, which is a
 * week chart, not a day one.
 */
export function grainFor(range: DateRange): 'day' | 'week' | 'month' {
  const days = windowDays(range)
  if (days <= 92) return 'day'
  if (days <= 53 * 7) return 'week'
  return 'month'
}

/**
 * A window narrowed to what a LIVE register will serve (`REGISTER_WINDOW_DAYS`: 31 for the per-line
 * joins, 92 for the grouped reads). The register answers 400 above its cap — including at
 * `exports.request` time — so the screen asks for the widest window that is actually allowed and the
 * reader sees the range it got, never an error where a report should be.
 */
export function clampWindow(range: DateRange, maxDays: number): DateRange {
  return windowDays(range) <= maxDays
    ? range
    : { from: shiftDays(range.to, -(maxDays - 1)), to: range.to }
}

/**
 * The same days of last month as this month has had so far (UX-O-4): on 27 Sep, 1–27 Sep against 1–27
 * Aug. A whole last month against a part month is not a comparison (`series.growth` said −53.42 % where
 * the like-for-like figure is −46 %). A day this month that last month did not have (31 Oct → 30 Sep) is
 * clamped to last month's end.
 */
export function sameDaysLastMonth(now: string = today()): {
  current: DateRange
  previous: DateRange
} {
  const [y, m, d] = now.split('-').map(Number) as [number, number, number]
  const first = `${String(y)}-${String(m).padStart(2, '0')}-01`
  const lastMonthStart = new Date(Date.UTC(y, m - 2, 1))
  const from = `${String(lastMonthStart.getUTCFullYear())}-${String(lastMonthStart.getUTCMonth() + 1).padStart(2, '0')}-01`
  const day = Math.min(d, Number(endOfMonth(from).slice(8, 10)))
  return {
    current: { from: first, to: now },
    previous: { from, to: `${from.slice(0, 8)}${String(day).padStart(2, '0')}` },
  }
}

/** `1–27 Aug`: a window inside one month, the way the trade says it. */
export function dayRange(range: DateRange): string {
  const month = MONTHS[Number(range.from.slice(5, 7)) - 1] ?? ''
  const from = String(Number(range.from.slice(8, 10)))
  const to = String(Number(range.to.slice(8, 10)))
  return from === to ? `${from} ${month}` : `${from}–${to} ${month}`
}

/**
 * True when an instant (`2026-09-10T…Z`) or an IST date (`2026-09-12`, read as its IST midnight) is more
 * than a day behind `nowMs` — the flow strip's ochre rule (UX-O-1): a step holding anything older than a
 * day is money stuck, not money moving.
 */
export function olderThanADay(at: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!at) return false
  const ms = at.length === 10 ? Date.parse(`${at}T00:00:00+05:30`) : Date.parse(at)
  return !Number.isNaN(ms) && nowMs - ms > DAY_MS
}

/**
 * A lot is past its date once its expiry day is behind today in IST (UX-O-2, DOS-261): B20251204, expiry
 * 31 Aug 2026, read "Sellable 20" on 27 Sep. The day of expiry itself still sells.
 */
export function isExpired(expiryDate: string | null | undefined, now: string = today()): boolean {
  return typeof expiryDate === 'string' && expiryDate.length >= 10 && expiryDate.slice(0, 10) < now
}

/** The last N whole months, as a month-grain window ending in the current month. */
export function monthsBack(count: number, now: string = today()): DateRange {
  const [y, m] = now.split('-').map(Number) as [number, number]
  const start = new Date(Date.UTC(y, m - 1 - (count - 1), 1))
  return {
    from: `${String(start.getUTCFullYear())}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`,
    to: now,
  }
}
