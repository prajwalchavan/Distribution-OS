import { z } from 'zod'
import { IdSchema, MutationBase, QueryIntSchema } from './common.js'

/**
 * THE SHOPKEEPER IS INDEPENDENT (founder, 2026-09-29, docs/22 §8). A shopkeeper signs up alone (`auth.signUp`),
 * with a mobile number, a username and a password nobody else ever knows, and the account belongs to no distributor.
 * A distributor is ADDED to it, never the other way round: the shopkeeper asks to be joined to a distributor's shop —
 * by the SHOP CODE printed on that distributor's bill, or by picking the distributor by name and naming the shop — and
 * that distributor's owner or manager approves after seeing who asks. Only then does the shopkeeper see that shop's
 * bills, dues and rates. One account, as many distributors as the shop buys from, each joined and left separately.
 *
 * Until a message channel can prove who holds a phone (sign-in by OTP, later), the distributor's approval IS the
 * proof, which is why a request tells the shopkeeper nothing of the distributor but its name and, for a code, the
 * shop's name on its books.
 *
 * TWO HALVES, TWO SERVICES:
 *  - the shopkeeper's half (`auth.joins.*`) is on auth-service, because an account that no distributor has joined
 *    has no distributor's service to call: `lookup`, `distributors`, `ask`, `mine`, `withdraw`, `leave`;
 *  - the desk's half (`retailers.joins.*`) is on the owner's and the manager's services: `list`, `approve`, `refuse`.
 */

export const ShopJoinViaSchema = z.enum(['code', 'name'])
export type ShopJoinVia = z.infer<typeof ShopJoinViaSchema>
export const ShopJoinStateSchema = z.enum(['waiting', 'approved', 'refused', 'withdrawn'])
export type ShopJoinState = z.infer<typeof ShopJoinStateSchema>

/**
 * A shop code as a person may type it; the server reads it (`normalizeShopCode` in @dos/domain). Any length up to 16:
 * a code that cannot be one is answered in words ("No shop has this code…"), not as a malformed request.
 */
export const ShopCodeInputSchema = z.string().trim().min(1).max(16)

/** The shop's name as a person types it. */
export const ShopNameInputSchema = z.string().trim().min(2).max(120)

// ------------------------------------------------------------------------------------------ the shopkeeper's half

/** What a shop code finds, shown back before the shopkeeper asks: the distributor's name and the shop's. */
export const ShopCodeLookupInput = z.object({ code: ShopCodeInputSchema })
export type ShopCodeLookupIn = z.infer<typeof ShopCodeLookupInput>
export const ShopCodeLookupOutput = z.object({
  /** The distributor's own display name. */
  distributor: z.string(),
  /** The shop's name on that distributor's books. */
  shop: z.string(),
})
export type ShopCodeLookupOut = z.infer<typeof ShopCodeLookupOutput>

/** Distributors a shopkeeper may find by name (those that did not switch `shops.listed_for_joining` off). */
export const JoinableDistributorsInput = z.object({
  q: z.string().trim().max(80).optional(),
  limit: QueryIntSchema.min(1).max(50).default(50),
})
export type JoinableDistributorsIn = z.infer<typeof JoinableDistributorsInput>
export const JoinableDistributorSchema = z.object({ tenantId: IdSchema, name: z.string() })
export const JoinableDistributorsOutput = z.object({ items: z.array(JoinableDistributorSchema) })
export type JoinableDistributorsOut = z.infer<typeof JoinableDistributorsOutput>

/**
 * ASK TO BE JOINED. `by: 'code'` with `code` (the shop code on the bill); `by: 'name'` with `tenantId` (picked from
 * `distributors`) and `shopName` (the shop's name as the shopkeeper calls it). `shopName` may also come with a code:
 * it is what the desk reads beside the shop on its books; omitted, the name given at sign-up is used.
 *
 * The same account asking again for the same shop of the same distributor while its request waits gets THAT request
 * back — one request, never two. `id` is the client-generated UUIDv7 of a new request; sent again, it answers the
 * request it made.
 */
export const AskToJoinInput = MutationBase.extend({
  id: IdSchema,
  by: ShopJoinViaSchema,
  code: ShopCodeInputSchema.optional(),
  tenantId: IdSchema.optional(),
  shopName: ShopNameInputSchema.optional(),
})
export type AskToJoinIn = z.infer<typeof AskToJoinInput>

/** One request as its shopkeeper reads it: nothing of the distributor but its name. */
export const MyJoinRequestSchema = z.object({
  id: IdSchema,
  /** The distributor asked, so that an approved one can be opened. */
  tenantId: IdSchema,
  distributor: z.string(),
  /** By code: the shop's name on the distributor's books. By name: the name the shopkeeper typed. */
  shop: z.string(),
  via: ShopJoinViaSchema,
  state: ShopJoinStateSchema,
  /** The line the desk wrote when it refused. */
  reason: z.string().nullable(),
  askedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
})
export type MyJoinRequest = z.infer<typeof MyJoinRequestSchema>
export const MyJoinRequestOutput = z.object({ item: MyJoinRequestSchema })
export type MyJoinRequestOut = z.infer<typeof MyJoinRequestOutput>
export const MyJoinRequestsOutput = z.object({ items: z.array(MyJoinRequestSchema) })
export type MyJoinRequestsOut = z.infer<typeof MyJoinRequestsOutput>

/** Withdraw one of your own requests that still waits. */
export const WithdrawJoinInput = MutationBase.extend({ id: IdSchema })
export type WithdrawJoinIn = z.infer<typeof WithdrawJoinInput>

/**
 * LEAVE A DISTRIBUTOR: the account stops seeing every shop of that distributor, at once; its other distributors are
 * untouched, and the distributor's books (orders, bills, dues) stay. The session that asked moves to another
 * distributor of the account, or to "no distributor yet"; the app then refreshes (`auth.refresh`) to open it. To come
 * back, the shopkeeper asks again and the desk approves again.
 */
export const LeaveDistributorInput = MutationBase.extend({ tenantId: IdSchema })
export type LeaveDistributorIn = z.infer<typeof LeaveDistributorInput>

// ------------------------------------------------------------------------------------------------ the desk's half

/** The shop a request names on this distributor's books. */
export const JoinRequestShopSchema = z.object({
  id: IdSchema,
  name: z.string(),
  /** This distributor's own code for it (R-0001). */
  code: z.string(),
  /** The shop code printed on its bills. */
  shopCode: z.string(),
})

/** One request as the owner or the manager reads it: who asks, and for which shop. */
export const JoinRequestSchema = z.object({
  id: IdSchema,
  personName: z.string(),
  personPhone: z.string(),
  /** The shop's name as the shopkeeper typed it. */
  shopName: z.string(),
  via: ShopJoinViaSchema,
  /** By code: the shop from the start. By name: null until approved. */
  shop: JoinRequestShopSchema.nullable(),
  state: ShopJoinStateSchema,
  reason: z.string().nullable(),
  askedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
})
export type JoinRequest = z.infer<typeof JoinRequestSchema>

export const JoinRequestsListInput = z.object({
  state: ShopJoinStateSchema.default('waiting'),
  limit: QueryIntSchema.min(1).max(200).default(100),
})
export type JoinRequestsListIn = z.infer<typeof JoinRequestsListInput>
export const JoinRequestsListOutput = z.object({
  items: z.array(JoinRequestSchema),
  /** Always null: the waiting list of one distributor is short; `limit` bounds it. */
  nextCursor: z.string().nullable(),
})
export type JoinRequestsListOut = z.infer<typeof JoinRequestsListOutput>

/**
 * APPROVE: the account is joined to the shop — a shopkeeper membership here and the shop's link to that person, the
 * same rows a desk-given sign-in makes. For a request by name `retailerId` says which of this distributor's shops it
 * is (required); for a request by code it may be omitted, and if sent must be the request's own shop. A shop may have
 * more than one shopkeeper account, each its own person: a shop that already signs in keeps its sign-in.
 * `membershipId` is the client-generated UUIDv7 used when the person has no membership here yet.
 */
export const ApproveJoinInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema.optional(),
  membershipId: IdSchema,
})
export type ApproveJoinIn = z.infer<typeof ApproveJoinInput>

/** REFUSE: `reason` is the one line the shopkeeper reads. */
export const RefuseJoinInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(3).max(200),
})
export type RefuseJoinIn = z.infer<typeof RefuseJoinInput>

export const JoinRequestOutput = z.object({ item: JoinRequestSchema })
export type JoinRequestOut = z.infer<typeof JoinRequestOutput>
