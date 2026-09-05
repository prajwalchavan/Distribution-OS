import { sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { withSystem, type Db } from '@dos/db'
import {
  docintConfig,
  DocumentGone,
  EngineFailure,
  EngineTransientError,
  escalateStep,
  extractStep,
  failDocument,
  loadDocumentRow,
  matchStep,
  qrReadStep,
  systemRunner,
  validateStep,
  type PipelineJob,
} from '@dos/core/docint'
import { logger } from '../logger.js'
import { registerOutboxHandler } from './outbox-relay.js'

/**
 * The docint pipeline on pg-boss (docs/plans/docint.md §7, task: "qr-read, extract, validate, match,
 * each idempotent, each updating the document status"). Four queues chained one after the other so
 * a retry replays ONE step — the engine call is never repeated because a later step failed:
 *
 *   outbox `docint.document.submitted` → docint.qr-read → docint.extract → docint.validate → docint.match
 *
 * Every step is a plain function from `@dos/core/docint` (coordination §3.9 worker rule) run as the
 * system role for the document's tenant (`systemRunner`). `extract` is the one step with a network
 * call: an `EngineTransientError` (rate limit, 5xx) is rethrown so pg-boss retries with backoff, an
 * `EngineFailure` (bad JSON, refusal) too — until `attempt_count` reaches `DOCINT_MAX_ATTEMPTS`, when
 * the document is `failed` (`failure_code = extraction_failed`) and manual typing through
 * `procurement.supplierInvoices.create` is allowed. Concurrency is bounded per queue (docs/20 rule 6)
 * and jobs carry `singletonKey = documentId` so a duplicate outbox delivery is a no-op.
 */
export const DOCINT_QR_READ = 'docint.qr-read'
export const DOCINT_EXTRACT = 'docint.extract'
export const DOCINT_VALIDATE = 'docint.validate'
export const DOCINT_MATCH = 'docint.match'
export const DOCINT_QUEUES = [
  DOCINT_QR_READ,
  DOCINT_EXTRACT,
  DOCINT_VALIDATE,
  DOCINT_MATCH,
] as const

export interface DocintJobPayload extends PipelineJob {
  /** The user who submitted; recorded as the system actor's id on the tenant transaction. */
  actorId: string
  extractionId?: string | null | undefined
}

/** Engine calls in flight at once across every tenant; each is one HTTP request of up to 20 images. */
const EXTRACT_CONCURRENCY = Number(process.env.DOCINT_EXTRACT_CONCURRENCY) || 4
/** How long pg-boss waits before the first engine retry; doubles each time (`retryBackoff`). */
const EXTRACT_RETRY_DELAY_SECONDS = 30

function parsePayload(value: unknown): DocintJobPayload | null {
  const p = value as Partial<DocintJobPayload> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.tenantId !== 'string' || typeof p.documentId !== 'string') return null
  return {
    tenantId: p.tenantId,
    documentId: p.documentId,
    actorId: typeof p.actorId === 'string' ? p.actorId : 'system',
    extractionId: typeof p.extractionId === 'string' ? p.extractionId : null,
  }
}

/** Send the next step for a document; the singleton key folds a duplicate delivery into one job. */
async function next(
  boss: PgBoss,
  queue: string,
  payload: DocintJobPayload,
  opts: object = {},
): Promise<string | null> {
  return boss.send(queue, payload, {
    singletonKey: payload.documentId,
    singletonSeconds: 5,
    ...opts,
  })
}

async function stampJobId(db: Db, documentId: string, jobId: string | null): Promise<void> {
  if (!jobId) return
  await withSystem(db, (tx) =>
    tx.execute(
      sql`update documents set job_id = ${jobId}, updated_at = now() where id = ${documentId}`,
    ),
  )
}

/**
 * Register the queues, their consumers and the outbox handler that starts the chain. Called once by
 * `main.ts`; returns nothing the caller needs.
 */
export async function registerDocintJobs(boss: PgBoss, db: Db): Promise<void> {
  for (const queue of DOCINT_QUEUES) await boss.createQueue(queue)

  // outbox → the first step. The relay runs this inside its claiming transaction; `boss.send` is a
  // separate connection, so a failure here leaves the outbox row unpublished for the next tick.
  registerOutboxHandler('docint.document.submitted', async (e) => {
    const payload = e.payload as { uploadedBy?: unknown } | null
    const job: DocintJobPayload = {
      tenantId: e.tenantId,
      documentId: e.aggregateId,
      actorId: typeof payload?.uploadedBy === 'string' ? payload.uploadedBy : 'system',
    }
    const jobId = await next(boss, DOCINT_QR_READ, job)
    await stampJobId(db, job.documentId, jobId)
    logger.info({ documentId: job.documentId, jobId }, 'docint: pipeline queued')
  })

  await boss.work<DocintJobPayload>(DOCINT_QR_READ, { batchSize: 1 }, async ([job]) => {
    const payload = job ? parsePayload(job.data) : null
    if (!payload) return
    const runner = systemRunner(db, payload.tenantId, payload.actorId)
    const state = await qrReadStep(runner, payload)
    if (state.status === 'extracting') await next(boss, DOCINT_EXTRACT, payload, extractRetry())
  })

  await boss.work<DocintJobPayload>(
    DOCINT_EXTRACT,
    { batchSize: 1, localConcurrency: EXTRACT_CONCURRENCY },
    async ([job]) => {
      const payload = job ? parsePayload(job.data) : null
      if (!payload) return
      const runner = systemRunner(db, payload.tenantId, payload.actorId)
      const config = docintConfig()
      let state
      try {
        state = await extractStep(runner, payload, { config })
      } catch (error) {
        if (error instanceof DocumentGone) {
          logger.warn(
            { documentId: payload.documentId },
            'docint: document vanished before extraction',
          )
          return
        }
        const doc = await runner.run((tx) => loadDocumentRow(tx, payload.documentId))
        const retryable = error instanceof EngineTransientError || error instanceof EngineFailure
        if (!retryable || !doc || doc.attemptCount >= config.maxAttempts) {
          logger.error(
            { documentId: payload.documentId, err: error, attempts: doc?.attemptCount },
            'docint: extraction failed for good',
          )
          await failDocument(runner, payload)
          return
        }
        logger.warn(
          { documentId: payload.documentId, err: error, attempts: doc.attemptCount },
          'docint: extraction attempt failed; retrying',
        )
        throw error
      }
      if (!state.extractionId) return
      await next(boss, DOCINT_VALIDATE, { ...payload, extractionId: state.extractionId })
    },
  )

  await boss.work<DocintJobPayload>(DOCINT_VALIDATE, { batchSize: 1 }, async ([job]) => {
    const payload = job ? parsePayload(job.data) : null
    if (!payload) return
    const runner = systemRunner(db, payload.tenantId, payload.actorId)
    const config = docintConfig()
    const state = await validateStep(runner, payload, {
      extractionId: payload.extractionId ?? undefined,
    })
    if (state.escalate && config.autoEscalate && state.extractionId) {
      try {
        await escalateStep(runner, payload, { extractionId: state.extractionId }, { config })
      } catch (error) {
        // A failed second reading never fails the document: the first reading goes to review as it is.
        logger.warn(
          { documentId: payload.documentId, err: error },
          'docint: escalation failed; first reading stands',
        )
      }
    }
    await next(boss, DOCINT_MATCH, { ...payload, extractionId: null })
  })

  await boss.work<DocintJobPayload>(DOCINT_MATCH, { batchSize: 1 }, async ([job]) => {
    const payload = job ? parsePayload(job.data) : null
    if (!payload) return
    const runner = systemRunner(db, payload.tenantId, payload.actorId)
    const state = await matchStep(runner, payload)
    logger.info(
      {
        documentId: payload.documentId,
        status: state.status,
        errors: state.errors,
        warnings: state.warnings,
        unmatched: state.unmatched,
      },
      'docint: document ready',
    )
  })
}

/** pg-boss retry policy for the engine step: `DOCINT_MAX_ATTEMPTS` tries, exponential backoff. */
function extractRetry(): object {
  return {
    retryLimit: Math.max(0, docintConfig().maxAttempts - 1),
    retryDelay: EXTRACT_RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
  }
}
