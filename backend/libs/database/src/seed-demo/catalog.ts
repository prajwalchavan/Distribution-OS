/**
 * Global product master (ADR 0005): manufacturers, brands, products, variants, pack hierarchy, external
 * codes, supplier-invoice aliases and dated HSN rates. No tenant_id — shared by every distributor.
 */
import {
  brands,
  hsnRates,
  manufacturers,
  productAliases,
  productExternalCodes,
  productPacks,
  products,
  productVariants,
} from '../schema/index.js'
import type { Db } from '../client.js'
import {
  EXTRA_ALIASES,
  EXTRA_BRANDS,
  EXTRA_EXTERNAL_CODES,
  EXTRA_HSN_RATES,
  EXTRA_MANUFACTURERS,
  EXTRA_PRODUCTS,
  INNER_PACK_BY_BRAND,
  INNER_PACK_BY_VARIANT,
} from './catalog-extra.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'

export type NetUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs'
export type CatalogStatus = 'active' | 'proposed' | 'discontinued'

export interface VariantRow {
  id: string
  key: string
  productKey: string
  brandKey: string
  manufacturerKey: string
  /** `products.category` — the key of the owner's category-mix chart (seed-demo/reporting.ts). */
  category: string
  name: string
  netQty: number
  netUnit: NetUnit
  defaultCaseSize: number
  hsnCode: string
  gstBps: number
  cessBps: number
  mrpPaise: number
  shelfLifeDays: number
  /** `active` unless the row is one of the demo's proposed / discontinued SKUs. */
  status: CatalogStatus
}

export interface VariantDef {
  key: string
  name: string
  netQty: number
  netUnit: NetUnit
  caseSize: number
  mrpPaise: number
  shelfLifeDays: number
  hsnCode: string
  gstBps: number
  cessBps: number
  status?: CatalogStatus
}

export interface ProductDef {
  key: string
  manufacturerKey: string
  brandKey: string
  name: string
  category: string
  status?: CatalogStatus
  variants: VariantDef[]
}

export interface ManufacturerDef {
  key: string
  name: string
  legalName: string
  fssaiLicense: string
  website: string
}

export interface BrandDef {
  key: string
  manufacturerKey: string
  name: string
}

const MANUFACTURERS: ManufacturerDef[] = [
  {
    key: 'reliance',
    name: 'Reliance Consumer Products',
    legalName: 'Reliance Consumer Products Limited',
    fssaiLicense: '10015043001234',
    website: 'https://www.relianceconsumerproducts.com',
  },
  {
    key: 'guiltfree',
    name: 'Guiltfree Industries',
    legalName: 'Guiltfree Industries Private Limited',
    fssaiLicense: '10016043002345',
    website: 'https://www.tooyumm.com',
  },
  {
    key: 'balajiwafers',
    name: 'Balaji Wafers',
    legalName: 'Balaji Wafers Private Limited',
    fssaiLicense: '10013043003456',
    website: 'https://www.balajiwafers.com',
  },
  {
    key: 'mommakhana',
    name: 'MOM Foods',
    legalName: 'MOM Foods Private Limited',
    fssaiLicense: '10814043004567',
    website: 'https://www.momsnacks.in',
  },
  {
    key: 'alansfoods',
    name: "Alan's Food Products",
    legalName: "Alan's Food Products Private Limited",
    fssaiLicense: '10015043005678',
    website: 'https://www.mastioye.in',
  },
  ...EXTRA_MANUFACTURERS,
]

const BRANDS: BrandDef[] = [
  { key: 'campa', manufacturerKey: 'reliance', name: 'Campa' },
  { key: 'independence', manufacturerKey: 'reliance', name: 'Independence' },
  { key: 'tooyumm', manufacturerKey: 'guiltfree', name: 'Too Yumm' },
  { key: 'balaji', manufacturerKey: 'balajiwafers', name: 'Balaji' },
  { key: 'mommakhana', manufacturerKey: 'mommakhana', name: 'MOM Makhana' },
  { key: 'mastioye', manufacturerKey: 'alansfoods', name: 'Masti Oye' },
  ...EXTRA_BRANDS,
]

/** Campa's five pack sizes are identical in case size / MRP / shelf life across the three flavours. */
function campaSizes(flavourKey: string): VariantDef[] {
  const sizes: { size: string; ml: number; caseSize: number; mrpPaise: number }[] = [
    { size: '200 ml', ml: 200, caseSize: 48, mrpPaise: 1000 },
    { size: '500 ml', ml: 500, caseSize: 24, mrpPaise: 2000 },
    { size: '750 ml', ml: 750, caseSize: 24, mrpPaise: 4000 },
    { size: '1 L', ml: 1000, caseSize: 24, mrpPaise: 5000 },
    { size: '2 L', ml: 2000, caseSize: 24, mrpPaise: 9000 },
  ]
  return sizes.map((s) => ({
    key: `${flavourKey}-${s.ml}ml`,
    name: s.size,
    netQty: s.ml,
    netUnit: 'ml',
    caseSize: s.caseSize,
    mrpPaise: s.mrpPaise,
    shelfLifeDays: 270,
    hsnCode: '2202',
    gstBps: 2800,
    cessBps: 1200,
  }))
}

const PRODUCTS: ProductDef[] = [
  {
    key: 'campa-cola',
    manufacturerKey: 'reliance',
    brandKey: 'campa',
    name: 'Campa Cola',
    category: 'Beverages',
    variants: campaSizes('campa-cola'),
  },
  {
    key: 'campa-orange',
    manufacturerKey: 'reliance',
    brandKey: 'campa',
    name: 'Campa Orange',
    category: 'Beverages',
    variants: campaSizes('campa-orange'),
  },
  {
    key: 'campa-lemon',
    manufacturerKey: 'reliance',
    brandKey: 'campa',
    name: 'Campa Lemon',
    category: 'Beverages',
    variants: campaSizes('campa-lemon'),
  },
  {
    key: 'independence-water',
    manufacturerKey: 'reliance',
    brandKey: 'independence',
    name: 'Independence Packaged Drinking Water',
    category: 'Beverages',
    variants: [
      {
        key: 'independence-water-1l',
        name: '1 L',
        netQty: 1000,
        netUnit: 'ml',
        caseSize: 24,
        mrpPaise: 2000,
        shelfLifeDays: 365,
        hsnCode: '2202',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'too-yumm-karare',
    manufacturerKey: 'guiltfree',
    brandKey: 'tooyumm',
    name: 'Too Yumm Karare',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'too-yumm-karare-60g',
        name: '60 g',
        netQty: 60,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 180,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'too-yumm-multigrain-chips',
    manufacturerKey: 'guiltfree',
    brandKey: 'tooyumm',
    name: 'Too Yumm Multigrain Chips',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'too-yumm-multigrain-chips-60g',
        name: '60 g',
        netQty: 60,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 180,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'too-yumm-veggie-stix',
    manufacturerKey: 'guiltfree',
    brandKey: 'tooyumm',
    name: 'Too Yumm Veggie Stix',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'too-yumm-veggie-stix-70g',
        name: '70 g',
        netQty: 70,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 180,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'too-yumm-makhana',
    manufacturerKey: 'guiltfree',
    brandKey: 'tooyumm',
    name: 'Too Yumm Makhana Himalayan Salt',
    category: 'Snacks - Makhana',
    variants: [
      {
        key: 'too-yumm-makhana-20g',
        name: '20 g',
        netQty: 20,
        netUnit: 'g',
        caseSize: 90,
        mrpPaise: 2500,
        shelfLifeDays: 270,
        hsnCode: '2008',
        gstBps: 500,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'balaji-simply-salted',
    manufacturerKey: 'balajiwafers',
    brandKey: 'balaji',
    name: 'Balaji Simply Salted Wafers',
    category: 'Snacks - Namkeen',
    variants: [
      {
        key: 'balaji-simply-salted-45g',
        name: '45 g',
        netQty: 45,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 150,
        hsnCode: '2106',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'balaji-masala-masti',
    manufacturerKey: 'balajiwafers',
    brandKey: 'balaji',
    name: 'Balaji Masala Masti Wafers',
    category: 'Snacks - Namkeen',
    variants: [
      {
        key: 'balaji-masala-masti-45g',
        name: '45 g',
        netQty: 45,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 150,
        hsnCode: '2106',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'balaji-chataka-pataka',
    manufacturerKey: 'balajiwafers',
    brandKey: 'balaji',
    name: 'Balaji Chataka Pataka Wafers',
    category: 'Snacks - Namkeen',
    variants: [
      {
        key: 'balaji-chataka-pataka-45g',
        name: '45 g',
        netQty: 45,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 2000,
        shelfLifeDays: 150,
        hsnCode: '2106',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'balaji-ratlami-sev',
    manufacturerKey: 'balajiwafers',
    brandKey: 'balaji',
    name: 'Balaji Ratlami Sev',
    category: 'Snacks - Namkeen',
    variants: [
      {
        key: 'balaji-ratlami-sev-200g',
        name: '200 g',
        netQty: 200,
        netUnit: 'g',
        caseSize: 30,
        mrpPaise: 8000,
        shelfLifeDays: 120,
        hsnCode: '2106',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'mom-makhana-himalayan-salt',
    manufacturerKey: 'mommakhana',
    brandKey: 'mommakhana',
    name: 'MOM Roasted Makhana Himalayan Salt',
    category: 'Snacks - Makhana',
    variants: [
      {
        key: 'mom-makhana-himalayan-salt-12g',
        name: '12 g',
        netQty: 12,
        netUnit: 'g',
        caseSize: 90,
        mrpPaise: 1000,
        shelfLifeDays: 270,
        hsnCode: '2008',
        gstBps: 500,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'mom-makhana-peri-peri',
    manufacturerKey: 'mommakhana',
    brandKey: 'mommakhana',
    name: 'MOM Roasted Makhana Peri Peri',
    category: 'Snacks - Makhana',
    variants: [
      {
        key: 'mom-makhana-peri-peri-60g',
        name: '60 g',
        netQty: 60,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 5000,
        shelfLifeDays: 270,
        hsnCode: '2008',
        gstBps: 500,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'masti-oye-classic-salted',
    manufacturerKey: 'alansfoods',
    brandKey: 'mastioye',
    name: 'Masti Oye Classic Salted',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'masti-oye-classic-salted-30g',
        name: '30 g',
        netQty: 30,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 1000,
        shelfLifeDays: 150,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'masti-oye-tomato-twist',
    manufacturerKey: 'alansfoods',
    brandKey: 'mastioye',
    name: 'Masti Oye Tomato Twist',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'masti-oye-tomato-twist-30g',
        name: '30 g',
        netQty: 30,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 1000,
        shelfLifeDays: 150,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  {
    key: 'masti-oye-peri-peri-twist',
    manufacturerKey: 'alansfoods',
    brandKey: 'mastioye',
    name: 'Masti Oye Peri Peri Twist',
    category: 'Snacks - Chips',
    variants: [
      {
        key: 'masti-oye-peri-peri-twist-30g',
        name: '30 g',
        netQty: 30,
        netUnit: 'g',
        caseSize: 48,
        mrpPaise: 1000,
        shelfLifeDays: 150,
        hsnCode: '1905',
        gstBps: 1800,
        cessBps: 0,
      },
    ],
  },
  ...EXTRA_PRODUCTS,
]

const HSN_RATES: {
  key: string
  hsnCode: string
  description: string
  gstBps: number
  cessBps: number
}[] = [
  {
    key: 'hsn-2202-carbonated',
    hsnCode: '2202',
    description: 'Aerated waters, containing added sugar (Campa)',
    gstBps: 2800,
    cessBps: 1200,
  },
  {
    key: 'hsn-2202-water',
    hsnCode: '2202',
    description: 'Packaged drinking water (Independence)',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-1905',
    hsnCode: '1905',
    description: 'Extruded / expanded savoury snacks',
    gstBps: 1800,
    cessBps: 0,
  },
  {
    key: 'hsn-2106',
    hsnCode: '2106',
    description: 'Namkeen, bhujia, wafers, mixture',
    gstBps: 1800,
    cessBps: 0,
  },
  { key: 'hsn-2008', hsnCode: '2008', description: 'Roasted makhana', gstBps: 500, cessBps: 0 },
  ...EXTRA_HSN_RATES,
]

const ALIASES: { variantKey: string; alias: string; hits: number }[] = [
  { variantKey: 'campa-cola-750ml', alias: 'CAMPA COLA PET 750ML X 24', hits: 41 },
  { variantKey: 'campa-orange-750ml', alias: 'CAMPA ORANGE PET 750ML X 24', hits: 22 },
  { variantKey: 'too-yumm-karare-60g', alias: 'TY!KARARE MASALA 60G_48', hits: 18 },
  { variantKey: 'too-yumm-makhana-20g', alias: 'TY!MAKHANA HIM SALT 20G_90', hits: 9 },
  {
    variantKey: 'mom-makhana-himalayan-salt-12g',
    alias: 'MOM MAKHANA 12G - HIMALAYAN SALT N PAPER X 90',
    hits: 14,
  },
  {
    variantKey: 'balaji-simply-salted-45g',
    alias: 'BALAJI WAFERS SIMPLY SALTED 45G X 90',
    hits: 27,
  },
  { variantKey: 'balaji-ratlami-sev-200g', alias: 'BALAJI RATLAMI SEV 200G X 30', hits: 8 },
  ...EXTRA_ALIASES,
]

export const BRAND_KEYS = BRANDS.map((b) => b.key)

/** The `inner` pack a variant carries (a strip of 12 biscuit packs, a box of 6 chips), if any. */
export const innerPackOf = (v: { key: string; brandKey: string }): number | undefined =>
  INNER_PACK_BY_VARIANT[v.key] ?? INNER_PACK_BY_BRAND[v.brandKey]
export const brandId = (key: string): string => demoId('brand', key)

export interface SeedCatalogOptions {
  /**
   * The distributor named as proposer on the two `proposed` products. Passed by the pilot only; the
   * other tenants' calls leave it out, and their insert is then a no-op on rows that already exist.
   */
  proposerTenantId?: string
}

export async function seedCatalog(db: Db, opts: SeedCatalogOptions = {}): Promise<VariantRow[]> {
  await insertMany(
    db,
    manufacturers,
    MANUFACTURERS.map((m) => ({
      id: demoId('manufacturer', m.key),
      name: m.name,
      legalName: m.legalName,
      fssaiLicense: m.fssaiLicense,
      website: m.website,
    })),
  )

  await insertMany(
    db,
    brands,
    BRANDS.map((b) => ({
      id: demoId('brand', b.key),
      manufacturerId: demoId('manufacturer', b.manufacturerKey),
      name: b.name,
    })),
  )

  await insertMany(
    db,
    products,
    PRODUCTS.map((p) => ({
      id: demoId('product', p.key),
      manufacturerId: demoId('manufacturer', p.manufacturerKey),
      brandId: demoId('brand', p.brandKey),
      name: p.name,
      category: p.category,
      status: p.status ?? 'active',
      proposedByTenantId: p.status === 'proposed' ? (opts.proposerTenantId ?? null) : null,
    })),
  )

  const variants: VariantRow[] = PRODUCTS.flatMap((p) =>
    p.variants.map((v) => ({
      id: demoId('variant', v.key),
      key: v.key,
      productKey: p.key,
      brandKey: p.brandKey,
      manufacturerKey: p.manufacturerKey,
      category: p.category,
      name: `${p.name} ${v.name}`,
      netQty: v.netQty,
      netUnit: v.netUnit,
      defaultCaseSize: v.caseSize,
      hsnCode: v.hsnCode,
      gstBps: v.gstBps,
      cessBps: v.cessBps,
      mrpPaise: v.mrpPaise,
      shelfLifeDays: v.shelfLifeDays,
      status: v.status ?? p.status ?? 'active',
    })),
  )

  await insertMany(
    db,
    productVariants,
    variants.map((v) => ({
      id: v.id,
      productId: demoId('product', v.productKey),
      name: v.name,
      netQty: v.netQty,
      netUnit: v.netUnit,
      defaultCaseSize: v.defaultCaseSize,
      hsnCode: v.hsnCode,
      mrpPaise: v.mrpPaise,
      shelfLifeDays: v.shelfLifeDays,
      status: v.status,
    })),
  )

  const isTooYumm = (v: VariantRow) => v.brandKey === 'tooyumm'

  await insertMany(db, productPacks, [
    ...variants.map((v) => ({
      id: demoId('pack', `${v.key}:piece`),
      variantId: v.id,
      level: 'piece' as const,
      qtyInParent: 1,
    })),
    ...variants.map((v) => ({
      id: demoId('pack', `${v.key}:case`),
      variantId: v.id,
      level: 'case' as const,
      qtyInParent: v.defaultCaseSize,
    })),
    ...variants
      .filter((v) => innerPackOf(v) !== undefined)
      .map((v) => ({
        id: demoId('pack', `${v.key}:inner`),
        variantId: v.id,
        level: 'inner' as const,
        qtyInParent: innerPackOf(v) ?? 12,
      })),
  ])

  await insertMany(db, productExternalCodes, [
    ...variants.filter(isTooYumm).map((v, i) => ({
      id: demoId('external-code', v.key),
      variantId: v.id,
      system: 'field_assist',
      code: `FA-ITEM-${String(i + 1).padStart(4, '0')}`,
    })),
    ...EXTRA_EXTERNAL_CODES.map((c) => ({
      id: demoId('external-code', `${c.system}:${c.variantKey}`),
      variantId: demoId('variant', c.variantKey),
      system: c.system,
      code: c.code,
    })),
  ])

  await insertMany(
    db,
    productAliases,
    ALIASES.map((a) => ({
      id: demoId('alias', a.variantKey),
      variantId: demoId('variant', a.variantKey),
      alias: a.alias,
      normalized: a.alias.toLowerCase(),
      source: 'docint',
      hits: a.hits,
    })),
  )

  await insertMany(
    db,
    hsnRates,
    HSN_RATES.map((h) => ({
      id: demoId('hsn-rate', h.key),
      hsnCode: h.hsnCode,
      description: h.description,
      gstBps: h.gstBps,
      cessBps: h.cessBps,
      effectiveFrom: '2017-07-01',
    })),
  )

  return variants
}
