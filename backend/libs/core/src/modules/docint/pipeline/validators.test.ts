import { describe, expect, it } from 'vitest'
import { decodeQr, irnHash, qrDateToIso, qrStatusFor } from './qr.js'
import { applyReviewPatch, diffReadings } from './paths.js'
import {
  blockingCount,
  shouldEscalate,
  suggestGstin,
  validateInvoice,
  type ValidatableInvoice,
  type ValidationContext,
} from './validators.js'

/** A correct 4-line intra-state bill: rates per case of 12, 12 % GST, total rounded to the rupee. */
function goodInvoice(): ValidatableInvoice {
  const line = (n: number, cases: number, ratePaise: number, hsn = '21069099') => {
    const taxable = ratePaise * cases
    const tax = Math.round(taxable * 0.12)
    return {
      lineNo: n,
      description: `LINE ${String(n)} X 12`,
      hsnCode: hsn,
      batchNo: `B${String(n)}`,
      mfgDate: '2026-08-01',
      expiryDate: '2027-02-01',
      mrpPaise: 2000,
      qtyPcs: cases * 12,
      freeQtyPcs: 0,
      ratePaise,
      rateBasis: 'case' as const,
      basisQty: 12,
      discountBps: 0,
      discountPaise: 0,
      gstBps: 1200,
      cessBps: 0,
      taxablePaise: taxable,
      taxPaise: tax,
      lineTotalPaise: taxable + tax,
      evidence: { pageNo: 1, rowText: `row ${String(n)}`, bbox: null },
      variantId: `variant-${String(n)}`,
    }
  }
  const lines = [line(1, 2, 12000), line(2, 3, 12000), line(3, 2, 12000), line(4, 1, 6000)]
  const subtotal = lines.reduce((s, l) => s + l.taxablePaise, 0)
  const tax = lines.reduce((s, l) => s + l.taxPaise, 0)
  return {
    header: {
      supplierGstin: '27AAJFG7845K1ZT',
      buyerGstin: '27AABCR4521Q1Z1',
      invoiceNo: 'GK/26-27/00482',
      invoiceDate: '2026-09-01',
      irn: null,
      placeOfSupplyState: '27',
      subtotalPaise: subtotal,
      discountPaise: 0,
      cgstPaise: tax / 2,
      sgstPaise: tax / 2,
      igstPaise: 0,
      cessPaise: 0,
      freightPaise: 0,
      roundOffPaise: 0,
      totalPaise: subtotal + tax,
    },
    lines,
    pageCount: 1,
  }
}

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  stage: 'engine',
  today: '2026-09-05',
  tenantGstin: '27AABCR4521Q1Z1',
  supplierGstin: '27AAJFG7845K1ZT',
  supplierStateCode: '27',
  hsnRates: new Map([['21069099', { gstBps: 1200, cessBps: 0 }]]),
  pageCount: 1,
  expectedPages: 1,
  qr: null,
  duplicate: null,
  financialYear: '2026-27',
  ...over,
})

describe('docint validators (pure)', () => {
  it('passes a correct bill with no red and no amber', () => {
    const checks = validateInvoice(goodInvoice(), ctx())
    expect(checks.filter((c) => !c.passed)).toEqual([])
    expect(blockingCount(checks)).toBe(0)
    expect(shouldEscalate(checks)).toBe(false)
  })

  it('reds a line whose arithmetic is off by ₹4 and a total that misses by ₹9', () => {
    const inv = goodInvoice()
    const third = inv.lines[2]
    if (!third) throw new Error('fixture')
    third.taxablePaise = (third.taxablePaise ?? 0) + 400
    inv.header.totalPaise = (inv.header.totalPaise ?? 0) + 900
    const checks = validateInvoice(inv, ctx())
    const failed = checks.filter((c) => !c.passed)
    expect(failed.map((c) => `${c.check}:${String(c.lineNo)}`)).toEqual(
      expect.arrayContaining(['line_arithmetic:3', 'sum_lines_equals_total:null']),
    )
    expect(failed.find((c) => c.check === 'line_arithmetic')?.severity).toBe('error')
    expect(blockingCount(checks)).toBeGreaterThanOrEqual(2)
    expect(shouldEscalate(checks)).toBe(true)
  })

  it('flags a bad GSTIN with the confusion-set suggestion, a foreign buyer GSTIN and a duplicate', () => {
    const inv = goodInvoice()
    inv.header.supplierGstin = '27AAJFG7845KIZT' // the OCR read the 1 as an I
    inv.header.buyerGstin = '27AAJFG7845K1ZT'
    const checks = validateInvoice(
      inv,
      ctx({ duplicate: { supplierInvoiceId: 'si-1', documentId: null } }),
    )
    const gstin = checks.find((c) => c.check === 'gstin_checksum' && !c.passed)
    expect(gstin?.detail?.suggestion).toBe('27AAJFG7845K1ZT')
    expect(checks.find((c) => c.check === 'buyer_gstin_mismatch')?.passed).toBe(false)
    expect(checks.find((c) => c.check === 'duplicate_invoice')?.passed).toBe(false)
    expect(suggestGstin('27AABCR4521Q1ZI')).toBe('27AABCR4521Q1Z1')
  })

  it('warns on a dated HSN rate mismatch, blocks on a missing page, and demands batch + variant at review', () => {
    const inv = goodInvoice()
    const first = inv.lines[0]
    if (!first) throw new Error('fixture')
    first.gstBps = 1800
    first.taxPaise = Math.round((first.taxablePaise ?? 0) * 0.18)
    first.lineTotalPaise = (first.taxablePaise ?? 0) + first.taxPaise
    inv.header.cgstPaise = null
    inv.header.sgstPaise = null
    inv.header.totalPaise = inv.lines.reduce((s, l) => s + (l.lineTotalPaise ?? 0), 0)
    const engine = validateInvoice(inv, ctx({ expectedPages: 3, pageCount: 1 }))
    expect(engine.find((c) => c.check === 'hsn_dated_rate' && c.lineNo === 1)).toMatchObject({
      passed: false,
      severity: 'warn',
    })
    expect(engine.find((c) => c.check === 'page_completeness')).toMatchObject({
      passed: false,
      severity: 'error',
    })
    expect(shouldEscalate(engine)).toBe(true)
    const second = inv.lines[1]
    if (!second) throw new Error('fixture')
    second.variantId = null
    second.batchNo = null
    const review = validateInvoice(inv, ctx({ stage: 'review' }))
    expect(
      review
        .filter((c) => !c.passed && c.lineNo === 2)
        .map((c) => c.check)
        .sort(),
    ).toEqual(['batch_required', 'sku_matched'])
  })

  it('cross-checks the QR: line count, total, seller GSTIN, and the IRN hash', () => {
    const inv = goodInvoice()
    const total = inv.header.totalPaise ?? 0
    const fy = '2026-27'
    inv.header.irn = irnHash('27AAJFG7845K1ZT', fy, 'INV', 'GK/26-27/00482')
    const qr = {
      sellerGstin: '27AAJFG7845K1ZT',
      buyerGstin: '27AABCR4521Q1Z1',
      docNo: 'GK/26-27/00482',
      docTyp: 'INV' as const,
      docDt: '2026-09-01',
      totInvValPaise: total,
      itemCnt: 4,
      mainHsnCode: '2106',
      irn: inv.header.irn,
      irnDt: '2026-09-01T10:00:00+05:30',
    }
    const ok = validateInvoice(inv, ctx({ qr }))
    expect(ok.filter((c) => !c.passed)).toEqual([])
    const bad = validateInvoice(
      inv,
      ctx({ qr: { ...qr, itemCnt: 5, totInvValPaise: total + 50_000 } }),
    )
    expect(
      bad
        .filter((c) => !c.passed)
        .map((c) => c.check)
        .sort(),
    ).toEqual(['qr_line_count', 'qr_total'])
    inv.header.irn = 'a'.repeat(64)
    expect(validateInvoice(inv, ctx()).find((c) => c.check === 'irn_hash')?.passed).toBe(false)
  })
})

describe('e-invoice QR (pure)', () => {
  const data = {
    SellerGstin: '27AAJFG7845K1ZT',
    BuyerGstin: '27AABCR4521Q1Z1',
    DocNo: 'GK/26-27/00482',
    DocTyp: 'INV',
    DocDt: '01/09/2026',
    TotInvVal: 1012.57,
    ItemCnt: 4,
    MainHsnCode: '2106',
    Irn: 'f'.repeat(64),
    IrnDt: '2026-09-01 10:15:22',
  }
  const b64url = (s: string): string => Buffer.from(s).toString('base64url')

  it('decodes the JWS the IRP prints and normalises the ten fields', () => {
    const jwt = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))}.${b64url(JSON.stringify({ data: JSON.stringify(data), iss: 'NIC' }))}.${b64url('sig')}`
    const decoded = decodeQr(jwt)
    expect(decoded?.payload).toMatchObject({
      sellerGstin: '27AAJFG7845K1ZT',
      docDt: '2026-09-01',
      totInvValPaise: 101257,
      itemCnt: 4,
      irnDt: '2026-09-01T10:15:22+05:30',
    })
    expect(decoded?.kid).toBe('k1')
    expect(decoded && qrStatusFor(decoded, [])).toBe('decoded')
  })

  it('accepts a bare JSON QR, rejects garbage, and converts dd/MM/yyyy', () => {
    expect(decodeQr(JSON.stringify(data))?.payload.docNo).toBe('GK/26-27/00482')
    expect(decodeQr('not a qr')).toBeNull()
    expect(decodeQr(JSON.stringify({ ...data, SellerGstin: 'bad' }))).toBeNull()
    expect(qrDateToIso('07/12/2020')).toBe('2020-12-07')
  })
})

describe('review paths (pure)', () => {
  const reviewed = {
    header: {
      supplierId: null,
      supplierName: 'X',
      supplierGstin: null,
      buyerGstin: null,
      invoiceNo: 'A',
      invoiceDate: '2026-09-01',
      irn: null,
      ewayBillNo: null,
      placeOfSupplyState: null,
      purchaseOrderId: null,
      dueDate: null,
      subtotalPaise: 100,
      discountPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
      freightPaise: 0,
      roundOffPaise: 0,
      totalPaise: 100,
    },
    lines: [
      {
        lineNo: 1,
        description: 'L1',
        supplierCode: null,
        variantId: null,
        hsnCode: null,
        batchNo: null,
        mfgDate: null,
        expiryDate: null,
        mrpPaise: null,
        printedQty: 1,
        printedUnit: 'pcs',
        caseSize: null,
        qtyPcs: 1,
        freeQtyPcs: 0,
        ratePaise: 100,
        rateBasis: 'piece' as const,
        basisQty: 1,
        discountBps: 0,
        discountPaise: 0,
        gstBps: 0,
        cessBps: 0,
        taxablePaise: 100,
        taxPaise: 0,
        lineTotalPaise: 100,
      },
    ],
    annotations: [],
  }

  it('records exactly one correction per changed path and ignores no-ops', () => {
    const { next, corrections } = applyReviewPatch(reviewed, {
      header: { invoiceNo: 'A', roundOffPaise: -5 },
      lines: [
        { lineNo: 1, qtyPcs: 12, variantId: 'v1' },
        { lineNo: 9, qtyPcs: 1 },
      ],
    })
    expect(corrections.map((c) => c.path).sort()).toEqual([
      'header.roundOffPaise',
      'lines[0].qtyPcs',
      'lines[0].variantId',
    ])
    expect(next.lines[0]?.qtyPcs).toBe(12)
    expect(reviewed.lines[0]?.qtyPcs).toBe(1)
    expect(
      diffReadings(
        { header: { a: 1 }, lines: [{ x: 1 }] },
        { header: { a: 2 }, lines: [{ x: 1 }, { x: 3 }] },
      ).map((d) => d.path),
    ).toEqual(['header.a', 'lines[1].x'])
  })
})
