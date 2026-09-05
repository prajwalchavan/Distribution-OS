import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
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
    /** The export-detail screen's "what did this job actually push" list (integrations §3.4). */
    index('tally_sync_ledger_export_idx').on(t.tenantId, t.exportJobId),
    tenantRolePolicy('tally_sync_ledger_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/**
 * `staged` (0018) is the import wizard's "parsed, matched, waiting for a human" state — between `running`
 * (the stage or commit worker is busy) and `succeeded`. An export never pauses for review, so `export_jobs`
 * never carries it.
 */
export const jobStatus = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'staged',
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

/**
 * A saved column mapping for the GENERIC importer (docs/17 §D7, docs/22 §8 2026-09-04): "upload any CSV/Excel,
 * preview, map columns by hand, save the mapping as a named profile, dry-run, commit". One row = one named
 * profile per distributor — "TradeEzee party master", "Marg item list", "FieldAssist invoices Sept" — keyed by
 * tenant and name. The vendor readers (TradeEzee, Marg, Busy, Tally, FieldAssist) are rows of this table
 * that ship with the product (`builtin`) and are refined the moment a real file arrives; NOTHING about a
 * vendor's column names is hard-coded in code. `mapping` is source column → target field; `transforms` is
 * per-target-field normalisation the wizard chose (date format, phone digits, rupees→paise, trim); the
 * parse options (`has_header_row`, `sheet_name`) and the header signature the profile was saved from
 * (`source_columns`, in file order) let the wizard suggest the profile whose columns match a new upload.
 * Back office only, like every other integrations table: a profile decides where real money and real
 * shops land.
 */
export const importProfiles = pgTable(
  'import_profiles',
  {
    id: id(),
    tenantId: tenantRef(),
    /** The operator's own name for it, unique per tenant. */
    name: text('name').notNull(),
    /** tradeezee_party | tradeezee_item | tradeezee_outstanding | tradeezee_sales_register | fieldassist_invoices | marg | busy | tally | csv ... */
    kind: text('kind').notNull(),
    /** retailers | products | opening_balances | sales_history | brand_dms_invoices */
    target: text('target').notNull(),
    /** Source column header → target field name. */
    mapping: jsonb('mapping')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Target field → transform spec (e.g. `{ "invoiceDate": { "dateFormat": "DD/MM/YYYY" } }`). */
    transforms: jsonb('transforms')
      .notNull()
      .default(sql`'{}'::jsonb`),
    hasHeaderRow: boolean('has_header_row').notNull().default(true),
    /** Excel only: the sheet to read; null = the first sheet. */
    sheetName: text('sheet_name'),
    /** The header row the profile was saved from, in file order (`string[]`), so a new upload can be matched to it. */
    sourceColumns: jsonb('source_columns'),
    /** Ships with the product (seeded), as opposed to saved by the operator from a real file. */
    builtin: boolean('builtin').notNull().default(false),
    lastUsedAt: tz('last_used_at'),
    createdBy: text('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('import_profiles_name_idx').on(t.tenantId, t.name),
    index('import_profiles_target_idx').on(t.tenantId, t.target, t.kind),
    tenantRolePolicy('import_profiles_back_office', BACK_OFFICE_ROLES),
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
    /** The operator's original file name, display only (the object key is opaque). */
    sourceFileName: text('source_file_name'),
    /** The saved profile the mapping came from, when the operator picked one (null = mapped by hand). */
    profileId: text('profile_id').references(() => importProfiles.id),
    mapping: jsonb('mapping')
      .notNull()
      .default(sql`'{}'::jsonb`),
    hasHeaderRow: boolean('has_header_row').notNull().default(true),
    /** Excel only: the sheet to read; null = the first sheet. */
    sheetName: text('sheet_name'),
    /** The header row the stage job found, in file order (`string[]`); the map-columns screen reads it. */
    sourceColumns: jsonb('source_columns'),
    status: jobStatus('status').notNull().default('queued'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    totalRows: integer('total_rows'),
    okRows: integer('ok_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    /** Set by the stage job and again by the commit job: the wizard's progress screen needs both phases. */
    startedAt: tz('started_at'),
    finishedAt: tz('finished_at'),
    committedAt: tz('committed_at'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    index('import_jobs_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('import_jobs_profile_idx').on(t.tenantId, t.profileId),
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
    /** Who resolved a row the matcher could not (`imports.rows.override`), and when. */
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewedAt: tz('reviewed_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('import_rows_idx').on(t.tenantId, t.importJobId, t.rowNo),
    index('import_rows_status_idx').on(t.tenantId, t.importJobId, t.status),
    tenantRolePolicy('import_rows_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()
