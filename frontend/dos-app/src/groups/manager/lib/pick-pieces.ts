/**
 * DOS-134 — M20's typed pieces entry, capped at the row's own ask.
 *
 * After DOS-041 the `<QtyStepper>` on Pick & pack steps whole cases only; a FEFO split routinely asks
 * for less than one case on a row (6 pc, 18 pc off a 24-piece case), and `warehouse.picklists.pick`
 * refuses anything above THAT ROW'S `requestedQtyPcs` with a 400. `<QtyStepper>` already carries
 * `onOpenPieces` for exactly this gap, and `credit-notes.tsx` already parses a typed piece count with
 * `parsePieces` (there capped at what is left to credit); this is the same decision, capped here at
 * the pick row's ask instead, as a pure function so the cap is provable without mounting the screen.
 */
import { parsePieces } from '@dos/ui'

export type PiecesEntryResult =
  | { readonly ok: true; readonly pieces: number }
  | { readonly ok: false; readonly reason: 'empty' }
  | { readonly ok: false; readonly reason: 'unparseable' }
  | { readonly ok: false; readonly reason: 'overAsk'; readonly askedQtyPcs: number }

export function nextPiecesEntry(text: string, askedQtyPcs: number): PiecesEntryResult {
  const parsed = parsePieces(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason === 'empty' ? 'empty' : 'unparseable' }
  if (parsed.pieces > askedQtyPcs) return { ok: false, reason: 'overAsk', askedQtyPcs }
  return { ok: true, pieces: parsed.pieces }
}
