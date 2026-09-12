/**
 * M7's two load-sheet registers, as pure functions of the reads the screen makes.
 *
 * STUB (DOS-025, red first): these bodies encode the screen as it stands — one unfiltered register
 * in server order and no approval queue at all — so the specs fail on their assertions rather than
 * on a missing module. The real bodies replace them in the fix.
 */
import type { LoadSheetSummary } from '@dos/contracts'

/** The sheets not out of the godown yet. Today's screen has no such register. */
export function loadOutQueue(_drafts: readonly LoadSheetSummary[]): LoadSheetSummary[] {
  return []
}

/** The sheets already checked out or cancelled. Today's screen shows every row it read. */
export function loadOutHistory(rows: readonly LoadSheetSummary[]): LoadSheetSummary[] {
  return [...rows]
}
