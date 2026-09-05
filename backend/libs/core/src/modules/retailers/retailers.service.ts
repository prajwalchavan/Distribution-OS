import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gt, gte, ilike, isNull, lte, or, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type {
  AssignBeatInput,
  AssignBeatOutput,
  BeatAssignmentsListInput,
  BeatAssignmentsListOutput,
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
  UpdateOwnRetailerInput,
  UpdateOwnRetailerOutput,
  UpsertBeatInput,
  UpsertBeatOutput,
  UpsertRetailerInput,
  UpsertRetailerOutput,
  VisitsListInput,
  VisitsListOutput,
} from '@dos/contracts'
import { businessDate, uuidv7 } from '@dos/domain'
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
  currentTenant,
  DB,
  idempotent,
  isPrivilegeViolation,
  MANAGEMENT,
  pgMessage,
  requireDb,
  requireRole,
  STAFF,
  writeAudit,
} from '../../platform/index.js'
import {
  deactivateRetailer,
  findBeatByName,
  linkExternalCode,
  matchRetailer,
  recordPurchaseHistory,
  removeExternalCodes,
  removePurchaseHistory,
  restoreRetailer,
  retailerLabels,
  upsertRetailerFromImport,
  type PurchaseHistoryRow,
  type RetailerImportResult,
  type RetailerImportValues,
  type RetailerMatch,
  type RetailerProbe,
  type RetailerSnapshot,
} from './import.js'
import { findOrCreateIdentity, nextRetailerCode } from './retailers.helpers.js'
import {
  pickCredit,
  toAssignment,
  toBeat,
  toLink,
  toPublic,
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
type AssignmentsIn = z.infer<typeof BeatAssignmentsListInput>
type AssignmentsOut = z.infer<typeof BeatAssignmentsListOutput>
type UpdateOwnIn = z.infer<typeof UpdateOwnRetailerInput>
type UpdateOwnOut = z.infer<typeof UpdateOwnRetailerOutput>

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

  // =============================================================================================================
  // the surface the generic importer calls (coordination §3.9 / §4: integrations → retailers), inside
  // the caller's transaction. Thin delegations to `import.ts`; nothing here sets a credit term.
  // =============================================================================================================

  /** Exact external code → phone → GSTIN → one clear trigram name; two close names are never picked. */
  matchRetailer(tx: Db, probe: RetailerProbe, limit?: number): Promise<RetailerMatch> {
    return matchRetailer(tx, probe, limit)
  }

  /** Create or update a shop from a party-master row; returns the `before` snapshot an update replaced. */
  upsertFromImport(
    tx: Db,
    input: { retailerId: string | null; newId: string; values: RetailerImportValues },
  ): Promise<RetailerImportResult> {
    return upsertRetailerFromImport(tx, input)
  }

  restoreFromImport(tx: Db, id: string, before: RetailerSnapshot): Promise<void> {
    return restoreRetailer(tx, id, before)
  }

  deactivateFromImport(tx: Db, id: string): Promise<void> {
    return deactivateRetailer(tx, id)
  }

  /** `external_party_codes`: "code X in system S is this shop" (docs/17 A7). */
  linkExternalCode(
    tx: Db,
    input: { id?: string | undefined; system: string; code: string; retailerId: string },
  ): Promise<{ id: string; created: boolean; previousRetailerId: string | null }> {
    return linkExternalCode(tx, input)
  }

  removeExternalCodes(tx: Db, ids: readonly string[]): Promise<number> {
    return removeExternalCodes(tx, ids)
  }

  /** `retailer_purchase_history` (docs/17 A11): migrated bill lines, no ledger effect. */
  recordPurchaseHistory(tx: Db, rows: readonly PurchaseHistoryRow[]): Promise<number> {
    return recordPurchaseHistory(tx, rows)
  }

  removePurchaseHistory(tx: Db, importJobId: string): Promise<number> {
    return removePurchaseHistory(tx, importJobId)
  }

  findBeatByName(tx: Db, name: string): Promise<string | null> {
    return findBeatByName(tx, name)
  }

  labels(tx: Db, ids: readonly string[]): ReturnType<typeof retailerLabels> {
    return retailerLabels(tx, ids)
  }

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

  /**
   * Any staff role creates/updates the shop record; only the owner and the manager may carry credit
   * fields (else 403 — the accountant sets no credit terms, docs/22 2026-09-05; the database trigger
   * `dos_retailers_guard` refuses the same on every path).
   */
  async upsert(input: UpsertIn): Promise<UpsertOut> {
    requireRole(STAFF)
    const ctx = currentTenant()
    const carriesCredit = CREDIT_KEYS.some((k) => input[k] !== undefined)
    if (carriesCredit && !MANAGEMENT.includes(ctx.actorRole)) {
      throw new ORPCError('FORBIDDEN', {
        message:
          'tier and credit terms can only be set by the owner or the manager (use setCredit)',
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

  /** Owner/manager only (docs/22 2026-09-05: no credit limits for the accountant). Before/after go to audit_log. */
  async setCredit(input: CreditIn): Promise<CreditOut> {
    requireRole(MANAGEMENT)
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

  /** Beats are the desk's to create (docs/23 §8.14): a rep, a loader or a driver may not. */
  async upsertBeat(input: BeatIn): Promise<BeatOut> {
    requireRole(ONBOARDERS)
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
    requireRole(ONBOARDERS)
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

  /**
   * Who is on which beat (docs/23 §8.14): the rep's home screen learns TODAY's beat from here. A
   * salesperson is forced to itself whatever `userId` says; the desk reads anyone's. `currentOnly`
   * keeps the assignments valid on `on` (default today, IST).
   */
  async listAssignments(input: AssignmentsIn): Promise<AssignmentsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const on = input.on ?? businessDate().date
    const userId = ctx.actorRole === 'salesperson' ? ctx.actorId : input.userId
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(beatAssignments.tenantId, ctx.tenantId),
        input.beatId ? eq(beatAssignments.beatId, input.beatId) : undefined,
        userId ? eq(beatAssignments.userId, userId) : undefined,
        input.currentOnly ? lte(beatAssignments.validFrom, on) : undefined,
        input.currentOnly
          ? or(isNull(beatAssignments.validTo), gte(beatAssignments.validTo, on))
          : undefined,
      ]
      const rows = await tx
        .select({ assignment: beatAssignments, beatName: beats.name, userName: users.name })
        .from(beatAssignments)
        .innerJoin(beats, eq(beats.id, beatAssignments.beatId))
        .innerJoin(users, eq(users.id, beatAssignments.userId))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(beats.name), desc(beatAssignments.validFrom), asc(beatAssignments.id))
        .limit(input.limit)
      return {
        items: rows.map((r) => ({
          ...toAssignment(r.assignment),
          beatName: r.beatName,
          userName: r.userName,
        })),
      }
    })
  }

  /**
   * The shop edits its own contact and GST details from the retailer app (R11, docs/23 §8.14): never
   * the name of record, the beat, the tier or a paisa of credit — the database trigger
   * `dos_retailers_guard` says the same for every column the wire does not carry. A shop not linked
   * to the caller is NOT_FOUND (RLS hides it), never a hint that it exists. Audited.
   */
  async updateOwn(input: UpdateOwnIn): Promise<UpdateOwnOut> {
    requireRole(['retailer'])
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [before] = await tx.select().from(retailers).where(eq(retailers.id, input.id))
        if (!before) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
        const [link] = await tx
          .select({ id: retailerLinks.id })
          .from(retailerLinks)
          .where(
            and(
              eq(retailerLinks.tenantId, ctx.tenantId),
              eq(retailerLinks.retailerId, input.id),
              eq(retailerLinks.userId, ctx.actorId),
              eq(retailerLinks.status, 'active'),
            ),
          )
          .limit(1)
        if (!link) throw new ORPCError('NOT_FOUND', { message: 'retailer not found' })
        const patch = {
          ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
          ...(input.altPhone !== undefined ? { altPhone: input.altPhone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
          ...(input.gstRegType !== undefined ? { gstRegType: input.gstRegType } : {}),
        }
        let row: typeof retailers.$inferSelect | undefined
        try {
          ;[row] = await tx
            .update(retailers)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(retailers.id, input.id))
            .returning()
        } catch (error) {
          if (isPrivilegeViolation(error))
            throw new ORPCError('FORBIDDEN', { message: pgMessage(error) })
          throw error
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'retailer update returned nothing',
          })
        await writeAudit(tx, {
          action: 'retailer.update_own',
          entityType: 'retailer',
          entityId: input.id,
          before: {
            ownerName: before.ownerName,
            altPhone: before.altPhone,
            address: before.address,
            gstin: before.gstin,
            gstRegType: before.gstRegType,
          },
          after: patch,
        })
        return { item: toPublic(row) }
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
