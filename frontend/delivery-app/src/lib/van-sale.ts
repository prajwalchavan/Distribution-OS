/**
 * D6's figures (DOS-171): the only reader of the quote's money fields on the van-sale screen.
 *
 * Before billing, the crew reads the quote's PAYABLE figure: `totals.totalPaise`, GST and the rupee
 * round-off included, the same field the retailer order screen prints as 'You pay' (DOS-096). The breakdown
 * under the lines is the quote's own before-GST figure, its GST and its round-off. Each line shows
 * `lineTotalPaise`, the line with its GST. Schemes, bargains and order-level rules are already inside every
 * line (`priceOrder()` spreads order-level rules into the lines), so the lines add up to Before GST. The cash
 * discount is reported (ADR 0004) and never deducted from the bill's figure.
 *
 * For an item that carries only GST this is the bill to the paisa. Cess is not in the quote yet (DOS-079), and
 * the bill rounds the CGST and SGST halves separately, so on those the bill's own total, shown once it is
 * issued, is the figure the crew takes.
 *
 * Pure: no React, no network.
 */
import type { Quote } from '@dos/contracts'

export interface SaleFigures {
  /** What the shop pays: GST and round-off included. The headline under 'Bill total'. */
  billPaise: number
  beforeGstPaise: number
  gstPaise: number
  /** Signed residue of rounding to the rupee. */
  roundOffPaise: number
  /** Comes off only when the shop pays inside its window: reported, never deducted from `billPaise`. */
  cashDiscountPaise: number
}

/** The sale's figures from the office's quote, or null while there is no quote. */
export function saleFigures(quote: Quote | undefined): SaleFigures | null {
  if (quote === undefined) return null
  const { totals } = quote
  return {
    billPaise: totals.totalPaise,
    beforeGstPaise: totals.netPaise,
    gstPaise: totals.taxPaise,
    roundOffPaise: totals.roundOffPaise,
    cashDiscountPaise: quote.cashDiscountPaise,
  }
}

/** One line's GST-inclusive amount, or null when the quote has no such line (yet). */
export function lineFigure(quote: Quote | undefined, lineId: string): number | null {
  return quote?.lines.find((line) => line.lineId === lineId)?.lineTotalPaise ?? null
}
