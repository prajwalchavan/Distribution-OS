import { cell, sheetRecords, type SheetRecord } from './sheets.js'
import { clean, isoDate, rupeesToPaise } from './text.js'
import type { Issue, LegacyBill, Parsed } from './types.js'

/** The columns of `DateWiseOutStanding.xlsx` the importer reads. */
export const OUTSTANDING_COLUMNS = [
  'BOOK_CODE',
  'BILL_NO',
  'SAL_YEAR',
  'CASH_ACC',
  'ACC_TITLE',
  'AREA_NAME',
  'BILL_DATE',
  'DUE_DATE',
  'SAL_AMT',
  'TOT_RCT',
] as const

export function outstandingRecords(rows: readonly (readonly string[])[]): SheetRecord[] {
  return sheetRecords(rows, OUTSTANDING_COLUMNS, 'outstanding report')
}

/**
 * One row is one open BILL of one customer. Its key in the old book is BOOK_CODE + SAL_YEAR + BILL_NO
 * (a bill number restarts every sales year and every book), which is also the importer's idempotency key.
 */
export function billKey(b: Pick<LegacyBill, 'bookCode' | 'salYear' | 'billNo'>): string {
  return `${b.bookCode}|${b.salYear}|${b.billNo}`
}

export function parseOutstandingRows(records: readonly SheetRecord[]): Parsed<LegacyBill> {
  const items: LegacyBill[] = []
  const issues: Issue[] = []
  const seen = new Set<string>()
  for (const r of records) {
    const ref = `outstanding:${String(r.row)}`
    const bookCode = clean(cell(r, 'BOOK_CODE'))
    const salYear = clean(cell(r, 'SAL_YEAR'))
    const billNo = clean(cell(r, 'BILL_NO'))
    const cashAcc = clean(cell(r, 'CASH_ACC'))
    if (bookCode === '' || salYear === '' || billNo === '' || cashAcc === '') {
      issues.push({ kind: 'record-incomplete', ref })
      continue
    }
    const amountPaise = rupeesToPaise(cell(r, 'SAL_AMT'))
    const receivedPaise = rupeesToPaise(cell(r, 'TOT_RCT')) ?? 0
    if (amountPaise === null) {
      issues.push({ kind: 'bad-amount', ref })
      continue
    }
    const billDate = isoDate(cell(r, 'BILL_DATE'))
    if (billDate === null) {
      issues.push({ kind: 'bad-date', ref })
      continue
    }
    const dueRaw = cell(r, 'DUE_DATE')
    const dueDate = isoDate(dueRaw)
    if (dueRaw !== '' && dueDate === null) issues.push({ kind: 'bad-date', ref })
    const key = billKey({ bookCode, salYear, billNo })
    if (seen.has(key)) {
      issues.push({ kind: 'duplicate-bill', ref })
      continue
    }
    seen.add(key)
    const credit = Number(cell(r, 'CRDAYS'))
    items.push({
      bookCode,
      salYear,
      billNo,
      cashAcc,
      title: clean(cell(r, 'ACC_TITLE')),
      areaName: clean(cell(r, 'AREA_NAME')),
      salesman: clean(cell(r, 'SALESMAN')),
      billDate,
      dueDate,
      amountPaise,
      receivedPaise,
      creditDays: Number.isFinite(credit) ? credit : 0,
      row: r.row,
    })
  }
  return { items, issues }
}
