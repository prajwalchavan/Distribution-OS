/**
 * DOS-217 — when the desk may post a goods receipt, decided by the state the SERVER posts from.
 *
 * The Post button used to be enabled only while `grn.status === 'counting'`, and `grns.post` accepts
 * only `reconciled` (`grn.service.ts`: "GRN is counting; count every line before posting"). A count
 * that covers every line moves the receipt to `reconciled` in the same transaction
 * (`grns.count`: `status: complete ? 'reconciled' : 'counting'`), so the two conditions never
 * overlapped: no receipt counted in the one app could be posted from it, and the day-1 simulation's
 * stock-in stopped at the desk with the button greyed and "4 of 4 lines counted" printed as its reason.
 *
 * The rule is now the server's own: `reconciled` posts; `counting` says how many lines the gate still
 * owes and which; `posted` and `cancelled` say what the receipt already is. Pure: no React, no kit.
 */

export interface ReceiptForPost {
  status: 'counting' | 'reconciled' | 'posted' | 'cancelled'
  lines: readonly { id: string; variantId: string; countedQtyPcs: number | null }[]
}

export type PostReadiness =
  | { canPost: true; done: number; total: number; missing: readonly string[] }
  | {
      canPost: false
      reason: 'notCounted' | 'partlyCounted' | 'posted' | 'cancelled'
      done: number
      total: number
      /** Variant ids of the lines the gate has not counted, in receipt order. */
      missing: readonly string[]
    }

export function postReadiness(grn: ReceiptForPost): PostReadiness {
  const total = grn.lines.length
  const missing = grn.lines.filter((line) => line.countedQtyPcs === null).map((l) => l.variantId)
  const done = total - missing.length
  if (grn.status === 'reconciled') return { canPost: true, done, total, missing }
  if (grn.status === 'posted') return { canPost: false, reason: 'posted', done, total, missing }
  if (grn.status === 'cancelled')
    return { canPost: false, reason: 'cancelled', done, total, missing }
  return {
    canPost: false,
    reason: done === 0 ? 'notCounted' : 'partlyCounted',
    done,
    total,
    missing,
  }
}
