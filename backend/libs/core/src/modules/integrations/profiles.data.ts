import type { ImportMapping, ImportSource, ImportTarget } from '@dos/contracts'

/**
 * THE BUILT-IN PROFILES, AS DATA (docs/17 §D7, 2026-09-04 23:50: "named profiles (TradeEzee, Marg,
 * Busy, Tally, FieldAssist) are then just saved mappings that ship with the product and are refined
 * the moment a real file arrives"). Nothing about a vendor's columns is code: each entry below is a
 * row of `import_profiles` (`builtin = true`) that `ensureBuiltinProfiles` writes for a tenant on first
 * use, and the operator edits it on the mapping screen like any saved profile.
 *
 * EVERY COLUMN NAME HERE IS AN UNVERIFIED GUESS. The founder has not yet obtained a sample export
 * (docs/22 §10: "Sample exports from TradeEzee … whenever convenient — the importer does not wait for
 * them"; coordination §7 question 34). The names were chosen from what these products call the fields
 * in their report screens; a real file will rename some. When one arrives: open it in the wizard,
 * fix the mapping, tick "save as profile" — the built-in row is updated in place, no code changes.
 * The in-repo fixtures (`fixtures/*.csv`) carry exactly these headers so the profiles are tested
 * end to end against the shape we expect, not against reality we do not have yet.
 */

export interface BuiltinProfile {
  /** Stable key the deterministic per-tenant id is derived from; never shown. */
  key: string
  /** The operator-facing name; unique per tenant. "(guessed columns)" marks it unverified. */
  name: string
  source: ImportSource
  target: ImportTarget
  mapping: ImportMapping
  hasHeaderRow: boolean
  sheetName: string | null
}

const mapping = (
  columns: readonly (readonly [string, ImportMapping['columns'][number]['field']])[],
  extra: Partial<Omit<ImportMapping, 'columns'>> = {},
): ImportMapping => ({
  columns: columns.map(([column, field]) => ({ column, field })),
  constants: extra.constants ?? [],
  dateFormat: extra.dateFormat ?? 'auto',
  amountUnit: extra.amountUnit ?? 'rupees',
})

export const BUILTIN_PROFILES: readonly BuiltinProfile[] = [
  {
    key: 'tradeezee-party-master',
    name: 'TradeEzee party master (guessed columns)',
    source: 'tradeezee',
    target: 'party_master',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Party Code', 'partyCode'],
      ['Party Name', 'partyName'],
      ['Contact Person', 'ownerName'],
      ['Mobile', 'phone'],
      ['GSTIN', 'gstin'],
      ['PAN', 'pan'],
      ['Address 1', 'addressLine1'],
      ['Address 2', 'addressLine2'],
      ['Area', 'area'],
      ['City', 'city'],
      ['Pincode', 'pincode'],
      ['State Code', 'stateCode'],
      ['Route', 'beatName'],
      ['Ledger Name', 'tallyLedgerName'],
    ]),
  },
  {
    key: 'tradeezee-item-master',
    name: 'TradeEzee item master (guessed columns)',
    source: 'tradeezee',
    target: 'item_master',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Item Code', 'itemCode'],
      ['Item Name', 'itemName'],
      ['Barcode', 'ean'],
      ['Brand', 'brandName'],
      ['HSN', 'hsnCode'],
      ['MRP', 'mrp'],
      ['Case Qty', 'caseSize'],
      ['GST %', 'gstRate'],
      ['Short Name', 'localAlias'],
    ]),
  },
  {
    key: 'tradeezee-outstanding',
    name: 'TradeEzee outstanding (guessed columns)',
    source: 'tradeezee',
    target: 'opening_outstanding',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping(
      [
        ['Party Code', 'partyCode'],
        ['Party Name', 'partyName'],
        ['Bill No', 'invoiceNo'],
        ['Bill Date', 'invoiceDate'],
        ['Balance', 'amount'],
        ['Due Date', 'dueDate'],
      ],
      { dateFormat: 'DD-MM-YYYY' },
    ),
  },
  {
    key: 'tradeezee-sales-register',
    name: 'TradeEzee sales register (guessed columns)',
    source: 'tradeezee',
    target: 'sales_register',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping(
      [
        ['Party Code', 'partyCode'],
        ['Party Name', 'partyName'],
        ['Bill No', 'invoiceNo'],
        ['Bill Date', 'invoiceDate'],
        ['Item Code', 'itemCode'],
        ['Item Name', 'itemName'],
        ['Qty', 'qty'],
        ['Unit', 'unit'],
        ['Rate', 'rate'],
      ],
      { dateFormat: 'DD-MM-YYYY' },
    ),
  },
  {
    key: 'fieldassist-invoices',
    name: 'FieldAssist invoices (guessed columns)',
    source: 'fieldassist',
    target: 'brand_dms_invoices',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Outlet Code', 'partyCode'],
      ['Outlet Name', 'partyName'],
      ['Invoice No', 'invoiceNo'],
      ['Invoice Date', 'invoiceDate'],
      ['Outlet GSTIN', 'buyerGstin'],
      ['State Code', 'placeOfSupplyState'],
      ['SKU Code', 'itemCode'],
      ['SKU Name', 'itemName'],
      ['EAN', 'ean'],
      ['HSN', 'hsnCode'],
      ['Qty', 'qty'],
      ['Free Qty', 'freeQty'],
      ['UOM', 'unit'],
      ['Rate', 'rate'],
      ['Discount', 'discount'],
      ['GST %', 'gstRate'],
      ['Batch', 'batchNo'],
      ['Expiry', 'expiryDate'],
      ['MRP', 'mrp'],
    ]),
  },
  {
    key: 'marg-party-master',
    name: 'Marg party master (guessed columns)',
    source: 'marg',
    target: 'party_master',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Code', 'partyCode'],
      ['Party Name', 'partyName'],
      ['Mobile No', 'phone'],
      ['GST No', 'gstin'],
      ['Address', 'addressLine1'],
      ['Area', 'area'],
      ['City', 'city'],
      ['Pin Code', 'pincode'],
      ['State Code', 'stateCode'],
      ['Route', 'beatName'],
    ]),
  },
  {
    key: 'busy-party-master',
    name: 'Busy party master (guessed columns)',
    source: 'busy',
    target: 'party_master',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Alias', 'partyCode'],
      ['Name', 'partyName'],
      ['Contact Person', 'ownerName'],
      ['Mobile', 'phone'],
      ['GSTIN', 'gstin'],
      ['PAN', 'pan'],
      ['Address', 'addressLine1'],
      ['Station', 'city'],
      ['PIN', 'pincode'],
      ['State', 'stateCode'],
    ]),
  },
  {
    key: 'tally-party-master',
    name: 'Tally ledgers as party master (guessed columns)',
    source: 'tally',
    target: 'party_master',
    hasHeaderRow: true,
    sheetName: null,
    mapping: mapping([
      ['Ledger Name', 'partyName'],
      ['Ledger Name', 'tallyLedgerName'],
      ['Contact Person', 'ownerName'],
      ['Mobile', 'phone'],
      ['GSTIN/UIN', 'gstin'],
      ['PAN/IT No', 'pan'],
      ['Address', 'addressLine1'],
      ['Pincode', 'pincode'],
      ['State', 'stateCode'],
    ]),
  },
]

export function builtinProfile(key: string): BuiltinProfile | undefined {
  return BUILTIN_PROFILES.find((p) => p.key === key)
}
