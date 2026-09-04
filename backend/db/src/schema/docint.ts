import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { BACK_OFFICE_ROLES, id, tenantPolicy, tenantRolePolicy, timestamps, tz } from './columns.js'
import { productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { suppliers } from './tenant-catalog.js'
import { users } from './tenancy.js'

/**
 * Document intelligence (docs/05): photo/PDF → QR/IRN verify → optional structured pull → LLM vision extraction →
 * deterministic validators → SKU match → human review → commit. Nothing here is ever auto-committed.
 */

export const documentKind = pgEnum('document_kind', [
  'supplier_invoice',
  'lorry_receipt',
  'brand_dms_invoice',
  'claim_sheet',
  'pod',
  'other',
])
export const documentStatus = pgEnum('document_status', [
  'uploaded',
  'verifying',
  'extracting',
  'extracted',
  'needs_review',
  'reviewed',
  'committed',
  'rejected',
  'failed',
])

export const documents = pgTable(
  'documents',
  {
    id: id(),
    tenantId: tenantRef(),
    kind: documentKind('kind').notNull(),
    status: documentStatus('status').notNull().default('uploaded'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    supplierId: text('supplier_id').references(() => suppliers.id),
    /** Decoded e-invoice QR (IRN, seller GSTIN, doc no/date, total) when present — the strongest signal. */
    qrPayload: jsonb('qr_payload'),
    irn: text('irn'),
    irnVerified: boolean('irn_verified').notNull().default(false),
    /** Content hash across pages to catch the same invoice photographed twice. */
    contentHash: text('content_hash'),
    /** The procurement.supplier_invoices row created at commit (plain id). */
    committedEntityType: text('committed_entity_type'),
    committedEntityId: text('committed_entity_id'),
    committedAt: tz('committed_at'),
    failureCode: text('failure_code'),
    ...timestamps,
  },
  (t) => [
    index('documents_status_idx').on(t.tenantId, t.status, t.createdAt),
    uniqueIndex('documents_hash_idx')
      .on(t.tenantId, t.contentHash)
      .where(sql`content_hash IS NOT NULL`),
    tenantPolicy('documents_tenant'),
  ],
).enableRLS()

export const documentPages = pgTable(
  'document_pages',
  {
    id: id(),
    tenantId: tenantRef(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    pageNo: integer('page_no').notNull(),
    /** Full-resolution original in object storage; never downscaled before extraction. */
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('document_pages_idx').on(t.tenantId, t.documentId, t.pageNo),
    tenantPolicy('document_pages_tenant'),
  ],
).enableRLS()

export const extractionEngine = pgEnum('extraction_engine', [
  'irn_pull',
  'qr',
  'llm_vision',
  'llm_vision_secondary',
  'template',
  'manual',
])

/** One engine's structured reading of a document (several may exist; disagreements are recorded). */
export const extractions = pgTable(
  'extractions',
  {
    id: id(),
    tenantId: tenantRef(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    engine: extractionEngine('engine').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    /** Normalised invoice JSON (header + lines) in the docint schema. */
    result: jsonb('result').notNull(),
    confidence: real('confidence'),
    costPaise: integer('cost_paise'),
    latencyMs: integer('latency_ms'),
    ...timestamps,
  },
  (t) => [
    index('extractions_document_idx').on(t.tenantId, t.documentId),
    tenantRolePolicy('extractions_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Deterministic validators: totals add up, GST split matches rate, HSN known, qty × rate = amount, dates sane. */
export const extractionChecks = pgTable(
  'extraction_checks',
  {
    id: id(),
    tenantId: tenantRef(),
    extractionId: text('extraction_id')
      .notNull()
      .references(() => extractions.id),
    check: text('check').notNull(),
    passed: boolean('passed').notNull(),
    severity: text('severity').notNull().default('error'),
    detail: jsonb('detail'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('extraction_checks_extraction_idx').on(t.tenantId, t.extractionId),
    tenantRolePolicy('extraction_checks_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Candidate variants for each extracted line, with the score and the reason (alias hit, supplier code, EAN, fuzzy). */
export const skuMatchCandidates = pgTable(
  'sku_match_candidates',
  {
    id: id(),
    tenantId: tenantRef(),
    extractionId: text('extraction_id')
      .notNull()
      .references(() => extractions.id),
    lineNo: integer('line_no').notNull(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    score: real('score').notNull(),
    reason: text('reason').notNull(),
    chosen: boolean('chosen').notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('sku_match_candidates_idx').on(t.tenantId, t.extractionId, t.lineNo),
    tenantRolePolicy('sku_match_candidates_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const reviewSessionStatus = pgEnum('review_session_status', [
  'open',
  'submitted',
  'abandoned',
])

/** Single-writer lock: one person reviews a document at a time; the reviewed JSON is what gets committed. */
export const reviewSessions = pgTable(
  'review_sessions',
  {
    id: id(),
    tenantId: tenantRef(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => users.id),
    baseExtractionId: text('base_extraction_id').references(() => extractions.id),
    status: reviewSessionStatus('status').notNull().default('open'),
    reviewed: jsonb('reviewed'),
    lockedUntil: tz('locked_until').notNull(),
    submittedAt: tz('submitted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('review_sessions_open_idx')
      .on(t.tenantId, t.documentId)
      .where(sql`status = 'open'`),
    tenantRolePolicy('review_sessions_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Every field a human changed during review: the training signal for aliases and prompt regressions. */
export const correctionsLog = pgTable(
  'corrections_log',
  {
    id: id(),
    tenantId: tenantRef(),
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id),
    path: text('path').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('corrections_log_session_idx').on(t.tenantId, t.reviewSessionId),
    tenantRolePolicy('corrections_log_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** When two engines disagree on a field, record it; used to route to review and to measure engines. */
export const engineDisagreements = pgTable(
  'engine_disagreements',
  {
    id: id(),
    tenantId: tenantRef(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    path: text('path').notNull(),
    values: jsonb('values').notNull(),
    resolvedValue: jsonb('resolved_value'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('engine_disagreements_document_idx').on(t.tenantId, t.documentId),
    tenantRolePolicy('engine_disagreements_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Supplier names/GSTINs as printed map to the tenant's supplier record ("GURU KRIPA AGENCIES" → supplier x). */
export const supplierAliases = pgTable(
  'supplier_aliases',
  {
    id: id(),
    tenantId: tenantRef(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    alias: text('alias').notNull(),
    normalized: text('normalized').notNull(),
    gstin: text('gstin'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supplier_aliases_idx').on(t.tenantId, t.normalized),
    tenantPolicy('supplier_aliases_tenant'),
  ],
).enableRLS()
