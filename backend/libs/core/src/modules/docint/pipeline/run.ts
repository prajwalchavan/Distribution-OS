import { sql } from 'drizzle-orm'
import { withTenant, type Db, type TenantContext } from '@dos/db'
import type { ObjectStorage } from '../../../platform/object-storage.js'
import { docintConfig, type DocintConfig } from './config.js'
import {
  DocumentGone,
  escalateStep,
  extractStep,
  failDocument,
  loadDocumentRow,
  matchStep,
  qrReadStep,
  validateStep,
} from './steps.js'
import {
  EngineFailure,
  EngineTransientError,
  type ExtractionEngineAdapter,
  type PipelineJob,
  type PipelineRunner,
  type StepResult,
} from './types.js'

/**
 * The whole pipeline in one call: qr-read → extract (up to `maxAttempts`) → validate → (escalate) →
 * match. This is the inline path (`DOCINT_INLINE_JOBS`, specs and the local demo) and the worker's
 * fallback when it is asked to run a document end to end; the worker normally runs the four steps
 * as four chained pg-boss jobs (`backend/worker/src/jobs/docint.ts`) so a retry replays one step,
 * not the engine call.
 */
export interface RunPipelineOptions {
  config?: DocintConfig | undefined
  adapter?: ExtractionEngineAdapter | undefined
  storage?: ObjectStorage | undefined
}

export async function runPipeline(
  runner: PipelineRunner,
  job: PipelineJob,
  opts: RunPipelineOptions = {},
): Promise<StepResult> {
  const config = opts.config ?? docintConfig()
  const started = await qrReadStep(runner, job)
  if (started.status !== 'extracting') return started
  let extracted: StepResult | null = null
  for (let guard = 0; guard < config.maxAttempts + 1 && !extracted; guard++) {
    try {
      extracted = await extractStep(runner, job, { ...opts, config })
    } catch (error) {
      if (error instanceof DocumentGone) throw error
      const permanent = !(error instanceof EngineTransientError || error instanceof EngineFailure)
      const doc = await runner.run((tx) => loadDocumentRow(tx, job.documentId))
      if (permanent || !doc || doc.attemptCount >= config.maxAttempts) {
        return failDocument(runner, job)
      }
    }
  }
  if (!extracted?.extractionId) return failDocument(runner, job)
  const validated = await validateStep(runner, job, { extractionId: extracted.extractionId })
  if (validated.escalate && config.autoEscalate) {
    try {
      await escalateStep(runner, job, { extractionId: extracted.extractionId }, { ...opts, config })
    } catch (error) {
      // A failed second reading never fails the document: the first reading goes to review as it is.
      if (error instanceof DocumentGone) throw error
    }
  }
  return matchStep(runner, job)
}

/** The worker's runner: every `run` is its own tenant transaction as the system role. */
export function systemRunner(db: Db, tenantId: string, actorId: string): PipelineRunner {
  const ctx: TenantContext = { tenantId, actorId, actorRole: 'system' }
  return { tenantId, run: (fn) => withTenant(db, ctx, fn) }
}

/**
 * The inline runner: the request's own transaction, escalated to the system role for the duration
 * of each step so the pipeline may write the priced tables even when a warehouse phone submitted.
 * Restores the caller's role afterwards; the caller's `withTenant` still owns the commit.
 */
export function inlineRunner(tx: Db, ctx: TenantContext): PipelineRunner {
  return {
    tenantId: ctx.tenantId,
    run: async (fn) => {
      if (ctx.actorRole === 'system') return fn(tx)
      await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
      try {
        return await fn(tx)
      } finally {
        await tx
          .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
          .catch(() => undefined)
      }
    },
  }
}
