/**
 * D6's figures (DOS-171): the only reader of the quote's money fields on the van-sale screen.
 *
 * Before billing, the crew reads the quote's PAYABLE figure: `totals.totalPaise`, GST and the rupee
 * round-off included, the same field the retailer order screen prints as 'You pay' (DOS-096). The breakdown
 * under the lines is the quote's own before-GST figure, its GST and its round-off. Each line shows
 * `lineTotalPaise`, the line with its GST. Schemes, bargains and order-level rules are already inside every
 * line (`priceOrder()` spreads order-level rules into the lines), so the lines add up to Before GST.
 *
 * NO CASH DISCOUNT IS NAMED HERE. `quote.cashDiscountPaise` is the best `cash_discount_pct` SCHEME on the net
 * of the lines it covers, and no scheme cash discount ever reaches a bill: the only discount receivables can
 * grant comes from `retailers.cash_discount_bps` applied to the bill TOTAL. Naming the scheme figure at the
 * door invites the crew to take that much less, which is the DOS-171 short collection again, so the screen
 * names none and D5 alone speaks about what a shop may deduct.
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
  }
}

/** One line's GST-inclusive amount, or null when the quote has no such line (yet). */
export function lineFigure(quote: Quote | undefined, lineId: string): number | null {
  return quote?.lines.find((line) => line.lineId === lineId)?.lineTotalPaise ?? null
}

/** One sellable line of the van-sale list: a SKU, whatever lots of it the van holds (DOS-233). */
export interface VanVariant {
  variantId: string
  name: string
  /** Pieces free to sell: the van less this trip's bills still on board, summed over the SKU's lots. */
  available: number
  /** The earliest expiry among the lots that have something to sell. */
  expiry: string | null
}

/**
 * The van-sale list, one row per SKU, from `delivery.vanSales.stock`: only lots with pieces FREE to sell
 * count, so a SKU whose every piece belongs to another shop's bill is not offered at all (DOS-233).
 */
export function vanStockByVariant(
  rows: readonly {
    variantId: string
    variantName: string
    availablePcs: number
    expiryDate: string | null
  }[],
): VanVariant[] {
  const map = new Map<string, VanVariant>()
  for (const row of rows) {
    if (row.availablePcs <= 0) continue
    const held = map.get(row.variantId)
    if (held === undefined) {
      map.set(row.variantId, {
        variantId: row.variantId,
        name: row.variantName,
        available: row.availablePcs,
        expiry: row.expiryDate,
      })
      continue
    }
    held.available += row.availablePcs
    if (row.expiryDate !== null && (held.expiry === null || row.expiryDate < held.expiry))
      held.expiry = row.expiryDate
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}
