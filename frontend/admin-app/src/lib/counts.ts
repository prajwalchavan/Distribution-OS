/**
 * How many rows of a paged list belong on a work list, said honestly — and said in the right number.
 *
 * Nothing here renders, so the rules are testable in Node; the home screen passes its own pages in.
 */

export interface PageCount {
  /** What goes on screen: `3`, `50+`, or `—` while there is nothing to show. */
  label: string
  /** What is actually on the page, for a colour or a comparison. */
  value: number
}

/**
 * A cursor list has no total, so a page that came back FULL and still has a cursor prints "50+"
 * rather than pretending 50 is the answer — the same rule the warehouse home strip settled on. When
 * `keep` throws rows away the "+" goes with them: a page of 200 that yields 3 is 3, not "3+", and
 * only a page where every row survived can have more behind it.
 */
export function pageCount<Row>(
  list: { items: readonly Row[]; nextCursor: string | null } | undefined,
  keep: (row: Row) => boolean = () => true,
): PageCount {
  if (list === undefined) return { label: '—', value: 0 }
  const n = list.items.filter(keep).length
  const more = list.nextCursor !== null && n === list.items.length
  return { label: `${n.toLocaleString('en-IN')}${more ? '+' : ''}`, value: n }
}

/**
 * Which of two locale keys a count takes (DOS-114): the home tile read "1 support requests waiting
 * for an owner".
 *
 * There is no plural FORM in this product, deliberately — Hindi and Marathi do not share English's
 * one-or-many rule, so a sentence that can be about one thing gets two keys and the screen picks,
 * exactly as `p7.membershipOne` / `p7.membershipCount` already do. The singular is chosen from the
 * LABEL and not from the value: a full page of one row with more behind it reads "1+", which is not
 * one and takes the plural.
 */
export function countKey(count: PageCount, one: string, many: string): string {
  return count.label === '1' ? one : many
}
