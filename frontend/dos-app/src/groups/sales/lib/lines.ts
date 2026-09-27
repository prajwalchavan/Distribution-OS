/**
 * DOS-227 — THE PIECES THE SCREEN PRICED ARE THE PIECES THE OFFICE BOOKS.
 *
 * A line on the order screen carries two things: `qtyPcs`, which the running total, the payable quote
 * and the credit check are all computed from, and `enteredQty` + `enteredUnit`, which is what the wire
 * carries (`OrderLineInput` has no pieces — the server derives them from its own sell-side pack size,
 * docs/17 A3). Nothing held the two together. "Repeat last order" copied an old line entered as
 * `3 inner` (pack 6, 18 pc) as `qtyPcs 18` for the screen and `3 piece` for the wire, so the rep read
 * ₹26,120 on 18 pc and the office booked 3 pc on ₹25,032 (SO-0889).
 *
 * Two rules close it, one at each end:
 *   - `repeatOf` copies an old line as the PIECES the shop was sent, in a unit this screen can enter
 *     (case or piece) and that turns back into exactly those pieces at today's pack size;
 *   - `wireOf` is the only way a draft line reaches the wire or the outbox: it keeps what the rep typed
 *     when that still means the pieces on screen, and otherwise sends the pieces themselves.
 */
import type { DraftLine } from './pricing'

/**
 * Pieces in `qty` of `unit`, as the server counts them TODAY (`packSizeFor` in
 * `backend/libs/core/src/modules/orders/pricing-lines.ts`): a piece is one, and an inner is priced at
 * the sell-side case size until the pack hierarchy is curated — so both it and a case are `caseSize`.
 */
export function piecesOfEntered(qty: number, unit: string, caseSize: number): number {
  return unit === 'piece' ? qty : qty * Math.max(1, caseSize)
}

/** An order line as the device holds it (`LocalOrderLine`), in the columns a repeat reads. */
export interface PastLine {
  variant_id: string
  entered_qty: number
  entered_unit: string
  pack_size_at_entry: number | null
  qty_pcs: number | null
}

/**
 * The shop's last order as a new draft, one tap from Place.
 *
 * The pieces are the pieces the shop was SENT (`qty_pcs`, frozen on the old line), never an entered
 * count re-read in another unit. A line entered in cases stays in cases only while its pack size is
 * unchanged — `2 cs` of 24 is still `2 cs`; if the case is now 12 those 48 pc are sent as 48 pc, not
 * as `2 cs` that would book 24. Any other unit (`inner` — this screen has no inner stepper) is sent as
 * pieces. A reward line (`qty_pcs 0`, the free goods of a scheme, DOS-185) is not something the shop
 * ordered and is not repeated: the scheme gives it again if it still applies.
 */
export function repeatOf(
  lines: readonly PastLine[],
  caseSizeOf: (variantId: string) => number,
  newId: () => string,
): DraftLine[] {
  const out: DraftLine[] = []
  for (const line of lines) {
    const caseSize = Math.max(1, caseSizeOf(line.variant_id))
    const qtyPcs =
      line.qty_pcs ??
      piecesOfEntered(line.entered_qty, line.entered_unit, line.pack_size_at_entry ?? caseSize)
    if (qtyPcs <= 0) continue
    const asCases = line.entered_unit === 'case' && line.entered_qty * caseSize === qtyPcs
    out.push({
      id: newId(),
      variantId: line.variant_id,
      qtyPcs,
      enteredQty: asCases ? line.entered_qty : qtyPcs,
      enteredUnit: asCases ? 'case' : 'piece',
    })
  }
  return out
}

/**
 * What a draft line sends: `enteredQty` + `enteredUnit` whose pieces, at `caseSize` (the same sell-side
 * pack size the server reads), are exactly `line.qtyPcs`. What the rep typed is kept whenever it still
 * says that; otherwise — a line restored from an older draft after the pack size moved, a repeated line,
 * anything whose two halves disagree — the pieces go as pieces. The office never books a count the
 * screen did not price.
 */
export function wireOf(
  line: Pick<DraftLine, 'qtyPcs' | 'enteredQty' | 'enteredUnit'>,
  caseSize: number,
): { enteredQty: number; enteredUnit: 'piece' | 'case' } {
  if (piecesOfEntered(line.enteredQty, line.enteredUnit, caseSize) === line.qtyPcs)
    return { enteredQty: line.enteredQty, enteredUnit: line.enteredUnit }
  return { enteredQty: line.qtyPcs, enteredUnit: 'piece' }
}
