/**
 * The godown's own order of business: what still needs a hand, then everything else.
 *
 * DOS-047. W4 and W7 each read ONE unfiltered page of the newest 30 rows, and on a floor whose
 * finished waves and checked-out sheets outnumber its live ones that page is entirely history: 30
 * `packed`/`picked` waves with the one wave being picked nowhere on it, 30 `confirmed` sheets with no
 * sign of the draft waiting to be counted out. The contract's list inputs take ONE status
 * (`PicklistsListInput.status`, `LoadSheetsListInput.status`), so the work is asked for by status —
 * one read per live status — and the unfiltered page still follows, for the history.
 *
 * Which leaves the one thing those reads cannot do for themselves: a live row is on its own page AND
 * on the unfiltered page, and the floor must see it once. Hence this — pure, so the rule is testable
 * without a renderer, and shared, so the two screens cannot drift apart.
 */

/**
 * Every row of every list, each one once, in the order of the list that reached it first.
 *
 * Call it with the live reads in the order the floor cares about them and the unfiltered page last.
 */
export function workFirst<T extends { readonly id: string }>(
  ...lists: readonly (readonly T[])[]
): readonly T[] {
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const list of lists)
    for (const row of list)
      if (!seen.has(row.id)) {
        seen.add(row.id)
        ordered.push(row)
      }
  return ordered
}
