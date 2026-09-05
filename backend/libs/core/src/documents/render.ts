import { and, eq } from 'drizzle-orm'
import {
  creditNotes,
  deliveryChallans,
  fileObjects,
  invoices,
  receipts,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { loadCreditNoteDocument, loadInvoiceDocument } from '../modules/billing/index.js'
import { loadReceiptDocument } from '../modules/receivables/index.js'
import { loadChallanDocument } from '../modules/warehouse/index.js'
import {
  documentObjectKey,
  isCanonicalVariant,
  type DocumentRenderRequest,
} from '../platform/documents.js'
import {
  createObjectStorage,
  ObjectStorageError,
  type ObjectStorage,
} from '../platform/object-storage.js'
import { tenantStorage } from '../platform/tenant-context.js'
import { parseJpeg, type JpegImage } from './pdf.js'
import { renderChallan } from './templates/challan.js'
import { renderCreditNote } from './templates/credit-note.js'
import { renderInvoice } from './templates/invoice.js'
import { renderReceipt } from './templates/receipt.js'

/**
 * THE PDF RENDERER (docs/23 §8.2 and §8.20 item 4; coordination §3.4's "separate slice after the ten").
 *
 * One entry point, `renderDocument(db, request)`, called by the worker (`backend/worker/src/jobs/
 * pdf-render.ts`) for every `DocumentRenderRequested` outbox row a `*.pdf` procedure wrote. It loads
 * the document through the SAME loaders the API answers with (billing's `loadInvoiceDocument`,
 * warehouse's `loadChallanDocument`, receivables' `loadReceiptDocument`), renders it with the
 * dependency-free writer in `pdf.ts` (A4/A5 and 80 mm thermal, white-labelled from the tenant's
 * branding — the distributor's own name and logo, never ours), writes the bytes to object storage
 * under `tenant/{tenantId}/documents/{kind}/{id}.pdf`, records the canonical rendering on the row's
 * `pdf_object_key` and every rendering in `file_objects`. Idempotent: the same request writes the
 * same key again.
 *
 * Plain functions only — the worker runs under tsx with no Nest DI (coordination §3.9).
 */

export interface RenderedDocument {
  objectKey: string
  bytes: number
  canonical: boolean
}

export class DocumentNotFound extends Error {
  constructor(request: DocumentRenderRequest) {
    super(`${request.kind} ${request.id} not found in tenant ${request.tenantId}`)
    this.name = 'DocumentNotFound'
  }
}

/** Render one document and store it. Runs the load inside a tenant transaction as the system role. */
export async function renderDocument(
  db: Db,
  request: DocumentRenderRequest,
  storage: ObjectStorage = createObjectStorage(),
): Promise<RenderedDocument> {
  const ctx: TenantContext = {
    tenantId: request.tenantId,
    actorId: request.requestedBy,
    actorRole: 'system',
  }
  const pdf = await tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const logoKey = await logoKeyFor(tx, request)
      const logo = logoKey ? await loadLogo(storage, logoKey) : null
      return renderFor(tx, request, logo)
    }),
  )
  if (!pdf) throw new DocumentNotFound(request)
  const key = documentObjectKey(request)
  await storage.put(key, pdf, 'application/pdf')
  const canonical = isCanonicalVariant(request.format, request.copy)
  await tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      if (canonical) await stampObjectKey(tx, request, key)
      await registerFile(tx, request, key, pdf.byteLength)
    }),
  )
  return { objectKey: key, bytes: pdf.byteLength, canonical }
}

async function renderFor(
  tx: Db,
  request: DocumentRenderRequest,
  logo: JpegImage | null,
): Promise<Buffer | null> {
  switch (request.kind) {
    case 'invoice': {
      const doc = await loadInvoiceDocument(tx, request.id)
      return doc ? renderInvoice(doc, { format: request.format, copy: request.copy, logo }) : null
    }
    case 'credit_note': {
      const doc = await loadCreditNoteDocument(tx, request.id)
      return doc
        ? renderCreditNote(doc, { format: request.format, copy: request.copy, logo })
        : null
    }
    case 'challan': {
      const doc = await loadChallanDocument(tx, request.id)
      return doc ? renderChallan(doc, { format: request.format, copy: request.copy, logo }) : null
    }
    case 'receipt': {
      const doc = await loadReceiptDocument(tx, request.id)
      return doc ? renderReceipt(doc, { format: request.format, logo }) : null
    }
    default:
      return null
  }
}

/** The logo key is on the seller block every loader already reads; fetched once per render. */
async function logoKeyFor(tx: Db, request: DocumentRenderRequest): Promise<string | null> {
  // The loaders each call `sellerBranding`; reading the key alone here avoids a second full load.
  const { loadSettings } = await import('../modules/tenancy/index.js')
  const settings = await loadSettings(tx, ['branding.logo_object_key'])
  const key = settings.get('branding.logo_object_key')
  void request
  return typeof key === 'string' && key.trim() ? key : null
}

/** A JPEG logo is embedded; anything else (a PNG, a missing file) prints no logo, never a failure. */
async function loadLogo(storage: ObjectStorage, key: string): Promise<JpegImage | null> {
  try {
    return parseJpeg(await storage.get(key))
  } catch (error) {
    if (error instanceof ObjectStorageError) return null
    throw error
  }
}

async function stampObjectKey(tx: Db, request: DocumentRenderRequest, key: string): Promise<void> {
  const where = (t: { tenantId: unknown; id: unknown }) =>
    and(
      eq(t.tenantId as typeof invoices.tenantId, request.tenantId),
      eq(t.id as typeof invoices.id, request.id),
    )
  const now = new Date()
  switch (request.kind) {
    case 'invoice':
      await tx.update(invoices).set({ pdfObjectKey: key, updatedAt: now }).where(where(invoices))
      return
    case 'credit_note':
      await tx
        .update(creditNotes)
        .set({ pdfObjectKey: key, updatedAt: now })
        .where(where(creditNotes))
      return
    case 'challan':
      await tx.update(deliveryChallans).set({ pdfObjectKey: key }).where(where(deliveryChallans))
      return
    case 'receipt':
      await tx.update(receipts).set({ pdfObjectKey: key, updatedAt: now }).where(where(receipts))
      return
  }
}

const FILE_DOMAIN: Record<DocumentRenderRequest['kind'], 'invoices' | 'challans' | 'receipts'> = {
  invoice: 'invoices',
  credit_note: 'invoices',
  challan: 'challans',
  receipt: 'receipts',
}

/** Every rendering — canonical or not — is a `file_objects` row, so `files.readUrl` and the variant lookup know it exists. */
async function registerFile(
  tx: Db,
  request: DocumentRenderRequest,
  key: string,
  bytes: number,
): Promise<void> {
  const [existing] = await tx
    .select({ id: fileObjects.id })
    .from(fileObjects)
    .where(and(eq(fileObjects.tenantId, request.tenantId), eq(fileObjects.objectKey, key)))
    .limit(1)
  const now = new Date()
  if (existing) {
    await tx
      .update(fileObjects)
      .set({ status: 'uploaded', bytes, uploadedAt: now, updatedAt: now })
      .where(eq(fileObjects.id, existing.id))
    return
  }
  await tx.insert(fileObjects).values({
    id: uuidv7(),
    tenantId: request.tenantId,
    domain: FILE_DOMAIN[request.kind],
    entityId: request.id,
    objectKey: key,
    mimeType: 'application/pdf',
    bytes,
    status: 'uploaded',
    uploadedBy: request.requestedBy,
    uploadedAt: now,
  })
}
