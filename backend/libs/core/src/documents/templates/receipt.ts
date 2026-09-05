import type { ReceiptDocument } from '../../modules/receivables/index.js'
import { Sheet } from '../layout.js'
import {
  amountInWords,
  money,
  PAGE_SIZES,
  PdfWriter,
  prettyDate,
  rupees,
  type JpegImage,
} from '../pdf.js'
import { footer, sellerHeader, thermalHeader } from './common.js'

const MODES: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  adjustment: 'Adjustment',
}

/** The receipt handed to the shop: A5 for the office printer, 80 mm for the crew's Bluetooth printer. */
export function renderReceipt(
  doc: ReceiptDocument,
  o: { format: 'a4' | 'a5' | 'thermal80'; logo: JpegImage | null },
): Buffer {
  const r = doc.item
  const status =
    r.status === 'bounced'
      ? 'BOUNCED RECEIPT'
      : r.status === 'cancelled'
        ? 'REVERSED RECEIPT'
        : r.amountPaise < 0
          ? 'REVERSAL'
          : 'RECEIPT'
  const detail: [string, string][] = [
    ['Receipt no', r.receiptNo ?? r.clientReceiptNo ?? '(unnumbered)'],
    ['Date', prettyDate(r.receivedAt)],
    ['Received from', `${doc.retailer.name}${doc.retailer.code ? ` (${doc.retailer.code})` : ''}`],
    ['Mode', MODES[r.mode] ?? r.mode],
    ...(r.reference ? [['Reference', r.reference] as [string, string]] : []),
    ...(r.upiVpa ? [['UPI', r.upiVpa] as [string, string]] : []),
    ...(r.chequeDate ? [['Cheque date', prettyDate(r.chequeDate)] as [string, string]] : []),
    ...(r.bankName ? [['Bank', r.bankName] as [string, string]] : []),
  ]
  const allocationLines = doc.allocations.map(
    (a) => [a.invoiceNo ?? a.invoiceId, rupees(a.amountPaise)] as [string, string],
  )

  if (o.format === 'thermal80') {
    const pdf = new PdfWriter(PAGE_SIZES.thermal80)
    const sheet = new Sheet(pdf, 4 * 2.835)
    thermalHeader(sheet, doc.seller, status)
    sheet.keyValues(detail, { size: 7.5, valueX: sheet.left + 52 })
    sheet.hr()
    sheet.text(money(r.amountPaise), { font: 'bold', size: 12, align: 'center' })
    sheet.paragraph(amountInWords(r.amountPaise), { size: 7, gray: 0.25 })
    if (allocationLines.length > 0) {
      sheet.space(2)
      sheet.text('Against bills', { size: 7.5, font: 'bold' })
      sheet.totals(allocationLines, { size: 7.5, valueWidth: 60 })
    }
    if (r.cashDiscountPaise > 0)
      sheet.totals([['Cash discount', rupees(r.cashDiscountPaise)]], { size: 7.5, valueWidth: 60 })
    if (r.unallocatedPaise > 0)
      sheet.totals([['On account', rupees(r.unallocatedPaise)]], { size: 7.5, valueWidth: 60 })
    if (r.receivedBy)
      sheet.text(`Collected by ${r.receivedBy.slice(0, 8)}`, { size: 6.5, gray: 0.4 })
    if (doc.seller.invoiceFooter)
      sheet.paragraph(doc.seller.invoiceFooter, { size: 6.5, gray: 0.3 })
    sheet.space(4)
    return pdf.build()
  }

  const pdf = new PdfWriter(PAGE_SIZES[o.format === 'a4' ? 'a4' : 'a5'])
  const sheet = new Sheet(pdf, 24)
  sellerHeader(sheet, doc.seller, o.logo, status, null)
  sheet.keyValues(detail, { valueX: sheet.left + 90 })
  sheet.space(8)
  sheet.text(money(r.amountPaise), { font: 'bold', size: 16 })
  sheet.text(amountInWords(r.amountPaise), { size: 8.5, gray: 0.25 })
  if (allocationLines.length > 0) {
    sheet.space(6)
    sheet.text('Settled against', { size: 8.5, font: 'bold' })
    sheet.totals(allocationLines, { size: 8.5 })
  }
  const extras: [string, string][] = []
  if (r.cashDiscountPaise > 0) extras.push(['Cash discount realised', rupees(r.cashDiscountPaise)])
  if (r.unallocatedPaise > 0) extras.push(['Left on account', rupees(r.unallocatedPaise)])
  if (extras.length > 0) sheet.totals(extras, { size: 8.5 })
  if (doc.reversal)
    sheet.text(
      `Reversed by ${doc.reversal.receiptNo ?? doc.reversal.id} on ${prettyDate(doc.reversal.receivedAt)}${r.bounceReason ? ` (${r.bounceReason})` : ''}`,
      { size: 8, font: 'bold' },
    )
  if (r.note) sheet.paragraph(r.note, { size: 8, gray: 0.3 })
  footer(sheet, doc.seller, 'This receipt is valid subject to realisation of the instrument.')
  return pdf.build()
}
