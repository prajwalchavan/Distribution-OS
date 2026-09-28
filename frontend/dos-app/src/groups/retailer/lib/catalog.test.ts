/**
 * The shop front's reading of the price list (founder, 2026-09-28: "a shopping app feel"): search,
 * "Shop by brand", "Your items" and the few words of an offer a tile has room for.
 */
import type { SchemeView, TenantProduct } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import {
  NO_BRAND,
  brandsOf,
  isSearching,
  itemsOfBrand,
  matchItems,
  offersForItem,
  rankUsualItems,
} from './catalog'
import { tileOffer } from './offer'

function item(over: Partial<TenantProduct> & { variantId: string; name: string }): TenantProduct {
  return {
    productId: `p-${over.variantId}`,
    manufacturerId: 'm1',
    brandId: 'b-campa',
    productName: over.name,
    productNameHi: null,
    brandName: 'Campa',
    manufacturerName: 'Reliance Consumer',
    netQty: 250,
    netUnit: 'ml',
    promoExtra: null,
    defaultCaseSize: 24,
    hsnCode: '22021010',
    ean: null,
    mrpPaise: 2000,
    status: 'active',
    tenantProductId: null,
    listed: true,
    localAlias: null,
    caseSize: 24,
    minOrderQty: 1,
    orderIncrement: 1,
    maxPerOrder: null,
    sortOrder: 0,
    ...over,
  }
}

const COLA = item({ variantId: 'v-cola', name: 'Campa Cola 250 ml' })
const LEMON = item({ variantId: 'v-lemon', name: 'Campa Lemon 250 ml', sortOrder: 2 })
const SOAP = item({
  variantId: 'v-soap',
  name: 'Neem Soap 75 g',
  brandId: 'b-chamak',
  brandName: 'Chamak',
  manufacturerName: 'Chamak Industries',
  localAlias: 'Chamak neem',
  ean: '8901234567890',
})
const LOOSE = item({ variantId: 'v-loose', name: 'Loose Supari', brandId: null, brandName: null })
const LIST = [COLA, LEMON, SOAP, LOOSE]

describe('search', () => {
  it('finds an item by any word of its name, its local name, its brand or its barcode', () => {
    expect(matchItems(LIST, 'cola').map((one) => one.variantId)).toEqual(['v-cola'])
    expect(matchItems(LIST, 'CAMPA').map((one) => one.variantId)).toEqual(['v-cola', 'v-lemon'])
    expect(matchItems(LIST, 'chamak neem').map((one) => one.variantId)).toEqual(['v-soap'])
    expect(matchItems(LIST, '8901234567890').map((one) => one.variantId)).toEqual(['v-soap'])
    // Every word must match, in any order.
    expect(matchItems(LIST, 'lemon campa').map((one) => one.variantId)).toEqual(['v-lemon'])
    expect(matchItems(LIST, 'campa soap')).toEqual([])
  })

  it('starts at two letters: one letter matches half the list and helps nobody', () => {
    expect(isSearching('c')).toBe(false)
    expect(isSearching(' c ')).toBe(false)
    expect(isSearching('co')).toBe(true)
    expect(matchItems(LIST, 'c')).toEqual([])
  })
})

describe('Shop by brand', () => {
  it('lists the brands this distributor sells, biggest range first, the unbranded last', () => {
    expect(brandsOf(LIST)).toEqual([
      { id: 'b-campa', name: 'Campa', count: 2 },
      { id: 'b-chamak', name: 'Chamak', count: 1 },
      { id: NO_BRAND, name: null, count: 1 },
    ])
  })

  it('opens one brand s items in the distributor s own order', () => {
    expect(itemsOfBrand(LIST, 'b-campa').map((one) => one.variantId)).toEqual(['v-cola', 'v-lemon'])
    expect(itemsOfBrand(LIST, NO_BRAND).map((one) => one.variantId)).toEqual(['v-loose'])
    expect(itemsOfBrand(LIST, 'b-nobody')).toEqual([])
  })
})

describe('Your items: what this shop buys most often, from its own orders', () => {
  it('ranks by how many orders an item was in, then by pieces, then by how recently', () => {
    const ranked = rankUsualItems([
      {
        placedAt: '2026-09-20T10:00:00Z',
        lines: [
          { variantId: 'v-cola', qtyPcs: 24 },
          { variantId: 'v-soap', qtyPcs: 12 },
        ],
      },
      {
        placedAt: '2026-09-25T10:00:00Z',
        lines: [
          { variantId: 'v-soap', qtyPcs: 12 },
          { variantId: 'v-lemon', qtyPcs: 48 },
          // Two lines of one item in one order count as one order.
          { variantId: 'v-soap', qtyPcs: 12 },
        ],
      },
      { placedAt: '2026-09-27T10:00:00Z', lines: [{ variantId: 'v-cola', qtyPcs: 24 }] },
    ])
    expect(ranked).toEqual(['v-cola', 'v-soap', 'v-lemon'])
  })

  it('ignores a line with no pieces, and an empty history is an empty shelf', () => {
    expect(
      rankUsualItems([{ placedAt: '2026-09-27', lines: [{ variantId: 'v-cola', qtyPcs: 0 }] }]),
    ).toEqual([])
    expect(rankUsualItems([])).toEqual([])
  })
})

function scheme(over: Partial<SchemeView>): SchemeView {
  return {
    id: 's1',
    name: 'Campa festive',
    brandId: 'b-campa',
    scope: { brandIds: ['b-campa'] },
    triggerKind: 'qty',
    triggerMin: 2,
    triggerUnit: 'case',
    slabs: null,
    rewardKind: 'free_qty',
    rewardValue: 2,
    freeVariantId: null,
    applicability: {},
    validFrom: '2026-09-01',
    validTo: '2026-09-30',
    stackable: true,
    final: false,
    gstOnFreeGoods: false,
    pricingDateMode: 'order',
    active: true,
    ...over,
  } as SchemeView
}

/** The strings the tile sentences use, as `strings.ts` has them. */
const WORDS: Record<string, string> = {
  'r2.offerFree': '{reward} free',
  'r2.offerFreeOn': '{reward} free on {min} {unit}',
  'r2.offerPct': '{pct} off',
  'r2.offerPctOn': '{pct} off on {min} {unit}',
  'r2.offerAmountOn': '{amount} off on {min} {unit}',
  'r2.offerPerUnit': '{amount} off a {unit}',
  'r2.unitCaseOne': 'case',
  'r2.unitPc': 'pc',
  'r2.unitPcOne': 'piece',
  'r9.unitCase': 'cases',
}
const t = (key: string, vars: Record<string, string | number> = {}): string =>
  (WORDS[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))

describe('an offer on a tile', () => {
  it('names only the offers about THIS item — by the item or its brand, never a whole-order one', () => {
    const byBrand = scheme({ id: 'brand' })
    const byItem = scheme({ id: 'item', brandId: null, scope: { variantIds: ['v-soap'] } })
    const everything = scheme({ id: 'all', scope: { all: true } })
    const order = scheme({ id: 'order', rewardKind: 'order_pct', scope: { brandIds: ['b-campa'] } })
    const cash = scheme({ id: 'cash', rewardKind: 'cash_discount_pct' })
    const all = [byBrand, byItem, everything, order, cash]
    expect(offersForItem(all, COLA).map((one) => one.id)).toEqual(['brand'])
    expect(offersForItem(all, SOAP).map((one) => one.id)).toEqual(['item'])
    expect(offersForItem(all, LOOSE)).toEqual([])
  })

  it('says it in the few words a tile has room for (<= 20 characters on the pilot s schemes)', () => {
    const phrases = [
      tileOffer(t, scheme({})),
      tileOffer(t, scheme({ rewardKind: 'line_pct', rewardValue: 500, triggerMin: 3 })),
      tileOffer(t, scheme({ rewardKind: 'line_pct', rewardValue: 250, triggerMin: 0 })),
      tileOffer(
        t,
        scheme({ rewardKind: 'free_qty', triggerUnit: 'pcs', triggerMin: 10, rewardValue: 1 }),
      ),
    ]
    expect(phrases).toEqual([
      '2 free on 2 cases',
      '5% off on 3 cases',
      '2.5% off',
      '1 free on 10 pc',
    ])
    for (const phrase of phrases) expect((phrase ?? '').length).toBeLessThanOrEqual(20)
    expect(tileOffer(t, scheme({ triggerMin: 1 }))).toBe('2 free on 1 case')
    expect(tileOffer(t, scheme({ rewardKind: 'order_pct' }))).toBeNull()
    expect(tileOffer(t, scheme({ rewardKind: 'per_unit_amount', rewardValue: 1500 }))).toMatch(
      /^₹15(\.00)? off a case$/,
    )
  })
})
