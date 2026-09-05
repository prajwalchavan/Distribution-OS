import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Quote } from '@dos/contracts'
import { percentOf, paise, roundToRupee } from '@dos/domain'
import type { salesOrderLines } from '@dos/db'
import { hsnRates, productVariants, tenantProducts, type AppliedRule, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import type { QuoteService } from '../pricing/index.js'

/**
 * Turns what a rep or retailer typed into priced `sales_order_lines` rows.
 *
 * The engine is never re-implemented here: quantities are converted to pieces with the tenant's SELL-SIDE pack
 * size (docs/17 B: `tenant_products.case_size_override` else `product_variants.default_case_size`), the pieces go
 * through `pricing.quote` (which runs `priceOrder()` from @dos/domain), and only GST is added on top, per line,
 * at the HSN rate dated to the pricing date. Order-level rules are already spread across the lines by the
 * engine's `allocate()`, so the header is a plain sum of its lines and no paisa is lost.
 */

export type EnteredUnit = 'piece' | 'inner' | 'case'

export interface EnteredLine {
  id: string
  variantId: string
  enteredQty: number
  enteredUnit: EnteredUnit
}

export interface OrderTotals {
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
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
  roundOffPaise: 0,
  totalPaise: 0,
}

export interface VariantPack {
  /** Pieces per case the tenant sells in. */
  caseSize: number
  hsnCode: string
}

/**
 * Sell-side pack size and HSN per variant. Buy-side packs (`supplier_pack_configs`) are procurement's and are
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
      hsnCode: productVariants.hsnCode,
      caseSize: sql<number>`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
    })
    .from(productVariants)
    .leftJoin(
      tenantProducts,
      and(eq(tenantProducts.variantId, productVariants.id), eq(tenantProducts.tenantId, tenantId)),
    )
    .where(inArray(productVariants.id, [...variantIds]))
  const map = new Map<string, VariantPack>(
    rows.map((r) => [r.variantId, { caseSize: Number(r.caseSize), hsnCode: r.hsnCode }]),
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

/** Dated GST rate per HSN, so a re-print uses the rate that applied on the order's pricing date. */
export async function loadGstBps(
  tx: Db,
  hsnCodes: readonly string[],
  on: string,
): Promise<Map<string, number>> {
  if (hsnCodes.length === 0) return new Map()
  const rows = await tx
    .select({
      hsnCode: hsnRates.hsnCode,
      gstBps: hsnRates.gstBps,
      effectiveFrom: hsnRates.effectiveFrom,
    })
    .from(hsnRates)
    .where(
      and(
        inArray(hsnRates.hsnCode, [...hsnCodes]),
        lte(hsnRates.effectiveFrom, on),
        or(isNull(hsnRates.effectiveTo), gte(hsnRates.effectiveTo, on)),
      ),
    )
    .orderBy(desc(hsnRates.effectiveFrom))
  const map = new Map<string, number>()
  for (const row of rows) if (!map.has(row.hsnCode)) map.set(row.hsnCode, row.gstBps)
  const missing = hsnCodes.filter((code) => !map.has(code))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', {
      message: `No GST rate for HSN ${missing.join(', ')} on ${on}; add an hsn_rates row`,
      data: { hsnCodes: missing, on },
    })
  return map
}

export interface PriceLinesArgs {
  orderId: string
  retailerId: string
  lines: readonly EnteredLine[]
  /** Set when the order prices on the delivery date; schemes with `pricingDateMode: 'delivery'` use it. */
  deliveryDate?: string | null
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
    return { ...line, packSize, hsnCode: pack.hsnCode, qtyPcs: line.enteredQty * packSize }
  })

  const quote = await quotes.quote({
    retailerId: args.retailerId,
    orderId: args.orderId,
    ...(args.deliveryDate ? { deliveryDate: args.deliveryDate } : {}),
    lines: entered.map((l) => ({ lineId: l.id, variantId: l.variantId, qtyPcs: l.qtyPcs })),
  })
  const quoted = new Map(quote.lines.map((l) => [l.lineId, l]))
  const gst = await loadGstBps(tx, [...new Set(entered.map((l) => l.hsnCode))], quote.pricingDate)

  let subtotal = 0
  let discount = 0
  let tax = 0
  const lines = entered.map((line, index) => {
    const q = quoted.get(line.id)
    if (!q) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `quote lost line ${line.id}` })
    const gstBps = gst.get(line.hsnCode) ?? 0
    // A bargain is a discount from the retailer's point of view, so both land in `discount_paise`.
    const lineDiscount = q.discountPaise + q.bargainPaise
    const taxable = q.lineNetPaise
    const taxPaise = percentOf(paise(taxable), gstBps)
    subtotal += q.grossPaise
    discount += lineDiscount
    tax += taxPaise
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
      freeQtyPcs: q.freeQtyPcs,
      listRatePaise: q.listRatePaise,
      ratePaise: q.ratePaise,
      discountBps: q.grossPaise > 0 ? Math.round((lineDiscount * 10_000) / q.grossPaise) : 0,
      discountPaise: lineDiscount,
      gstBps,
      taxPaise,
      lineTotalPaise: taxable + taxPaise,
      appliedRules: toStoredRules(q.appliedRules),
      // A negotiated or overridden rate must survive re-pricing at delivery (§4.4).
      priceLocked: q.appliedRules.some((r) => r.kind === 'bargain' || r.kind === 'override'),
    } satisfies typeof salesOrderLines.$inferInsert
  })

  // s.170: the bill total is rounded to the rupee and the residue is posted to Round Off.
  const { rounded, roundOff } = roundToRupee(paise(subtotal - discount + tax))
  return {
    lines,
    totals: {
      subtotalPaise: subtotal,
      discountPaise: discount,
      taxPaise: tax,
      roundOffPaise: roundOff,
      totalPaise: rounded,
    },
    quote,
  }
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
  }))
}
