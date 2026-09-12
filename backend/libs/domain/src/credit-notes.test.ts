import { describe, expect, it } from 'vitest'
import { creditedPiecesByLine, piecesLeftToCredit } from './credit-notes.js'

describe('piecesLeftToCredit', () => {
  it('DOS-021: piecesLeftToCredit counts free pieces and earlier credits — 40 pc leaves 40, 48 + 2 free leaves 50, 288 + 12 free with 6 credited leaves 294, 60 with 30 credited leaves 30', () => {
    // INV/0634 Sunbake Glucose 55 g: 40 pc billed, case of 120, nothing credited yet
    expect(piecesLeftToCredit({ qtyPcs: 40, freeQtyPcs: 0 }, 0)).toBe(40)
    // INV/0634 Campa Lemon: 48 billed + 2 free — the free pieces can come back too
    expect(piecesLeftToCredit({ qtyPcs: 48, freeQtyPcs: 2 }, 0)).toBe(50)
    // INV/0546 Campa Cola 750 ml: 288 + 12 free, 6 already on CN/0028
    expect(piecesLeftToCredit({ qtyPcs: 288, freeQtyPcs: 12 }, 6)).toBe(294)
    // INV/0619 Godavari Dahi 200 g: 60 billed, 30 already on CN/0056
    expect(piecesLeftToCredit({ qtyPcs: 60, freeQtyPcs: 0 }, 30)).toBe(30)

    // Not clamped: the server prints this figure in its refusal, so it must be the raw difference.
    expect(piecesLeftToCredit({ qtyPcs: 10, freeQtyPcs: 0 }, 12)).toBe(-2)
  })
})

describe('creditedPiecesByLine', () => {
  it('DOS-021: creditedPiecesByLine sums draft, issued and applied notes per invoice line and ignores cancelled notes', () => {
    const credited = creditedPiecesByLine([
      {
        state: 'draft',
        lines: [
          { invoiceLineId: 'line-a', qtyPcs: 5 },
          { invoiceLineId: 'line-b', qtyPcs: 2 },
        ],
      },
      { state: 'issued', lines: [{ invoiceLineId: 'line-a', qtyPcs: 6 }] },
      { state: 'applied', lines: [{ invoiceLineId: 'line-a', qtyPcs: 1 }] },
      {
        state: 'cancelled',
        lines: [
          { invoiceLineId: 'line-a', qtyPcs: 100 },
          { invoiceLineId: 'line-c', qtyPcs: 7 },
        ],
      },
    ])

    expect(credited.get('line-a')).toBe(12)
    expect(credited.get('line-b')).toBe(2)
    // a line that only a cancelled note touched has nothing credited
    expect(credited.has('line-c')).toBe(false)
    expect(credited.size).toBe(2)
    expect(creditedPiecesByLine([]).size).toBe(0)
  })
})
