import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import {
  parseReportExportKind,
  reportExportKind,
  type ReportExportJob,
  type ReportExportGetInput,
  type ReportExportGetOutput,
  type RequestReportExportInput,
  type RequestReportExportOutput,
} from '@dos/contracts'
import { exportJobs, withTenant, type Db } from '@dos/db'
import { and, eq } from 'drizzle-orm'
import {
  createObjectStorage,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import {
  createImportServices,
  ExportJobsService,
  integrationsConfig,
  renderExportJob,
} from '../integrations/index.js'
import { REGISTER_SPECS } from './register-specs.js'
import { badRequest } from './reporting.internals.js'
import { EXPORT_REQUESTERS, BACK_OFFICE_READERS } from './reporting.roles.js'

/**
 * CSV / JSON exports of the registers (docs/23 O22, M12; docs/plans/reporting.md §4 rules 12–13).
 *
 * ALWAYS ASYNCHRONOUS, even for a three-row window: `request` answers `queued` and the file is fetched
 * by a short-lived URL from `get`, exactly the way `billing.invoices.pdf` works — nothing streams
 * inline (docs/20 rule 15), so one accountant pulling a year of the sales register cannot hold a
 * request thread.
 *
 * ONE `export_jobs` TABLE AND ONE RENDER QUEUE (coordination §3.5): the row is written through
 * integrations' `ExportJobsService`, never by this module, and rendered by the `report_*` renderers on
 * integrations' single `exports.render` queue. The same job therefore shows up in
 * `integrations.exports.list` — one export history, whoever queued it.
 *
 * THE WINDOW IS CHECKED BEFORE A JOB EXISTS: `filters` is parsed with the TARGET REGISTER's own input
 * schema, so an oversized window is a 400 at request time and never something the worker has to refuse
 * later (docs/plans/reporting.md §5 spec 16).
 *
 * EVERY EXPORT IS AUDITED (docs/17 A12): a CSV of the sales register or the ageing book leaving the
 * system writes one `audit_log` row naming who pulled which window.
 */

type RequestIn = z.infer<typeof RequestReportExportInput>
type RequestOut = z.infer<typeof RequestReportExportOutput>
type GetIn = z.infer<typeof ReportExportGetInput>
type GetOut = z.infer<typeof ReportExportGetOutput>

type ExportRecord = typeof exportJobs.$inferSelect

/** The statuses an EXPORT job can be in; `job_status` is shared with the importer's phases. */
const EXPORT_STATUSES = new Set<string>(['queued', 'running', 'succeeded', 'failed', 'cancelled'])

/** How long a rendered report's download link stays good. */
const DOWNLOAD_TTL_SECONDS = 10 * 60

@Injectable()
export class ReportExportsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly jobs: ExportJobsService,
  ) {}

  /** Queue one export. A replay with the same `idempotencyKey` returns the same job, never a second row. */
  async request(input: RequestIn): Promise<RequestOut> {
    requireRole(EXPORT_REQUESTERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const spec = REGISTER_SPECS[input.register]
    const parsed = spec.input.safeParse(input.filters)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const message = issue?.message ?? 'Those filters are not valid for this register.'
      badRequest(
        message.startsWith('window_too_wide') ? 'window_too_wide' : 'invalid_filters',
        message,
        {
          register: input.register,
          field: issue?.path.join('.') ?? null,
        },
      )
    }
    const kind = reportExportKind(input.register, input.format)
    const filters = parsed.data as Record<string, unknown>
    const accepted = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const job = await this.jobs.enqueueExport(tx, {
          id: input.id,
          kind,
          params: { ...filters, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
          requestedBy: ctx.actorId,
        })
        await writeAudit(tx, {
          action: 'report.export.request',
          entityType: 'export_jobs',
          entityId: input.id,
          after: { register: input.register, format: input.format, filters },
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        })
        return { jobId: job.id }
      }),
    )
    // On the founder's Mac (and in every spec) the worker is not running, so the render happens here —
    // the same function, the same registry, just in this process (`INTEGRATIONS_INLINE_JOBS`).
    if (integrationsConfig().inlineJobs) {
      // `renderExportJob` marks the job failed itself; it never throws at the caller.
      await renderExportJob(db, ctx, createImportServices(db), accepted.jobId)
    }
    return { item: await this.load(accepted.jobId) }
  }

  /** The job and, once rendered, its short-lived download URL. `queued` / `running` are normal states. */
  async get(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE_READERS)
    return { item: await this.load(input.id) }
  }

  private async load(id: string): Promise<ReportExportJob> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const row = await withTenant(db, ctx, async (tx) => {
      const [found] = await tx
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, ctx.tenantId), eq(exportJobs.id, id)))
        .limit(1)
      return found
    })
    if (!row)
      throw new ORPCError('NOT_FOUND', {
        message: `No report export ${id}.`,
        data: { code: 'export_not_found', id },
      })
    const parsedKind = parseReportExportKind(row.kind)
    if (!parsedKind)
      throw new ORPCError('NOT_FOUND', {
        message: `Export ${id} is not a report export; read it through integrations.exports.get.`,
        data: { code: 'not_a_report_export', id, kind: row.kind },
      })
    return this.toJob(row, parsedKind.register, parsedKind.format)
  }

  private async toJob(
    row: ExportRecord,
    register: ReportExportJob['register'],
    format: ReportExportJob['format'],
  ): Promise<ReportExportJob> {
    const params = (row.params as Record<string, unknown> | null) ?? {}
    const from = typeof params.from === 'string' ? params.from : null
    const to = typeof params.to === 'string' ? params.to : null
    const window = from && to ? (from === to ? `-${from}` : `-${from}-to-${to}`) : ''
    const stem = register.replace(/([A-Z])/g, '-$1').toLowerCase()
    // `export_jobs.status` is the shared `job_status` enum (it also carries the importer's phases);
    // an export only ever reaches these five, and an unexpected one reads as `running` rather than
    // breaking the response shape.
    const status: ReportExportJob['status'] = EXPORT_STATUSES.has(row.status)
      ? (row.status as ReportExportJob['status'])
      : 'running'
    const ready = status === 'succeeded' && row.objectKey
    const url = ready
      ? await createObjectStorage().getUrl(row.objectKey as string, DOWNLOAD_TTL_SECONDS)
      : null
    return {
      id: row.id,
      register,
      format,
      kind: row.kind,
      status,
      filters: params,
      fileName: `${stem}${window}.${format}`,
      mimeType: format === 'json' ? 'application/json' : 'text/csv',
      rowCount: row.rowCount,
      url,
      expiresAt: url ? new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString() : null,
      error: row.error,
      requestedBy: row.requestedBy,
      requestedAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    }
  }
}
