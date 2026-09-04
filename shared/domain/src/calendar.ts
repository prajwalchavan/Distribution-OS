/**
 * Business dates are Indian Standard Time, always. A pack at 23:40 IST on 31 March (18:10 UTC) belongs to the
 * old financial year; "collected today", ageing buckets and day-end all use these helpers, never Date.getDate().
 * IST has no daylight saving, so a fixed +05:30 offset is exact.
 */
export const IST_OFFSET_MINUTES = 330

export interface BusinessDate {
  /** ISO calendar date in IST, e.g. "2026-03-31". */
  date: string
  year: number
  month: number
  day: number
}

export function businessDate(at: Date | number = Date.now()): BusinessDate {
  const ms = typeof at === 'number' ? at : at.getTime()
  const shifted = new Date(ms + IST_OFFSET_MINUTES * 60_000)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year,
    month,
    day,
  }
}

/** Indian financial year label for an instant, e.g. 2026-09-04 IST -> "2026-27". Rolls at 00:00 IST on 1 April. */
export function financialYear(at: Date | number = Date.now()): string {
  const { year, month } = businessDate(at)
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** Start of the IST calendar day containing `at`, as a UTC instant (for "today" queries). */
export function startOfBusinessDay(at: Date | number = Date.now()): Date {
  const { year, month, day } = businessDate(at)
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MINUTES * 60_000)
}

/** Whole days between two IST calendar dates (for ageing buckets, credit days, cash-discount windows). */
export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const a = Date.UTC(
    Number(fromIsoDate.slice(0, 4)),
    Number(fromIsoDate.slice(5, 7)) - 1,
    Number(fromIsoDate.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(toIsoDate.slice(0, 4)),
    Number(toIsoDate.slice(5, 7)) - 1,
    Number(toIsoDate.slice(8, 10)),
  )
  return Math.round((b - a) / 86_400_000)
}

/** Device clocks drift; uploads more than this far from server time raise a sync warning (never a 4xx). */
export const MAX_CLOCK_SKEW_MS = 10 * 60_000
