import type {
  DetectedColumn,
  DryRunSummary,
  ExportJob,
  ImportJob,
  ImportJobDetail,
  ImportJobStatus,
  ImportMatchCandidate,
  ImportProfile,
  ImportRow,
  ImportRowCounts,
  ImportRowPlan,
  ImportRowStatus,
  ImportSource,
  ImportTarget,
  TallyEntityType,
  TallyMapping,
  TallySyncEntry,
} from '@dos/contracts'
import { DryRunSummarySchema, ImportMappingSchema, ImportSourceSchema } from '@dos/contracts'
import type {
  exportJobs,
  importJobs,
  importProfiles,
  importRows,
  tallyMappings,
  tallySyncLedger,
} from '@dos/db'
import { exportFileName, exportMimeType } from './integrations.internals.js'
import { suggestField } from './mapping.js'

/** DB rows → wire shapes. Nothing here queries; the services hand in what a shape needs. */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

const asSource = (kind: string): ImportSource =>
  ImportSourceSchema.safeParse(kind).success ? (kind as ImportSource) : 'other'

export function toImportJob(row: typeof importJobs.$inferSelect): ImportJob {
  return {
    id: row.id,
    source: asSource(row.kind),
    target: row.target as ImportTarget,
    status: row.status as ImportJobStatus,
    profileId: row.profileId,
    fileName: row.sourceFileName,
    sourceObjectKey: row.sourceObjectKey,
    hasHeaderRow: row.hasHeaderRow,
    sheetName: row.sheetName,
    totalRows: row.totalRows,
    okRows: row.okRows,
    errorRows: row.errorRows,
    requestedBy: row.requestedBy,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    committedAt: iso(row.committedAt),
    confirmedAt: iso(row.confirmedAt),
    confirmedBy: row.confirmedBy,
    rolledBackAt: iso(row.rolledBackAt),
    rolledBackBy: row.rolledBackBy,
    rollbackReason: row.rollbackReason,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The detected columns: header, position, up to five sample cells from the first rows, and a suggested field. */
export function detectedColumns(
  job: { kind: string; target: string; sourceColumns: unknown },
  sampleRows: readonly Record<string, string>[],
): DetectedColumn[] {
  const headers = Array.isArray(job.sourceColumns)
    ? (job.sourceColumns as unknown[]).filter((h): h is string => typeof h === 'string')
    : []
  return headers.map((header, index) => ({
    index,
    header,
    samples: sampleRows
      .map((r) => r[header] ?? '')
      .filter((v) => v !== '')
      .slice(0, 5),
    suggestedField: suggestField(header, asSource(job.kind), job.target as ImportTarget),
  }))
}

export function toDryRun(value: unknown): DryRunSummary | null {
  const parsed = DryRunSummarySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toImportJobDetail(
  row: typeof importJobs.$inferSelect,
  columns: DetectedColumn[],
  counts: Record<ImportRowStatus, number>,
): ImportJobDetail {
  const mapping = ImportMappingSchema.safeParse(row.mapping)
  const rowCounts: ImportRowCounts = {
    staged: counts.staged,
    matched: counts.matched,
    needsReview: counts.needs_review,
    committed: counts.committed,
    skipped: counts.skipped,
    error: counts.error,
  }
  return {
    ...toImportJob(row),
    mapping: mapping.success && mapping.data.columns.length > 0 ? mapping.data : null,
    columns,
    rowCounts,
    dryRun: toDryRun(row.dryRun),
  }
}

export function toImportRow(row: typeof importRows.$inferSelect): ImportRow {
  return {
    id: row.id,
    rowNo: row.rowNo,
    raw: (row.raw as Record<string, string> | null) ?? {},
    normalized: (row.normalized as Record<string, unknown> | null) ?? null,
    status: row.status,
    plan: (row.plan as ImportRowPlan | null) ?? null,
    retailerId: row.retailerId,
    variantId: row.variantId,
    candidates: (Array.isArray(row.candidates) ? row.candidates : []) as ImportMatchCandidate[],
    entityType: row.entityType,
    entityId: row.entityId,
    error: row.error,
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
  }
}

export function toProfile(row: typeof importProfiles.$inferSelect): ImportProfile {
  const mapping = ImportMappingSchema.safeParse(row.mapping)
  return {
    id: row.id,
    name: row.name,
    source: asSource(row.kind),
    target: row.target as ImportTarget,
    mapping: mapping.success
      ? mapping.data
      : { columns: [], constants: [], dateFormat: 'auto', amountUnit: 'rupees' },
    hasHeaderRow: row.hasHeaderRow,
    sheetName: row.sheetName,
    builtIn: row.builtin,
    usedCount: row.usedCount,
    lastUsedAt: iso(row.lastUsedAt),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toExportJob(row: typeof exportJobs.$inferSelect): ExportJob {
  const params = (row.params as Record<string, unknown> | null) ?? {}
  const status = row.status
  return {
    id: row.id,
    kind: row.kind,
    // An export never holds an import-only status; anything else is reported as failed rather than lied about.
    status:
      status === 'queued' ||
      status === 'running' ||
      status === 'succeeded' ||
      status === 'cancelled'
        ? status
        : 'failed',
    params,
    rowCount: row.rowCount,
    requestedBy: row.requestedBy,
    fileName: exportFileName(row.kind, params),
    mimeType: exportMimeType(row.kind),
    objectKey: row.objectKey,
    error: row.error,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toTallyMapping(
  row: typeof tallyMappings.$inferSelect,
  entityLabel: string,
): TallyMapping {
  return {
    id: row.id,
    entityType: row.entityType as TallyEntityType,
    entityId: row.entityId,
    entityLabel,
    tallyName: row.tallyName,
    tallyParent: row.tallyParent,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSyncEntry(row: typeof tallySyncLedger.$inferSelect): TallySyncEntry {
  return {
    id: row.id,
    docType: row.docType as TallySyncEntry['docType'],
    docId: row.docId,
    tallyGuid: row.tallyGuid,
    tallyVoucherId: row.tallyVoucherId,
    exportJobId: row.exportJobId,
    exportedAt: row.exportedAt.toISOString(),
    contentHash: row.contentHash,
  }
}
