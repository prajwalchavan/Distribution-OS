import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DocumentRender } from '@dos/contracts'
import { fileObjects, outboxEvents, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { createObjectStorage, objectKey, ObjectStorageError } from './object-storage.js'
import { currentTenant } from './tenant-context.js'

/**
 * Rendered documents (docs/23 §8.2, §8.20 item 4). Nothing renders on the request path (docs/20 rule
 * 3, coordination §3.4): a `*.pdf` / `receipts.document` procedure calls `documentRender()`, which
 * answers `ready` with a signed URL when the file exists and otherwise writes ONE durable
 * `DocumentRenderRequested` outbox row and answers `queued`. The worker (`backend/worker/src/jobs/
 * pdf-render.ts`) renders it from the same data the API serves and writes the file under
 * `tenant/{tenantId}/documents/{kind}/{id}.pdf`; the `a4`/`original` rendering is recorded on the
 * document row's `pdf_object_key`, every other variant in `file_objects`.
 *
 * `queued` is a normal state, never an error. A second call while the first is still queued does not
 * write a second row (`pendingRequest` looks for the unpublished one).
 */
export const DOCUMENT_RENDER_EVENT = 'DocumentRenderRequested'
export const DOCUMENT_KINDS = ['invoice', 'credit_note', 'challan', 'receipt'] as const
export type DocumentRenderKind = (typeof DOCUMENT_KINDS)[number]
export type DocumentFormat = 'a4' | 'thermal80' | 'a5'
export type DocumentCopy = 'original' | 'duplicate' | 'triplicate'

/** What the outbox row carries; the worker's `renderDocument` takes exactly this. */
export interface DocumentRenderRequest {
  tenantId: string
  kind: DocumentRenderKind
  id: string
  format: DocumentFormat
  copy: DocumentCopy
  /** Who asked, recorded as `file_objects.uploaded_by` on the rendered variant. */
  requestedBy: string
}

/** The canonical rendering of a document (A4 or A5, original copy) — what `pdf_object_key` records. */
export function isCanonicalVariant(format: DocumentFormat, copy: DocumentCopy): boolean {
  return (format === 'a4' || format === 'a5') && copy === 'original'
}

/**
 * `tenant/{tenantId}/documents/{kind}/{id}.pdf` for the canonical rendering; a variant appends the
 * format and the copy so an A4 original and an 80 mm duplicate of one bill are two objects.
 */
export function documentObjectKey(i: {
  tenantId: string
  kind: DocumentRenderKind
  id: string
  format: DocumentFormat
  copy: DocumentCopy
}): string {
  const name = isCanonicalVariant(i.format, i.copy) ? i.id : `${i.id}.${i.format}.${i.copy}`
  return objectKey({
    tenantId: i.tenantId,
    domain: 'documents',
    entityId: i.kind,
    name,
    ext: 'pdf',
  })
}

/** How long a signed document link stays good. */
const DOCUMENT_URL_TTL_SECONDS = 15 * 60

export interface DocumentRenderInput {
  kind: DocumentRenderKind
  id: string
  /** The row's `pdf_object_key` — the canonical rendering, null until the worker has written it. */
  objectKey: string | null
  format?: DocumentFormat
  copy?: DocumentCopy
}

/**
 * Answer a document procedure. Runs inside the caller's `withTenant` transaction: the caller has
 * already proven it may see the document row (RLS), so the file that IS that row's rendering may be
 * signed for it.
 */
export async function documentRender(tx: Db, input: DocumentRenderInput): Promise<DocumentRender> {
  const ctx = currentTenant()
  const format = input.format ?? 'a4'
  const copy = input.copy ?? 'original'
  const canonical = isCanonicalVariant(format, copy)
  const key = canonical
    ? input.objectKey
    : await variantKey(tx, { tenantId: ctx.tenantId, kind: input.kind, id: input.id, format, copy })
  if (key) {
    try {
      const url = await createObjectStorage().getUrl(key, DOCUMENT_URL_TTL_SECONDS)
      return {
        status: 'ready',
        objectKey: key,
        url,
        expiresAt: new Date(Date.now() + DOCUMENT_URL_TTL_SECONDS * 1000).toISOString(),
      }
    } catch (error) {
      if (!(error instanceof ObjectStorageError)) throw error
      // storage misconfigured: fall through and re-queue rather than 500 a print button
    }
  }
  await requestRender(tx, {
    tenantId: ctx.tenantId,
    kind: input.kind,
    id: input.id,
    format,
    copy,
    requestedBy: ctx.actorId,
  })
  return { status: 'queued', objectKey: key ?? null, url: null, expiresAt: null }
}

/** A non-canonical variant is known through the registry the worker writes; read as the system role. */
async function variantKey(
  tx: Db,
  i: {
    tenantId: string
    kind: DocumentRenderKind
    id: string
    format: DocumentFormat
    copy: DocumentCopy
  },
): Promise<string | null> {
  const key = documentObjectKey(i)
  const ctx = currentTenant()
  const read = async (): Promise<string | null> => {
    const [row] = await tx
      .select({ status: fileObjects.status })
      .from(fileObjects)
      .where(and(eq(fileObjects.tenantId, i.tenantId), eq(fileObjects.objectKey, key)))
      .limit(1)
    return row?.status === 'uploaded' ? key : null
  }
  // `file_objects` is staff-read; a shopkeeper asking for its own bill's thermal copy is still entitled
  // to the answer, so the one lookup runs as the system role and is restored at once (the pattern
  // `modules/orders`' `recordTransition` uses).
  if (ctx.actorRole !== 'retailer') return read()
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await read()
  } finally {
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

/**
 * Queue the canonical rendering of a document that was just issued, so the PDF is usually ready by
 * the time the desk or the crew asks for it. Called by billing (invoice, credit note), warehouse
 * (challan) and receivables (receipt) inside the issuing transaction; never throws for the issuer.
 */
export async function requestDocumentRender(
  tx: Db,
  i: { kind: DocumentRenderKind; id: string; format?: DocumentFormat },
): Promise<void> {
  const ctx = currentTenant()
  await requestRender(tx, {
    tenantId: ctx.tenantId,
    kind: i.kind,
    id: i.id,
    format: i.format ?? (i.kind === 'receipt' ? 'a5' : 'a4'),
    copy: 'original',
    requestedBy: ctx.actorId,
  })
}

/** One unpublished request per (document, variant); a print button pressed five times queues once. */
async function requestRender(tx: Db, request: DocumentRenderRequest): Promise<void> {
  const aggregateId = `${request.kind}:${request.id}:${request.format}:${request.copy}`
  const [pending] = await tx
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.tenantId, request.tenantId),
        eq(outboxEvents.aggregateType, 'document'),
        eq(outboxEvents.aggregateId, aggregateId),
        eq(outboxEvents.eventType, DOCUMENT_RENDER_EVENT),
        isNull(outboxEvents.publishedAt),
      ),
    )
    .limit(1)
  if (pending) return
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: request.tenantId,
    aggregateType: 'document',
    aggregateId,
    eventType: DOCUMENT_RENDER_EVENT,
    payload: request,
  })
}
