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

/**
 * `2026-08-01` → `Aug 2026`. A MONTH, printed as a month.
 *
 * The GSTR-1 banner names the return period, and a return period is a month — "GSTR-1 for 1 Aug"
 * reads as a date and is not one.
 */
export function monthName(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 7) return '—'
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return `${month} ${isoDate.slice(0, 4)}`
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

/** The four ranges the owner's charts and registers offer, as `{ from, to }` IST dates. */
export type RangeId = 'd7' | 'd30' | 'd90' | 'fy'

export interface DateRange {
  from: string
  to: string
}

export function rangeOf(id: RangeId, now: string = today()): DateRange {
  switch (id) {
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

/** The last N whole months, as a month-grain window ending in the current month. */
export function monthsBack(count: number, now: string = today()): DateRange {
  const [y, m] = now.split('-').map(Number) as [number, number]
  const start = new Date(Date.UTC(y, m - 1 - (count - 1), 1))
  return {
    from: `${String(start.getUTCFullYear())}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`,
    to: now,
  }
}

/**
 * Whole IST days from today to a business date: negative in the past, 0 today, positive ahead.
 *
 * The stock register drew every expiry as the same grey chip, so a batch that expired two days ago
 * ("4 Sep 2026", on the pilot's own godown rows) looked exactly like one good until April 2027 — on
 * the one screen whose job includes near-expiry. A date is a fact; how close it is is the decision.
 */
export function daysUntil(isoDate: string, now: string = today()): number {
  return daysBetween(now, isoDate)
}

/**
 * The instant IST midnight of a business date is, as the UTC string the device's tables hold.
 *
 * Every `started_at`, `created_at` and `submitted_at` on the phone is an ISO instant in UTC, and the
 * question a rep asks is "did I visit this shop TODAY" — an IST calendar question. Comparing the two
 * needs the boundary, not a timezone library: `2026-09-06` in IST begins at `2026-09-05T18:30:00Z`,
 * and ISO-8601 UTC strings compare correctly as text.
 */
export function startOfIstDay(isoDate: string = today()): string {
  return new Date(`${isoDate}T00:00:00+05:30`).toISOString()
}

/** An ISO instant → `4:45 pm` IST, with no date. The beat list has no room for one. */
export function clockOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const ist = new Date(ms + 330 * 60_000)
  const hours = ist.getUTCHours()
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0')
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${String(hour12)}:${minutes} ${suffix}`
}
