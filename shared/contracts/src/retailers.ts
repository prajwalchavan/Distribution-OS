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
 * Retailers (ADR 0006): the distributor's private record of a shop, its beats, PJP visits and the link to the
 * global retailer identity. Credit, tier and code are NEVER visible to or writable by the retailer role.
 */

export const RetailerTierSchema = z.enum(['A', 'B', 'C', 'D'])
export const CreditModeSchema = z.enum(['indicate', 'strict', 'stop'])
export const PaymentTermsSchema = z.enum(['PRE', 'ON', 'POST_FULFILLMENT'])
export const GstRegTypeSchema = z.enum(['unregistered', 'regular', 'composition'])
export const RetailerLinkSourceSchema = z.enum(['rep_onboarding', 'directory_optin', 'import'])
export const RetailerLinkStatusSchema = z.enum(['pending', 'active', 'blocked'])
export const VisitOutcomeSchema = z.enum([
  'ordered',
  'no_order',
  'closed',
  'not_found',
  'payment_only',
])

/** Free-form Indian shop address; unknown keys are kept so imports can carry what they have. */
export const AddressSchema = z.looseObject({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  landmark: z.string().max(120).optional(),
  area: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  pincode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})
export type Address = z.infer<typeof AddressSchema>

/**
 * What the retailer role may see of its own record: no code, no tier, no credit terms.
 * `list`/`get` return this shape when the caller is a retailer, and RetailerSchema (below) for staff;
 * clients discriminate with `'code' in item`. Payment terms and cash discount stay visible because the
 * shop must know whether it has to prepay and what it earns by paying early.
 */
export const RetailerPublicSchema = z.object({
  id: IdSchema,
  name: z.string(),
  ownerName: z.string().nullable(),
  phone: z.string(),
  altPhone: z.string().nullable(),
  address: AddressSchema.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  beatId: IdSchema.nullable(),
  gstRegType: GstRegTypeSchema,
  gstin: z.string().nullable(),
  stateCode: z.string(),
  paymentTerms: PaymentTermsSchema,
  cashDiscountBps: BpsSchema,
  cashDiscountDays: z.number().int(),
  active: z.boolean(),
})
export type RetailerPublic = z.infer<typeof RetailerPublicSchema>

/** Staff view: the public fields plus code, tier, credit terms and the identity link. */
export const RetailerSchema = RetailerPublicSchema.extend({
  code: z.string(),
  identityId: IdSchema.nullable(),
  tier: RetailerTierSchema,
  creditLimitPaise: PaiseSchema,
  creditLimitBills: z.number().int(),
  creditDays: z.number().int(),
  creditMode: CreditModeSchema,
  onboardedBy: IdSchema.nullable(),
})
export type Retailer = z.infer<typeof RetailerSchema>

/** Union order matters: a staff row (has `code`) matches RetailerSchema first; a retailer-role row only matches the public shape. */
export const RetailerViewSchema = z.union([RetailerSchema, RetailerPublicSchema])
export type RetailerView = z.infer<typeof RetailerViewSchema>

export const RetailersListInput = z.object({
  q: z.string().trim().max(80).optional(),
  beatId: IdSchema.optional(),
  activeOnly: QueryBoolSchema.default(true),
  limit: QueryIntSchema.min(1).max(500).default(100),
  cursor: z.string().optional(),
})
export const RetailersListOutput = z.object({
  items: z.array(RetailerViewSchema),
  nextCursor: z.string().nullable(),
})

export const RetailerGetInput = z.object({ id: IdSchema })
export const RetailerGetOutput = z.object({ item: RetailerViewSchema })

/**
 * Create or update a retailer (any staff role). `code` is server-assigned on insert (R-0001, ADR 0001).
 * Optional non-credit fields are replaced (omitted = null). The credit block (tier, limit, bills, days, mode)
 * is back-office only: a salesperson/delivery actor sending any of them gets 403; when omitted the row keeps
 * its defaults (insert) or current values (update). Use `setCredit` for credit changes.
 */
export const UpsertRetailerInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().max(120).nullable().optional(),
  phone: PhoneSchema,
  altPhone: PhoneSchema.nullable().optional(),
  address: AddressSchema.nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  beatId: IdSchema.nullable().optional(),
  gstRegType: GstRegTypeSchema.default('unregistered'),
  gstin: GstinSchema.nullable().optional(),
  stateCode: StateCodeSchema,
  paymentTerms: PaymentTermsSchema.default('POST_FULFILLMENT'),
  cashDiscountBps: BpsSchema.default(0),
  cashDiscountDays: z.number().int().min(0).max(365).default(0),
  active: z.boolean().default(true),
  // back-office only (see above)
  tier: RetailerTierSchema.optional(),
  creditLimitPaise: PaiseSchema.nonnegative().optional(),
  creditLimitBills: z.number().int().min(0).optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  creditMode: CreditModeSchema.optional(),
})
export const UpsertRetailerOutput = z.object({ item: RetailerSchema })

/** Owner/manager/accountant only; every change is written to audit_log. */
export const SetCreditInput = MutationBase.extend({
  id: IdSchema,
  tier: RetailerTierSchema,
  creditLimitPaise: PaiseSchema.nonnegative(),
  creditLimitBills: z.number().int().min(0),
  creditDays: z.number().int().min(0).max(365),
  creditMode: CreditModeSchema,
})
export const SetCreditOutput = z.object({ item: RetailerSchema })

export const RetailerLinkSchema = z.object({
  id: IdSchema,
  retailerId: IdSchema,
  identityId: IdSchema,
  /** Copy of the identity's login user; null until the shop claims a login. RLS for the retailer role keys on it. */
  userId: IdSchema.nullable(),
  linkedBy: RetailerLinkSourceSchema,
  status: RetailerLinkStatusSchema,
})
export type RetailerLink = z.infer<typeof RetailerLinkSchema>

/** Find-or-create the global identity for `phone` and link it to this retailer (rep onboarding). */
export const LinkIdentityInput = MutationBase.extend({
  id: IdSchema,
  phone: PhoneSchema,
  shopName: z.string().trim().min(2).max(120).optional(),
})
export const LinkIdentityOutput = z.object({
  link: RetailerLinkSchema,
  identityCreated: z.boolean(),
})

export const BeatSchema = z.object({
  id: IdSchema,
  name: z.string(),
  area: z.string().nullable(),
  /** ISO weekdays (1 = Monday ... 7 = Sunday) this beat is normally visited. */
  visitDays: z.array(z.number().int().min(1).max(7)),
  active: z.boolean(),
})
export type Beat = z.infer<typeof BeatSchema>

export const BeatsListInput = z.object({ activeOnly: QueryBoolSchema.default(true) })
export const BeatsListOutput = z.object({ items: z.array(BeatSchema) })
export const UpsertBeatInput = MutationBase.extend({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  area: z.string().trim().max(120).nullable().optional(),
  visitDays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  active: z.boolean().default(true),
})
export const UpsertBeatOutput = z.object({ item: BeatSchema })

export const BeatAssignmentSchema = z.object({
  id: IdSchema,
  beatId: IdSchema,
  userId: IdSchema,
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
})
export type BeatAssignment = z.infer<typeof BeatAssignmentSchema>

/** `id` in the path is the beat; `userId` must be a member of the tenant. */
export const AssignBeatInput = MutationBase.extend({
  id: IdSchema,
  assignmentId: IdSchema,
  userId: IdSchema,
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable().optional(),
})
export const AssignBeatOutput = z.object({ item: BeatAssignmentSchema })

export const VisitSchema = z.object({
  id: IdSchema,
  retailerId: IdSchema,
  userId: IdSchema,
  beatId: IdSchema.nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  outcome: VisitOutcomeSchema.nullable(),
  reason: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  note: z.string().nullable(),
})
export type Visit = z.infer<typeof VisitSchema>

/** A salesperson records their own visit; `userId` is always the actor. Devices send local offsets, hence `offset: true`. */
export const RecordVisitInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema,
  beatId: IdSchema.nullable().optional(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  outcome: VisitOutcomeSchema,
  reason: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
export const RecordVisitOutput = z.object({ item: VisitSchema })

export const VisitsListInput = z.object({
  retailerId: IdSchema.optional(),
  userId: IdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: QueryIntSchema.min(1).max(500).default(100),
})
export const VisitsListOutput = z.object({ items: z.array(VisitSchema) })

/** Mounted in contract.ts as `retailers: retailersContract`. */
export const retailersContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/retailers',
      summary: 'Retailers of this distributor (retailer role: only its own, without credit)',
    })
    .input(RetailersListInput)
    .output(RetailersListOutput),
  get: oc
    .route({
      method: 'GET',
      path: '/retailers/{id}',
      summary: 'One retailer (retailer role: only its own, without credit)',
    })
    .input(RetailerGetInput)
    .output(RetailerGetOutput),
  upsert: oc
    .route({
      method: 'POST',
      path: '/retailers',
      summary: 'Create or update a retailer; code is server-assigned',
    })
    .input(UpsertRetailerInput)
    .output(UpsertRetailerOutput),
  setCredit: oc
    .route({
      method: 'POST',
      path: '/retailers/{id}/credit',
      summary: 'Set tier and credit terms (owner/manager/accountant only)',
    })
    .input(SetCreditInput)
    .output(SetCreditOutput),
  linkIdentity: oc
    .route({
      method: 'POST',
      path: '/retailers/{id}/link',
      summary: 'Link the retailer to its global identity by phone',
    })
    .input(LinkIdentityInput)
    .output(LinkIdentityOutput),
  beats: {
    list: oc
      .route({ method: 'GET', path: '/beats', summary: 'Beats of this distributor' })
      .input(BeatsListInput)
      .output(BeatsListOutput),
    upsert: oc
      .route({ method: 'POST', path: '/beats', summary: 'Create or update a beat' })
      .input(UpsertBeatInput)
      .output(UpsertBeatOutput),
    assign: oc
      .route({
        method: 'POST',
        path: '/beats/{id}/assign',
        summary: 'Assign a salesperson to a beat for a date range',
      })
      .input(AssignBeatInput)
      .output(AssignBeatOutput),
  },
  visits: {
    record: oc
      .route({ method: 'POST', path: '/visits', summary: 'Record a shop visit (own)' })
      .input(RecordVisitInput)
      .output(RecordVisitOutput),
    list: oc
      .route({ method: 'GET', path: '/visits', summary: 'Visits by retailer / rep / period' })
      .input(VisitsListInput)
      .output(VisitsListOutput),
  },
}
