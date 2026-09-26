/**
 * DOS-213 — a supplier bill typed at the desk, as pure arithmetic and rules.
 *
 * The day-1 simulation could not bring stock in: the only "new bill" route was the photo pipeline, and
 * a supplier whose bill has no QR/IRN, or whose photo fails, left the distributor with no way to book
 * the goods. `procurement.supplierInvoices.create` always existed (owner + manager, `source: manual`);
 * this file is what the typing screen computes before it calls it:
 *
 *   pieces   = quantity × the supplier's case size when typed in cases
 *   taxable  = rate × pieces (per piece) or rate × pieces ÷ case size (per case), to the paisa
 *   GST      = the HSN's dated rate (`catalog.hsnRates`), split CGST + SGST inside the state and IGST
 *              across it (`splitGst`, the same helper billing uses), plus compensation cess
 *   total    = Σ line totals + round-off, which the server checks to the paisa
 *
 * and the rules the Book button reads: every problem is named with the field it belongs to, so the
 * button's disabled reason is the next thing to fix, never a grey word. No React, no kit, no request.
 */
import { multiply, paise, percentOf, roundToRupee, splitGst } from '@dos/domain'

export type QtyUnit = 'pcs' | 'cs'
export type RateBasis = 'piece' | 'case'

export interface DraftLine {
  /** The supplier-invoice line id, made once when the line is added and kept across retries. */
  id: string
  variantId: string | null
  name: string
  hsnCode: string | null
  /** Printed MRP, or the catalog's, or null. Posting needs one of the two. */
  mrpPaise: number | null
  variantMrpPaise: number | null
  /** Buy-side pieces per case: the supplier's pack config, else the variant default. */
  caseSize: number
  batchNo: string
  /** As typed: DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD; empty = not printed. */
  expiry: string
  qty: string
  unit: QtyUnit
  freePcs: string
  ratePaise: number | null
  rateBasis: RateBasis
  /** As typed ("18", "2.5"); empty = the HSN's own rate. */
  gstText: string
}

export interface HsnRateLike {
  gstBps: number
  cessBps: number
}

export interface LineFigures {
  pieces: number
  freePieces: number
  taxablePaise: number
  gstBps: number | null
  cessBps: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  taxPaise: number
  lineTotalPaise: number
}

export type LineProblem = 'item' | 'qty' | 'free' | 'rate' | 'gst' | 'expiry' | 'mrp' | 'caseRate'

export type BillProblem = 'supplier' | 'billNo' | 'billDate' | 'futureDate' | 'lines' | 'total'

/** A whole number of pieces or cases; anything else is null. */
export function wholeNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,7}$/.test(trimmed)) return null
  return Number(trimmed)
}

/** "18" → 1800, "2.5" → 250, "0" → 0; at most two decimals, never over 100 %. */
export function percentToBps(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (match === null) return null
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'))
  return bps > 10_000 ? null : bps
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100)
  const frac = bps % 100
  return frac === 0
    ? String(whole)
    : `${String(whole)}.${String(frac).padStart(2, '0').replace(/0$/, '')}`
}

/** DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY or YYYY-MM-DD → ISO `YYYY-MM-DD`, or null if it is not a date. */
export function parseDate(text: string): string | null {
  const trimmed = text.trim()
  let y: number
  let m: number
  let d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  const indian = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed)
  if (iso !== null) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else if (indian !== null) {
    d = Number(indian[1])
    m = Number(indian[2])
    y = Number(indian[3])
  } else return null
  if (m < 1 || m > 12 || d < 1 || y < 2000 || y > 2100) return null
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > days) return null
  return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ISO → DD-MM-YYYY, the way the bill prints it. */
export function showDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d ?? ''}-${m ?? ''}-${y ?? ''}`
}

/** Whole days from `fromIso` to `toIso` (IST calendar dates). */
export function daysFrom(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  )
}

/**
 * CGST + SGST inside the state, IGST across it — `splitGst` from `@dos/domain`, the helper billing
 * uses, whenever the half-rate is a whole basis point (every slab in force). An odd rate (0.25 %)
 * splits the tax itself, the extra paisa to CGST, so no line ever throws.
 */
export function taxSplit(
  taxablePaise: number,
  gstBps: number,
  intra: boolean,
): { cgst: number; sgst: number; igst: number; tax: number } {
  if (!intra || gstBps % 2 === 0) {
    const s = splitGst(paise(taxablePaise), gstBps, 'A', intra ? 'A' : 'B')
    return { cgst: s.cgst, sgst: s.sgst, igst: s.igst, tax: s.tax }
  }
  const tax = percentOf(paise(taxablePaise), gstBps)
  const sgst = Math.floor(tax / 2)
  return { cgst: tax - sgst, sgst, igst: 0, tax }
}

/** The GST rate a line is taxed at: what the desk typed, else the HSN's. */
export function lineGstBps(line: DraftLine, rate: HsnRateLike | undefined): number | null {
  if (line.gstText.trim() !== '') return percentToBps(line.gstText)
  return rate?.gstBps ?? null
}

/**
 * One line's figures. Intra-state when the supplier's state equals ours (or either is unknown, the
 * common case of a local stockist whose GSTIN the register does not carry yet).
 */
export function lineFigures(
  line: DraftLine,
  rate: HsnRateLike | undefined,
  supplierState: string | null,
  ourState: string | null,
): LineFigures {
  const qty = wholeNumber(line.qty) ?? 0
  const pieces = line.unit === 'cs' ? qty * line.caseSize : qty
  const freePieces = wholeNumber(line.freePcs) ?? 0
  const ratePaise = line.ratePaise ?? 0
  const taxablePaise =
    line.rateBasis === 'piece'
      ? multiply(paise(ratePaise), pieces)
      : line.unit === 'cs'
        ? multiply(paise(ratePaise), qty)
        : multiply(paise(ratePaise), pieces / line.caseSize)
  const gstBps = lineGstBps(line, rate)
  const cessBps = rate?.cessBps ?? 0
  const intra = supplierState === null || ourState === null || supplierState === ourState
  const split = taxSplit(taxablePaise, gstBps ?? 0, intra)
  const cessPaise = percentOf(paise(taxablePaise), cessBps)
  const taxPaise = split.tax + cessPaise
  return {
    pieces,
    freePieces,
    taxablePaise,
    gstBps,
    cessBps,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
    cessPaise,
    taxPaise,
    lineTotalPaise: taxablePaise + taxPaise,
  }
}

/** What is wrong with one line, in the order the editor shows its fields. */
export function lineProblems(
  line: DraftLine,
  rate: HsnRateLike | undefined,
): readonly LineProblem[] {
  const out: LineProblem[] = []
  if (line.variantId === null) out.push('item')
  const qty = wholeNumber(line.qty)
  if (qty === null || qty === 0) out.push('qty')
  if (line.freePcs.trim() !== '' && wholeNumber(line.freePcs) === null) out.push('free')
  if (line.ratePaise === null || line.ratePaise <= 0) out.push('rate')
  if (line.rateBasis === 'case' && line.caseSize <= 1) out.push('caseRate')
  if (lineGstBps(line, rate) === null) out.push('gst')
  if (line.expiry.trim() !== '' && parseDate(line.expiry) === null) out.push('expiry')
  if (line.mrpPaise === null && line.variantMrpPaise === null) out.push('mrp')
  return out
}

/** Near-expiry warning: days left on the bill date, or null when no expiry is printed. */
export function shelfLifeDays(line: DraftLine, billDateIso: string): number | null {
  const expiry = parseDate(line.expiry)
  return expiry === null ? null : daysFrom(billDateIso, expiry)
}

export interface BillDraft {
  supplierId: string | null
  supplierState: string | null
  billNo: string
  billDate: string
  /** The total printed on the bill, if the desk typed it; null = round to the rupee. */
  printedTotalPaise: number | null
  lines: readonly DraftLine[]
}

export interface BillTotals {
  subtotalPaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  linesTotalPaise: number
  roundOffPaise: number
  totalPaise: number
}

export function billTotals(
  draft: BillDraft,
  rates: ReadonlyMap<string, HsnRateLike>,
  ourState: string | null,
): BillTotals {
  let subtotalPaise = 0
  let cgstPaise = 0
  let sgstPaise = 0
  let igstPaise = 0
  let cessPaise = 0
  let linesTotalPaise = 0
  for (const line of draft.lines) {
    const f = lineFigures(line, rateFor(line, rates), draft.supplierState, ourState)
    subtotalPaise += f.taxablePaise
    cgstPaise += f.cgstPaise
    sgstPaise += f.sgstPaise
    igstPaise += f.igstPaise
    cessPaise += f.cessPaise
    linesTotalPaise += f.lineTotalPaise
  }
  const roundOffPaise =
    draft.printedTotalPaise === null
      ? roundToRupee(paise(linesTotalPaise)).roundOff
      : draft.printedTotalPaise - linesTotalPaise
  return {
    subtotalPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    linesTotalPaise,
    roundOffPaise,
    totalPaise: linesTotalPaise + roundOffPaise,
  }
}

export function rateFor(
  line: DraftLine,
  rates: ReadonlyMap<string, HsnRateLike>,
): HsnRateLike | undefined {
  return line.hsnCode === null ? undefined : rates.get(line.hsnCode)
}

/** A printed total more than ₹1 away from the lines is a typing mistake, not a round-off. */
export const MAX_ROUND_OFF_PAISE = 100

/** What stops the bill from being booked, in the order the screen reads top to bottom. */
export function billProblems(
  draft: BillDraft,
  rates: ReadonlyMap<string, HsnRateLike>,
  ourState: string | null,
  todayIso: string,
): readonly BillProblem[] {
  const out: BillProblem[] = []
  if (draft.supplierId === null) out.push('supplier')
  if (draft.billNo.trim() === '') out.push('billNo')
  const date = parseDate(draft.billDate)
  if (date === null) out.push('billDate')
  else if (date > todayIso) out.push('futureDate')
  if (
    draft.lines.length === 0 ||
    draft.lines.some((l) => lineProblems(l, rateFor(l, rates)).length > 0)
  )
    out.push('lines')
  if (
    draft.printedTotalPaise !== null &&
    Math.abs(billTotals(draft, rates, ourState).roundOffPaise) > MAX_ROUND_OFF_PAISE
  )
    out.push('total')
  return out
}

/** The body of `procurement.supplierInvoices.create`, less the id and idempotency key. */
export interface CreateBody {
  supplierId: string
  source: 'manual'
  invoiceNo: string
  invoiceDate: string
  placeOfSupplyState: string | null
  subtotalPaise: number
  discountPaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  freightPaise: number
  roundOffPaise: number
  totalPaise: number
  lines: {
    id: string
    lineNo: number
    description: string
    variantId: string
    hsnCode: string | null
    batchNo: string | null
    expiryDate: string | null
    mrpPaise: number | null
    printedQty: number
    printedUnit: string
    qtyPcs: number
    freeQtyPcs: number
    ratePaise: number
    rateBasis: RateBasis
    basisQty: number
    discountBps: number
    discountPaise: number
    gstBps: number
    cessBps: number
    taxablePaise: number
    taxPaise: number
    lineTotalPaise: number
  }[]
}

/** Only call once `billProblems` is empty; throws otherwise, so a bad body never reaches the wire. */
export function createBody(
  draft: BillDraft,
  rates: ReadonlyMap<string, HsnRateLike>,
  ourState: string | null,
): CreateBody {
  const date = parseDate(draft.billDate)
  if (draft.supplierId === null || date === null) throw new Error('the bill is not complete')
  const totals = billTotals(draft, rates, ourState)
  return {
    supplierId: draft.supplierId,
    source: 'manual',
    invoiceNo: draft.billNo.trim(),
    invoiceDate: date,
    placeOfSupplyState: ourState,
    subtotalPaise: totals.subtotalPaise,
    discountPaise: 0,
    cgstPaise: totals.cgstPaise,
    sgstPaise: totals.sgstPaise,
    igstPaise: totals.igstPaise,
    cessPaise: totals.cessPaise,
    freightPaise: 0,
    roundOffPaise: totals.roundOffPaise,
    totalPaise: totals.totalPaise,
    lines: draft.lines.map((line, index) => {
      const rate = rateFor(line, rates)
      const f = lineFigures(line, rate, draft.supplierState, ourState)
      if (line.variantId === null || f.gstBps === null) throw new Error('a line is not complete')
      return {
        id: line.id,
        lineNo: index + 1,
        description: line.name,
        variantId: line.variantId,
        hsnCode: line.hsnCode !== null && /^\d{4,8}$/.test(line.hsnCode) ? line.hsnCode : null,
        batchNo: line.batchNo.trim() === '' ? null : line.batchNo.trim(),
        expiryDate: parseDate(line.expiry),
        mrpPaise: line.mrpPaise ?? line.variantMrpPaise,
        printedQty: wholeNumber(line.qty) ?? 0,
        printedUnit: line.unit,
        qtyPcs: f.pieces,
        freeQtyPcs: f.freePieces,
        ratePaise: line.ratePaise ?? 0,
        rateBasis: line.rateBasis,
        basisQty: line.rateBasis === 'case' ? line.caseSize : 1,
        discountBps: 0,
        discountPaise: 0,
        gstBps: f.gstBps,
        cessBps: f.cessBps,
        taxablePaise: f.taxablePaise,
        taxPaise: f.taxPaise,
        lineTotalPaise: f.lineTotalPaise,
      }
    }),
  }
}
