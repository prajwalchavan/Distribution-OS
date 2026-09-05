import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ExtractionGetInput,
  ExtractionGetOutput,
  ExtractionsListInput,
  ExtractionsListOutput,
  RunExtractionInput,
  RunExtractionOutput,
} from '@dos/contracts'
import { extractionChecks, extractions, reviewSessions, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import {
  asCaller,
  DESK,
  loadDetail,
  loadDocumentOr404,
  lockDocument,
  notFound,
  transition,
} from './docint.internals.js'
import { toExtraction, type CheckRow } from './docint.mappers.js'
import { docintConfig } from './pipeline/config.js'
import { inlineRunner } from './pipeline/run.js'
import {
  DOCINT_EVENTS,
  emitDocumentEvent,
  escalateStep,
  extractStep,
  failDocument,
  matchStep,
  validateStep,
} from './pipeline/steps.js'
import { EngineFailure, EngineTransientError } from './pipeline/types.js'

type RunIn = z.infer<typeof RunExtractionInput>
type RunOut = z.infer<typeof RunExtractionOutput>
type ListIn = z.infer<typeof ExtractionsListInput>
type ListOut = z.infer<typeof ExtractionsListOutput>
type GetIn = z.infer<typeof ExtractionGetInput>
type GetOut = z.infer<typeof ExtractionGetOutput>

/** The engine readings of a document. Everything here carries printed purchase rates: back office only. */
@Injectable()
export class ExtractionsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Retry or escalate by hand: `status → extracting` through the machine (`retry`), then the
   * `docint.extract` job — inline when configured, else the outbox row the relay turns into the job.
   * Refused while a review session is `open`, on a committed document, and — without `force` — on a
   * document that already has a reading.
   */
  async run(input: RunIn): Promise<RunOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        const [open] = await tx
          .select({ id: reviewSessions.id })
          .from(reviewSessions)
          .where(
            and(
              eq(reviewSessions.documentId, doc.id),
              eq(reviewSessions.status, 'open'),
              gt(reviewSessions.lockedUntil, new Date()),
            ),
          )
          .limit(1)
        if (open)
          throw new ORPCError('CONFLICT', {
            message: 'a review session is open on this document; release it before re-reading',
            data: { code: 'review_open', reviewSessionId: open.id },
          })
        const [existing] = await tx
          .select({ id: extractions.id })
          .from(extractions)
          .where(eq(extractions.documentId, doc.id))
          .limit(1)
        if (existing && !input.force)
          throw new ORPCError('CONFLICT', {
            message: 'the document already has a reading; send force: true to read it again',
            data: { code: 'force_required', extractionId: existing.id },
          })
        // `retry` is legal from extracted / needs_review / reviewed; `verified` covers a document
        // whose first run never started (still verifying). Anything else the machine refuses (409).
        doc = await transition(tx, doc, doc.status === 'verifying' ? 'verified' : 'retry', {
          failureCode: null,
        })
        await emitDocumentEvent(tx, doc, DOCINT_EVENTS.submitted, {
          kind: doc.kind,
          supplierId: doc.supplierId,
          engine: input.engine,
          retry: true,
          baseExtractionId: existing?.id ?? null,
        })
        if (docintConfig().inlineJobs) {
          const runner = inlineRunner(tx, ctx)
          const job = { tenantId: ctx.tenantId, documentId: doc.id }
          try {
            if (input.engine === 'llm_vision_secondary' && existing) {
              await escalateStep(runner, job, { extractionId: existing.id })
            } else {
              const read = await extractStep(runner, job, { engine: input.engine })
              if (read.extractionId)
                await validateStep(runner, job, { extractionId: read.extractionId })
            }
            await matchStep(runner, job)
          } catch (error) {
            if (error instanceof EngineFailure || error instanceof EngineTransientError) {
              await failDocument(runner, job)
            } else throw error
          }
          doc = await loadDocumentOr404(tx, doc.id)
        }
        return { item: await loadDetail(tx, doc), jobId: doc.jobId }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const doc = await loadDocumentOr404(tx, input.id)
      const rows = await tx
        .select()
        .from(extractions)
        .where(eq(extractions.documentId, doc.id))
        .orderBy(desc(extractions.createdAt), desc(extractions.id))
        .limit(50)
      const checks = await checksFor(
        tx,
        rows.map((r) => r.id),
      )
      return {
        items: rows.map((r) => toExtraction(r, checks.get(r.id) ?? [], input.includeResult)),
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const [row] = await tx.select().from(extractions).where(eq(extractions.id, input.id)).limit(1)
      if (!row) throw notFound('extraction', input.id)
      const checks = await checksFor(tx, [row.id])
      return { item: toExtraction(row, checks.get(row.id) ?? [], true) }
    })
  }
}

/** Checks per extraction, in insertion order (header checks first, then line by line). */
export async function checksFor(tx: Db, extractionIds: string[]): Promise<Map<string, CheckRow[]>> {
  const out = new Map<string, CheckRow[]>()
  if (extractionIds.length === 0) return out
  const rows = await tx
    .select()
    .from(extractionChecks)
    .where(inArray(extractionChecks.extractionId, extractionIds))
    .orderBy(asc(extractionChecks.id))
  for (const row of rows) {
    const list = out.get(row.extractionId) ?? []
    list.push(row)
    out.set(row.extractionId, list)
  }
  return out
}
