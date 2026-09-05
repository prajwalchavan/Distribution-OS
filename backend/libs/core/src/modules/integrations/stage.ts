import { and, asc, eq, gt } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { ImportTarget } from '@dos/contracts'
import { importJobs, importRows, withTenant, type Db, type TenantContext } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { createObjectStorage, ObjectStorageError } from '../../platform/object-storage.js'
import {
  friendlyMessage,
  integrationsConfig,
  jobTransition,
  rowIdFor,
} from './integrations.internals.js'
import { parseSource, SourceFileError } from './parsing.js'
import {
  emptyStats,
  jobMapping,
  mappingProblemsMessage,
  mergeStats,
  scoreRows,
  summaryFrom,
  type SeenKeys,
} from './scoring.js'
import type { ImportServices } from './services.js'

/**
 * THE TWO WORKER PHASES THAT CREATE NOTHING: staging (bytes → `import_rows`) and the dry run (rows →
 * statuses and the diff). Both are plain functions over `(db, ctx)` so the API runs them inline and the
 * pg-boss worker runs them as the system role for the job's tenant (`INTEGRATIONS_INLINE_JOBS`).
 */

type JobRecord = typeof importJobs.$inferSelect

async function loadJob(tx: Db, tenantId: string, jobId: string): Promise<JobRecord> {
  const [job] = await tx
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
    .limit(1)
  if (!job) throw new ORPCError('NOT_FOUND', { message: `import ${jobId} not found` })
  return job
}

/**
 * Stage a `queued` job: read the file from object storage, parse it, write one `import_rows` row per
 * source row (deterministic ids: staging twice writes the same rows), record the detected columns and
 * the sheet list, then `staged` — or `failed` with an English reason when the file cannot be read. When
 * the job already carries a mapping (a profile or an inline mapping on create) the rows are scored
 * straight away, so the wizard opens on the diff and not on an empty grid.
 */
export async function runStage(
  db: Db,
  ctx: TenantContext,
  services: ImportServices,
  jobId: string,
): Promise<JobRecord> {
  return tenantStorage.run(ctx, async () => {
    const job = await withTenant(db, ctx, (tx) => loadJob(tx, ctx.tenantId, jobId))
    if (job.status !== 'queued') return job
    await withTenant(db, ctx, (tx) =>
      tx
        .update(importJobs)
        .set({ startedAt: new Date(), updatedAt: new Date() })
        .where(eq(importJobs.id, job.id)),
    )
    let parsed
    try {
      const bytes = await createObjectStorage().get(job.sourceObjectKey)
      parsed = parseSource(bytes, { hasHeaderRow: job.hasHeaderRow, sheetName: job.sheetName })
    } catch (error) {
      const message =
        error instanceof SourceFileError
          ? error.message
          : error instanceof ObjectStorageError && error.code === 'not_found'
            ? 'the uploaded file was not found; upload it again and create a new import'
            : friendlyMessage(error)
      return withTenant(db, ctx, async (tx) => {
        const [failed] = await tx
          .update(importJobs)
          .set({
            status: jobTransition('queued', 'fail'),
            error: message,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        return failed ?? job
      })
    }
    const { batchSize } = integrationsConfig()
    for (let start = 0; start < parsed.rows.length; start += batchSize) {
      const slice = parsed.rows.slice(start, start + batchSize)
      await withTenant(db, ctx, (tx) =>
        tx
          .insert(importRows)
          .values(
            slice.map((raw, i) => ({
              id: rowIdFor(job.id, start + i + 1),
              tenantId: ctx.tenantId,
              importJobId: job.id,
              rowNo: start + i + 1,
              raw,
              status: 'staged' as const,
            })),
          )
          .onConflictDoNothing(),
      )
    }
    const staged = await withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .update(importJobs)
        .set({
          status: jobTransition('queued', 'stage'),
          sourceColumns: parsed.headers,
          sheetNames: parsed.sheetNames.length > 0 ? parsed.sheetNames : null,
          totalRows: parsed.rows.length,
          finishedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, job.id))
        .returning()
      return row ?? job
    })
    if (jobMapping(staged)) return runDryRun(db, ctx, services, job.id)
    return staged
  })
}

/**
 * Score every row of a `staged` job, batch by batch, each batch its own transaction, and store the
 * summary on the job. A missing or wrong mapping is a 400 on the API path; the worker stores it as the
 * summary's only error instead. The job's status never changes.
 */
export async function runDryRun(
  db: Db,
  ctx: TenantContext,
  services: ImportServices,
  jobId: string,
): Promise<JobRecord> {
  return tenantStorage.run(ctx, async () => {
    const job = await withTenant(db, ctx, (tx) => loadJob(tx, ctx.tenantId, jobId))
    const mapping = jobMapping(job)
    if (!mapping)
      throw new ORPCError('BAD_REQUEST', {
        message: 'map the columns before running a dry run (mapping_missing)',
        data: { code: 'mapping_missing' },
      })
    const problem = mappingProblemsMessage(mapping, job.target as ImportTarget)
    if (problem)
      throw new ORPCError('BAD_REQUEST', {
        message: `the mapping is incomplete: ${problem}`,
        data: { code: 'mapping_invalid' },
      })
    const startedAt = new Date().toISOString()
    await withTenant(db, ctx, (tx) =>
      tx
        .update(importJobs)
        .set({
          dryRun: summaryFrom(emptyStats(), job.target as ImportTarget, startedAt, null),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, job.id)),
    )
    const { batchSize } = integrationsConfig()
    const total = emptyStats()
    const seen: SeenKeys = new Map()
    let after = 0
    for (;;) {
      const done = await withTenant(db, ctx, async (tx) => {
        const batch = await tx
          .select()
          .from(importRows)
          .where(
            and(
              eq(importRows.tenantId, ctx.tenantId),
              eq(importRows.importJobId, job.id),
              gt(importRows.rowNo, after),
            ),
          )
          .orderBy(asc(importRows.rowNo))
          .limit(batchSize)
        if (batch.length === 0) return true
        mergeStats(total, await scoreRows(tx, services, job, mapping, batch, seen))
        after = batch[batch.length - 1]?.rowNo ?? after
        return batch.length < batchSize
      })
      if (done) break
    }
    return withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .update(importJobs)
        .set({
          dryRun: summaryFrom(
            total,
            job.target as ImportTarget,
            startedAt,
            new Date().toISOString(),
          ),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, job.id))
        .returning()
      return row ?? job
    })
  })
}
