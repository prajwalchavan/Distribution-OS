import { describe, expect, it } from 'vitest'
import { businessDate, daysBetween, financialYear, startOfBusinessDay } from './calendar.js'

describe('IST business dates', () => {
  it('keeps 31 March 23:40 IST in the old financial year', () => {
    const t = Date.UTC(2027, 2, 31, 18, 10) // 23:40 IST on 31 March 2027
    expect(businessDate(t).date).toBe('2027-03-31')
    expect(financialYear(t)).toBe('2026-27')
  })
  it('rolls the financial year at 00:00 IST on 1 April', () => {
    const t = Date.UTC(2027, 2, 31, 18, 30) // 00:00 IST on 1 April 2027
    expect(businessDate(t).date).toBe('2027-04-01')
    expect(financialYear(t)).toBe('2027-28')
  })
  it('labels the current FY for a September date', () => {
    expect(financialYear(Date.UTC(2026, 8, 4, 12))).toBe('2026-27')
  })
  it('computes the UTC instant of the IST day start', () => {
    const t = Date.UTC(2026, 8, 4, 3, 0) // 08:30 IST
    expect(startOfBusinessDay(t).toISOString()).toBe('2026-09-03T18:30:00.000Z')
  })
  it('counts whole days between ISO dates', () => {
    expect(daysBetween('2026-09-01', '2026-09-08')).toBe(7)
    expect(daysBetween('2026-03-31', '2026-04-01')).toBe(1)
  })
})
