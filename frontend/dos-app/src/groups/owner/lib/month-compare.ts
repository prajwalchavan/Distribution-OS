/**
 * "This month against last" as the owner asks it (UX-O-4): the days of this month so far against the SAME
 * days of last month, both summed from `reporting.series.sales` at day grain.
 *
 * `series.growth` answers month against WHOLE month, so on 27 Sep it compared 27 days with 31 and said
 * −53.42 %; like for like (1–27 Sep ₹22,55,223 against 1–27 Aug ₹42,13,759) it is −46.48 %. One read
 * from the 1st of last month to today (at most 62 days, inside the 92-day day-grain cap) feeds both sums.
 */
import { sameDaysLastMonth, type DateRange } from './dates'

interface Point {
  /** `YYYY-MM-DD` at day grain. */
  bucket: string
  value: number
}

const within = (bucket: string, range: DateRange): boolean => {
  const day = bucket.slice(0, 10)
  return day >= range.from && day <= range.to
}

export interface MonthCompare {
  current: DateRange
  previous: DateRange
  currentPaise: number
  previousPaise: number
  /** Whole-percent change, or null when last month had nothing to compare with. */
  changePct: number | null
}

/** The one window to read: from the 1st of last month to today. */
export function monthCompareWindow(now?: string): DateRange {
  const { current, previous } = sameDaysLastMonth(now)
  return { from: previous.from, to: current.to }
}

export function monthCompare(points: readonly Point[], now?: string): MonthCompare {
  const { current, previous } = sameDaysLastMonth(now)
  const add = (range: DateRange): number =>
    points.reduce((total, p) => (within(p.bucket, range) ? total + p.value : total), 0)
  const currentPaise = add(current)
  const previousPaise = add(previous)
  return {
    current,
    previous,
    currentPaise,
    previousPaise,
    changePct:
      previousPaise === 0
        ? null
        : Math.round(((currentPaise - previousPaise) / previousPaise) * 100),
  }
}
