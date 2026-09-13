import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { QuoteInput, QuoteOutput } from '@dos/contracts'
import {
  bargainRequests,
  hsnRates,
  priceListItems,
  priceLists,
  productVariants,
  products,
  retailerLinks,
  retailerPriceOverrides,
  retailers,
  schemes,
  tenantProducts,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import {
  paise,
  percentOf,
  priceOrder,
  PricingError,
  roundToRupee,
  type PriceBargainInput,
  type PriceOverrideInput,
  type SchemeRule,
} from '@dos/domain'
import { currentTenant, DB, requireDb, requireRole, STAFF } from '../../platform/index.js'

type QuoteIn = z.infer<typeof QuoteInput>
type QuoteOut = z.infer<typeof QuoteOutput>

export interface PricedRetailer {
  id: string
  tier: string
  beatId: string | null
}

export interface QuoteVariant {
  variantId: string
  brandId: string | null
  category: string | null
  caseSize: number
  /** Global catalogue HSN; its dated `hsn_rates` row gives the line's GST. */
  hsnCode: string
}

export interface PricingInputs {
  tierPrices: Record<string, number>
  overrides: PriceOverrideInput[]
  schemes: SchemeRule[]
  approvedBargains: PriceBargainInput[]
}

/** Today's date in IST as YYYY-MM-DD (no Intl so the API and the device agree). */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Runs the pure engine (`priceOrder` in @dos/domain) with the tenant's rules, then adds GST per line at the HSN
 * rate dated to the pricing date and rounds the payable to the rupee (DOS-096): the order module writes its
 * lines' tax and its header from exactly this, so what a shop is quoted is what its order carries. The order
 * module and the apps call `quote`; it never writes. Reads of `retailers` / catalog tables are lookups the
 * engine needs and should move behind RetailersService / TenantCatalogService once those expose id-keyed lookups.
 */
@Injectable()
export class QuoteService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async quote(input: QuoteIn): Promise<QuoteOut> {
    requireRole([...STAFF, 'retailer'])
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const retailer = await this.loadRetailer(tx, ctx, input.retailerId)
      const pricingDate = input.pricingDate ?? todayIst()
      const variantIds = [...new Set(input.lines.map((l) => l.variantId))]
      const variants = await this.loadVariants(tx, ctx, variantIds)
      const rules = await this.loadInputs(tx, ctx, retailer, variantIds, {
        pricingDate,
        deliveryDate: input.deliveryDate,
        orderId: input.orderId,
      })
      let result
      try {
        result = priceOrder({
          pricingDate,
          deliveryDate: input.deliveryDate,
          retailer: { id: retailer.id, tier: retailer.tier, beatId: retailer.beatId },
          lines: input.lines.map((l) => {
            const v = variants.get(l.variantId)
            if (!v) throw new PricingError(`Unknown variant ${l.variantId}`)
            return {
              lineId: l.lineId,
              variantId: l.variantId,
              brandId: v.brandId,
              category: v.category,
              qtyPcs: l.qtyPcs,
              caseSize: v.caseSize,
            }
          }),
          ...rules,
        })
      } catch (e) {
        if (e instanceof PricingError) throw new ORPCError('BAD_REQUEST', { message: e.message })
        throw e
      }
      // GST per line at the item's HSN rate dated to the pricing date (DOS-096). After the engine, so an unknown
      // variant still reads as unknown and an unpriced one as unpriced before a missing rate is reported.
      const gst = await loadGstBps(
        tx,
        [...new Set([...variants.values()].map((v) => v.hsnCode))],
        result.pricingDate,
      )
      let taxPaise = 0
      const lines = result.lines.map((l) => {
        const variant = variants.get(l.variantId)
        const gstBps = variant === undefined ? undefined : gst.get(variant.hsnCode)
        if (variant === undefined || gstBps === undefined)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: `quote lost the GST rate for ${l.variantId}`,
          })
        const lineTax = percentOf(paise(l.lineNetPaise), gstBps)
        taxPaise += lineTax
        return {
          lineId: l.lineId,
          variantId: l.variantId,
          qtyPcs: l.qtyPcs,
          caseSize: variant.caseSize,
          listRatePaise: l.listRatePaise,
          ratePaise: l.ratePaise,
          grossPaise: l.grossPaise,
          discountPaise: l.discountPaise,
          bargainPaise: l.bargainPaise,
          freeQtyPcs: l.freeQtyPcs,
          freeItems: l.freeItems,
          appliedRules: l.appliedRules,
          lineNetPaise: l.lineNetPaise,
          gstBps,
          taxPaise: lineTax,
          lineTotalPaise: l.lineNetPaise + lineTax,
        }
      })
      // s.170: one rounding to the rupee, with the same `roundToRupee` billing issues the invoice with.
      const { rounded, roundOff } = roundToRupee(paise(result.totals.netPaise + taxPaise))
      return {
        retailerId: retailer.id,
        pricingDate: result.pricingDate,
        lines,
        orderRules: result.orderRules,
        cashDiscountBps: result.cashDiscountBps,
        cashDiscountPaise: result.cashDiscountPaise,
        totals: { ...result.totals, taxPaise, roundOffPaise: roundOff, totalPaise: rounded },
      }
    })
  }

  /**
   * The retailer to price for. A retailer-role actor may only price for a shop linked to its own login
   * (ADR 0006: retailer_links.user_id); RLS hides the row anyway, this turns it into a clear 403.
   */
  async loadRetailer(tx: Db, ctx: TenantContext, retailerId: string): Promise<PricedRetailer> {
    if (ctx.actorRole === 'retailer') {
      const [link] = await tx
        .select({ id: retailerLinks.id })
        .from(retailerLinks)
        .where(
          and(
            eq(retailerLinks.tenantId, ctx.tenantId),
            eq(retailerLinks.retailerId, retailerId),
            eq(retailerLinks.userId, ctx.actorId),
            eq(retailerLinks.status, 'active'),
          ),
        )
        .limit(1)
      if (!link)
        throw new ORPCError('FORBIDDEN', { message: 'This retailer is not linked to your login' })
    }
    const [row] = await tx
      .select({ id: retailers.id, tier: retailers.tier, beatId: retailers.beatId })
      .from(retailers)
      .where(and(eq(retailers.tenantId, ctx.tenantId), eq(retailers.id, retailerId)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `Retailer ${retailerId} not found` })
    return row
  }

  /** Brand, category and the tenant's case size for each variant (global catalog + tenant overlay). */
  async loadVariants(
    tx: Db,
    ctx: TenantContext,
    variantIds: readonly string[],
  ): Promise<Map<string, QuoteVariant>> {
    if (variantIds.length === 0) return new Map()
    const rows = await tx
      .select({
        variantId: productVariants.id,
        brandId: products.brandId,
        category: products.category,
        caseSize: sql<number>`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
        hsnCode: productVariants.hsnCode,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        tenantProducts,
        and(
          eq(tenantProducts.variantId, productVariants.id),
          eq(tenantProducts.tenantId, ctx.tenantId),
        ),
      )
      .where(inArray(productVariants.id, [...variantIds]))
    const map = new Map(rows.map((r) => [r.variantId, r]))
    const missing = variantIds.filter((id) => !map.has(id))
    if (missing.length > 0)
      throw new ORPCError('BAD_REQUEST', { message: `Unknown variant(s): ${missing.join(', ')}` })
    return map
  }

  /**
   * Everything the engine reads, for one retailer and a set of variants on a date:
   *  - tier prices: the retailer's tier list, falling back per variant to the default list
   *  - overrides valid on the date (latest per variant)
   *  - active schemes whose window can contain the pricing or delivery date (the engine re-checks exactly)
   *  - approved / auto-approved, unexpired bargains for the retailer (any order, or this order)
   */
  async loadInputs(
    tx: Db,
    ctx: TenantContext,
    retailer: PricedRetailer,
    variantIds: readonly string[],
    opts: { pricingDate: string; deliveryDate?: string | undefined; orderId?: string | undefined },
  ): Promise<PricingInputs> {
    const { pricingDate } = opts
    const latest =
      opts.deliveryDate && opts.deliveryDate > pricingDate ? opts.deliveryDate : pricingDate
    const ids = [...variantIds]
    if (ids.length === 0)
      return { tierPrices: {}, overrides: [], schemes: [], approvedBargains: [] }

    const lists = await tx
      .select({ id: priceLists.id, tier: priceLists.tier, isDefault: priceLists.isDefault })
      .from(priceLists)
      .where(
        and(
          eq(priceLists.tenantId, ctx.tenantId),
          eq(priceLists.active, true),
          or(eq(priceLists.isDefault, true), sql`${priceLists.tier} = ${retailer.tier}`),
          or(isNull(priceLists.validFrom), lte(priceLists.validFrom, pricingDate)),
          or(isNull(priceLists.validTo), sql`${priceLists.validTo} >= ${pricingDate}`),
        ),
      )
      .orderBy(sql`${priceLists.validFrom} desc nulls last`, desc(priceLists.id))
    const tierList = lists.find((l) => l.tier === retailer.tier)
    const defaultList = lists.find((l) => l.isDefault)
    const listIds = [...new Set([defaultList?.id, tierList?.id].filter((x): x is string => !!x))]
    const tierPrices: Record<string, number> = {}
    if (listIds.length > 0) {
      const items = await tx
        .select({
          priceListId: priceListItems.priceListId,
          variantId: priceListItems.variantId,
          ratePaise: priceListItems.ratePaise,
        })
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.tenantId, ctx.tenantId),
            inArray(priceListItems.priceListId, listIds),
            inArray(priceListItems.variantId, ids),
          ),
        )
      for (const it of items)
        if (defaultList && it.priceListId === defaultList.id)
          tierPrices[it.variantId] = it.ratePaise
      for (const it of items)
        if (tierList && it.priceListId === tierList.id) tierPrices[it.variantId] = it.ratePaise
    }

    const overrideRows = await tx
      .select()
      .from(retailerPriceOverrides)
      .where(
        and(
          eq(retailerPriceOverrides.tenantId, ctx.tenantId),
          eq(retailerPriceOverrides.retailerId, retailer.id),
          inArray(retailerPriceOverrides.variantId, ids),
          lte(retailerPriceOverrides.validFrom, pricingDate),
          or(
            isNull(retailerPriceOverrides.validTo),
            sql`${retailerPriceOverrides.validTo} >= ${pricingDate}`,
          ),
        ),
      )
      .orderBy(desc(retailerPriceOverrides.id))
    const overrides: PriceOverrideInput[] = []
    for (const o of overrideRows)
      if (!overrides.some((x) => x.variantId === o.variantId))
        overrides.push({ id: o.id, variantId: o.variantId, ratePaise: o.ratePaise, final: o.final })

    const schemeRows = await tx
      .select()
      .from(schemes)
      .where(
        and(
          eq(schemes.tenantId, ctx.tenantId),
          eq(schemes.active, true),
          lte(schemes.validFrom, latest),
          sql`${schemes.validTo} >= ${pricingDate}`,
        ),
      )
      .orderBy(schemes.id)

    const bargainRows = await tx
      .select({
        id: bargainRequests.id,
        variantId: bargainRequests.variantId,
        approvedRatePaise: bargainRequests.approvedRatePaise,
      })
      .from(bargainRequests)
      .where(
        and(
          eq(bargainRequests.tenantId, ctx.tenantId),
          eq(bargainRequests.retailerId, retailer.id),
          inArray(bargainRequests.variantId, ids),
          inArray(bargainRequests.status, ['approved', 'auto_approved']),
          or(isNull(bargainRequests.expiresAt), gt(bargainRequests.expiresAt, new Date())),
          opts.orderId
            ? or(isNull(bargainRequests.orderId), eq(bargainRequests.orderId, opts.orderId))
            : isNull(bargainRequests.orderId),
        ),
      )
      .orderBy(desc(bargainRequests.id))
    const approvedBargains: PriceBargainInput[] = []
    for (const b of bargainRows)
      if (
        b.approvedRatePaise !== null &&
        !approvedBargains.some((x) => x.variantId === b.variantId)
      )
        approvedBargains.push({ id: b.id, variantId: b.variantId, ratePaise: b.approvedRatePaise })

    return { tierPrices, overrides, schemes: schemeRows.map(toSchemeRule), approvedBargains }
  }
}

export function toSchemeRule(row: typeof schemes.$inferSelect): SchemeRule {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    scope: row.scope,
    triggerKind: row.triggerKind,
    triggerMin: row.triggerMin,
    triggerUnit: row.triggerUnit as SchemeRule['triggerUnit'],
    slabs: row.slabs,
    rewardKind: row.rewardKind,
    rewardValue: row.rewardValue,
    freeVariantId: row.freeVariantId,
    applicability: row.applicability,
    validFrom: row.validFrom,
    validTo: row.validTo,
    stackable: row.stackable,
    final: row.final,
    fundingSource: row.fundingSource,
    claimable: row.claimable,
    gstOnFreeGoods: row.gstOnFreeGoods,
    pricingDateMode: row.pricingDateMode,
  }
}

/**
 * Dated GST rate per HSN, so a re-print uses the rate that applied on the order's pricing date.
 *
 * Moved here verbatim from `orders/pricing-lines.ts` (DOS-096): the quote carries GST and the order takes it
 * from the quote, so this is the one lookup both use. `hsn_rates` is global and readable by every role.
 */
async function loadGstBps(
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
