import type { InvoiceDetail } from '@dos/contracts'
import { Sheet } from '../layout.js'
import {
  amountInWords,
  money,
  PAGE_SIZES,
  PdfWriter,
  percent,
  prettyDate,
  rupees,
  type JpegImage,
} from '../pdf.js'
import { addressLines } from '../pdf.js'
import { COPY_LABELS, footer, qtyText, sellerHeader, thermalHeader } from './common.js'

export interface InvoiceRenderOptions {
  format: 'a4' | 'a5' | 'thermal80'
  copy: 'original' | 'duplicate' | 'triplicate'
  logo: JpegImage | null
}

const REASONS: Record<string, string> = {
  short_delivery: 'Short delivery',
  return_saleable: 'Return (saleable)',
  return_damaged: 'Return (damaged)',
  rate_difference: 'Rate difference',
  scheme_settlement: 'Scheme settlement',
  cancellation: 'Cancellation',
  other: 'Other',
}

function documentTitle(invoice: InvoiceDetail): string {
  if (invoice.state === 'cancelled') return 'CANCELLED INVOICE'
  return invoice.supplyType === 'B2B' ? 'TAX INVOICE' : 'INVOICE'
}

/** The GST invoice: A4/A5 with the full table, or the 80 mm slip the crew prints at the door. */
export function renderInvoice(invoice: InvoiceDetail, o: InvoiceRenderOptions): Buffer {
  return o.format === 'thermal80' ? renderThermal(invoice, o) : renderSheet(invoice, o)
}

function renderSheet(inv: InvoiceDetail, o: InvoiceRenderOptions): Buffer {
  const pdf = new PdfWriter(PAGE_SIZES[o.format === 'a5' ? 'a5' : 'a4'])
  const sheet = new Sheet(pdf, o.format === 'a5' ? 24 : 36)
  const small = o.format === 'a5'
  sellerHeader(sheet, inv.seller, o.logo, documentTitle(inv), COPY_LABELS[o.copy] ?? null)

  // header block: number/date on the left, buyer on the right
  const blockTop = sheet.y
  const half = sheet.width / 2
  sheet.keyValues(
    [
      ['Invoice no', inv.invoiceNo ?? '(draft)'],
      ['Invoice date', prettyDate(inv.invoiceDate)],
      ['Due date', prettyDate(inv.dueDate)],
      ['Place of supply', inv.placeOfSupplyState],
      ...(inv.ewayBillNo ? [['E-way bill', inv.ewayBillNo] as [string, string]] : []),
      ...(inv.irn
        ? [['IRN', inv.irn.slice(0, 32) + (inv.irn.length > 32 ? '...' : '')] as [string, string]]
        : []),
    ],
    { valueX: sheet.left + 78, size: small ? 7.5 : 8.5 },
  )
  const leftEnd = sheet.y
  sheet.y = blockTop
  const bx = sheet.left + half + 8
  const bsize = small ? 7.5 : 8.5
  pdf.text(bx, sheet.y + bsize, 'Bill to', { size: bsize, gray: 0.35 })
  sheet.y += bsize * 1.35
  pdf.text(bx, sheet.y + bsize, inv.buyerName, { size: bsize + 1, font: 'bold' })
  sheet.y += bsize * 1.45
  for (const line of addressLines(inv.buyerAddress)) {
    pdf.text(bx, sheet.y + bsize, line, { size: bsize })
    sheet.y += bsize * 1.3
  }
  if (inv.buyerGstin) {
    pdf.text(bx, sheet.y + bsize, `GSTIN ${inv.buyerGstin}`, { size: bsize })
    sheet.y += bsize * 1.3
  }
  if (inv.buyerFssai) {
    pdf.text(bx, sheet.y + bsize, `FSSAI ${inv.buyerFssai}`, { size: bsize })
    sheet.y += bsize * 1.3
  }
  sheet.y = Math.max(sheet.y, leftEnd) + 6

  // lines
  const cols = sheet.columns([
    [0.045, 'right'],
    0.31,
    0.08,
    [0.12, 'right'],
    [0.1, 'right'],
    [0.075, 'right'],
    [0.11, 'right'],
    [0.05, 'right'],
    [0.11, 'right'],
  ])
  const size = small ? 7 : 8
  const header = (): void =>
    sheet.row(
      cols,
      ['#', 'Description', 'HSN', 'Qty', 'Rate', 'Disc', 'Taxable', 'GST', 'Amount'].map((t) => ({
        text: t,
        font: 'bold' as const,
      })),
      { fill: 0.92, size },
    )
  header()
  sheet.setBreakHandler(header)
  for (const line of inv.lines) {
    const meta = [
      line.batchNo ? `Batch ${line.batchNo}` : null,
      line.expiryDate ? `Exp ${prettyDate(line.expiryDate)}` : null,
      line.mrpPaise !== null ? `MRP ${rupees(line.mrpPaise)}` : null,
      line.freeQtyPcs > 0 ? `+${String(line.freeQtyPcs)} free` : null,
    ].filter(Boolean)
    const description =
      meta.length > 0 ? `${line.description} (${meta.join(', ')})` : line.description
    sheet.row(
      cols,
      [
        { text: String(line.lineNo) },
        { text: description, wrap: true },
        { text: line.hsnCode },
        { text: qtyText(line.qtyPcs, line.caseSize) },
        { text: rupees(line.ratePaise) },
        { text: line.discountPaise > 0 ? rupees(line.discountPaise) : '-' },
        { text: rupees(line.taxablePaise) },
        { text: percent(line.gstBps) },
        { text: rupees(line.lineTotalPaise) },
      ],
      { size },
    )
  }
  sheet.setBreakHandler(null)
  sheet.space(6)

  // HSN summary + totals side by side
  const hsn = new Map<string, { qty: number; taxable: number; gstBps: number; tax: number }>()
  for (const l of inv.lines) {
    const key = `${l.hsnCode}|${String(l.gstBps)}`
    const e = hsn.get(key) ?? { qty: 0, taxable: 0, gstBps: l.gstBps, tax: 0 }
    e.qty += l.qtyPcs + l.freeQtyPcs
    e.taxable += l.taxablePaise
    e.tax += l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise
    hsn.set(key, e)
  }
  const totalsTop = sheet.y
  sheet.ensure(120)
  const totals: [string, string, ('bold' | 'regular')?][] = [
    ['Subtotal', rupees(inv.subtotalPaise)],
    ...(inv.discountPaise > 0
      ? [['Discount', `-${rupees(inv.discountPaise)}`] as [string, string]]
      : []),
    ['Taxable value', rupees(inv.taxablePaise)],
    ...(inv.isInterState
      ? [['IGST', rupees(inv.igstPaise)] as [string, string]]
      : [
          ['CGST', rupees(inv.cgstPaise)] as [string, string],
          ['SGST', rupees(inv.sgstPaise)] as [string, string],
        ]),
    ...(inv.cessPaise > 0 ? [['Cess', rupees(inv.cessPaise)] as [string, string]] : []),
    ...(inv.roundOffPaise !== 0
      ? [['Round off', rupees(inv.roundOffPaise)] as [string, string]]
      : []),
    ['TOTAL', money(inv.totalPaise), 'bold'],
  ]
  if (inv.amountDuePaise !== inv.totalPaise && inv.state !== 'cancelled')
    totals.push(['Amount due', money(inv.amountDuePaise), 'bold'])
  sheet.totals(totals, { size: small ? 8 : 9 })
  const totalsEnd = sheet.y
  // HSN summary on the left of the totals block
  sheet.y = totalsTop
  const hsnCols: { width: number; align?: 'left' | 'right' }[] = [
    { width: sheet.width * 0.16 },
    { width: sheet.width * 0.1, align: 'right' },
    { width: sheet.width * 0.14, align: 'right' },
    { width: sheet.width * 0.08, align: 'right' },
    { width: sheet.width * 0.12, align: 'right' },
  ]
  const hsnSheetWidth = hsnCols.reduce((s, c) => s + c.width, 0)
  if (hsnSheetWidth < sheet.width * 0.62) {
    const saveRight = sheet.right
    // draw as a narrow table by temporarily trusting the row's own widths (rules span the left part only)
    const rowsToDraw: string[][] = [
      ['HSN', 'Qty', 'Taxable', 'GST', 'Tax'],
      ...[...hsn.entries()].map(([k, e]) => [
        k.split('|')[0] ?? '',
        String(e.qty),
        rupees(e.taxable),
        percent(e.gstBps),
        rupees(e.tax),
      ]),
    ]
    let y = totalsTop
    const hsize = small ? 6.5 : 7.5
    rowsToDraw.forEach((r, ri) => {
      let x = sheet.left
      hsnCols.forEach((c, ci) => {
        const anchor = c.align === 'right' ? x + c.width - 3 : x + 3
        pdf.text(anchor, y + hsize + 2, r[ci] ?? '', {
          size: hsize,
          align: c.align ?? 'left',
          font: ri === 0 ? 'bold' : 'regular',
          gray: ri === 0 ? 0 : 0.2,
        })
        x += c.width
      })
      y += hsize * 1.5
      if (ri === 0)
        pdf.line(sheet.left, y, sheet.left + hsnSheetWidth, y, { width: 0.3, gray: 0.6 })
    })
    void saveRight
    sheet.y = Math.max(totalsEnd, y)
  } else sheet.y = totalsEnd
  sheet.space(4)
  sheet.text(amountInWords(inv.totalPaise), { size: small ? 7.5 : 8.5, font: 'bold' })

  if (inv.cashDiscountBps > 0 && inv.cashDiscountUntil)
    sheet.text(
      `Cash discount ${percent(inv.cashDiscountBps)} if paid by ${prettyDate(inv.cashDiscountUntil)} (given as a credit note on receipt).`,
      { size: small ? 7 : 8, gray: 0.25 },
    )
  if (inv.creditNotes.length > 0) {
    sheet.space(2)
    sheet.text('Credit notes against this bill:', { size: small ? 7 : 8, gray: 0.3 })
    for (const cn of inv.creditNotes)
      sheet.text(
        `${cn.creditNoteNo ?? '(draft)'}  ${prettyDate(cn.noteDate)}  ${REASONS[cn.reason] ?? cn.reason}  ${money(cn.totalPaise)}`,
        { size: small ? 7 : 8 },
      )
  }
  if (inv.seller.upiVpa && inv.amountDuePaise > 0 && inv.state !== 'cancelled') {
    sheet.space(2)
    sheet.text(
      `Pay by UPI to ${inv.seller.upiVpa} (${inv.seller.displayName}), reference ${inv.invoiceNo ?? ''}`,
      {
        size: small ? 7 : 8,
      },
    )
  }
  if (inv.state === 'cancelled')
    sheet.text(
      `Cancelled${inv.cancelReason ? `: ${inv.cancelReason}` : ''}. Number retained; no supply made.`,
      {
        size: 8,
        font: 'bold',
      },
    )
  footer(sheet, inv.seller, null)
  return pdf.build()
}

function renderThermal(inv: InvoiceDetail, o: InvoiceRenderOptions): Buffer {
  const pdf = new PdfWriter(PAGE_SIZES.thermal80)
  const sheet = new Sheet(pdf, 4 * 2.835)
  thermalHeader(sheet, inv.seller, documentTitle(inv))
  sheet.keyValues(
    [
      ['Invoice', inv.invoiceNo ?? '(draft)'],
      ['Date', prettyDate(inv.invoiceDate)],
      ['Due', prettyDate(inv.dueDate)],
      ['Copy', COPY_LABELS[o.copy] ?? o.copy],
    ],
    { size: 7.5, valueX: sheet.left + 42 },
  )
  sheet.space(2)
  sheet.text(inv.buyerName, { font: 'bold', size: 8.5 })
  for (const line of addressLines(inv.buyerAddress)) sheet.text(line, { size: 7 })
  if (inv.buyerGstin) sheet.text(`GSTIN ${inv.buyerGstin}`, { size: 7 })
  sheet.hr()
  for (const line of inv.lines) {
    sheet.text(line.description, { size: 7.5, font: 'bold' })
    const qty = `${qtyText(line.qtyPcs, line.caseSize)}${line.freeQtyPcs > 0 ? ` +${String(line.freeQtyPcs)} free` : ''}`
    sheet.text(`${qty} x ${rupees(line.ratePaise)}  GST ${percent(line.gstBps)}`, {
      size: 7,
      gray: 0.3,
      advance: false,
    })
    sheet.text(rupees(line.lineTotalPaise), { size: 7.5, align: 'right' })
  }
  sheet.hr()
  const pairs: [string, string, ('bold' | 'regular')?][] = [
    ['Taxable', rupees(inv.taxablePaise)],
    ...(inv.isInterState
      ? [['IGST', rupees(inv.igstPaise)] as [string, string]]
      : [
          ['CGST', rupees(inv.cgstPaise)] as [string, string],
          ['SGST', rupees(inv.sgstPaise)] as [string, string],
        ]),
    ...(inv.roundOffPaise !== 0
      ? [['Round off', rupees(inv.roundOffPaise)] as [string, string]]
      : []),
    ['TOTAL', money(inv.totalPaise), 'bold'],
  ]
  if (inv.amountDuePaise !== inv.totalPaise) pairs.push(['Due', money(inv.amountDuePaise), 'bold'])
  sheet.totals(pairs, { size: 8, valueWidth: 70 })
  sheet.paragraph(amountInWords(inv.totalPaise), { size: 7, gray: 0.25 })
  if (inv.seller.upiVpa && inv.amountDuePaise > 0)
    sheet.paragraph(`UPI: ${inv.seller.upiVpa}`, { size: 7.5, font: 'bold' })
  if (inv.seller.invoiceFooter) sheet.paragraph(inv.seller.invoiceFooter, { size: 6.5, gray: 0.3 })
  sheet.space(4)
  return pdf.build()
}
