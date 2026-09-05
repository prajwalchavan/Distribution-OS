import type { DeliveryChallan } from '@dos/contracts'
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

/** The Rule 55 delivery challan that rides with the vehicle. Value declared per lot, GST shown, EWB number when the load needed one. */
export function renderChallan(
  challan: DeliveryChallan,
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
    challan.seller,
    o.logo,
    'DELIVERY CHALLAN',
    `Rule 55 - ${COPY_LABELS[o.copy] ?? o.copy}`,
  )
  sheet.keyValues(
    [
      ['Challan no', challan.challanNo ?? '(draft)'],
      ['Date', prettyDate(challan.challanDate)],
      ['Vehicle', challan.vehicleNo ?? '-'],
      ['E-way bill', challan.ewbNo ?? 'not required'],
      [
        'Purpose',
        'Supply on approval / line sale from the vehicle; tax invoices issued per delivery',
      ],
    ],
    { valueX: sheet.left + 78 },
  )
  sheet.space(6)
  const cols = sheet.columns([
    [0.05, 'right'],
    0.29,
    0.09,
    0.12,
    [0.19, 'right'],
    [0.14, 'right'],
    [0.12, 'right'],
  ])
  const header = (): void =>
    sheet.row(
      cols,
      ['#', 'Item', 'HSN', 'Batch', 'Qty', 'Value', 'GST'].map((t) => ({
        text: t,
        font: 'bold' as const,
      })),
      { fill: 0.92 },
    )
  header()
  sheet.setBreakHandler(header)
  challan.lines.forEach((line, i) => {
    const qty =
      line.caseSize && line.caseSize > 1
        ? `${String(line.cases)} cs${line.loosePcs ? ` + ${String(line.loosePcs)}` : ''} (${String(line.qtyPcs)} pcs)`
        : `${String(line.qtyPcs)} pcs`
    sheet.row(cols, [
      { text: String(i + 1) },
      { text: line.variantName, wrap: true },
      { text: line.hsnCode ?? '-' },
      { text: line.batchNo ?? '-' },
      { text: qty },
      { text: rupees(line.taxableValuePaise) },
      { text: percent(line.gstBps) },
    ])
  })
  sheet.setBreakHandler(null)
  sheet.space(8)
  sheet.totals([
    ['Declared value', rupees(challan.valuePaise)],
    ['GST on value', rupees(challan.gstPaise)],
    ['TOTAL', money(challan.valuePaise + challan.gstPaise), 'bold'],
  ])
  sheet.space(4)
  sheet.text(amountInWords(challan.valuePaise + challan.gstPaise), { size: 8.5, font: 'bold' })
  sheet.space(10)
  sheet.text('Received the above goods in good condition.', { size: 8, gray: 0.3 })
  sheet.space(18)
  sheet.text('Driver / crew signature', { size: 8, gray: 0.35 })
  footer(sheet, challan.seller, null)
  return pdf.build()
}
