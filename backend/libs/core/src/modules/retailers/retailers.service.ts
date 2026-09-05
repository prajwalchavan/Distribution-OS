import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gt, gte, ilike, lte, or, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type {
  AssignBeatInput,
  AssignBeatOutput,
  BeatsListInput,
  BeatsListOutput,
  LinkIdentityInput,
  LinkIdentityOutput,
  RecordVisitInput,
  RecordVisitOutput,
  RetailerGetInput,
  RetailerGetOutput,
  RetailersListInput,
  RetailersListOutput,
  SetCreditInput,
  SetCreditOutput,
  UpsertBeatInput,
  UpsertBeatOutput,
  UpsertRetailerInput,
  UpsertRetailerOutput,
  VisitsListInput,
  VisitsListOutput,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  auditLog,
  beatAssignments,
  beats,
  outboxEvents,
  retailerLinks,
  retailers,
  users,
  visits,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { findOrCreateIdentity, nextRetailerCode } from './retailers.helpers.js'
import {
  pickCredit,
  toAssignment,
  toBeat,
  toLink,
  toRetailer,
  toView,
  toVisit,
} from './retailers.mappers.js'

type ListIn = z.infer<typeof RetailersListInput>
type ListOut = z.infer<typeof RetailersListOutput>
type GetIn = z.infer<typeof RetailerGetInput>
type GetOut = z.infer<typeof RetailerGetOutput>
type UpsertIn = z.infer<typeof UpsertRetailerInput>
type UpsertOut = z.infer<typeof UpsertRetailerOutput>
type CreditIn = z.infer<typeof SetCreditInput>
type CreditOut = z.infer<typeof SetCreditOutput>
type LinkIn = z.infer<typeof LinkIdentityInput>
type LinkOut = z.infer<typeof LinkIdentityOutput>
type BeatsIn = z.infer<typeof BeatsListInput>
type BeatsOut = z.infer<typeof BeatsListOutput>
type BeatIn = z.infer<typeof UpsertBeatInput>
type BeatOut = z.infer<typeof UpsertBeatOutput>
type AssignIn = z.infer<typeof AssignBeatInput>
type AssignOut = z.infer<typeof AssignBeatOutput>
type VisitIn = z.infer<typeof RecordVisitInput>
type VisitOut = z.infer<typeof RecordVisitOutput>
type VisitsIn = z.infer<typeof VisitsListInput>
type VisitsOut = z.infer<typeof VisitsListOutput>

/** Roles allowed to update a retailer_identities row (mirrors the `retailer_identities_update` policy). */
/**
 * Review item 27 (docs/17): a salesperson must never learn whether a phone exists in another distributor's
 * network, so identity linking is back-office only. The rep flow only creates the tenant `retailers` row;
 * the identity module links on the retailer's first OTP login.
 */
const ONBOARDERS: readonly ActorRole[] = ['owner', 'manager', 'system']

const CREDIT_KEYS = [
  'tier',
  'creditLimitPaise',
  'creditLimitBills',
  'creditDays',
  'creditMode',
] as const

@Injectable()
export class RetailersService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Staff see every retailer of the tenant; the retailer role only its own linked rows, without code/tier/credit (RLS + toView). */
  async list(input: ListIn): Promise<ListOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        searchPredicate(input.q),
        input.beatId ? eq(retailers.beatId, input.beatId) : undefined,
        input.activeOnly ? eq(retailers.active, true) : undefined,
        input.cursor ? gt(retailers.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(retailers)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(retailers.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map((r) => toView(r, ctx)),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const [row] = await tx.select().from(retailers).where(eq(retailers.id, input.id))
      if (!row) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
      return { item: toView(row, ctx) }
    })
  }

  /** Any staff role creates/updates the shop record; only back-office actors may carry credit fields (else 403). */
  async upsert(input: UpsertIn): Promise<UpsertOut> {
    requireRole(STAFF)
    const ctx = currentTenant()
    const carriesCredit = CREDIT_KEYS.some((k) => input[k] !== undefined)
    if (carriesCredit && !BACK_OFFICE.includes(ctx.actorRole)) {
      throw new ORPCError('FORBIDDEN', {
        message:
          'tier and credit terms can only be set by owner, manager or accountant (use setCredit)',
      })
    }
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const shop = {
          name: input.name,
          ownerName: input.ownerName ?? null,
          phone: input.phone,
          altPhone: input.altPhone ?? null,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          beatId: input.beatId ?? null,
          gstRegType: input.gstRegType,
          gstin: input.gstin ?? null,
          stateCode: input.stateCode,
          paymentTerms: input.paymentTerms,
          cashDiscountBps: input.cashDiscountBps,
          cashDiscountDays: input.cashDiscountDays,
          active: input.active,
        }
        const credit = {
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
          ...(input.creditLimitPaise !== undefined
            ? { creditLimitPaise: input.creditLimitPaise }
            : {}),
          ...(input.creditLimitBills !== undefined
            ? { creditLimitBills: input.creditLimitBills }
            : {}),
          ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
          ...(input.creditMode !== undefined ? { creditMode: input.creditMode } : {}),
        }
        const [existing] = await tx
          .select({ id: retailers.id })
          .from(retailers)
          .where(eq(retailers.id, input.id))
        const [row] = existing
          ? await tx
              .update(retailers)
              .set({ ...shop, ...credit, updatedAt: new Date() })
              .where(eq(retailers.id, input.id))
              .returning()
          : await insertShop(tx, {
              id: input.id,
              tenantId: ctx.tenantId,
              code: await nextRetailerCode(tx, ctx.tenantId),
              onboardedBy: ctx.actorId,
              ...shop,
              ...credit,
            })
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'retailer upsert returned nothing',
          })
        return { item: toRetailer(row) }
      }),
    )
  }

  /** Owner/manager/accountant only. Before/after go to audit_log (credit limit edits are a named sensitive action). */
  async setCredit(input: CreditIn): Promise<CreditOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [before] = await tx.select().from(retailers).where(eq(retailers.id, input.id))
        if (!before) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
        const after = {
          tier: input.tier,
          creditLimitPaise: input.creditLimitPaise,
          creditLimitBills: input.creditLimitBills,
          creditDays: input.creditDays,
          creditMode: input.creditMode,
        }
        const [row] = await tx
          .update(retailers)
          .set({ ...after, updatedAt: new Date() })
          .where(eq(retailers.id, input.id))
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'credit update returned nothing',
          })
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          actorRole: ctx.actorRole,
          action: 'retailer.set_credit',
          entityType: 'retailer',
          entityId: input.id,
          before: pickCredit(before),
          after,
        })
        return { item: toRetailer(row) }
      }),
    )
  }

  /**
   * Rep onboarding (ADR 0006): find or create the global identity for the phone, then link it to this retailer.
   * RLS only shows an identity that is already linked to this tenant (or belongs to the actor), so an existing
   * identity is detected through the unique-phone violation of a plain INSERT inside a savepoint.
   */
  async linkIdentity(input: LinkIn): Promise<LinkOut> {
    requireRole(ONBOARDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [retailer] = await tx.select().from(retailers).where(eq(retailers.id, input.id))
        if (!retailer) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
        const { identity, created } = await findOrCreateIdentity(
          tx,
          input.phone,
          input.shopName ?? retailer.name,
        )
        await tx
          .insert(retailerLinks)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            identityId: identity.id,
            retailerId: retailer.id,
            userId: identity.userId,
            linkedBy: 'rep_onboarding',
            status: 'active',
          })
          .onConflictDoUpdate({
            target: [retailerLinks.tenantId, retailerLinks.identityId, retailerLinks.retailerId],
            set: { userId: identity.userId, status: 'active', updatedAt: new Date() },
          })
        const [link] = await tx
          .select()
          .from(retailerLinks)
          .where(
            and(
              eq(retailerLinks.identityId, identity.id),
              eq(retailerLinks.retailerId, retailer.id),
            ),
          )
        if (!link)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'retailer link vanished after upsert',
          })
        if (retailer.identityId !== identity.id) {
          await tx
            .update(retailers)
            .set({ identityId: identity.id, updatedAt: new Date() })
            .where(eq(retailers.id, retailer.id))
        }
        // identity/tenancy react to this (retailer membership, welcome message) through the outbox, never our tables
        await tx.insert(outboxEvents).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          aggregateType: 'retailer',
          aggregateId: retailer.id,
          eventType: 'retailer.identity_linked',
          payload: {
            retailerId: retailer.id,
            identityId: identity.id,
            userId: identity.userId,
            phone: input.phone,
            linkedBy: 'rep_onboarding',
          },
        })
        return { link: toLink(link), identityCreated: created }
      }),
    )
  }

  async listBeats(input: BeatsIn): Promise<BeatsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await tx
        .select()
        .from(beats)
        .where(input.activeOnly ? eq(beats.active, true) : undefined)
        .orderBy(asc(beats.name))
      return { items: rows.map(toBeat) }
    })
  }

  async upsertBeat(input: BeatIn): Promise<BeatOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const values = {
          name: input.name,
          area: input.area ?? null,
          visitDays: input.visitDays,
          active: input.active,
        }
        const [row] = await tx
          .insert(beats)
          .values({ id: input.id, tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({ target: beats.id, set: { ...values, updatedAt: new Date() } })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'beat upsert returned nothing' })
        return { item: toBeat(row) }
      }),
    )
  }

  async assignBeat(input: AssignIn): Promise<AssignOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [beat] = await tx.select({ id: beats.id }).from(beats).where(eq(beats.id, input.id))
        if (!beat) throw new ORPCError('NOT_FOUND', { message: 'beat not found' })
        // users_visible RLS: a user is readable here only if it is the actor or a member of this tenant
        const [member] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, input.userId))
        if (!member)
          throw new ORPCError('BAD_REQUEST', { message: 'userId is not a member of this tenant' })
        const values = {
          beatId: input.id,
          userId: input.userId,
          validFrom: input.validFrom,
          validTo: input.validTo ?? null,
        }
        const [row] = await tx
          .insert(beatAssignments)
          .values({ id: input.assignmentId, tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({
            target: beatAssignments.id,
            set: { ...values, updatedAt: new Date() },
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'beat assignment returned nothing',
          })
        return { item: toAssignment(row) }
      }),
    )
  }

  /** A rep records their own visit: `userId` is always the actor, whatever the device claims. */
  async recordVisit(input: VisitIn): Promise<VisitOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [retailer] = await tx
          .select({ id: retailers.id })
          .from(retailers)
          .where(eq(retailers.id, input.retailerId))
        if (!retailer) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
        const values = {
          retailerId: input.retailerId,
          beatId: input.beatId ?? null,
          startedAt: new Date(input.startedAt),
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          outcome: input.outcome,
          reason: input.reason ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          note: input.note ?? null,
        }
        const [row] = await tx
          .insert(visits)
          .values({ id: input.id, tenantId: ctx.tenantId, userId: ctx.actorId, ...values })
          .onConflictDoUpdate({ target: visits.id, set: { ...values, updatedAt: new Date() } })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'visit upsert returned nothing' })
        return { item: toVisit(row) }
      }),
    )
  }

  async listVisits(input: VisitsIn): Promise<VisitsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.retailerId ? eq(visits.retailerId, input.retailerId) : undefined,
        input.userId ? eq(visits.userId, input.userId) : undefined,
        input.from ? gte(visits.startedAt, new Date(input.from)) : undefined,
        input.to ? lte(visits.startedAt, new Date(input.to)) : undefined,
      ]
      const rows = await tx
        .select()
        .from(visits)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(visits.startedAt), desc(visits.id))
        .limit(input.limit)
      return { items: rows.map(toVisit) }
    })
  }
}

type ShopRow = typeof retailers.$inferSelect
type NewShop = typeof retailers.$inferInsert

/**
 * Savepoint around the one insert that can still trip a unique index — `UNIQUE(tenant_id, code)` — so a code this
 * tenant already spent (an import, or a series row that lost count) answers 409 instead of a 500, and the failure
 * does not abort the surrounding transaction.
 */
async function insertShop(tx: Db, values: NewShop): Promise<ShopRow[]> {
  let rows: ShopRow[] = []
  try {
    await tx.transaction(async (sp) => {
      rows = await sp.insert(retailers).values(values).returning()
    })
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } }
    if (e.code === '23505' || e.cause?.code === '23505')
      throw new ORPCError('CONFLICT', {
        message: `retailer code ${values.code} is already in use in this distributor; retry the request`,
      })
    throw err
  }
  return rows
}

function searchPredicate(q: string | undefined): SQL | undefined {
  if (!q) return undefined
  const pattern = `%${q.replace(/[%_]/g, '')}%`
  return or(
    ilike(retailers.name, pattern),
    ilike(retailers.ownerName, pattern),
    ilike(retailers.phone, pattern),
    ilike(retailers.code, pattern),
  )
}
