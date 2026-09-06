import { describe, expect, it } from 'vitest'

import {
  abbreviateMoney,
  formatMoney,
  parseRupees,
  speakMoney,
  splitMoney,
  toEditableRupees,
} from './money.js'

describe('formatMoney', () => {
  it('groups the Indian way and always shows two decimals', () => {
    expect(formatMoney(1_84_200_00)).toBe('₹1,84,200.00')
    expect(formatMoney(2116)).toBe('₹21.16')
    expect(formatMoney(0)).toBe('₹0.00')
    expect(formatMoney(5)).toBe('₹0.05')
    expect(formatMoney(-450000)).toBe('-₹4,500.00')
  })

  it('drops the symbol for a column whose head already states it', () => {
    expect(formatMoney(51_23_00_00, { symbol: false })).toBe('5,12,300.00')
  })
})

describe('splitMoney — the composed hero', () => {
  it('separates sign, symbol, grouped rupees and the two paise digits', () => {
    expect(splitMoney(1_84_200_00)).toEqual({
      sign: '',
      symbol: '₹',
      integer: '1,84,200',
      fraction: '00',
    })
    expect(splitMoney(-2116)).toEqual({ sign: '-', symbol: '₹', integer: '21', fraction: '16' })
  })
})

describe('parseRupees — paise in, paise out, never a float', () => {
  it('accepts what a person actually types', () => {
    expect(parseRupees('1234')).toEqual({ ok: true, paise: 123400 })
    expect(parseRupees('1,234')).toEqual({ ok: true, paise: 123400 })
    expect(parseRupees('₹1,234.50')).toEqual({ ok: true, paise: 123450 })
    expect(parseRupees('1234.5')).toEqual({ ok: true, paise: 123450 })
    expect(parseRupees('12.')).toEqual({ ok: true, paise: 1200 })
    expect(parseRupees(' -21.16 ')).toEqual({ ok: true, paise: -2116 })
  })

  it('returns an integer number of paise for every value it accepts', () => {
    for (const text of ['0.01', '0.1', '99999.99', '21.16', '1,00,000.05']) {
      const result = parseRupees(text)
      expect(result.ok).toBe(true)
      if (result.ok) expect(Number.isInteger(result.paise)).toBe(true)
    }
  })

  it('never loses a paisa to binary floating point', () => {
    // 21.16 * 100 is 2115.9999999999998 in IEEE 754; the parser must still answer 2116.
    expect(parseRupees('21.16')).toEqual({ ok: true, paise: 2116 })
    expect(parseRupees('1.10')).toEqual({ ok: true, paise: 110 })
    expect(parseRupees('80.70')).toEqual({ ok: true, paise: 8070 })
  })

  it('separates "empty" from "unparseable" so a field can tell them apart', () => {
    expect(parseRupees('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseRupees('₹')).toEqual({ ok: false, reason: 'empty' })
    expect(parseRupees('abc')).toEqual({ ok: false, reason: 'unparseable' })
    expect(parseRupees('1.234')).toEqual({ ok: false, reason: 'unparseable' })
    expect(parseRupees('1.2.3')).toEqual({ ok: false, reason: 'unparseable' })
  })

  it('round-trips through the editable form', () => {
    for (const paise of [0, 5, 110, 2116, 123450, -450000]) {
      const text = toEditableRupees(paise)
      expect(parseRupees(text)).toEqual({ ok: true, paise })
    }
    expect(toEditableRupees(null)).toBe('')
  })
})

describe('speakMoney', () => {
  it('gives a screen reader words, not digits', () => {
    expect(speakMoney(184200)).toBe('1842 rupees')
    expect(speakMoney(2116)).toBe('21 rupees 16 paise')
  })
})

describe('abbreviateMoney — axes only', () => {
  it('uses lakh and crore', () => {
    expect(abbreviateMoney(0)).toBe('₹0')
    expect(abbreviateMoney(50000)).toBe('₹500')
    expect(abbreviateMoney(1_20_000_00)).toBe('₹1.2L')
    expect(abbreviateMoney(4_20_000_00)).toBe('₹4.2L')
    expect(abbreviateMoney(3_50_00_000_00)).toBe('₹3.5Cr')
  })
})
