import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { outboxEvents } from '@dos/db'
import {
  DOCUMENT_KINDS,
  DOCUMENT_RENDER_EVENT,
  DocumentNotFound,
  renderDocument,
  type DocumentRenderRequest,
} from '@dos/core/documents'
import { logger } from '../logger.js'

/**
 * `documents.pdf.render` — the PDF renderer job (docs/23 §8.2, §8.20 item 4; coordination §3.4's
 * "separate slice after the ten").
 *
 * Two ways in, one function out:
 *  - every `*.pdf` / `receipts.document` procedure, and every invoice, credit note, challan and
 *    receipt at issue, writes ONE durable `DocumentRenderRequested` row to `outbox_events` inside its
 *    own transaction (`@dos/core`'s `documentRender` / `requestDocumentRender`). `renderPending`
 *    drains those rows — oldest first, bounded per run — and stamps `published_at` on each once its
 *    file is written, so a crash mid-run re-renders at most the row in flight (idempotent: same key).
 *  - a direct pg-boss send of a `DocumentRenderRequest` payload runs `handlePdfRenderJob` once.
 *
 * The outbox relay (`outbox-relay.ts`) dispatches `DocumentRenderRequested` to `handlePdfRenderJob`
 * through its registry (docint's slice built it, coordination §3.6). `renderPending` stays as the
 * minute-by-minute drain of the same rows: both paths stamp `published_at` on the row they rendered
 * and the render is idempotent (same key), so the two never fight.
 *
 * Renders as the system role for the row's tenant, from the same loaders the API answers with, so the
 * printed document and the screen can never differ (`@dos/core/documents`).
 */
export const PDF_RENDER = 'documents.pdf.render'

/** Rows drained per run: a burst of a hundred bills after a busy pack session clears in one tick. */
const BATCH = 100

const KINDS = new Set<string>(DOCUMENT_KINDS)
const FORMATS = new Set(['a4', 'a5', 'thermal80'])
const COPIES = new Set(['original', 'duplicate', 'triplicate'])

function parseRequest(value: unknown): DocumentRenderRequest | null {
  const p = value as Partial<DocumentRenderRequest> | null
  if (!p || typeof p !== 'object') return null
  if (
    typeof p.tenantId !== 'string' ||
    typeof p.id !== 'string' ||
    typeof p.requestedBy !== 'string'
  )
    return null
  if (typeof p.kind !== 'string' || !KINDS.has(p.kind)) return null
  const format = typeof p.format === 'string' && FORMATS.has(p.format) ? p.format : 'a4'
  const copy = typeof p.copy === 'string' && COPIES.has(p.copy) ? p.copy : 'original'
  return { tenantId: p.tenantId, kind: p.kind, id: p.id, format, copy, requestedBy: p.requestedBy }
}

/** One direct job (a pg-boss send with a `DocumentRenderRequest` payload). */
export async function handlePdfRenderJob(db: Db, payload: unknown): Promise<void> {
  const request = parseRequest(payload)
  if (!request) {
    logger.warn({ payload }, 'documents.pdf.render: payload is not a DocumentRenderRequest')
    return
  }
  try {
    const rendered = await renderDocument(db, request)
    logger.info(
      { ...request, objectKey: rendered.objectKey, bytes: rendered.bytes },
      'document rendered',
    )
  } catch (error) {
    // A document that vanished before it was rendered is dropped, not retried: nothing to print.
    if (error instanceof DocumentNotFound) {
      logger.warn({ ...request, err: error }, 'document vanished before it was rendered; dropped')
      return
    }
    throw error
  }
}

/**
 * Drain the outbox's render requests. Runs on the owner connection (cross-tenant); every render then
 * opens its own tenant-scoped transaction. Returns how many rows were dealt with.
 */
export async function renderPending(db: Db): Promise<number> {
  const pending = await db
    .select({ id: outboxEvents.id, payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.eventType, DOCUMENT_RENDER_EVENT), isNull(outboxEvents.publishedAt)))
    .orderBy(asc(outboxEvents.id))
    .limit(BATCH)
  let done = 0
  for (const row of pending) {
    const request = parseRequest(row.payload)
    try {
      if (request) {
        const rendered = await renderDocument(db, request)
        logger.info(
          { ...request, objectKey: rendered.objectKey, bytes: rendered.bytes },
          'document rendered',
        )
      } else {
        logger.warn({ id: row.id, payload: row.payload }, 'render request unreadable; dropped')
      }
    } catch (error) {
      if (error instanceof DocumentNotFound) {
        logger.warn({ id: row.id, err: error }, 'document vanished before it was rendered; dropped')
      } else {
        // A storage or database fault: leave the row unpublished for the next tick, stop the batch so
        // one bad object cannot burn the whole run, and let pg-boss retry the job.
        logger.error({ id: row.id, err: error }, 'document render failed; will retry')
        throw error
      }
    }
    await db
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(eq(outboxEvents.id, row.id))
    done += 1
  }
  if (done > 0) logger.info({ count: done }, 'render requests drained')
  return done
}
