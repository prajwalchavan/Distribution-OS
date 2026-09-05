import { and, eq } from 'drizzle-orm'
import { exportJobs, withTenant, type Db, type TenantContext } from '@dos/db'
import { tenantStorage } from '../../../platform/index.js'
import { createObjectStorage, objectKey } from '../../../platform/object-storage.js'
import {
  emitIntegrationsEvent,
  EXPORT_READY_EVENT,
  exportFileName,
  friendlyMessage,
} from '../integrations.internals.js'
import type { ImportServices } from '../services.js'
import {
  renderEinvoiceJson,
  renderEwayBillJson,
  renderGstr1Json,
  renderOutstandingCsv,
  renderOutstandingXlsx,
  renderSalesRegisterCsv,
  renderSalesRegisterXlsx,
} from './files.js'
import {
  exportRendererFor,
  registerExportRenderer,
  registerRenderer,
  registeredExportKinds,
  type ExportKindMeta,
  type ExportRenderContext,
  type ExportRenderer,
  type RenderedExport,
} from './registry.js'
import { renderTallyXml } from './tally-xml.js'

export {
  exportRendererFor,
  registerExportRenderer,
  registerRenderer,
  registeredExportKinds,
  renderTallyXml,
  type ExportKindMeta,
  type ExportRenderContext,
  type ExportRenderer,
  type RenderedExport,
}

/** Integrations' own kinds, registered once at import time (claims and reporting add theirs at boot). */
registerExportRenderer('tally_xml', renderTallyXml)
registerExportRenderer('gstr1_json', renderGstr1Json)
registerExportRenderer('sales_register_xlsx', renderSalesRegisterXlsx)
registerExportRenderer('sales_register_csv', renderSalesRegisterCsv)
registerExportRenderer('outstanding_xlsx', renderOutstandingXlsx)
registerExportRenderer('outstanding_csv', renderOutstandingCsv)
registerExportRenderer('eway_bill_json', renderEwayBillJson)
registerExportRenderer('einvoice_json', renderEinvoiceJson)

export interface RenderExportResult {
  status: 'succeeded' | 'failed' | 'skipped'
  objectKey: string | null
  rowCount: number | null
  error: string | null
}

/**
 * THE `exports.render` JOB (coordination §3.5): mark the job running, look its kind up in the
 * registry, render, write the file to object storage under `tenant/{tenantId}/exports/{jobId}/…`,
 * mark it succeeded with the key and the row count (or failed with an English reason), publish
 * `ExportReady`. Called by the API right after `exports.request` in inline mode and by the worker
 * otherwise. Idempotent: a job already succeeded is left alone; a failed one is rendered again.
 */
export async function renderExportJob(
  db: Db,
  ctx: TenantContext,
  services: ImportServices,
  exportJobId: string,
): Promise<RenderExportResult> {
  return tenantStorage.run(ctx, async () => {
    const job = await withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, ctx.tenantId), eq(exportJobs.id, exportJobId)))
        .for('update')
      if (!row) return null
      if (row.status === 'succeeded' || row.status === 'cancelled') return row
      await tx
        .update(exportJobs)
        .set({ status: 'running', startedAt: new Date(), error: null, updatedAt: new Date() })
        .where(eq(exportJobs.id, row.id))
      return { ...row, status: 'running' as const }
    })
    if (!job) return { status: 'skipped', objectKey: null, rowCount: null, error: 'not found' }
    if (job.status === 'succeeded' || job.status === 'cancelled')
      return { status: 'skipped', objectKey: job.objectKey, rowCount: job.rowCount, error: null }
    const params = (job.params as Record<string, unknown> | null) ?? {}
    const renderer = exportRendererFor(job.kind)
    const fail = async (message: string): Promise<RenderExportResult> => {
      await withTenant(db, ctx, (tx) =>
        tx
          .update(exportJobs)
          .set({ status: 'failed', error: message, finishedAt: new Date(), updatedAt: new Date() })
          .where(eq(exportJobs.id, job.id)),
      )
      return { status: 'failed', objectKey: null, rowCount: null, error: message }
    }
    if (!renderer) return fail(`no renderer is registered for ${job.kind}`)
    try {
      const rendered = await renderer({
        db,
        ctx,
        services,
        exportJobId: job.id,
        kind: job.kind,
        params,
        run: (fn) => withTenant(db, ctx, fn),
      })
      const fileName = exportFileName(job.kind, params)
      const key = objectKey({
        tenantId: ctx.tenantId,
        domain: 'exports',
        entityId: job.id,
        name: fileName.replace(/\.[^.]+$/, ''),
        ext: rendered.ext,
      })
      await createObjectStorage().put(key, rendered.body, rendered.mimeType)
      await withTenant(db, ctx, async (tx) => {
        await tx
          .update(exportJobs)
          .set({
            status: 'succeeded',
            objectKey: key,
            rowCount: rendered.rowCount,
            finishedAt: new Date(),
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(exportJobs.id, job.id))
        await emitIntegrationsEvent(tx, 'export_job', job.id, EXPORT_READY_EVENT, {
          exportJobId: job.id,
          kind: job.kind,
          objectKey: key,
          rowCount: rendered.rowCount,
          requestedBy: job.requestedBy,
        })
      })
      return { status: 'succeeded', objectKey: key, rowCount: rendered.rowCount, error: null }
    } catch (error) {
      return fail(friendlyMessage(error))
    }
  })
}
