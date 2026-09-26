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
      credited.set(
        line.invoiceLineId,
        (credited.get(line.invoiceLineId) ?? 0) + line.taxablePaise,
      )
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
  const worth = (n: number): number =>
    Math.floor((line.taxablePaise * Math.max(0, n)) / pieces)
  return Math.min(left, Math.max(0, worth(upTo) - worth(already.pcs)))
}
