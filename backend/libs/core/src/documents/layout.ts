import {
  fitText,
  wrapText,
  type Align,
  type FontFace,
  type JpegImage,
  type PdfWriter,
} from './pdf.js'

/**
 * A cursor over a `PdfWriter` page: text that flows downwards, table rows with fixed column widths,
 * rules and gaps, and page breaks that call back so a table can repeat its header. Every template is
 * written against this rather than against raw coordinates.
 */
export interface Column {
  width: number
  align?: Align
}

export interface Cell {
  text: string
  font?: FontFace
  size?: number
  align?: Align
  gray?: number
  /** Wrap onto several lines instead of trimming with an ellipsis. */
  wrap?: boolean
}

export class Sheet {
  y: number
  readonly left: number
  readonly right: number
  readonly width: number
  private readonly bottom: number | null
  private onBreak: (() => void) | null = null

  constructor(
    readonly pdf: PdfWriter,
    readonly margin: number,
  ) {
    this.left = margin
    this.right = pdf.pageWidth - margin
    this.width = this.right - this.left
    this.bottom = pdf.pageHeight === null ? null : pdf.pageHeight - margin
    this.y = margin
  }

  /** What to redraw at the top of a continuation page (a table header). */
  setBreakHandler(handler: (() => void) | null): void {
    this.onBreak = handler
  }

  /** Make room for `height` points; a new page when the current one cannot hold it. */
  ensure(height: number): void {
    if (this.bottom === null || this.y + height <= this.bottom) return
    this.pdf.addPage()
    this.y = this.margin
    this.onBreak?.()
  }

  space(points: number): void {
    this.y += points
  }

  hr(o: { gray?: number; width?: number } = {}): void {
    this.ensure(4)
    this.pdf.line(this.left, this.y, this.right, this.y, {
      width: o.width ?? 0.5,
      gray: o.gray ?? 0.6,
    })
    this.y += 4
  }

  /** One line of text at the cursor (or at `x` on the same baseline when given), advancing by the line height. */
  text(
    text: string,
    o: {
      font?: FontFace | undefined
      size?: number | undefined
      align?: Align | undefined
      gray?: number | undefined
      x?: number | undefined
      advance?: boolean | undefined
    } = {},
  ): void {
    const size = o.size ?? 9
    const lineHeight = size * 1.35
    if (o.advance !== false) this.ensure(lineHeight)
    const x =
      o.x ??
      (o.align === 'right'
        ? this.right
        : o.align === 'center'
          ? this.left + this.width / 2
          : this.left)
    this.pdf.text(x, this.y + size, text, {
      font: o.font,
      size,
      align: o.align ?? 'left',
      gray: o.gray,
    })
    if (o.advance !== false) this.y += lineHeight
  }

  /** Several lines, wrapped to the content width (or `maxWidth`). */
  paragraph(
    text: string,
    o: {
      font?: FontFace | undefined
      size?: number | undefined
      gray?: number | undefined
      maxWidth?: number | undefined
    } = {},
  ): void {
    const size = o.size ?? 9
    for (const line of wrapText(text, o.font ?? 'regular', size, o.maxWidth ?? this.width))
      this.text(line, { font: o.font, size, gray: o.gray })
  }

  /** Two-column label/value lines: label at the left edge, value at `valueX`. */
  keyValues(pairs: [string, string][], o: { size?: number; valueX?: number } = {}): void {
    const size = o.size ?? 8.5
    const valueX = o.valueX ?? this.left + this.width * 0.35
    for (const [k, v] of pairs) {
      this.ensure(size * 1.35)
      this.pdf.text(this.left, this.y + size, k, { size, gray: 0.35 })
      this.pdf.text(valueX, this.y + size, v, { size })
      this.y += size * 1.35
    }
  }

  /**
   * A table row. Column widths are in points and sum to the content width; a wrapped cell makes the
   * row as tall as its longest cell; `fill` shades the row (a header).
   */
  row(
    columns: Column[],
    cells: Cell[],
    o: { fill?: number; size?: number; padding?: number; rule?: boolean } = {},
  ): void {
    const size = o.size ?? 8.5
    const pad = o.padding ?? 3
    const lines: string[][] = cells.map((cell, i) => {
      const col = columns[i]
      const inner = (col?.width ?? 0) - pad * 2
      const font = cell.font ?? 'regular'
      const csize = cell.size ?? size
      return cell.wrap
        ? wrapText(cell.text, font, csize, inner)
        : [fitText(cell.text, font, csize, inner)]
    })
    const rows = Math.max(1, ...lines.map((l) => l.length))
    const lineHeight = size * 1.3
    const height = rows * lineHeight + pad * 2
    this.ensure(height)
    if (o.fill !== undefined) this.pdf.rect(this.left, this.y, this.width, height, { fill: o.fill })
    let x = this.left
    cells.forEach((cell, i) => {
      const col = columns[i] ?? { width: 0 }
      const align = cell.align ?? col.align ?? 'left'
      const anchor =
        align === 'right' ? x + col.width - pad : align === 'center' ? x + col.width / 2 : x + pad
      ;(lines[i] ?? []).forEach((line, li) => {
        this.pdf.text(anchor, this.y + pad + (li + 1) * lineHeight - lineHeight * 0.28, line, {
          font: cell.font,
          size: cell.size ?? size,
          align,
          gray: cell.gray,
        })
      })
      x += col.width
    })
    this.y += height
    if (o.rule !== false)
      this.pdf.line(this.left, this.y, this.right, this.y, { width: 0.3, gray: 0.75 })
  }

  /** Right-aligned label/amount pairs, for a totals block. */
  totals(
    pairs: [string, string, FontFace?][],
    o: { size?: number; labelWidth?: number; valueWidth?: number } = {},
  ): void {
    const size = o.size ?? 9
    const valueWidth = o.valueWidth ?? 80
    const labelWidth = o.labelWidth ?? 130
    for (const [label, value, font] of pairs) {
      this.ensure(size * 1.4)
      this.pdf.text(this.right - valueWidth - 6, this.y + size, label, {
        size,
        align: 'right',
        font,
        gray: font ? 0 : 0.3,
      })
      this.pdf.text(this.right, this.y + size, value, { size, align: 'right', font })
      this.y += size * 1.4
    }
    void labelWidth
  }

  /** A JPEG logo, scaled to fit a box, top-left at (x, y). Returns the drawn height. */
  logo(image: JpegImage, x: number, y: number, maxW: number, maxH: number): number {
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    this.pdf.image(image, x, y, w, h)
    return h
  }

  /** Columns from fractions of the content width, so a template says `[0.5, 0.2, 0.3]`. */
  columns(fractions: (number | [number, Align])[]): Column[] {
    return fractions.map((f) =>
      Array.isArray(f) ? { width: this.width * f[0], align: f[1] } : { width: this.width * f },
    )
  }
}
