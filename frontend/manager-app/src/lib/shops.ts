/**
 * M14 — the shop panel and the shops register, as pure functions of what the two reads answer.
 *
 * The screen holds the layout; everything that decides WHAT a figure or a row says lives here, where a
 * vitest can read it without a browser. Money is integer paise in and a formatted rupee string out, at
 * the edge and nowhere earlier.
 */
import { formatINR, paise } from '@dos/domain'

/**
 * The overdue figure printed under "Owes" on the shop panel (`m1.overdue`).
 *
 * `receivables.outstanding.get` answers integer paise, and the token this feeds is a plain `{amount}`
 * in the sentence — so the screen, not the string, decides how the number reads. `String(paise)` put
 * the database integer on the panel ("6042250 overdue" under "₹60,422.50", DOS-035); the money
 * formatter is the same one the home tile's overdue line uses.
 */
export function overdueAmount(overduePaise: number | null | undefined): string {
  return formatINR(paise(overduePaise ?? 0))
}
