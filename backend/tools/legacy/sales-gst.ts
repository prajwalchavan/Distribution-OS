import { cell, sheetRecords, type SheetRecord } from './sheets.js'
import { clean, isoDate, percentToBps, rupeesToPaise } from './text.js'
import type { Issue, LegacySalesGstRow, Parsed } from './types.js'

/** The columns of `SalesGstGSTWISE.xlsx` the importer reads (a month's GST sales register, one row per bill and slab). */
export const SALES_GST_COLUMNS = [
  'GST',
  'ACC_TITLE',
  'STATE',
  'BILL_NO',
  'BILL_DATE',
  'CASH_ACC',
  'STAXABLE_AMT',
  'ITAX_RATE',
  'AMT',
] as const

export function salesGstRecords(rows: readonly (readonly string[])[]): SheetRecord[] {
  return sheetRecords(rows, SALES_GST_COLUMNS, 'sales GST register')
}

export function parseSalesGstRows(records: readonly SheetRecord[]): Parsed<LegacySalesGstRow> {
  const items: LegacySalesGstRow[] = []
  const issues: Issue[] = []
  for (const r of records) {
    const ref = `sales-gst:${String(r.row)}`
    const cashAcc = clean(cell(r, 'CASH_ACC'))
    const billNo = clean(cell(r, 'BILL_NO'))
    const billDate = isoDate(cell(r, 'BILL_DATE'))
    if (cashAcc === '' || billNo === '') {
      issues.push({ kind: 'record-incomplete', ref })
      continue
    }
    if (billDate === null) {
      issues.push({ kind: 'bad-date', ref })
      continue
    }
    items.push({
      cashAcc,
      gstinRaw: clean(cell(r, 'GST')).toUpperCase(),
      stateLabel: clean(cell(r, 'STATE')),
      billNo,
      billDate,
      taxablePaise: rupeesToPaise(cell(r, 'STAXABLE_AMT')) ?? 0,
      totalPaise: rupeesToPaise(cell(r, 'AMT')) ?? 0,
      gstSlabBps: percentToBps(cell(r, 'ITAX_RATE')) ?? 0,
      row: r.row,
    })
  }
  return { items, issues }
}

export interface SalesGstFacts {
  rows: number
  distinctBills: number
  customers: number
  /** Bills that appear on more than one row (one row per GST slab of the bill). */
  multiSlabBills: number
  slabsBps: number[]
  /** Sum of the taxable values over every row (slab rows add up; a bill's total would be counted once per slab). */
  taxablePaise: number
  /** First/last bill date of the register. */
  from: string | null
  to: string | null
}

/** Aggregates only: the register has no item lines, so it cannot feed purchase history — it corroborates customers. */
export function salesGstFacts(rows: readonly LegacySalesGstRow[]): SalesGstFacts {
  const bills = new Map<string, number>()
  const customers = new Set<string>()
  const slabs = new Set<number>()
  let taxable = 0
  let from: string | null = null
  let to: string | null = null
  for (const r of rows) {
    bills.set(r.billNo, (bills.get(r.billNo) ?? 0) + 1)
    customers.add(r.cashAcc)
    if (r.gstSlabBps > 0) slabs.add(r.gstSlabBps)
    taxable += r.taxablePaise
    if (from === null || r.billDate < from) from = r.billDate
    if (to === null || r.billDate > to) to = r.billDate
  }
  return {
    rows: rows.length,
    distinctBills: bills.size,
    customers: customers.size,
    multiSlabBills: [...bills.values()].filter((n) => n > 1).length,
    slabsBps: [...slabs].sort((a, b) => a - b),
    taxablePaise: taxable,
    from,
    to,
  }
}
