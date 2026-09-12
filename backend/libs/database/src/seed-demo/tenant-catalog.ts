/** Tenant overlay on the global catalog (ADR 0005): suppliers, brand modes, pack configs, costs, listings. */
import { insertMany } from './db-helpers.js'
import {
  productProposals,
  returnPolicies,
  supplierPackConfigs,
  suppliers,
  tenantBrands,
  tenantProductCosts,
  tenantProducts,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { brandId, type VariantRow } from './catalog.js'
import { currentDemoScope, demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import { sellRatePaise } from './rates.js'
import { atIstTime, daysAgo, makeGstin } from './util.js'

export interface SupplierIds {
  reliance: string
  guruKripa: string
  momMakhana: string
  guiltfree: string
  alansFoods: string
  rajwadiDepot: string
  sunriseStockist: string
  konkanAgency: string
  annapurnaMill: string
  godavariDairy: string
  shubhdaDist: string
}

export interface VariantCost {
  purchaseRatePaise: number
  landedCostPaise: number
}

export interface TenantCatalogResult {
  supplierIds: SupplierIds
  costsByVariantId: Map<string, VariantCost>
}

/**
 * The distributor's margin over its purchase price, by house: what the sell rate (rates.ts, the same
 * one the price lists carry) is over the PTD. Staples are thin, personal care is fat; every house
 * leaves room for the schemes its brand runs (2026-09-08 review: a 6 % staple margin under a ₹40 a
 * case atta scheme went negative on the atta lines).
 */
const MANUFACTURER_MARGIN_BPS: Record<string, number> = {
  reliance: 1200,
  guiltfree: 1300,
  balajiwafers: 1100,
  mommakhana: 1500,
  alansfoods: 1500,
  rajwadi: 1300,
  sunrisebakers: 1300,
  konkansnack: 1700,
  annapurnaagro: 700,
  godavaridairy: 900,
  shubhda: 1800,
}
/** Freight and handling on top of the PTD: a point and a half on a Kalyan depot run. */
const LANDED_OVER_PURCHASE = 1.015

/** Listing order on the rep's screen: by category, the way a shelf is walked. */
const CATEGORY_ORDER = [
  'Beverages',
  'Biscuits',
  'Snacks - Chips',
  'Snacks - Namkeen',
  'Snacks - Makhana',
  'Packaged Food',
  'Dairy',
  'Personal Care',
  'Household',
]

export async function seedTenantCatalog(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  people?: PeopleResult,
): Promise<TenantCatalogResult> {
  const supplierIds: SupplierIds = {
    reliance: demoId('supplier', 'reliance-depot'),
    guruKripa: demoId('supplier', 'guru-kripa'),
    momMakhana: demoId('supplier', 'mom-makhana'),
    guiltfree: demoId('supplier', 'guiltfree'),
    alansFoods: demoId('supplier', 'alans-foods'),
    rajwadiDepot: demoId('supplier', 'rajwadi-depot'),
    sunriseStockist: demoId('supplier', 'shree-sai-marketing'),
    konkanAgency: demoId('supplier', 'konkan-traders'),
    annapurnaMill: demoId('supplier', 'annapurna-mill-depot'),
    godavariDairy: demoId('supplier', 'godavari-chilling-centre'),
    shubhdaDist: demoId('supplier', 'shubhda-vapi-works'),
  }

  // The tenant's overlay covers only what it actually lists: `variants` IS that overlay, so a
  // distributor that does not carry Masti Oye gets no Alan's supplier row, no tenant_brands row and
  // no return policy for it. (The pilot lists all six brands, so nothing is filtered out there.)
  const listedBrandIds = new Set(variants.map((v) => brandId(v.brandKey)))
  const listedManufacturerIds = new Set(
    variants.map((v) => demoId('manufacturer', v.manufacturerKey)),
  )
  const listed = <T extends { brandId: string }>(rows: T[]): T[] =>
    rows.filter((r) => listedBrandIds.has(r.brandId))
  const stocked = <T extends { manufacturerId: string }>(rows: T[]): T[] =>
    rows.filter((r) => listedManufacturerIds.has(r.manufacturerId))

  await insertMany(
    db,
    suppliers,
    stocked([
      {
        id: supplierIds.reliance,
        tenantId,
        name: 'Reliance Consumer Products — Kalyan Depot',
        gstin: makeGstin('27', 'AABCR4521Q'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'reliance'),
        phone: '+912251234500',
        eInvoicing: true,
        paymentTermsDays: 30,
        tallyLedgerName: 'Reliance Consumer Products - Kalyan Depot',
      },
      {
        id: supplierIds.guruKripa,
        tenantId,
        name: 'Guru Kripa Agencies (Balaji Super-Stockist)',
        gstin: makeGstin('27', 'AAJFG7845K'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'balajiwafers'),
        phone: '+912251234501',
        eInvoicing: true,
        paymentTermsDays: 21,
        tallyLedgerName: 'Guru Kripa Agencies',
      },
      {
        id: supplierIds.momMakhana,
        tenantId,
        name: 'MOM Foods — Bikaner',
        gstin: makeGstin('08', 'AACCM9087P'),
        stateCode: '08',
        manufacturerId: demoId('manufacturer', 'mommakhana'),
        phone: '+911512345600',
        eInvoicing: true,
        paymentTermsDays: 30,
        tallyLedgerName: 'MOM Foods Pvt Ltd',
      },
      {
        id: supplierIds.guiltfree,
        tenantId,
        name: 'Guiltfree Industries — Gurugram',
        gstin: makeGstin('06', 'AABCG3312F'),
        stateCode: '06',
        manufacturerId: demoId('manufacturer', 'guiltfree'),
        phone: '+911244567800',
        eInvoicing: true,
        paymentTermsDays: 30,
        tallyLedgerName: 'Guiltfree Industries Pvt Ltd',
      },
      {
        id: supplierIds.alansFoods,
        tenantId,
        name: "Alan's Food Products — Bhiwandi",
        gstin: makeGstin('27', 'AAEFA6120L'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'alansfoods'),
        phone: '+912512345601',
        eInvoicing: false,
        paymentTermsDays: 15,
        tallyLedgerName: "Alan's Food Products",
      },
      {
        id: supplierIds.rajwadiDepot,
        tenantId,
        name: 'Rajwadi Beverages — Bhiwandi Depot',
        gstin: makeGstin('27', 'AAECR7712N'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'rajwadi'),
        phone: '+912522345610',
        eInvoicing: true,
        paymentTermsDays: 21,
        tallyLedgerName: 'Rajwadi Beverages - Bhiwandi Depot',
      },
      {
        id: supplierIds.sunriseStockist,
        tenantId,
        name: 'Shree Sai Marketing (Sunbake Super-Stockist)',
        gstin: makeGstin('27', 'AAOFS5521M'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'sunrisebakers'),
        phone: '+912251234611',
        eInvoicing: true,
        paymentTermsDays: 21,
        tallyLedgerName: 'Shree Sai Marketing',
      },
      {
        id: supplierIds.konkanAgency,
        tenantId,
        name: 'Konkan Traders, Ratnagiri',
        gstin: makeGstin('27', 'AAFFK9034P'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'konkansnack'),
        phone: '+912352233612',
        eInvoicing: false,
        paymentTermsDays: 15,
        tallyLedgerName: 'Konkan Traders',
      },
      {
        id: supplierIds.annapurnaMill,
        tenantId,
        name: 'Annapurna Agro — Kalyan Mill Depot',
        gstin: makeGstin('27', 'AABCA6610Q'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'annapurnaagro'),
        phone: '+912512345613',
        eInvoicing: true,
        paymentTermsDays: 15,
        tallyLedgerName: 'Annapurna Agro Foods Ltd - Kalyan',
      },
      {
        id: supplierIds.godavariDairy,
        tenantId,
        name: 'Godavari Dairy — Ahmednagar Chilling Centre',
        gstin: makeGstin('27', 'AABCG2287L'),
        stateCode: '27',
        manufacturerId: demoId('manufacturer', 'godavaridairy'),
        phone: '+912412345614',
        eInvoicing: true,
        paymentTermsDays: 7,
        tallyLedgerName: 'Godavari Dairy Products Ltd',
      },
      {
        id: supplierIds.shubhdaDist,
        tenantId,
        name: 'Shubhda Consumer Care — Vapi Works',
        gstin: makeGstin('24', 'AAGCS4478R'),
        stateCode: '24',
        manufacturerId: demoId('manufacturer', 'shubhda'),
        phone: '+912602345615',
        eInvoicing: true,
        paymentTermsDays: 30,
        tallyLedgerName: 'Shubhda Consumer Care Pvt Ltd',
      },
    ]),
  )

  await insertMany(
    db,
    tenantBrands,
    listed([
      { id: demoId('tenant-brand', 'campa'), tenantId, brandId: brandId('campa') },
      { id: demoId('tenant-brand', 'independence'), tenantId, brandId: brandId('independence') },
      {
        id: demoId('tenant-brand', 'tooyumm'),
        tenantId,
        brandId: brandId('tooyumm'),
        fulfilmentMode: 'brand_dms' as const,
        tallyExportSource: 'brand_dms' as const,
        cashDiscountMode: 'on_invoice' as const,
        claimChannel: 'brand_dms' as const,
        salesForce: 'manufacturer',
      },
      { id: demoId('tenant-brand', 'balaji'), tenantId, brandId: brandId('balaji') },
      { id: demoId('tenant-brand', 'mommakhana'), tenantId, brandId: brandId('mommakhana') },
      { id: demoId('tenant-brand', 'mastioye'), tenantId, brandId: brandId('mastioye') },
      { id: demoId('tenant-brand', 'rajwadi'), tenantId, brandId: brandId('rajwadi') },
      { id: demoId('tenant-brand', 'sunbake'), tenantId, brandId: brandId('sunbake') },
      { id: demoId('tenant-brand', 'konkancrunch'), tenantId, brandId: brandId('konkancrunch') },
      { id: demoId('tenant-brand', 'annapurna'), tenantId, brandId: brandId('annapurna') },
      { id: demoId('tenant-brand', 'godavari'), tenantId, brandId: brandId('godavari') },
      { id: demoId('tenant-brand', 'neelam'), tenantId, brandId: brandId('neelam') },
      { id: demoId('tenant-brand', 'chamak'), tenantId, brandId: brandId('chamak') },
    ]),
  )

  await insertMany(
    db,
    returnPolicies,
    listed([
      {
        id: demoId('return-policy', 'campa'),
        tenantId,
        brandId: brandId('campa'),
        saleableReturnDays: 7,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 30,
        claimSheetFormat: 'reliance_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 30,
        claimSupplierId: supplierIds.reliance,
      },
      {
        id: demoId('return-policy', 'independence'),
        tenantId,
        brandId: brandId('independence'),
        saleableReturnDays: 7,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 30,
        claimSheetFormat: 'reliance_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 30,
        claimSupplierId: supplierIds.reliance,
      },
      {
        id: demoId('return-policy', 'tooyumm'),
        tenantId,
        brandId: brandId('tooyumm'),
        saleableReturnDays: 0,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 15,
        claimSheetFormat: 'field_assist',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 15,
        claimSupplierId: supplierIds.guiltfree,
        notes: 'Claims settle inside FieldAssist, not on our books.',
      },
      {
        id: demoId('return-policy', 'balaji'),
        tenantId,
        brandId: brandId('balaji'),
        saleableReturnDays: 5,
        damageClaimable: true,
        expiryClaimable: false,
        claimWindowDays: 10,
        claimSheetFormat: 'guru_kripa_xlsx',
        claimPeriodKind: 'fortnightly' as const,
        claimCutoffDay: 1,
        settlementDays: 21,
        claimSupplierId: supplierIds.guruKripa,
      },
      {
        id: demoId('return-policy', 'mommakhana'),
        tenantId,
        brandId: brandId('mommakhana'),
        saleableReturnDays: 0,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 21,
        claimSheetFormat: 'mom_foods_email',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 30,
        claimSupplierId: supplierIds.momMakhana,
      },
      {
        id: demoId('return-policy', 'mastioye'),
        tenantId,
        brandId: brandId('mastioye'),
        saleableReturnDays: 0,
        damageClaimable: false,
        expiryClaimable: false,
        notes: "Small supplier; Alan's does not accept returns.",
      },
      {
        id: demoId('return-policy', 'rajwadi'),
        tenantId,
        brandId: brandId('rajwadi'),
        saleableReturnDays: 7,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 30,
        claimSheetFormat: 'rajwadi_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 30,
        claimSupplierId: supplierIds.rajwadiDepot,
      },
      {
        id: demoId('return-policy', 'sunbake'),
        tenantId,
        brandId: brandId('sunbake'),
        saleableReturnDays: 5,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 15,
        claimSheetFormat: 'field_assist',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 21,
        claimSupplierId: supplierIds.sunriseStockist,
      },
      {
        id: demoId('return-policy', 'konkancrunch'),
        tenantId,
        brandId: brandId('konkancrunch'),
        saleableReturnDays: 0,
        damageClaimable: true,
        expiryClaimable: false,
        claimWindowDays: 10,
        claimSheetFormat: 'konkan_email',
        claimPeriodKind: 'fortnightly' as const,
        claimCutoffDay: 1,
        settlementDays: 15,
        claimSupplierId: supplierIds.konkanAgency,
      },
      {
        id: demoId('return-policy', 'annapurna'),
        tenantId,
        brandId: brandId('annapurna'),
        saleableReturnDays: 0,
        damageClaimable: false,
        expiryClaimable: false,
        notes: 'Staples: no returns, no claims. Bags are checked at the gate.',
      },
      {
        id: demoId('return-policy', 'godavari'),
        tenantId,
        brandId: brandId('godavari'),
        saleableReturnDays: 0,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 7,
        claimSheetFormat: 'godavari_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 15,
        claimSupplierId: supplierIds.godavariDairy,
        notes: 'Expiry window is seven days: dahi, chaas and paneer turn fast.',
      },
      {
        id: demoId('return-policy', 'neelam'),
        tenantId,
        brandId: brandId('neelam'),
        saleableReturnDays: 30,
        damageClaimable: true,
        expiryClaimable: false,
        claimWindowDays: 30,
        claimSheetFormat: 'shubhda_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 45,
        claimSupplierId: supplierIds.shubhdaDist,
      },
      {
        id: demoId('return-policy', 'chamak'),
        tenantId,
        brandId: brandId('chamak'),
        saleableReturnDays: 30,
        damageClaimable: true,
        expiryClaimable: false,
        claimWindowDays: 30,
        claimSheetFormat: 'shubhda_xlsx',
        claimPeriodKind: 'monthly' as const,
        claimCutoffDay: 1,
        settlementDays: 45,
        claimSupplierId: supplierIds.shubhdaDist,
      },
    ]),
  )

  const balajiKeys = new Set(variants.filter((v) => v.brandKey === 'balaji').map((v) => v.key))
  const tooYummKeys = new Set(variants.filter((v) => v.brandKey === 'tooyumm').map((v) => v.key))

  await insertMany(db, supplierPackConfigs, [
    ...variants
      .filter((v) => balajiKeys.has(v.key))
      .map((v) => ({
        id: demoId('supplier-pack', `guru-kripa:${v.key}`),
        tenantId,
        supplierId: supplierIds.guruKripa,
        variantId: v.id,
        pcsPerCase: 90,
        supplierCode: 'x 90',
        supplierDescription: `${v.name.toUpperCase()} X 90`,
      })),
    ...variants
      .filter((v) => tooYummKeys.has(v.key))
      .map((v) => ({
        id: demoId('supplier-pack', `guiltfree:${v.key}`),
        tenantId,
        supplierId: supplierIds.guiltfree,
        variantId: v.id,
        pcsPerCase: 120,
        supplierCode: '_120',
        supplierDescription: `${v.name.toUpperCase().replace(/ /g, '')}_120`,
      })),
    // The pack-size mismatches docint has to notice: the super-stockist bills Sunbake in cases of
    // 120 whatever the printed case, the mill bills atta in bags and rice by the sack, the dairy in
    // crates of 24 or 12.
    ...variants
      .filter((v) => v.brandKey === 'sunbake')
      .map((v) => ({
        id: demoId('supplier-pack', `shree-sai:${v.key}`),
        tenantId,
        supplierId: supplierIds.sunriseStockist,
        variantId: v.id,
        pcsPerCase: 120,
        supplierCode: '_120',
        supplierDescription: `${v.name.toUpperCase().replace(/ /g, '')}_120`,
      })),
    ...variants
      .filter((v) => v.brandKey === 'annapurna')
      .map((v) => ({
        id: demoId('supplier-pack', `annapurna-mill:${v.key}`),
        tenantId,
        supplierId: supplierIds.annapurnaMill,
        variantId: v.id,
        pcsPerCase: v.netUnit === 'kg' && v.netQty >= 5 ? 1 : v.defaultCaseSize * 2,
        supplierCode: v.netUnit === 'kg' && v.netQty >= 5 ? 'BAG' : 'CS1',
        supplierDescription: `${v.name.toUpperCase()} ${v.netUnit === 'kg' && v.netQty >= 5 ? 'BAG' : 'CS1'}`,
      })),
    ...variants
      .filter((v) => v.brandKey === 'godavari')
      .map((v) => ({
        id: demoId('supplier-pack', `godavari-dairy:${v.key}`),
        tenantId,
        supplierId: supplierIds.godavariDairy,
        variantId: v.id,
        pcsPerCase: v.defaultCaseSize >= 24 ? 24 : 12,
        supplierCode: v.defaultCaseSize >= 24 ? 'CRATE24' : 'CRATE12',
        supplierDescription: `${v.name.toUpperCase()} CRATE${v.defaultCaseSize >= 24 ? 24 : 12}`,
      })),
  ])

  const categoryRank = (category: string): number => {
    const i = CATEGORY_ORDER.indexOf(category)
    return i < 0 ? CATEGORY_ORDER.length : i
  }
  const sorted = [...variants].sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.key.localeCompare(b.key),
  )
  const sortOrder = new Map(sorted.map((v, i) => [v.id, i]))
  await insertMany(
    db,
    tenantProducts,
    variants.map((v, i) => ({
      id: demoId('tenant-product', v.key),
      tenantId,
      variantId: v.id,
      // A discontinued SKU stays on the overlay (its history is real) but is no longer offered; a
      // proposed one is listed at once, the distributor being the one who proposed it (ADR 0005).
      listed: v.status !== 'discontinued',
      minOrderQty: 1,
      orderIncrement: 1,
      sortOrder: sortOrder.get(v.id) ?? i,
    })),
  )

  // The curation queue, pilot only (it is the proposer): one proposal per proposed product plus a
  // merge that the curator has already turned down.
  if (people && currentDemoScope() === '') {
    const proposed = variants.filter((v) => v.status === 'proposed')
    const [first, second] = proposed
    await insertMany(db, productProposals, [
      ...(first
        ? [
            {
              id: demoId('product-proposal', `open:${first.key}`),
              tenantId,
              proposedBy: people.owner.id,
              kind: 'new_product',
              productId: demoId('product', first.productKey),
              variantId: first.id,
              payload: {
                name: first.name,
                mrpPaise: first.mrpPaise,
                caseSize: first.defaultCaseSize,
              },
              status: 'open' as const,
              createdAt: atIstTime(daysAgo(3), 11, 0),
            },
          ]
        : []),
      ...(second
        ? [
            {
              id: demoId('product-proposal', `accepted:${second.key}`),
              tenantId,
              proposedBy: people.manager.id,
              kind: 'new_product',
              productId: demoId('product', second.productKey),
              variantId: second.id,
              payload: {
                name: second.name,
                mrpPaise: second.mrpPaise,
                caseSize: second.defaultCaseSize,
              },
              status: 'accepted' as const,
              resolvedBy: 'curator',
              resolvedAt: atIstTime(daysAgo(9), 15, 0),
              resolutionNote: 'Accepted; MRP and case size verified against the pack.',
              createdAt: atIstTime(daysAgo(14), 11, 0),
            },
          ]
        : []),
      ...(first
        ? [
            {
              id: demoId('product-proposal', `rejected:${first.key}`),
              tenantId,
              proposedBy: people.owner.id,
              kind: 'merge',
              productId: demoId('product', first.productKey),
              variantId: null,
              payload: {
                mergeInto: demoId('product', 'balaji-ratlami-sev'),
                reason: 'Same sev, other brand',
              },
              status: 'rejected' as const,
              resolvedBy: 'curator',
              resolvedAt: atIstTime(daysAgo(20), 15, 0),
              resolutionNote: 'Different manufacturer; a merge would mix two brands.',
              createdAt: atIstTime(daysAgo(25), 11, 0),
            },
          ]
        : []),
    ])
  }

  const costsByVariantId = new Map<string, VariantCost>()
  for (const v of variants) {
    const sell = sellRatePaise(v)
    const marginBps = MANUFACTURER_MARGIN_BPS[v.manufacturerKey] ?? 1000
    const purchaseRatePaise = Math.round((sell * 10_000) / (10_000 + marginBps))
    const landedCostPaise = Math.round(purchaseRatePaise * LANDED_OVER_PURCHASE)
    costsByVariantId.set(v.id, { purchaseRatePaise, landedCostPaise })
  }

  await insertMany(
    db,
    tenantProductCosts,
    variants.map((v) => {
      const cost = costsByVariantId.get(v.id)
      if (!cost) throw new Error(`no computed cost for variant ${v.key}`)
      const marginBps = MANUFACTURER_MARGIN_BPS[v.manufacturerKey] ?? 1000
      return {
        id: demoId('tenant-product-cost', v.key),
        tenantId,
        variantId: v.id,
        purchaseRatePaise: cost.purchaseRatePaise,
        landedCostPaise: cost.landedCostPaise,
        ptdPaise: cost.purchaseRatePaise,
        schemeMarginBps: marginBps,
      }
    }),
  )

  return { supplierIds, costsByVariantId }
}
