import { describe, expect, it } from 'vitest'
import {
  addDays,
  clean,
  daysBetween,
  isoDate,
  nameKey,
  normaliseHsn,
  parseIndianMobile,
  percentToBps,
  rupeesToPaise,
  signedRupeesToPaise,
  stateCodeFromLabel,
  validStateCode,
} from './text.js'

describe('rupeesToPaise', () => {
  it('reads what a sheet writes without a float', () => {
    expect(rupeesToPaise('4.16')).toBe(416)
    expect(rupeesToPaise('4')).toBe(400)
    expect(rupeesToPaise('1,234.5')).toBe(123_450)
    expect(rupeesToPaise('0')).toBe(0)
    expect(rupeesToPaise(' 81 ')).toBe(8100)
  })
  it('rounds half-up on the third decimal, like the importer everywhere else', () => {
    expect(rupeesToPaise('247.619')).toBe(24_762)
    expect(rupeesToPaise('0.005')).toBe(1)
    expect(rupeesToPaise('0.004')).toBe(0)
    // a value a float cannot hold exactly
    expect(rupeesToPaise('1.005')).toBe(101)
  })
  it('refuses anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '-3', 'abc', '1.2.3', '1e3', '₹5', null, undefined])
      expect(rupeesToPaise(bad), String(bad)).toBeNull()
  })
  it('has a signed twin for credits', () => {
    expect(signedRupeesToPaise('-12.50')).toBe(-1250)
    expect(signedRupeesToPaise('12.50')).toBe(1250)
    expect(signedRupeesToPaise('-x')).toBeNull()
  })
})

describe('percentToBps', () => {
  it('reads slabs', () => {
    expect(percentToBps('5')).toBe(500)
    expect(percentToBps('2.5')).toBe(250)
    expect(percentToBps('40')).toBe(4000)
    expect(percentToBps('18%')).toBe(1800)
  })
  it('refuses nonsense and anything above 100', () => {
    expect(percentToBps('')).toBeNull()
    expect(percentToBps('x')).toBeNull()
    expect(percentToBps('101')).toBeNull()
  })
})

describe('parseIndianMobile', () => {
  it('accepts a ten-digit mobile in the shapes people type it', () => {
    expect(parseIndianMobile('9000000001')).toBe('+919000000001')
    expect(parseIndianMobile('09000000001')).toBe('+919000000001')
    expect(parseIndianMobile('+91 90000 00001')).toBe('+919000000001')
    expect(parseIndianMobile('919000000001')).toBe('+919000000001')
  })
  it('refuses the legacy placeholder, landlines and short numbers', () => {
    for (const bad of ['0', '', '022-2500000', '12345', '5000000001', null])
      expect(parseIndianMobile(bad), String(bad)).toBeNull()
  })
})

describe('normaliseHsn', () => {
  it('restores the zero a spreadsheet dropped', () => {
    expect(normaliseHsn('8135020')).toEqual({ hsn: '08135020', padded: true })
    expect(normaliseHsn('8013100')).toEqual({ hsn: '08013100', padded: true })
  })
  it('leaves 4, 6 and 8 digit codes alone', () => {
    expect(normaliseHsn('2009')).toEqual({ hsn: '2009', padded: false })
    expect(normaliseHsn('220110')).toEqual({ hsn: '220110', padded: false })
    expect(normaliseHsn('21069099')).toEqual({ hsn: '21069099', padded: false })
    expect(normaliseHsn('08135020')).toEqual({ hsn: '08135020', padded: false })
  })
  it('gives nothing for blank or absurd cells', () => {
    expect(normaliseHsn('')).toBeNull()
    expect(normaliseHsn(null)).toBeNull()
    expect(normaliseHsn('12')).toBeNull()
    expect(normaliseHsn('123456789')).toBeNull()
  })
})

describe('dates and states', () => {
  it('reads ISO dates and d/m/y, refuses impossible days', () => {
    expect(isoDate('2026-06-04')).toBe('2026-06-04')
    expect(isoDate('2026-06-04T00:00:00.000')).toBe('2026-06-04')
    expect(isoDate('4/6/2026')).toBe('2026-06-04')
    expect(isoDate('31/02/2026')).toBeNull()
    expect(isoDate('')).toBeNull()
  })
  it('counts and adds days', () => {
    expect(daysBetween('2026-06-04', '2026-09-26')).toBe(114)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('reads a GST state from a label and refuses non-places', () => {
    expect(stateCodeFromLabel('27 - Maharashtra')).toBe('27')
    expect(stateCodeFromLabel('98 -  Other Territory')).toBeNull()
    expect(stateCodeFromLabel('')).toBeNull()
    expect(validStateCode('7')).toBe('07')
    expect(validStateCode('39')).toBeNull()
  })
})

describe('names', () => {
  it('cleans whitespace and builds a punctuation-blind key', () => {
    expect(clean('  A  B   C ')).toBe('A B C')
    expect(nameKey('Shri  Ganesh-Kirana (Store)')).toBe('SHRIGANESHKIRANASTORE')
  })
})
