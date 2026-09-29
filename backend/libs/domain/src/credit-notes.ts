import { lineTax, type GstRate } from './gst.js'
import { shareOut } from './money.js'

/**
 * How many pieces of a bill line may still be credited: the one rule the server enforces when a credit
 * note is drafted and the manager app mirrors before it lets anyone press Draft. Pure and dependency-free,
 * like `priceOrder()`, so `CreditNotesService.draft()` and the Expo apps cannot drift apart.
 *
 * Free goods count: they left the godown on the bill and can come back on a return. Every earlier note on
 * the bill counts except a cancelled one; a DRAFT already holds its pieces.
 */

/**
 * `qtyPcs + freeQtyPcs - creditedPcs`. NOT clamped at zero: the server prints this figure in its refusal
 * ("only N pcs of ... are left to credit"), so it stays the raw difference. A screen clamps for display.
 */
export function piecesLeftToCredit(
  line: { readonly qtyPcs: number; readonly freeQtyPcs: number },
  creditedPcs: number,
): number {
  return line.qtyPcs + line.freeQtyPcs - creditedPcs
}

/**
 * Pieces already credited per invoice line, from the notes on one bill. The device mirror of
 * `CreditNotesService.creditedByLine` in the billing module: draft, issued and applied notes count,
 * cancelled notes do not. `state` is a plain string because this library cannot import the contracts.
 */
export function creditedPiecesByLine(
  notes: readonly {
    readonly state: string
    readonly lines: readonly { readonly invoiceLineId: string; readonly qtyPcs: number }[]
  }[],
): Map<string, number> {
  const credited = new Map<string, number>()
  for (const note of notes) {
    if (note.state === 'cancelled') continue
    for (const line of note.lines) {
      credited.set(line.invoiceLineId, (credited.get(line.invoiceLineId) ?? 0) + line.qtyPcs)
    }
  }
  return credited
}

/**
 * The taxable already credited per invoice line, from the notes on one bill (same states as
 * `creditedPiecesByLine`). The device mirror of the taxable half of `CreditNotesService.creditedByLine`.
 */
export function creditedTaxableByLine(
  notes: readonly {
    readonly state: string
    readonly lines: readonly { readonly invoiceLineId: string; readonly taxablePaise: number }[]
  }[],
): Map<string, number> {
  const credited = new Map<string, number>()
  for (const note of notes) {
    if (note.state === 'cancelled') continue
    for (const line of note.lines) {
      credited.set(line.invoiceLineId, (credited.get(line.invoiceLineId) ?? 0) + line.taxablePaise)
    }
  }
  return credited
}

/**
 * WHAT `qtyPcs` MORE PIECES OF A BILL LINE ARE WORTH WHEN THEY COME BACK (QA DOS-242): the line's own
 * TAXABLE — the list rate less its schemes, discounts and any order-level allocation, i.e. what the shop
 * was actually charged before GST — spread evenly over every piece the line carried, paid and free alike.
 * Never `rate × pieces`: the rate is the pre-scheme list price, and crediting at it hands the shop the
 * scheme money back on top of the goods (CN/9003 was 4 687 paise too much on a 3 % scheme line).
 *
 * Cumulative, so any sequence of partial returns adds up to the line to the paisa: the first `n` pieces are
 * worth `floor(taxable × n / pieces)`, a note for pieces `c+1 … c+q` is the difference of two such figures,
 * and the note that takes the LAST piece takes whatever of the line's taxable is still uncredited (never
 * below zero). A line with no charged value (free goods only, QA DOS-185) is worth nothing.
 */
export function creditableTaxable(
  line: { readonly qtyPcs: number; readonly freeQtyPcs: number; readonly taxablePaise: number },
  already: { readonly pcs: number; readonly taxablePaise: number },
  qtyPcs: number,
): number {
  const pieces = line.qtyPcs + line.freeQtyPcs
  if (pieces <= 0 || qtyPcs <= 0 || line.taxablePaise <= 0) return 0
  const left = Math.max(0, line.taxablePaise - already.taxablePaise)
  const upTo = Math.min(pieces, already.pcs + qtyPcs)
  if (upTo >= pieces) return left
  const worth = (n: number): number => Math.floor((line.taxablePaise * Math.max(0, n)) / pieces)
  return Math.min(left, Math.max(0, worth(upTo) - worth(already.pcs)))
}

/** One bill line of an order line, as a credit note reads it (QA DOS-337). */
export interface CreditSourceLine {
  id: string
  qtyPcs: number
  freeQtyPcs: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
}

/** What one line of a credit note takes back. */
export interface CreditedLine {
  invoiceLineId: string
  qtyPcs: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
}

/**
 * RETURNED PIECES OF ONE ORDER LINE, VALUED ON THE ORDER LINE (QA DOS-337; docs/22 §8, 2026-09-28, ruling 10).
 *
 * A bill writes one line per batch, and a returned piece is worth what the shop was charged a piece for the
 * ITEM on that bill — never more because the crew marked the batch that carried the free pieces, never less
 * because it marked another. So the pieces a note takes back are valued on all the bill lines of one order line
 * together (`creditableTaxable` over their pieces and their taxable, cumulative across every note on the bill):
 * returning every piece credits exactly the taxable billed for them, whichever batch lines the crew marks, and
 * the last paisa goes to the note that takes the last piece. Bills written before the ruling, with every free
 * piece on one batch line, are credited right the same way — the reader, not the bill, changes.
 *
 * The tax follows the same rule (`lineTax`): what the pieces credited so far are taxed at, less what earlier
 * notes already took, and the note that takes the last piece takes exactly what is left of the bill's own CGST,
 * SGST, IGST and cess for the order line. Each figure is shared over this note's lines of the order line by
 * largest remainder on their taxable.
 *
 * `asked` is this note's lines of this order line in order; `ceilingPaise` caps one (a rate-difference note
 * passes `rate × pieces`). `credited` is what earlier notes took from these bill lines.
 */
export function creditOrderLine(
  source: readonly CreditSourceLine[],
  rate: GstRate,
  interState: boolean,
  credited: { readonly pcs: number; readonly taxablePaise: number },
  asked: readonly { invoiceLineId: string; qtyPcs: number; ceilingPaise?: number | undefined }[],
): CreditedLine[] {
  const sum = (pick: (l: CreditSourceLine) => number): number =>
    source.reduce((s, l) => s + pick(l), 0)
  const whole = {
    qtyPcs: sum((l) => l.qtyPcs),
    freeQtyPcs: sum((l) => l.freeQtyPcs),
    taxablePaise: sum((l) => l.taxablePaise),
  }
  const billed = {
    cgstPaise: sum((l) => l.cgstPaise),
    sgstPaise: sum((l) => l.sgstPaise),
    igstPaise: sum((l) => l.igstPaise),
    cessPaise: sum((l) => l.cessPaise),
  }
  let pcs = credited.pcs
  let taxable = credited.taxablePaise
  const values = asked.map((a) => {
    const worth = creditableTaxable(whole, { pcs, taxablePaise: taxable }, a.qtyPcs)
    const value = Math.max(0, Math.min(a.ceilingPaise ?? worth, worth))
    pcs += a.qtyPcs
    taxable += value
    return value
  })
  // What `x` of this order line's taxable is taxed at: the bill's own figures once all of it is back.
  const taxAt = (x: number): typeof billed => {
    if (x >= whole.taxablePaise) return billed
    const t = lineTax(Math.max(0, x), rate, interState)
    return {
      cgstPaise: t.cgstPaise,
      sgstPaise: t.sgstPaise,
      igstPaise: t.igstPaise,
      cessPaise: t.cessPaise,
    }
  }
  const before = taxAt(credited.taxablePaise)
  const after = taxAt(taxable)
  const weights = values.map((v) => Math.max(0, v))
  const share = (key: keyof typeof billed): number[] =>
    shareOut(Math.max(0, after[key] - before[key]), weights)
  const cgst = share('cgstPaise')
  const sgst = share('sgstPaise')
  const igst = share('igstPaise')
  const cess = share('cessPaise')
  return asked.map((a, i) => ({
    invoiceLineId: a.invoiceLineId,
    qtyPcs: a.qtyPcs,
    taxablePaise: values[i] ?? 0,
    cgstPaise: cgst[i] ?? 0,
    sgstPaise: sgst[i] ?? 0,
    igstPaise: igst[i] ?? 0,
    cessPaise: cess[i] ?? 0,
  }))
}
