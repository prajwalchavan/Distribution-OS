/**
 * How much work is waiting, said as honestly as a page can say it.
 *
 * None of the list procedures this app calls answers a TOTAL — `PicklistsListOutput`,
 * `LoadSheetsListOutput` and their siblings answer ONE PAGE and a cursor. So a figure taken from
 * `items.length` is the page size whenever the cursor is not null, and on the pilot database that is
 * exactly what it was: "Waves open 40 against 315", "Sheets waiting 20 against 166", "Bills to count
 * 20 against 200+". `atLeast()` in `./ui` has said so on the home strip since the gate that measured
 * it; this module is that same rule, pulled out so the strip's figures and a panel's SENTENCE cannot
 * drift apart, and so it can be tested without a renderer.
 *
 * Two shapes, one rule:
 *   - `atLeast()` (in `./ui`) prints the FIGURE alone, for a strip of numbers.
 *   - `atLeastPl()` prints the figure inside its noun — "20+ waves still to pick" — for a panel's
 *     meta line, where the noun has to agree with the number as well.
 *
 * DOS-047, merge review. The two status reads that finding added to W4 and W7 are pages of twenty, and
 * the meta line that came with them summed `items.length` and printed "20 waves still to pick". W1
 * renders the very same two reads — `['picklists', 'open']` is literally the same cache key — through
 * `atLeast`, so the floor would have had one app disagreeing with itself about one number, and the
 * false half would have been the screen the picker works from.
 */

/** One page of a cursor-paged list procedure, as the contract's list outputs shape it. */
export interface QueuePage {
  readonly items: readonly unknown[]
  readonly nextCursor: string | null
}

/** What a set of pages knows about the queue behind it. */
export interface QueueDepth {
  /** The rows actually in hand. */
  readonly count: number
  /** At least one page stopped at its limit, so `count` is a floor and not a total. */
  readonly capped: boolean
}

/**
 * The depth of a queue read one page at a time, or `undefined` while any page is still unread.
 *
 * NO ANSWER IS NOT ZERO (the rule `atLeast` was written for): with the service stopped, four panels
 * reading "0" is a godown being told there is no work. An unread page has no figure at all.
 */
export function queueDepth(...pages: readonly (QueuePage | undefined)[]): QueueDepth | undefined {
  let count = 0
  let capped = false
  for (const page of pages) {
    if (page === undefined) return undefined
    count += page.items.length
    capped = capped || page.nextCursor !== null
  }
  return { count, capped }
}

/**
 * A queue depth written into its own sentence: "7 waves still to pick", "20+ waves still to pick".
 *
 * `key` is a `pl()` pair — `key` and `key.one` — because the noun has to agree with the number, and
 * the figure goes in through `w1.atLeast` ("{count}+") whenever a page was capped. `undefined` means
 * there is nothing to print: either no page has been read yet, or there is genuinely no work, and a
 * panel says that by leaving its meta line off rather than by printing a zero.
 */
export function atLeastPl(
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  key: string,
  ...pages: readonly (QueuePage | undefined)[]
): string | undefined {
  const depth = queueDepth(...pages)
  if (depth === undefined || depth.count === 0) return undefined
  return t(depth.count === 1 && !depth.capped ? `${key}.one` : key, {
    count: depth.capped ? t('w1.atLeast', { count: depth.count }) : depth.count,
  })
}
