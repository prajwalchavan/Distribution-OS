/**
 * DOS-134 — M20 pick and pack: after DOS-041 the `<QtyStepper>` steps whole cases only, so a FEFO
 * split row that asks for 6 pc or 18 pc off a 24-piece case could be recorded only as 0 or 24 —
 * `warehouse.picklists.pick` then refuses the whole case with a 400, per row, at the exact ask
 * (docs/23 §2.1, DOS-041's own rule). `<QtyStepper>` already carries `onOpenPieces` for exactly this
 * (the same affordance `credit-notes.tsx` uses `parsePieces` under, for a bill's `piecesLeftToCredit`
 * cap): a typed pieces entry, capped here at the row's own `requestedQtyPcs` so the 400 never happens.
 */
import { describe, expect, it } from 'vitest'

import { nextPiecesEntry } from './pick-pieces'

describe('DOS-134: the M20 pieces entry, capped at the row’s own ask', () => {
  it('accepts 6 pc and 18 pc — the two counts a whole-cases-only stepper could not save — each at its own row’s ask', () => {
    expect(nextPiecesEntry('6', 6)).toEqual({ ok: true, pieces: 6 })
    expect(nextPiecesEntry('18', 18)).toEqual({ ok: true, pieces: 18 })
    // Under the ask is fine too — a part pick, not just the exact figure.
    expect(nextPiecesEntry('4', 6)).toEqual({ ok: true, pieces: 4 })
  })

  it('refuses a count above the row’s ask before the server ever sees it — the 400 DOS-041 throws today', () => {
    expect(nextPiecesEntry('24', 6)).toEqual({ ok: false, reason: 'overAsk', askedQtyPcs: 6 })
    expect(nextPiecesEntry('19', 18)).toEqual({ ok: false, reason: 'overAsk', askedQtyPcs: 18 })
  })

  it('parses whole pieces only, and treats a blank field as nothing typed yet rather than zero', () => {
    expect(nextPiecesEntry('6 pc', 6)).toEqual({ ok: false, reason: 'unparseable' })
    expect(nextPiecesEntry('1.5', 6)).toEqual({ ok: false, reason: 'unparseable' })
    expect(nextPiecesEntry('', 6)).toEqual({ ok: false, reason: 'empty' })
  })
})
