import { ORPCError } from '@orpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Quote } from '@dos/contracts'
import { paise, roundToRupee, uuidv7 } from '@dos/domain'
import type { salesOrderLines } from '@dos/db'
import { productVariants, tenantProducts, type AppliedRule, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { approvedBargainsFor, todayIst, type QuoteService } from '../pricing/index.js'
import type { OrderRow } from './orders.mappers.js'

/**
 * Turns what a rep or retailer typed into priced `sales_order_lines` rows.
 *
 * The engine is never re-implemented here: quantities are converted to pieces with the tenant's SELL-SIDE pack
 * size (docs/17 B: `tenant_products.case_size_override` else `product_variants.default_case_size`), the pieces go
 * through `pricing.quote` (which runs `priceOrder()` from @dos/domain), and tax arrives with the quote, per line,
 * at the HSN's GST and compensation-cess rates dated to the pricing date (DOS-096, DOS-079) — so a line stores
 * exactly the tax the shop was quoted, and `line_total − tax` is its taxable.
 * Order-level rules are already spread across the lines by the engine's `allocate()`, so the header is a plain
 * sum of its lines and no paisa is lost.
 */

export type EnteredUnit = 'piece' | 'inner' | 'case'

type OrderLineRow = typeof salesOrderLines.$inferSelect
type QuotedLine = Quote['lines'][number]

export interface EnteredLine {
  id: string
  variantId: string
  enteredQty: number
  enteredUnit: EnteredUnit
}

export interface OrderTotals {
  subtotalPaise: number
  discountPaise: number
  /** GST plus compensation cess (DOS-079). */
  taxPaise: number
  /** The cess share of `taxPaise`, never an addition on top of it. */
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
}

export interface PricedOrderLines {
  lines: (typeof salesOrderLines.$inferInsert)[]
  totals: OrderTotals
  /** The raw quote, so a caller can inspect list vs charged rate (the `below_floor` gate at submit). */
  quote: Quote | null
}

export const ZERO_TOTALS: OrderTotals = {
  subtotalPaise: 0,
  discountPaise: 0,
  taxPaise: 0,
  cessPaise: 0,
  roundOffPaise: 0,
  totalPaise: 0,
}

export interface VariantPack {
  /** Pieces per case the tenant sells in. */
  caseSize: number
}

/**
 * Sell-side pack size per variant. Buy-side packs (`supplier_pack_configs`) are procurement's and are
 * deliberately not consulted here — a case on a bill is the case the distributor sells, not the one it bought.
 */
export async function loadVariantPacks(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, VariantPack>> {
  if (variantIds.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      variantId: productVariants.id,
      caseSize: sql<number>`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
    })
    .from(productVariants)
    .leftJoin(
      tenantProducts,
      and(eq(tenantProducts.variantId, productVariants.id), eq(tenantProducts.tenantId, tenantId)),
    )
    .where(inArray(productVariants.id, [...variantIds]))
  const map = new Map<string, VariantPack>(
    rows.map((r) => [r.variantId, { caseSize: Number(r.caseSize) }]),
  )
  const missing = variantIds.filter((id) => !map.has(id))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', { message: `Unknown variant(s): ${missing.join(', ')}` })
  return map
}

/**
 * Pieces in one unit as entered. `inner` uses the sell-side case size until the pack hierarchy
 * (`product_packs`) is curated for the tenant's brands; the value used is frozen on the line as
 * `pack_size_at_entry`, so a later case-size change never rewrites an old bill (docs/17 A3).
 */
export function packSizeFor(unit: EnteredUnit, caseSize: number): number {
  return unit === 'piece' ? 1 : caseSize
}

export interface PriceLinesArgs {
  orderId: string
  retailerId: string
  lines: readonly EnteredLine[]
  /** Set when the order prices on the delivery date; schemes with `pricingDateMode: 'delivery'` use it. */
  deliveryDate?: string | null
}

/** The money columns of an order line, as one engine result prices them. */
export type PricedLineFields = Pick<
  OrderLineRow,
  | 'freeQtyPcs'
  | 'listRatePaise'
  | 'ratePaise'
  | 'discountBps'
  | 'discountPaise'
  | 'gstBps'
  | 'cessBps'
  | 'taxPaise'
  | 'cessPaise'
  | 'lineTotalPaise'
  | 'appliedRules'
  | 'priceLocked'
>

/**
 * What one quoted line puts on an order line: the one copy of this arithmetic, shared by drafting
 * (`priceOrderLines`) and confirm (`repriceApprovedBargains`), so a re-priced line is stored exactly as a drafted one.
 */
export function pricedLineFields(q: QuotedLine): PricedLineFields {
  // A bargain is a discount from the retailer's point of view, so both land in `discount_paise`.
  const discountPaise = q.discountPaise + q.bargainPaise
  return {
    freeQtyPcs: q.freeQtyPcs,
    listRatePaise: q.listRatePaise,
    ratePaise: q.ratePaise,
    discountBps: q.grossPaise > 0 ? Math.round((discountPaise * 10_000) / q.grossPaise) : 0,
    discountPaise,
    gstBps: q.gstBps,
    cessBps: q.cessBps,
    // The quote is the only place an order's cess is computed; this copies it (DOS-079 amendment b).
    taxPaise: q.taxPaise,
    cessPaise: q.cessPaise,
    lineTotalPaise: q.lineTotalPaise,
    appliedRules: toStoredRules(q.appliedRules),
    // A negotiated or overridden rate must survive re-pricing at delivery (§4.4).
    priceLocked: q.appliedRules.some((r) => r.kind === 'bargain' || r.kind === 'override'),
  }
}

/**
 * The header from its lines. A line's taxable (`line_total − tax`) plus what came off it is its gross, so the
 * subtotal is the order's gross and the header is a plain sum of its lines. s.170: the bill total is rounded to the
 * rupee and the residue is posted to Round Off, with the same `roundToRupee` billing issues the invoice with; for a
 * freshly quoted order this equals the quote's own `totals.totalPaise` / `roundOffPaise`.
 */
export function orderTotals(
  lines: readonly Pick<
    OrderLineRow,
    'discountPaise' | 'taxPaise' | 'cessPaise' | 'lineTotalPaise'
  >[],
): OrderTotals {
  let subtotal = 0
  let discount = 0
  let tax = 0
  let cess = 0
  for (const line of lines) {
    subtotal += line.lineTotalPaise - line.taxPaise + line.discountPaise
    discount += line.discountPaise
    tax += line.taxPaise
    cess += line.cessPaise
  }
  const { rounded, roundOff } = roundToRupee(paise(subtotal - discount + tax))
  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxPaise: tax,
    cessPaise: cess,
    roundOffPaise: roundOff,
    totalPaise: rounded,
  }
}

export async function priceOrderLines(
  tx: Db,
  quotes: QuoteService,
  args: PriceLinesArgs,
): Promise<PricedOrderLines> {
  const { tenantId } = currentTenant()
  if (args.lines.length === 0) return { lines: [], totals: { ...ZERO_TOTALS }, quote: null }
  const packs = await loadVariantPacks(
    tx,
    args.lines.map((l) => l.variantId),
  )
  const entered = args.lines.map((line) => {
    const pack = packs.get(line.variantId)
    if (!pack) throw new ORPCError('BAD_REQUEST', { message: `Unknown variant ${line.variantId}` })
    const packSize = packSizeFor(line.enteredUnit, pack.caseSize)
    return { ...line, packSize, qtyPcs: line.enteredQty * packSize }
  })

  // A missing GST rate for any item's HSN is a 400 naming the codes, raised inside the quote (never a silent 0%).
  const quote = await quotes.quote({
    retailerId: args.retailerId,
    orderId: args.orderId,
    ...(args.deliveryDate ? { deliveryDate: args.deliveryDate } : {}),
    lines: entered.map((l) => ({ lineId: l.id, variantId: l.variantId, qtyPcs: l.qtyPcs })),
  })
  const quoted = new Map(quote.lines.map((l) => [l.lineId, l]))

  const lines = entered.map((line, index) => {
    const q = quoted.get(line.id)
    if (!q) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `quote lost line ${line.id}` })
    return {
      id: line.id,
      tenantId,
      orderId: args.orderId,
      lineNo: index + 1,
      variantId: line.variantId,
      enteredQty: line.enteredQty,
      enteredUnit: line.enteredUnit,
      packSizeAtEntry: line.packSize,
      qtyPcs: q.qtyPcs,
      ...pricedLineFields(q),
    } satisfies typeof salesOrderLines.$inferInsert
  })
  const all = [...lines, ...rewardLines(tenantId, args.orderId, quote, lines.length)]

  return { lines: all, totals: orderTotals(all), quote }
}

/** True for a line this module wrote as a scheme reward, not one the rep or the shop typed. */
export function isRewardLine(line: Pick<OrderLineRow, 'qtyPcs' | 'freeQtyPcs'>): boolean {
  return line.qtyPcs === 0 && line.freeQtyPcs > 0
}

/**
 * QA DOS-185: a scheme whose reward is a DIFFERENT item ("a bottle free per case") is an entitlement to
 * GOODS, not a footnote on the line that triggered it. The engine returns it in `freeItems`; here it becomes
 * a real order line of the reward variant at no charge — `qty_pcs = 0`, `free_qty_pcs` = the reward, rate ₹0 —
 * which is exactly how the rest of the chain already carries free goods, so the reservation, the pick row, the
 * ₹0 invoice line, the load sheet, the delivery and the credit note all take it with no special case. Free
 * pieces of a line's OWN variant stay where the engine puts them, on that line.
 *
 * One line per (reward variant × rule), so two triggering lines of the same scheme are one gift on the sheet.
 */
function rewardLines(
  tenantId: string,
  orderId: string,
  quote: Quote,
  enteredCount: number,
): (typeof salesOrderLines.$inferInsert &
  Pick<OrderLineRow, 'discountPaise' | 'taxPaise' | 'cessPaise' | 'lineTotalPaise'>)[] {
  const rewards = new Map<
    string,
    { variantId: string; ruleId: string; version: number; qtyPcs: number }
  >()
  for (const line of quote.lines) {
    for (const free of line.freeItems) {
      if (free.variantId === line.variantId || free.qtyPcs <= 0) continue
      const key = `${free.variantId}|${free.ruleId}`
      const found = rewards.get(key)
      if (found) found.qtyPcs += free.qtyPcs
      else rewards.set(key, { ...free })
    }
  }
  return [...rewards.values()].map((reward, index) => ({
    id: uuidv7(),
    tenantId,
    orderId,
    lineNo: enteredCount + index + 1,
    variantId: reward.variantId,
    // Nobody typed this line, so it is entered in the unit it is counted in: pieces.
    enteredQty: reward.qtyPcs,
    enteredUnit: 'piece' as const,
    packSizeAtEntry: 1,
    qtyPcs: 0,
    freeQtyPcs: reward.qtyPcs,
    /*
     * Nothing is charged and nothing is taxed. A free line's taxable is ₹0, which IS the treatment billing
     * already gives free goods (`InvoiceLineSchema.freeQtyPcs`: "quantity with no value, excluded from
     * taxablePaise"), and the bill puts the item's own dated HSN rate on the line at issue. Putting a rate
     * here would invent tax on a gift, which is not ours to decide.
     */
    listRatePaise: 0,
    ratePaise: 0,
    discountBps: 0,
    discountPaise: 0,
    gstBps: 0,
    cessBps: 0,
    taxPaise: 0,
    cessPaise: 0,
    lineTotalPaise: 0,
    /*
     * ONE marker back to the rule that gave it — and NOT the rule again. The triggering line already
     * carries the entry with `freeQty` / `freeVariantId`; repeating it here made every reader that sums
     * or enumerates `freeQty` per line (the claim builder, the scheme-spend register) count the gift
     * twice: claimed twice from the brand, "spent" twice on the owner's register. The quantity of this
     * line is structural (`freeQtyPcs`), so the pointer needs no quantity. A reader that must recognise
     * a gift line uses `isRewardLine` (`qtyPcs = 0 && freeQtyPcs > 0`), as the picklist, the pack, the
     * bill and the delivery already do.
     */
    appliedRules: [
      { ruleId: reward.ruleId, version: reward.version, kind: 'scheme' as const, reward: true },
    ],
    priceLocked: false,
  }))
}

/** The approved rate a stored line already carries: the `ruleId` of its `bargain` rule, or null. */
function storedBargain(line: Pick<OrderLineRow, 'appliedRules'>): string | null {
  return line.appliedRules.find((r) => r.kind === 'bargain')?.ruleId ?? null
}

export interface RepricedLines {
  /** Every line of the order, the changed ones carrying their new money: what confirm reserves. */
  lines: OrderLineRow[]
  /** Only the lines whose money changed: what confirm writes. */
  changed: OrderLineRow[]
  /** The header from `lines`. */
  totals: OrderTotals
}

/**
 * DOS-126: at confirm, the drafted prices plus any rate approved since the draft, and nothing else.
 *
 * Lines are priced only while the order is a draft, so a rate request still waiting then was absent from the quote
 * and its line was stored at the list rate. A line changes here only when BOTH hold: the engine now prices it with
 * an approved rate the stored line does not carry, and that lowers its net. Every other line keeps its drafted
 * money: price-list rates and schemes are edited in place, so a full re-price would move lines to later edits and
 * could raise a total a credit decision was taken on.
 *
 *  - The cheap check first: `approvedBargainsFor` (the rule the quote applies: this order's asks and the shop's
 *    standalone ones) says whether any line lacks an approved rate for its item; an order with none runs no quote.
 *  - The quote runs on the CALLER's transaction (`quoteInTx`), because the rate approved by the decision that
 *    confirms is not committed yet. It prices the stored pieces (never entered × today's case size, docs/17 A3) on
 *    the draft's date — `writeLines` re-inserts every line in the transaction that quoted them, so the earliest
 *    `created_at` is that day — and passes the delivery date when the order prices on delivery, as `writeLines` does.
 *  - Engine and GST errors propagate: an approved rate that cannot be priced never confirms at the wrong rate.
 *
 * A changed line takes every priced field of that one engine result, so its rules and free pieces agree, and keeps
 * its id, quantities and fulfilment counters, so reservations, picks and device rows follow it. Null = no change.
 */
export async function repriceApprovedBargains(
  tx: Db,
  quotes: QuoteService,
  args: {
    order: Pick<OrderRow, 'id' | 'retailerId' | 'pricingDateMode' | 'expectedDeliveryDate'>
    lines: readonly OrderLineRow[]
  },
): Promise<RepricedLines | null> {
  const { order, lines } = args
  const ctx = currentTenant()
  const priced = lines.filter((line) => line.qtyPcs > 0)
  if (priced.length === 0) return null
  const approved = await approvedBargainsFor(tx, {
    tenantId: ctx.tenantId,
    retailerId: order.retailerId,
    orderId: order.id,
    variantIds: [...new Set(priced.map((line) => line.variantId))],
  })
  const lacksApprovedRate = priced.some((line) => {
    const rate = approved.find((b) => b.variantId === line.variantId)
    return rate !== undefined && rate.id !== storedBargain(line)
  })
  if (!lacksApprovedRate) return null

  const draftedAt = new Date(Math.min(...lines.map((line) => line.createdAt.getTime())))
  const quote = await quotes.quoteInTx(tx, ctx, {
    retailerId: order.retailerId,
    orderId: order.id,
    pricingDate: todayIst(draftedAt),
    ...(order.pricingDateMode === 'delivery' && order.expectedDeliveryDate
      ? { deliveryDate: order.expectedDeliveryDate }
      : {}),
    // A reward line (DOS-185) is not priced: it carries no rate for a bargain to replace, and the engine
    // would refuse a variant the shop's price list does not name. Its free pieces depend on the quantities
    // ordered, which a rate approval never changes, so it comes through confirm exactly as drafted.
    lines: priced.map((line) => ({
      lineId: line.id,
      variantId: line.variantId,
      qtyPcs: line.qtyPcs,
    })),
  })
  const quoted = new Map(quote.lines.map((q) => [q.lineId, q]))

  const changed: OrderLineRow[] = []
  const merged = lines.map((line) => {
    // Exactly the lines `priced` left out of the quote above: a reward line, and nothing else today.
    if (line.qtyPcs <= 0) return line
    const q = quoted.get(line.id)
    if (!q) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `quote lost line ${line.id}` })
    const stored = storedBargain(line)
    const newRate = q.appliedRules.some((r) => r.kind === 'bargain' && r.ruleId !== stored)
    if (!newRate || q.lineNetPaise >= line.lineTotalPaise - line.taxPaise) return line
    const next: OrderLineRow = { ...line, ...pricedLineFields(q) }
    changed.push(next)
    return next
  })
  if (changed.length === 0) return null
  return { lines: merged, changed, totals: orderTotals(merged) }
}

/**
 * The engine's rules as the column stores them. Zod leaves absent members as explicit `undefined`, which
 * `exactOptionalPropertyTypes` refuses to widen into the jsonb type, so only the keys that exist are copied.
 */
function toStoredRules(rules: Quote['lines'][number]['appliedRules']): AppliedRule[] {
  return rules.map((r) => ({
    ruleId: r.ruleId,
    version: r.version,
    kind: r.kind,
    ...(r.rewardKind === undefined ? {} : { rewardKind: r.rewardKind }),
    ...(r.amountPaise === undefined ? {} : { amountPaise: r.amountPaise }),
    ...(r.freeQty === undefined ? {} : { freeQty: r.freeQty }),
    ...(r.freeVariantId === undefined ? {} : { freeVariantId: r.freeVariantId }),
    ...(r.reward === undefined ? {} : { reward: r.reward }),
  }))
}
