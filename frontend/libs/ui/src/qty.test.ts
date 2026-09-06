import { describe, expect, it } from 'vitest'

import { availableLine, caseLine, joinQty, qtyState, splitQty, stepByCase } from './qty.js'

describe('cases and pieces', () => {
  it('splits pieces into cases plus loose pieces', () => {
    expect(splitQty(48, 24)).toEqual({ cases: 2, loose: 0, pieces: 48 })
    expect(splitQty(54, 24)).toEqual({ cases: 2, loose: 6, pieces: 54 })
    expect(splitQty(0, 24)).toEqual({ cases: 0, loose: 0, pieces: 0 })
    expect(splitQty(23, 24)).toEqual({ cases: 0, loose: 23, pieces: 23 })
  })

  it('round-trips cases + loose -> pieces -> cases + loose for every real case size', () => {
    for (const caseSize of [12, 16, 24, 90, 96, 120, 144]) {
      for (const cases of [0, 1, 3, 17]) {
        for (const loose of [0, 1, caseSize - 1]) {
          const pieces = joinQty(cases, loose, caseSize)
          expect(pieces).toBe(cases * caseSize + loose)
          expect(splitQty(pieces, caseSize)).toEqual({ cases, loose, pieces })
        }
      }
    }
  })
})

describe('caseLine — dual unit, never toggled', () => {
  it('reads "2 cs = 48 pc" with no loose pieces', () => {
    expect(caseLine(48, 24)).toBe('2 cs = 48 pc')
  })

  it('reads "2 cs + 6 pc = 54 pc" with loose pieces', () => {
    expect(caseLine(54, 24)).toBe('2 cs + 6 pc = 54 pc')
  })

  it('states availability in whole cases', () => {
    expect(availableLine(960, 24)).toBe('40 cs available')
    expect(availableLine(23, 24)).toBe('0 cs available')
  })
})

describe('stepByCase — the + and - of the stepper', () => {
  it('steps by a whole case in either direction', () => {
    expect(stepByCase(48, 1, 24)).toBe(72)
    expect(stepByCase(48, -1, 24)).toBe(24)
  })

  it('never goes below zero', () => {
    expect(stepByCase(24, -1, 24)).toBe(0)
    expect(stepByCase(0, -1, 24)).toBe(0)
    expect(stepByCase(6, -1, 24)).toBe(0)
  })

  it('keeps loose pieces while stepping cases', () => {
    expect(stepByCase(54, 1, 24)).toBe(78)
    expect(splitQty(78, 24)).toEqual({ cases: 3, loose: 6, pieces: 78 })
  })

  it('refuses to divide by an impossible case size instead of producing NaN', () => {
    expect(stepByCase(48, 1, 0)).toBe(48)
    expect(stepByCase(48, 1, -3)).toBe(48)
  })
})

describe('qtyState', () => {
  it('is atZero with nothing ordered', () => {
    expect(qtyState({ pieces: 0 })).toBe('atZero')
  })

  it('accepts over-available and marks it, never blocks it', () => {
    expect(qtyState({ pieces: 500, availablePieces: 336 })).toBe('overAvailable')
    expect(qtyState({ pieces: 336, availablePieces: 336 })).toBe('default')
  })

  it('lets a business rule block, and disabled wins over everything', () => {
    expect(qtyState({ pieces: 48, blocked: true })).toBe('blocked')
    expect(qtyState({ pieces: 48, blocked: true, disabled: true })).toBe('disabled')
  })

  it('ignores availability when the caller does not know it', () => {
    expect(qtyState({ pieces: 500, availablePieces: null })).toBe('default')
    expect(qtyState({ pieces: 500 })).toBe('default')
  })
})
