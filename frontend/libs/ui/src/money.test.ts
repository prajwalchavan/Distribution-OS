import { describe, expect, it } from 'vitest'

import {
  abbreviateMoney,
  formatMoney,
  formatPadEntry,
  MONEY_PAD_KEYS,
  padEntryFromPaise,
  paiseFromPadEntry,
  parseRupees,
  pressMoneyPadKey,
  reconcilePadEntry,
  speakMoney,
  splitMoney,
  toEditableRupees,
  type MoneyPadKey,
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

/**
 * DOS-060. The phone's amount pad appended every tap as a PAISE digit, so a driver typing 4 7 5 6 for a
 * ₹4,756 bill recorded ₹47.56, while the web field on the same screen took "7856" as ₹7,856.00. The
 * pad now enters rupees and reaches paise only through an explicit '.'. Both renderers press their
 * keys through these helpers (parity.test.ts pins that), so this is where the rule itself is pinned.
 */
describe('the money pad enters rupees, paise only after "." (DOS-060)', () => {
  const tap = (keys: readonly MoneyPadKey[], from = ''): string =>
    keys.reduce((entry, key) => pressMoneyPadKey(entry, key), from)

  it('DOS-060: typing 4 7 5 6 on the money pad is ₹4,756.00 (475600 paise), not ₹47.56', () => {
    const entry = tap(['4', '7', '5', '6'])
    expect(entry).toBe('4756')
    expect(paiseFromPadEntry(entry)).toBe(475600)
    expect(formatPadEntry(entry)).toBe('₹4,756')
    expect(formatMoney(paiseFromPadEntry(entry) ?? 0)).toBe('₹4,756.00')
  })

  it("DOS-060: paise only after an explicit '.': 4 7 5 6 . 5 0 is 475650; a third decimal digit and a second '.' are ignored", () => {
    const entry = tap(['4', '7', '5', '6', '.', '5', '0'])
    expect(entry).toBe('4756.50')
    expect(paiseFromPadEntry(entry)).toBe(475650)
    expect(tap(['5'], entry)).toBe('4756.50')
    expect(tap(['.'], entry)).toBe('4756.50')
    expect(tap(['4', '7', '.', '.', '5'])).toBe('47.5')
    expect(paiseFromPadEntry('47.5')).toBe(4750)
    // The preview shows what was typed, grouped, never a guessed ".00" while the paise are being entered.
    expect(formatPadEntry('4756.')).toBe('₹4,756.')
    expect(formatPadEntry('4756.5')).toBe('₹4,756.5')
    expect(formatPadEntry('4756.50')).toBe('₹4,756.50')
  })

  it("DOS-060: back, clear and a leading zero behave like a calculator ('.' first reads ₹0., back to empty is null, 0 then 5 is ₹5)", () => {
    expect(tap(['.'])).toBe('0.')
    expect(formatPadEntry('0.')).toBe('₹0.')
    expect(paiseFromPadEntry(tap(['.', '5']))).toBe(50)
    expect(paiseFromPadEntry(tap(['0', '.', '0', '5']))).toBe(5)

    expect(tap(['0', '5'])).toBe('5')
    expect(formatPadEntry('5')).toBe('₹5')
    expect(paiseFromPadEntry('5')).toBe(500)
    expect(tap(['0', '0'])).toBe('0')

    expect(tap(['4', '7', '5', '6', 'back'])).toBe('475')
    expect(tap(['4', '7', '.', '5', 'back', 'back'])).toBe('47')
    expect(tap(['4', 'back'])).toBe('')
    expect(tap(['back'])).toBe('')
    expect(paiseFromPadEntry('')).toBeNull()
    expect(formatPadEntry('')).toBe('₹0')

    expect(tap(['4', '7', '.', '5', 'clear'])).toBe('')
  })

  it("DOS-060: an amount already in the field reopens as rupees and round-trips (475600 -> '4756', 3584312 -> '35843.12')", () => {
    expect(padEntryFromPaise(475600)).toBe('4756')
    expect(padEntryFromPaise(3584312)).toBe('35843.12')
    expect(padEntryFromPaise(450050)).toBe('4500.50')
    expect(padEntryFromPaise(5)).toBe('0.05')
    expect(padEntryFromPaise(0)).toBe('0')
    expect(padEntryFromPaise(null)).toBe('')
    // There is no minus key: the pad shows the size of the amount, as it always did.
    expect(padEntryFromPaise(-450000)).toBe('4500')
    for (const paise of [0, 5, 50, 110, 2116, 475600, 475650, 2250800, 3584312]) {
      expect(paiseFromPadEntry(padEntryFromPaise(paise))).toBe(paise)
    }
    // ⌫ on a reopened amount takes off the last paise digit, not a rupee.
    expect(paiseFromPadEntry(tap(['back'], padEntryFromPaise(3584312)))).toBe(3584310)
  })

  it("DOS-060: a pending '4756.' survives the parent storing 475600, and an entry the parent overrode (cleared, value fell back to 3584312) shows the parent's value", () => {
    const pending = tap(['4', '7', '5', '6', '.'])
    const stored = paiseFromPadEntry(pending)
    expect(stored).toBe(475600)
    expect(reconcilePadEntry(pending, stored)).toBe('4756.')
    expect(paiseFromPadEntry(tap(['5'], reconcilePadEntry(pending, stored)))).toBe(475650)

    // retailer Pay renders `amount ?? owed`: Clear emits null, the field still holds what is owed.
    const cleared = tap(['clear'], padEntryFromPaise(3584312))
    expect(paiseFromPadEntry(cleared)).toBeNull()
    expect(reconcilePadEntry(cleared, 3584312)).toBe('35843.12')
    expect(formatPadEntry(reconcilePadEntry(cleared, 3584312))).toBe('₹35,843.12')

    // A value changed from outside replaces whatever was typed.
    expect(reconcilePadEntry('4756', 2250800)).toBe('22508')

    // The preview can never disagree with the value that will be committed.
    for (const entry of ['', '0.', '4756', '4756.', '35843.1']) {
      for (const value of [null, 0, 5, 475600, 3584312]) {
        expect(paiseFromPadEntry(reconcilePadEntry(entry, value))).toBe(value)
      }
    }
  })

  it("DOS-060: the phone pad and the web text field agree on 7856 (paiseFromPadEntry of the typed keys equals parseRupees('7856') = 785600)", () => {
    expect(parseRupees('7856')).toEqual({ ok: true, paise: 785600 })
    expect(paiseFromPadEntry(tap(['7', '8', '5', '6']))).toBe(785600)
    expect(parseRupees('7856.5')).toEqual({
      ok: true,
      paise: paiseFromPadEntry(tap(['7', '8', '5', '6', '.', '5'])),
    })
  })

  it("DOS-060: MONEY_PAD_KEYS carries '.' and no 'clear', and the ₹9,99,99,99,999.99 ceiling matches today's 12-digit paise cap", () => {
    expect(MONEY_PAD_KEYS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'])
    expect(MONEY_PAD_KEYS).not.toContain('clear')

    const tenDigits = tap(['9', '9', '9', '9', '9', '9', '9', '9', '9', '9'])
    expect(tenDigits).toBe('9999999999')
    expect(tap(['9'], tenDigits)).toBe(tenDigits)
    const ceiling = tap(['.', '9', '9'], tenDigits)
    expect(ceiling).toBe('9999999999.99')
    expect(paiseFromPadEntry(ceiling)).toBe(999_999_999_999)
    expect(String(paiseFromPadEntry(ceiling))).toHaveLength(12)
    expect(formatPadEntry(ceiling)).toBe('₹9,99,99,99,999.99')
  })
})
