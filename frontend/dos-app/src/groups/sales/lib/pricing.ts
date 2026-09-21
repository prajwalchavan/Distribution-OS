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
  paise,
  priceOrder,
  toRupees,
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

/** A rate the office changed between the device's quote and the server's `orders.create` reply. */
export interface PriceChange {
  variantId: string
  name: string
  fromRatePaise: number
  toRatePaise: number
}

/**
 * DOS-082: the device quotes at one set of rates and `orders.create` re-prices moments later from
 * the same price-list tables — correct, because the office may have edited a price list while the
 * draft sat open, and the server's answer is what the order, the bill and the shop carry (docs/22).
 * But nothing told the rep when the two disagreed: "Neelam Neem Soap 100 g" was quoted at ₹26.08
 * across the counter and the order went through at ₹27.50 with no notice at all (SO-0882).
 *
 * This never re-prices — `priceOrder()` stays the only engine, and the server has already decided —
 * it only NAMES what moved, from the two replies the screen already holds.
 */
export function diffQuoteVsOrder(
  deviceLines: readonly { variantId: string; ratePaise: number }[],
  serverLines: readonly { variantId: string; variantName: string; ratePaise: number }[],
): PriceChange[] {
  const quotedRate = new Map(deviceLines.map((line) => [line.variantId, line.ratePaise]))
  const changes: PriceChange[] = []
  for (const line of serverLines) {
    const before = quotedRate.get(line.variantId)
    if (before === undefined || before === line.ratePaise) continue
    changes.push({
      variantId: line.variantId,
      name: line.variantName,
      fromRatePaise: before,
      toRatePaise: line.ratePaise,
    })
  }
  return changes
}

/** "Neelam Neem Soap 100 g 26.08 → 27.50" — the sentence a rep reads before the order goes further. */
export function describePriceChange(change: PriceChange): string {
  return `${change.name} ${toRupees(paise(change.fromRatePaise))} → ${toRupees(paise(change.toRatePaise))}`
}

export interface CaseSummary {
  cases: number
  pieces: number
}

/**
 * Sum whole cases and loose pieces across the order's lines, each in ITS OWN case size (DOS-129).
 * `new.tsx:266` used to format the footer's total pieces against `caseSizeOf()` — the FIRST line's
 * case size — so 2 cs of a 24-pc case plus 1 cs of a 48-pc case (96 pc total) read "4 cs" (96 / 24)
 * instead of "3 cs", and a 21-line order of mixed case sizes read "45 cs + 3 pcs" for what was really
 * 21 single cases. Moved out of `app/` because sales vitest runs `--dir src`.
 */
export function summarizeCases(
  lines: readonly { qtyPcs: number; caseSize: number }[],
): CaseSummary {
  let cases = 0
  let loosePieces = 0
  for (const line of lines) {
    const qty = Math.max(0, Math.trunc(line.qtyPcs))
    if (!Number.isSafeInteger(line.caseSize) || line.caseSize <= 0) {
      loosePieces += qty
      continue
    }
    cases += Math.floor(qty / line.caseSize)
    loosePieces += qty % line.caseSize
  }
  return { cases, pieces: loosePieces }
}

/** "3 cs", "3 cs + 31 pcs", or "5 pcs" with no whole case anywhere — mirrors `formatQty`'s own shape. */
export function formatCaseSummary(summary: CaseSummary): string {
  const parts: string[] = []
  if (summary.cases > 0) parts.push(`${String(summary.cases)} cs`)
  if (summary.pieces > 0 || summary.cases === 0) parts.push(`${String(summary.pieces)} pcs`)
  return parts.join(' + ')
}

/** What the shop will owe, as S3's turn-around summary reads it out (DOS-083). */
export interface PayableSummary {
  /** Before GST, from the device engine — always known, with or without a signal. */
  netPaise: number
  discountPaise: number
  /** GST plus compensation cess, or null when only the before-GST net is known. */
  taxPaise: number | null
  /** The cess share of `taxPaise` (DOS-079), null when there is no server quote. */
  cessPaise: number | null
  roundOffPaise: number | null
  /** What the shop pays, GST and cess in: the figure the placed order and the bill carry. */
  payablePaise: number | null
  /** True only when `payablePaise` came from the server's own quote. */
  withGst: boolean
}

/** The device half of the summary: the totals `quoteOnDevice` answers with. */
export interface DeviceTotals {
  netPaise: number
  discountPaise: number
}

/** The server half: `pricing.quote`'s totals, the same arithmetic the order will store. */
export interface ServerTotals extends DeviceTotals {
  taxPaise: number
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
}

/**
 * DOS-083: the amount the shop will owe, BEFORE the rep commits.
 *
 * The order screen used to print the device engine's net ("₹28,739.70 before GST") and the order,
 * one tap later, printed ₹32,030.00 — the same goods, two figures, and the rep had already read the
 * first one out. The phone cannot fix that alone: `hsn_rates` is not in a salesperson's device
 * manifest (docs/22 §9), so GST and cess genuinely cannot be computed here. `pricing.quote` can, and
 * since DOS-079 its tax carries compensation cess too, so the quote's `totalPaise` is exactly what
 * the placed order and the bill will say.
 *
 * With no signal — or before the quote comes back — the summary stays what it honestly is: the net,
 * marked "before GST". It NEVER invents a rate, and it refuses a quote whose net does not match the
 * basket on screen: a stale payable read across the counter is worse than an honest "before GST".
 */
export function payableSummary(
  device: DeviceTotals,
  server: ServerTotals | null | undefined,
): PayableSummary {
  const fits = server != null && server.netPaise === device.netPaise
  if (!fits)
    return {
      netPaise: device.netPaise,
      discountPaise: device.discountPaise,
      taxPaise: null,
      cessPaise: null,
      roundOffPaise: null,
      payablePaise: null,
      withGst: false,
    }
  return {
    netPaise: server.netPaise,
    discountPaise: server.discountPaise,
    taxPaise: server.taxPaise,
    cessPaise: server.cessPaise,
    roundOffPaise: server.roundOffPaise,
    payablePaise: server.totalPaise,
    withGst: true,
  }
}
