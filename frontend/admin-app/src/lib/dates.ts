/**
 * Every date this console sends or prints is an IST business date (`@dos/domain/calendar`).
 *
 * Nothing here re-implements a calendar: `businessDate()` is the domain's, and the only arithmetic is
 * on the ISO string's own UTC midnight — which is exactly what the backend's `windowDays()` does, so
 * a window this app asks for is the window the register caps (docs/20 rule 3: ≤ 92 days).
 */
import { businessDate } from '@dos/domain'

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

/** `2026-09-06` → `6 Sep`. Axis labels and dense register cells. */
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

/** An ISO instant → `6 Sep 2026, 4:45 pm` IST. Audit rows, "as of", session times. */
export function instantWithClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const ist = new Date(ms + 330 * 60_000)
  const hours = ist.getUTCHours()
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0')
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${longDate(businessDate(ms).date)}, ${String(hour12)}:${minutes} ${suffix}`
}

/** Whole days from today to an IST date; negative when it has already gone. */
export function daysFromToday(isoDate: string | null | undefined, now: string = today()): number {
  if (!isoDate || isoDate.length < 10) return Number.NaN
  const at = Date.parse(`${isoDate}T00:00:00Z`)
  const from = Date.parse(`${now}T00:00:00Z`)
  return Math.round((at - from) / DAY_MS)
}

/**
 * How long until an instant, in the words a support window is read in: "3 h 40 min", "12 min", or
 * the empty string once it has passed. A countdown that has expired must never read "in -4 min".
 */
export function untilInstant(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms) || ms <= now) return ''
  const minutes = Math.floor((ms - now) / 60_000)
  if (minutes < 60) return `${String(Math.max(minutes, 1))} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24)
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`
  const days = Math.floor(hours / 24)
  return `${String(days)} d ${String(hours % 24)} h`
}

/** Bytes as a distributor's storage bill reads them: `13.1 MB`, `2.4 GB`. Never a raw integer. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['kB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit] ?? 'TB'}`
}
