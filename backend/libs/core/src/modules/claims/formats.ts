import type { XlsxCell } from '../integrations/index.js'

/**
 * The claim sheet the brand is sent, one column set per format the brand's `claimSheetFormat` names
 * (brief §8.3: the four seeded strings are assumed column sets; the real headers come from Tarsun's
 * actual sheets before the pilot — `generic_xlsx` is the fallback nobody has to configure). Every
 * format renders from the SAME snapshot (`claim_statements.payload`, written at request time), so a
 * sheet regenerated a month later prints the claim as it was submitted, not as the lines look now.
 *
 * Money is printed in rupees with two decimals (the brand's clerk reads a sheet, not paise); the
 * snapshot itself stays integer paise. Cases are "3 cs + 12 pcs" from the LOT'S OWN case size on a
 * damage line and the sell-side size on a scheme line (docs/17 A2, §B).
 */

export interface ClaimSheetRow {
  lineNo: number
  sourceType: string
  status: string
  invoiceNo: string | null
  creditNoteNo: string | null
  /** The source's own date (invoice, credit note, ledger movement, GRN), IST. */
  sourceDate: string | null
  retailerName: string | null
  retailerCode: string | null
  variantName: string | null
  batchNo: string | null
  expiryDate: string | null
  mrpPaise: number | null
  qtyPcs: number
  caseSize: number | null
  ratePaise: number | null
  basis: string | null
  amountPaise: number
  schemeName: string | null
  schemeRef: string | null
  reason: string | null
}

export interface ClaimSheetPayload {
  claimId: string
  claimNo: string | null
  kind: string
  claimChannel: string
  periodFrom: string
  periodTo: string
  format: string
  supplier: { id: string; name: string }
  brand: { id: string; name: string } | null
  rows: ClaimSheetRow[]
  totals: { lines: number; qtyPcs: number; amountPaise: number }
  snapshotAt: string
}

export interface ClaimSheetFormat {
  /** The sheet tab. */
  sheetName: string
  header: readonly string[]
  row: (r: ClaimSheetRow) => XlsxCell[]
}

const rupees = (paise: number | null): number | null =>
  paise === null ? null : Math.round(paise) / 100
const ddmmyyyy = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : ''

/** "3 cs + 12 pcs" (or "12 pcs" when the case size is unknown). */
export function casesAndPieces(qtyPcs: number, caseSize: number | null): string {
  if (!caseSize || caseSize <= 0) return `${qtyPcs} pcs`
  const cases = Math.floor(qtyPcs / caseSize)
  const pcs = qtyPcs % caseSize
  if (cases === 0) return `${pcs} pcs`
  return pcs === 0 ? `${cases} cs` : `${cases} cs + ${pcs} pcs`
}

const generic: ClaimSheetFormat = {
  sheetName: 'Claim',
  header: [
    'Sr',
    'Source',
    'Document',
    'Date',
    'Shop',
    'Product',
    'Batch',
    'Expiry',
    'MRP',
    'Qty (pcs)',
    'Qty (cases)',
    'Rate',
    'Basis',
    'Scheme',
    'Amount',
    'Status',
  ],
  row: (r) => [
    r.lineNo,
    r.sourceType,
    r.invoiceNo ?? r.creditNoteNo ?? '',
    ddmmyyyy(r.sourceDate),
    r.retailerName ?? '',
    r.variantName ?? '',
    r.batchNo ?? '',
    ddmmyyyy(r.expiryDate),
    rupees(r.mrpPaise),
    r.qtyPcs,
    casesAndPieces(r.qtyPcs, r.caseSize),
    rupees(r.ratePaise),
    r.basis ?? '',
    r.schemeName ?? '',
    rupees(r.amountPaise),
    r.status,
  ],
}

/** Reliance's depot sheet: outlet-wise scheme lines with the circular reference. */
const reliance: ClaimSheetFormat = {
  sheetName: 'RCPL Claim',
  header: [
    'Sr No',
    'Bill No',
    'Bill Date',
    'Outlet Name',
    'SKU',
    'Free Qty (pcs)',
    'Qty (cases)',
    'Circular Ref',
    'Claim Amount (Rs)',
  ],
  row: (r) => [
    r.lineNo,
    r.invoiceNo ?? r.creditNoteNo ?? '',
    ddmmyyyy(r.sourceDate),
    r.retailerName ?? '',
    r.variantName ?? '',
    r.qtyPcs,
    casesAndPieces(r.qtyPcs, r.caseSize),
    r.schemeRef ?? r.schemeName ?? '',
    rupees(r.amountPaise),
  ],
}

/** Guru Kripa (Balaji super-stockist): batch-wise, damage and scheme on one sheet. */
const guruKripa: ClaimSheetFormat = {
  sheetName: 'Claim Sheet',
  header: [
    'Sr',
    'Type',
    'Doc No',
    'Date',
    'Party',
    'Item',
    'Batch',
    'Expiry',
    'MRP',
    'Qty',
    'Rate',
    'Amount',
  ],
  row: (r) => [
    r.lineNo,
    r.sourceType === 'invoice' ? 'Scheme' : r.sourceType === 'manual' ? 'Manual' : 'Damage',
    r.invoiceNo ?? r.creditNoteNo ?? '',
    ddmmyyyy(r.sourceDate),
    r.retailerName ?? '',
    r.variantName ?? '',
    r.batchNo ?? '',
    ddmmyyyy(r.expiryDate),
    rupees(r.mrpPaise),
    r.qtyPcs,
    rupees(r.ratePaise),
    rupees(r.amountPaise),
  ],
}

/** MOM Foods settles by email: the short table their accounts desk pastes into the reply. */
const momFoodsEmail: ClaimSheetFormat = {
  sheetName: 'Claim',
  header: ['#', 'Bill', 'Date', 'Product', 'Batch', 'Pieces', 'Cases', 'Amount (INR)'],
  row: (r) => [
    r.lineNo,
    r.invoiceNo ?? r.creditNoteNo ?? '',
    ddmmyyyy(r.sourceDate),
    r.variantName ?? '',
    r.batchNo ?? '',
    r.qtyPcs,
    casesAndPieces(r.qtyPcs, r.caseSize),
    rupees(r.amountPaise),
  ],
}

/** FieldAssist's claim upload: the DMS's own bill number per line (brand-DMS claims, never journalled). */
const fieldAssist: ClaimSheetFormat = {
  sheetName: 'FA Claim',
  header: [
    'Sr No',
    'DMS Invoice No',
    'Invoice Date',
    'Outlet',
    'SKU Description',
    'Scheme',
    'Qty',
    'Claim Value',
  ],
  row: (r) => [
    r.lineNo,
    r.invoiceNo ?? '',
    ddmmyyyy(r.sourceDate),
    r.retailerName ?? '',
    r.variantName ?? '',
    r.schemeName ?? '',
    r.qtyPcs,
    rupees(r.amountPaise),
  ],
}

export const CLAIM_SHEET_FORMATS: Record<string, ClaimSheetFormat> = {
  generic_xlsx: generic,
  reliance_xlsx: reliance,
  guru_kripa_xlsx: guruKripa,
  mom_foods_email: momFoodsEmail,
  field_assist: fieldAssist,
}

export function claimSheetFormat(name: string): ClaimSheetFormat {
  return CLAIM_SHEET_FORMATS[name] ?? generic
}
