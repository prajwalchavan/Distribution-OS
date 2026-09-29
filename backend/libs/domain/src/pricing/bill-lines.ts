import { lineTax, type GstRate } from '../gst.js'
import { divideHalfUp, shareOut } from '../money.js'
import type { AppliedRule } from './schemes.js'

/**
 * FROM ONE ORDER LINE TO THE BILL'S BATCH LINES (docs/22 §8, 2026-09-28, prices and tax: rulings 1, 2 and 10).
 *
 * The godown picks one order line from as many batches as FEFO asks, so the bill writes one line per batch. What
 * those batch lines carry must add up to the order line, to the paisa, in every column a reader sums:
 *
 *  - the DISCOUNT (ruling 1, QA DOS-330): each scheme's money is SHARED over the batch lines by largest
 *    remainder on the paid pieces — never copied whole onto each of them, which multiplied a brand claim and the
 *    owner's scheme spend by the number of batches. The same for a rule's free pieces. Every shared entry says
 *    so (`batchShare: true`), so a reader can tell it from a bill written before this with whole copies;
 *  - the TAX (ruling 2, QA DOS-332): computed ONCE on the order line's taxable with `lineTax` — the same call the
 *    quote and the order made — and the CGST, SGST, IGST and cess shared over the batch lines by largest
 *    remainder on their taxable. A fully packed order line therefore bills exactly the tax it was ordered at;
 *  - the FREE pieces (ruling 10, QA DOS-337): spread over the batch lines in proportion to what each batch
 *    carries, so a returned piece is worth the same whichever batch the crew marks. They used to sit all on the
 *    last batch, whose per-piece value came out 2.4× lower.
 *
 * A short pack bills what left: the order line's discount (and each rule) is first scaled to the packed pieces
 * by largest remainder (packed against short), exactly as before.
 *
 * Pure and dependency-free like `priceOrder()`: billing calls it at issue, and the spec proves it on paper.
 */

/** What left the rack for one order line from one batch, as the pack hands it over. */
export interface BatchPick {
  qtyPcs: number
  freeQtyPcs: number
}

/** The priced order line, as the order stores it. */
export interface OrderLineForBill {
  variantId: string
  /** Paid pieces ordered. */
  qtyPcs: number
  /** Free pieces of THIS variant ordered. */
  freeQtyPcs: number
  /** The rate charged per piece (an approved rate already replaces the list rate here). */
  ratePaise: number
  /** What comes off `ratePaise × qtyPcs` on the whole order line: the line's schemes. */
  discountPaise: number
  appliedRules: readonly AppliedRule[]
}

export interface BatchLineMoney {
  qtyPcs: number
  freeQtyPcs: number
  grossPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  lineTotalPaise: number
  appliedRules: AppliedRule[]
}

const sumOf = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0)

/** The part of an order-line amount the packed pieces carry: all of it, or its share against the short pieces. */
function packedShare(amount: number, packed: number, short: number): number {
  if (amount === 0 || packed <= 0) return 0
  if (short <= 0) return amount
  return shareOut(amount, [packed, short])[0] ?? 0
}

/** A scheme's own money on the line: what makes up its discount. */
function isDiscountMoney(rule: AppliedRule): boolean {
  return (
    rule.kind === 'scheme' &&
    rule.reward !== true &&
    rule.amountPaise !== undefined &&
    rule.rewardKind !== 'free_qty' &&
    rule.rewardKind !== 'cash_discount_pct'
  )
}

/** Free pieces of the line's own item (the rest are another item, carried by its reward line). */
function isOwnFree(rule: AppliedRule, variantId: string): boolean {
  return (
    rule.reward !== true &&
    rule.freeQty !== undefined &&
    (rule.freeVariantId === undefined || rule.freeVariantId === variantId)
  )
}

/**
 * Re-split each batch's pieces into paid and free so the free pieces follow the batches in proportion (ruling 10).
 * The pieces each batch carries do not change — only which of them are the gift.
 */
export function spreadFreePieces(batches: readonly BatchPick[]): BatchPick[] {
  const free = sumOf(batches.map((b) => b.freeQtyPcs))
  if (batches.length <= 1 || free === 0) return batches.map((b) => ({ ...b }))
  const totals = batches.map((b) => b.qtyPcs + b.freeQtyPcs)
  const freeShares = shareOut(free, totals)
  return batches.map((_, i) => {
    const f = freeShares[i] ?? 0
    return { qtyPcs: (totals[i] ?? 0) - f, freeQtyPcs: f }
  })
}

export function billOrderLine(
  line: OrderLineForBill,
  picked: readonly BatchPick[],
  rate: GstRate,
  interState: boolean,
): BatchLineMoney[] {
  if (picked.length === 0) return []
  const batches = spreadFreePieces(picked)
  const paid = batches.map((b) => b.qtyPcs)
  const free = batches.map((b) => b.freeQtyPcs)
  const packed = sumOf(paid)
  const short = Math.max(0, line.qtyPcs - packed)
  const groupDiscount = packedShare(line.discountPaise, packed, short)

  // Each rule's part of this bill, then each batch line's share of it.
  const rules = line.appliedRules
  const money = rules.filter(isDiscountMoney)
  const moneyTotal = sumOf(money.map((r) => r.amountPaise ?? 0))
  // The rules ARE the discount (every line the engine priced): share the bill's discount over them, so the batch
  // lines' rule shares add up to their discount exactly. Otherwise (a hand-seeded line) each is scaled on its own.
  const consistent = money.length > 0 && moneyTotal === line.discountPaise
  const moneyOnBill = consistent
    ? shareOut(
        groupDiscount,
        money.map((r) => r.amountPaise ?? 0),
      )
    : money.map((r) => packedShare(r.amountPaise ?? 0, packed, short))
  const ownFree = rules.filter((r) => isOwnFree(r, line.variantId))
  const ownFreeTotal = sumOf(ownFree.map((r) => r.freeQty ?? 0))
  const freeBilled = sumOf(free)
  const freeOnBill =
    ownFreeTotal > 0 && ownFreeTotal === line.freeQtyPcs
      ? shareOut(
          Math.min(freeBilled, ownFreeTotal),
          ownFree.map((r) => r.freeQty ?? 0),
        )
      : ownFree.map((r) => r.freeQty ?? 0)

  const perBatch: AppliedRule[][] = batches.map(() => [])
  const discountByBatch = batches.map(() => 0)
  for (const rule of rules) {
    const m = money.indexOf(rule)
    const f = ownFree.indexOf(rule)
    let amounts: number[] | null = null
    let frees: number[] | null = null
    if (m >= 0) {
      amounts = shareOut(moneyOnBill[m] ?? 0, paid)
      if (consistent)
        amounts.forEach((a, i) => (discountByBatch[i] = (discountByBatch[i] ?? 0) + a))
    } else if (f >= 0) {
      const onBill = freeOnBill[f] ?? 0
      frees = shareOut(onBill, free)
      // A hand-seeded free rule may also carry the gift's value: it follows the pieces.
      if (rule.amountPaise !== undefined) {
        const whole = rule.freeQty ?? 0
        const value = whole > 0 ? divideHalfUp(rule.amountPaise * onBill, whole) : rule.amountPaise
        amounts = shareOut(value, free)
      }
    } else if (rule.reward === true) {
      // The reward line's pointer carries no quantity and no money: it stays as it is on every batch line.
      perBatch.forEach((entries) => entries.push({ ...rule }))
      continue
    } else {
      // Another item's free pieces (its own reward line carries the goods), a bargain, an override, a manual
      // price: the rule's own figures, scaled to what was packed, shared over the paid pieces.
      if (rule.amountPaise !== undefined)
        amounts = shareOut(packedShare(rule.amountPaise, packed, short), paid)
      if (rule.freeQty !== undefined) frees = shareOut(rule.freeQty, paid)
    }
    perBatch.forEach((entries, i) => {
      const entry: AppliedRule = { ...rule, batchShare: true }
      if (amounts) entry.amountPaise = amounts[i] ?? 0
      if (frees) entry.freeQty = frees[i] ?? 0
      entries.push(entry)
    })
  }
  const gross = paid.map((q) => q * line.ratePaise)
  // Two rules rounding the same way can put a paisa more on one batch than it is worth (a line discounted to
  // nothing): then the batch lines take the discount by their pieces and only the bill's totals tie out, which
  // is what every reader sums.
  const discounts =
    consistent && discountByBatch.every((d, i) => d >= 0 && d <= (gross[i] ?? 0))
      ? discountByBatch
      : shareOut(groupDiscount, paid)
  const taxable = gross.map((g, i) => g - (discounts[i] ?? 0))
  const tax = lineTax(sumOf(taxable), rate, interState)
  const weights = taxable.map((t) => Math.max(0, t))
  const cgst = shareOut(tax.cgstPaise, weights)
  const sgst = shareOut(tax.sgstPaise, weights)
  const igst = shareOut(tax.igstPaise, weights)
  const cess = shareOut(tax.cessPaise, weights)

  return batches.map((b, i) => {
    const t = taxable[i] ?? 0
    const lineGst = (cgst[i] ?? 0) + (sgst[i] ?? 0) + (igst[i] ?? 0) + (cess[i] ?? 0)
    return {
      qtyPcs: b.qtyPcs,
      freeQtyPcs: b.freeQtyPcs,
      grossPaise: gross[i] ?? 0,
      discountPaise: discounts[i] ?? 0,
      taxablePaise: t,
      cgstPaise: cgst[i] ?? 0,
      sgstPaise: sgst[i] ?? 0,
      igstPaise: igst[i] ?? 0,
      cessPaise: cess[i] ?? 0,
      lineTotalPaise: t + lineGst,
      appliedRules: perBatch[i] ?? [],
    }
  })
}
