import type { ItemExtra } from './plan.js'
import type { BakRow, BakValue, SqlBackup } from './mssql-bak.js'
import { clean, isoDate } from './text.js'
import type { LegacyBill, LegacyCustomer } from './types.js'

/**
 * What the TradeEzee backup (`TE2627.bak`, the SQL Server database `OCS_DB2`) adds to the sheets, table by
 * table. Every mapping below was checked against the backup itself (names of tables and columns) — none is
 * guessed from another product's schema.
 *
 *   m_itemas   the item master (84 rows): ITEM_CODE, HSN_NO as TEXT (the sheet loses a leading zero),
 *              ITEM_CLBL the running closing balance in legacy units, ITEM_ACT
 *   PURDAT     purchase headers (IN_TYPE `P` = a supplier bill, `I` = an opening-stock entry): CASH_ACC is the
 *   PURDET     supplier's account, BILL_DATE its date; the lines carry BILL_PRICE and COST_PRICE per unit
 *   m_accmas   every account of the books: customers (`LEVL_CODE` BD, five-digit codes), suppliers (`BS`,
 *              letter codes), and the books' own heads (purchases, sales, cash, bank)
 *   m_area     area code → area name (the customer master stores only the code)
 *
 *   saldat     sales bill headers: BOOK_CODE + SAL_YEAR + BILL_NO, CASH_ACC, BILL_DATE, DUE_DATE, SAL_AMT
 *   salrctdet  receipts per bill (RCT_NO, BOOK_CODE, BILL_NO, RCT_AMT, SET_AMT); salrct gives each receipt's date
 *              — together they let `deriveOpenBills` rebuild the outstanding as of any day (see below)
 *
 * NOT READ: `saldet` (the bill LINES) declares 55 columns but its records carry a 4-byte column more — a
 * column was dropped or re-typed after rows were written — so `SqlBackup` refuses it and no item-level sales
 * history (the suggested-order engine's food) can be imported. `saldat.TOT_RCT` is empty in every header (the
 * software computes it when a report runs), which is why receipts are summed from `salrctdet`.
 * `RtbCurrentStock` is a report scratch table with the same layout problem as `saldet`.
 */

export interface LegacySupplier {
  code: string
  name: string
  gstinRaw: string
  phoneRaw: string
  stateCode: string
}

export interface BakData {
  itemExtras: Map<string, ItemExtra>
  customers: LegacyCustomer[]
  suppliers: LegacySupplier[]
  /** Tables that exist but could not be read, with the reason (never a row). */
  unsupported: { table: string; reason: string }[]
  facts: {
    dataPages: number
    tables: number
    items: number
    itemsWithStock: number
    stockUnits: number
    purchaseLines: number
    itemsWithCost: number
    customers: number
    suppliers: number
    salesHeaders: number | null
    receiptLines: number | null
  }
}

const text = (v: BakValue | undefined): string => (v === null || v === undefined ? '' : clean(v))
const num = (v: BakValue | undefined): number | null => (typeof v === 'number' ? v : null)
/** A `numeric(18,2)` amount (it arrives as a JS number) to integer paise; nothing stays nothing. */
const paiseOf = (n: number | null): number | null => (n === null ? null : Math.round(n * 100))

function rows(bak: SqlBackup, table: string, unsupported: BakData['unsupported']): BakRow[] {
  const got = bak.tryRows(table)
  if ('unsupported' in got) {
    unsupported.push({ table, reason: got.unsupported })
    return []
  }
  return got.rows
}

/** The customers of the books are the accounts with a five-digit code; letter codes are suppliers and the books' own heads. */
export const isCustomerCode = (code: string): boolean => /^\d{5}$/.test(code)

export function readBakData(bak: SqlBackup): BakData {
  const unsupported: BakData['unsupported'] = []

  // areas
  const areaName = new Map<string, string>()
  for (const r of rows(bak, 'm_area', unsupported)) {
    const code = text(r.AREA_CODE)
    if (code !== '') areaName.set(code, text(r.AREA_NAME))
  }

  // purchases → latest cost per item
  const headers = new Map<string, BakRow>()
  for (const r of rows(bak, 'PURDAT', unsupported))
    headers.set(`${text(r.IN_TYPE)}|${text(r.PUR_NO)}`, r)
  interface Cost {
    date: string
    no: number
    rate: number | null
    landed: number | null
    mrp: number | null
    supplier: string | null
  }
  const latest = new Map<string, Cost>()
  let purchaseLines = 0
  for (const r of rows(bak, 'PURDET', unsupported)) {
    if (text(r.IN_TYPE) !== 'P') continue
    purchaseLines++
    const head = headers.get(`P|${text(r.PUR_NO)}`)
    const date = isoDate(text(head?.BILL_DATE)) ?? ''
    const code = text(r.ITEM_CODE)
    if (code === '') continue
    const bill = num(r.BILL_PRICE)
    const cost = num(r.COST_PRICE)
    const no = num(r.PUR_NO) ?? 0
    const cur = latest.get(code)
    if (cur && (cur.date > date || (cur.date === date && cur.no >= no))) continue
    latest.set(code, {
      date,
      no,
      rate: paiseOf(bill ?? cost),
      landed: paiseOf(cost ?? bill),
      mrp: paiseOf(num(r.MRP_PRICE)),
      supplier: text(head?.CASH_ACC) || null,
    })
  }

  // items
  const itemExtras = new Map<string, ItemExtra>()
  let itemsWithStock = 0
  let stockUnits = 0
  const items = rows(bak, 'm_itemas', unsupported)
  for (const r of items) {
    const code = text(r.ITEM_CODE)
    if (code === '') continue
    const closing = num(r.ITEM_CLBL)
    const qty = closing !== null && Number.isInteger(closing) && closing > 0 ? closing : null
    if (qty) {
      itemsWithStock++
      stockUnits += qty
    }
    const cost = latest.get(code)
    itemExtras.set(code, {
      hsn: text(r.HSN_NO),
      closingQty: qty,
      purchaseRatePaise: cost?.rate ?? null,
      landedCostPaise: cost?.landed ?? null,
      mrpPaise: cost?.mrp ?? null,
      supplierCode: cost?.supplier ?? null,
      active: text(r.ITEM_ACT) === '' ? null : text(r.ITEM_ACT) === '1',
    })
  }

  // accounts
  const customers: LegacyCustomer[] = []
  const suppliers: LegacySupplier[] = []
  for (const r of rows(bak, 'm_accmas', unsupported)) {
    const code = text(r.CASH_ACC)
    if (code === '') continue
    if (isCustomerCode(code)) {
      customers.push({
        code,
        name: text(r.ACC_TITLE),
        address1: text(r.ACC_ADD1),
        address2: text(r.ACC_ADD2),
        address3: text(r.ACC_ADD3),
        phoneRaw: text(r.ACC_TEL),
        altPhoneRaw: text(r.ACC_TEL1),
        areaName: areaName.get(text(r.AREA_CODE)) ?? '',
        pincode: text(r.ACC_PIN),
        gstinRaw: text(r.GST).toUpperCase(),
        ownerName: text(r.ACC_PROP),
        email: text(r.ACC_EMAIL),
        pan: text(r.PAN),
        stateCode: text(r.State),
        foodLicense: text(r.FOOD_LIC),
      })
    } else if (text(r.LEVL_CODE) === 'BS') {
      suppliers.push({
        code,
        name: text(r.ACC_TITLE),
        gstinRaw: text(r.GST).toUpperCase(),
        phoneRaw: text(r.ACC_TEL),
        stateCode: text(r.State),
      })
    }
  }

  const sales = bak.hasTable('saldat') ? bak.tryRows('saldat') : null
  const receipts = bak.hasTable('salrctdet') ? bak.tryRows('salrctdet') : null
  const stats = bak.stats()
  return {
    itemExtras,
    customers,
    suppliers,
    unsupported: [...unsupported, ...(bak.hasTable('saldet') ? saldetNote(bak) : [])],
    facts: {
      dataPages: stats.dataPages,
      tables: stats.tables,
      items: items.length,
      itemsWithStock,
      stockUnits,
      purchaseLines,
      itemsWithCost: latest.size,
      customers: customers.length,
      suppliers: suppliers.length,
      salesHeaders: sales && 'rows' in sales ? sales.rows.length : null,
      receiptLines: receipts && 'rows' in receipts ? receipts.rows.length : null,
    },
  }
}

function saldetNote(bak: SqlBackup): BakData['unsupported'] {
  const got = bak.tryRows('saldet')
  return 'unsupported' in got ? [{ table: 'saldet', reason: got.unsupported }] : []
}

const toPaise = (n: number): number => Math.round(n * 100)

export interface DerivedBills {
  bills: LegacyBill[]
  facts: {
    billsRead: number
    receiptLines: number
    receiptsWithoutDate: number
    open: number
    salYears: number
  }
}

/**
 * The OUTSTANDING, rebuilt from the backup as of the END of `asOf` (bills dated up to and including it, less the
 * receipts dated up to and including it): for every sales bill, `SAL_AMT` minus what `salrctdet` says was
 * received (`RCT_AMT + SET_AMT`, the settlement discount).
 *
 * WHY THIS EXISTS. The outstanding report the founder handed over is a REPORT, not the ledger: it was run on
 * 20 July 2026 (each row's `DUE_DATE + Delay_Days`), starts at the bill of 4 June, and so leaves out every
 * open bill dated before it and everything sold and received since. Rebuilt for 19 July from the backup,
 * this function returns the report's bills with the report's balances (125 of its 131 bills match to the
 * paisa; the other six were deleted from the books afterwards) plus the 25 open bills the report's date
 * filter hides. Run for the day of the cut-over it is the opening ledger the report cannot be.
 *
 * A receipt whose header (`salrct`) is missing has no date and is counted as received. Refuses (returns the
 * reason) when the backup holds bills of more than one sales year, because receipts are keyed by number
 * within a year and their year column is not reliably decoded.
 */
export function deriveOpenBills(
  bak: SqlBackup,
  asOf: string,
): DerivedBills | { unsupported: string } {
  const missing = ['saldat', 'salrctdet', 'salrct'].filter((t) => !bak.hasTable(t))
  if (missing.length > 0) return { unsupported: `the backup has no ${missing.join(', ')} table` }
  const sales = bak.tryRows('saldat')
  const lines = bak.tryRows('salrctdet')
  const heads = bak.tryRows('salrct')
  if ('unsupported' in sales) return { unsupported: sales.unsupported }
  if ('unsupported' in lines) return { unsupported: lines.unsupported }
  if ('unsupported' in heads) return { unsupported: heads.unsupported }
  const years = new Set(sales.rows.map((r) => text(r.SAL_YEAR)))
  if (years.size > 1)
    return {
      unsupported: `the backup holds bills of ${String(years.size)} sales years; rebuild one year at a time`,
    }

  const receiptDate = new Map<string, string>()
  for (const h of heads.rows) {
    const d = isoDate(text(h.RCT_DATE))
    if (d) receiptDate.set(text(h.RCT_NO), d)
  }
  const received = new Map<string, number>()
  let withoutDate = 0
  for (const l of lines.rows) {
    const d = receiptDate.get(text(l.RCT_NO))
    if (d === undefined) withoutDate++
    else if (d > asOf) continue
    const key = `${text(l.BOOK_CODE)}|${text(l.BILL_NO)}`
    received.set(
      key,
      (received.get(key) ?? 0) + toPaise((num(l.RCT_AMT) ?? 0) + (num(l.SET_AMT) ?? 0)),
    )
  }

  const bills: LegacyBill[] = []
  sales.rows.forEach((r, i) => {
    const billDate = isoDate(text(r.BILL_DATE))
    const amount = num(r.SAL_AMT)
    if (!billDate || billDate > asOf || amount === null) return
    const bookCode = text(r.BOOK_CODE)
    const billNo = text(r.BILL_NO)
    const amountPaise = toPaise(amount)
    const receivedPaise = received.get(`${bookCode}|${billNo}`) ?? 0
    if (amountPaise - receivedPaise <= 0) return
    bills.push({
      bookCode,
      salYear: text(r.SAL_YEAR),
      billNo,
      cashAcc: text(r.CASH_ACC),
      title: text(r.PARTY_NAME),
      areaName: text(r.PARTY_AREA),
      salesman: text(r.SMAN_ACC),
      billDate,
      dueDate: isoDate(text(r.DUE_DATE)),
      amountPaise,
      receivedPaise,
      creditDays: 0,
      row: i + 1,
    })
  })
  bills.sort(
    (a, b) =>
      a.billDate.localeCompare(b.billDate) ||
      a.billNo.localeCompare(b.billNo, undefined, { numeric: true }),
  )
  return {
    bills,
    facts: {
      billsRead: sales.rows.length,
      receiptLines: lines.rows.length,
      receiptsWithoutDate: withoutDate,
      open: bills.length,
      salYears: years.size,
    },
  }
}
