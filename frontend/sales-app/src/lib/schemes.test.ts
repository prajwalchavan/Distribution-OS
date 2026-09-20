/**
 * DOS-088 — the deals a rep opens the door with.
 *
 * The shop card's "Schemes this shop is in" panel ended in a hard `.slice(0, 6)` over rows the
 * device holds in `id ASC` order, so on the pilot's own data six of fourteen live schemes were
 * shown and which six was an accident of insert order: the month's new launches and the order-value
 * offer were among the eight that never appeared. A rep pitching from that panel was pitching last
 * quarter's deals.
 *
 * Schemes carry no "launch" flag, so the nearest true thing is newest first: `valid_from`
 * descending, with the id as the tiebreak so two schemes that opened on the same day keep a stable
 * order. The applicability filter is unchanged — it is the engine's own rule (an empty list means
 * "no restriction", every list that is set must match) and nothing here decides a discount.
 */
import { describe, expect, it } from 'vitest'

import { schemesForShop, type LocalRetailer, type LocalSchemeRow } from './local'

function scheme(id: string, validFrom: string, over: Partial<LocalSchemeRow> = {}): LocalSchemeRow {
  return {
    id,
    name: `Scheme ${id}`,
    brand_id: null,
    scope: null,
    trigger_kind: 'qty',
    trigger_min: 12,
    trigger_unit: 'piece',
    slabs: null,
    reward_kind: 'free_goods',
    reward_value: 1,
    free_variant_id: null,
    applicability: null,
    valid_from: validFrom,
    valid_to: '2026-12-31',
    priority: 10,
    version: 1,
    stackable: true,
    final: false,
    gst_on_free_goods: false,
    pricing_date_mode: 'order',
    active: true,
    ...over,
  }
}

const SHOP = {
  id: 'retailer-jai-kirana',
  tier: 'gold',
  beat_id: 'beat-station-road',
} as unknown as LocalRetailer

/** Fourteen live schemes with no applicability, handed over in `id ASC` as the device holds them. */
const LIVE = [
  scheme('s01', '2026-01-05'),
  scheme('s02', '2026-02-10'),
  scheme('s03', '2026-03-01'),
  scheme('s04', '2026-03-15'),
  scheme('s05', '2026-04-01'),
  scheme('s06', '2026-05-20'),
  scheme('s07', '2026-06-01'),
  scheme('s08', '2026-06-18'),
  scheme('s09', '2026-07-01'),
  scheme('s10', '2026-07-22'),
  scheme('s11', '2026-08-01'),
  scheme('s12', '2026-08-15'),
  scheme('s13', '2026-09-01'),
  scheme('s14', '2026-09-01'),
]

describe('DOS-088 the shop card pitches every live scheme, newest first', () => {
  it('DOS-088 returns all fourteen live schemes with the newest valid_from first, not the first six by id', () => {
    const picked = schemesForShop(LIVE, SHOP, '2026-09-12')

    expect(picked).toHaveLength(14)
    expect(picked.map((row) => row.id)).toEqual([
      's13',
      's14',
      's12',
      's11',
      's10',
      's09',
      's08',
      's07',
      's06',
      's05',
      's04',
      's03',
      's02',
      's01',
    ])
  })

  it('DOS-088 still shows only what is live today and what this shop is inside', () => {
    const rows = [
      scheme('past', '2026-01-01', { valid_to: '2026-08-31' }),
      scheme('future', '2026-10-01'),
      scheme('other-tier', '2026-09-05', { applicability: { tiers: ['silver'] } }),
      scheme('this-tier', '2026-09-06', { applicability: { tiers: ['gold'] } }),
      scheme('other-beat', '2026-09-07', { applicability: { beatIds: ['beat-khadakpada'] } }),
      scheme('this-shop', '2026-09-08', {
        applicability: { retailerIds: ['retailer-jai-kirana'] },
      }),
      scheme('everyone', '2026-09-09', { applicability: {} }),
    ]

    expect(schemesForShop(rows, SHOP, '2026-09-12').map((row) => row.id)).toEqual([
      'everyone',
      'this-shop',
      'this-tier',
    ])
    expect(schemesForShop(rows, null, '2026-09-12')).toEqual([])
  })
})
