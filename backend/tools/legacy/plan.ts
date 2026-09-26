import { isValidGstin } from '@dos/domain'
import { billKey } from './outstanding.js'
import { similarPairs } from './similar.js'
import {
  clean,
  daysBetween,
  groupBy,
  nameKey,
  normaliseHsn,
  parseIndianMobile,
  stateCodeFromLabel,
  validStateCode,
} from './text.js'
import type { Issue, LegacyBill, LegacyCustomer, LegacyItem, LegacySalesGstRow } from './types.js'

/**
 * The PLAN: what the importer will write, computed from the parsed sources with no database and no side
 * effect. The same plan feeds the dry run's report and the writer, so what the founder reads before
 * committing is exactly what a commit does.
 *
 * Every rule that turns a legacy fact into an app fact is here, in one file, so the report can state it
 * and a spec can hold it:
 *   - one HSN carries one GST rate (QA S-176/S-177, migrations 0060/0061): a heading the sheet gives two
 *     rates is refused, never guessed;
 *   - the legacy price is per LEGACY UNIT, and one legacy unit becomes one piece with a case size of 1,
 *     because no source says how many pieces a carton holds;
 *   - a shop is keyed by CASH_ACC, a bill by BOOK_CODE + SAL_YEAR + BILL_NO, an item by ITEM_CODE;
 *   - an opening bill carries what is STILL OWED (`SAL_AMT - TOT_RCT`), so the ledger opens with the real
 *     receivable and the bill's own history stays in the old software.
 */

export interface PlanOptions {
  /** Today (IST) — the date a rate must be live on. */
  asOf: string
  /** Effective date of a new or changed HSN rate row (GST 2.0 slabs took effect on 2025-09-22). */
  ratesFrom: string
  /** GST rate (bps) → HSN heading to use for an item the sheet gives no HSN. `null` = skip such items. */
  hsnFallback: ReadonlyMap<number, string> | null
  /** GST state code for a shop no source names a state for (the distributor's own state). */
  defaultState: string
}

export const DEFAULT_HSN_FALLBACK: ReadonlyMap<number, string> = new Map([
  // 40 % goods without an HSN in the list are aerated / flavoured soft drinks: heading 2202.
  [4000, '2202'],
  // 5 % goods without an HSN in the list are fruit-juice-based drinks: the sub-heading 0060 already carries.
  [500, '22029920'],
])

/** What the optional backup adds to an item. */
export interface ItemExtra {
  /** HSN as TradeEzee stores it (text, so a leading zero survives). */
  hsn: string
  /** Closing balance in legacy units. */
  closingQty: number | null
  /** Latest purchase rate per unit, paise. */
  purchaseRatePaise: number | null
  landedCostPaise: number | null
  /** MRP of the latest purchase, used only when the list has none. */
  mrpPaise: number | null
  supplierCode: string | null
  active: boolean | null
}

export interface PlannedManufacturer {
  name: string
  code: string
}

export interface PlannedItem {
  code: string
  title: string
  mfgName: string
  hsn: string
  /** The HSN was not in the list (or lost a zero) and was chosen by rule. */
  hsnAssumed: boolean
  gstBps: number
  salePaise: number | null
  mrpPaise: number | null
  /** Offered to reps and shops: active AND priced. */
  listed: boolean
  unitKind: LegacyItem['unitKind']
  purchaseRatePaise: number | null
  landedCostPaise: number | null
  supplierCode: string | null
  openingQty: number | null
}

export interface PlannedHsnRate {
  hsn: string
  gstBps: number
  items: number
}

export interface PlannedRetailer {
  code: string
  name: string
  /** E.164, or '' when the master has none (a blank phone is a supported state: nothing to send to). */
  phone: string
  altPhone: string | null
  ownerName: string | null
  gstin: string | null
  pan: string | null
  stateCode: string
  address: { line1?: string; line2?: string; area?: string; pincode?: string } | null
  beatName: string | null
}

export interface PlannedBill {
  key: string
  bookCode: string
  salYear: string
  billNo: string
  /** The number the app shows: the legacy number, disambiguated only when two bills would share one. */
  invoiceNo: string
  cashAcc: string
  invoiceDate: string
  dueDate: string | null
  originalPaise: number
  receivedPaise: number
  openPaise: number
}

export interface Plan {
  manufacturers: PlannedManufacturer[]
  items: PlannedItem[]
  hsnRates: PlannedHsnRate[]
  beats: string[]
  retailers: PlannedRetailer[]
  bills: PlannedBill[]
  issues: Issue[]
}

export interface PlanInput {
  items: readonly LegacyItem[]
  itemExtras?: ReadonlyMap<string, ItemExtra>
  customers: readonly LegacyCustomer[]
  bills: readonly LegacyBill[]
  salesGst: readonly LegacySalesGstRow[]
}

const MAX_NAME = 120

const mostCommon = <T>(values: readonly T[]): T | undefined => {
  const n = new Map<T, number>()
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export function buildPlan(input: PlanInput, options: PlanOptions): Plan {
  const issues: Issue[] = []
  const ref = (source: string, row: number | string): string => `${source}:${String(row)}`

  // ------------------------------------------------------------------------------------------- items
  interface Prepared {
    item: LegacyItem
    hsn: string
    assumed: boolean
  }
  const prepared: Prepared[] = []
  for (const item of input.items) {
    const extra = input.itemExtras?.get(item.code)
    // The backup keeps the code as text, so it is the better source for a leading zero; the sheet is the fallback.
    const fromBackup = normaliseHsn(extra?.hsn)
    const fromSheet = normaliseHsn(item.hsnRaw)
    const got = fromBackup ?? fromSheet
    if (got) {
      if (got.padded && !fromBackup)
        issues.push({ kind: 'hsn-padded', ref: ref('products', item.row) })
      prepared.push({ item, hsn: got.hsn, assumed: got.padded && !fromBackup })
      continue
    }
    const fallback = options.hsnFallback?.get(item.gstBps)
    if (fallback) {
      issues.push({ kind: 'hsn-assumed', ref: ref('products', item.row) })
      prepared.push({ item, hsn: fallback, assumed: true })
    } else {
      issues.push({ kind: 'missing-hsn', ref: ref('products', item.row) })
    }
  }

  // One live rate per HSN: a heading the list gives two rates is refused for the minority.
  const byHsn = groupBy(prepared, (p) => p.hsn)
  const accepted: Prepared[] = []
  const hsnRates: PlannedHsnRate[] = []
  for (const [hsn, group] of byHsn) {
    const rate = mostCommon(group.map((p) => p.item.gstBps))
    if (rate === undefined) continue
    let kept = 0
    for (const p of group) {
      if (p.item.gstBps === rate) {
        accepted.push(p)
        kept++
      } else issues.push({ kind: 'hsn-rate-conflict', ref: ref('products', p.item.row) })
    }
    hsnRates.push({ hsn, gstBps: rate, items: kept })
  }
  accepted.sort((a, b) => a.item.row - b.item.row)

  const items: PlannedItem[] = accepted.map(({ item, hsn, assumed }) => {
    const extra = input.itemExtras?.get(item.code)
    const active = item.active && extra?.active !== false
    return {
      code: item.code,
      title: item.title,
      mfgName: item.mfgName,
      hsn,
      hsnAssumed: assumed,
      gstBps: item.gstBps,
      salePaise: item.salePaise,
      mrpPaise: item.mrpPaise ?? extra?.mrpPaise ?? null,
      listed: active && item.salePaise !== null,
      unitKind: item.unitKind,
      purchaseRatePaise: extra?.purchaseRatePaise ?? null,
      landedCostPaise: extra?.landedCostPaise ?? null,
      supplierCode: extra?.supplierCode ?? null,
      openingQty: extra?.closingQty ?? null,
    }
  })

  const mfgNames = new Map<string, string>()
  for (const i of items) {
    const name = i.mfgName
    if (name !== '' && !mfgNames.has(nameKey(name))) mfgNames.set(nameKey(name), name)
  }
  const manufacturers: PlannedManufacturer[] = [...mfgNames.values()]
    .sort()
    .map((name) => ({ name, code: input.items.find((x) => x.mfgName === name)?.mfgCode ?? '' }))

  // ----------------------------------------------------------------------------------------- retailers
  const gstinByAcc = new Map<string, string>()
  const stateByAcc = new Map<string, string>()
  for (const r of input.salesGst) {
    if (r.gstinRaw !== '' && !gstinByAcc.has(r.cashAcc)) gstinByAcc.set(r.cashAcc, r.gstinRaw)
    const st = stateCodeFromLabel(r.stateLabel)
    if (st && !stateByAcc.has(r.cashAcc)) stateByAcc.set(r.cashAcc, st)
  }

  const retailers: PlannedRetailer[] = []
  const seenCodes = new Set<string>()
  const beatNames = new Map<string, string>()
  const customerRow = (code: string): string => ref('customers', code)
  for (const c of input.customers) {
    if (seenCodes.has(c.code)) continue
    seenCodes.add(c.code)
    const name = clean(c.name).slice(0, MAX_NAME)
    if (name.length < 2) {
      issues.push({ kind: 'record-incomplete', ref: customerRow(c.code) })
      continue
    }
    // phone
    let phone = ''
    const rawPhone = clean(c.phoneRaw)
    if (rawPhone === '' || /^0+$/.test(rawPhone))
      issues.push({ kind: 'missing-phone', ref: customerRow(c.code) })
    else {
      const p = parseIndianMobile(rawPhone)
      if (p) phone = p
      else issues.push({ kind: 'bad-phone', ref: customerRow(c.code) })
    }
    const rawAlt = clean(c.altPhoneRaw)
    const altPhone = rawAlt !== '' && !/^0+$/.test(rawAlt) ? parseIndianMobile(rawAlt) : null
    // GSTIN: the master, then the register; a checksum failure is dropped, never repaired
    let gstin: string | null = null
    for (const candidate of [clean(c.gstinRaw).toUpperCase(), gstinByAcc.get(c.code) ?? '']) {
      if (candidate === '') continue
      if (isValidGstin(candidate)) {
        gstin = candidate
        break
      }
      issues.push({ kind: 'bad-gstin', ref: customerRow(c.code) })
    }
    // state: the GSTIN's own prefix, then the register's, then the master's, then the distributor's
    const fromGstin = gstin ? validStateCode(gstin.slice(0, 2)) : null
    const fromRegister = stateByAcc.get(c.code) ?? null
    const fromMaster =
      c.stateCode !== '' ? (stateCodeFromLabel(c.stateCode) ?? validStateCode(c.stateCode)) : null
    if (fromGstin && fromRegister && fromGstin !== fromRegister)
      issues.push({ kind: 'gstin-state-mismatch', ref: customerRow(c.code) })
    const stateCode = fromGstin ?? fromRegister ?? fromMaster ?? options.defaultState
    if (!fromGstin && !fromRegister && !fromMaster)
      issues.push({ kind: 'state-unknown', ref: customerRow(c.code) })
    // address and beat
    const area = clean(c.areaName)
    if (area === '') issues.push({ kind: 'blank-area', ref: customerRow(c.code) })
    else if (!beatNames.has(nameKey(area))) beatNames.set(nameKey(area), area)
    const line2 = [clean(c.address2), clean(c.address3)].filter((s) => s !== '').join(', ')
    const address: NonNullable<PlannedRetailer['address']> = {}
    if (clean(c.address1) !== '') address.line1 = clean(c.address1).slice(0, 200)
    if (line2 !== '') address.line2 = line2.slice(0, 200)
    if (area !== '') address.area = area.slice(0, 120)
    if (/^\d{6}$/.test(clean(c.pincode))) address.pincode = clean(c.pincode)
    retailers.push({
      code: c.code,
      name,
      phone,
      altPhone,
      ownerName: clean(c.ownerName) !== '' ? clean(c.ownerName).slice(0, 120) : null,
      gstin,
      pan: clean(c.pan) !== '' ? clean(c.pan).toUpperCase() : null,
      stateCode,
      address: Object.keys(address).length > 0 ? address : null,
      beatName: area !== '' ? (beatNames.get(nameKey(area)) ?? area) : null,
    })
  }

  // Data-quality passes over the master. They REPORT; nothing is merged or dropped.
  for (const pair of similarPairs(retailers.map((r) => r.name)))
    issues.push({
      kind: 'possible-duplicate-customer',
      ref: customerRow(retailers[pair.a]?.code ?? '?'),
    })
  for (const [, group] of groupBy(
    retailers.filter((r) => r.phone !== ''),
    (r) => r.phone,
  ))
    if (group.length > 1)
      for (const r of group.slice(1))
        issues.push({ kind: 'shared-phone', ref: customerRow(r.code) })
  for (const [, group] of groupBy(
    retailers.filter((r) => r.gstin !== null),
    (r) => r.gstin ?? '',
  ))
    if (group.length > 1)
      for (const r of group.slice(1))
        issues.push({ kind: 'shared-gstin', ref: customerRow(r.code) })

  // -------------------------------------------------------------------------------------------- bills
  const known = new Map(retailers.map((r) => [r.code, r]))
  const bills: PlannedBill[] = []
  for (const b of input.bills) {
    const at = ref('outstanding', b.row)
    const shop = known.get(b.cashAcc)
    if (!shop) {
      issues.push({ kind: 'unknown-customer', ref: at })
      continue
    }
    if (b.title !== '' && nameKey(b.title) !== nameKey(shop.name))
      issues.push({ kind: 'name-differs-from-master', ref: at })
    // A bill's own area only matters when the shop has none; a bill with no area of a shop that has one is normal.
    if (b.areaName === '') {
      if (!shop.beatName) issues.push({ kind: 'blank-area', ref: at })
    } else if (!beatNames.has(nameKey(b.areaName))) beatNames.set(nameKey(b.areaName), b.areaName)
    const open = b.amountPaise - b.receivedPaise
    if (open < 0) {
      issues.push({ kind: 'over-received-bill', ref: at })
      continue
    }
    if (open === 0) {
      issues.push({ kind: 'settled-bill', ref: at })
      continue
    }
    if (b.receivedPaise > 0) issues.push({ kind: 'partly-received-bill', ref: at })
    bills.push({
      key: billKey(b),
      bookCode: b.bookCode,
      salYear: b.salYear,
      billNo: b.billNo,
      invoiceNo: b.billNo,
      cashAcc: b.cashAcc,
      invoiceDate: b.billDate,
      dueDate: b.dueDate,
      originalPaise: b.amountPaise,
      receivedPaise: b.receivedPaise,
      openPaise: open,
    })
  }
  // Two bills that would print the same number (a number restarts every book and year) keep it apart.
  for (const [, group] of groupBy(bills, (b) => b.invoiceNo))
    if (group.length > 1)
      for (const b of group) b.invoiceNo = `${b.bookCode}-${b.salYear}-${b.billNo}`

  return {
    manufacturers,
    items,
    hsnRates: hsnRates.sort((a, b) => a.hsn.localeCompare(b.hsn)),
    beats: [...beatNames.values()].sort(),
    retailers,
    bills,
    issues,
  }
}

/** A bill's age in days on `asOf` — for the report's ageing summary. */
export const ageDays = (bill: Pick<PlannedBill, 'invoiceDate'>, asOf: string): number =>
  daysBetween(bill.invoiceDate, asOf)
