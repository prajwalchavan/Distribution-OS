import type { CreditNoteDetail } from '@dos/contracts'
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
import { COPY_LABELS, footer, sellerHeader } from './common.js'

const REASONS: Record<string, string> = {
  short_delivery: 'Short delivery',
  return_saleable: 'Goods returned (saleable)',
  return_damaged: 'Goods returned (damaged)',
  rate_difference: 'Rate difference',
  scheme_settlement: 'Scheme settlement',
  cancellation: 'Cancellation',
  other: 'Other',
}

/** The credit note (GST section 34): the correction to an issued bill, never an edit of it. */
export function renderCreditNote(
  note: CreditNoteDetail,
  o: {
    format: 'a4' | 'a5' | 'thermal80'
    copy: 'original' | 'duplicate' | 'triplicate'
    logo: JpegImage | null
  },
): Buffer {
  const pdf = new PdfWriter(PAGE_SIZES[o.format === 'a5' ? 'a5' : 'a4'])
  const sheet = new Sheet(pdf, o.format === 'a5' ? 24 : 36)
  sellerHeader(
    sheet,
    note.seller,
    o.logo,
    note.state === 'cancelled' ? 'CANCELLED CREDIT NOTE' : 'CREDIT NOTE',
    COPY_LABELS[o.copy] ?? null,
  )
  sheet.keyValues(
    [
      ['Credit note no', note.creditNoteNo ?? '(draft)'],
      ['Date', prettyDate(note.noteDate)],
      ['Against invoice', note.invoiceNo ?? note.invoiceId],
      ['Reason', REASONS[note.reason] ?? note.reason],
      ...(note.irn ? [['IRN', note.irn.slice(0, 32)] as [string, string]] : []),
    ],
    { valueX: sheet.left + 90 },
  )
  sheet.space(6)
  const cols = sheet.columns([
    [0.05, 'right'],
    0.4,
    0.1,
    [0.1, 'right'],
    [0.11, 'right'],
    [0.07, 'right'],
    [0.17, 'right'],
  ])
  const header = (): void =>
    sheet.row(
      cols,
      ['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST', 'Amount'].map((t) => ({
        text: t,
        font: 'bold' as const,
      })),
      { fill: 0.92 },
    )
  header()
  sheet.setBreakHandler(header)
  note.lines.forEach((line, i) => {
    sheet.row(cols, [
      { text: String(i + 1) },
      { text: `${line.description}${line.saleable ? '' : ' (damaged)'}`, wrap: true },
      { text: line.hsnCode },
      { text: `${String(line.qtyPcs)} pcs` },
      { text: rupees(line.ratePaise) },
      { text: percent(line.gstBps) },
      { text: rupees(line.lineTotalPaise) },
    ])
  })
  sheet.setBreakHandler(null)
  sheet.space(8)
  sheet.totals([
    ['Taxable value', rupees(note.taxablePaise)],
    ...(note.isInterState
      ? [['IGST', rupees(note.igstPaise)] as [string, string]]
      : [
          ['CGST', rupees(note.cgstPaise)] as [string, string],
          ['SGST', rupees(note.sgstPaise)] as [string, string],
        ]),
    ...(note.cessPaise > 0 ? [['Cess', rupees(note.cessPaise)] as [string, string]] : []),
    ...(note.roundOffPaise !== 0
      ? [['Round off', rupees(note.roundOffPaise)] as [string, string]]
      : []),
    ['TOTAL CREDIT', money(note.totalPaise), 'bold'],
  ])
  sheet.space(4)
  sheet.text(amountInWords(note.totalPaise), { size: 8.5, font: 'bold' })
  if (note.note) sheet.paragraph(note.note, { size: 8, gray: 0.3 })
  footer(sheet, note.seller, null)
  return pdf.build()
}
