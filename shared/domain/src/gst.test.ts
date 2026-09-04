import { describe, expect, it } from 'vitest'
import {
  financialYearLabel,
  isValidGstin,
  panFromGstin,
  splitGst,
  stateCodeFromGstin,
} from './gst.js'
import { fromRupees } from './money.js'

describe('gst', () => {
  it('splits intra-state supply into CGST + SGST', () => {
    // Guru Kripa -> Tarsun, both Maharashtra (27), 5% on 33,832.80
    const s = splitGst(fromRupees('33,832.80'), 500, '27', '27')
    expect(s.kind).toBe('intra')
    expect(s.cgst).toBe(fromRupees('845.82'))
    expect(s.sgst).toBe(fromRupees('845.82'))
    expect(s.igst).toBe(0)
    expect(s.total).toBe(fromRupees('35,524.44'))
  })

  it('charges IGST inter-state', () => {
    const s = splitGst(fromRupees('1000'), 1800, '27', '24')
    expect(s.kind).toBe('inter')
    expect(s.igst).toBe(fromRupees('180'))
    expect(s.cgst).toBe(0)
  })

  it('validates real GSTINs seen on invoices (business identifiers, public)', () => {
    for (const g of [
      '27CNGPP9039R1ZX',
      '27AAQFG4183L1ZR',
      '27AAGCG6502L1ZG',
      '27AABCR1718E1ZP',
      '27AAJCT0390E1ZD',
      '27AFGFS6287L1Z6',
    ]) {
      expect(isValidGstin(g), g).toBe(true)
    }
    expect(isValidGstin('27CNGPP9039R1ZY')).toBe(false)
    expect(isValidGstin('27CNGPP9039R1Z')).toBe(false)
    expect(isValidGstin('')).toBe(false)
  })

  it('derives state and PAN', () => {
    expect(stateCodeFromGstin('27CNGPP9039R1ZX')).toBe('27')
    expect(panFromGstin('27CNGPP9039R1ZX')).toBe('CNGPP9039R')
  })

  it('labels the Indian financial year', () => {
    expect(financialYearLabel(new Date(2026, 7, 11))).toBe('2026-27')
    expect(financialYearLabel(new Date(2027, 1, 1))).toBe('2026-27')
    expect(financialYearLabel(new Date(2027, 3, 1))).toBe('2027-28')
  })
})
