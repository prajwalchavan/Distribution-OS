import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AddPageInput,
  AddPageOutput,
  ApproveDocumentInput,
  ApproveDocumentOutput,
  CreateDocumentInput,
  CreateDocumentOutput,
  DocumentGetInput,
  DocumentGetOutput,
  DocumentPageUrlInput,
  DocumentPageUrlOutput,
  DocumentsListInput,
  DocumentsListOutput,
  DocumentStatusInput,
  DocumentStatusOutput,
  PageUploadUrlInput,
  PageUploadUrlOutput,
  RejectDocumentInput,
  RejectDocumentOutput,
  SubmitDocumentInput,
  SubmitDocumentOutput,
  VerifyQrInput,
  VerifyQrOutput,
} from '@dos/contracts'
import { documentMachine, type DocumentState } from '@dos/domain'
import { documentPages, documents, reviewSessions, suppliers, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import {
  ALLOWED_CONTENT_TYPES,
  assertTenantKey,
  createObjectStorage,
  objectKey,
  ObjectStorageError,
} from '../../platform/object-storage.js'
import { SupplierInvoiceService } from '../procurement/index.js'
import {
  asCaller,
  CAPTURE,
  DESK,
  isUniqueViolation,
  listRow,
  loadDetail,
  loadDocumentOr404,
  loadStatusView,
  lockDocument,
  notFound,
  PAGE_URL_TTL_SECONDS,
  transition,
  UPLOAD_TTL_SECONDS,
} from './docint.internals.js'
import { reviewedOf } from './docint.mappers.js'
import { docintConfig } from './pipeline/config.js'
import { decodeQr, parseIrpKeys, qrGstinsValid, qrStatusFor } from './pipeline/qr.js'
import { inlineRunner, runPipeline } from './pipeline/run.js'
import {
  DOCINT_EVENTS,
  emitDocumentEvent,
  findDuplicate,
  rememberSupplierAlias,
  resolveSupplier,
} from './pipeline/steps.js'

type CreateIn = z.infer<typeof CreateDocumentInput>
type CreateOut = z.infer<typeof CreateDocumentOutput>
type UploadUrlIn = z.infer<typeof PageUploadUrlInput>
type UploadUrlOut = z.infer<typeof PageUploadUrlOutput>
type AddPageIn = z.infer<typeof AddPageInput>
type AddPageOut = z.infer<typeof AddPageOutput>
type VerifyQrIn = z.infer<typeof VerifyQrInput>
type VerifyQrOut = z.infer<typeof VerifyQrOutput>
type SubmitIn = z.infer<typeof SubmitDocumentInput>
type SubmitOut = z.infer<typeof SubmitDocumentOutput>
type ListIn = z.infer<typeof DocumentsListInput>
type ListOut = z.infer<typeof DocumentsListOutput>
type GetIn = z.infer<typeof DocumentGetInput>
type GetOut = z.infer<typeof DocumentGetOutput>
type StatusIn = z.infer<typeof DocumentStatusInput>
type StatusOut = z.infer<typeof DocumentStatusOutput>
type PageUrlIn = z.infer<typeof DocumentPageUrlInput>
type PageUrlOut = z.infer<typeof DocumentPageUrlOutput>
type RejectIn = z.infer<typeof RejectDocumentInput>
type RejectOut = z.infer<typeof RejectDocumentOutput>
type ApproveIn = z.infer<typeof ApproveDocumentInput>
type ApproveOut = z.infer<typeof ApproveDocumentOutput>

/** Capture may still add pages here; a document past `extracting` is being read or reviewed. */
const CAPTURE_OPEN: readonly DocumentState[] = ['uploaded', 'verifying', 'extracting']

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/** "1 of 5" / "page 2/5" / "2 of 5" → 5; null when the label says nothing about the total. */
export function parsePrintedTotal(label: string | null): number | null {
  if (!label) return null
  const m = /(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})/i.exec(label)
  const total = m ? Number(m[2]) : NaN
  return Number.isInteger(total) && total > 0 ? total : null
}

/**
 * Capture and the two desk decisions on a document. Every status move goes through
 * `documentMachine` (`transition`), every mutation through `idempotent`, and the only write outside
 * docint's own tables is `SupplierInvoiceService.createInTx` at `approve` — the DRAFT, never a GRN
 * (never-list 6).
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly supplierInvoices: SupplierInvoiceService,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // capture (CAP)

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        if (input.supplierId) {
          const [supplier] = await tx
            .select({ id: suppliers.id })
            .from(suppliers)
            .where(eq(suppliers.id, input.supplierId))
            .limit(1)
          if (!supplier) throw notFound('supplier', input.supplierId)
        }
        let row
        try {
          ;[row] = await tx
            .insert(documents)
            .values({
              id: input.id,
              tenantId: ctx.tenantId,
              kind: input.kind,
              status: documentMachine.initial,
              uploadedBy: ctx.actorId,
              supplierId: input.supplierId ?? null,
              expectedPages: input.expectedPages ?? null,
              capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
              note: input.note?.trim() || null,
            })
            .returning()
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ORPCError('CONFLICT', { message: `document ${input.id} already exists` })
          throw error
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'document insert returned nothing',
          })
        return { item: await loadDetail(tx, row) }
      }),
    )
  }

  /** Thin wrapper over the platform `putUrl` (coordination §3.3, docs/23 §8.5): one slot per page. */
  async pageUploadUrl(input: UploadUrlIn): Promise<UploadUrlOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const doc = await loadDocumentOr404(tx, input.id)
        if (doc.status !== 'uploaded')
          throw new ORPCError('CONFLICT', {
            message: `document ${doc.id} is ${doc.status}; pages can only be added before submit`,
          })
        const taken = new Set(
          (
            await tx
              .select({ pageNo: documentPages.pageNo })
              .from(documentPages)
              .where(eq(documentPages.documentId, doc.id))
          ).map((p) => p.pageNo),
        )
        const clash = input.pages.find((p) => taken.has(p.pageNo))
        if (clash)
          throw new ORPCError('CONFLICT', {
            message: `page ${String(clash.pageNo)} of document ${doc.id} is already registered`,
            data: { code: 'page_exists', pageNo: clash.pageNo },
          })
        const storage = createObjectStorage()
        const slots = []
        for (const page of input.pages) {
          const ext = ALLOWED_CONTENT_TYPES[page.mimeType]?.extensions[0] ?? 'bin'
          let key: string
          let put
          try {
            key = objectKey({
              tenantId: ctx.tenantId,
              domain: 'docs',
              entityId: doc.id,
              name: `page-${String(page.pageNo)}`,
              ext,
            })
            put = await storage.putUrl(key, {
              mimeType: page.mimeType,
              bytes: page.bytes,
              ttlSeconds: UPLOAD_TTL_SECONDS,
            })
          } catch (error) {
            throw storageError(error)
          }
          slots.push({
            pageNo: page.pageNo,
            objectKey: key,
            url: put.url,
            method: put.method,
            headers: put.headers,
            inline: put.inline,
            expiresAt: put.expiresAt,
          })
        }
        return { slots }
      }),
    )
  }

  async addPage(input: AddPageIn): Promise<AddPageOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const doc = await lockDocument(tx, input.id)
        if (!CAPTURE_OPEN.includes(doc.status))
          throw new ORPCError('CONFLICT', {
            message: `document ${doc.id} is ${doc.status}; no more pages can be added`,
          })
        const prefix = `tenant/${ctx.tenantId}/docs/${doc.id}/`
        try {
          assertTenantKey(input.objectKey, ctx.tenantId)
        } catch (error) {
          throw storageError(error)
        }
        if (!input.objectKey.startsWith(prefix))
          throw new ORPCError('BAD_REQUEST', {
            message: `objectKey must be a slot minted for this document (${prefix}…)`,
          })
        const storage = createObjectStorage()
        let bytes: Buffer
        if (input.contentBase64) {
          bytes = Buffer.from(input.contentBase64, 'base64')
          try {
            await storage.put(input.objectKey, bytes, input.mimeType)
          } catch (error) {
            throw storageError(error)
          }
        } else {
          try {
            bytes = await storage.get(input.objectKey)
          } catch (error) {
            if (error instanceof ObjectStorageError && error.code === 'not_found')
              throw new ORPCError('BAD_REQUEST', {
                message: `nothing has been uploaded to ${input.objectKey} yet; PUT the page bytes first`,
                data: { code: 'page_missing_object' },
              })
            throw storageError(error)
          }
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        try {
          await tx.insert(documentPages).values({
            id: input.pageId,
            tenantId: ctx.tenantId,
            documentId: doc.id,
            pageNo: input.pageNo,
            objectKey: input.objectKey,
            mimeType: input.mimeType,
            width: input.width ?? null,
            height: input.height ?? null,
            bytes: input.bytes ?? bytes.byteLength,
            sha256,
            printedPageLabel: input.printedPageLabel?.trim() || null,
            qrDetected: input.qrDetected ?? false,
          })
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ORPCError('CONFLICT', {
              message: `page ${String(input.pageNo)} of document ${doc.id} is already registered`,
              data: { code: 'page_exists', pageNo: input.pageNo },
            })
          throw error
        }
        // The document's identity is the ordered hash of its pages, WRITTEN AT SUBMIT (capture is
        // complete then); here the prospective hash is only compared with captured documents, so the
        // same bill photographed twice is refused with the first document's id (docs/05).
        const existing = await duplicateOf(tx, doc.id)
        if (existing)
          throw new ORPCError('CONFLICT', {
            message: `these pages were already captured as document ${existing}`,
            data: { code: 'duplicate_document', documentId: existing },
          })
        return { item: await loadDetail(tx, doc, storage) }
      }),
    )
  }

  /** Decode and check the e-invoice QR. Never blocks: a bad signature is amber, a duplicate is reported. */
  async verifyQr(input: VerifyQrIn): Promise<VerifyQrOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        const decoded = decodeQr(input.qrText)
        if (!decoded || !qrGstinsValid(decoded.payload)) {
          return { item: await loadDetail(tx, doc), qr: null, duplicate: null }
        }
        const qr = decoded.payload
        const qrStatus = qrStatusFor(decoded, parseIrpKeys(docintConfig().irpKeys))
        const supplierId =
          doc.supplierId ??
          (await resolveSupplier(tx, { tenantId: ctx.tenantId, gstin: qr.sellerGstin }))
        const duplicate = await findDuplicate(tx, {
          documentId: doc.id,
          supplierId,
          invoiceNo: qr.docNo,
          irn: qr.irn,
        })
        const [updated] = await tx
          .update(documents)
          .set({
            qrPayload: qr,
            qrStatus,
            supplierId,
            // A duplicate leaves the document's own IRN empty: the bill is already in the books.
            irn: duplicate ? doc.irn : qr.irn,
            irnVerified: !duplicate && qrStatus === 'verified',
            updatedAt: new Date(),
          })
          .where(eq(documents.id, doc.id))
          .returning()
        doc = updated ?? doc
        await tx
          .update(documentPages)
          .set({ qrDetected: true, updatedAt: new Date() })
          .where(and(eq(documentPages.documentId, doc.id), eq(documentPages.pageNo, 1)))
        return { item: await loadDetail(tx, doc), qr, duplicate }
      }),
    )
  }

  /** Capture is closed: page completeness first, then `uploaded → verifying`, the outbox row and the job. */
  async submit(input: SubmitIn): Promise<SubmitOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        if (doc.status !== 'uploaded')
          throw new ORPCError('CONFLICT', {
            message: `document ${doc.id} is ${doc.status}; only an uploaded document can be submitted`,
          })
        const pages = await tx
          .select({ pageNo: documentPages.pageNo, label: documentPages.printedPageLabel })
          .from(documentPages)
          .where(eq(documentPages.documentId, doc.id))
        if (pages.length === 0)
          throw new ORPCError('BAD_REQUEST', {
            message: 'the document has no pages; add at least one before submitting',
            data: { code: 'pages_missing', missing: [1] },
          })
        const printed = pages
          .map((p) => parsePrintedTotal(p.label))
          .filter((n): n is number => n !== null)
        const expected = doc.expectedPages ?? (printed.length > 0 ? Math.max(...printed) : null)
        if (expected !== null) {
          const have = new Set(pages.map((p) => p.pageNo))
          const missing = Array.from({ length: expected }, (_, i) => i + 1).filter(
            (n) => !have.has(n),
          )
          if (missing.length > 0)
            throw new ORPCError('BAD_REQUEST', {
              message: `pages ${missing.join(', ')} of ${String(expected)} are missing`,
              data: { code: 'pages_missing', missing, expected },
            })
        }
        const contentHash = await pagesHash(tx, doc.id)
        const twin = await duplicateOf(tx, doc.id, contentHash)
        if (twin)
          throw new ORPCError('CONFLICT', {
            message: `these pages were already captured as document ${twin}`,
            data: { code: 'duplicate_document', documentId: twin },
          })
        try {
          doc = await transition(tx, doc, 'submit', { failureCode: null, contentHash })
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ORPCError('CONFLICT', {
              message: 'these pages were already captured as another document',
              data: { code: 'duplicate_document', documentId: null },
            })
          throw error
        }
        await emitDocumentEvent(tx, doc, DOCINT_EVENTS.submitted, {
          kind: doc.kind,
          supplierId: doc.supplierId,
          pages: pages.length,
          uploadedBy: doc.uploadedBy,
          deviceId: input.deviceId ?? null,
        })
        if (docintConfig().inlineJobs) {
          await runPipeline(inlineRunner(tx, ctx), { tenantId: ctx.tenantId, documentId: doc.id })
          doc = await loadDocumentOr404(tx, doc.id)
        }
        return { item: await loadDetail(tx, doc), jobId: doc.jobId }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    return asCaller(db, async (tx, ctx) => {
      const filters: (SQL | undefined)[] = [
        input.kind ? eq(documents.kind, input.kind) : undefined,
        input.status ? eq(documents.status, input.status) : undefined,
        input.statuses && input.statuses.length > 0
          ? inArray(documents.status, input.statuses)
          : undefined,
        input.supplierId ? eq(documents.supplierId, input.supplierId) : undefined,
        input.uploadedBy ? eq(documents.uploadedBy, input.uploadedBy) : undefined,
        input.mine ? eq(documents.uploadedBy, ctx.actorId) : undefined,
        input.from ? gte(documents.createdAt, istStart(input.from)) : undefined,
        input.to ? lte(documents.createdAt, istEnd(input.to)) : undefined,
        input.cursor ? lt(documents.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(documents)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(documents.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items = []
      for (const row of page) items.push(await listRow(tx, row))
      const last = page[page.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => ({
      item: await loadDetail(tx, await loadDocumentOr404(tx, input.id)),
    }))
  }

  async status(input: StatusIn): Promise<StatusOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => loadStatusView(tx, await loadDocumentOr404(tx, input.id)))
  }

  async pageUrl(input: PageUrlIn): Promise<PageUrlOut> {
    requireRole(CAPTURE)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const doc = await loadDocumentOr404(tx, input.id)
      const [page] = await tx
        .select({ objectKey: documentPages.objectKey })
        .from(documentPages)
        .where(and(eq(documentPages.documentId, doc.id), eq(documentPages.pageNo, input.pageNo)))
        .limit(1)
      if (!page) throw notFound(`page ${String(input.pageNo)} of document`, doc.id)
      try {
        const url = await createObjectStorage().getUrl(page.objectKey, PAGE_URL_TTL_SECONDS)
        return {
          objectKey: page.objectKey,
          url,
          expiresAt: new Date(Date.now() + PAGE_URL_TTL_SECONDS * 1000).toISOString(),
        }
      } catch (error) {
        throw storageError(error)
      }
    })
  }

  // -------------------------------------------------------------------------------------------------
  // the desk (BACK_OFFICE)

  async reject(input: RejectIn): Promise<RejectOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        if (doc.status === 'committed')
          throw new ORPCError('CONFLICT', {
            message: 'a committed document is corrected by a credit note, never rejected',
          })
        // Already rejected: the desk pressing it again (another phone, a retry) changes nothing.
        if (doc.status === 'rejected') return { item: await loadDetail(tx, doc) }
        const note = input.note?.trim()
        doc = await transition(tx, doc, 'reject', {
          rejectedReason: input.reason,
          note: note
            ? doc.note
              ? `${doc.note} | rejected: ${note}`
              : `rejected: ${note}`
            : doc.note,
        })
        await tx
          .update(reviewSessions)
          .set({ status: 'abandoned', updatedAt: new Date() })
          .where(and(eq(reviewSessions.documentId, doc.id), eq(reviewSessions.status, 'open')))
        return { item: await loadDetail(tx, doc) }
      }),
    )
  }

  /**
   * "Book it" (docint.ts): the submitted `reviewed` payload becomes ONE `supplier_invoices` DRAFT
   * through procurement's own entry point, inside this transaction. No GRN, no lot, no ledger row,
   * no cost, no journal — `procurement.grns.open → count → post` does that, by a human, later.
   */
  async approve(input: ApproveIn): Promise<ApproveOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        if (doc.status === 'committed' && doc.committedEntityId) {
          // Idempotent on the document: a replay answers the same draft.
          return {
            item: await loadDetail(tx, doc),
            supplierInvoice: await this.supplierInvoices.load(tx, doc.committedEntityId),
          }
        }
        if (doc.kind === 'brand_dms_invoice')
          throw new ORPCError('NOT_IMPLEMENTED', {
            message:
              'a brand-DMS bill is committed through billing.invoices.importBrandDms (never a second legal invoice); docint keeps it reviewed',
          })
        if (doc.status !== 'reviewed')
          throw new ORPCError('CONFLICT', {
            message: `document ${doc.id} is ${doc.status}; only a reviewed document can be approved`,
          })
        const [session] = await tx
          .select()
          .from(reviewSessions)
          .where(and(eq(reviewSessions.documentId, doc.id), eq(reviewSessions.status, 'submitted')))
          .orderBy(desc(reviewSessions.submittedAt), desc(reviewSessions.id))
          .limit(1)
        if (!session)
          throw new ORPCError('CONFLICT', { message: 'no submitted review session to approve' })
        const reviewed = reviewedOf(session)
        const h = reviewed.header
        const supplierId = input.supplierId ?? h.supplierId ?? doc.supplierId
        if (!supplierId)
          throw new ORPCError('BAD_REQUEST', {
            message: 'the review left the supplier unresolved; send supplierId',
            data: { code: 'supplier_required' },
          })
        if (!h.invoiceNo || !h.invoiceDate)
          throw new ORPCError('BAD_REQUEST', {
            message: 'the reviewed header has no invoice number or date',
            data: { code: 'header_incomplete' },
          })
        if (h.totalPaise === null || h.subtotalPaise === null)
          throw new ORPCError('BAD_REQUEST', {
            message: 'the reviewed header has no total',
            data: { code: 'header_incomplete' },
          })
        const ids = new Map(input.lineIds.map((l) => [l.lineNo, l.id]))
        if (ids.size !== reviewed.lines.length || reviewed.lines.some((l) => !ids.has(l.lineNo)))
          throw new ORPCError('BAD_REQUEST', {
            message: `lineIds must name every reviewed line once (${String(reviewed.lines.length)} lines)`,
            data: { code: 'line_ids_mismatch' },
          })
        const lines = reviewed.lines.map((l) => {
          const id = ids.get(l.lineNo)
          if (
            !id ||
            l.qtyPcs === null ||
            l.ratePaise === null ||
            l.taxablePaise === null ||
            l.taxPaise === null ||
            l.lineTotalPaise === null
          )
            throw new ORPCError('BAD_REQUEST', {
              message: `line ${String(l.lineNo)} is incomplete (quantity, rate, taxable, tax and total are required)`,
              data: { code: 'line_incomplete', lineNo: l.lineNo },
            })
          return {
            id,
            lineNo: l.lineNo,
            description: l.description.slice(0, 200) || `line ${String(l.lineNo)}`,
            supplierCode: l.supplierCode,
            variantId: l.variantId,
            hsnCode: l.hsnCode && /^\d{4,8}$/.test(l.hsnCode) ? l.hsnCode : null,
            batchNo: l.batchNo,
            mfgDate: l.mfgDate,
            expiryDate: l.expiryDate,
            mrpPaise: l.mrpPaise,
            printedQty: l.printedQty ?? l.qtyPcs,
            printedUnit: l.printedUnit ?? 'pcs',
            qtyPcs: l.qtyPcs,
            freeQtyPcs: l.freeQtyPcs,
            ratePaise: l.ratePaise,
            rateBasis: l.rateBasis,
            basisQty: l.basisQty,
            discountBps: l.discountBps,
            discountPaise: l.discountPaise,
            gstBps: l.gstBps,
            cessBps: l.cessBps,
            taxablePaise: l.taxablePaise,
            taxPaise: l.taxPaise,
            lineTotalPaise: l.lineTotalPaise,
          }
        })
        const created = await this.supplierInvoices.createInTx(tx, {
          idempotencyKey: input.idempotencyKey,
          id: input.supplierInvoiceId,
          supplierId,
          purchaseOrderId: input.purchaseOrderId ?? h.purchaseOrderId ?? null,
          documentId: doc.id,
          source: 'docint',
          invoiceNo: h.invoiceNo,
          invoiceDate: h.invoiceDate,
          irn: h.irn ?? doc.irn ?? null,
          ewayBillNo: h.ewayBillNo && /^\d{12}$/.test(h.ewayBillNo) ? h.ewayBillNo : null,
          supplierGstin: h.supplierGstin,
          placeOfSupplyState: h.placeOfSupplyState,
          subtotalPaise: h.subtotalPaise,
          discountPaise: h.discountPaise ?? 0,
          cgstPaise: h.cgstPaise ?? 0,
          sgstPaise: h.sgstPaise ?? 0,
          igstPaise: h.igstPaise ?? 0,
          cessPaise: h.cessPaise ?? 0,
          freightPaise: h.freightPaise ?? 0,
          roundOffPaise: h.roundOffPaise ?? 0,
          totalPaise: h.totalPaise,
          dueDate: h.dueDate,
          lines,
        })
        doc = await transition(tx, doc, 'commit', {
          committedEntityType: 'supplier_invoice',
          committedEntityId: created.item.id,
          committedAt: new Date(),
          supplierId,
        })
        if (h.supplierName)
          await rememberSupplierAlias(tx, {
            tenantId: ctx.tenantId,
            supplierId,
            alias: h.supplierName,
            gstin: h.supplierGstin,
          })
        await emitDocumentEvent(
          tx,
          doc,
          DOCINT_EVENTS.drafted,
          {
            supplierInvoiceId: created.item.id,
            supplierId,
            invoiceNo: h.invoiceNo,
            invoiceDate: h.invoiceDate,
          },
          'supplier_invoice',
          created.item.id,
        )
        return { item: await loadDetail(tx, doc), supplierInvoice: created.item }
      }),
    )
  }
}

/** sha256 over the page hashes in page order: the document's identity once capture is complete. */
async function pagesHash(tx: Db, documentId: string): Promise<string> {
  const hashes = await tx
    .select({ sha256: documentPages.sha256 })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(documentPages.pageNo)
  return createHash('sha256')
    .update(hashes.map((h) => h.sha256 ?? '').join('\n'))
    .digest('hex')
}

/** Another document of this tenant already carrying this content hash (submitted ones only carry one). */
async function duplicateOf(
  tx: Db,
  documentId: string,
  contentHash?: string,
): Promise<string | null> {
  const hash = contentHash ?? (await pagesHash(tx, documentId))
  const [existing] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.contentHash, hash), sql`${documents.id} <> ${documentId}`))
    .limit(1)
  return existing?.id ?? null
}

/** `ObjectStorageError` → the HTTP answer files.ts promises; anything else is a real fault. */
export function storageError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ObjectStorageError) {
    if (error.code === 'not_found') return new ORPCError('NOT_FOUND', { message: error.message })
    if (error.code === 'not_configured' || error.code === 'upstream')
      return new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
    return new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code } })
  }
  if (error instanceof ORPCError) return error as ORPCError<string, unknown>
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: String(error) })
}
