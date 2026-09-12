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
