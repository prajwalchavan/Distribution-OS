import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, inArray, lt, ne, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type {
  CountGrnInput,
  CountGrnOutput,
  DiscrepanciesListInput,
  DiscrepanciesListOutput,
  GrnGetInput,
  GrnGetOutput,
  GrnsListInput,
  GrnsListOutput,
  GrnWithLines,
  OpenGrnInput,
  OpenGrnOutput,
  PostGrnInput,
  PostGrnOutput,
  ResolveDiscrepancyInput,
  ResolveDiscrepancyOutput,
} from '@dos/contracts'
import { multiply, paise, uuidv7 } from '@dos/domain'
import {
  grnLines,
  grns,
  inboundDiscrepancies,
  locations,
  productVariants,
  supplierInvoiceLines,
  supplierInvoices,
  tenantProductCosts,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  nextDocumentNumber,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { InventoryService, type LedgerEntryInput } from '../inventory/index.js'
import {
  toDiscrepancy,
  toGrn,
  toGrnWithLines,
  type GrnLineRow,
  type GrnRow,
} from './procurement.mappers.js'

type OpenIn = z.infer<typeof OpenGrnInput>
type OpenOut = z.infer<typeof OpenGrnOutput>
type CountIn = z.infer<typeof CountGrnInput>
type CountOut = z.infer<typeof CountGrnOutput>
type PostIn = z.infer<typeof PostGrnInput>
type PostOut = z.infer<typeof PostGrnOutput>
type ListIn = z.infer<typeof GrnsListInput>
type ListOut = z.infer<typeof GrnsListOutput>
type GetIn = z.infer<typeof GrnGetInput>
type GetOut = z.infer<typeof GrnGetOutput>
type DiscIn = z.infer<typeof DiscrepanciesListInput>
type ResolveIn = z.infer<typeof ResolveDiscrepancyInput>
type ResolveOut = z.infer<typeof ResolveDiscrepancyOutput>
type DiscOut = z.infer<typeof DiscrepanciesListOutput>

/** Who counts at the gate. Accountants do not; reps and delivery never see a GRN. */
const COUNTERS: readonly ActorRole[] = ['owner', 'manager', 'warehouse', 'system']
/** Who reads GRNs and discrepancies: the desk plus the gate. These shapes carry pieces only, never a rate. */
const GRN_VIEWERS: readonly ActorRole[] = [...BACK_OFFICE, 'warehouse']

/** Rate after discount spread over the pieces it bought (free pieces make the landed cost cheaper). */
const perPiece = (totalPaise: number, pcs: number): number =>
  pcs > 0 ? multiply(paise(totalPaise), 1 / pcs) : 0

/**
 * GRN = the blind gate count against an approved supplier invoice. Nothing here returns a rate: the count
 * screen shows pieces only. Posting is the commit step of docs/05 (one transaction, idempotent).
 */
@Injectable()
export class GrnService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly inventory: InventoryService,
  ) {}

  /** Expected pieces per line = billed + free. One live GRN per invoice. */
  async open(input: OpenIn): Promise<OpenOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [invoice] = await tx
          .select({ id: supplierInvoices.id, status: supplierInvoices.status })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, input.supplierInvoiceId))
        if (!invoice)
          throw new ORPCError('NOT_FOUND', {
            message: `supplier invoice ${input.supplierInvoiceId} not found`,
          })
        if (invoice.status !== 'approved')
          throw new ORPCError('BAD_REQUEST', {
            message: `supplier invoice must be approved (every line matched) before a GRN opens; it is ${invoice.status}`,
          })
        const [location] = await tx
          .select()
          .from(locations)
          .where(eq(locations.id, input.locationId))
        if (!location || !location.active)
          throw new ORPCError('NOT_FOUND', {
            message: `location ${input.locationId} not found or inactive`,
          })
        if (location.kind === 'damaged')
          throw new ORPCError('BAD_REQUEST', {
            message: 'goods are received into a warehouse or vehicle, not the damaged bin',
          })
        const [live] = await tx
          .select({ id: grns.id, status: grns.status })
          .from(grns)
          .where(and(eq(grns.supplierInvoiceId, invoice.id), ne(grns.status, 'cancelled')))
        if (live)
          throw new ORPCError('CONFLICT', {
            message: `GRN ${live.id} is already ${live.status} for this invoice`,
            data: { grnId: live.id },
          })
        const invoiceLines = await tx
          .select()
          .from(supplierInvoiceLines)
          .where(eq(supplierInvoiceLines.supplierInvoiceId, invoice.id))
          .orderBy(asc(supplierInvoiceLines.lineNo))
        let inserted: typeof grns.$inferSelect | undefined
        try {
          // savepoint: the checks above rule out a second GRN for THIS invoice, but not a client id
          // that already names a GRN on a different one. A primary-key violation here is a duplicate
          // client id — a 409, never a server fault — and it must not abort the whole transaction.
          await tx.transaction(async (sp) => {
            ;[inserted] = await sp
              .insert(grns)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                supplierInvoiceId: invoice.id,
                locationId: location.id,
                status: 'counting',
                note: input.note ?? null,
              })
              .returning()
          })
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ORPCError('CONFLICT', {
              message: `GRN ${input.id} already exists; generate a new id for this receipt`,
            })
          throw err
        }
        if (!inserted)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'grn insert returned nothing' })
        // A `const` copy: `inserted` is assigned inside a closure, so TypeScript drops the narrowing
        // again at the next await.
        const grn = inserted
        const lines = await tx
          .insert(grnLines)
          .values(
            invoiceLines.map((l) => {
              if (!l.variantId)
                throw new ORPCError('BAD_REQUEST', {
                  message: `invoice line ${l.lineNo} is not matched to a variant`,
                })
              return {
                id: uuidv7(),
                tenantId: ctx.tenantId,
                grnId: grn.id,
                supplierInvoiceLineId: l.id,
                variantId: l.variantId,
                expectedQtyPcs: l.qtyPcs + l.freeQtyPcs,
              }
            }),
          )
          .returning()
        return { item: toGrnWithLines(grn, sortById(lines), []) }
      }),
    )
  }

  /**
   * Record the count. `countedQtyPcs` is good pieces; damaged pieces are separate. Discrepancies are recomputed
   * for the counted lines: short = expected − (good + damaged), excess = the reverse, damaged = damaged pieces.
   * No amount is written: warehouse staff must not be able to back out a rate from a discrepancy row.
   */
  async count(input: CountIn): Promise<CountOut> {
    requireRole(COUNTERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const grn = await this.lockGrn(tx, input.id)
        if (grn.status !== 'counting' && grn.status !== 'reconciled')
          throw new ORPCError('BAD_REQUEST', {
            message: `GRN is ${grn.status}; it can no longer be counted`,
          })
        const lines = await this.linesOf(tx, grn.id)
        const byId = new Map(lines.map((l) => [l.id, l]))
        const now = new Date()
        const findings: (typeof inboundDiscrepancies.$inferInsert)[] = []
        for (const c of input.lines) {
          const line = byId.get(c.grnLineId)
          if (!line)
            throw new ORPCError('BAD_REQUEST', {
              message: `line ${c.grnLineId} is not on GRN ${grn.id}`,
            })
          await tx
            .update(grnLines)
            .set({ countedQtyPcs: c.countedQtyPcs, damagedQtyPcs: c.damagedQtyPcs, updatedAt: now })
            .where(eq(grnLines.id, line.id))
          line.countedQtyPcs = c.countedQtyPcs
          line.damagedQtyPcs = c.damagedQtyPcs
          const received = c.countedQtyPcs + c.damagedQtyPcs
          const finding = (kind: 'short' | 'excess' | 'damaged', qtyPcs: number) =>
            findings.push({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              grnId: grn.id,
              grnLineId: line.id,
              kind,
              qtyPcs,
            })
          if (received < line.expectedQtyPcs) finding('short', line.expectedQtyPcs - received)
          if (received > line.expectedQtyPcs) finding('excess', received - line.expectedQtyPcs)
          if (c.damagedQtyPcs > 0) finding('damaged', c.damagedQtyPcs)
        }
        const recounted = input.lines.map((c) => c.grnLineId)
        await tx
          .delete(inboundDiscrepancies)
          .where(
            and(
              eq(inboundDiscrepancies.grnId, grn.id),
              inArray(inboundDiscrepancies.grnLineId, recounted),
              inArray(inboundDiscrepancies.kind, ['short', 'excess', 'damaged']),
              eq(inboundDiscrepancies.status, 'open'),
            ),
          )
        if (findings.length > 0) await tx.insert(inboundDiscrepancies).values(findings)
        const complete = lines.every((l) => l.countedQtyPcs !== null)
        const [updated] = await tx
          .update(grns)
          .set({
            status: complete ? 'reconciled' : 'counting',
            countedBy: ctx.actorId,
            countedAt: now,
            updatedAt: now,
          })
          .where(eq(grns.id, grn.id))
          .returning()
        return { item: await this.view(tx, updated ?? grn) }
      }),
    )
  }

  /**
   * Commit (docs/05 step 11), all in the caller's transaction: lots from the invoice lines (batch/MRP/expiry),
   * `grn` ledger rows (good pieces to the GRN location, damaged to the damaged bin), per-lot purchase cost,
   * GRN number, GRN `posted`, invoice `received`. Re-posting a posted GRN returns it unchanged.
   */
  async post(input: PostIn): Promise<PostOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const grn = await this.lockGrn(tx, input.id)
        if (grn.status === 'posted') return { item: await this.view(tx, grn) }
        if (grn.status !== 'reconciled')
          throw new ORPCError('BAD_REQUEST', {
            message: `GRN is ${grn.status}; count every line before posting`,
          })
        const lines = await this.linesOf(tx, grn.id)
        const invoiceLines = await tx
          .select()
          .from(supplierInvoiceLines)
          .where(eq(supplierInvoiceLines.supplierInvoiceId, grn.supplierInvoiceId))
        const invoiceLineById = new Map(invoiceLines.map((l) => [l.id, l]))
        const [invoice] = await tx
          .select({ supplierId: supplierInvoices.supplierId })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, grn.supplierInvoiceId))
        if (!invoice)
          throw new ORPCError('NOT_FOUND', {
            message: `supplier invoice ${grn.supplierInvoiceId} not found`,
          })
        const [damagedBin] = await tx
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.kind, 'damaged'), eq(locations.active, true)))
          .orderBy(asc(locations.id))
        if (!damagedBin)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'tenant has no damaged location (bootstrap)',
          })
        const variants = await tx
          .select({ id: productVariants.id, mrpPaise: productVariants.mrpPaise })
          .from(productVariants)
          .where(inArray(productVariants.id, [...new Set(lines.map((l) => l.variantId))]))
        const variantMrp = new Map(variants.map((v) => [v.id, v.mrpPaise]))
        const now = new Date()
        const entries: LedgerEntryInput[] = []
        for (const line of lines) {
          const src = line.supplierInvoiceLineId
            ? invoiceLineById.get(line.supplierInvoiceLineId)
            : undefined
          if (!src)
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: `GRN line ${line.id} has no invoice line`,
            })
          const mrpPaise = src.mrpPaise ?? variantMrp.get(line.variantId) ?? null
          if (mrpPaise === null)
            throw new ORPCError('BAD_REQUEST', {
              message: `invoice line ${src.lineNo} has no MRP and the variant has none; set one before posting`,
            })
          const { lot } = await this.inventory.findOrCreateLot(tx, {
            variantId: line.variantId,
            batchNo: src.batchNo,
            mrpPaise,
            mfgDate: src.mfgDate,
            expiryDate: src.expiryDate,
          })
          await tx
            .update(grnLines)
            .set({ lotId: lot.id, updatedAt: now })
            .where(eq(grnLines.id, line.id))
          line.lotId = lot.id
          const good = line.countedQtyPcs ?? 0
          const ref = { reason: 'grn' as const, refType: 'grn', refId: grn.id }
          if (good > 0)
            entries.push({
              ...ref,
              lotId: lot.id,
              locationId: grn.locationId,
              qtyDelta: good,
              idempotencyKey: `grn:${grn.id}:${line.id}:good`,
            })
          if (line.damagedQtyPcs > 0)
            entries.push({
              ...ref,
              lotId: lot.id,
              locationId: damagedBin.id,
              qtyDelta: line.damagedQtyPcs,
              idempotencyKey: `grn:${grn.id}:${line.id}:damaged`,
              note: 'damaged at gate',
            })
          await this.upsertCost(tx, {
            variantId: line.variantId,
            lotId: lot.id,
            supplierId: invoice.supplierId,
            purchaseRatePaise: perPiece(src.taxablePaise, src.qtyPcs),
            landedCostPaise: perPiece(src.taxablePaise, src.qtyPcs + src.freeQtyPcs),
            grnId: grn.id,
          })
        }
        await this.inventory.post(tx, entries)
        const grnNo = grn.grnNo ?? (await nextDocumentNumber(tx, 'GRN', now))
        const [posted] = await tx
          .update(grns)
          .set({ status: 'posted', grnNo, postedBy: ctx.actorId, postedAt: now, updatedAt: now })
          .where(eq(grns.id, grn.id))
          .returning()
        await tx
          .update(supplierInvoices)
          .set({ status: 'received', updatedAt: now })
          .where(eq(supplierInvoices.id, grn.supplierInvoiceId))
        return { item: await this.view(tx, posted ?? grn) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(GRN_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(grns.status, input.status) : undefined,
        input.supplierInvoiceId ? eq(grns.supplierInvoiceId, input.supplierInvoiceId) : undefined,
        input.cursor ? lt(grns.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(grns)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(grns.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toGrn)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(GRN_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const [grn] = await tx.select().from(grns).where(eq(grns.id, input.id))
      if (!grn) throw new ORPCError('NOT_FOUND', { message: `GRN ${input.id} not found` })
      return { item: await this.view(tx, grn) }
    })
  }

  async discrepancies(input: DiscIn): Promise<DiscOut> {
    requireRole(GRN_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.grnId ? eq(inboundDiscrepancies.grnId, input.grnId) : undefined,
        input.status ? eq(inboundDiscrepancies.status, input.status) : undefined,
        input.kind ? eq(inboundDiscrepancies.kind, input.kind) : undefined,
        input.cursor ? lt(inboundDiscrepancies.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(inboundDiscrepancies)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(inboundDiscrepancies.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toDiscrepancy)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /**
   * The desk's decision on a gate-count finding (docs/23 §8.19; the owner's "GRN exceptions" queue):
   * `accepted`, `claimed`, `credited` or `written_off`, from `open` or `claimed` only. Owner and
   * manager, never the accountant (docs/22 2026-09-05: no approvals). Audited.
   */
  async resolveDiscrepancy(input: ResolveIn): Promise<ResolveOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [row] = await tx
          .select()
          .from(inboundDiscrepancies)
          .where(eq(inboundDiscrepancies.id, input.id))
          .for('update')
        if (!row) throw new ORPCError('NOT_FOUND', { message: `discrepancy ${input.id} not found` })
        if (row.status === input.status) return { item: toDiscrepancy(row) }
        if (row.status !== 'open' && row.status !== 'claimed')
          throw new ORPCError('CONFLICT', {
            message: `discrepancy ${row.id} is ${row.status}; only an open or claimed finding is decided`,
          })
        const now = new Date()
        const [updated] = await tx
          .update(inboundDiscrepancies)
          .set({
            status: input.status,
            note: input.note ?? row.note,
            resolvedBy: ctx.actorId,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(eq(inboundDiscrepancies.id, row.id))
          .returning()
        await writeAudit(tx, {
          action: 'discrepancy.resolve',
          entityType: 'inbound_discrepancy',
          entityId: row.id,
          before: { status: row.status },
          after: { status: input.status, note: input.note ?? null },
        })
        return { item: toDiscrepancy(updated ?? row) }
      }),
    )
  }

  /** Per-lot cost row (owner/manager/accountant only under RLS). One row per (variant, lot); later GRNs of the same lot update it. */
  private async upsertCost(
    tx: Db,
    c: {
      variantId: string
      lotId: string
      supplierId: string
      purchaseRatePaise: number
      landedCostPaise: number
      grnId: string
    },
  ): Promise<void> {
    const { tenantId } = currentTenant()
    const now = new Date()
    const [existing] = await tx
      .select({ id: tenantProductCosts.id })
      .from(tenantProductCosts)
      .where(
        and(
          eq(tenantProductCosts.tenantId, tenantId),
          eq(tenantProductCosts.variantId, c.variantId),
          eq(tenantProductCosts.lotId, c.lotId),
        ),
      )
    const values = {
      supplierId: c.supplierId,
      purchaseRatePaise: c.purchaseRatePaise,
      landedCostPaise: c.landedCostPaise,
      updatedFromGrnId: c.grnId,
      effectiveFrom: now,
      updatedAt: now,
    }
    if (existing) {
      await tx.update(tenantProductCosts).set(values).where(eq(tenantProductCosts.id, existing.id))
      return
    }
    await tx
      .insert(tenantProductCosts)
      .values({ id: uuidv7(), tenantId, variantId: c.variantId, lotId: c.lotId, ...values })
  }

  private async lockGrn(tx: Db, id: string): Promise<GrnRow> {
    const [grn] = await tx.select().from(grns).where(eq(grns.id, id)).for('update')
    if (!grn) throw new ORPCError('NOT_FOUND', { message: `GRN ${id} not found` })
    return grn
  }

  private async linesOf(tx: Db, grnId: string): Promise<GrnLineRow[]> {
    return tx.select().from(grnLines).where(eq(grnLines.grnId, grnId)).orderBy(asc(grnLines.id))
  }

  private async view(tx: Db, grn: GrnRow): Promise<GrnWithLines> {
    const lines = await this.linesOf(tx, grn.id)
    const findings = await tx
      .select()
      .from(inboundDiscrepancies)
      .where(eq(inboundDiscrepancies.grnId, grn.id))
      .orderBy(asc(inboundDiscrepancies.id))
    return toGrnWithLines(grn, lines, findings)
  }
}

function sortById(rows: GrnLineRow[]): GrnLineRow[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}
