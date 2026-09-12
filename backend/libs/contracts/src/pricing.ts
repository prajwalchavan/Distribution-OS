import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'

/**
 * Pricing (ADR 0008): price lists per tier, retailer overrides, the single `schemes` table, bargains and rep
 * auto-approve bounds. `quote` runs the pure `priceOrder()` engine from @dos/domain with these inputs; the order
 * module and both apps call it. Nothing here carries purchase cost or margin.
 *
 * WHICH SERVICES MOUNT `pricing`: owner, manager, sales, delivery, retailer (not warehouse). The desk —
 * owner and manager, never the accountant (docs/22 2026-09-05) — writes the economics; the rep reads the
 * rates, its own bound (`bounds.list`) and asks for bargains; the SHOP reads its deals (`schemes.list`,
 * filtered to what applies to it and stripped to `SchemePublicSchema`) and the outcome of its own
 * bargain requests (`bargains.list`, RLS narrows to its rows) — docs/23 §8.16.
 */

const TierSchema = z.enum(['A', 'B', 'C', 'D'])
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD')
const CursorInput = {
  limit: QueryIntSchema.min(1).max(500).default(200),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// price lists

export const PriceListItemSchema = z.object({
  id: IdSchema,
  priceListId: IdSchema,
  variantId: IdSchema,
  ratePaise: PaiseSchema,
  inclusiveOfGst: z.boolean(),
})
export type PriceListItem = z.infer<typeof PriceListItemSchema>

export const PriceListSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tier: TierSchema.nullable(),
  isDefault: z.boolean(),
  validFrom: IsoDateSchema.nullable(),
  validTo: IsoDateSchema.nullable(),
  active: z.boolean(),
  items: z.array(PriceListItemSchema),
})
export type PriceList = z.infer<typeof PriceListSchema>

export const PriceListsListInput = z.object({
  activeOnly: QueryBoolSchema.default(false),
  withItems: QueryBoolSchema.default(true),
})
export const PriceListsListOutput = z.object({ items: z.array(PriceListSchema) })

export const UpsertPriceListInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  tier: TierSchema.nullable().optional(),
  isDefault: z.boolean().default(false),
  validFrom: IsoDateSchema.nullable().optional(),
  validTo: IsoDateSchema.nullable().optional(),
  active: z.boolean().default(true),
})
export const UpsertPriceListOutput = z.object({ item: PriceListSchema })

export const SetPriceListItemsInput = MutationBase.extend({
  priceListId: IdSchema,
  items: z
    .array(
      z.object({
        id: IdSchema,
        variantId: IdSchema,
        ratePaise: PaiseSchema.nonnegative(),
        inclusiveOfGst: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(2000),
})
export const SetPriceListItemsOutput = z.object({ item: PriceListSchema })

// ---------------------------------------------------------------------------------------------------------------
// retailer overrides

export const RetailerPriceOverrideSchema = z.object({
  id: IdSchema,
  retailerId: IdSchema,
  variantId: IdSchema,
  ratePaise: PaiseSchema,
  final: z.boolean(),
  validFrom: IsoDateSchema,
  validTo: IsoDateSchema.nullable(),
  approvedBy: IdSchema.nullable(),
  note: z.string().nullable(),
})
export type RetailerPriceOverride = z.infer<typeof RetailerPriceOverrideSchema>

export const OverridesListInput = z.object({
  retailerId: IdSchema.optional(),
  variantId: IdSchema.optional(),
  /** Only overrides valid on this date (default: all). */
  on: IsoDateSchema.optional(),
  ...CursorInput,
})
export const OverridesListOutput = z.object({
  items: z.array(RetailerPriceOverrideSchema),
  nextCursor: z.string().nullable(),
})

export const UpsertOverrideInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema,
  variantId: IdSchema,
  ratePaise: PaiseSchema.nonnegative(),
  /** `final` = no scheme stacks on top of this rate. */
  final: z.boolean().default(false),
  validFrom: IsoDateSchema.optional(),
  validTo: IsoDateSchema.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
})
export const UpsertOverrideOutput = z.object({ item: RetailerPriceOverrideSchema })

// ---------------------------------------------------------------------------------------------------------------
// schemes (the single table read by the engine and by claims)

export const SchemeTriggerKindSchema = z.enum(['qty', 'value', 'mix'])
export const SchemeTriggerUnitSchema = z.enum(['pcs', 'case', 'inr'])
export const SchemeRewardKindSchema = z.enum([
  'free_qty',
  'line_pct',
  'order_pct',
  'cash_discount_pct',
  'net_scheme_amount',
])
export const SchemeFundingSourceSchema = z.enum(['company', 'distributor'])
export const PricingDateModeSchema = z.enum(['order', 'delivery'])

export const SchemeScopeSchema = z
  .object({
    all: z.boolean().optional(),
    brandIds: z.array(IdSchema).max(50).optional(),
    categories: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    variantIds: z.array(IdSchema).max(500).optional(),
  })
  .refine(
    (s) =>
      s.all === true ||
      (s.brandIds?.length ?? 0) > 0 ||
      (s.categories?.length ?? 0) > 0 ||
      (s.variantIds?.length ?? 0) > 0,
    'scope must be `all` or name at least one brand, category or variant',
  )
export const SchemeSlabSchema = z.object({
  /** Same unit as the scheme's `triggerMin` (paise when the unit is `inr`). */
  min: z.number().int().positive(),
  value: z.number().int().nonnegative(),
  freeVariantId: IdSchema.optional(),
})
export const SchemeApplicabilitySchema = z.object({
  tiers: z.array(TierSchema).optional(),
  retailerIds: z.array(IdSchema).max(500).optional(),
  beatIds: z.array(IdSchema).max(100).optional(),
})

const schemeEconomics = {
  scope: SchemeScopeSchema,
  triggerKind: SchemeTriggerKindSchema,
  /** pieces (pcs), whole cases (case), or PAISE of gross in-scope line value (inr). */
  triggerMin: z.number().int().nonnegative(),
  triggerUnit: SchemeTriggerUnitSchema,
  slabs: z.array(SchemeSlabSchema).max(20).nullable(),
  rewardKind: SchemeRewardKindSchema,
  /** free pieces, bps for the pct kinds, paise for net_scheme_amount. */
  rewardValue: z.number().int().nonnegative(),
  freeVariantId: IdSchema.nullable(),
  applicability: SchemeApplicabilitySchema,
  validFrom: IsoDateSchema,
  validTo: IsoDateSchema,
  stackable: z.boolean(),
  final: z.boolean(),
  gstOnFreeGoods: z.boolean(),
  pricingDateMode: PricingDateModeSchema,
}

export const SchemeSchema = z.object({
  id: IdSchema,
  name: z.string(),
  brandId: IdSchema.nullable(),
  ...schemeEconomics,
  version: z.number().int().positive(),
  fundingSource: SchemeFundingSourceSchema,
  claimable: z.boolean(),
  claimWindowDays: z.number().int().nullable(),
  sourceRef: z.string().nullable(),
  active: z.boolean(),
})
export type Scheme = z.infer<typeof SchemeSchema>

/**
 * What the field and the shop see of a scheme: the economics that price an order, and NOT who funds it,
 * whether it is claimable or the brand's circular reference (docs/17 §B security [54–57]: schemes reach
 * rep devices without `funding_source`, `claimable`, `claim_window_days`). `schemes.list` answers this
 * shape to every role outside the back office, and for the retailer role only the schemes whose
 * `applicability` (tier, retailerIds, beatIds) includes that shop.
 */
export const SchemePublicSchema = SchemeSchema.omit({
  fundingSource: true,
  claimable: true,
  claimWindowDays: true,
  sourceRef: true,
})
export type SchemePublic = z.infer<typeof SchemePublicSchema>

/** Union order matters: a back-office row (has `fundingSource`) matches SchemeSchema first. */
export const SchemeViewSchema = z.union([SchemeSchema, SchemePublicSchema])
export type SchemeView = z.infer<typeof SchemeViewSchema>

export const SchemesListInput = z.object({
  activeOnly: QueryBoolSchema.default(true),
  /** Only schemes whose validity window contains this date. */
  on: IsoDateSchema.optional(),
  brandId: IdSchema.optional(),
  ...CursorInput,
})
export const SchemesListOutput = z.object({
  items: z.array(SchemeViewSchema),
  nextCursor: z.string().nullable(),
})

export const UpsertSchemeInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  brandId: IdSchema.nullable().optional(),
  scope: SchemeScopeSchema,
  triggerKind: SchemeTriggerKindSchema,
  /** pieces (pcs), whole cases (case), or PAISE of gross in-scope line value (inr). */
  triggerMin: z.number().int().nonnegative(),
  triggerUnit: SchemeTriggerUnitSchema,
  slabs: z.array(SchemeSlabSchema).max(20).nullable().optional(),
  rewardKind: SchemeRewardKindSchema,
  rewardValue: z.number().int().nonnegative(),
  freeVariantId: IdSchema.nullable().optional(),
  applicability: SchemeApplicabilitySchema.default({}),
  validFrom: IsoDateSchema,
  validTo: IsoDateSchema,
  stackable: z.boolean().default(true),
  final: z.boolean().default(false),
  fundingSource: SchemeFundingSourceSchema.default('company'),
  claimable: z.boolean().default(false),
  claimWindowDays: z.number().int().min(0).max(365).nullable().optional(),
  gstOnFreeGoods: z.boolean().default(false),
  pricingDateMode: PricingDateModeSchema.default('order'),
  sourceRef: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
})
  .refine((s) => s.validFrom <= s.validTo, 'validFrom must not be after validTo')
  .refine(
    (s) =>
      (s.triggerKind === 'qty' && s.triggerUnit !== 'inr') ||
      (s.triggerKind === 'value' && s.triggerUnit === 'inr') ||
      s.triggerKind === 'mix',
    'qty triggers are measured in pcs/case, value triggers in inr',
  )
  .refine(
    (s) =>
      !['line_pct', 'order_pct', 'cash_discount_pct'].includes(s.rewardKind) ||
      BpsSchema.safeParse(s.rewardValue).success,
    'percentage rewards are basis points 0..10000',
  )
export const UpsertSchemeOutput = z.object({ item: SchemeSchema })

// ---------------------------------------------------------------------------------------------------------------
// quote: what an order would cost today (pure engine output)

export const AppliedRuleSchema = z.object({
  ruleId: z.string(),
  version: z.number().int(),
  kind: z.enum(['override', 'scheme', 'bargain', 'manual']),
  rewardKind: z.string().optional(),
  amountPaise: PaiseSchema.optional(),
  freeQty: PiecesSchema.optional(),
  freeVariantId: z.string().optional(),
})
export type AppliedRule = z.infer<typeof AppliedRuleSchema>

export const QuoteInput = z.object({
  retailerId: IdSchema,
  /** Defaults to today (IST). */
  pricingDate: IsoDateSchema.optional(),
  deliveryDate: IsoDateSchema.optional(),
  /** Bargains approved for this order also apply (those without an order always do). */
  orderId: IdSchema.optional(),
  lines: z
    .array(
      z.object({ lineId: z.string().min(1).max(64), variantId: IdSchema, qtyPcs: PiecesSchema }),
    )
    .min(1)
    .max(500),
})
export const QuotedLineSchema = z.object({
  lineId: z.string(),
  variantId: IdSchema,
  qtyPcs: PiecesSchema,
  caseSize: z.number().int().positive(),
  listRatePaise: PaiseSchema,
  ratePaise: PaiseSchema,
  grossPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  bargainPaise: PaiseSchema,
  freeQtyPcs: PiecesSchema,
  freeItems: z.array(
    z.object({
      variantId: IdSchema,
      qtyPcs: PiecesSchema,
      ruleId: z.string(),
      version: z.number().int(),
    }),
  ),
  appliedRules: z.array(AppliedRuleSchema),
  lineNetPaise: PaiseSchema,
})
export type QuotedLine = z.infer<typeof QuotedLineSchema>
export const QuoteOutput = z.object({
  retailerId: IdSchema,
  pricingDate: IsoDateSchema,
  lines: z.array(QuotedLineSchema),
  orderRules: z.array(AppliedRuleSchema),
  /** Conditional cash discount (realised at receipt, ADR 0004): reported, not deducted from `netPaise`. */
  cashDiscountBps: BpsSchema,
  cashDiscountPaise: PaiseSchema,
  totals: z.object({
    grossPaise: PaiseSchema,
    discountPaise: PaiseSchema,
    bargainPaise: PaiseSchema,
    netPaise: PaiseSchema,
  }),
})
export type Quote = z.infer<typeof QuoteOutput>

// ---------------------------------------------------------------------------------------------------------------
// bargains

export const BargainStatusSchema = z.enum([
  'requested',
  'auto_approved',
  'approved',
  'rejected',
  'expired',
])
export const BargainSchema = z.object({
  id: IdSchema,
  retailerId: IdSchema,
  variantId: IdSchema,
  orderId: IdSchema.nullable(),
  requestedBy: IdSchema,
  listRatePaise: PaiseSchema,
  askedRatePaise: PaiseSchema,
  approvedRatePaise: PaiseSchema.nullable(),
  status: BargainStatusSchema,
  decidedBy: IdSchema.nullable(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type Bargain = z.infer<typeof BargainSchema>

export const RequestBargainInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema,
  variantId: IdSchema,
  askedRatePaise: PaiseSchema.nonnegative(),
  /** Lets the rep's per-order cap (`maxOrderDiscountPaise`) be checked; without it that cap needs a decision. */
  qtyPcs: PiecesSchema.optional(),
  orderId: IdSchema.optional(),
  note: z.string().trim().max(200).optional(),
})
export const RequestBargainOutput = z.object({ item: BargainSchema })

export const DecideBargainInput = MutationBase.extend({
  id: IdSchema,
  decision: z.enum(['approve', 'reject']),
  /** Defaults to the asked rate on approve. */
  approvedRatePaise: PaiseSchema.nonnegative().optional(),
  note: z.string().trim().max(200).optional(),
})
export const DecideBargainOutput = z.object({ item: BargainSchema })

export const BargainsListInput = z.object({
  status: BargainStatusSchema.optional(),
  retailerId: IdSchema.optional(),
  ...CursorInput,
})
export const BargainsListOutput = z.object({
  items: z.array(BargainSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// rep auto-approve bounds (owner only)

export const RepBoundSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  brandId: IdSchema.nullable(),
  maxDiscountBps: BpsSchema,
  maxOrderDiscountPaise: PaiseSchema.nullable(),
})
export type RepBound = z.infer<typeof RepBoundSchema>

export const SetBoundInput = MutationBase.extend({
  id: IdSchema,
  userId: IdSchema,
  brandId: IdSchema.nullable().optional(),
  maxDiscountBps: BpsSchema,
  maxOrderDiscountPaise: PaiseSchema.nonnegative().nullable().optional(),
})
export const SetBoundOutput = z.object({ item: RepBoundSchema })

/** A salesperson reads only its own bound (`userId` is forced to the actor); the desk anyone's. */
export const BoundsListInput = z.object({ userId: IdSchema.optional() })
export const BoundsListOutput = z.object({ items: z.array(RepBoundSchema) })

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `pricing: pricingContract` in contract.ts

export const pricingContract = {
  priceLists: {
    list: oc
      .route({
        method: 'GET',
        path: '/pricing/price-lists',
        summary: 'Price lists with their rates',
      })
      .input(PriceListsListInput)
      .output(PriceListsListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/pricing/price-lists',
        summary: 'Create or update a price list',
      })
      .input(UpsertPriceListInput)
      .output(UpsertPriceListOutput),
    setItems: oc
      .route({
        method: 'POST',
        path: '/pricing/price-lists/{priceListId}/items',
        summary: 'Set rates on a price list (upsert per variant)',
      })
      .input(SetPriceListItemsInput)
      .output(SetPriceListItemsOutput),
  },
  overrides: {
    list: oc
      .route({ method: 'GET', path: '/pricing/overrides', summary: 'Retailer-specific rates' })
      .input(OverridesListInput)
      .output(OverridesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/pricing/overrides',
        summary: 'Set a retailer-specific rate',
      })
      .input(UpsertOverrideInput)
      .output(UpsertOverrideOutput),
  },
  schemes: {
    list: oc
      .route({
        method: 'GET',
        path: '/pricing/schemes',
        summary:
          'Schemes (the single table the engine reads; the field and the shop get the public shape)',
      })
      .input(SchemesListInput)
      .output(SchemesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/pricing/schemes',
        summary: 'Create or update a scheme; a change to its economics bumps the version',
      })
      .input(UpsertSchemeInput)
      .output(UpsertSchemeOutput),
  },
  quote: oc
    .route({
      method: 'POST',
      path: '/pricing/quote',
      summary: 'Price an order with the pure engine (no side effects)',
    })
    .input(QuoteInput)
    .output(QuoteOutput),
  bargains: {
    request: oc
      .route({
        method: 'POST',
        path: '/pricing/bargains',
        summary: 'Ask for a lower rate; auto-approved within the rep bound',
      })
      .input(RequestBargainInput)
      .output(RequestBargainOutput),
    decide: oc
      .route({
        method: 'POST',
        path: '/pricing/bargains/{id}/decide',
        summary: 'Approve or reject a bargain (back office)',
      })
      .input(DecideBargainInput)
      .output(DecideBargainOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/pricing/bargains',
        summary: 'Bargain requests (a shop sees the outcome of its own)',
      })
      .input(BargainsListInput)
      .output(BargainsListOutput),
  },
  bounds: {
    set: oc
      .route({
        method: 'POST',
        path: '/pricing/bounds',
        summary: 'How far a rep may discount without asking (owner only)',
      })
      .input(SetBoundInput)
      .output(SetBoundOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/pricing/bounds',
        summary: 'Rep auto-approve bounds (a salesperson sees only its own)',
      })
      .input(BoundsListInput)
      .output(BoundsListOutput),
  },
}
