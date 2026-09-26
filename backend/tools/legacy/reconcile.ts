import { billKey } from './outstanding.js'
import type { LegacyBill } from './types.js'

/**
 * How the outstanding REPORT compares with the outstanding REBUILT from the backup for the same day.
 * Counts and sums only. It is what tells the founder whether the report can be trusted as an opening
 * ledger (it cannot, when the report is date-filtered or stale) and whether the backup's receipts logic
 * reproduces it (it does, bill for bill, where the report has the bill).
 */
export interface BillReconciliation {
  reportBills: number
  rebuiltBills: number
  inBoth: number
  sameBalance: number
  differentBalance: number
  onlyInReport: number
  onlyInRebuilt: number
  reportOnlyPaise: number
  rebuiltOnlyPaise: number
  /** Bills only the rebuild has that are dated before the report's earliest bill: the report's date filter. */
  rebuiltOnlyBeforeReportStart: number
  reportStart: string | null
  reportEnd: string | null
}

const open = (b: LegacyBill): number => b.amountPaise - b.receivedPaise

export function reconcileBills(
  report: readonly LegacyBill[],
  rebuilt: readonly LegacyBill[],
): BillReconciliation {
  const theirs = new Map(rebuilt.map((b) => [billKey(b), b]))
  const mine = new Map(report.map((b) => [billKey(b), b]))
  let inBoth = 0
  let same = 0
  let onlyReport = 0
  let reportOnly = 0
  for (const [k, b] of mine) {
    const other = theirs.get(k)
    if (!other) {
      onlyReport++
      reportOnly += open(b)
      continue
    }
    inBoth++
    if (open(other) === open(b)) same++
  }
  const start = report.map((b) => b.billDate).sort()[0] ?? null
  const end =
    report
      .map((b) => b.billDate)
      .sort()
      .at(-1) ?? null
  let onlyRebuilt = 0
  let rebuiltOnly = 0
  let beforeStart = 0
  for (const [k, b] of theirs) {
    if (mine.has(k)) continue
    onlyRebuilt++
    rebuiltOnly += open(b)
    if (start !== null && b.billDate < start) beforeStart++
  }
  return {
    reportBills: report.length,
    rebuiltBills: rebuilt.length,
    inBoth,
    sameBalance: same,
    differentBalance: inBoth - same,
    onlyInReport: onlyReport,
    onlyInRebuilt: onlyRebuilt,
    reportOnlyPaise: reportOnly,
    rebuiltOnlyPaise: rebuiltOnly,
    rebuiltOnlyBeforeReportStart: beforeStart,
    reportStart: start,
    reportEnd: end,
  }
}
