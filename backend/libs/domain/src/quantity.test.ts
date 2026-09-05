import { describe, expect, it } from 'vitest'
import { formatQty, parseCaseSizeFromName, pieces, toCasesAndPieces, toPieces } from './quantity.js'

describe('quantity', () => {
  it('converts cases and loose pieces both ways', () => {
    expect(toPieces(2, 0, 90)).toBe(180)
    expect(toPieces(1, 5, 108)).toBe(113)
    expect(toCasesAndPieces(pieces(180), 90)).toEqual({ cases: 2, pieces: 0 })
    expect(toCasesAndPieces(pieces(113), 108)).toEqual({ cases: 1, pieces: 5 })
    expect(() => toPieces(1, 0, 0)).toThrow()
    expect(() => pieces(-1)).toThrow()
  })

  it('formats for pick lists', () => {
    expect(formatQty(pieces(183), 90)).toBe('2 cs + 3 pcs')
    expect(formatQty(pieces(90), 90)).toBe('1 cs')
    expect(formatQty(pieces(0), 90)).toBe('0 pcs')
    expect(formatQty(pieces(7), 90, { cs: 'पेटी', pcs: 'नग' })).toBe('7 नग')
  })

  it('parses case sizes from real supplier item names', () => {
    expect(parseCaseSizeFromName('MOM Makhana 12g - Himalayan Salt N Paper x 90')).toBe(90)
    expect(parseCaseSizeFromName('MOM Kerala Banana Chips Classic Salted 24g x 108')).toBe(108)
    expect(parseCaseSizeFromName('MOM Panchameva 20G Pouch x 144')).toBe(144)
    expect(parseCaseSizeFromName('TY!Wafers Chilli 21.5G(16+5.5)_120')).toBe(120)
    expect(parseCaseSizeFromName('TY! CHIPS SPANISHTOMATO22G(15+7g)120EWS')).toBeNull()
    expect(parseCaseSizeFromName('SURE WATER BY CAMPA 1L 2.0')).toBeNull()
  })
})
