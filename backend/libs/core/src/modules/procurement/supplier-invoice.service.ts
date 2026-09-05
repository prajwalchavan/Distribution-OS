import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type {
  CancelSupplierInvoiceInput,
  CancelSupplierInvoiceOutput,
  CreateSupplierInvoiceInput,
  CreateSupplierInvoiceOutput,
  DisputeSupplierInvoiceInput,
  DisputeSupplierInvoiceOutput,
  MatchLineInput,
  MatchLineOutput,
  PurchaseOrdersListInput,
  PurchaseOrdersListOutput,
  SupplierInvoiceGetInput,
  SupplierInvoiceGetOutput,
  SupplierInvoicesListInput,
  SupplierInvoicesListOutput,
  UpsertPurchaseOrderInput,
  UpsertPurchaseOrderOutput,
} from '@dos/contracts'
import { multiply, paise, sum, uuidv7, type Paise } from '@dos/domain'
import {
  grns,
  productVariants,
  purchaseOrders,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPackConfigs,
  withTenant,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { pgConstraint } from '../inventory/index.js'
import {
  toInvoice,
  toInvoiceWithLines,
  toPurchaseOrder,
  type InvoiceLineRow,
  type InvoiceRow,
} from './procurement.mappers.js'

type DisputeIn = z.infer<typeof DisputeSupplierInvoiceInput>
type DisputeOut = z.infer<typeof DisputeSupplierInvoiceOutput>
type CancelIn = z.infer<typeof CancelSupplierInvoiceInput>
type CancelOut = z.infer<typeof CancelSupplierInvoiceOutput>
type CreateIn = z.infer<typeof CreateSupplierInvoiceInput>
type CreateOut = z.infer<typeof CreateSupplierInvoiceOutput>
type ListIn = z.infer<typeof SupplierInvoicesListInput>
type ListOut = z.infer<typeof SupplierInvoicesListOutput>
type GetIn = z.infer<typeof SupplierInvoiceGetInput>
type GetOut = z.infer<typeof SupplierInvoiceGetOutput>
type MatchIn = z.infer<typeof MatchLineInput>
type MatchOut = z.infer<typeof MatchLineOutput>
type PoIn = z.infer<typeof UpsertPurchaseOrderInput>
type PoOut = z.infer<typeof UpsertPurchaseOrderOutput>
type PoListIn = z.infer<typeof PurchaseOrdersListInput>
type PoListOut = z.infer<typeof PurchaseOrdersListOutput>

/** `CreateSupplierInvoiceInput` plus the printed rate basis per line (docs/17 A4), for in-transaction callers. */
export type CreateInTxInput = Omit<CreateIn, 'lines'> & {
  lines: (CreateIn['lines'][number] & {
    rateBasis?: 'piece' | 'case' | undefined
    basisQty?: number | undefined
  })[]
}

const CASE_UNITS = /^(cs|case|cases|ctn|carton|cartons|box|boxes|bx)$/i

/** Everything here carries rates, so every procedure is back office; RLS on the tables says the same. */
@Injectable()
export class SupplierInvoiceService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Record a reviewed invoice. The header must add up: Σ line totals + freight + round-off = total (to the paisa).
   * Status is `approved` when every line already resolved to a variant (docint match + review), else `in_review`
   * until `matchLine` closes the gaps. A duplicate IRN or (supplier, number, date) is refused with the existing id.
   */
  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.createInTx(tx, input)),
    )
  }

  /**
   * The same booking inside a caller's transaction — docint's `documents.approve` (coordination §4:
   * "the header-total check and the IRN/(supplier, no, date) duplicate refusal are procurement's, and
   * must apply unchanged"). A line may carry the printed `rateBasis` / `basisQty` (docs/17 A4); the
   * HTTP procedure's lines default to per piece. Creates the DRAFT only — never a GRN, lot or cost.
   */
  async createInTx(tx: Db, input: CreateInTxInput): Promise<CreateOut> {
    requireRole(BACK_OFFICE)
    const ctx = currentTenant()
    const expected = sum([
      ...input.lines.map((l) => paise(l.lineTotalPaise)),
      paise(input.freightPaise),
      paise(input.roundOffPaise),
    ])
    if (expected !== input.totalPaise) {
      throw new ORPCError('BAD_REQUEST', {
        message: `header total ${input.totalPaise} paise does not equal line totals + freight + round-off (${expected} paise)`,
        data: { totalPaise: input.totalPaise, expectedPaise: expected },
      })
    }
    if (input.irn) {
      const [dup] = await tx
        .select({ id: supplierInvoices.id, invoiceNo: supplierInvoices.invoiceNo })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.irn, input.irn))
      if (dup)
        throw new ORPCError('CONFLICT', {
          message: `IRN already recorded as supplier invoice ${dup.invoiceNo}`,
          data: { supplierInvoiceId: dup.id },
        })
    }
    const [same] = await tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.supplierId, input.supplierId),
          eq(supplierInvoices.invoiceNo, input.invoiceNo),
          eq(supplierInvoices.invoiceDate, input.invoiceDate),
        ),
      )
    if (same)
      throw new ORPCError('CONFLICT', {
        message: `invoice ${input.invoiceNo} dated ${input.invoiceDate} from this supplier is already recorded`,
        data: { supplierInvoiceId: same.id },
      })
    const approved = input.lines.every((l) => !!l.variantId)
    const now = new Date()
    let row: InvoiceRow | undefined
    try {
      ;[row] = await tx
        .insert(supplierInvoices)
        .values({
          id: input.id,
          tenantId: ctx.tenantId,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          documentId: input.documentId ?? null,
          source: input.source,
          status: approved ? 'approved' : 'in_review',
          invoiceNo: input.invoiceNo,
          invoiceDate: input.invoiceDate,
          irn: input.irn ?? null,
          ackNo: input.ackNo ?? null,
          ewayBillNo: input.ewayBillNo ?? null,
          supplierGstin: input.supplierGstin ?? null,
          placeOfSupplyState: input.placeOfSupplyState ?? null,
          subtotalPaise: input.subtotalPaise,
          discountPaise: input.discountPaise,
          cgstPaise: input.cgstPaise,
          sgstPaise: input.sgstPaise,
          igstPaise: input.igstPaise,
          cessPaise: input.cessPaise,
          freightPaise: input.freightPaise,
          roundOffPaise: input.roundOffPaise,
          totalPaise: input.totalPaise,
          dueDate: input.dueDate ?? null,
          approvedBy: approved ? ctx.actorId : null,
          approvedAt: approved ? now : null,
        })
        .returning()
    } catch (err) {
      if (pgConstraint(err) === 'supplier_invoices_pkey')
        throw new ORPCError('CONFLICT', {
          message: `supplier invoice ${input.id} already exists`,
        })
      throw err
    }
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'invoice insert returned nothing',
      })
    const lines = await tx
      .insert(supplierInvoiceLines)
      .values(
        input.lines.map((l) => ({
          id: l.id,
          tenantId: ctx.tenantId,
          supplierInvoiceId: input.id,
          lineNo: l.lineNo,
          description: l.description,
          supplierCode: l.supplierCode ?? null,
          variantId: l.variantId ?? null,
          hsnCode: l.hsnCode ?? null,
          batchNo: l.batchNo ?? null,
          mfgDate: l.mfgDate ?? null,
          expiryDate: l.expiryDate ?? null,
          mrpPaise: l.mrpPaise ?? null,
          printedQty: l.printedQty,
          printedUnit: l.printedUnit,
          qtyPcs: l.qtyPcs,
          freeQtyPcs: l.freeQtyPcs,
          ratePaise: l.ratePaise,
          rateBasis: l.rateBasis ?? 'piece',
          basisQty: l.basisQty ?? 1,
          discountBps: l.discountBps,
          discountPaise: l.discountPaise,
          gstBps: l.gstBps,
          cessBps: l.cessBps,
          taxablePaise: l.taxablePaise,
          taxPaise: l.taxPaise,
          lineTotalPaise: l.lineTotalPaise,
        })),
      )
      .returning()
    return { item: toInvoiceWithLines(row, sortLines(lines)) }
  }

  /** Newest first; cursor is the last id seen. */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(supplierInvoices.status, input.status) : undefined,
        input.supplierId ? eq(supplierInvoices.supplierId, input.supplierId) : undefined,
        input.cursor ? lt(supplierInvoices.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(supplierInvoices)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(supplierInvoices.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toInvoice)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({ item: await this.load(tx, input.id) }))
  }

  /**
   * Review resolved a printed line to a variant. The tenant learns the supplier's code/description → variant
   * mapping through `supplier_pack_configs` (its own table, including pieces per case as printed). The global
   * `product_aliases` table is curator-only under RLS (ADR 0005), so a tenant cannot write there; the curator
   * promotes well-used pack configs into aliases later.
   */
  async matchLine(input: MatchIn): Promise<MatchOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [invoice] = await tx
          .select()
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, input.id))
        if (!invoice)
          throw new ORPCError('NOT_FOUND', { message: `supplier invoice ${input.id} not found` })
        if (invoice.status === 'received' || invoice.status === 'cancelled')
          throw new ORPCError('BAD_REQUEST', {
            message: `supplier invoice is ${invoice.status}; its lines are frozen`,
          })
        const [line] = await tx
          .select()
          .from(supplierInvoiceLines)
          .where(
            and(
              eq(supplierInvoiceLines.id, input.lineId),
              eq(supplierInvoiceLines.supplierInvoiceId, input.id),
            ),
          )
        if (!line)
          throw new ORPCError('NOT_FOUND', {
            message: `line ${input.lineId} not on invoice ${input.id}`,
          })
        const [variant] = await tx
          .select({ id: productVariants.id, defaultCaseSize: productVariants.defaultCaseSize })
          .from(productVariants)
          .where(eq(productVariants.id, input.variantId))
        if (!variant)
          throw new ORPCError('NOT_FOUND', { message: `variant ${input.variantId} not found` })
        await tx
          .update(supplierInvoiceLines)
          .set({ variantId: variant.id, updatedAt: new Date() })
          .where(eq(supplierInvoiceLines.id, line.id))
        const pcsPerCase =
          CASE_UNITS.test(line.printedUnit) && line.printedQty > 0
            ? Math.max(1, Math.round(line.qtyPcs / line.printedQty))
            : variant.defaultCaseSize
        const pack = {
          pcsPerCase,
          supplierCode: line.supplierCode,
          supplierDescription: line.description,
        }
        await tx
          .insert(supplierPackConfigs)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            supplierId: invoice.supplierId,
            variantId: variant.id,
            ...pack,
          })
          .onConflictDoUpdate({
            target: [
              supplierPackConfigs.tenantId,
              supplierPackConfigs.supplierId,
              supplierPackConfigs.variantId,
            ],
            set: { ...pack, updatedAt: new Date() },
          })
        const lines = await this.lines(tx, invoice.id)
        if (invoice.status !== 'approved' && lines.every((l) => l.variantId !== null)) {
          await tx
            .update(supplierInvoices)
            .set({
              status: 'approved',
              approvedBy: ctx.actorId,
              approvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(supplierInvoices.id, invoice.id))
        }
        return { item: await this.load(tx, invoice.id) }
      }),
    )
  }

  async upsertPurchaseOrder(input: PoIn): Promise<PoOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const priced = input.lines.every((l) => l.ratePaise !== undefined)
        const totalPaise: Paise | null =
          priced && input.lines.length > 0
            ? sum(input.lines.map((l) => multiply(paise(l.ratePaise ?? 0), l.qtyPcs)))
            : null
        const values = {
          supplierId: input.supplierId,
          status: input.status,
          expectedOn: input.expectedOn ?? null,
          lines: input.lines.map((l) => ({
            variantId: l.variantId,
            qtyPcs: l.qtyPcs,
            ...(l.ratePaise === undefined ? {} : { ratePaise: l.ratePaise }),
          })),
          totalPaise,
          note: input.note ?? null,
        }
        const [existing] = await tx
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.id))
        const poNo = existing ? undefined : await nextDocumentNumber(tx, 'PO')
        const [row] = await tx
          .insert(purchaseOrders)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            poNo: poNo ?? null,
            createdBy: ctx.actorId,
            ...values,
          })
          .onConflictDoUpdate({
            target: purchaseOrders.id,
            set: { ...values, updatedAt: new Date() },
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'purchase order upsert returned nothing',
          })
        return { item: toPurchaseOrder(row) }
      }),
    )
  }

  async listPurchaseOrders(input: PoListIn): Promise<PoListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.supplierId ? eq(purchaseOrders.supplierId, input.supplierId) : undefined,
        input.status ? eq(purchaseOrders.status, input.status) : undefined,
        input.cursor ? lt(purchaseOrders.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(purchaseOrders)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(purchaseOrders.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toPurchaseOrder)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /**
   * `extracted | in_review | approved → disputed` (docs/23 §8.19): the supplier's bill does not match
   * what was agreed. A `received` invoice cannot be disputed — the GRN has posted stock and cost; the
   * correction is a discrepancy claim or a supplier credit. Audited.
   */
  async dispute(input: DisputeIn): Promise<DisputeOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.lockInvoice(tx, input.id)
        if (row.status === 'disputed') return { item: await this.load(tx, row.id) }
        if (!['extracted', 'in_review', 'approved'].includes(row.status))
          throw new ORPCError('CONFLICT', {
            message: `supplier invoice ${row.invoiceNo} is ${row.status}; only an extracted, in-review or approved invoice can be disputed`,
          })
        const now = new Date()
        await tx
          .update(supplierInvoices)
          .set({ status: 'disputed', disputedAt: now, disputeReason: input.reason, updatedAt: now })
          .where(eq(supplierInvoices.id, row.id))
        await writeAudit(tx, {
          action: 'supplier_invoice.dispute',
          entityType: 'supplier_invoice',
          entityId: row.id,
          before: { status: row.status },
          after: { status: 'disputed', reason: input.reason },
        })
        return { item: await this.load(tx, row.id) }
      }),
    )
  }

  /** `extracted | in_review | approved | disputed → cancelled`; never once a live GRN has been opened on it. */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.lockInvoice(tx, input.id)
        if (row.status === 'cancelled') return { item: await this.load(tx, row.id) }
        if (row.status === 'received')
          throw new ORPCError('CONFLICT', {
            message: `supplier invoice ${row.invoiceNo} is received; stock and cost have posted, so it cannot be cancelled`,
          })
        const [grn] = await tx
          .select({ id: grns.id, status: grns.status })
          .from(grns)
          .where(and(eq(grns.supplierInvoiceId, row.id), sql`${grns.status} <> 'cancelled'`))
          .limit(1)
        if (grn)
          throw new ORPCError('CONFLICT', {
            message: `supplier invoice ${row.invoiceNo} has GRN ${grn.id} (${grn.status}) open on it; cancel the GRN first`,
          })
        const now = new Date()
        await tx
          .update(supplierInvoices)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: input.reason,
            updatedAt: now,
          })
          .where(eq(supplierInvoices.id, row.id))
        await writeAudit(tx, {
          action: 'supplier_invoice.cancel',
          entityType: 'supplier_invoice',
          entityId: row.id,
          before: { status: row.status },
          after: { status: 'cancelled', reason: input.reason },
        })
        return { item: await this.load(tx, row.id) }
      }),
    )
  }

  private async lockInvoice(tx: Db, id: string): Promise<InvoiceRow> {
    const [row] = await tx
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, id))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `supplier invoice ${id} not found` })
    return row
  }

  /** Header + lines, or 404. Used by the GRN service too (same module). */
  async load(tx: Db, id: string) {
    const [row] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id))
    if (!row) throw new ORPCError('NOT_FOUND', { message: `supplier invoice ${id} not found` })
    return toInvoiceWithLines(row, await this.lines(tx, id))
  }

  async lines(tx: Db, invoiceId: string): Promise<InvoiceLineRow[]> {
    return tx
      .select()
      .from(supplierInvoiceLines)
      .where(eq(supplierInvoiceLines.supplierInvoiceId, invoiceId))
      .orderBy(asc(supplierInvoiceLines.lineNo), asc(supplierInvoiceLines.id))
  }
}

function sortLines(lines: InvoiceLineRow[]): InvoiceLineRow[] {
  return [...lines].sort((a, b) => a.lineNo - b.lineNo || (a.id < b.id ? -1 : 1))
}
