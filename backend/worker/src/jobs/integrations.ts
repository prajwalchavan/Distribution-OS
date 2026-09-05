import { and, eq, inArray, lt } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { exportJobs, importJobs, type Db, type TenantContext } from '@dos/db'
import {
  createImportServices,
  EXPORT_REQUESTED_EVENT,
  failRun,
  IMPORT_RUN_EVENT,
  registeredExportKinds,
  renderExportJob,
  runCommit,
  runDryRun,
  runStage,
  type ExportRenderPayload,
  type ImportRunPayload,
  type ImportServices,
} from '@dos/core/integrations'
import { logger } from '../logger.js'
import { registerOutboxHandler } from './outbox-relay.js'

/**
 * Integrations on pg-boss (coordination §3.5): TWO queues.
 *
 *   `imports.run`     one job per phase of the generic importer — stage (bytes → rows), dry_run (rows →
 *                     the diff), commit (rows → shops, listings, bills, history) — handed over by the
 *                     outbox row `integrations.import.run` the API writes when `INTEGRATIONS_INLINE_JOBS`
 *                     is off. Runs as the system role for the job's tenant, never `app_worker`.
 *   `exports.render`  the ONE render queue for every export kind: the registry maps `kind` → renderer;
 *                     integrations registered its six (plus the CSV twins) at import time, claims and
 *                     reporting register theirs at boot with `registerExportRenderer`. Handed over by
 *                     `integrations.export.requested`.
 *
 * A minute-by-minute sweep (`sweepIntegrations`) picks up anything the hand-off missed — an export
 * still `queued` after a while, an import still `queued` with no staging under way — bounded per run
 * and fair across tenants (one pass over the oldest rows, not one tenant's backlog).
 *
 * Every phase is a plain function from `@dos/core/integrations` (coordination §3.9); the owning-module
 * services it needs are built once per process by `createImportServices`, by hand, with no Nest DI.
 */
export const IMPORTS_RUN = 'imports.run'
export const EXPORTS_RENDER = 'exports.render'
export const INTEGRATIONS_SWEEP = 'integrations.sweep'

/** Queued rows older than this are considered missed by the hand-off and swept. */
const SWEEP_AFTER_SECONDS = 90
/** Rows per sweep: one tick clears a normal backlog without holding the worker for a big one. */
const SWEEP_BATCH = 50

const PHASES: ReadonlySet<string> = new Set(['stage', 'dry_run', 'commit'])

function parseImportPayload(value: unknown): ImportRunPayload | null {
  const p = value as Partial<ImportRunPayload> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.tenantId !== 'string' || typeof p.jobId !== 'string') return null
  const phase = typeof p.phase === 'string' && PHASES.has(p.phase) ? p.phase : null
  if (!phase) return null
  return {
    tenantId: p.tenantId,
    jobId: p.jobId,
    phase,
    actorId: typeof p.actorId === 'string' ? p.actorId : 'system',
    skipUnresolved: p.skipUnresolved === true,
  }
}

function parseExportPayload(value: unknown): ExportRenderPayload | null {
  const p = value as Partial<ExportRenderPayload> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.tenantId !== 'string' || typeof p.exportJobId !== 'string') return null
  return {
    tenantId: p.tenantId,
    exportJobId: p.exportJobId,
    actorId: typeof p.actorId === 'string' ? p.actorId : 'system',
  }
}

const systemCtx = (tenantId: string, actorId: string): TenantContext => ({
  tenantId,
  actorId,
  actorRole: 'system',
})

/** One import phase. A crash during a commit marks the job `failed` rather than leaving it `running` for ever. */
export async function handleImportRun(
  db: Db,
  services: ImportServices,
  payload: ImportRunPayload,
): Promise<void> {
  const ctx = systemCtx(payload.tenantId, payload.actorId)
  switch (payload.phase) {
    case 'stage': {
      const job = await runStage(db, ctx, services, payload.jobId)
      logger.info({ jobId: job.id, status: job.status, rows: job.totalRows }, 'imports.run: staged')
      return
    }
    case 'dry_run': {
      const job = await runDryRun(db, ctx, services, payload.jobId)
      logger.info({ jobId: job.id, dryRun: job.dryRun }, 'imports.run: dry run done')
      return
    }
    case 'commit': {
      try {
        const result = await runCommit(db, ctx, services, payload.jobId)
        logger.info({ jobId: payload.jobId, ...result }, 'imports.run: committed')
      } catch (error) {
        logger.error({ jobId: payload.jobId, err: error }, 'imports.run: commit run failed')
        await failRun(db, ctx, payload.jobId, error)
      }
      return
    }
  }
}

export async function handleExportRender(
  db: Db,
  services: ImportServices,
  payload: ExportRenderPayload,
): Promise<void> {
  const ctx = systemCtx(payload.tenantId, payload.actorId)
  const result = await renderExportJob(db, ctx, services, payload.exportJobId)
  logger.info({ exportJobId: payload.exportJobId, ...result }, 'exports.render: done')
}

/**
 * Queued rows the hand-off never reached (the relay was down, the outbox row was dead-lettered):
 * re-sent as jobs, oldest first, a bounded number per tick. Runs on the owner connection to see every
 * tenant; each job then runs tenant-scoped.
 */
export async function sweepIntegrations(db: Db, boss: PgBoss): Promise<number> {
  const stale = new Date(Date.now() - SWEEP_AFTER_SECONDS * 1000)
  const imports = await db
    .select({
      id: importJobs.id,
      tenantId: importJobs.tenantId,
      requestedBy: importJobs.requestedBy,
    })
    .from(importJobs)
    .where(and(eq(importJobs.status, 'queued'), lt(importJobs.createdAt, stale)))
    .orderBy(importJobs.createdAt)
    .limit(SWEEP_BATCH)
  for (const job of imports) {
    await boss.send(
      IMPORTS_RUN,
      { tenantId: job.tenantId, jobId: job.id, phase: 'stage', actorId: job.requestedBy },
      { singletonKey: `stage:${job.id}`, singletonSeconds: 60 },
    )
  }
  const exports = await db
    .select({
      id: exportJobs.id,
      tenantId: exportJobs.tenantId,
      requestedBy: exportJobs.requestedBy,
    })
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.status, 'queued'),
        lt(exportJobs.createdAt, stale),
        // Only kinds somebody can render: a `claim_sheet` queued before claims boots waits, unswept.
        inArray(exportJobs.kind, registeredExportKinds()),
      ),
    )
    .orderBy(exportJobs.createdAt)
    .limit(SWEEP_BATCH)
  for (const job of exports) {
    await boss.send(
      EXPORTS_RENDER,
      { tenantId: job.tenantId, exportJobId: job.id, actorId: job.requestedBy },
      { singletonKey: `render:${job.id}`, singletonSeconds: 60 },
    )
  }
  const count = imports.length + exports.length
  if (count > 0)
    logger.info({ imports: imports.length, exports: exports.length }, 'integrations: swept')
  return count
}

/** Register the two queues, their consumers and the outbox hand-offs. Called once by `main.ts`. */
export async function registerIntegrationsJobs(boss: PgBoss, db: Db): Promise<void> {
  const services = createImportServices(db)
  await boss.createQueue(IMPORTS_RUN)
  await boss.createQueue(EXPORTS_RENDER)

  registerOutboxHandler(IMPORT_RUN_EVENT, async (e) => {
    const payload = parseImportPayload(e.payload)
    if (!payload) {
      logger.warn({ id: e.id, payload: e.payload }, 'imports.run: unreadable hand-off; dropped')
      return
    }
    await boss.send(IMPORTS_RUN, payload, {
      singletonKey: `${payload.phase}:${payload.jobId}`,
      singletonSeconds: 5,
      expireInSeconds: 60 * 60,
    })
  })
  registerOutboxHandler(EXPORT_REQUESTED_EVENT, async (e) => {
    const payload = parseExportPayload(e.payload)
    if (!payload) {
      logger.warn({ id: e.id, payload: e.payload }, 'exports.render: unreadable hand-off; dropped')
      return
    }
    await boss.send(EXPORTS_RENDER, payload, {
      singletonKey: `render:${payload.exportJobId}`,
      singletonSeconds: 5,
      expireInSeconds: 60 * 60,
    })
  })

  await boss.work<ImportRunPayload>(IMPORTS_RUN, { batchSize: 1 }, async ([job]) => {
    const payload = job ? parseImportPayload(job.data) : null
    if (!payload) return
    await handleImportRun(db, services, payload)
  })
  await boss.work<ExportRenderPayload>(
    EXPORTS_RENDER,
    { batchSize: 1, localConcurrency: 2 },
    async ([job]) => {
      const payload = job ? parseExportPayload(job.data) : null
      if (!payload) return
      await handleExportRender(db, services, payload)
    },
  )
}
