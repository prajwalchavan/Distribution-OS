/** Price lists, retailer overrides, schemes and bargains — ADR 0008. */
import { insertMany } from './db-helpers.js'
import {
  bargainRequests,
  priceListItems,
  priceLists,
  retailerPriceOverrides,
  schemes,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { brandId, type VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailerRow } from './retailers.js'
import { atIstTime, daysAgo, daysAhead, isoDate, nth } from './util.js'

export interface VariantRates {
  defaultPaise: number
  aPaise: number
  bPaise: number
}

export interface PricingResult {
  ratesByVariantId: Map<string, VariantRates>
  priceListIds: { default: string; A: string; B: string }
}

/** Distributor sell rate (ex-tax) as ~86% of the ex-tax MRP; tiers shave a little more off. */
function baseRate(mrpPaise: number, gstBps: number, cessBps: number): number {
  const exTaxMrp = mrpPaise / (1 + (gstBps + cessBps) / 10_000)
  return Math.round(exTaxMrp * 0.86)
}

export async function seedPricing(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: { retailers: RetailerRow[] },
  people: PeopleResult,
): Promise<PricingResult> {
  const priceListIds = {
    default: demoId('price-list', 'default'),
    A: demoId('price-list', 'tier-a'),
    B: demoId('price-list', 'tier-b'),
  }

  await insertMany(db, priceLists, [
    {
      id: priceListIds.default,
      tenantId,
      name: 'Default Price List',
      isDefault: true,
      active: true,
    },
    { id: priceListIds.A, tenantId, name: 'Tier A Price List', tier: 'A' as const, active: true },
    { id: priceListIds.B, tenantId, name: 'Tier B Price List', tier: 'B' as const, active: true },
  ])

  const ratesByVariantId = new Map<string, VariantRates>()
  const items: {
    id: string
    tenantId: string
    priceListId: string
    variantId: string
    ratePaise: number
    inclusiveOfGst: boolean
  }[] = []

  for (const v of variants) {
    const base = baseRate(v.mrpPaise, v.gstBps, v.cessBps)
    const rates: VariantRates = {
      defaultPaise: base,
      aPaise: Math.round(base * 0.98),
      bPaise: Math.round(base * 0.99),
    }
    ratesByVariantId.set(v.id, rates)
    items.push(
      {
        id: demoId('price-item', `default:${v.key}`),
        tenantId,
        priceListId: priceListIds.default,
        variantId: v.id,
        ratePaise: rates.defaultPaise,
        inclusiveOfGst: false,
      },
      {
        id: demoId('price-item', `a:${v.key}`),
        tenantId,
        priceListId: priceListIds.A,
        variantId: v.id,
        ratePaise: rates.aPaise,
        inclusiveOfGst: false,
      },
      {
        id: demoId('price-item', `b:${v.key}`),
        tenantId,
        priceListId: priceListIds.B,
        variantId: v.id,
        ratePaise: rates.bPaise,
        inclusiveOfGst: false,
      },
    )
  }
  await insertMany(db, priceListItems, items)

  const campaCola750 = variants.find((v) => v.key === 'campa-cola-750ml')
  const campaOrange750 = variants.find((v) => v.key === 'campa-orange-750ml')
  const balajiRatlamiSev = variants.find((v) => v.key === 'balaji-ratlami-sev-200g')
  if (!campaCola750 || !campaOrange750 || !balajiRatlamiSev)
    throw new Error('expected catalog variants missing for pricing seed')

  // Three retailers get a negotiated override; the third is `final` so no scheme stacks on top.
  const overrideRetailer0 = nth(retailersRes.retailers, 0)
  const overrideRetailer1 = nth(retailersRes.retailers, 4)
  const overrideRetailer2 = nth(retailersRes.retailers, 9)
  await insertMany(db, retailerPriceOverrides, [
    {
      id: demoId('override', `${overrideRetailer0.code}:${campaCola750.key}`),
      tenantId,
      retailerId: overrideRetailer0.id,
      variantId: campaCola750.id,
      ratePaise: Math.round((ratesByVariantId.get(campaCola750.id)?.defaultPaise ?? 0) * 0.96),
      final: false,
      validFrom: isoDate(daysAgo(60)),
      approvedBy: people.owner.id,
      note: 'Long-standing account, negotiated in person.',
    },
    {
      id: demoId('override', `${overrideRetailer1.code}:${campaOrange750.key}`),
      tenantId,
      retailerId: overrideRetailer1.id,
      variantId: campaOrange750.id,
      ratePaise: Math.round((ratesByVariantId.get(campaOrange750.id)?.defaultPaise ?? 0) * 0.97),
      final: false,
      validFrom: isoDate(daysAgo(45)),
      approvedBy: people.owner.id,
    },
    {
      id: demoId('override', `${overrideRetailer2.code}:${balajiRatlamiSev.key}`),
      tenantId,
      retailerId: overrideRetailer2.id,
      variantId: balajiRatlamiSev.id,
      ratePaise: Math.round((ratesByVariantId.get(balajiRatlamiSev.id)?.defaultPaise ?? 0) * 0.94),
      final: true,
      validFrom: isoDate(daysAgo(30)),
      approvedBy: people.owner.id,
      note: 'Final rate; schemes do not stack.',
    },
  ])

  const momMakhanaSalt = variants.find((v) => v.key === 'mom-makhana-himalayan-salt-12g')
  if (!momMakhanaSalt) throw new Error('MOM makhana variant missing')

  await insertMany(db, schemes, [
    {
      id: demoId('scheme', 'campa-750-12-plus-1'),
      tenantId,
      name: 'Campa 750 ml — 12+1 free',
      brandId: brandId('campa'),
      scope: { variantIds: [campaCola750.id, campaOrange750.id] },
      triggerKind: 'qty' as const,
      triggerMin: 12,
      triggerUnit: 'case',
      rewardKind: 'free_qty' as const,
      rewardValue: 1,
      rewardUnit: 'case' as const,
      freeVariantId: campaCola750.id,
      applicability: {},
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(9)),
      priority: 10,
      claimChannel: 'dos' as const,
      stackable: true,
      fundingSource: 'company' as const,
      claimable: true,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      sourceRef: 'Reliance circular RCP/2026/08/CAMPA-MON',
      active: true,
    },
    {
      id: demoId('scheme', 'balaji-5pct-5-cases'),
      tenantId,
      name: 'Balaji — 5% off on 5+ cases',
      brandId: brandId('balaji'),
      scope: { brandIds: [brandId('balaji')] },
      triggerKind: 'qty' as const,
      triggerMin: 5,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 500,
      applicability: {},
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(9)),
      priority: 20,
      claimChannel: 'dos' as const,
      stackable: true,
      fundingSource: 'company' as const,
      claimable: true,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      sourceRef: 'Balaji secondary scheme letter Aug-2026',
      active: true,
    },
    {
      id: demoId('scheme', 'order-2pct-5000'),
      tenantId,
      name: 'Order value — 2% off on bills over ₹5,000',
      scope: { all: true },
      triggerKind: 'value' as const,
      triggerMin: 500_000,
      triggerUnit: 'inr',
      rewardKind: 'order_pct' as const,
      rewardValue: 200,
      applicability: {},
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(9)),
      priority: 30,
      claimChannel: 'dos' as const,
      stackable: true,
      fundingSource: 'distributor' as const,
      claimable: false,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      active: true,
    },
    {
      id: demoId('scheme', 'too-yumm-cash-discount'),
      tenantId,
      name: 'Too Yumm — 2% cash discount',
      brandId: brandId('tooyumm'),
      scope: { brandIds: [brandId('tooyumm')] },
      triggerKind: 'value' as const,
      triggerMin: 0,
      triggerUnit: 'inr',
      rewardKind: 'cash_discount_pct' as const,
      rewardValue: 200,
      applicability: {},
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(60)),
      priority: 5,
      claimChannel: 'brand_dms' as const,
      stackable: true,
      fundingSource: 'company' as const,
      claimable: false,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      sourceRef: 'FieldAssist Too Yumm CD policy',
      active: true,
    },
    {
      id: demoId('scheme', 'mom-makhana-slab'),
      tenantId,
      name: 'MOM Makhana — slab scheme',
      brandId: brandId('mommakhana'),
      scope: { brandIds: [brandId('mommakhana')] },
      triggerKind: 'qty' as const,
      triggerMin: 5,
      triggerUnit: 'case',
      slabs: [
        { min: 5, value: 200 },
        { min: 10, value: 400 },
      ],
      rewardKind: 'line_pct' as const,
      rewardValue: 200,
      applicability: {},
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(9)),
      priority: 20,
      claimChannel: 'dos' as const,
      stackable: true,
      fundingSource: 'company' as const,
      claimable: true,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      sourceRef: 'MOM Foods slab scheme Jul-2026',
      active: true,
    },
    {
      id: demoId('scheme', 'balaji-monsoon-bonanza-expired'),
      tenantId,
      name: 'Balaji Monsoon Bonanza (expired)',
      brandId: brandId('balaji'),
      scope: { variantIds: [balajiRatlamiSev.id] },
      triggerKind: 'qty' as const,
      triggerMin: 10,
      triggerUnit: 'case',
      rewardKind: 'free_qty' as const,
      rewardValue: 1,
      rewardUnit: 'case' as const,
      freeVariantId: balajiRatlamiSev.id,
      applicability: {},
      validFrom: isoDate(daysAgo(95)),
      validTo: isoDate(daysAgo(35)),
      priority: 10,
      claimChannel: 'dos' as const,
      stackable: true,
      fundingSource: 'company' as const,
      claimable: true,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
      sourceRef: 'Balaji monsoon circular Jun-2026',
      active: true,
    },
  ])

  const bargainRetailers = [
    nth(retailersRes.retailers, 1),
    nth(retailersRes.retailers, 6),
    nth(retailersRes.retailers, 11),
    nth(retailersRes.retailers, 20),
    nth(retailersRes.retailers, 29),
  ]
  const bargainStatuses = ['requested', 'auto_approved', 'approved', 'rejected', 'expired'] as const
  const bargainVariant = campaCola750

  await insertMany(
    db,
    bargainRequests,
    bargainRetailers.map((r, i) => {
      const status = nth(bargainStatuses, i)
      const listRate = ratesByVariantId.get(bargainVariant.id)?.defaultPaise ?? 0
      const askedRate = Math.round(listRate * 0.92)
      const decided = status === 'approved' || status === 'rejected'
      return {
        id: demoId('bargain', `${r.code}:${i}`),
        tenantId,
        retailerId: r.id,
        variantId: bargainVariant.id,
        requestedBy: people.salespeople.rahul.id,
        listRatePaise: listRate,
        askedRatePaise: askedRate,
        approvedRatePaise: status === 'auto_approved' || status === 'approved' ? askedRate : null,
        status,
        evaluatedBasis: 'tier_price',
        decidedBy: decided ? people.owner.id : null,
        decidedAt: decided ? atIstTime(daysAgo(2), 12) : null,
        expiresAt: status === 'expired' ? atIstTime(daysAgo(1), 18) : atIstTime(daysAhead(3), 18),
        note: status === 'rejected' ? 'Below floor for this retailer tier.' : null,
      }
    }),
  )

  return { ratesByVariantId, priceListIds }
}
