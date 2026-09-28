/**
 * The shop front's reading of the price list (founder, 2026-09-28: "a shopping app feel").
 *
 * Everything here is a pure function over what the services already answered — the distributor's
 * listed items (`tenantCatalog.list`), the shop's own past orders (`orders.get`) and the offers that
 * apply to it (`pricing.schemes.list`). No price is worked out here: a rate comes from
 * `pricing.rates` and a basket from `pricing.quote`, the one engine the bill uses (UX-01 R5).
 */
import type { SchemeView, TenantProduct } from '@dos/contracts'

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower case, one space, no accents a phone keyboard might add. */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * The items a search matches: every word typed must appear in the item's name, its local name, its
 * product, its brand or its maker (or be its barcode). Two letters is the least that searches — one
 * letter matches half the list and helps nobody.
 */
export function matchItems(items: readonly TenantProduct[], query: string): TenantProduct[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word !== '')
  if (words.join('').length < 2) return []
  return items.filter((item) => {
    const hay = fold(
      [
        item.localAlias ?? '',
        item.name,
        item.productName,
        item.productNameHi ?? '',
        item.brandName ?? '',
        item.manufacturerName,
        item.ean ?? '',
      ].join(' '),
    )
    return words.every((word) => hay.includes(word))
  })
}

/** Is a search long enough to search? The same two-letter rule `matchItems` applies. */
export function isSearching(query: string): boolean {
  return fold(query).replace(/\s+/g, '').length >= 2
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

/** The key of the items that carry no brand: they still get a tile of their own. */
export const NO_BRAND = 'none'

export interface BrandGroup {
  /** `brandId`, or `NO_BRAND`. */
  id: string
  /** The brand's name; `null` for the items with none (the screen names that group). */
  name: string | null
  count: number
}

/**
 * The brands this distributor actually sells, from its own listed items — never the global
 * manufacturer list, which would offer brands with nothing behind them. Biggest range first, then by
 * name, so the tiles do not reshuffle between visits.
 */
export function brandsOf(items: readonly TenantProduct[]): BrandGroup[] {
  const groups = new Map<string, BrandGroup>()
  for (const item of items) {
    const id = item.brandId ?? NO_BRAND
    const held = groups.get(id)
    if (held === undefined) groups.set(id, { id, name: item.brandName, count: 1 })
    else held.count += 1
  }
  return [...groups.values()].sort(
    (a, b) =>
      (a.id === NO_BRAND ? 1 : 0) - (b.id === NO_BRAND ? 1 : 0) ||
      b.count - a.count ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  )
}

/** The items of one brand, in the distributor's own order, then by name. */
export function itemsOfBrand(items: readonly TenantProduct[], brandId: string): TenantProduct[] {
  return items
    .filter((item) => (item.brandId ?? NO_BRAND) === brandId)
    .sort((a, b) => a.sortOrder - b.sortOrder || displayName(a).localeCompare(displayName(b)))
}

/** What the shop calls the item: this distributor's local name, else the catalogue's. */
export function displayName(item: TenantProduct): string {
  return item.localAlias ?? item.name
}

/** The brand the tile's picture is drawn from: its brand, else its maker. */
export function brandOf(item: TenantProduct): string {
  return item.brandName ?? item.manufacturerName
}

// ---------------------------------------------------------------------------
// "Your items"
// ---------------------------------------------------------------------------

export interface PastOrder {
  /** When it was placed; the newest breaks a tie. */
  placedAt: string
  lines: readonly { variantId: string; qtyPcs: number }[]
}

/**
 * The items of the shop's own recent orders, most often bought first: the number of orders an item
 * was in, then how many pieces in all, then how recently. Only the shop's own orders — the "usual
 * basket" report is deliberately not served to this role (docs/23 §6.1 R7).
 */
export function rankUsualItems(orders: readonly PastOrder[]): string[] {
  const seen = new Map<string, { orders: number; pieces: number; last: string }>()
  for (const order of orders) {
    const inThis = new Set<string>()
    for (const line of order.lines) {
      if (line.qtyPcs <= 0) continue
      const held = seen.get(line.variantId) ?? { orders: 0, pieces: 0, last: '' }
      if (!inThis.has(line.variantId)) held.orders += 1
      inThis.add(line.variantId)
      held.pieces += line.qtyPcs
      if (order.placedAt > held.last) held.last = order.placedAt
      seen.set(line.variantId, held)
    }
  }
  return [...seen.entries()]
    .sort(
      ([, a], [, b]) => b.orders - a.orders || b.pieces - a.pieces || b.last.localeCompare(a.last),
    )
    .map(([variantId]) => variantId)
}

// ---------------------------------------------------------------------------
// Offers on a tile
// ---------------------------------------------------------------------------

/**
 * The offers that name this item — by the item itself or by its brand. An offer on EVERYTHING, or on
 * a whole order, is not an item's offer: printing it on every tile says nothing, so it is left to the
 * Offers row.
 */
export function offersForItem(
  schemes: readonly SchemeView[],
  item: Pick<TenantProduct, 'variantId' | 'brandId'>,
): SchemeView[] {
  return schemes.filter((scheme) => {
    if (
      scheme.rewardKind === 'order_pct' ||
      scheme.rewardKind === 'cash_discount_pct' ||
      (scheme.rewardKind === 'net_scheme_amount' && scheme.triggerUnit === 'inr')
    )
      return false
    const scope = scheme.scope
    if (scope.variantIds?.includes(item.variantId) === true) return true
    return item.brandId !== null && scope.brandIds?.includes(item.brandId) === true
  })
}
