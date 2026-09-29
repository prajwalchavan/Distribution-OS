import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import {
  PhoneSchema,
  SHOP_SIGN_IN_CODES,
  type GiveShopSignInIn,
  type GiveShopSignInOut,
  type ShopSignIn,
  type ShopSignInOut,
  type ShopSignInPasswordIn,
  type ShopSignInStopIn,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  outboxEvents,
  retailerIdentities,
  retailerLinks,
  retailers,
  withSystem,
  withTenant,
  type Db,
} from '@dos/db'
import {
  currentTenant,
  idempotent,
  lastAuditAt,
  withoutSecrets,
  writeAudit,
} from '../../platform/index.js'
import type { TenancyService } from '../tenancy/index.js'

/**
 * THE SHOP'S APP SIGN-IN (DOS-400; architect's ruling of 2026-09-29, docs/22 §8). The owner or the
 * manager gives a shop its sign-in from the shop's own page, gives it a new first password when it
 * forgot its own, or stops it. Retailers owns the shop, its platform identity and the link from the
 * shop to the login that the row-level rules read (`retailer_links.user_id`); the person's sign-in and
 * this distributor's membership belong to tenancy and are reached only through `TenancyService`.
 *
 * A SHOPKEEPER consists of exactly the rows the demo seed writes for one, made here through services:
 *   users               the person, global, known by the phone (username, argon2id hash, must change)
 *   memberships         role `retailer` in this distributor, active
 *   retailer_identities the shop across the platform, by phone, naming that user
 *   retailer_links      this distributor's shop → that identity, `user_id` = the user, status active
 *   retailers           the shop's `identity_id` (and its mobile, when it had none)
 * plus an `audit_log` row, `auth_events` `password_set_by_admin` when a first password is set, and the
 * `retailer.identity_linked` outbox event the in-app welcome hangs off. No password in any of them.
 */

const GIVE = 'retailer.sign_in.give'
const NEW_PASSWORD = 'retailer.sign_in.password'
const STOP = 'retailer.sign_in.stop'

type ShopRow = typeof retailers.$inferSelect

/** The shop's current sign-in here, with the login behind it. */
interface CurrentSignIn {
  userId: string
  signIn: ShopSignIn
  /** The shopkeeper signs in with a password they chose, not the desk's first one. */
  passwordChosen: boolean
}

/** Is this an Indian mobile a login can be known by? A blank or a landline is not. */
export function isMobile(phone: string | null | undefined): phone is string {
  return typeof phone === 'string' && PhoneSchema.safeParse(phone.trim()).success
}

/**
 * The sign-in of each of these shops at this distributor (the back office's `list` and `get`): the
 * shop's active OWNER link whose login holds an active shopkeeper membership here and a username. A
 * link whose login was stopped here, or never signed in, is no sign-in. Three reads for a whole page.
 */
export async function signInsFor(
  tx: Db,
  tenancy: TenancyService,
  shopIds: readonly string[],
): Promise<Map<string, CurrentSignIn>> {
  const out = new Map<string, CurrentSignIn>()
  const ids = [...new Set(shopIds)]
  if (ids.length === 0) return out
  const { tenantId } = currentTenant()
  const links = await tx
    .select({
      retailerId: retailerLinks.retailerId,
      userId: retailerLinks.userId,
      createdAt: retailerLinks.createdAt,
    })
    .from(retailerLinks)
    .where(
      and(
        eq(retailerLinks.tenantId, tenantId),
        inArray(retailerLinks.retailerId, ids),
        eq(retailerLinks.role, 'owner'),
        eq(retailerLinks.status, 'active'),
        isNotNull(retailerLinks.userId),
      ),
    )
  if (links.length === 0) return out
  const names = await tenancy.shopUsernames(
    tx,
    tenantId,
    links.map((l) => l.userId ?? ''),
  )
  const given = await lastAuditAt(tx, { entityType: 'retailer', action: GIVE, entityIds: ids })
  for (const link of links) {
    if (link.userId === null || out.has(link.retailerId)) continue
    const login = names.get(link.userId)
    if (login === undefined) continue
    const since = given.get(link.retailerId) ?? link.createdAt
    out.set(link.retailerId, {
      userId: link.userId,
      signIn: { username: login.username, since: since.toISOString() },
      passwordChosen: login.passwordChosen,
    })
  }
  return out
}

async function currentSignIn(
  tx: Db,
  tenancy: TenancyService,
  shopId: string,
): Promise<CurrentSignIn | null> {
  return (await signInsFor(tx, tenancy, [shopId])).get(shopId) ?? null
}

/** The shop, locked for the length of the write so two desks giving it a sign-in queue up. */
async function lockShop(tx: Db, id: string): Promise<ShopRow> {
  const [shop] = await tx.select().from(retailers).where(eq(retailers.id, id)).for('update')
  if (!shop) throw new ORPCError('NOT_FOUND', { message: 'This shop is not on your books.' })
  return shop
}

/**
 * The mobile the shop's sign-in is known by: the one the desk typed in the dialog, else the shop's own.
 * The desk types one when the shop has none, or when the shop's own already has a sign-in made at
 * another business (ruling R1: "use another mobile number of the shop"). The shop page has no other
 * place where the desk changes a shop's mobile (QA DOS-428), so a typed number different from the
 * shop's becomes the shop's mobile here (`numbersFor`); it is `newMobile` exactly then.
 */
function mobileFor(
  shop: ShopRow,
  typed: string | undefined,
): { phone: string; newMobile: boolean } {
  const own = isMobile(shop.phone) ? shop.phone.trim() : null
  if (typed !== undefined) return { phone: typed, newMobile: typed !== own }
  if (own === null) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'This shop has no mobile number. Enter the shopkeeper’s mobile number first.',
      data: { code: SHOP_SIGN_IN_CODES.mobileNeeded },
    })
  }
  return { phone: own, newMobile: false }
}

/**
 * Where the shop's numbers go when the desk typed a mobile that is not the shop's (the second check's
 * minor, and DOS-428): the typed mobile becomes the shop's number of record — the one the sign-in, the
 * messages and the matching of shops read — and the number it replaces (a landline, or a mobile whose
 * sign-in another business made) moves to the second number when that is free. When the second number
 * is taken the old one is not kept on the shop, but the audit row of the give keeps it
 * (`before.phone`), so nothing is lost without a trace.
 */
function numbersFor(shop: ShopRow, mobile: string): { phone: string; altPhone?: string } {
  const old = shop.phone.trim()
  const altFree = (shop.altPhone ?? '').trim() === ''
  return old !== '' && old !== mobile && altFree
    ? { phone: mobile, altPhone: old }
    : { phone: mobile }
}

/** What a new login is called: the shopkeeper's name when the shop has one, else the shop's. */
function personName(shop: ShopRow): string {
  const owner = shop.ownerName?.trim() ?? ''
  return owner.length > 0 ? owner : shop.name
}

/** The shop's platform identity by phone, wherever it was made (system: another distributor's is hidden). */
async function identityByPhone(
  sys: Db,
  phone: string,
): Promise<{ id: string; userId: string | null } | null> {
  const [row] = await sys
    .select({ id: retailerIdentities.id, userId: retailerIdentities.userId })
    .from(retailerIdentities)
    .where(eq(retailerIdentities.phone, phone))
    .limit(1)
  return row ?? null
}

/**
 * The identity names its login: made when the phone has none (a first shop), claimed when it names
 * nobody yet. An identity that already names a login keeps it — that login IS the shopkeeper, and
 * `TenancyService.shopLogin` was handed it first.
 */
async function claimIdentity(
  sys: Db,
  input: { phone: string; shopName: string; gstin: string | null; userId: string },
): Promise<string> {
  const found = await identityByPhone(sys, input.phone)
  if (found) {
    if (found.userId === null) {
      await sys
        .update(retailerIdentities)
        .set({ userId: input.userId, updatedAt: new Date() })
        .where(and(eq(retailerIdentities.id, found.id), isNull(retailerIdentities.userId)))
    }
    return found.id
  }
  const id = uuidv7()
  await sys
    .insert(retailerIdentities)
    .values({
      id,
      phone: input.phone,
      userId: input.userId,
      shopName: input.shopName,
      gstin: input.gstin,
    })
    .onConflictDoNothing()
  // A desk elsewhere may have made it a moment ago: the row on the phone is the identity.
  const made = await identityByPhone(sys, input.phone)
  if (!made) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'shop identity vanished' })
  return made.id
}

/** `retailers.signIn.give` — see the contract (`GiveShopSignInInput`) for what each answer means. */
export async function giveSignIn(
  db: Db,
  tenancy: TenancyService,
  input: GiveShopSignInIn,
): Promise<GiveShopSignInOut> {
  const ctx = currentTenant()
  // Hashed before any transaction, as `setStaffPassword` does: argon2id is slow on purpose.
  const passwordHash = await tenancy.hashFirstPassword(input.firstPassword)
  return withTenant(db, ctx, (tx) =>
    // The key is filed without the first password, and the answer never carries one.
    idempotent(tx, input.idempotencyKey, withoutSecrets(input, ['firstPassword']), async () => {
      const shop = await lockShop(tx, input.id)
      const current = await currentSignIn(tx, tenancy, shop.id)
      if (current) {
        return {
          outcome: 'already' as const,
          signIn: current.signIn,
          passwordChosen: current.passwordChosen,
        }
      }
      if (!shop.active) {
        throw new ORPCError('CONFLICT', {
          message: 'This shop is switched off. Switch it on before giving it a sign-in.',
        })
      }
      const { phone, newMobile } = mobileFor(shop, input.phone)
      // Before the person is made (in its own transaction): a clash found after it left a login with
      // a first password nobody was shown, and the next try then read "already has a sign-in".
      await tenancy.refuseTakenMembershipId(input.membershipId)
      const identity = await withSystem(db, (sys) => identityByPhone(sys, phone))
      const login = await tenancy.shopLogin({
        tenantId: ctx.tenantId,
        phone,
        name: personName(shop),
        username: input.username,
        userId: input.userId,
        passwordHash,
        knownUserId: identity?.userId ?? null,
        phoneTyped: newMobile,
      })
      const identityId = await withSystem(db, (sys) =>
        claimIdentity(sys, {
          phone,
          shopName: shop.name,
          gstin: shop.gstin,
          userId: login.userId,
        }),
      )
      await tenancy.joinAsShop(tx, {
        tenantId: ctx.tenantId,
        userId: login.userId,
        membershipId: input.membershipId,
      })
      const now = new Date()
      // One sign-in per shop: a login left on another of the shop's owner links (stopped here, or an
      // old number) stops reaching the shop.
      await tx
        .update(retailerLinks)
        .set({ userId: null, updatedAt: now })
        .where(
          and(
            eq(retailerLinks.tenantId, ctx.tenantId),
            eq(retailerLinks.retailerId, shop.id),
            eq(retailerLinks.role, 'owner'),
            isNotNull(retailerLinks.userId),
            ne(retailerLinks.userId, login.userId),
          ),
        )
      await tx
        .insert(retailerLinks)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          identityId,
          retailerId: shop.id,
          userId: login.userId,
          role: 'owner',
          linkedBy: 'rep_onboarding',
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [retailerLinks.tenantId, retailerLinks.identityId, retailerLinks.retailerId],
          set: { userId: login.userId, role: 'owner', status: 'active', updatedAt: now },
        })
      const numbers = newMobile ? numbersFor(shop, phone) : null
      if (shop.identityId !== identityId || numbers !== null) {
        await tx
          .update(retailers)
          .set({ identityId, ...(numbers ?? {}), updatedAt: now })
          .where(eq(retailers.id, shop.id))
      }
      await writeAudit(tx, {
        action: GIVE,
        entityType: 'retailer',
        entityId: shop.id,
        before: {
          signIn: null,
          ...(numbers !== null ? { phone: shop.phone, altPhone: shop.altPhone } : {}),
        },
        after: {
          userId: login.userId,
          username: login.username,
          newSignIn: login.made,
          ...(numbers ?? {}),
        },
      })
      // The in-app welcome (notifications) hangs off the same event `linkIdentity` emits.
      await tx.insert(outboxEvents).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        aggregateType: 'retailer',
        aggregateId: shop.id,
        eventType: 'retailer.identity_linked',
        payload: {
          retailerId: shop.id,
          identityId,
          userId: login.userId,
          phone,
          linkedBy: 'rep_onboarding',
        },
      })
      const given = await currentSignIn(tx, tenancy, shop.id)
      if (!given)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'the sign-in vanished after it was given',
        })
      return {
        outcome: login.made ? ('created' as const) : ('existing' as const),
        signIn: given.signIn,
        passwordChosen: login.passwordChosen,
      }
    }),
  )
}

/** `retailers.signIn.setPassword` — a new first password; only when the login is this distributor's alone. */
export async function giveNewFirstPassword(
  db: Db,
  tenancy: TenancyService,
  input: ShopSignInPasswordIn,
): Promise<ShopSignInOut> {
  const ctx = currentTenant()
  const passwordHash = await tenancy.hashFirstPassword(input.firstPassword)
  return withTenant(db, ctx, (tx) =>
    idempotent(tx, input.idempotencyKey, withoutSecrets(input, ['firstPassword']), async () => {
      const shop = await lockShop(tx, input.id)
      const current = await currentSignIn(tx, tenancy, shop.id)
      if (!current) {
        throw new ORPCError('CONFLICT', {
          message: 'This shop has no sign-in yet. Give it one first.',
        })
      }
      await tenancy.resetShopPassword({
        tenantId: ctx.tenantId,
        userId: current.userId,
        passwordHash,
      })
      await writeAudit(tx, {
        action: NEW_PASSWORD,
        entityType: 'retailer',
        entityId: shop.id,
        before: null,
        after: { userId: current.userId, username: current.signIn.username },
      })
      return { signIn: current.signIn }
    }),
  )
}

/** `retailers.signIn.stop` — the shop stops seeing this distributor; nothing else moves. */
export async function stopSignIn(
  db: Db,
  tenancy: TenancyService,
  input: ShopSignInStopIn,
): Promise<ShopSignInOut> {
  const ctx = currentTenant()
  return withTenant(db, ctx, (tx) =>
    idempotent(tx, input.idempotencyKey, input, async () => {
      const shop = await lockShop(tx, input.id)
      const current = await currentSignIn(tx, tenancy, shop.id)
      if (!current) return { signIn: null }
      const now = new Date()
      // The row-level rules reach a shop through `retailer_links.user_id`: cleared, the login stops
      // seeing this shop at once. The link, the identity and the shop's books stay as they are.
      await tx
        .update(retailerLinks)
        .set({ userId: null, updatedAt: now })
        .where(
          and(
            eq(retailerLinks.tenantId, ctx.tenantId),
            eq(retailerLinks.retailerId, shop.id),
            eq(retailerLinks.userId, current.userId),
          ),
        )
      // Its LAST shop here: the login no longer signs in to this distributor at all.
      const [another] = await tx
        .select({ id: retailerLinks.id })
        .from(retailerLinks)
        .where(
          and(
            eq(retailerLinks.tenantId, ctx.tenantId),
            eq(retailerLinks.userId, current.userId),
            eq(retailerLinks.status, 'active'),
          ),
        )
        .limit(1)
      if (!another)
        await tenancy.leaveAsShop(tx, { tenantId: ctx.tenantId, userId: current.userId })
      await writeAudit(tx, {
        action: STOP,
        entityType: 'retailer',
        entityId: shop.id,
        before: { userId: current.userId, username: current.signIn.username },
        after: { signIn: null },
      })
      return { signIn: null }
    }),
  )
}
