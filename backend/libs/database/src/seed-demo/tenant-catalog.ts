/** Tenant overlay on the global catalog (ADR 0005): suppliers, brand modes, pack configs, costs, listings. */
import { insertMany } from './db-helpers.js'
import {
  returnPolicies,
  supplierPackConfigs,
  suppliers,
  tenantBrands,
  tenantProductCosts,
  tenantProducts,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { brandId, type VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import { makeGstin } from './util.js'

export interface SupplierIds {
  reliance: string
  guruKripa: string
  momMakhana: string
  guiltfree: string
  alansFoods: string
}

export interface VariantCost {
  purchaseRatePaise: number
  landedCostPaise: number
}

export interface TenantCatalogResult {
  supplierIds: SupplierIds
  costsByVariantId: Map<string, VariantCost>
}

/** Same 0.86-of-ex-tax-MRP selling-rate model as pricing.ts, kept local so this module has no ordering
 *  dependency on it; costs are derived from margin, not from the price list rows. */
function exTaxSellRate(mrpPaise: number, gstBps: number, cessBps: number): number {
  const exTaxMrp = mrpPaise / (1 + (gstBps + cessBps) / 10_000)
  return Math.round(exTaxMrp * 0.86)
}

const MANUFACTURER_MARGIN_BPS: Record<string, number> = {
  reliance: 1000,
  guiltfree: 1200,
  balajiwafers: 900,
  mommakhana: 1400,
  alansfoods: 1500,
}

export async function seedTenantCatalog(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
): Promise<TenantCatalogResult> {
  const supplierIds: SupplierIds = {
    reliance: demoId('supplier', 'reliance-depot'),
    guruKripa: demoId('supplier', 'guru-kripa'),
    momMakhana: demoId('supplier', 'mom-makhana'),
    guiltfree: demoId('supplier', 'guiltfree'),
    alansFoods: demoId('supplier', 'alans-foods'),
  }

  await insertMany(db, suppliers, [
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
  ])

  await insertMany(db, tenantBrands, [
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
  ])

  await insertMany(db, returnPolicies, [
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
  ])

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
  ])

  await insertMany(
    db,
    tenantProducts,
    variants.map((v, i) => ({
      id: demoId('tenant-product', v.key),
      tenantId,
      variantId: v.id,
      listed: true,
      minOrderQty: 1,
      orderIncrement: 1,
      sortOrder: i,
    })),
  )

  const costsByVariantId = new Map<string, VariantCost>()
  for (const v of variants) {
    const sell = exTaxSellRate(v.mrpPaise, v.gstBps, v.cessBps)
    const marginBps = MANUFACTURER_MARGIN_BPS[v.manufacturerKey] ?? 1000
    const purchaseRatePaise = Math.round((sell * 10_000) / (10_000 + marginBps))
    const landedCostPaise = Math.round(purchaseRatePaise * 1.02)
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
