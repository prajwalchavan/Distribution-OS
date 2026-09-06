/**
 * The price, computed on the phone — with the SAME engine the server runs.
 *
 * docs/23 §3.1 S3: an order is "priced on the device". That is only safe because `priceOrder()` lives
 * in `@dos/domain`, a dependency-free package both halves import: this file does not re-implement a
 * scheme, a slab or a rounding rule, it FEEDS the engine from the tables `sync.pull` put on the
 * phone. The selection those tables get is a faithful copy of `QuoteService.loadInputs`
 * (`backend/libs/core/src/modules/pricing/quote.service.ts`) — the tier list falling back to the
 * default list per variant, the latest override per variant inside its window, active schemes whose
 * window can contain the order or the delivery date, and unexpired approved bargains for this shop.
 *
 * WHAT IT IS FOR, AND WHAT IT IS NOT. It is the live figure under the rep's thumb while the order is
 * being built, and the figure on the turn-around confirmation screen — instantly, with no signal.
 * It is NOT the order's price: `orders.create` / `orders.setLines` re-price on the server against
 * the same inputs and that answer is what the order carries, what the bill carries and what the shop
 * pays. When the two ever disagree the server wins and the screen shows the order's own lines.
 *
 * Not one figure here is a cost, a landed price or a margin: `tenant_product_costs` is not in this
 * role's manifest, so the phone could not show one if a screen asked (docs/22 §9 rule 1).
 */
import {
  priceOrder,
  type PriceBargainInput,
  type PriceOrderInput,
  type PriceOrderResult,
  type PriceOverrideInput,
  type SchemeRule,
} from '@dos/domain'

import type {
  CatalogItem,
  LocalBargain,
  LocalOverride,
  LocalPriceList,
  LocalPriceListItem,
  LocalRetailer,
  LocalSchemeRow,
} from './local'

/** One line as the order screen holds it while it is being typed. */
export interface DraftLine {
  /** The line's own client-generated UUIDv7 — the id the row will carry when it is uploaded. */
  id: string
  variantId: string
  /** Integer pieces. Cases are a way of typing pieces, never a second unit in state. */
  qtyPcs: number
  /** What the rep actually typed, so the upload can carry it (docs/17 A3). */
  enteredQty: number
  enteredUnit: 'piece' | 'case'
}

export interface DevicePricingSources {
  retailer: LocalRetailer
  catalog: Map<string, CatalogItem>
  priceLists: readonly LocalPriceList[]
  priceListItems: readonly LocalPriceListItem[]
  schemes: readonly LocalSchemeRow[]
  overrides: readonly LocalOverride[]
  bargains: readonly LocalBargain[]
  pricingDate: string
  deliveryDate?: string | undefined
  /** Bargains tied to this order also apply; those tied to no order always do. */
  orderId?: string | undefined
  now?: number
}

/** True while the date sits inside an inclusive `[from, to]` window whose ends may be null. */
function inWindow(from: string | null, to: string | null, on: string): boolean {
  if (from !== null && from > on) return false
  if (to !== null && to < on) return false
  return true
}

/**
 * variantId → the rate this shop's tier pays, per piece, in paise.
 *
 * The default list is laid down first and the tier list writes over it, variant by variant — so a
 * tier list that prices twelve of four hundred items is twelve rates, not a catalog with 388 holes
 * in it. That per-variant fallback is the server's rule, and getting it wrong would show a rep a
 * price no bill will ever carry.
 */
export function tierPricesFor(
  sources: Pick<DevicePricingSources, 'retailer' | 'priceLists' | 'priceListItems' | 'pricingDate'>,
): Record<string, number> {
  const { retailer, priceLists, priceListItems, pricingDate } = sources
  const usable = priceLists
    .filter((list) => list.active && inWindow(list.valid_from, list.valid_to, pricingDate))
    .sort(
      (a, b) => (b.valid_from ?? '').localeCompare(a.valid_from ?? '') || b.id.localeCompare(a.id),
    )
  const defaultList = usable.find((list) => list.is_default)
  const tierList =
    retailer.tier === null ? undefined : usable.find((list) => list.tier === retailer.tier)

  const rates: Record<string, number> = {}
  if (defaultList !== undefined)
    for (const item of priceListItems)
      if (item.price_list_id === defaultList.id) rates[item.variant_id] = item.rate_paise
  if (tierList !== undefined)
    for (const item of priceListItems)
      if (item.price_list_id === tierList.id) rates[item.variant_id] = item.rate_paise
  return rates
}

/**
 * A `schemes` row as the engine's own rule.
 *
 * `funding_source` and `claimable` are NOT on this device: who pays for a scheme is a money fact and
 * the salesperson's manifest does not carry one (docs/22 §9). The engine declares both but neither
 * changes a paisa of the price — they are carried into the claim, which the back office raises — so
 * the device passes the neutral pair and the server's own answer is what the order stores.
 */
export function toSchemeRule(row: LocalSchemeRow): SchemeRule {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    scope: row.scope ?? {},
    triggerKind: row.trigger_kind as SchemeRule['triggerKind'],
    triggerMin: row.trigger_min,
    triggerUnit: row.trigger_unit as SchemeRule['triggerUnit'],
    slabs: row.slabs,
    rewardKind: row.reward_kind as SchemeRule['rewardKind'],
    rewardValue: row.reward_value,
    freeVariantId: row.free_variant_id,
    applicability: row.applicability ?? {},
    validFrom: row.valid_from,
    validTo: row.valid_to,
    stackable: row.stackable,
    priority: row.priority ?? 0,
    final: row.final,
    fundingSource: 'distributor',
    claimable: false,
    gstOnFreeGoods: row.gst_on_free_goods,
    pricingDateMode: row.pricing_date_mode as SchemeRule['pricingDateMode'],
  }
}

/** Everything `priceOrder()` reads, assembled from the device's tables. */
export function priceInputsFor(
  lines: readonly DraftLine[],
  sources: DevicePricingSources,
): PriceOrderInput {
  const { retailer, catalog, pricingDate, deliveryDate, orderId } = sources
  const latest =
    deliveryDate !== undefined && deliveryDate > pricingDate ? deliveryDate : pricingDate
  const wanted = new Set(lines.map((line) => line.variantId))
  const now = sources.now ?? Date.now()

  const overrides: PriceOverrideInput[] = []
  for (const row of [...sources.overrides].sort((a, b) => b.id.localeCompare(a.id))) {
    if (!wanted.has(row.variant_id)) continue
    if (!inWindow(row.valid_from, row.valid_to, pricingDate)) continue
    if (overrides.some((held) => held.variantId === row.variant_id)) continue
    overrides.push({
      id: row.id,
      variantId: row.variant_id,
      ratePaise: row.rate_paise,
      final: row.final,
    })
  }

  const approvedBargains: PriceBargainInput[] = []
  for (const row of [...sources.bargains].sort((a, b) => b.id.localeCompare(a.id))) {
    if (!wanted.has(row.variant_id)) continue
    if (row.status !== 'approved' && row.status !== 'auto_approved') continue
    if (row.approved_rate_paise === null) continue
    if (row.expires_at !== null && Date.parse(row.expires_at) <= now) continue
    // A bargain asked for on another order does not travel to this one; one with no order always does.
    if (row.order_id !== null && row.order_id !== orderId) continue
    if (approvedBargains.some((held) => held.variantId === row.variant_id)) continue
    approvedBargains.push({
      id: row.id,
      variantId: row.variant_id,
      ratePaise: row.approved_rate_paise,
    })
  }

  return {
    pricingDate,
    ...(deliveryDate === undefined ? {} : { deliveryDate }),
    retailer: { id: retailer.id, tier: retailer.tier ?? 'C', beatId: retailer.beat_id },
    lines: lines.map((line) => {
      const item = catalog.get(line.variantId)
      return {
        lineId: line.id,
        variantId: line.variantId,
        brandId: item?.brandId ?? null,
        category: item?.category ?? null,
        qtyPcs: line.qtyPcs,
        caseSize: item?.caseSize ?? 1,
      }
    }),
    tierPrices: tierPricesFor(sources),
    overrides,
    schemes: sources.schemes
      .filter((row) => row.active && row.valid_from <= latest && row.valid_to >= pricingDate)
      .map(toSchemeRule),
    approvedBargains,
  }
}

export interface DeviceQuote {
  result: PriceOrderResult | null
  /** The variants the device holds no rate for — the engine refuses those, so the screen must say so. */
  unpriced: string[]
  error: string | null
}

/**
 * Price the draft, or say why not.
 *
 * `priceOrder()` throws a `PricingError` when a line has no rate — correct for a server, useless for
 * a thumb, so this catches it and hands back the variants it could not price. The screen keeps the
 * rest of the order priced and names the item that cannot be sold at a price nobody has set.
 */
export function quoteOnDevice(
  lines: readonly DraftLine[],
  sources: DevicePricingSources,
): DeviceQuote {
  const priced = lines.filter((line) => line.qtyPcs > 0)
  if (priced.length === 0) return { result: null, unpriced: [], error: null }
  const input = priceInputsFor(priced, sources)
  const unpriced = priced
    .filter((line) => input.tierPrices[line.variantId] === undefined)
    .filter((line) => !input.overrides.some((row) => row.variantId === line.variantId))
    .map((line) => line.variantId)
  const sellable = priced.filter((line) => !unpriced.includes(line.variantId))
  if (sellable.length === 0) return { result: null, unpriced, error: null }
  try {
    return { result: priceOrder(priceInputsFor(sellable, sources)), unpriced, error: null }
  } catch (raw) {
    return { result: null, unpriced, error: raw instanceof Error ? raw.message : String(raw) }
  }
}
