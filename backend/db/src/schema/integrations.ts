import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { BACK_OFFICE_ROLES, id, tenantRolePolicy, timestamps, tz } from './columns.js'
import { tenantRef } from './platform.js'
import { users } from './tenancy.js'

/**
 * Integration bus = files, not APIs (R01 §6): TradeEzee report exports, FieldAssist DMS exports and Tally XML.
 * All rows here are back-office only.
 */

/** How our entities map to the CA's TallyPrime ledgers/stock items/voucher types. */
export const tallyMappings = pgTable(
  'tally_mappings',
  {
    id: id(),
    tenantId: tenantRef(),
    /** ledger | stock_item | voucher_type | godown | unit */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    tallyName: text('tally_name').notNull(),
    tallyParent: text('tally_parent'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tally_mappings_idx').on(t.tenantId, t.entityType, t.entityId),
    tenantRolePolicy('tally_mappings_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Which of our documents have been exported to Tally, with Tally's GUID / LASTVCHID so re-exports update instead of duplicate. */
export const tallySyncLedger = pgTable(
  'tally_sync_ledger',
  {
    id: id(),
    tenantId: tenantRef(),
    docType: text('doc_type').notNull(),
    docId: text('doc_id').notNull(),
    tallyGuid: text('tally_guid'),
    tallyVoucherId: text('tally_voucher_id'),
    exportJobId: text('export_job_id'),
    exportedAt: tz('exported_at').notNull().defaultNow(),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    uniqueIndex('tally_sync_ledger_doc_idx').on(t.tenantId, t.docType, t.docId),
    tenantRolePolicy('tally_sync_ledger_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const jobStatus = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
])

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: id(),
    tenantId: tenantRef(),
    /** tally_xml | gstr1_json | sales_register_xlsx | outstanding_xlsx | claim_sheet ... */
    kind: text('kind').notNull(),
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: jobStatus('status').notNull().default('queued'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    objectKey: text('object_key'),
    rowCount: integer('row_count'),
    error: text('error'),
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
    ...timestamps,
  },
  (t) => [
    index('export_jobs_status_idx').on(t.tenantId, t.status, t.createdAt),
    tenantRolePolicy('export_jobs_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** A file upload (TradeEzee/FieldAssist/Tally/CSV) with its saved column mapping; rows are staged then committed. */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    tenantId: tenantRef(),
    /** tradeezee_party | tradeezee_item | tradeezee_outstanding | fieldassist_invoices | fieldassist_orders | tally_xml | csv */
    kind: text('kind').notNull(),
    /** retailers | products | opening_balances | brand_dms_invoices | ... */
    target: text('target').notNull(),
    sourceObjectKey: text('source_object_key').notNull(),
    mapping: jsonb('mapping')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: jobStatus('status').notNull().default('queued'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    totalRows: integer('total_rows'),
    okRows: integer('ok_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    committedAt: tz('committed_at'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    index('import_jobs_status_idx').on(t.tenantId, t.status, t.createdAt),
    tenantRolePolicy('import_jobs_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const importRowStatus = pgEnum('import_row_status', [
  'staged',
  'matched',
  'needs_review',
  'committed',
  'skipped',
  'error',
])

export const importRows = pgTable(
  'import_rows',
  {
    id: id(),
    tenantId: tenantRef(),
    importJobId: text('import_job_id')
      .notNull()
      .references(() => importJobs.id),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw').notNull(),
    normalized: jsonb('normalized'),
    status: importRowStatus('status').notNull().default('staged'),
    /** Entity created/updated on commit. */
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('import_rows_idx').on(t.tenantId, t.importJobId, t.rowNo),
    index('import_rows_status_idx').on(t.tenantId, t.importJobId, t.status),
    tenantRolePolicy('import_rows_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()
