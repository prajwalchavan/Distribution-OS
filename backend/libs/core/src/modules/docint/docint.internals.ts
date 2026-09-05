import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import type { DocumentDetail, DocumentStatusView, ReviewLock } from '@dos/contracts'
import {
  documentPages,
  documents,
  reviewSessions,
  suppliers,
  users,
  withTenant,
  type ActorRole,
  type Db,
  type TenantContext,
} from '@dos/db'
import { TransitionError, type DocumentEvent } from '@dos/domain'
import { BACK_OFFICE, currentTenant } from '../../platform/index.js'
import { createObjectStorage, type ObjectStorage } from '../../platform/object-storage.js'
import {
  applyDocumentEvent,
  bestExtraction,
  checkSummaryFor,
  qrOf,
  type DocumentRow,
} from './pipeline/steps.js'
import { toDocument, toDocumentDetail, toPage, toStatusView } from './docint.mappers.js'

/** CAP (coordination §6 `BACK_OFFICE_OR_WAREHOUSE`): the inbound desk plus the gate phone. `system` for the worker. */
export const CAPTURE: readonly ActorRole[] = [...BACK_OFFICE, 'warehouse']
/** The priced surface. */
export const DESK: readonly ActorRole[] = BACK_OFFICE

/** Signed page read URLs live ten minutes (docint.ts `DocumentPageSchema.readUrl`). */
export const PAGE_URL_TTL_SECONDS = 10 * 60
/** An upload slot is good for fifteen minutes, like `files.uploadUrl`. */
export const UPLOAD_TTL_SECONDS = 15 * 60

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

export function notFound(what: string, id: string): ORPCError<'NOT_FOUND', undefined> {
  return new ORPCError('NOT_FOUND', { message: `${what} ${id} not found` })
}

/** The row, or 404 — which under RLS also covers "exists, but not for this role" (a supplier bill and the crew). */
export async function loadDocumentOr404(tx: Db, id: string): Promise<DocumentRow> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
  if (!row) throw notFound('document', id)
  return row
}

/** Same, with a row lock for the mutations that move status. */
export async function lockDocument(tx: Db, id: string): Promise<DocumentRow> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, id)).for('update').limit(1)
  if (!row) throw notFound('document', id)
  return row
}

/** `documentMachine` owns the rules; an illegal move is a 409, never a silently ignored write. */
export async function transition(
  tx: Db,
  doc: DocumentRow,
  event: DocumentEvent,
  extra: Partial<typeof documents.$inferInsert> = {},
): Promise<DocumentRow> {
  try {
    return await applyDocumentEvent(tx, doc, event, extra)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', {
        message: error.message,
        data: { from: doc.status, event, documentId: doc.id },
      })
    throw error
  }
}

/** The single-writer lock as the wire shows it: the `open` session whose `locked_until` is still ahead. */
export async function openLock(tx: Db, documentId: string): Promise<ReviewLock | null> {
  const [row] = await tx
    .select({
      id: reviewSessions.id,
      reviewerId: reviewSessions.reviewerId,
      lockedUntil: reviewSessions.lockedUntil,
      reviewerName: users.name,
    })
    .from(reviewSessions)
    .leftJoin(users, eq(users.id, reviewSessions.reviewerId))
    .where(
      and(
        eq(reviewSessions.documentId, documentId),
        eq(reviewSessions.status, 'open'),
        gt(reviewSessions.lockedUntil, new Date()),
      ),
    )
    .limit(1)
  return row
    ? {
        reviewSessionId: row.id,
        reviewerId: row.reviewerId,
        reviewerName: row.reviewerName ?? null,
        lockedUntil: row.lockedUntil.toISOString(),
      }
    : null
}

export interface DocumentNames {
  supplierName: string | null
  uploadedByName: string | null
}

export async function namesFor(tx: Db, doc: DocumentRow): Promise<DocumentNames> {
  const [supplier] = doc.supplierId
    ? await tx
        .select({ name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, doc.supplierId))
        .limit(1)
    : [undefined]
  const [uploader] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, doc.uploadedBy))
    .limit(1)
  return { supplierName: supplier?.name ?? null, uploadedByName: uploader?.name ?? null }
}

export async function pageCountOf(tx: Db, documentId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
  return Number(row?.n ?? 0)
}

/**
 * The document with its pages and where it is in the pipeline. `checkSummary`, `lock` and
 * `latestExtractionId` come from tables a warehouse caller cannot read (RLS): they are null for
 * it because the rows are invisible, not because the mapper hides them (docint.ts header).
 */
export async function loadDetail(
  tx: Db,
  doc: DocumentRow,
  storage: ObjectStorage = createObjectStorage(),
): Promise<DocumentDetail> {
  const names = await namesFor(tx, doc)
  const pageRows = await tx
    .select()
    .from(documentPages)
    .where(eq(documentPages.documentId, doc.id))
    .orderBy(asc(documentPages.pageNo))
  const expiresAt = new Date(Date.now() + PAGE_URL_TTL_SECONDS * 1000).toISOString()
  const pages = []
  for (const row of pageRows) {
    let readUrl: string
    try {
      readUrl = await storage.getUrl(row.objectKey, PAGE_URL_TTL_SECONDS)
    } catch {
      readUrl = ''
    }
    pages.push(toPage(row, readUrl, expiresAt))
  }
  const best = await bestExtraction(tx, doc.id)
  const summary = best ? await checkSummaryFor(tx, best.id) : null
  return toDocumentDetail(doc, {
    ...names,
    pages,
    qrPayload: qrOf(doc),
    checkSummary: summary ? { errors: summary.errors, warnings: summary.warnings } : null,
    lock: await openLock(tx, doc.id),
    latestExtractionId: best?.id ?? null,
  })
}

export async function loadStatusView(tx: Db, doc: DocumentRow): Promise<DocumentStatusView> {
  const best = await bestExtraction(tx, doc.id)
  const summary = best ? await checkSummaryFor(tx, best.id) : null
  return toStatusView(doc, {
    latestExtractionId: best?.id ?? null,
    checkSummary: summary ? { errors: summary.errors, warnings: summary.warnings } : null,
    lock: await openLock(tx, doc.id),
  })
}

export async function listRow(tx: Db, doc: DocumentRow): Promise<ReturnType<typeof toDocument>> {
  const names = await namesFor(tx, doc)
  return toDocument(doc, { ...names, pageCount: await pageCountOf(tx, doc.id) })
}

/** Read as the caller, in a fresh transaction (the GET procedures). */
export function asCaller<T>(db: Db, fn: (tx: Db, ctx: TenantContext) => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  return withTenant(db, ctx, (tx) => fn(tx, ctx))
}

/** Newest first on the id (UUIDv7 = time-ordered), the cursor being the last id seen. */
export const NEWEST_FIRST = desc(documents.id)
