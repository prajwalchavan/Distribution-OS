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
import { sellRatePaise } from './rates.js'
import { byArchetype, type ArchetypeKey, type RetailerRow } from './retailers.js'
import { atIstTime, daysAgo, daysAhead, isoDate, occurred } from './util.js'

export interface VariantRates {
  defaultPaise: number
  aPaise: number
  bPaise: number
  cPaise: number
}

export type SchemeRow = typeof schemes.$inferInsert

export interface BargainRecord {
  id: string
  key: string
  status: 'requested' | 'auto_approved' | 'approved' | 'rejected' | 'expired'
  retailerId: string
  retailerCode: string
  variantId: string
  /** Days before TODAY the request was raised. */
  ageDays: number
  askedRatePaise: number
  listRatePaise: number
}

export interface OverrideRecord {
  id: string
  retailerId: string
  variantId: string
  ratePaise: number
  final: boolean
  validFrom: string
  validTo: string | null
}

export interface PricingResult {
  ratesByVariantId: Map<string, VariantRates>
  priceListIds: { default: string; A: string; B: string; C: string }
  /** The schemes written for this distributor (its listed brands only), as inserted. */
  schemes: SchemeRow[]
  overrides: OverrideRecord[]
  bargains: BargainRecord[]
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
    C: demoId('price-list', 'tier-c'),
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
    { id: priceListIds.C, tenantId, name: 'Tier C Price List', tier: 'C' as const, active: true },
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
    // the category's share of the ex-tax MRP (rates.ts); the tiers shave a little more off
    const base = sellRatePaise(v)
    const rates: VariantRates = {
      defaultPaise: base,
      aPaise: Math.round(base * 0.98),
      bPaise: Math.round(base * 0.99),
      cPaise: Math.round(base * 0.995),
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
      {
        id: demoId('price-item', `c:${v.key}`),
        tenantId,
        priceListId: priceListIds.C,
        variantId: v.id,
        ratePaise: rates.cPaise,
        inclusiveOfGst: false,
      },
    )
  }
  await insertMany(db, priceListItems, items)

  const byKey = new Map(variants.map((v) => [v.key, v]))
  const variant = (key: string): VariantRow | undefined => byKey.get(key)
  const need = (key: string): VariantRow => {
    const v = byKey.get(key)
    if (!v) throw new Error(`expected catalog variant ${key} missing for pricing seed`)
    return v
  }
  const campaCola750 = need('campa-cola-750ml')
  const campaOrange750 = need('campa-orange-750ml')
  const balajiRatlamiSev = need('balaji-ratlami-sev-200g')
  const defaultRate = (v: VariantRow): number => ratesByVariantId.get(v.id)?.defaultPaise ?? 0

  /** A shop of the archetype, or nothing when this network has none — the row is then not written. */
  const shopOf = (key: ArchetypeKey, n = 0): RetailerRow | undefined => {
    try {
      return byArchetype(retailersRes.retailers, key, n)
    } catch {
      return undefined
    }
  }

  // --- Negotiated overrides, selected BY ARCHETYPE (spec §2.5): two of them are `final`, so no scheme
  //     stacks on top; one has already lapsed. -----------------------------------------------------
  const overrideSpecs: {
    shop: RetailerRow | undefined
    variant: VariantRow | undefined
    pct: number
    final: boolean
    validFromDaysAgo: number
    validToDaysAgo?: number
    note?: string
  }[] = [
    {
      shop: shopOf('high_volume'),
      variant: campaCola750,
      pct: 0.975,
      final: false,
      validFromDaysAgo: 60,
      note: 'Long-standing account, negotiated in person.',
    },
    {
      shop: shopOf('supermarket'),
      variant: campaOrange750,
      pct: 0.98,
      final: false,
      validFromDaysAgo: 45,
    },
    {
      shop: shopOf('high_volume'),
      variant: balajiRatlamiSev,
      pct: 0.965,
      final: true,
      validFromDaysAgo: 30,
      note: 'Final rate; schemes do not stack.',
    },
    {
      shop: shopOf('supermarket'),
      variant: variant('annapurna-chakki-fresh-atta-10kg'),
      pct: 0.975,
      final: true,
      validFromDaysAgo: 40,
      note: 'Staple loss-leader for the supermarket; final.',
    },
    {
      shop: shopOf('grocery_medium', 0),
      variant: variant('sunbake-glucose-250g'),
      pct: 0.975,
      final: false,
      validFromDaysAgo: 35,
    },
    {
      shop: shopOf('grocery_medium', 1),
      variant: variant('godavari-cow-ghee-1l'),
      pct: 0.98,
      final: false,
      validFromDaysAgo: 25,
    },
    {
      shop: shopOf('credit_near_limit'),
      variant: variant('chamak-detergent-powder-1kg'),
      pct: 0.97,
      final: false,
      validFromDaysAgo: 50,
    },
    {
      shop: shopOf('cash_only'),
      variant: variant('neelam-sandal-soap-100g'),
      pct: 0.965,
      final: false,
      validFromDaysAgo: 20,
      note: 'Cash-and-carry rate.',
    },
    {
      shop: shopOf('kirana_small', 3),
      variant: variant('konkan-aloo-bhujia-200g'),
      pct: 0.98,
      final: false,
      validFromDaysAgo: 90,
      validToDaysAgo: 30,
      note: 'Launch-month rate; lapsed.',
    },
  ]
  const overrides: OverrideRecord[] = overrideSpecs.flatMap((o) => {
    if (!o.shop || !o.variant) return []
    return [
      {
        id: demoId('override', `${o.shop.code}:${o.variant.key}`),
        retailerId: o.shop.id,
        variantId: o.variant.id,
        ratePaise: Math.round(defaultRate(o.variant) * o.pct),
        final: o.final,
        validFrom: isoDate(daysAgo(o.validFromDaysAgo)),
        validTo: o.validToDaysAgo === undefined ? null : isoDate(daysAgo(o.validToDaysAgo)),
      },
    ]
  })
  await insertMany(
    db,
    retailerPriceOverrides,
    overrides.map((o, i) => ({
      ...o,
      tenantId,
      approvedBy: people.owner.id,
      note: overrideSpecs.filter((s) => s.shop && s.variant)[i]?.note ?? null,
    })),
  )

  // --- Schemes. A distributor only runs a brand's scheme if it carries that brand: `variants` is the
  //     tenant's own catalog overlay, so a scheme whose brand it does not list is simply not written.
  const listedBrandIds = new Set(variants.map((v) => brandId(v.brandKey)))
  const ids = (...keys: string[]): string[] =>
    keys.map((k) => variant(k)?.id).filter((id): id is string => id !== undefined)
  const common = {
    tenantId,
    applicability: {},
    claimChannel: 'dos' as const,
    stackable: true,
    fundingSource: 'company' as const,
    claimable: true,
    gstOnFreeGoods: false,
    pricingDateMode: 'order' as const,
    active: true,
  }
  const schemeRows: SchemeRow[] = [
    {
      ...common,
      id: demoId('scheme', 'campa-750-12-plus-1'),
      name: 'Campa 750 ml / 1 L — a bottle free per case',
      brandId: brandId('campa'),
      scope: {
        variantIds: [
          campaCola750.id,
          campaOrange750.id,
          ...ids(
            'campa-lemon-750ml',
            'campa-cola-1000ml',
            'campa-orange-1000ml',
            'campa-lemon-1000ml',
          ),
        ],
      },
      // the kirana slab (2026-09-08 review): a bottle free per case of 24, from the first case, on
      // the PET flavours — a 12-case threshold sat above every basket in the book and never fired.
      // One in 24 (4 %) is what Campa's 7 % trade margin can carry; the brand funds it (claimable).
      triggerKind: 'qty' as const,
      triggerMin: 24,
      triggerUnit: 'pcs',
      rewardKind: 'free_qty' as const,
      rewardValue: 1,
      rewardUnit: 'pcs' as const,
      freeVariantId: campaCola750.id,
      validFrom: isoDate(daysAgo(90)),
      validTo: isoDate(daysAhead(9)),
      priority: 10,
      sourceRef: 'Reliance circular RCP/2026/08/CAMPA-MON',
    },
    {
      ...common,
      id: demoId('scheme', 'balaji-5pct-5-cases'),
      name: 'Balaji — 4% off on 3+ cases',
      brandId: brandId('balaji'),
      scope: { brandIds: [brandId('balaji')] },
      triggerKind: 'qty' as const,
      triggerMin: 3,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 400,
      validFrom: isoDate(daysAgo(90)),
      validTo: isoDate(daysAhead(9)),
      priority: 20,
      sourceRef: 'Balaji secondary scheme letter Jun-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'order-2pct-5000'),
      // a threshold only the bigger accounts reach (2026-09-08 review: at ₹5,000 it fired on
      // essentially every bill and was a blanket price cut wearing a scheme's clothes)
      name: 'Order value — 2% off on bills over ₹25,000',
      scope: { all: true },
      triggerKind: 'value' as const,
      triggerMin: 2_500_000,
      triggerUnit: 'inr',
      rewardKind: 'order_pct' as const,
      rewardValue: 200,
      validFrom: isoDate(daysAgo(90)),
      validTo: isoDate(daysAhead(9)),
      priority: 30,
      fundingSource: 'distributor' as const,
      claimable: false,
    },
    {
      ...common,
      id: demoId('scheme', 'too-yumm-cash-discount'),
      name: 'Too Yumm — 2% cash discount',
      brandId: brandId('tooyumm'),
      scope: { brandIds: [brandId('tooyumm')] },
      triggerKind: 'value' as const,
      triggerMin: 0,
      triggerUnit: 'inr',
      rewardKind: 'cash_discount_pct' as const,
      rewardValue: 200,
      validFrom: isoDate(daysAgo(21)),
      validTo: isoDate(daysAhead(60)),
      priority: 5,
      claimChannel: 'brand_dms' as const,
      claimable: false,
      sourceRef: 'FieldAssist Too Yumm CD policy',
    },
    {
      ...common,
      id: demoId('scheme', 'mom-makhana-slab'),
      name: 'MOM Makhana — slab scheme',
      brandId: brandId('mommakhana'),
      scope: { brandIds: [brandId('mommakhana')] },
      triggerKind: 'qty' as const,
      triggerMin: 2,
      triggerUnit: 'case',
      slabs: [
        { min: 2, value: 200 },
        { min: 4, value: 400 },
      ],
      rewardKind: 'line_pct' as const,
      rewardValue: 200,
      validFrom: isoDate(daysAgo(60)),
      validTo: isoDate(daysAhead(9)),
      priority: 20,
      sourceRef: 'MOM Foods slab scheme Jul-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'balaji-monsoon-bonanza-expired'),
      name: 'Balaji Monsoon Bonanza — 2 pkts free per 2 cases (expired)',
      brandId: brandId('balaji'),
      scope: { variantIds: [balajiRatlamiSev.id] },
      triggerKind: 'qty' as const,
      triggerMin: 2,
      triggerUnit: 'case',
      rewardKind: 'free_qty' as const,
      rewardValue: 2,
      rewardUnit: 'pcs' as const,
      freeVariantId: balajiRatlamiSev.id,
      validFrom: isoDate(daysAgo(95)),
      validTo: isoDate(daysAgo(35)),
      priority: 10,
      sourceRef: 'Balaji monsoon circular Jun-2026',
    },
    // --- the ten of the realistic demo (spec §2.5) ---------------------------------------------
    {
      ...common,
      id: demoId('scheme', 'sunbake-glucose-10-plus-1'),
      name: 'Sunbake Glucose — 12+1 free',
      brandId: brandId('sunbake'),
      scope: { variantIds: ids('sunbake-glucose-110g', 'sunbake-glucose-250g') },
      triggerKind: 'qty' as const,
      triggerMin: 12,
      triggerUnit: 'pcs',
      rewardKind: 'free_qty' as const,
      rewardValue: 1,
      rewardUnit: 'pcs' as const,
      freeVariantId: variant('sunbake-glucose-110g')?.id ?? null,
      validFrom: isoDate(daysAgo(90)),
      validTo: isoDate(daysAhead(12)),
      priority: 10,
      sourceRef: 'Sunrise Bakers trade letter SB/TL/2026/07',
    },
    {
      ...common,
      id: demoId('scheme', 'sunbake-cream-slab'),
      name: 'Sunbake creams — slab discount',
      brandId: brandId('sunbake'),
      scope: {
        variantIds: ids(
          'sunbake-bourbon-cream-60g',
          'sunbake-bourbon-cream-120g',
          'sunbake-bourbon-cream-300g',
          'sunbake-orange-cream-120g',
          'sunbake-elaichi-cream-60g',
          'sunbake-elaichi-cream-120g',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 2,
      triggerUnit: 'case',
      slabs: [
        { min: 2, value: 300 },
        { min: 4, value: 500 },
        { min: 6, value: 800 },
      ],
      rewardKind: 'line_pct' as const,
      rewardValue: 300,
      validFrom: isoDate(daysAgo(90)),
      // expires on a boundary: the day after tomorrow
      validTo: isoDate(daysAhead(2)),
      priority: 20,
      sourceRef: 'Sunrise Bakers cream slab Aug-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'annapurna-atta-flat-per-case'),
      name: 'Annapurna Atta — ₹15 off per case on 2+',
      brandId: brandId('annapurna'),
      scope: {
        variantIds: ids(
          'annapurna-chakki-fresh-atta-1kg',
          'annapurna-chakki-fresh-atta-5kg',
          'annapurna-chakki-fresh-atta-10kg',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 2,
      triggerUnit: 'case',
      rewardKind: 'net_scheme_amount' as const,
      rewardValue: 1_500,
      validFrom: isoDate(daysAgo(90)),
      validTo: isoDate(daysAhead(25)),
      priority: 20,
      sourceRef: 'Annapurna Agro trade scheme Q2 FY27',
    },
    {
      ...common,
      id: demoId('scheme', 'godavari-ghee-exclusive'),
      name: 'Godavari Ghee — 6% exclusive',
      brandId: brandId('godavari'),
      scope: {
        variantIds: ids(
          'godavari-cow-ghee-200ml',
          'godavari-cow-ghee-500ml',
          'godavari-cow-ghee-1l',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 1,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 600,
      validFrom: isoDate(daysAgo(14)),
      validTo: isoDate(daysAhead(16)),
      priority: 20,
      final: true,
      stackable: false,
      sourceRef: 'Godavari Dairy ghee promotion Sep-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'neelam-soap-3-plus-1-pcs'),
      name: 'Neelam soaps — 12+1 free',
      brandId: brandId('neelam'),
      scope: {
        variantIds: ids(
          'neelam-sandal-soap-100g',
          'neelam-rose-soap-100g',
          'neelam-neem-soap-100g',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 12,
      triggerUnit: 'pcs',
      rewardKind: 'free_qty' as const,
      rewardValue: 1,
      rewardUnit: 'pcs' as const,
      freeVariantId: variant('neelam-sandal-soap-100g')?.id ?? null,
      gstOnFreeGoods: true,
      validFrom: isoDate(daysAgo(70)),
      validTo: isoDate(daysAgo(25)),
      priority: 10,
      sourceRef: 'Shubhda Consumer Care soap offer Jul-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'chamak-order-3pct-10000'),
      name: 'Chamak — 3% off on Chamak bills over ₹4,000',
      brandId: brandId('chamak'),
      scope: { brandIds: [brandId('chamak')] },
      triggerKind: 'value' as const,
      triggerMin: 400_000,
      triggerUnit: 'inr',
      rewardKind: 'order_pct' as const,
      rewardValue: 300,
      validFrom: isoDate(daysAgo(65)),
      validTo: isoDate(daysAgo(20)),
      priority: 30,
      fundingSource: 'distributor' as const,
      claimable: false,
    },
    {
      ...common,
      id: demoId('scheme', 'konkan-launch-10pct'),
      name: 'Konkan Crunch — launch offer 10%',
      brandId: brandId('konkancrunch'),
      scope: { brandIds: [brandId('konkancrunch')] },
      triggerKind: 'value' as const,
      triggerMin: 0,
      triggerUnit: 'inr',
      rewardKind: 'line_pct' as const,
      rewardValue: 1_000,
      validFrom: isoDate(daysAgo(7)),
      validTo: isoDate(daysAhead(7)),
      priority: 15,
      sourceRef: 'Konkan Snack Company launch letter',
    },
    {
      ...common,
      id: demoId('scheme', 'rajwadi-soda-cash-discount'),
      name: 'Rajwadi sodas — 1.5% cash discount',
      brandId: brandId('rajwadi'),
      scope: { brandIds: [brandId('rajwadi')] },
      triggerKind: 'value' as const,
      triggerMin: 0,
      triggerUnit: 'inr',
      rewardKind: 'cash_discount_pct' as const,
      rewardValue: 150,
      validFrom: isoDate(daysAgo(30)),
      validTo: isoDate(daysAhead(45)),
      priority: 5,
      claimable: false,
      sourceRef: 'Rajwadi Beverages CD policy FY27',
    },
    {
      ...common,
      id: demoId('scheme', 'campa-2l-festive-expired'),
      name: 'Campa 2 L — festive 2 bottles free per 2 cases (expired)',
      brandId: brandId('campa'),
      scope: { variantIds: ids('campa-cola-2000ml', 'campa-orange-2000ml', 'campa-lemon-2000ml') },
      triggerKind: 'qty' as const,
      triggerMin: 2,
      triggerUnit: 'case',
      rewardKind: 'free_qty' as const,
      rewardValue: 2,
      rewardUnit: 'pcs' as const,
      freeVariantId: need('campa-cola-2000ml').id,
      validFrom: isoDate(daysAgo(120)),
      validTo: isoDate(daysAgo(60)),
      priority: 10,
      sourceRef: 'Reliance circular RCP/2026/05/CAMPA-FEST',
    },
    {
      ...common,
      id: demoId('scheme', 'campa-pet-3pct-4-cases'),
      name: 'Campa 1 L / 2 L — 3% off on 5+ cases',
      brandId: brandId('campa'),
      scope: {
        variantIds: ids(
          'campa-cola-1000ml',
          'campa-orange-1000ml',
          'campa-lemon-1000ml',
          'campa-cola-2000ml',
          'campa-orange-2000ml',
          'campa-lemon-2000ml',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 5,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 300,
      validFrom: isoDate(daysAgo(85)),
      validTo: isoDate(daysAhead(20)),
      priority: 20,
      sourceRef: 'Reliance circular RCP/2026/06/CAMPA-PET',
    },
    {
      ...common,
      id: demoId('scheme', 'rajwadi-soda-5pct-3-cases'),
      name: 'Rajwadi sodas — 5% off on 4+ cases',
      brandId: brandId('rajwadi'),
      scope: { brandIds: [brandId('rajwadi')] },
      triggerKind: 'qty' as const,
      triggerMin: 4,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 500,
      validFrom: isoDate(daysAgo(80)),
      validTo: isoDate(daysAhead(15)),
      priority: 20,
      sourceRef: 'Rajwadi Beverages summer scheme SS/2026/07',
    },
    {
      ...common,
      id: demoId('scheme', 'godavari-uht-2pct-2-cases'),
      name: 'Godavari UHT milk — 2% off on 3+ cases',
      brandId: brandId('godavari'),
      scope: {
        variantIds: ids(
          'godavari-toned-uht-milk-500ml',
          'godavari-toned-uht-milk-1l',
          'godavari-full-cream-uht-milk-500ml',
          'godavari-full-cream-uht-milk-1l',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 3,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 200,
      validFrom: isoDate(daysAgo(85)),
      validTo: isoDate(daysAhead(30)),
      priority: 20,
      sourceRef: 'Godavari Dairy UHT trade letter Aug-2026',
    },
    {
      ...common,
      id: demoId('scheme', 'annapurna-oil-scheme-inactive'),
      name: 'Annapurna oils — 4% on 4+ cases (withdrawn)',
      brandId: brandId('annapurna'),
      scope: {
        variantIds: ids(
          'annapurna-sunflower-refined-oil-1l',
          'annapurna-sunflower-refined-oil-5l',
          'annapurna-filtered-groundnut-oil-1l',
          'annapurna-filtered-groundnut-oil-5l',
        ),
      },
      triggerKind: 'qty' as const,
      triggerMin: 4,
      triggerUnit: 'case',
      rewardKind: 'line_pct' as const,
      rewardValue: 400,
      validFrom: isoDate(daysAgo(10)),
      validTo: isoDate(daysAhead(20)),
      priority: 20,
      active: false,
      sourceRef: 'Annapurna Agro oil scheme — withdrawn 2026-09-01',
    },
  ]
  const written = schemeRows.filter((r) => !r.brandId || listedBrandIds.has(r.brandId))
  await insertMany(db, schemes, written)

  // --- Bargains: two per status, on five shops and three SKUs (spec §2.5). The two `requested` are
  //     today's, and reporting files the matching pending approvals. ---------------------------------
  const bargainVariants = [
    campaCola750,
    variant('sunbake-marie-light-300g') ?? campaCola750,
    variant('godavari-cow-ghee-500ml') ?? campaOrange750,
  ]
  const bargainShops = [
    shopOf('kirana_small', 1),
    shopOf('grocery_medium', 0),
    shopOf('supermarket', 0),
    shopOf('kirana_small', 2),
    shopOf('grocery_medium', 1),
  ].filter((r): r is RetailerRow => r !== undefined)
  const bargainSpecs: { status: BargainRecord['status']; ageDays: number }[] = [
    { status: 'requested', ageDays: 0 },
    { status: 'requested', ageDays: 0 },
    { status: 'auto_approved', ageDays: 4 },
    { status: 'auto_approved', ageDays: 16 },
    { status: 'approved', ageDays: 3 },
    { status: 'approved', ageDays: 22 },
    { status: 'rejected', ageDays: 9 },
    { status: 'rejected', ageDays: 40 },
    { status: 'expired', ageDays: 30 },
    { status: 'expired', ageDays: 50 },
  ]
  const bargains: BargainRecord[] = []
  const bargainRows = bargainSpecs.flatMap((spec, i) => {
    const shop = bargainShops[i % bargainShops.length]
    const v = bargainVariants[i % bargainVariants.length]
    if (!shop || !v) return []
    const listRate = defaultRate(v)
    const askedRate = Math.round(listRate * (spec.status === 'auto_approved' ? 0.985 : 0.965))
    const decidedByOwner = spec.status === 'approved' || spec.status === 'rejected'
    const raisedAt = occurred(atIstTime(daysAgo(spec.ageDays), 11, 15))
    const key = `${shop.code}:${spec.status}:${i}`
    const id = demoId('bargain', key)
    bargains.push({
      id,
      key,
      status: spec.status,
      retailerId: shop.id,
      retailerCode: shop.code,
      variantId: v.id,
      ageDays: spec.ageDays,
      askedRatePaise: askedRate,
      listRatePaise: listRate,
    })
    return [
      {
        id,
        tenantId,
        retailerId: shop.id,
        variantId: v.id,
        requestedBy: people.salespeople.rahul.id,
        listRatePaise: listRate,
        askedRatePaise: askedRate,
        approvedRatePaise:
          spec.status === 'auto_approved' || spec.status === 'approved' ? askedRate : null,
        status: spec.status,
        evaluatedBasis: 'tier_price',
        decidedBy: decidedByOwner ? people.owner.id : null,
        decidedAt: decidedByOwner ? occurred(new Date(raisedAt.getTime() + 2 * 3_600_000)) : null,
        expiresAt:
          spec.status === 'expired'
            ? atIstTime(daysAgo(spec.ageDays - 3), 18)
            : spec.status === 'requested'
              ? atIstTime(daysAhead(3), 18)
              : new Date(raisedAt.getTime() + 3 * 86_400_000),
        note:
          spec.status === 'rejected'
            ? 'Below floor for this retailer tier.'
            : spec.status === 'auto_approved'
              ? 'Within the rep’s bound; approved on the spot.'
              : null,
        createdAt: raisedAt,
      },
    ]
  })
  await insertMany(db, bargainRequests, bargainRows)

  return { ratesByVariantId, priceListIds, schemes: written, overrides, bargains }
}
