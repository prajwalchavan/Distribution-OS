import { writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type {
  CreditNoteDetail,
  DeliveryChallan,
  InvoiceDetail,
  SellerBranding,
} from '@dos/contracts'
import type { ReceiptDocument } from '../modules/receivables/index.js'
import { amountInWords, escapePdfText, parseJpeg, rupees, textWidth, wrapText } from './pdf.js'
import { renderChallan } from './templates/challan.js'
import { renderCreditNote } from './templates/credit-note.js'
import { renderInvoice } from './templates/invoice.js'
import { renderReceipt } from './templates/receipt.js'

/**
 * The renderer is pure: given the document the API answers with, it must produce a well-formed PDF
 * whose text streams carry the DISTRIBUTOR's name (docs/17 §D6) and the document's numbers, and
 * never the words "Distribution OS" (docs/22 never-list 10).
 */

const seller: SellerBranding = {
  displayName: 'Tarsun Enterprises',
  legalName: 'Tarsun Enterprises (Kalyan)',
  gstin: '27AAAPT1234C1ZV',
  stateCode: '27',
  fssai: '11522033000123',
  address: { line1: '12 Station Road', area: 'Kalyan West', city: 'Kalyan', pincode: '421301' },
  logoObjectKey: null,
  logoUrl: null,
  invoiceFooter: 'Goods once sold will not be taken back. Subject to Kalyan jurisdiction.',
  upiVpa: 'tarsun@upi',
}

const invoice: InvoiceDetail = {
  id: '01a0d0c5-0000-7000-8000-000000000001',
  invoiceNo: 'INV/0042',
  seriesCode: 'INV',
  fy: '2026-27',
  invoiceDate: '2026-09-05',
  orderId: null,
  retailerId: '01a0d0c5-0000-7000-8000-000000000002',
  source: 'pack',
  externalInvoiceNo: null,
  state: 'issued',
  supplyType: 'B2B',
  sellerGstin: seller.gstin,
  buyerGstin: '27AABCU9603R1ZX',
  buyerName: 'Gupta Kirana Stores',
  buyerAddress: { line1: 'Shop 4, Bazar Peth', city: 'Kalyan', pincode: '421301' },
  placeOfSupplyState: '27',
  buyerFssai: null,
  sellerFssai: seller.fssai,
  isInterState: false,
  subtotalPaise: 240_000,
  discountPaise: 4_000,
  taxablePaise: 236_000,
  cgstPaise: 14_160,
  sgstPaise: 14_160,
  igstPaise: 0,
  cessPaise: 0,
  roundOffPaise: -20,
  totalPaise: 264_300,
  cashDiscountBps: 200,
  cashDiscountUntil: '2026-09-12',
  dueDate: '2026-09-19',
  irn: null,
  ackNo: null,
  ackDate: null,
  signedQr: null,
  ewayBillNo: null,
  ewayBillValidUntil: null,
  transportMode: null,
  vehicleNo: null,
  upiQrPayload: null,
  pdfObjectKey: null,
  issuedBy: null,
  issuedAt: '2026-09-05T04:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-09-05T04:00:00.000Z',
  lines: Array.from({ length: 45 }, (_, i) => ({
    id: `01a0d0c5-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
    lineNo: i + 1,
    orderLineId: null,
    variantId: '01a0d0c5-0000-7000-8000-000000000003',
    lotId: null,
    description: `Too Yumm Karare Chilli Achari 50 g (line ${String(i + 1)})`,
    hsnCode: '19059040',
    batchNo: 'TY2609A',
    expiryDate: '2027-03-05',
    mrpPaise: 2000,
    qtyPcs: 24,
    freeQtyPcs: i % 5 === 0 ? 2 : 0,
    enteredQty: 1,
    enteredUnit: 'case',
    packSizeAtEntry: 24,
    caseSize: 24,
    ratePaise: 1667,
    discountBps: 0,
    discountPaise: 0,
    taxablePaise: 40_008,
    gstBps: 1200,
    cgstPaise: 2_400,
    sgstPaise: 2_400,
    igstPaise: 0,
    cessBps: 0,
    cessPaise: 0,
    lineTotalPaise: 44_808,
    appliedRules: [],
  })),
  creditNotes: [
    {
      id: '01a0d0c5-0000-7000-8000-000000000009',
      creditNoteNo: 'CN/0003',
      noteDate: '2026-09-06',
      reason: 'short_delivery',
      state: 'issued',
      totalPaise: 4_480,
    },
  ],
  amountDuePaise: 259_820,
  seller,
}

/** Every stream is FlateDecode; inflate them all and join, so `toContain` works on the drawn text. */
let sampleNo = 0
function pdfText(pdf: Buffer): string {
  // `DOS_PDF_SAMPLES=<dir>` writes every rendered document to disk for a human to look at.
  if (process.env.DOS_PDF_SAMPLES)
    writeFileSync(`${process.env.DOS_PDF_SAMPLES}/sample-${String(++sampleNo)}.pdf`, pdf)
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  expect(pdf.subarray(-6).toString('latin1')).toBe('%%EOF\n')
  const text: string[] = []
  const source = pdf.toString('latin1')
  const re = /\/Filter \/FlateDecode >>\nstream\n/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const start = match.index + match[0].length
    const lengthMatch = /\/Length (\d+)/.exec(
      source.slice(Math.max(0, match.index - 40), match.index + 40),
    )
    const length = Number(lengthMatch?.[1] ?? 0)
    text.push(inflateSync(pdf.subarray(start, start + length)).toString('latin1'))
  }
  return text.join('\n')
}

describe('document renderer', () => {
  it('renders an A4 tax invoice that carries the distributor, the number and the totals, across pages', () => {
    const pdf = renderInvoice(invoice, { format: 'a4', copy: 'original', logo: null })
    const text = pdfText(pdf)
    expect(text).toContain('(Tarsun Enterprises)')
    expect(text).toContain('(TAX INVOICE)')
    expect(text).toContain('(INV/0042)')
    expect(text).toContain('(Gupta Kirana Stores)')
    expect(text).toContain('(Rs 2,643.00)')
    expect(text).toContain('(Original for Recipient)')
    expect(text).toContain('Rupees Two Thousand Six Hundred Forty Three Only')
    expect(text).not.toContain('Distribution OS')
    // 45 lines do not fit one A4 page: the table header repeats on the continuation page.
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    )
    expect((text.match(/\(Description\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('renders the 80 mm thermal slip with a growing page and the UPI id', () => {
    const pdf = renderInvoice(invoice, { format: 'thermal80', copy: 'duplicate', logo: null })
    const text = pdfText(pdf)
    expect(text).toContain('(INV/0042)')
    expect(text).toContain('(UPI: tarsun@upi)')
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'))
    expect(Number(box?.[1])).toBeCloseTo(226.77, 0)
    expect(Number(box?.[2])).toBeGreaterThan(600)
  })

  it('renders a credit note, a challan and a receipt', () => {
    const note: CreditNoteDetail = {
      id: '01a0d0c5-0000-7000-8000-000000000009',
      creditNoteNo: 'CN/0003',
      seriesCode: 'CN',
      fy: '2026-27',
      noteDate: '2026-09-06',
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      retailerId: invoice.retailerId,
      reason: 'short_delivery',
      state: 'issued',
      deliveryId: null,
      isInterState: false,
      taxablePaise: 4_000,
      cgstPaise: 240,
      sgstPaise: 240,
      igstPaise: 0,
      cessPaise: 0,
      roundOffPaise: 0,
      totalPaise: 4_480,
      irn: null,
      pdfObjectKey: null,
      issuedBy: null,
      issuedAt: null,
      note: 'Two pieces short at the door',
      createdAt: '2026-09-06T04:00:00.000Z',
      lines: [
        {
          id: '01a0d0c5-0000-7000-8000-000000000010',
          invoiceLineId: '01a0d0c5-0000-7000-8000-000000000100',
          variantId: '01a0d0c5-0000-7000-8000-000000000003',
          description: 'Too Yumm Karare Chilli Achari 50 g',
          hsnCode: '19059040',
          qtyPcs: 2,
          saleable: true,
          ratePaise: 2000,
          taxablePaise: 4000,
          gstBps: 1200,
          taxPaise: 480,
          lineTotalPaise: 4480,
        },
      ],
      seller,
    }
    expect(
      pdfText(renderCreditNote(note, { format: 'a4', copy: 'original', logo: null })),
    ).toContain('(CN/0003)')

    const challan: DeliveryChallan = {
      id: '01a0d0c5-0000-7000-8000-000000000020',
      challanNo: 'DC-0007',
      seriesCode: 'DC',
      fy: '2026-27',
      challanDate: '2026-09-05',
      loadSheetId: null,
      fromLocationId: '01a0d0c5-0000-7000-8000-000000000021',
      toLocationId: '01a0d0c5-0000-7000-8000-000000000022',
      vehicleNo: 'MH 05 AB 1234',
      valuePaise: 1_250_000,
      gstPaise: 150_000,
      ewbNo: '123456789012',
      issuedBy: null,
      issuedAt: '2026-09-05T04:00:00.000Z',
      seller,
      lines: [
        {
          variantId: '01a0d0c5-0000-7000-8000-000000000003',
          variantName: 'Campa Cola 750 ml',
          hsnCode: '22021010',
          lotId: '01a0d0c5-0000-7000-8000-000000000030',
          batchNo: 'CC2608',
          qtyPcs: 60,
          caseSize: 24,
          cases: 2,
          loosePcs: 12,
          taxableValuePaise: 1_250_000,
          gstBps: 2800,
        },
      ],
      pdfObjectKey: null,
    }
    const challanText = pdfText(
      renderChallan(challan, { format: 'a4', copy: 'triplicate', logo: null }),
    )
    expect(challanText).toContain('(DELIVERY CHALLAN)')
    expect(challanText).toContain('(DC-0007)')
    expect(challanText).toContain('(2 cs + 12 \\(60 pcs\\))')

    const receipt: ReceiptDocument = {
      item: {
        id: '01a0d0c5-0000-7000-8000-000000000040',
        receiptNo: 'RCPT-0012',
        retailerId: invoice.retailerId,
        mode: 'cash',
        amountPaise: 150_000,
        allocatedPaise: 150_000,
        unallocatedPaise: 0,
        cashDiscountPaise: 0,
        status: 'collected',
        receivedAt: '2026-09-05T10:30:00.000Z',
        receivedBy: '01a0d0c5-0000-7000-8000-000000000050',
        tripId: null,
        reference: null,
        upiVpa: null,
        chequeDate: null,
        bankName: null,
        deviceId: null,
        clientReceiptNo: null,
        reversesReceiptId: null,
        depositedAt: null,
        depositRef: null,
        depositAccountId: null,
        bouncedAt: null,
        bounceReason: null,
        bankChargesPaise: 0,
        proofObjectKey: null,
        pdfObjectKey: null,
        note: null,
        createdAt: '2026-09-05T10:30:00.000Z',
      },
      allocations: [
        {
          id: '01a0d0c5-0000-7000-8000-000000000041',
          invoiceId: invoice.id,
          receiptId: '01a0d0c5-0000-7000-8000-000000000040',
          creditNoteId: null,
          writeOffId: null,
          amountPaise: 150_000,
          allocatedAt: '2026-09-05T10:30:00.000Z',
          allocatedBy: null,
          invoiceNo: 'INV/0042',
        },
      ],
      reversal: null,
      seller,
      retailer: { id: invoice.retailerId, code: 'R0001', name: 'Gupta Kirana Stores', phone: null },
    }
    const a5 = pdfText(renderReceipt(receipt, { format: 'a5', logo: null }))
    expect(a5).toContain('(RECEIPT)')
    expect(a5).toContain('(RCPT-0012)')
    expect(a5).toContain('(Rs 1,500.00)')
    expect(pdfText(renderReceipt(receipt, { format: 'thermal80', logo: null }))).toContain(
      '(RCPT-0012)',
    )
  })

  it('formats Indian rupees, amounts in words and escapes PDF text', () => {
    expect(rupees(123456789)).toBe('12,34,567.89')
    expect(rupees(-5)).toBe('-0.05')
    expect(amountInWords(264_300)).toBe('Rupees Two Thousand Six Hundred Forty Three Only')
    expect(amountInWords(12_34_56_789 * 100)).toBe(
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only',
    )
    expect(escapePdfText('a(b)c\\d ₹ é')).toBe('a\\(b\\)c\\\\d Rs \xe9')
    expect(textWidth('iii', 'regular', 10)).toBeLessThan(textWidth('WWW', 'regular', 10))
    expect(wrapText('one two three four', 'regular', 10, 60).length).toBeGreaterThan(1)
    expect(parseJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})
