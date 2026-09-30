import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type {
  ApproveJoinIn,
  JoinRequest,
  JoinRequestOut,
  JoinRequestsListIn,
  JoinRequestsListOut,
  RefuseJoinIn,
  ShopJoinVia,
} from '@dos/contracts'
import { normalizeShopCode, uuidv7 } from '@dos/domain'
import {
  outboxEvents,
  retailerIdentities,
  retailerLinks,
  retailers,
  shopJoinRequests,
  users,
  withSystem,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { currentTenant, idempotent, isUniqueViolation, writeAudit } from '../../platform/index.js'
import type { TenancyService } from '../tenancy/index.js'
import { lockShop } from './sign-in.js'

/**
 * THE SHOPKEEPER ASKS, THE DESK DECIDES (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent").
 *
 * A shopkeeper who signed up alone owns an account that no distributor has joined. It asks to be joined to a
 * distributor's shop — by the shop code printed on that distributor's bill, or by picking the distributor by name
 * and typing the shop's name — and that distributor's owner or manager approves after reading who asks. The approval
 * writes EXACTLY the rows a desk-given sign-in writes for a shopkeeper (`sign-in.ts`): a shopkeeper membership here
 * (`TenancyService.joinAsShop`), the shop's platform identity by phone, and the shop's link to that person
 * (`retailer_links.user_id`, which every row-level rule of the shop role reads). Nothing of the distributor is
 * readable by the account before that link exists.
 *
 * A SHOP MAY HAVE MORE THAN ONE SHOPKEEPER ACCOUNT, EACH ITS OWN PERSON (architect's rule): approving a request never
 * touches the shop's other links, so a shop that already signs in (a desk-given sign-in, or an earlier approval)
 * keeps it, and each person reaches the shop through their own link on their own phone's identity.
 *
 * The shopkeeper's half runs from auth-service (the account has no distributor's service to call), with the
 * account's own id as the actor and the shopkeeper role, in NO distributor (`app.tenant_id = ''`): the policies of
 * `shop_join_requests` then show it its own requests and nothing else. The desk's half runs in the distributor's
 * own tenant context, under the owner's or the manager's role.
 */

const NO_SUCH_CODE = 'No shop has this code. Check the code on your bill.'
const ALREADY_JOINED = 'You are already joined to this shop.'
const REPEATED_REQUEST =
  'This could not be saved: it repeats an earlier request. Close this and try again.'
const NOT_ON_YOUR_LIST = 'This request is not on your list.'
const PICK_THE_SHOP = 'Choose which of your shops this is before approving.'
const OTHER_SHOP =
  'This request names another shop. Approve it for the shop it names, or refuse it.'
const SHOP_OFF = 'This shop is switched off. Switch it on before joining a shopkeeper to it.'
const ACCOUNT_OFF = 'This account is switched off, so it cannot be joined to a shop.'
const LINK_TAKEN =
  'This shop already signs in on this mobile number with another person’s account. Refuse the request, or stop that sign-in first.'

const decided = {
  approved: 'This request was approved already.',
  refused: 'This request was refused already.',
  withdrawn: 'The shopkeeper withdrew this request.',
} as const

type JoinRow = typeof shopJoinRequests.$inferSelect

/** The account's own context: its own id, the shopkeeper role, and no distributor at all. */
export function accountContext(userId: string): TenantContext {
  return { tenantId: '', actorId: userId, actorRole: 'retailer' }
}

// --------------------------------------------------------------------------------------------- the shopkeeper's half

/** The shop a code names: a shop that is switched on. Null for everything else, with one answer for all of it. */
export async function shopByCode(
  sys: Db,
  typed: string,
): Promise<{ tenantId: string; retailerId: string; shopName: string } | null> {
  const code = normalizeShopCode(typed)
  if (code === null) return null
  const [row] = await sys
    .select({ tenantId: retailers.tenantId, retailerId: retailers.id, shopName: retailers.name })
    .from(retailers)
    .where(and(eq(retailers.shopCode, code), eq(retailers.active, true)))
    .limit(1)
  return row ?? null
}

/** The refusal for a code that names no shop (or one that is switched off): the same sentence for both. */
export function noSuchCode(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message: NO_SUCH_CODE })
}

export interface FileJoinRequest {
  id: string
  userId: string
  tenantId: string
  via: ShopJoinVia
  retailerId: string | null
  shopName: string
  personName: string
  personPhone: string
}

/**
 * File the account's request, or answer the one it already has: the same person asking again for the same shop of
 * the same distributor while a request waits gets that request (`shop_join_requests_waiting_idx`), and the same `id`
 * sent again answers the request it made. Under the account's own context, so the row-level rules decide what it
 * reads and what it may file (its own name and number, waiting, undecided).
 */
export async function fileJoinRequest(db: Db, input: FileJoinRequest): Promise<JoinRow> {
  return withTenant(db, accountContext(input.userId), async (tx) => {
    const [again] = await tx
      .select()
      .from(shopJoinRequests)
      .where(eq(shopJoinRequests.id, input.id))
      .limit(1)
    if (again) {
      const same =
        again.userId === input.userId &&
        again.tenantId === input.tenantId &&
        again.via === input.via &&
        (input.retailerId === null || again.retailerId === input.retailerId)
      if (!same) throw new ORPCError('CONFLICT', { message: REPEATED_REQUEST })
      return again
    }
    if (input.retailerId !== null) {
      // The account reads its own links in any distributor (`retailer_links_read`: user_id = actor).
      const [joined] = await tx
        .select({ id: retailerLinks.id })
        .from(retailerLinks)
        .where(
          and(
            eq(retailerLinks.tenantId, input.tenantId),
            eq(retailerLinks.retailerId, input.retailerId),
            eq(retailerLinks.userId, input.userId),
            eq(retailerLinks.status, 'active'),
          ),
        )
        .limit(1)
      if (joined) throw new ORPCError('CONFLICT', { message: ALREADY_JOINED })
    }
    const waiting = await waitingRequest(tx, input)
    if (waiting) return waiting
    try {
      // Savepoint: a request filed a moment ago by the same account must not abort the transaction.
      await tx.transaction(async (sp) => {
        await sp.insert(shopJoinRequests).values({
          id: input.id,
          tenantId: input.tenantId,
          userId: input.userId,
          via: input.via,
          retailerId: input.retailerId,
          shopName: input.shopName,
          personName: input.personName,
          personPhone: input.personPhone,
          state: 'waiting',
        })
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const raced = await waitingRequest(tx, input)
      if (raced) return raced
      throw new ORPCError('CONFLICT', { message: REPEATED_REQUEST })
    }
    const [made] = await tx
      .select()
      .from(shopJoinRequests)
      .where(eq(shopJoinRequests.id, input.id))
      .limit(1)
    if (!made) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'the request vanished' })
    return made
  })
}

async function waitingRequest(
  tx: Db,
  input: { tenantId: string; userId: string; retailerId: string | null },
): Promise<JoinRow | undefined> {
  const [row] = await tx
    .select()
    .from(shopJoinRequests)
    .where(
      and(
        eq(shopJoinRequests.tenantId, input.tenantId),
        eq(shopJoinRequests.userId, input.userId),
        eq(shopJoinRequests.state, 'waiting'),
        input.retailerId === null
          ? isNull(shopJoinRequests.retailerId)
          : eq(shopJoinRequests.retailerId, input.retailerId),
      ),
    )
    .limit(1)
  return row
}

/** The account's own requests, newest first (bounded: a shop asks a handful of distributors, not thousands). */
export async function myJoinRequests(db: Db, userId: string, limit = 50): Promise<JoinRow[]> {
  return withTenant(db, accountContext(userId), (tx) =>
    tx
      .select()
      .from(shopJoinRequests)
      .where(eq(shopJoinRequests.userId, userId))
      .orderBy(desc(shopJoinRequests.createdAt), desc(shopJoinRequests.id))
      .limit(limit),
  )
}

/**
 * The names of the shops the account's own requests BY CODE name, as the distributors keep them — which is all the
 * account learned when it typed the code. Read as the system role, for those shops only.
 */
export async function shopNamesOf(sys: Db, rows: readonly JoinRow[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows.filter((r) => r.via === 'code' && r.retailerId !== null).map((r) => r.retailerId ?? ''),
    ),
  ]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const shops = await sys
    .select({ id: retailers.id, name: retailers.name })
    .from(retailers)
    .where(inArray(retailers.id, ids))
  for (const shop of shops) out.set(shop.id, shop.name)
  return out
}

/**
 * Withdraw one of the account's own waiting requests. Sent again for a request that is already withdrawn (or
 * refused) it answers the request as it is; an approved one cannot be withdrawn — the account leaves the
 * distributor instead.
 */
export async function withdrawJoin(db: Db, userId: string, id: string): Promise<JoinRow> {
  return withTenant(db, accountContext(userId), async (tx) => {
    const [row] = await tx
      .select()
      .from(shopJoinRequests)
      .where(and(eq(shopJoinRequests.id, id), eq(shopJoinRequests.userId, userId)))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: 'This request is not one of yours.' })
    if (row.state === 'approved') {
      throw new ORPCError('CONFLICT', {
        message:
          'This distributor has already joined you to the shop. To stop seeing it, leave the distributor from Settings.',
      })
    }
    if (row.state !== 'waiting') return row
    const [done] = await tx
      .update(shopJoinRequests)
      .set({ state: 'withdrawn', updatedAt: new Date() })
      .where(and(eq(shopJoinRequests.id, id), eq(shopJoinRequests.state, 'waiting')))
      .returning()
    return done ?? row
  })
}

/**
 * THE SHOPKEEPER LEAVES A DISTRIBUTOR: every link of this account to a shop of that distributor stops reaching it,
 * at once (the row-level rules read `retailer_links.user_id`). The links, the identity and the shop's books stay.
 * Run as the system role by auth, which also switches the membership off. Answers how many links it cut.
 */
export async function cutShopLinks(
  sys: Db,
  input: { tenantId: string; userId: string },
): Promise<number> {
  const cut = await sys
    .update(retailerLinks)
    .set({ userId: null, updatedAt: new Date() })
    .where(and(eq(retailerLinks.tenantId, input.tenantId), eq(retailerLinks.userId, input.userId)))
    .returning({ id: retailerLinks.id })
  return cut.length
}

// ----------------------------------------------------------------------------------------------------- the desk's half

const shopColumns = {
  id: retailers.id,
  name: retailers.name,
  code: retailers.code,
  shopCode: retailers.shopCode,
}

function toJoinRequest(
  row: JoinRow,
  shop: { id: string; name: string; code: string; shopCode: string } | null,
): JoinRequest {
  return {
    id: row.id,
    personName: row.personName,
    personPhone: row.personPhone,
    shopName: row.shopName,
    via: row.via,
    shop,
    state: row.state,
    reason: row.reason,
    askedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  }
}

async function shopOf(
  tx: Db,
  retailerId: string | null,
): Promise<{ id: string; name: string; code: string; shopCode: string } | null> {
  if (retailerId === null) return null
  const [shop] = await tx
    .select(shopColumns)
    .from(retailers)
    .where(eq(retailers.id, retailerId))
    .limit(1)
  return shop ?? null
}

/** `retailers.joins.list`: this distributor's requests in one state; waiting ones oldest first. */
export async function listJoinRequests(
  db: Db,
  input: JoinRequestsListIn,
): Promise<JoinRequestsListOut> {
  const ctx = currentTenant()
  return withTenant(db, ctx, async (tx) => {
    const rows = await tx
      .select({ request: shopJoinRequests, shop: shopColumns })
      .from(shopJoinRequests)
      .leftJoin(retailers, eq(retailers.id, shopJoinRequests.retailerId))
      .where(
        and(eq(shopJoinRequests.tenantId, ctx.tenantId), eq(shopJoinRequests.state, input.state)),
      )
      .orderBy(
        input.state === 'waiting'
          ? asc(shopJoinRequests.createdAt)
          : desc(shopJoinRequests.createdAt),
        asc(shopJoinRequests.id),
      )
      .limit(input.limit)
    return {
      items: rows.map((r) => toJoinRequest(r.request, r.shop?.id ? r.shop : null)),
      nextCursor: null,
    }
  })
}

async function lockRequest(tx: Db, id: string): Promise<JoinRow> {
  const [row] = await tx
    .select()
    .from(shopJoinRequests)
    .where(eq(shopJoinRequests.id, id))
    .for('update')
  if (!row) throw new ORPCError('NOT_FOUND', { message: NOT_ON_YOUR_LIST })
  return row
}

/**
 * The identity this person's link to the shop hangs on: their own phone's. Made (naming them) when the phone has
 * none; CLAIMED only when it names nobody and no other distributor links it — an identity another distributor keeps
 * for its own shop is used as it is, unclaimed, so an approval here never lets the account read that distributor's
 * record of the shop. The link itself carries the person (`retailer_links.user_id`), which is what every rule reads.
 */
async function identityFor(
  sys: Db,
  input: {
    tenantId: string
    phone: string
    userId: string
    shopName: string
    gstin: string | null
  },
): Promise<string> {
  const [found] = await sys
    .select({ id: retailerIdentities.id, userId: retailerIdentities.userId })
    .from(retailerIdentities)
    .where(eq(retailerIdentities.phone, input.phone))
    .limit(1)
  if (found) {
    if (found.userId === null) {
      const [elsewhere] = await sys
        .select({ id: retailerLinks.id })
        .from(retailerLinks)
        .where(
          and(eq(retailerLinks.identityId, found.id), ne(retailerLinks.tenantId, input.tenantId)),
        )
        .limit(1)
      if (!elsewhere) {
        await sys
          .update(retailerIdentities)
          .set({ userId: input.userId, updatedAt: new Date() })
          .where(and(eq(retailerIdentities.id, found.id), isNull(retailerIdentities.userId)))
      }
    }
    return found.id
  }
  await sys
    .insert(retailerIdentities)
    .values({
      id: uuidv7(),
      phone: input.phone,
      userId: input.userId,
      shopName: input.shopName,
      gstin: input.gstin,
    })
    .onConflictDoNothing()
  const [made] = await sys
    .select({ id: retailerIdentities.id })
    .from(retailerIdentities)
    .where(eq(retailerIdentities.phone, input.phone))
    .limit(1)
  if (!made) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'shop identity vanished' })
  return made.id
}

/** `retailers.joins.approve` — see `ApproveJoinInput` for what it does and the rows it writes. */
export async function approveJoin(
  db: Db,
  tenancy: TenancyService,
  input: ApproveJoinIn,
): Promise<JoinRequestOut> {
  const ctx = currentTenant()
  return withTenant(db, ctx, (tx) =>
    idempotent(tx, input.idempotencyKey, input, async () => {
      const request = await lockRequest(tx, input.id)
      if (request.state === 'approved') {
        return { item: toJoinRequest(request, await shopOf(tx, request.retailerId)) }
      }
      if (request.state !== 'waiting') {
        throw new ORPCError('CONFLICT', { message: decided[request.state] })
      }
      if (
        request.retailerId !== null &&
        input.retailerId !== undefined &&
        input.retailerId !== request.retailerId
      ) {
        throw new ORPCError('BAD_REQUEST', { message: OTHER_SHOP })
      }
      const shopId = request.retailerId ?? input.retailerId
      if (shopId === undefined) throw new ORPCError('BAD_REQUEST', { message: PICK_THE_SHOP })
      const shop = await lockShop(tx, shopId)
      if (!shop.active) throw new ORPCError('CONFLICT', { message: SHOP_OFF })
      const person = await withSystem(db, async (sys) => {
        const [row] = await sys
          .select({ id: users.id, phone: users.phone, status: users.status })
          .from(users)
          .where(eq(users.id, request.userId))
          .limit(1)
        return row ?? null
      })
      if (!person || person.status !== 'active') {
        throw new ORPCError('CONFLICT', { message: ACCOUNT_OFF })
      }
      // Before anything is written: a membership id the app sent twice is refused in words.
      await tenancy.refuseTakenMembershipId(input.membershipId)
      const identityId = await withSystem(db, (sys) =>
        identityFor(sys, {
          tenantId: ctx.tenantId,
          phone: person.phone,
          userId: person.id,
          shopName: shop.name,
          gstin: shop.gstin,
        }),
      )
      // The shopkeeper membership here, made or switched back on; a person who WORKS here is refused in words.
      await tenancy.joinAsShop(tx, {
        tenantId: ctx.tenantId,
        userId: person.id,
        membershipId: input.membershipId,
      })
      const now = new Date()
      // The person's own link to the shop. The shop's other links — another shopkeeper's account, a desk-given
      // sign-in — are not touched: a shop may have more than one shopkeeper account, each its own person.
      const [linked] = await tx
        .insert(retailerLinks)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          identityId,
          retailerId: shop.id,
          userId: person.id,
          role: 'owner',
          // The shop itself asked to be linked, from its own app.
          linkedBy: 'directory_optin',
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [retailerLinks.tenantId, retailerLinks.identityId, retailerLinks.retailerId],
          set: { userId: person.id, status: 'active', updatedAt: now },
          setWhere: sql`${retailerLinks.userId} IS NULL OR ${retailerLinks.userId} = ${person.id}`,
        })
        .returning({ id: retailerLinks.id })
      if (!linked) throw new ORPCError('CONFLICT', { message: LINK_TAKEN })
      if (shop.identityId === null) {
        await tx
          .update(retailers)
          .set({ identityId, updatedAt: now })
          .where(eq(retailers.id, shop.id))
      }
      const [approved] = await tx
        .update(shopJoinRequests)
        .set({
          state: 'approved',
          retailerId: shop.id,
          decidedBy: ctx.actorId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(shopJoinRequests.id, request.id), eq(shopJoinRequests.state, 'waiting')))
        .returning()
      if (!approved) throw new ORPCError('CONFLICT', { message: decided.approved })
      await writeAudit(tx, {
        action: 'retailer.shop_join.approve',
        entityType: 'retailer',
        entityId: shop.id,
        before: null,
        after: { requestId: request.id, userId: person.id, via: request.via },
      })
      // The in-app welcome hangs off the same event a desk-given sign-in emits (no message channel is on).
      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        aggregateType: 'retailer',
        aggregateId: shop.id,
        eventType: 'retailer.identity_linked',
        payload: {
          retailerId: shop.id,
          identityId,
          userId: person.id,
          phone: person.phone,
          linkedBy: 'directory_optin',
        },
      })
      return { item: toJoinRequest(approved, await shopOf(tx, shop.id)) }
    }),
  )
}

/** `retailers.joins.refuse` — the request is refused with the one line the shopkeeper reads. */
export async function refuseJoin(db: Db, input: RefuseJoinIn): Promise<JoinRequestOut> {
  const ctx = currentTenant()
  return withTenant(db, ctx, (tx) =>
    idempotent(tx, input.idempotencyKey, input, async () => {
      const request = await lockRequest(tx, input.id)
      if (request.state === 'refused') {
        return { item: toJoinRequest(request, await shopOf(tx, request.retailerId)) }
      }
      if (request.state !== 'waiting') {
        throw new ORPCError('CONFLICT', { message: decided[request.state] })
      }
      const now = new Date()
      const [refused] = await tx
        .update(shopJoinRequests)
        .set({
          state: 'refused',
          reason: input.reason,
          decidedBy: ctx.actorId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(shopJoinRequests.id, request.id), eq(shopJoinRequests.state, 'waiting')))
        .returning()
      if (!refused) throw new ORPCError('CONFLICT', { message: decided.refused })
      await writeAudit(tx, {
        action: 'retailer.shop_join.refuse',
        entityType: 'shop_join_request',
        entityId: request.id,
        before: null,
        after: { userId: request.userId, reason: input.reason },
      })
      return { item: toJoinRequest(refused, await shopOf(tx, request.retailerId)) }
    }),
  )
}

/** The shop code of each of these shops of the current distributor (the bill prints it beside the shop's name). */
export async function shopCodesOf(
  tx: Db,
  retailerIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(retailerIds)]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await tx
    .select({ id: retailers.id, shopCode: retailers.shopCode })
    .from(retailers)
    .where(and(inArray(retailers.id, ids), isNotNull(retailers.shopCode)))
  for (const row of rows) out.set(row.id, row.shopCode)
  return out
}
