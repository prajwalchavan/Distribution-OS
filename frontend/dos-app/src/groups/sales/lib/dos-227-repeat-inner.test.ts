/**
 * DOS-227 — "Repeat last order" of a line entered in inner packs.
 *
 * SO-0836 held Konkan Aloo Bhujia 400 g as `entered_qty 3, entered_unit 'inner', pack_size_at_entry 6,
 * qty_pcs 18`. The repeat showed and priced 18 pc but sent `{ enteredQty: 3, enteredUnit: 'piece' }`,
 * and the office booked SO-0889 with 3 pc. These pin both ends: the repeated line is 18 pieces, and
 * whatever the draft line remembers, what goes on the wire turns back into the pieces on the screen at
 * the server's own pack-size rule.
 */
import { describe, expect, it } from 'vitest'

import { piecesOfEntered, repeatOf, wireOf, type PastLine } from './lines'

const BHUJIA = 'variant-bhujia-400g'
const MARIE = 'variant-marie-light'
const CAMPA = 'variant-campa-orange'
const caseSizes = new Map([
  [BHUJIA, 6],
  [MARIE, 24],
  [CAMPA, 12],
])
const caseSizeOf = (variantId: string): number => caseSizes.get(variantId) ?? 1
let n = 0
const newId = (): string => `line-${String(++n)}`

/** What the server books for a wire line (`packSizeFor` × `enteredQty`). */
function booked(wire: { enteredQty: number; enteredUnit: string }, caseSize: number): number {
  return piecesOfEntered(wire.enteredQty, wire.enteredUnit, caseSize)
}

const so0836: PastLine[] = [
  { variant_id: MARIE, entered_qty: 4, entered_unit: 'case', pack_size_at_entry: 24, qty_pcs: 96 },
  { variant_id: BHUJIA, entered_qty: 3, entered_unit: 'inner', pack_size_at_entry: 6, qty_pcs: 18 },
  { variant_id: CAMPA, entered_qty: 14, entered_unit: 'piece', pack_size_at_entry: 1, qty_pcs: 14 },
]

describe('DOS-227 repeat last order', () => {
  it('copies an inner line as the 18 pieces the shop was sent, and books 18 — not 3', () => {
    const lines = repeatOf(so0836, caseSizeOf, newId)
    const bhujia = lines.find((line) => line.variantId === BHUJIA)
    expect(bhujia).toMatchObject({ qtyPcs: 18, enteredQty: 18, enteredUnit: 'piece' })
    const wire = wireOf(bhujia!, caseSizeOf(BHUJIA))
    expect(wire).toEqual({ enteredQty: 18, enteredUnit: 'piece' })
    expect(booked(wire, caseSizeOf(BHUJIA))).toBe(18)
  })

  it('keeps cases as cases and pieces as pieces while the pack size is unchanged', () => {
    const lines = repeatOf(so0836, caseSizeOf, newId)
    expect(lines.find((line) => line.variantId === MARIE)).toMatchObject({
      qtyPcs: 96,
      enteredQty: 4,
      enteredUnit: 'case',
    })
    expect(lines.find((line) => line.variantId === CAMPA)).toMatchObject({
      qtyPcs: 14,
      enteredQty: 14,
      enteredUnit: 'piece',
    })
    for (const line of lines)
      expect(booked(wireOf(line, caseSizeOf(line.variantId)), caseSizeOf(line.variantId))).toBe(
        line.qtyPcs,
      )
  })

  it('sends a case line as pieces once its case size has moved, so the count does not change', () => {
    // 2 cs of 24 = 48 pc last time; the case is 12 today — `2 case` would now book 24.
    const [line] = repeatOf(
      [
        {
          variant_id: 'v',
          entered_qty: 2,
          entered_unit: 'case',
          pack_size_at_entry: 24,
          qty_pcs: 48,
        },
      ],
      () => 12,
      newId,
    )
    expect(line).toMatchObject({ qtyPcs: 48, enteredQty: 48, enteredUnit: 'piece' })
  })

  it('does not repeat a scheme reward line (qty_pcs 0): the scheme gives it again if it applies', () => {
    const lines = repeatOf(
      [
        ...so0836,
        {
          variant_id: CAMPA,
          entered_qty: 5,
          entered_unit: 'piece',
          pack_size_at_entry: 1,
          qty_pcs: 0,
        },
      ],
      caseSizeOf,
      newId,
    )
    expect(lines).toHaveLength(3)
  })
})

describe('DOS-227 wireOf', () => {
  it('keeps what the rep typed when it still means the pieces on screen', () => {
    expect(wireOf({ qtyPcs: 48, enteredQty: 2, enteredUnit: 'case' }, 24)).toEqual({
      enteredQty: 2,
      enteredUnit: 'case',
    })
    expect(wireOf({ qtyPcs: 24, enteredQty: 24, enteredUnit: 'piece' }, 24)).toEqual({
      enteredQty: 24,
      enteredUnit: 'piece',
    })
  })

  it('sends the pieces when the two halves of a line disagree (the SO-0889 line itself)', () => {
    // Exactly what the old repeat produced: 18 pc on screen, `3 piece` remembered.
    expect(wireOf({ qtyPcs: 18, enteredQty: 3, enteredUnit: 'piece' }, 6)).toEqual({
      enteredQty: 18,
      enteredUnit: 'piece',
    })
    // A draft restored after the case went from 24 to 12: `2 case` on 48 pc.
    expect(wireOf({ qtyPcs: 48, enteredQty: 2, enteredUnit: 'case' }, 12)).toEqual({
      enteredQty: 48,
      enteredUnit: 'piece',
    })
  })
})
