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

/** Global product master (ADR 0005) as seen by every app. Never carries cost. */

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
