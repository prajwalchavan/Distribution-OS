import { describe, expect, it } from 'vitest'
import {
  creditableTaxable,
  creditedPiecesByLine,
  creditedTaxableByLine,
  creditOrderLine,
  piecesLeftToCredit,
} from './credit-notes.js'
import { lineTax } from './gst.js'

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

describe('creditableTaxable (QA DOS-242)', () => {
  it('credits a returned piece at what the shop was charged after its scheme, never the list rate', () => {
    // INV/9026 Ekta oil: 24 pc at ₹124.00 less the 3 % scheme = taxable 288 672; 12 pc refused at the door.
    // The list rate would have been 12 × 12 400 = 148 800 (CN/9003, 4 687 paise too much with GST).
    const oil = { qtyPcs: 24, freeQtyPcs: 0, taxablePaise: 288_672 }
    expect(creditableTaxable(oil, { pcs: 0, taxablePaise: 0 }, 12)).toBe(144_336)
    // INV/9027 Navjeevan ghee: 7 pc, taxable 209 889 after the 6 % exclusive scheme; 4 pc damaged.
    const ghee = { qtyPcs: 7, freeQtyPcs: 0, taxablePaise: 209_889 }
    expect(creditableTaxable(ghee, { pcs: 0, taxablePaise: 0 }, 4)).toBe(119_936)
  })

  it('adds up to the line to the paisa over any run of partial returns', () => {
    const line = { qtyPcs: 7, freeQtyPcs: 0, taxablePaise: 209_889 }
    let already = { pcs: 0, taxablePaise: 0 }
    const parts: number[] = []
    for (const q of [1, 2, 3, 1]) {
      const worth = creditableTaxable(line, already, q)
      parts.push(worth)
      already = { pcs: already.pcs + q, taxablePaise: already.taxablePaise + worth }
    }
    expect(parts.reduce((s, v) => s + v, 0)).toBe(209_889)
    expect(creditableTaxable(line, { pcs: 0, taxablePaise: 0 }, 7)).toBe(209_889)
  })

  it('the last piece takes only what is still uncredited, never below zero (an old gross-rate note)', () => {
    const line = { qtyPcs: 10, freeQtyPcs: 0, taxablePaise: 9_000 }
    // an earlier note credited 5 pc at the list rate of 1 000: 5 000 of the 9 000 is gone
    expect(creditableTaxable(line, { pcs: 5, taxablePaise: 5_000 }, 5)).toBe(4_000)
    expect(creditableTaxable(line, { pcs: 9, taxablePaise: 9_500 }, 1)).toBe(0)
    // a partial one is capped by what is left too
    expect(creditableTaxable(line, { pcs: 2, taxablePaise: 8_900 }, 3)).toBe(100)
  })

  it('free goods: a gift line is worth nothing, a mixed line spreads its value over every piece', () => {
    expect(
      creditableTaxable(
        { qtyPcs: 0, freeQtyPcs: 6, taxablePaise: 0 },
        { pcs: 0, taxablePaise: 0 },
        6,
      ),
    ).toBe(0)
    const mixed = { qtyPcs: 10, freeQtyPcs: 2, taxablePaise: 12_000 }
    expect(creditableTaxable(mixed, { pcs: 0, taxablePaise: 0 }, 6)).toBe(6_000)
    expect(creditableTaxable(mixed, { pcs: 0, taxablePaise: 0 }, 12)).toBe(12_000)
    expect(creditableTaxable(mixed, { pcs: 0, taxablePaise: 0 }, 0)).toBe(0)
  })

  it('creditedTaxableByLine sums the taxable of every note but a cancelled one', () => {
    const credited = creditedTaxableByLine([
      { state: 'issued', lines: [{ invoiceLineId: 'a', taxablePaise: 100 }] },
      { state: 'draft', lines: [{ invoiceLineId: 'a', taxablePaise: 50 }] },
      { state: 'cancelled', lines: [{ invoiceLineId: 'a', taxablePaise: 999 }] },
    ])
    expect(credited.get('a')).toBe(150)
  })
})

describe('creditOrderLine — returned pieces valued on the order line (QA DOS-337, ruling 10)', () => {
  // F04 as billed before the ruling: 120 Glucose + 10 free at ₹7.44, 5 % off, over three batches with every free
  // piece on the last: taxable ₹339.26 / ₹459.42 / ₹49.48 (48 / 65 / 7 + 10 pieces).
  const rate = { gstBps: 1200, cessBps: 0 }
  const old = [
    { id: 'a', qtyPcs: 48, freeQtyPcs: 0, taxablePaise: 33_926 },
    { id: 'b', qtyPcs: 65, freeQtyPcs: 0, taxablePaise: 45_942 },
    { id: 'c', qtyPcs: 7, freeQtyPcs: 10, taxablePaise: 4_948 },
  ].map((l) => {
    const t = lineTax(l.taxablePaise, rate, false)
    return { ...l, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: 0, cessPaise: 0 }
  })
  const taxable = 33_926 + 45_942 + 4_948

  it('a returned piece is worth the same whichever batch line the crew marks', () => {
    const third = creditOrderLine(old, rate, false, { pcs: 0, taxablePaise: 0 }, [
      { invoiceLineId: 'a', qtyPcs: 16 },
      { invoiceLineId: 'b', qtyPcs: 21 },
      { invoiceLineId: 'c', qtyPcs: 4 },
    ])
    const perPiece = third.map((l) => l.taxablePaise / l.qtyPcs)
    // ₹848.16 over 130 pieces = ₹6.52 a piece on every line (the last line used to credit ₹2.91)
    for (const value of perPiece) expect(Math.abs(value - taxable / 130)).toBeLessThan(1)
    expect(third.reduce((s, l) => s + l.taxablePaise, 0)).toBe(Math.floor((taxable * 41) / 130))
  })

  it('returning every piece, in any order and any number of notes, credits exactly what was billed — never more', () => {
    const first = creditOrderLine(old, rate, false, { pcs: 0, taxablePaise: 0 }, [
      { invoiceLineId: 'c', qtyPcs: 17 },
      { invoiceLineId: 'a', qtyPcs: 5 },
    ])
    const done = {
      pcs: 22,
      taxablePaise: first.reduce((s, l) => s + l.taxablePaise, 0),
    }
    const rest = creditOrderLine(old, rate, false, done, [
      { invoiceLineId: 'a', qtyPcs: 43 },
      { invoiceLineId: 'b', qtyPcs: 65 },
    ])
    const all = [...first, ...rest]
    expect(all.reduce((s, l) => s + l.taxablePaise, 0)).toBe(taxable)
    const billedCgst = old.reduce((s, l) => s + l.cgstPaise, 0)
    expect(all.reduce((s, l) => s + l.cgstPaise, 0)).toBe(billedCgst)
    expect(all.reduce((s, l) => s + l.sgstPaise, 0)).toBe(billedCgst)
    // the 17 pieces of the free-goods batch are credited at the item's value, not 2.4× less
    expect(first[0]?.taxablePaise).toBe(Math.floor((taxable * 17) / 130))
  })

  it('a rate-difference note keeps its own ceiling', () => {
    const [line] = creditOrderLine(old, rate, false, { pcs: 0, taxablePaise: 0 }, [
      { invoiceLineId: 'a', qtyPcs: 10, ceilingPaise: 10 * 50 },
    ])
    expect(line?.taxablePaise).toBe(500)
    expect(line?.cgstPaise).toBe(lineTax(500, rate, false).cgstPaise)
  })
})
