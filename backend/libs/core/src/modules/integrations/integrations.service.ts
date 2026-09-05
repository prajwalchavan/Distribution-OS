import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CancelImportInput,
  CancelImportOutput,
  CommitImportInput,
  CommitImportOutput,
  ConfirmImportInput,
  ConfirmImportOutput,
  CreateImportInput,
  CreateImportOutput,
  DryRunImportInput,
  DryRunImportOutput,
  ImportGetInput,
  ImportGetOutput,
  ImportJobDetail,
  ImportMapping,
  ImportPreviewInput,
  ImportPreviewOutput,
  ImportRowsListInput,
  ImportRowsListOutput,
  ImportsListInput,
  ImportsListOutput,
  ImportTarget,
  ProfilesListInput,
  ProfilesListOutput,
  ReviewImportRowInput,
  ReviewImportRowOutput,
  RollbackImportInput,
  RollbackImportOutput,
  SetImportMappingInput,
  SetImportMappingOutput,
  UpsertProfileInput,
  UpsertProfileOutput,
} from '@dos/contracts'
import { INLINE_DRY_RUN_ROWS } from '@dos/contracts'
import {
  importJobs,
  importProfiles,
  importRows,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  OWNER,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { assertTenantKey, ObjectStorageError } from '../../platform/object-storage.js'
import { BillingService, RegistersService } from '../billing/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { SupplierInvoiceService } from '../procurement/index.js'
import { RetailersService } from '../retailers/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'
import { rollbackRows, runCommit } from './commit.js'
import {
  builtinProfileId,
  emitIntegrationsEvent,
  IMPORT_RUN_EVENT,
  integrationsConfig,
  jobTransition,
  type ImportRunPayload,
} from './integrations.internals.js'
import {
  detectedColumns,
  toImportJob,
  toImportJobDetail,
  toImportRow,
  toProfile,
} from './integrations.mappers.js'
import { validateMappingForTarget } from './mapping.js'
import { BUILTIN_PROFILES } from './profiles.data.js'
import {
  jobMapping,
  mappingProblemsMessage,
  resetRows,
  rowCounts,
  scoreAllRows,
  scoreRows,
  summaryFrom,
} from './scoring.js'
import type { ImportServices } from './services.js'
import { runStage } from './stage.js'

type CreateIn = z.infer<typeof CreateImportInput>
type CreateOut = z.infer<typeof CreateImportOutput>
type ListIn = z.infer<typeof ImportsListInput>
type ListOut = z.infer<typeof ImportsListOutput>
type GetIn = z.infer<typeof ImportGetInput>
type GetOut = z.infer<typeof ImportGetOutput>
type PreviewIn = z.infer<typeof ImportPreviewInput>
type PreviewOut = z.infer<typeof ImportPreviewOutput>
type MappingIn = z.infer<typeof SetImportMappingInput>
type MappingOut = z.infer<typeof SetImportMappingOutput>
type DryRunIn = z.infer<typeof DryRunImportInput>
type DryRunOut = z.infer<typeof DryRunImportOutput>
type RowsIn = z.infer<typeof ImportRowsListInput>
type RowsOut = z.infer<typeof ImportRowsListOutput>
type ReviewIn = z.infer<typeof ReviewImportRowInput>
type ReviewOut = z.infer<typeof ReviewImportRowOutput>
type CommitIn = z.infer<typeof CommitImportInput>
type CommitOut = z.infer<typeof CommitImportOutput>
type ConfirmIn = z.infer<typeof ConfirmImportInput>
type ConfirmOut = z.infer<typeof ConfirmImportOutput>
type RollbackIn = z.infer<typeof RollbackImportInput>
type RollbackOut = z.infer<typeof RollbackImportOutput>
type CancelIn = z.infer<typeof CancelImportInput>
type CancelOut = z.infer<typeof CancelImportOutput>
type ProfilesIn = z.infer<typeof ProfilesListInput>
type ProfilesOut = z.infer<typeof ProfilesListOutput>
type ProfileIn = z.infer<typeof UpsertProfileInput>
type ProfileOut = z.infer<typeof UpsertProfileOutput>

type JobRecord = typeof importJobs.$inferSelect

/** Statuses a job holds rows in — `preview` and `rows.list` are answerable from here on. */
const HAS_ROWS = new Set(['staged', 'running', 'committed', 'confirmed', 'rolled_back'])

/**
 * THE GENERIC MAPPED IMPORTER (docs/17 §D7; the contract header in
 * `backend/libs/contracts/src/integrations.ts` is the specification this file implements):
 * upload → create → preview → map → dry run → review → commit → confirm | rollback, for any CSV /
 * XLSX and five targets, through the owning modules' services and never their tables.
 *
 * Long work runs INLINE on the founder's Mac (`INTEGRATIONS_INLINE_JOBS`, default outside production)
 * and on the pg-boss worker otherwise — the same `runStage` / `runDryRun` / `runCommit` functions in
 * `stage.ts` / `commit.ts`, called here after the request's own transaction commits or from
 * `worker.ts` after an outbox hand-off. A dry run at or below `INLINE_DRY_RUN_ROWS` always answers
 * inline, inside the request's transaction, so its response is the finished diff.
 *
 * Replays: every mutation is `idempotent()` on its key. A replayed `commit` answers what the first
 * call answered at the moment the run was accepted (`running`, or the finished state when it ran
 * inline); `imports.get` is always the current state.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly retailers: RetailersService,
    private readonly tenantCatalog: TenantCatalogService,
    private readonly billing: BillingService,
    private readonly receivables: ReceivablesService,
    private readonly registers: RegistersService,
    private readonly supplierInvoices: SupplierInvoiceService,
  ) {}

  /** The owning-module services the plain functions take, exactly the set the worker builds by hand. */
  get services(): ImportServices {
    return {
      retailers: this.retailers,
      tenantCatalog: this.tenantCatalog,
      billing: this.billing,
      receivables: this.receivables,
      registers: this.registers,
      supplierInvoices: this.supplierInvoices,
    }
  }

  // =============================================================================================================
  // the wizard
  // =============================================================================================================

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    try {
      assertTenantKey(input.sourceObjectKey, ctx.tenantId)
    } catch (error) {
      if (error instanceof ObjectStorageError)
        throw new ORPCError('BAD_REQUEST', { message: error.message })
      throw error
    }
    if (input.mapping) this.assertMapping(input.mapping, input.target)
    await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await ensureBuiltinProfiles(tx, ctx.tenantId)
        const [existing] = await tx
          .select({ id: importJobs.id })
          .from(importJobs)
          .where(and(eq(importJobs.tenantId, ctx.tenantId), eq(importJobs.id, input.id)))
          .limit(1)
        if (existing) return { id: existing.id }
        let profile: typeof importProfiles.$inferSelect | null = null
        if (input.profileId) {
          const [row] = await tx
            .select()
            .from(importProfiles)
            .where(
              and(
                eq(importProfiles.tenantId, ctx.tenantId),
                eq(importProfiles.id, input.profileId),
              ),
            )
            .limit(1)
          if (!row)
            throw new ORPCError('NOT_FOUND', { message: `profile ${input.profileId} not found` })
          if (row.target !== input.target)
            throw new ORPCError('CONFLICT', {
              message: `profile "${row.name}" maps columns for ${row.target} and cannot drive a ${input.target} import`,
            })
          profile = row
        }
        const mapping = input.mapping ?? (profile ? jobMapping(profile) : null)
        await tx.insert(importJobs).values({
          id: input.id,
          tenantId: ctx.tenantId,
          kind: input.source,
          target: input.target,
          sourceObjectKey: input.sourceObjectKey,
          sourceFileName: input.fileName ?? null,
          profileId: profile?.id ?? null,
          mapping: mapping ?? {},
          hasHeaderRow: input.hasHeaderRow ?? profile?.hasHeaderRow ?? true,
          sheetName: input.sheetName ?? profile?.sheetName ?? null,
          status: 'queued',
          requestedBy: ctx.actorId,
        })
        if (profile)
          await tx
            .update(importProfiles)
            .set({
              usedCount: sql`${importProfiles.usedCount} + 1`,
              lastUsedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(importProfiles.id, profile.id))
        if (!integrationsConfig().inlineJobs)
          await emitIntegrationsEvent(tx, 'import_job', input.id, IMPORT_RUN_EVENT, {
            tenantId: ctx.tenantId,
            jobId: input.id,
            phase: 'stage',
            actorId: ctx.actorId,
          } satisfies ImportRunPayload)
        return { id: input.id }
      }),
    )
    if (integrationsConfig().inlineJobs) await runStage(db, ctx, this.services, input.id)
    return { item: toImportJob(await this.load(db, ctx, input.id)) }
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(importJobs.tenantId, ctx.tenantId),
        input.source ? eq(importJobs.kind, input.source) : undefined,
        input.target ? eq(importJobs.target, input.target) : undefined,
        input.status ? eq(importJobs.status, input.status) : undefined,
        input.from ? sql`${importJobs.createdAt} >= ${istStart(input.from)}` : undefined,
        input.to ? sql`${importJobs.createdAt} < ${istStart(input.to, 1)}` : undefined,
        input.cursor ? lt(importJobs.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(importJobs)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(importJobs.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toImportJob)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => ({
      item: await this.detail(tx, await this.find(tx, input.id)),
    }))
  }

  async preview(input: PreviewIn): Promise<PreviewOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const job = await this.find(tx, input.id)
      if (!HAS_ROWS.has(job.status))
        throw new ORPCError('CONFLICT', {
          message:
            job.status === 'failed'
              ? `the file could not be staged: ${job.error ?? 'unknown reason'}`
              : `the import is ${job.status}; its rows are not available yet`,
        })
      const rows = await tx
        .select({ rowNo: importRows.rowNo, raw: importRows.raw })
        .from(importRows)
        .where(and(eq(importRows.tenantId, ctx.tenantId), eq(importRows.importJobId, job.id)))
        .orderBy(asc(importRows.rowNo))
        .limit(input.rows)
      const samples = rows.map((r) => (r.raw as Record<string, string> | null) ?? {})
      return {
        columns: detectedColumns(job, samples),
        rows: rows.map((r, i) => ({ rowNo: r.rowNo, cells: samples[i] ?? {} })),
        totalRows: job.totalRows ?? 0,
        sheetNames: Array.isArray(job.sheetNames)
          ? (job.sheetNames as unknown[]).filter((s): s is string => typeof s === 'string')
          : [],
        hasHeaderRow: job.hasHeaderRow,
      }
    })
  }

  async setMapping(input: MappingIn): Promise<MappingOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status !== 'staged')
          throw new ORPCError('CONFLICT', {
            message: `the import is ${job.status}; the mapping can only change while it is staged`,
          })
        this.assertMapping(input.mapping, job.target as ImportTarget)
        let profile: typeof importProfiles.$inferSelect | null = null
        if (input.saveAsProfile) {
          profile = await upsertProfile(tx, ctx, {
            id: input.saveAsProfile.id,
            name: input.saveAsProfile.name,
            source: job.kind,
            target: job.target,
            mapping: input.mapping,
            hasHeaderRow: job.hasHeaderRow,
            sheetName: job.sheetName,
            sourceColumns: job.sourceColumns,
          })
        }
        const [updated] = await tx
          .update(importJobs)
          .set({
            mapping: input.mapping,
            dryRun: null,
            ...(profile ? { profileId: profile.id } : {}),
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        await resetRows(tx, job.id)
        return {
          item: await this.detail(tx, updated ?? job),
          profile: profile ? toProfile(profile) : null,
        }
      }),
    )
  }

  async dryRun(input: DryRunIn): Promise<DryRunOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const config = integrationsConfig()
    const result = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status !== 'staged')
          throw new ORPCError('CONFLICT', {
            message: `the import is ${job.status}; a dry run needs a staged import`,
          })
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
        const inline = config.inlineJobs || (job.totalRows ?? 0) <= INLINE_DRY_RUN_ROWS
        const startedAt = new Date().toISOString()
        if (inline) {
          const stats = await scoreAllRows(tx, this.services, job, mapping, config.batchSize)
          const [updated] = await tx
            .update(importJobs)
            .set({
              dryRun: summaryFrom(
                stats,
                job.target as ImportTarget,
                startedAt,
                new Date().toISOString(),
              ),
              updatedAt: new Date(),
            })
            .where(eq(importJobs.id, job.id))
            .returning()
          return { item: await this.detail(tx, updated ?? job), deferred: false }
        }
        const [updated] = await tx
          .update(importJobs)
          .set({
            dryRun: summaryFrom(
              {
                rows: 0,
                create: 0,
                update: 0,
                skip: 0,
                needsReview: 0,
                errors: 0,
                amountPaise: 0,
                sampleErrors: [],
              },
              job.target as ImportTarget,
              startedAt,
              null,
            ),
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        await emitIntegrationsEvent(tx, 'import_job', job.id, IMPORT_RUN_EVENT, {
          tenantId: ctx.tenantId,
          jobId: job.id,
          phase: 'dry_run',
          actorId: ctx.actorId,
        } satisfies ImportRunPayload)
        return { item: await this.detail(tx, updated ?? job), deferred: true }
      }),
    )
    return { item: result.item }
  }

  async listRows(input: RowsIn): Promise<RowsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const job = await this.find(tx, input.id)
      let afterRowNo = 0
      if (input.cursor) {
        const [cursorRow] = await tx
          .select({ rowNo: importRows.rowNo })
          .from(importRows)
          .where(and(eq(importRows.importJobId, job.id), eq(importRows.id, input.cursor)))
          .limit(1)
        afterRowNo = cursorRow?.rowNo ?? (Number(input.cursor) || 0)
      }
      const filters: (SQL | undefined)[] = [
        eq(importRows.tenantId, ctx.tenantId),
        eq(importRows.importJobId, job.id),
        input.status ? eq(importRows.status, input.status) : undefined,
        input.plan ? eq(importRows.plan, input.plan) : undefined,
        input.problemsOnly ? inArray(importRows.status, ['error', 'needs_review']) : undefined,
        afterRowNo > 0 ? gt(importRows.rowNo, afterRowNo) : undefined,
      ]
      const rows = await tx
        .select()
        .from(importRows)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(importRows.rowNo))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toImportRow)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async reviewRow(input: ReviewIn): Promise<ReviewOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status !== 'staged')
          throw new ORPCError('CONFLICT', {
            message: `the import is ${job.status}; rows can only be reviewed while it is staged`,
          })
        const [row] = await tx
          .select()
          .from(importRows)
          .where(and(eq(importRows.importJobId, job.id), eq(importRows.id, input.rowId)))
          .for('update')
        if (!row) throw new ORPCError('NOT_FOUND', { message: `row ${input.rowId} not found` })
        const now = new Date()
        if (input.skip) {
          const [skipped] = await tx
            .update(importRows)
            .set({
              status: 'skipped',
              plan: 'skip',
              error: null,
              reviewedBy: ctx.actorId,
              reviewedAt: now,
              updatedAt: now,
            })
            .where(eq(importRows.id, row.id))
            .returning()
          return { item: toImportRow(skipped ?? row) }
        }
        if (input.retailerId) {
          const known = await this.retailers.labels(tx, [input.retailerId])
          if (!known.has(input.retailerId))
            throw new ORPCError('NOT_FOUND', { message: `shop ${input.retailerId} not found` })
        }
        if (input.variantId) {
          const known = await this.tenantCatalog.variantLabels(tx, [input.variantId])
          if (!known.has(input.variantId))
            throw new ORPCError('NOT_FOUND', { message: `item ${input.variantId} not found` })
        }
        const overrides = { ...((row.overrides as Record<string, string> | null) ?? {}) }
        for (const v of input.values ?? []) overrides[v.field] = v.value
        await tx
          .update(importRows)
          .set({
            retailerId: input.retailerId ?? row.retailerId,
            variantId: input.variantId ?? row.variantId,
            overrides: Object.keys(overrides).length > 0 ? overrides : null,
            // A skipped row is un-skipped by reviewing it again; scoring decides its status afresh.
            status: row.status === 'skipped' ? 'staged' : row.status,
            reviewedBy: ctx.actorId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(importRows.id, row.id))
        const mapping = jobMapping(job)
        const [pinned] = await tx.select().from(importRows).where(eq(importRows.id, row.id))
        if (mapping && pinned) {
          await scoreRows(tx, this.services, job, mapping, [pinned], new Map())
        }
        const [scored] = await tx.select().from(importRows).where(eq(importRows.id, row.id))
        const current = scored ?? pinned ?? row
        // The pinned party's code is remembered at once (docs/17 A7), and noted on the row so a rollback forgets it again.
        const values = (current.normalized as Record<string, unknown> | null) ?? {}
        const system = job.kind === 'excel' || job.kind === 'other' ? null : job.kind
        const code = typeof values.partyCode === 'string' ? values.partyCode : null
        if (input.rememberCode && input.retailerId && system && code) {
          const linked = await this.retailers.linkExternalCode(tx, {
            system,
            code,
            retailerId: input.retailerId,
          })
          const effects = { ...((current.effects as Record<string, unknown> | null) ?? {}) }
          if (linked.created) effects.externalCodeId = linked.id
          else if (linked.previousRetailerId)
            effects.externalCodeRepointed = { system, code, from: linked.previousRetailerId }
          await tx.update(importRows).set({ effects }).where(eq(importRows.id, row.id))
        }
        // The stored summary no longer describes the rows: the counts refresh on the next dry run.
        return { item: toImportRow(current) }
      }),
    )
  }

  async commit(input: CommitIn): Promise<CommitOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const config = integrationsConfig()
    const accepted = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        // A run the worker left `running` (a crash mid-batch) is picked up again; a committed job is
        // never committed twice — the machine refuses, and a replay under the first key is served
        // from the idempotency store above.
        if (job.status === 'running') return { item: toImportJob(job), run: true }
        this.assertOwnerGate(job)
        if (job.status !== 'staged')
          throw new ORPCError('CONFLICT', {
            message: `the import is ${job.status}; only a staged import can be committed`,
          })
        const summary = job.dryRun as { status?: string } | null
        if (!summary || summary.status !== 'done')
          throw new ORPCError('BAD_REQUEST', {
            message:
              'run a dry run after the last mapping change before committing (dry_run_required)',
            data: { code: 'dry_run_required' },
          })
        const counts = await rowCounts(tx, job.id)
        const unresolved = counts.needs_review + counts.error + counts.staged
        if (unresolved > 0 && !input.skipUnresolved)
          throw new ORPCError('BAD_REQUEST', {
            message: `${String(unresolved)} row${unresolved === 1 ? '' : 's'} still need${unresolved === 1 ? 's' : ''} a decision; resolve them or commit with skipUnresolved (unresolved_rows)`,
            data: { code: 'unresolved_rows', unresolved },
          })
        if (unresolved > 0)
          await tx
            .update(importRows)
            .set({ status: 'skipped', updatedAt: new Date() })
            .where(
              and(
                eq(importRows.importJobId, job.id),
                inArray(importRows.status, ['needs_review', 'error', 'staged']),
              ),
            )
        const [updated] = await tx
          .update(importJobs)
          .set({
            status: jobTransition(job.status, 'commit'),
            startedAt: new Date(),
            finishedAt: null,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        if (!config.inlineJobs)
          await emitIntegrationsEvent(tx, 'import_job', job.id, IMPORT_RUN_EVENT, {
            tenantId: ctx.tenantId,
            jobId: job.id,
            phase: 'commit',
            actorId: ctx.actorId,
            skipUnresolved: input.skipUnresolved,
          } satisfies ImportRunPayload)
        return { item: toImportJob(updated ?? job), run: true }
      }),
    )
    if (accepted.run && config.inlineJobs) {
      await runCommit(db, ctx, this.services, input.id)
      return { item: toImportJob(await this.load(db, ctx, input.id)) }
    }
    return { item: accepted.item }
  }

  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status === 'confirmed') return { item: toImportJob(job) }
        this.assertOwnerGate(job)
        const [updated] = await tx
          .update(importJobs)
          .set({
            status: jobTransition(job.status, 'confirm'),
            confirmedAt: new Date(),
            confirmedBy: ctx.actorId,
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        return { item: toImportJob(updated ?? job) }
      }),
    )
  }

  async rollback(input: RollbackIn): Promise<RollbackOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status === 'rolled_back')
          return { item: toImportJob(job), reversedRows: 0, reversedByEntity: {} }
        const to = jobTransition(job.status, 'rollback')
        const reversed = await rollbackRows(tx, this.services, job, input.reason)
        const [updated] = await tx
          .update(importJobs)
          .set({
            status: to,
            rolledBackAt: new Date(),
            rolledBackBy: ctx.actorId,
            rollbackReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        return {
          item: toImportJob(updated ?? job),
          reversedRows: reversed.reversedRows,
          reversedByEntity: reversed.reversedByEntity,
        }
      }),
    )
  }

  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.lock(tx, input.id)
        if (job.status === 'cancelled') return { item: toImportJob(job) }
        const [updated] = await tx
          .update(importJobs)
          .set({
            status: jobTransition(job.status, 'cancel'),
            cancelledAt: new Date(),
            cancelReason: input.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, job.id))
          .returning()
        return { item: toImportJob(updated ?? job) }
      }),
    )
  }

  // =============================================================================================================
  // profiles
  // =============================================================================================================

  async listProfiles(input: ProfilesIn): Promise<ProfilesOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await ensureBuiltinProfiles(tx, ctx.tenantId)
      const filters: (SQL | undefined)[] = [
        eq(importProfiles.tenantId, ctx.tenantId),
        input.source ? eq(importProfiles.kind, input.source) : undefined,
        input.target ? eq(importProfiles.target, input.target) : undefined,
        input.cursor ? gt(importProfiles.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(importProfiles)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(importProfiles.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toProfile)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async upsertProfile(input: ProfileIn): Promise<ProfileOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    this.assertMapping(input.mapping, input.target)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await ensureBuiltinProfiles(tx, ctx.tenantId)
        const row = await upsertProfile(tx, ctx, {
          id: input.id,
          name: input.name,
          source: input.source,
          target: input.target,
          mapping: input.mapping,
          hasHeaderRow: input.hasHeaderRow,
          sheetName: input.sheetName ?? null,
          sourceColumns: null,
        })
        return { item: toProfile(row) }
      }),
    )
  }

  // =============================================================================================================
  // helpers
  // =============================================================================================================

  private assertMapping(mapping: ImportMapping, target: ImportTarget): void {
    const problems = validateMappingForTarget(mapping, target)
    if (problems.length > 0)
      throw new ORPCError('BAD_REQUEST', {
        message: `the mapping is incomplete: ${problems.map((p) => p.message).join('; ')}`,
        data: { code: 'mapping_invalid', problems },
      })
  }

  /** Money enters the books with no sale behind it: `opening_outstanding` commits and confirms are the owner's alone. */
  private assertOwnerGate(job: JobRecord): void {
    if (job.target !== 'opening_outstanding') return
    const { actorRole } = currentTenant()
    if (!OWNER.includes(actorRole))
      throw new ORPCError('FORBIDDEN', {
        message: 'only the owner may commit or confirm opening outstanding balances',
      })
  }

  private async find(tx: Db, id: string): Promise<JobRecord> {
    const { tenantId } = currentTenant()
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)))
      .limit(1)
    if (!job) throw new ORPCError('NOT_FOUND', { message: `import ${id} not found` })
    return job
  }

  private async lock(tx: Db, id: string): Promise<JobRecord> {
    const { tenantId } = currentTenant()
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)))
      .for('update')
    if (!job) throw new ORPCError('NOT_FOUND', { message: `import ${id} not found` })
    return job
  }

  private load(db: Db, ctx: TenantContext, id: string): Promise<JobRecord> {
    return withTenant(db, ctx, (tx) => this.find(tx, id))
  }

  private async detail(tx: Db, job: JobRecord): Promise<ImportJobDetail> {
    const { tenantId } = currentTenant()
    const sample = await tx
      .select({ raw: importRows.raw })
      .from(importRows)
      .where(and(eq(importRows.tenantId, tenantId), eq(importRows.importJobId, job.id)))
      .orderBy(asc(importRows.rowNo))
      .limit(5)
    const columns = detectedColumns(
      job,
      sample.map((r) => (r.raw as Record<string, string> | null) ?? {}),
    )
    return toImportJobDetail(job, columns, await rowCounts(tx, job.id))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// profiles

/** The built-in vendor profiles of a tenant, written on first use (deterministic ids; a name already taken wins). */
export async function ensureBuiltinProfiles(tx: Db, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ id: importProfiles.id })
    .from(importProfiles)
    .where(and(eq(importProfiles.tenantId, tenantId), eq(importProfiles.builtin, true)))
  if (existing.length >= BUILTIN_PROFILES.length) return
  for (const p of BUILTIN_PROFILES) {
    await tx
      .insert(importProfiles)
      .values({
        id: builtinProfileId(tenantId, p.key),
        tenantId,
        name: p.name,
        kind: p.source,
        target: p.target,
        mapping: p.mapping,
        hasHeaderRow: p.hasHeaderRow,
        sheetName: p.sheetName,
        sourceColumns: p.mapping.columns.map((c) => c.column),
        builtin: true,
      })
      .onConflictDoNothing()
  }
}

async function upsertProfile(
  tx: Db,
  ctx: TenantContext,
  input: {
    id: string
    name: string
    source: string
    target: string
    mapping: ImportMapping
    hasHeaderRow: boolean
    sheetName: string | null
    sourceColumns: unknown
  },
): Promise<typeof importProfiles.$inferSelect> {
  const [byId] = await tx
    .select()
    .from(importProfiles)
    .where(and(eq(importProfiles.tenantId, ctx.tenantId), eq(importProfiles.id, input.id)))
    .limit(1)
  const [byName] = byId
    ? [undefined]
    : await tx
        .select()
        .from(importProfiles)
        .where(and(eq(importProfiles.tenantId, ctx.tenantId), eq(importProfiles.name, input.name)))
        .limit(1)
  const existing = byId ?? byName
  if (existing) {
    if (existing.builtin && existing.kind !== input.source)
      throw new ORPCError('CONFLICT', {
        message: `built-in profile "${existing.name}" belongs to ${existing.kind} and keeps its source`,
      })
    const [updated] = await tx
      .update(importProfiles)
      .set({
        name: input.name,
        kind: input.source,
        target: input.target,
        mapping: input.mapping,
        hasHeaderRow: input.hasHeaderRow,
        sheetName: input.sheetName,
        sourceColumns: input.sourceColumns ?? existing.sourceColumns,
        updatedAt: new Date(),
      })
      .where(eq(importProfiles.id, existing.id))
      .returning()
    if (!updated) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'profile vanished' })
    return updated
  }
  const [inserted] = await tx
    .insert(importProfiles)
    .values({
      id: input.id,
      tenantId: ctx.tenantId,
      name: input.name,
      kind: input.source,
      target: input.target,
      mapping: input.mapping,
      hasHeaderRow: input.hasHeaderRow,
      sheetName: input.sheetName,
      sourceColumns: input.sourceColumns ?? input.mapping.columns.map((c) => c.column),
      builtin: false,
      createdBy: ctx.actorId,
    })
    .returning()
  if (!inserted) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'profile insert failed' })
  return inserted
}

/** `YYYY-MM-DD` (+ days) at 00:00 IST, as the timestamptz bound a `created_at` filter compares against. */
function istStart(isoDate: string, plusDays = 0): Date {
  const at = Date.parse(`${isoDate}T00:00:00.000+05:30`)
  return new Date(at + plusDays * 86_400_000)
}
