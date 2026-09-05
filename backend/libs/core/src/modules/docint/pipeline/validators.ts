import type { CheckSeverity, LineEvidence, QrPayload } from '@dos/contracts'
import { daysBetween, isValidGstin, paise, percentOf, type Paise } from '@dos/domain'
import { irnHash } from './qr.js'

/**
 * Deterministic validators (docs/05 step 5, brief §4.4). PURE: no database, no Nest. The pipeline
 * feeds them the engine's reading plus a small context it looked up (the tenant's GSTIN, the dated
 * HSN rates, whether the invoice number is already booked); the review desk feeds them the reviewed
 * invoice after every save. `error` = red (blocks `review.submit`), `warn` = amber (shown only).
 *
 * Money arithmetic is integer paise throughout; printed rounding is tolerated to the rupee
 * (`TOLERANCE_PAISE`), header/total equality is exact except where s.170 rounding is declared.
 */

export interface CheckResult {
  check: string
  passed: boolean
  severity: CheckSeverity
  lineNo: number | null
  detail: Record<string, unknown> | null
}

/** The fields the validators read; both `ExtractedInvoice` and `ReviewedInvoice` satisfy it. */
export interface ValidatableHeader {
  supplierGstin: string | null
  buyerGstin: string | null
  invoiceNo: string | null
  invoiceDate: string | null
  irn: string | null
  placeOfSupplyState: string | null
  subtotalPaise: number | null
  discountPaise: number | null
  cgstPaise: number | null
  sgstPaise: number | null
  igstPaise: number | null
  cessPaise: number | null
  freightPaise: number | null
  roundOffPaise: number | null
  totalPaise: number | null
}

export interface ValidatableLine {
  lineNo: number
  description: string
  hsnCode: string | null
  batchNo: string | null
  mfgDate: string | null
  expiryDate: string | null
  mrpPaise: number | null
  qtyPcs: number | null
  freeQtyPcs: number | null
  ratePaise: number | null
  rateBasis: 'piece' | 'case' | null
  basisQty: number | null
  discountBps: number | null
  discountPaise: number | null
  gstBps: number | null
  cessBps: number | null
  taxablePaise: number | null
  taxPaise: number | null
  lineTotalPaise: number | null
  /** Present on an engine reading; absent on the reviewed invoice. */
  evidence?: LineEvidence | null | undefined
  /** Present on the reviewed invoice; absent on an engine reading. */
  variantId?: string | null | undefined
}

export interface ValidatableInvoice {
  header: ValidatableHeader
  lines: ValidatableLine[]
  /** The engine's own page count, when it reported one. */
  pageCount?: number | undefined
}

export interface ValidationContext {
  /** `engine`: the raw reading (evidence required, unmatched lines are the matcher's business). `review`: before submit. */
  stage: 'engine' | 'review'
  /** Today's IST business date. */
  today: string
  /** `tenants.gstin`; null = not configured, the mismatch check is skipped. */
  tenantGstin: string | null
  /** The supplier row's GSTIN and state, when the supplier is known. */
  supplierGstin: string | null
  supplierStateCode: string | null
  /** Dated GST rate per HSN code (as of the invoice date), from `hsn_rates`. */
  hsnRates: ReadonlyMap<string, { gstBps: number; cessBps: number }>
  /** Pages actually captured and the printed "1 of n" expectation. */
  pageCount: number
  expectedPages: number | null
  qr: QrPayload | null
  /** Set when procurement already holds this (supplier, invoice no) or this IRN. */
  duplicate: { supplierInvoiceId: string | null; documentId: string | null } | null
  /** Financial-year label of the invoice date, for the IRN hash. */
  financialYear: string | null
}

/** Printed rounding: a paisa here and there per line is the supplier's software, not a misread. */
export const TOLERANCE_PAISE = 100
/** The QR's total is rounded to the rupee by the IRP; ₹2 covers freight printed below the QR line. */
const QR_TOTAL_TOLERANCE_PAISE = 200
const STALE_INVOICE_DAYS = 180

const CONFUSIONS: Readonly<Record<string, string>> = {
  O: '0',
  '0': 'O',
  I: '1',
  '1': 'I',
  S: '5',
  '5': 'S',
  B: '8',
  '8': 'B',
  Z: '2',
  '2': 'Z',
}

/**
 * The OCR confusion-set retry: a GSTIN that fails mod-36 is re-tried with every single-character swap
 * from the confusion set; the first swap that validates is the suggestion (never applied silently).
 */
export function suggestGstin(value: string): string | null {
  const gstin = value.trim().toUpperCase()
  if (gstin.length !== 15) return null
  for (let i = 0; i < 15; i++) {
    const swap = CONFUSIONS[gstin[i] ?? '']
    if (!swap) continue
    const candidate = `${gstin.slice(0, i)}${swap}${gstin.slice(i + 1)}`
    if (isValidGstin(candidate)) return candidate
  }
  return null
}

const near = (a: number, b: number, tolerance = TOLERANCE_PAISE): boolean =>
  Math.abs(a - b) <= tolerance

const isIsoDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

function check(
  name: string,
  passed: boolean,
  severity: CheckSeverity,
  lineNo: number | null = null,
  detail: Record<string, unknown> | null = null,
): CheckResult {
  return { check: name, passed, severity, lineNo, detail: passed ? null : detail }
}

/** The printed gross of a line: rate × pieces, or rate × cases when the rate is per case. */
export function lineGrossPaise(line: ValidatableLine): Paise | null {
  if (line.ratePaise === null || line.qtyPcs === null) return null
  const basisQty = line.rateBasis === 'case' ? Math.max(1, line.basisQty ?? 1) : 1
  return paise(Math.round((line.ratePaise * line.qtyPcs) / basisQty))
}

/** Every check over one invoice. Deterministic and ordered, so two runs diff cleanly. */
export function validateInvoice(
  invoice: ValidatableInvoice,
  ctx: ValidationContext,
): CheckResult[] {
  const out: CheckResult[] = []
  const h = invoice.header

  // --- identity -------------------------------------------------------------------------------
  for (const [field, value] of [
    ['supplierGstin', h.supplierGstin],
    ['buyerGstin', h.buyerGstin],
  ] as const) {
    if (value === null) continue
    const valid = isValidGstin(value)
    out.push(
      check('gstin_checksum', valid, 'error', null, {
        field,
        value,
        suggestion: valid ? null : suggestGstin(value),
      }),
    )
  }
  if (ctx.tenantGstin && h.buyerGstin) {
    out.push(
      check(
        'buyer_gstin_mismatch',
        h.buyerGstin.trim().toUpperCase() === ctx.tenantGstin.trim().toUpperCase(),
        'error',
        null,
        { printed: h.buyerGstin, tenant: ctx.tenantGstin },
      ),
    )
  }
  if (ctx.supplierGstin && h.supplierGstin) {
    out.push(
      check(
        'supplier_gstin_matches_master',
        h.supplierGstin.trim().toUpperCase() === ctx.supplierGstin.trim().toUpperCase(),
        'warn',
        null,
        { printed: h.supplierGstin, master: ctx.supplierGstin },
      ),
    )
  }
  out.push(check('invoice_no_present', !!h.invoiceNo && h.invoiceNo.trim().length > 0, 'error'))
  out.push(check('invoice_date_present', isIsoDate(h.invoiceDate), 'error'))
  if (isIsoDate(h.invoiceDate)) {
    const age = daysBetween(h.invoiceDate, ctx.today)
    out.push(
      check('invoice_date_not_future', age >= -1, 'error', null, { invoiceDate: h.invoiceDate }),
    )
    out.push(
      check('invoice_date_stale', age <= STALE_INVOICE_DAYS, 'warn', null, {
        invoiceDate: h.invoiceDate,
        ageDays: age,
      }),
    )
  }
  out.push(
    check('duplicate_invoice', ctx.duplicate === null, 'error', null, {
      supplierInvoiceId: ctx.duplicate?.supplierInvoiceId ?? null,
      documentId: ctx.duplicate?.documentId ?? null,
    }),
  )

  // --- pages ----------------------------------------------------------------------------------
  const expected = ctx.expectedPages ?? invoice.pageCount ?? null
  out.push(
    check('page_completeness', expected === null || ctx.pageCount >= expected, 'error', null, {
      captured: ctx.pageCount,
      expected,
    }),
  )

  // --- lines ----------------------------------------------------------------------------------
  out.push(check('lines_present', invoice.lines.length > 0, 'error'))
  let sumTaxable = 0
  let sumTax = 0
  let sumLineTotal = 0
  let allLinesComplete = invoice.lines.length > 0
  for (const line of invoice.lines) {
    const n = line.lineNo
    const complete =
      line.description.trim().length > 0 &&
      line.qtyPcs !== null &&
      line.ratePaise !== null &&
      line.lineTotalPaise !== null
    if (!complete) allLinesComplete = false
    out.push(
      check('line_complete', complete, 'error', n, {
        qtyPcs: line.qtyPcs,
        ratePaise: line.ratePaise,
        lineTotalPaise: line.lineTotalPaise,
      }),
    )
    if (ctx.stage === 'engine' && line.evidence !== undefined) {
      out.push(
        check(
          'line_evidence',
          !!line.evidence && line.evidence.rowText.trim().length > 0,
          'error',
          n,
          { reason: 'a line without printed row text is a hallucination candidate' },
        ),
      )
    }
    if (line.hsnCode !== null) {
      const hsn = line.hsnCode.trim()
      const wellFormed = /^\d{4}$|^\d{6}$|^\d{8}$/.test(hsn)
      out.push(check('hsn_format', wellFormed, 'error', n, { hsnCode: hsn }))
      if (wellFormed && line.gstBps !== null) {
        const rate =
          ctx.hsnRates.get(hsn) ??
          ctx.hsnRates.get(hsn.slice(0, 6)) ??
          ctx.hsnRates.get(hsn.slice(0, 4))
        out.push(
          check('hsn_dated_rate', rate === undefined || rate.gstBps === line.gstBps, 'warn', n, {
            hsnCode: hsn,
            printedGstBps: line.gstBps,
            datedGstBps: rate?.gstBps ?? null,
          }),
        )
      }
    }
    const gross = lineGrossPaise(line)
    if (gross !== null && line.taxablePaise !== null) {
      const discount =
        line.discountPaise !== null
          ? line.discountPaise
          : line.discountBps !== null
            ? percentOf(gross, line.discountBps)
            : 0
      const expectedTaxable = gross - discount
      const rateBps = (line.gstBps ?? 0) + (line.cessBps ?? 0)
      const expectedTax = percentOf(paise(line.taxablePaise), rateBps)
      const taxOk = line.taxPaise === null || near(line.taxPaise, expectedTax)
      const totalOk =
        line.lineTotalPaise === null ||
        near(line.lineTotalPaise, line.taxablePaise + (line.taxPaise ?? expectedTax))
      const taxableOk = near(line.taxablePaise, expectedTaxable)
      out.push(
        check('line_arithmetic', taxableOk && taxOk && totalOk, 'error', n, {
          grossPaise: gross,
          discountPaise: discount,
          expectedTaxablePaise: expectedTaxable,
          printedTaxablePaise: line.taxablePaise,
          expectedTaxPaise: expectedTax,
          printedTaxPaise: line.taxPaise,
          printedLineTotalPaise: line.lineTotalPaise,
        }),
      )
    }
    if (line.mrpPaise !== null && line.ratePaise !== null && line.qtyPcs) {
      const perPiece =
        line.rateBasis === 'case'
          ? line.ratePaise / Math.max(1, line.basisQty ?? 1)
          : line.ratePaise
      out.push(
        check('rate_above_mrp', perPiece <= line.mrpPaise, 'warn', n, {
          perPiecePaise: Math.round(perPiece),
          mrpPaise: line.mrpPaise,
        }),
      )
    }
    if (isIsoDate(line.mfgDate) && isIsoDate(line.expiryDate)) {
      out.push(
        check('line_dates', daysBetween(line.mfgDate, line.expiryDate) > 0, 'error', n, {
          mfgDate: line.mfgDate,
          expiryDate: line.expiryDate,
        }),
      )
    }
    if (isIsoDate(line.expiryDate) && isIsoDate(h.invoiceDate)) {
      out.push(
        check('expiry_after_invoice', daysBetween(h.invoiceDate, line.expiryDate) >= 0, 'warn', n, {
          expiryDate: line.expiryDate,
        }),
      )
    }
    if (ctx.stage === 'review') {
      out.push(
        check('sku_matched', !!line.variantId, 'error', n, {
          reason: 'every line must resolve to a catalog variant before the draft is booked',
        }),
      )
      out.push(
        check('batch_required', !!line.batchNo && isIsoDate(line.expiryDate), 'error', n, {
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
        }),
      )
    }
    sumTaxable += line.taxablePaise ?? 0
    sumTax += line.taxPaise ?? 0
    sumLineTotal += line.lineTotalPaise ?? 0
  }

  // --- header arithmetic ----------------------------------------------------------------------
  if (allLinesComplete) {
    if (h.subtotalPaise !== null)
      out.push(
        check('sum_lines_equals_subtotal', near(sumTaxable, h.subtotalPaise), 'error', null, {
          sumTaxablePaise: sumTaxable,
          subtotalPaise: h.subtotalPaise,
        }),
      )
    const taxes = (h.cgstPaise ?? 0) + (h.sgstPaise ?? 0) + (h.igstPaise ?? 0) + (h.cessPaise ?? 0)
    if (h.cgstPaise !== null || h.sgstPaise !== null || h.igstPaise !== null)
      out.push(
        check('tax_split_equals_lines', near(taxes, sumTax), 'warn', null, {
          headerTaxPaise: taxes,
          sumLineTaxPaise: sumTax,
        }),
      )
    if (h.totalPaise !== null) {
      const expectedTotal = sumLineTotal + (h.freightPaise ?? 0) + (h.roundOffPaise ?? 0)
      out.push(
        check('sum_lines_equals_total', expectedTotal === h.totalPaise, 'error', null, {
          sumLineTotalPaise: sumLineTotal,
          freightPaise: h.freightPaise ?? 0,
          roundOffPaise: h.roundOffPaise ?? 0,
          expectedTotalPaise: expectedTotal,
          totalPaise: h.totalPaise,
        }),
      )
      const roundOff = h.roundOffPaise ?? 0
      out.push(
        check(
          'rounding_section_170',
          Math.abs(roundOff) <= TOLERANCE_PAISE && (roundOff === 0 || h.totalPaise % 100 === 0),
          'warn',
          null,
          { roundOffPaise: roundOff, totalPaise: h.totalPaise },
        ),
      )
    }
  }
  if (ctx.supplierStateCode && h.placeOfSupplyState) {
    const intra = ctx.supplierStateCode === h.placeOfSupplyState
    const cgst = h.cgstPaise ?? 0
    const sgst = h.sgstPaise ?? 0
    const igst = h.igstPaise ?? 0
    const ok = intra ? igst === 0 && near(cgst, sgst) : cgst === 0 && sgst === 0
    out.push(
      check('gst_split_state', ok, 'warn', null, {
        kind: intra ? 'intra' : 'inter',
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
      }),
    )
  }

  // --- the QR cross-checks --------------------------------------------------------------------
  if (ctx.qr) {
    out.push(
      check('qr_line_count', ctx.qr.itemCnt === invoice.lines.length, 'error', null, {
        qrItemCnt: ctx.qr.itemCnt,
        lines: invoice.lines.length,
      }),
    )
    if (h.totalPaise !== null)
      out.push(
        check(
          'qr_total',
          near(ctx.qr.totInvValPaise, h.totalPaise, QR_TOTAL_TOLERANCE_PAISE),
          'error',
          null,
          {
            qrTotalPaise: ctx.qr.totInvValPaise,
            totalPaise: h.totalPaise,
          },
        ),
      )
    if (h.invoiceNo)
      out.push(
        check(
          'qr_invoice_no',
          ctx.qr.docNo.trim().toUpperCase() === h.invoiceNo.trim().toUpperCase(),
          'warn',
          null,
          {
            qrDocNo: ctx.qr.docNo,
            invoiceNo: h.invoiceNo,
          },
        ),
      )
    if (h.supplierGstin)
      out.push(
        check(
          'qr_seller_gstin',
          ctx.qr.sellerGstin === h.supplierGstin.trim().toUpperCase(),
          'error',
          null,
          {
            qrSellerGstin: ctx.qr.sellerGstin,
            supplierGstin: h.supplierGstin,
          },
        ),
      )
  }
  if (
    h.irn &&
    h.supplierGstin &&
    h.invoiceNo &&
    ctx.financialYear &&
    isValidGstin(h.supplierGstin)
  ) {
    const expected = irnHash(h.supplierGstin, ctx.financialYear, 'INV', h.invoiceNo)
    out.push(
      check('irn_hash', expected === h.irn.toLowerCase(), 'warn', null, {
        printedIrn: h.irn,
        derivedIrn: expected,
      }),
    )
  }
  return out
}

/** Failed `error` checks: what `review.submit` refuses on. */
export function blockingCount(checks: readonly { passed: boolean; severity: string }[]): number {
  return checks.filter((c) => !c.passed && c.severity === 'error').length
}

export function summarise(checks: readonly { passed: boolean; severity: string }[]): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const c of checks) {
    if (c.passed) continue
    if (c.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}

/**
 * Should the secondary engine read the page again (docs/05 step 7)? Two or more failed arithmetic
 * checks, or a page-count mismatch, means the first reading is more likely wrong than the bill.
 */
export function shouldEscalate(checks: readonly CheckResult[]): boolean {
  const arithmetic = checks.filter(
    (c) =>
      !c.passed &&
      (c.check === 'line_arithmetic' ||
        c.check === 'sum_lines_equals_subtotal' ||
        c.check === 'sum_lines_equals_total'),
  ).length
  const pages = checks.some((c) => !c.passed && c.check === 'page_completeness')
  return arithmetic >= 2 || pages
}
