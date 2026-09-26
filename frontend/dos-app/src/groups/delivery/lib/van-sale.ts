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
  /**
   * Pieces in one SELL-side case, the case the quote and the bill count in (QA DOS-239). The stepper steps
   * by it; 1 only when the office names no case for the item at all.
   */
  caseSize: number
}

/** A case size the stepper can step by: a whole number of pieces, at least one. */
function usableCase(caseSize: number | null | undefined): number | null {
  return caseSize !== null &&
    caseSize !== undefined &&
    Number.isSafeInteger(caseSize) &&
    caseSize > 0
    ? caseSize
    : null
}

/**
 * The van-sale list, one row per SKU, from `delivery.vanSales.stock`: only lots with pieces FREE to sell
 * count, so a SKU whose every piece belongs to another shop's bill is not offered at all (DOS-233).
 *
 * QA DOS-239: the row carries the item's sell-side case. The screen used to hand the stepper a case of ONE,
 * so "One case more" on a 60-piece Bourbon case added one piece, read "1 cs", and billed ₹18.00 for a case
 * worth ₹1,062.00 — the crew handed over 60 packets and the van came back 59 short.
 */
export function vanStockByVariant(
  rows: readonly {
    variantId: string
    variantName: string
    availablePcs: number
    expiryDate: string | null
    caseSize?: number | null | undefined
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
        caseSize: usableCase(row.caseSize) ?? 1,
      })
      continue
    }
    held.available += row.availablePcs
    if (row.expiryDate !== null && (held.expiry === null || row.expiryDate < held.expiry))
      held.expiry = row.expiryDate
    if (held.caseSize === 1) held.caseSize = usableCase(row.caseSize) ?? 1
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What a tap of the stepper — or a count typed on the pieces pad — may put on the sale: never below zero and
 * never past the pieces FREE on the van (DOS-239). The server refuses a van sale that would draw more, and
 * "short-supplied" does not exist at a shop door, so the screen stops at what is there instead of warning.
 */
export function piecesToSell(pieces: number, available: number): number {
  if (!Number.isFinite(pieces)) return 0
  return Math.max(0, Math.min(Math.trunc(pieces), Math.max(0, available)))
}

/** How the shop pays for a van sale (QA DOS-240). Cash and UPI are taken in the same call as the bill. */
export type VanPay = 'cash' | 'upi' | 'account'

/**
 * The money the crew takes for a paid van sale: the bill's own payable figure from the quote, or — when the
 * office refused a payment short of the bill it actually issues — the larger figure it named. Null while
 * there is nothing to charge.
 */
export function amountToTake(
  billPaise: number | null,
  officeSaysPaise: number | null,
): number | null {
  if (billPaise === null || billPaise <= 0) return null
  return officeSaysPaise !== null && officeSaysPaise > billPaise ? officeSaysPaise : billPaise
}

/**
 * What the crew typed against the bill, for a paid van sale (QA DOS-240). The figure is typed, never
 * pre-filled (UX-01 D6: a driver must not confirm money he did not count). Cash may be more than the bill —
 * the rest goes back as change and only the bill is receipted; UPI is the bill exactly; less than the bill
 * is credit, which is what the sale cannot be.
 */
export function takenCheck(
  pay: VanPay,
  typedPaise: number | null,
  billPaise: number | null,
): { problem: 'enter' | 'short' | 'upiExact' | null; changePaise: number } {
  if (pay === 'account' || billPaise === null) return { problem: null, changePaise: 0 }
  if (typedPaise === null || typedPaise <= 0) return { problem: 'enter', changePaise: 0 }
  if (typedPaise < billPaise) return { problem: 'short', changePaise: 0 }
  if (pay === 'upi' && typedPaise !== billPaise) return { problem: 'upiExact', changePaise: 0 }
  return { problem: null, changePaise: typedPaise - billPaise }
}

/** The office's "take this much and it sells" off a refusal (`data.payNowPaise`), or null. */
export function payNowOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const value = (data as { payNowPaise?: unknown }).payNowPaise
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The `collect` block of `delivery.vanSales.create` for a paid sale (QA DOS-240), or undefined for a sale on
 * the shop's account. The ids are the caller's, fixed with the intent so a replay records one receipt.
 */
export function collectFor(
  pay: VanPay,
  amountPaise: number | null,
  reference: string,
  ids: { id: string; receiptId: string },
):
  | { id: string; receiptId: string; mode: 'cash' | 'upi'; amountPaise: number; reference?: string }
  | undefined {
  if (pay === 'account' || amountPaise === null || amountPaise <= 0) return undefined
  const utr = reference.trim()
  return {
    id: ids.id,
    receiptId: ids.receiptId,
    mode: pay,
    amountPaise,
    ...(pay === 'upi' && utr !== '' ? { reference: utr } : {}),
  }
}
