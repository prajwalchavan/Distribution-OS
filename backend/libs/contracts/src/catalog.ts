import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  GstinSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PhoneSchema,
  QueryBoolSchema,
  QueryIntSchema,
  StateCodeSchema,
} from './common.js'

/**
 * Global product master (ADR 0005) as seen by every app, and the tenant overlay on it. Never carries
 * cost except the two `costs` procedures, which are the desk's alone.
 *
 * WHICH SERVICES MOUNT `catalog` and `tenantCatalog`: all six (the shop browses what it may order).
 * Writes to the tenant overlay — listings, suppliers, costs, brands, pack configs, rep authorisations
 * — are the owner's and the manager's; the accountant reads everything and edits no catalog row
 * (docs/22, 2026-09-05). The three sub-routers at the bottom (`repAuthorisationsContract`,
 * `tenantBrandsContract`, `packConfigsContract`) are mounted under `tenantCatalog` in contract.ts.
 */

export const NetUnitSchema = z.enum(['g', 'kg', 'ml', 'l', 'pcs'])
export const ProductStatusSchema = z.enum(['active', 'proposed', 'merged_into', 'discontinued'])

export const ManufacturerSchema = z.object({
  id: IdSchema,
  name: z.string(),
  legalName: z.string().nullable(),
  gstin: z.string().nullable(),
})
export const BrandSchema = z.object({ id: IdSchema, manufacturerId: IdSchema, name: z.string() })

/** One searchable row: a variant with its product/brand/manufacturer names flattened for lists. */
export const VariantSummarySchema = z.object({
  variantId: IdSchema,
  productId: IdSchema,
  manufacturerId: IdSchema,
  brandId: IdSchema.nullable(),
  name: z.string(),
  productName: z.string(),
  productNameHi: z.string().nullable(),
  brandName: z.string().nullable(),
  manufacturerName: z.string(),
  netQty: z.number().int(),
  netUnit: NetUnitSchema,
  promoExtra: z.number().int().nullable(),
  defaultCaseSize: z.number().int().positive(),
  hsnCode: z.string(),
  ean: z.string().nullable(),
  mrpPaise: PaiseSchema.nullable(),
  status: ProductStatusSchema,
})
export type VariantSummary = z.infer<typeof VariantSummarySchema>

export const CatalogSearchInput = z.object({
  q: z.string().trim().max(80).optional(),
  manufacturerId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  includeProposed: QueryBoolSchema.default(true),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const CatalogSearchOutput = z.object({
  items: z.array(VariantSummarySchema),
  nextCursor: z.string().nullable(),
})

export const ManufacturersListOutput = z.object({
  items: z.array(ManufacturerSchema.extend({ brands: z.array(BrandSchema) })),
})

/** A distributor proposing a product it sells that the global catalog lacks; usable immediately as `proposed`. */
export const ProposeProductInput = MutationBase.extend({
  productId: IdSchema,
  variantId: IdSchema,
  manufacturerId: IdSchema,
  brandId: IdSchema.optional(),
  productName: z.string().trim().min(2).max(120),
  productNameHi: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  variantName: z.string().trim().min(1).max(120),
  netQty: z.number().int().positive(),
  netUnit: NetUnitSchema,
  promoExtra: z.number().int().positive().optional(),
  defaultCaseSize: z.number().int().positive(),
  hsnCode: z.string().regex(/^\d{4,8}$/),
  ean: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional(),
  mrpPaise: PaiseSchema.positive().optional(),
})
export const ProposeProductOutput = z.object({
  productId: IdSchema,
  variantId: IdSchema,
  status: ProductStatusSchema,
})

/** Tenant overlay: what this distributor sells and how it can be ordered. Still no cost. */
export const TenantProductSchema = VariantSummarySchema.extend({
  tenantProductId: IdSchema.nullable(),
  listed: z.boolean(),
  localAlias: z.string().nullable(),
  caseSize: z.number().int().positive(),
  minOrderQty: z.number().int().positive(),
  orderIncrement: z.number().int().positive(),
  maxPerOrder: z.number().int().positive().nullable(),
  sortOrder: z.number().int(),
})
export type TenantProduct = z.infer<typeof TenantProductSchema>

export const TenantCatalogListInput = z.object({
  q: z.string().trim().max(80).optional(),
  listedOnly: QueryBoolSchema.default(true),
  brandId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(200),
  cursor: z.string().optional(),
})
export const TenantCatalogListOutput = z.object({
  items: z.array(TenantProductSchema),
  nextCursor: z.string().nullable(),
})

export const UpsertListingInput = MutationBase.extend({
  id: IdSchema,
  variantId: IdSchema,
  listed: z.boolean().default(true),
  localAlias: z.string().trim().max(80).nullable().optional(),
  caseSizeOverride: z.number().int().positive().nullable().optional(),
  minOrderQty: z.number().int().positive().default(1),
  orderIncrement: z.number().int().positive().default(1),
  maxPerOrder: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().default(0),
})
export const UpsertListingOutput = z.object({ item: TenantProductSchema })

export const SupplierSchema = z.object({
  id: IdSchema,
  name: z.string(),
  gstin: z.string().nullable(),
  stateCode: z.string().nullable(),
  manufacturerId: IdSchema.nullable(),
  phone: z.string().nullable(),
  eInvoicing: z.boolean(),
  paymentTermsDays: z.number().int().nullable(),
  active: z.boolean(),
})
export const SuppliersListOutput = z.object({ items: z.array(SupplierSchema) })
export const UpsertSupplierInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(2).max(120),
  gstin: GstinSchema.nullable().optional(),
  stateCode: StateCodeSchema.nullable().optional(),
  manufacturerId: IdSchema.nullable().optional(),
  phone: PhoneSchema.nullable().optional(),
  eInvoicing: z.boolean().default(false),
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  active: z.boolean().default(true),
})
export const UpsertSupplierOutput = z.object({ item: SupplierSchema })

/** Purchase cost: owner/manager/accountant only, enforced by RLS and by the guard. NEVER reachable by a rep. */
export const ProductCostSchema = z.object({
  id: IdSchema,
  variantId: IdSchema,
  lotId: IdSchema.nullable(),
  supplierId: IdSchema.nullable(),
  purchaseRatePaise: PaiseSchema,
  landedCostPaise: PaiseSchema,
  ptdPaise: PaiseSchema.nullable(),
  schemeMarginBps: BpsSchema.nullable(),
  effectiveFrom: z.string(),
})
export const CostsListInput = z.object({
  variantId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(200),
})
export const CostsListOutput = z.object({ items: z.array(ProductCostSchema) })
export const UpsertCostInput = MutationBase.extend({
  id: IdSchema,
  variantId: IdSchema,
  supplierId: IdSchema.nullable().optional(),
  purchaseRatePaise: PaiseSchema.nonnegative(),
  landedCostPaise: PaiseSchema.nonnegative(),
  ptdPaise: PaiseSchema.nonnegative().nullable().optional(),
  schemeMarginBps: BpsSchema.nullable().optional(),
})
export const UpsertCostOutput = z.object({ item: ProductCostSchema })

// ---------------------------------------------------------------------------------------------------------------
// rep authorisations — which brands each salesperson may sell (docs/02; `rep_product_authorisations`)

/** `manufacturer` = employed by the brand and sells only it; `distributor` = the distributor's own rep on incentive. */
export const EmployedBySchema = z.enum(['distributor', 'manufacturer'])
export type EmployedBy = z.infer<typeof EmployedBySchema>

export const RepAuthorisationSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  brandId: IdSchema,
  brandName: z.string(),
  employedBy: EmployedBySchema,
})
export type RepAuthorisation = z.infer<typeof RepAuthorisationSchema>

/** A salesperson reads only its own (`userId` is forced to the actor); no rows = every listed brand. */
export const RepAuthorisationsListInput = z.object({ userId: IdSchema.optional() })
export const RepAuthorisationsListOutput = z.object({ items: z.array(RepAuthorisationSchema) })

/**
 * REPLACES the rep's set: every brand not in `items` is removed, each listed one upserted under its
 * client-generated row id. An empty list clears the restriction (the rep sells every listed brand).
 */
export const SetRepAuthorisationsInput = MutationBase.extend({
  userId: IdSchema,
  items: z
    .array(
      z.object({
        id: IdSchema,
        brandId: IdSchema,
        employedBy: EmployedBySchema.default('distributor'),
      }),
    )
    .max(50),
})
export const SetRepAuthorisationsOutput = RepAuthorisationsListOutput

// ---------------------------------------------------------------------------------------------------------------
// tenant brands — per-brand operating mode (docs/17 A1; `tenant_brands`)

export const FulfilmentModeSchema = z.enum(['own', 'brand_dms'])
export const TallyExportSourceSchema = z.enum(['dos', 'brand_dms', 'none'])
/**
 * `at_receipt_financial_cn` is the only mode billing implements today (docs/17 §D2: cash discount is
 * reported on the bill and realised at receipt). `on_invoice` is accepted for storage so Too Yumm can
 * be switched later, but nothing deducts on the invoice until that variant is built.
 */
export const CashDiscountModeSchema = z.enum(['on_invoice', 'at_receipt_financial_cn'])
export const ClaimChannelSchema = z.enum(['dos', 'brand_dms'])
export const SalesForceSchema = z.enum(['distributor', 'manufacturer'])

/**
 * How this distributor runs one brand. Too Yumm on FieldAssist is `fulfilmentMode: 'brand_dms'`: our
 * reps must not see it as orderable, Tally must not receive it twice, claims settle in the brand DMS.
 */
export const TenantBrandSchema = z.object({
  id: IdSchema,
  brandId: IdSchema,
  brandName: z.string(),
  manufacturerId: IdSchema,
  fulfilmentMode: FulfilmentModeSchema,
  tallyExportSource: TallyExportSourceSchema,
  cashDiscountMode: CashDiscountModeSchema,
  claimChannel: ClaimChannelSchema,
  salesForce: SalesForceSchema,
})
export type TenantBrand = z.infer<typeof TenantBrandSchema>

export const TenantBrandsListOutput = z.object({ items: z.array(TenantBrandSchema) })

/** One row per brand per tenant (`brandId` is the natural key; `id` is the row's client-generated id on first insert). */
export const UpsertTenantBrandInput = MutationBase.extend({
  id: IdSchema,
  brandId: IdSchema,
  fulfilmentMode: FulfilmentModeSchema.default('own'),
  tallyExportSource: TallyExportSourceSchema.default('dos'),
  cashDiscountMode: CashDiscountModeSchema.default('at_receipt_financial_cn'),
  claimChannel: ClaimChannelSchema.default('dos'),
  salesForce: SalesForceSchema.default('distributor'),
})
export const UpsertTenantBrandOutput = z.object({ item: TenantBrandSchema })

// ---------------------------------------------------------------------------------------------------------------
// supplier pack configs — buy-side pack sizes (docs/17 §B case-size precedence; `supplier_pack_configs`)

/** What the margin is measured against for this supplier's pack: PTD, MRP or the net rate. An enum, never a rate. */
export const MarginBasisSchema = z.enum(['ptd', 'mrp', 'net'])
export type MarginBasis = z.infer<typeof MarginBasisSchema>

/**
 * Guru Kripa "x 90" vs Guiltfree "_120" vs Reliance "CS1": the same variant packs differently per
 * supplier. BUY-SIDE ONLY — procurement and the GRN read it; the sell-side case size is
 * `tenant_products.case_size_override` else the variant default. Carries no rate.
 */
export const SupplierPackConfigSchema = z.object({
  id: IdSchema,
  supplierId: IdSchema,
  variantId: IdSchema,
  pcsPerCase: z.number().int().positive(),
  /** The supplier's own code and description for the pack, exactly as printed on its invoice. */
  supplierCode: z.string().nullable(),
  supplierDescription: z.string().nullable(),
  marginBasis: MarginBasisSchema,
})
export type SupplierPackConfig = z.infer<typeof SupplierPackConfigSchema>

export const PackConfigsListInput = z.object({
  supplierId: IdSchema.optional(),
  variantId: IdSchema.optional(),
  limit: QueryIntSchema.min(1).max(500).default(200),
  cursor: z.string().optional(),
})
export const PackConfigsListOutput = z.object({
  items: z.array(SupplierPackConfigSchema),
  nextCursor: z.string().nullable(),
})

/** One row per supplier per variant (the natural key); the review desk upserts one when it types a case size. */
export const UpsertPackConfigInput = MutationBase.extend({
  id: IdSchema,
  supplierId: IdSchema,
  variantId: IdSchema,
  pcsPerCase: z.number().int().positive().max(10_000),
  supplierCode: z.string().trim().max(40).nullable().optional(),
  supplierDescription: z.string().trim().max(200).nullable().optional(),
  marginBasis: MarginBasisSchema.default('ptd'),
})
export const UpsertPackConfigOutput = z.object({ item: SupplierPackConfigSchema })

// ---------------------------------------------------------------------------------------------------------------
// the sub-routers: mounted in contract.ts under `tenantCatalog` as `repAuthorisations`, `brands`, `packConfigs`

export const repAuthorisationsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/tenant-catalog/rep-authorisations',
      summary: 'Which brands a rep may sell (a salesperson sees only its own)',
    })
    .input(RepAuthorisationsListInput)
    .output(RepAuthorisationsListOutput),
  set: oc
    .route({
      method: 'POST',
      path: '/tenant-catalog/rep-authorisations',
      summary: "Replace a rep's authorised brands (owner/manager)",
    })
    .input(SetRepAuthorisationsInput)
    .output(SetRepAuthorisationsOutput),
}

export const tenantBrandsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/tenant-catalog/brands',
      summary: 'Per-brand operating mode: fulfilment, Tally source, cash discount, claims',
    })
    .output(TenantBrandsListOutput),
  upsert: oc
    .route({
      method: 'POST',
      path: '/tenant-catalog/brands',
      summary: 'Set how this distributor runs a brand (owner/manager)',
    })
    .input(UpsertTenantBrandInput)
    .output(UpsertTenantBrandOutput),
}

export const packConfigsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/tenant-catalog/pack-configs',
      summary: 'Buy-side pack sizes per supplier and variant',
    })
    .input(PackConfigsListInput)
    .output(PackConfigsListOutput),
  upsert: oc
    .route({
      method: 'POST',
      path: '/tenant-catalog/pack-configs',
      summary: 'Set a supplier pack size for a variant (owner/manager)',
    })
    .input(UpsertPackConfigInput)
    .output(UpsertPackConfigOutput),
}
