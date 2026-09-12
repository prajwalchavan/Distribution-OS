/**
 * M7's two load-sheet registers, as pure functions of the two reads the screen makes (DOS-025).
 *
 * The screen reads `warehouse.loadSheets.list({ limit: 100 })` for the history and
 * `warehouse.loadSheets.list({ status: 'draft', limit: 100 })` for the sheets still in the godown. The
 * server answers both in `desc(id)` order. Real UUIDv7 ids make that newest first, but a draft still
 * sinks under any sheet built after it (van 1's waiting sheet below van 2's checked-out one), a draft
 * older than the newest hundred is never on the history page at all, and the demo seed's ids are sha1
 * hashes with no time in them: dos_qa's one draft sat at row 62 of 83 in a single register. So the
 * queue is its own read and its own register, ordered here for the person who has to act on it.
 */
import type { LoadSheetSummary } from '@dos/contracts'

/**
 * The sheets not out of the godown yet, in the order the manager acts on them: a sheet still waiting
 * for approval before one already approved, then the newest sheet date, then the newest built. The id
 * breaks only a tie that is otherwise exact, so the order holds between reads. A row that is not a
 * draft, or one already listed, is left out.
 */
export function loadOutQueue(drafts: readonly LoadSheetSummary[]): LoadSheetSummary[] {
  const seen = new Set<string>()
  const queue: LoadSheetSummary[] = []
  for (const row of drafts) {
    if (row.status !== 'draft' || seen.has(row.id)) continue
    seen.add(row.id)
    queue.push(row)
  }
  return queue.sort(byActionOrder)
}

/**
 * The sheets already checked out or cancelled, in the order the server answered them. A draft is left
 * out: it is in the queue above, and no sheet is listed twice.
 */
export function loadOutHistory(rows: readonly LoadSheetSummary[]): LoadSheetSummary[] {
  return rows.filter((row) => row.status !== 'draft')
}

/**
 * `sheetDate` is an IST `YYYY-MM-DD` and `createdAt` a `toISOString()` instant, both fixed width, so
 * comparing the text compares the time.
 */
function byActionOrder(a: LoadSheetSummary, b: LoadSheetSummary): number {
  const aWaiting = a.approvedAt === null
  const bWaiting = b.approvedAt === null
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1
  if (a.sheetDate !== b.sheetDate) return a.sheetDate > b.sheetDate ? -1 : 1
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1
  if (a.id !== b.id) return a.id > b.id ? -1 : 1
  return 0
}
