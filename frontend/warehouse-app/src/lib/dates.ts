/**
 * Every date this app sends or prints is an IST business date (`@dos/domain/calendar`).
 *
 * Nothing here re-implements a calendar: `businessDate()` and `daysBetween()` are the domain's, and
 * the only arithmetic is on the ISO string's own UTC midnight — which is exactly what the backend's
 * `windowDays()` does, so a window this app asks for is the window the register caps.
 */
import { businessDate, daysBetween } from '@dos/domain'

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

/** `2026-09-06` → `6 Sep`. Every date cell in a godown register. */
export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 10) return '—'
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return `${String(Number(isoDate.slice(8, 10)))} ${month}`
}

/** `2026-09-06` → `6 Sep 2026`. Detail panels and expiry dates, where the year matters. */
export function longDate(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 10) return '—'
  return `${shortDate(isoDate)} ${isoDate.slice(0, 4)}`
}

/** An ISO instant → `6 Sep, 4:45 pm` IST. Used for "as of", approvals and audit lines. */
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
 * Whole IST days from today to a business date: negative in the past, 0 today, positive ahead.
 *
 * A date is a fact; how close it is is the decision — and near-expiry is half of what a godown does,
 * so the expiry chip's colour comes from this and never from the string.
 */
export function daysUntil(isoDate: string, now: string = today()): number {
  return daysBetween(now, isoDate)
}
