import { cell, sheetRecords, type SheetRecord } from './sheets.js'
import { clean, percentToBps, rupeesToPaise } from './text.js'
import type { Issue, LegacyItem, Parsed } from './types.js'

/** The columns of `CompanywiseProductList.xlsx` the importer reads (the others are TradeEzee's own scratch fields). */
export const PRODUCT_COLUMNS = [
  'ITEM_CODE',
  'ITEM_TITLE',
  'ITEM_PACK',
  'MFG_CODE',
  'MFG_NAME',
  'GST',
  'HSN_NO',
  'SALE_PRICE',
  'MRP_PRICE',
  'STATUS',
] as const

export function productRecords(rows: readonly (readonly string[])[]): SheetRecord[] {
  return sheetRecords(rows, PRODUCT_COLUMNS, 'product list')
}

/**
 * `ITEM_PACK` is not a pack size. It is the unit the legacy price is quoted in: `EACH` for a single piece,
 * `CASE` / `CASES` for a carton, and, for a handful of water SKUs, the bottle size (`250ML`, `1LTR`) whose
 * price is nonetheless a carton price (a 250 ml bottle does not carry an MRP of 120). Nothing in the sheet
 * says how many pieces a carton holds.
 */
export function unitKindOf(pack: string): LegacyItem['unitKind'] {
  const p = pack.trim().toUpperCase()
  if (p === 'EACH') return 'each'
  if (p === 'CASE' || p === 'CASES') return 'case'
  return 'other'
}

export function parseProductRows(records: readonly SheetRecord[]): Parsed<LegacyItem> {
  const items: LegacyItem[] = []
  const issues: Issue[] = []
  const seen = new Set<string>()
  for (const r of records) {
    const ref = `products:${String(r.row)}`
    const code = clean(cell(r, 'ITEM_CODE'))
    const title = clean(cell(r, 'ITEM_TITLE'))
    if (code === '' || title === '') {
      issues.push({ kind: 'record-incomplete', ref })
      continue
    }
    if (seen.has(code)) {
      issues.push({ kind: 'duplicate-item-code', ref })
      continue
    }
    seen.add(code)
    const gstBps = percentToBps(cell(r, 'GST'))
    if (gstBps === null) {
      issues.push({ kind: 'bad-amount', ref })
      continue
    }
    const salePaise = rupeesToPaise(cell(r, 'SALE_PRICE'))
    const mrpPaise = rupeesToPaise(cell(r, 'MRP_PRICE'))
    if (salePaise === null || salePaise === 0) issues.push({ kind: 'missing-price', ref })
    if (mrpPaise === null || mrpPaise === 0) issues.push({ kind: 'missing-mrp', ref })
    if (salePaise !== null && mrpPaise !== null && mrpPaise > 0) {
      if (salePaise > mrpPaise) issues.push({ kind: 'price-above-mrp', ref })
      else if (salePaise * 2 < mrpPaise) issues.push({ kind: 'price-below-half-mrp', ref })
    }
    const status = clean(cell(r, 'STATUS')).toUpperCase()
    if (status !== 'ACTIVE') issues.push({ kind: 'inactive-item', ref })
    const pack = clean(cell(r, 'ITEM_PACK'))
    const hsnDigits = clean(cell(r, 'HSN_NO')).replace(/\D/g, '')
    items.push({
      code,
      title,
      packLabel: pack,
      unitKind: unitKindOf(pack),
      mfgCode: clean(cell(r, 'MFG_CODE')),
      mfgName: clean(cell(r, 'MFG_NAME')),
      gstBps,
      hsnRaw: hsnDigits === '' ? null : hsnDigits,
      salePaise: salePaise === 0 ? null : salePaise,
      mrpPaise: mrpPaise === 0 ? null : mrpPaise,
      active: status === 'ACTIVE',
      row: r.row,
    })
  }
  return { items, issues }
}
