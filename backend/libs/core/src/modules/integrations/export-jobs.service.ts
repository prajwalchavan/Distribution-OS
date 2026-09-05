import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ExportDownloadUrlInput,
  ExportDownloadUrlOutput,
  ExportGetInput,
  ExportGetOutput,
  ExportJob,
  ExportsListInput,
  ExportsListOutput,
  RequestExportInput,
  RequestExportOutput,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { exportJobs, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MONEY_DESK,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { createObjectStorage } from '../../platform/object-storage.js'
import { BillingService, RegistersService } from '../billing/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { SupplierInvoiceService } from '../procurement/index.js'
import { RetailersService } from '../retailers/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'
import {
  emitIntegrationsEvent,
  EXPORT_REQUESTED_EVENT,
  exportFileName,
  exportMimeType,
  integrationsConfig,
  type ExportRenderPayload,
} from './integrations.internals.js'
import { toExportJob } from './integrations.mappers.js'
import { renderExportJob } from './renderers/index.js'
import type { ImportServices } from './services.js'

type RequestIn = z.infer<typeof RequestExportInput>
type RequestOut = z.infer<typeof RequestExportOutput>
type ListIn = z.infer<typeof ExportsListInput>
type ListOut = z.infer<typeof ExportsListOutput>
type GetIn = z.infer<typeof ExportGetInput>
type GetOut = z.infer<typeof ExportGetOutput>
type UrlIn = z.infer<typeof ExportDownloadUrlInput>
type UrlOut = z.infer<typeof ExportDownloadUrlOutput>

type ExportRecord = typeof exportJobs.$inferSelect

/**
 * `export_jobs` and the single `exports.render` queue (coordination §3.5). This is the surface every
 * later module enqueues through — claims' `claim_sheet`, reporting's `report_*` — so `export_jobs` is
 * written by exactly one module and rendered by exactly one queue. The transaction-scoped methods
 * (`enqueueExport`, `get`, `markRunning`, `markSucceeded`, `markFailed`) carry the signatures the
 * coordination contract fixed; the procedures wrap them for the exports screen.
 */
@Injectable()
export class ExportJobsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly retailers: RetailersService,
    private readonly tenantCatalog: TenantCatalogService,
    private readonly billing: BillingService,
    private readonly receivables: ReceivablesService,
    private readonly registers: RegistersService,
    private readonly supplierInvoices: SupplierInvoiceService,
  ) {}

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
  // the surface other modules import (coordination §3.5)
  // =============================================================================================================

  /** Insert a `queued` export and hand it to the worker (or render it inline). Idempotent on `id`. */
  async enqueueExport(
    tx: Db,
    input: { id?: string; kind: string; params: Record<string, unknown>; requestedBy: string },
  ): Promise<ExportJob> {
    const { tenantId } = currentTenant()
    const id = input.id ?? uuidv7()
    const [existing] = await tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
      .limit(1)
    if (existing) return toExportJob(existing)
    const [row] = await tx
      .insert(exportJobs)
      .values({
        id,
        tenantId,
        kind: input.kind,
        params: input.params,
        status: 'queued',
        requestedBy: input.requestedBy,
      })
      .returning()
    if (!row) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'export insert failed' })
    if (!integrationsConfig().inlineJobs)
      await emitIntegrationsEvent(tx, 'export_job', id, EXPORT_REQUESTED_EVENT, {
        tenantId,
        exportJobId: id,
        actorId: input.requestedBy,
      } satisfies ExportRenderPayload)
    return toExportJob(row)
  }

  async get(tx: Db, id: string): Promise<ExportJob | null> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
      .limit(1)
    return row ? toExportJob(row) : null
  }

  async markRunning(tx: Db, id: string): Promise<void> {
    const { tenantId } = currentTenant()
    await tx
      .update(exportJobs)
      .set({ status: 'running', startedAt: new Date(), error: null, updatedAt: new Date() })
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
  }

  async markSucceeded(
    tx: Db,
    id: string,
    result: { objectKey: string; rowCount: number },
  ): Promise<void> {
    const { tenantId } = currentTenant()
    await tx
      .update(exportJobs)
      .set({
        status: 'succeeded',
        objectKey: result.objectKey,
        rowCount: result.rowCount,
        finishedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
  }

  async markFailed(tx: Db, id: string, error: string): Promise<void> {
    const { tenantId } = currentTenant()
    await tx
      .update(exportJobs)
      .set({ status: 'failed', error, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
  }

  /** Render one export now, in this process (the inline path and the spec); the worker calls `renderExportJob` directly. */
  async renderNow(id: string): Promise<void> {
    const db = requireDb(this.db)
    await renderExportJob(db, currentTenant(), this.services, id)
  }

  // =============================================================================================================
  // procedures
  // =============================================================================================================

  async request(input: RequestIn): Promise<RequestOut> {
    requireRole(MONEY_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const { idempotencyKey: _key, id, kind, ...rest } = input
    const params: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) params[k] = v
    const accepted = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const item = await this.enqueueExport(tx, { id, kind, params, requestedBy: ctx.actorId })
        // Exports taken are audited (docs/23 O25): who pulled which window of the books.
        await writeAudit(tx, {
          action: 'integrations.export.request',
          entityType: 'export_job',
          entityId: id,
          after: { kind, params },
        })
        return { item }
      }),
    )
    if (integrationsConfig().inlineJobs && accepted.item.status === 'queued') {
      await renderExportJob(db, ctx, this.services, id)
      const fresh = await withTenant(db, ctx, (tx) => this.get(tx, id))
      return { item: fresh ?? accepted.item }
    }
    return accepted
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(exportJobs.tenantId, ctx.tenantId),
        input.kind ? eq(exportJobs.kind, input.kind) : undefined,
        input.status ? eq(exportJobs.status, input.status) : undefined,
        input.from ? sql`${exportJobs.createdAt} >= ${istStart(input.from)}` : undefined,
        input.to ? sql`${exportJobs.createdAt} < ${istStart(input.to, 1)}` : undefined,
        input.cursor ? lt(exportJobs.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(exportJobs)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(exportJobs.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toExportJob)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async getOne(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => ({ item: toExportJob(await this.find(tx, input.id)) }))
  }

  async downloadUrl(input: UrlIn): Promise<UrlOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const row = await withTenant(db, ctx, (tx) => this.find(tx, input.id))
    const item = toExportJob(row)
    const params = (row.params as Record<string, unknown> | null) ?? {}
    const ttl = integrationsConfig().downloadTtlSeconds
    if (item.status !== 'succeeded' || !row.objectKey)
      return {
        status: item.status,
        objectKey: row.objectKey,
        url: null,
        expiresAt: null,
        fileName: exportFileName(row.kind, params),
        mimeType: exportMimeType(row.kind),
      }
    const url = await createObjectStorage().getUrl(row.objectKey, ttl)
    return {
      status: item.status,
      objectKey: row.objectKey,
      url,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      fileName: exportFileName(row.kind, params),
      mimeType: exportMimeType(row.kind),
    }
  }

  private async find(tx: Db, id: string): Promise<ExportRecord> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `export ${id} not found` })
    return row
  }
}

function istStart(isoDate: string, plusDays = 0): Date {
  const at = Date.parse(`${isoDate}T00:00:00.000+05:30`)
  return new Date(at + plusDays * 86_400_000)
}
