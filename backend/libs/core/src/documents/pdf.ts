import { deflateSync } from 'node:zlib'

/**
 * A small PDF writer: pages, the two standard Helvetica faces (no font embedding — every PDF reader
 * ships them), lines, filled rectangles, JPEG images (DCTDecode, the bytes go in as they are) and a
 * top-left coordinate system. Pure Node, no dependency, no headless browser (docs/23 §8.20 item 4 on
 * an 8 GB machine). It is enough for a GST invoice, a credit note, a Rule 55 challan and a receipt in
 * A4, A5 and 80 mm thermal; anything fancier (a PNG logo, Devanagari) is a later, deliberate step.
 *
 * Text is WinAnsi (Latin-1): English only for now (founder, 2026-09-04). A character outside it prints
 * as `?` rather than corrupting the stream; the rupee sign is written `Rs` for that reason.
 */

export const POINTS_PER_MM = 72 / 25.4
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  /** 80 mm paper, 72 mm printable; the height grows with the content. */
  thermal80: { width: 80 * POINTS_PER_MM, height: 0 },
} as const

export type FontFace = 'regular' | 'bold'
export type Align = 'left' | 'right' | 'center'

interface TextOp {
  kind: 'text'
  x: number
  y: number
  text: string
  font: FontFace
  size: number
  align: Align
  gray: number
}
interface LineOp {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  gray: number
}
interface RectOp {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  fill: number | null
  stroke: number | null
  width: number
}
interface ImageOp {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  image: number
}
type Op = TextOp | LineOp | RectOp | ImageOp

interface Page {
  ops: Op[]
  /** Fixed height, or null for a thermal roll that grows with `cursor`. */
  height: number | null
  /** The lowest point any op reached (top-origin), for auto-height pages. */
  extent: number
}

export interface JpegImage {
  data: Buffer
  width: number
  height: number
  /** 1 = grey, 3 = YCbCr/RGB, 4 = CMYK. */
  components: number
}

/** Baseline-relative widths of the WinAnsi glyphs 32..126 in 1/1000 em (Adobe AFM). */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

export function textWidth(text: string, font: FontFace, size: number): number {
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let total = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    total += code >= 32 && code <= 126 ? (table[code - 32] ?? 556) : 556
  }
  return (total * size) / 1000
}

/** Trim a string to fit `maxWidth`, ending in an ellipsis when it had to be cut. */
export function fitText(text: string, font: FontFace, size: number, maxWidth: number): string {
  if (textWidth(text, font, size) <= maxWidth) return text
  let out = text
  while (out.length > 1 && textWidth(`${out}...`, font, size) > maxWidth) out = out.slice(0, -1)
  return `${out}...`
}

/** Break a string into lines no wider than `maxWidth`, on spaces where possible. */
export function wrapText(text: string, font: FontFace, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (textWidth(candidate, font, size) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = textWidth(word, font, size) <= maxWidth ? word : fitText(word, font, size, maxWidth)
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
}

export class PdfWriter {
  private readonly pages: Page[] = []
  private readonly images: JpegImage[] = []
  private readonly width: number
  private readonly fixedHeight: number | null

  constructor(size: { width: number; height: number }) {
    this.width = size.width
    this.fixedHeight = size.height > 0 ? size.height : null
    this.addPage()
  }

  get pageWidth(): number {
    return this.width
  }

  /** Null on a thermal roll: the page is as tall as its content. */
  get pageHeight(): number | null {
    return this.fixedHeight
  }

  get pageCount(): number {
    return this.pages.length
  }

  addPage(): void {
    this.pages.push({ ops: [], height: this.fixedHeight, extent: 0 })
  }

  private get page(): Page {
    const page = this.pages[this.pages.length - 1]
    if (!page) throw new Error('no page')
    return page
  }

  text(
    x: number,
    y: number,
    text: string,
    o: {
      font?: FontFace | undefined
      size?: number | undefined
      align?: Align | undefined
      gray?: number | undefined
    } = {},
  ): void {
    const size = o.size ?? 9
    this.page.ops.push({
      kind: 'text',
      x,
      y,
      text,
      font: o.font ?? 'regular',
      size,
      align: o.align ?? 'left',
      gray: o.gray ?? 0,
    })
    this.touch(y + size * 0.25)
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    o: { width?: number; gray?: number } = {},
  ): void {
    this.page.ops.push({ kind: 'line', x1, y1, x2, y2, width: o.width ?? 0.5, gray: o.gray ?? 0 })
    this.touch(Math.max(y1, y2))
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { fill?: number; stroke?: number; width?: number } = {},
  ): void {
    this.page.ops.push({
      kind: 'rect',
      x,
      y,
      w,
      h,
      fill: o.fill ?? null,
      stroke: o.stroke ?? null,
      width: o.width ?? 0.5,
    })
    this.touch(y + h)
  }

  image(image: JpegImage, x: number, y: number, w: number, h: number): void {
    const index = this.images.push(image) - 1
    this.page.ops.push({ kind: 'image', x, y, w, h, image: index })
    this.touch(y + h)
  }

  private touch(y: number): void {
    if (y > this.page.extent) this.page.extent = y
  }

  build(): Buffer {
    const objects: Buffer[] = []
    const add = (body: Buffer | string): number => {
      objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body)
      return objects.length
    }
    // 1 catalog, 2 pages, 3 regular font, 4 bold font, then images, then per page: content + page
    add('') // placeholder for the catalog (object 1)
    add('') // placeholder for the pages tree (object 2)
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const imageIds = this.images.map((img) => {
      const colorSpace =
        img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB'
      const head = `<< /Type /XObject /Subtype /Image /Width ${String(img.width)} /Height ${String(img.height)} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(img.data.byteLength)} >>\nstream\n`
      return add(
        Buffer.concat([
          Buffer.from(head, 'latin1'),
          img.data,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      )
    })
    const pageIds: number[] = []
    for (const page of this.pages) {
      const height = page.height ?? Math.max(page.extent + 8 * POINTS_PER_MM, 40 * POINTS_PER_MM)
      const content = deflateSync(Buffer.from(this.render(page, height), 'latin1'))
      const contentId = add(
        Buffer.concat([
          Buffer.from(
            `<< /Length ${String(content.byteLength)} /Filter /FlateDecode >>\nstream\n`,
            'latin1',
          ),
          content,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      )
      const xobjects = imageIds.map((id, i) => `/Im${String(i)} ${String(id)} 0 R`).join(' ')
      const pageId = add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects} >> >> /Contents ${String(contentId)} 0 R >>`,
      )
      pageIds.push(pageId)
    }
    objects[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1')
    objects[1] = Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>`,
      'latin1',
    )
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
    const offsets: number[] = []
    let length = parts[0]?.byteLength ?? 0
    objects.forEach((body, i) => {
      offsets.push(length)
      const chunk = Buffer.concat([
        Buffer.from(`${String(i + 1)} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ])
      parts.push(chunk)
      length += chunk.byteLength
    })
    const xref = [
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`,
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
      `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`,
    ].join('')
    parts.push(Buffer.from(xref, 'latin1'))
    return Buffer.concat(parts)
  }

  private render(page: Page, height: number): string {
    const out: string[] = []
    const flip = (y: number): number => height - y
    for (const op of page.ops) {
      switch (op.kind) {
        case 'text': {
          const width = textWidth(op.text, op.font, op.size)
          const x =
            op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x
          out.push(
            `BT ${fmt(op.gray)} g /${op.font === 'bold' ? 'F2' : 'F1'} ${fmt(op.size)} Tf ${fmt(x)} ${fmt(flip(op.y))} Td (${escapePdfText(op.text)}) Tj ET`,
          )
          break
        }
        case 'line':
          out.push(
            `${fmt(op.gray)} G ${fmt(op.width)} w ${fmt(op.x1)} ${fmt(flip(op.y1))} m ${fmt(op.x2)} ${fmt(flip(op.y2))} l S`,
          )
          break
        case 'rect': {
          const paint = op.fill !== null && op.stroke !== null ? 'B' : op.fill !== null ? 'f' : 'S'
          out.push(
            `${op.fill !== null ? `${fmt(op.fill)} g ` : ''}${op.stroke !== null ? `${fmt(op.stroke)} G ` : ''}${fmt(op.width)} w ${fmt(op.x)} ${fmt(flip(op.y + op.h))} ${fmt(op.w)} ${fmt(op.h)} re ${paint}`,
          )
          break
        }
        case 'image':
          out.push(
            `q ${fmt(op.w)} 0 0 ${fmt(op.h)} ${fmt(op.x)} ${fmt(flip(op.y + op.h))} cm /Im${String(op.image)} Do Q`,
          )
          break
      }
    }
    return out.join('\n')
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

/** WinAnsi text: escape the three PDF string metacharacters, replace anything Latin-1 cannot hold. */
export function escapePdfText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`
    else if (code < 32 || code > 255 || ch.length > 1) out += code === 0x20b9 ? 'Rs' : '?'
    else out += ch
  }
  return out
}

/**
 * Width, height and component count from a JPEG's SOF marker; null when the bytes are not a baseline
 * or progressive JPEG (a PNG logo is skipped rather than embedded wrongly).
 */
export function parseJpeg(data: Buffer): JpegImage | null {
  if (data.byteLength < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < data.byteLength) {
    if (data[offset] !== 0xff) return null
    const marker = data[offset + 1] ?? 0
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = data.readUInt16BE(offset + 2)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = data.readUInt16BE(offset + 5)
      const width = data.readUInt16BE(offset + 7)
      const components = data[offset + 9] ?? 3
      return { data, width, height, components }
    }
    offset += 2 + length
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// formatting helpers every template shares

/** `12,34,567.89` — Indian grouping, always two decimals, from integer paise. Negative keeps its sign. */
export function rupees(paise: number): string {
  const negative = paise < 0
  const abs = Math.abs(paise)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  const digits = String(whole)
  let grouped: string
  if (digits.length <= 3) grouped = digits
  else {
    const last3 = digits.slice(-3)
    const rest = digits.slice(0, -3)
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
  }
  return `${negative ? '-' : ''}${grouped}.${frac}`
}

/** `Rs 1,23,456.78` */
export function money(paise: number): string {
  return `Rs ${rupees(paise)}`
}

/** `05-Sep-2026` from `YYYY-MM-DD` (or an ISO instant, in IST). */
export function prettyDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date =
    value.length === 10
      ? value
      : new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 10)
  const [y, m, d] = date.split('-')
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${d ?? '??'}-${months[Number(m) - 1] ?? '???'}-${y ?? '????'}`
}

/** Percent from basis points: `1800` → `18%`, `1250` → `12.5%`. */
export function percent(bps: number): string {
  const value = bps / 100
  return `${Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '')}%`
}

/** The rupee amount in words, Indian style, for the invoice's "amount in words" line. */
export function amountInWords(paise: number): string {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ]
  const below100 = (n: number): string =>
    n < 20
      ? (ones[n] ?? '')
      : `${tens[Math.floor(n / 10)] ?? ''}${n % 10 ? ` ${ones[n % 10] ?? ''}` : ''}`
  const below1000 = (n: number): string => {
    const h = Math.floor(n / 100)
    const rest = n % 100
    return `${h ? `${ones[h] ?? ''} Hundred` : ''}${h && rest ? ' ' : ''}${rest ? below100(rest) : ''}`
  }
  const whole = Math.floor(Math.abs(paise) / 100)
  const frac = Math.abs(paise) % 100
  if (whole === 0 && frac === 0) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(whole / 10_000_000)
  const lakh = Math.floor((whole % 10_000_000) / 100_000)
  const thousand = Math.floor((whole % 100_000) / 1000)
  const rest = whole % 1000
  if (crore) parts.push(`${below100(crore)} Crore`)
  if (lakh) parts.push(`${below100(lakh)} Lakh`)
  if (thousand) parts.push(`${below100(thousand)} Thousand`)
  if (rest) parts.push(below1000(rest))
  const rupeesText = parts.length > 0 ? `Rupees ${parts.join(' ')}` : 'Rupees Zero'
  const paiseText = frac ? ` and ${below100(frac)} Paise` : ''
  return `${paise < 0 ? 'Minus ' : ''}${rupeesText}${paiseText} Only`
}

/** One address block as lines, from the loose `AddressSchema` object. */
export function addressLines(address: Record<string, unknown> | null | undefined): string[] {
  if (!address) return []
  const pick = (k: string): string | null => {
    const v = address[k]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const line3 = [pick('area'), pick('city')].filter(Boolean).join(', ')
  const pin = pick('pincode')
  return [
    pick('line1'),
    pick('line2'),
    pick('landmark'),
    line3 ? `${line3}${pin ? ` - ${pin}` : ''}` : pin,
  ].filter((l): l is string => Boolean(l))
}
