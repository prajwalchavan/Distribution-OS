import { describe, expect, it } from 'vitest'
import {
  allocate,
  formatINR,
  fromRupees,
  multiply,
  paise,
  percentOf,
  roundToRupee,
  sum,
  toRupees,
} from './money.js'

describe('money', () => {
  it('parses rupees exactly', () => {
    expect(fromRupees('21.16')).toBe(2116)
    expect(fromRupees('33,832.80')).toBe(3383280)
    expect(fromRupees('₹ 1,26,990')).toBe(12699000)
    expect(fromRupees(0.1)).toBe(10)
    expect(fromRupees('-5.5')).toBe(-550)
    expect(() => fromRupees('21.161')).toThrow()
    expect(() => paise(1.5)).toThrow()
  })

  it('formats with Indian grouping', () => {
    expect(toRupees(paise(2116))).toBe('21.16')
    expect(formatINR(paise(3383280))).toBe('₹33,832.80')
    expect(formatINR(paise(12699000))).toBe('₹1,26,990.00')
    expect(formatINR(paise(5))).toBe('₹0.05')
    expect(formatINR(paise(-150), { symbol: false })).toBe('-1.50')
  })

  it('reproduces real invoice arithmetic', () => {
    // Guru Kripa invoice: 180 pcs x 21.16 = 3,808.80
    expect(multiply(fromRupees('21.16'), 180)).toBe(fromRupees('3,808.80'))
    // CGST 2.5% on 33,832.80 = 845.82 (invoice printed 845.85 because it summed per-line tax)
    expect(percentOf(fromRupees('33,832.80'), 250)).toBe(fromRupees('845.82'))
    // 8.33% discount on 96 x 28.22 = 2,709.12 -> 225.67
    expect(percentOf(multiply(fromRupees('28.22'), 96), 833)).toBe(fromRupees('225.67'))
  })

  it('rounds invoice totals to the rupee and reports round-off', () => {
    expect(roundToRupee(fromRupees('35524.50'))).toEqual({ rounded: 3552500, roundOff: 50 })
    expect(roundToRupee(fromRupees('35524.49'))).toEqual({ rounded: 3552400, roundOff: -49 })
  })

  it('allocates without losing paise', () => {
    expect(allocate(paise(100), [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(paise(1001), [3, 1])).toEqual([751, 250])
    const parts = allocate(paise(4280166), [94801, 12345, 777])
    expect(sum(parts)).toBe(4280166)
  })
})
