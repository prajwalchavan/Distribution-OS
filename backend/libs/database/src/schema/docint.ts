import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  INBOUND_ROLES,
  id,
  paise,
  tenantPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import { productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
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
/**
 * What the e-invoice QR told us, separately from `irn_verified`: `absent` (no QR, or not scanned yet),
 * `decoded` (payload read, signature not checked), `verified` (signature checks out against the IRP key),
 * `signature_failed` (payload read, signature wrong — amber, capture continues on vision),
 * `mismatched` (payload contradicts the printed page). `irn_verified` alone cannot say "failed, continue".
 */
export const documentQrStatus = pgEnum('document_qr_status', [
  'absent',
  'decoded',
  'verified',
  'signature_failed',
  'mismatched',
])

/**
 * Document kinds a field role may capture and read. Everything else — a supplier invoice, a lorry receipt,
 * a brand-DMS bill — is a page full of purchase rates and stays with the inbound desk (`INBOUND_ROLES`:
 * owner, manager, accountant, warehouse, system). The shopkeeper reads no document at all (never-list 9;
 * docs/17 A12 "purchase price leaks through invoice images").
 */
export const FIELD_DOCUMENT_KINDS = ['pod', 'claim_sheet', 'other'] as const

const roleSetting = `(SELECT current_setting('app.actor_role', true))`
const tenantMatch = `tenant_id = (SELECT current_setting('app.tenant_id', true))`
/**
 * The kind-scoped predicate on `documents` (docint §3i, coordination §5.3): a member of the tenant who is
 * not the shopkeeper, and either an inbound-desk role or a document of a field kind. FOR ALL, so the
 * same rule decides what may be read and what may be written: a delivery crew inserts a `pod`, a rep a
 * `claim_sheet`, neither a `supplier_invoice`.
 */
const documentKindPredicate = sql.raw(
  `${tenantMatch} AND ${roleSetting} <> 'retailer' AND (${roleSetting} IN (${INBOUND_ROLES.map((r) => `'${r}'`).join(', ')}) OR kind IN (${FIELD_DOCUMENT_KINDS.map((k) => `'${k}'`).join(', ')}))`,
)
/**
 * A page is visible exactly when its document is: the EXISTS runs under the caller's rights, so the
 * `documents` policy above filters it (a `supplier_invoice` page is invisible to the crew). It joins
 * `documents`, never `retailer_identities`, so there is no 42P17 recursion.
 */
const documentPagePredicate = sql.raw(
  `${tenantMatch} AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id AND d.tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
)

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
    /** "1 of 5" printed on the page: the missing-pages red check (docs/05 §5.1). */
    expectedPages: integer('expected_pages'),
    /** Device capture time, distinct from `created_at` (offline capture, uploaded later). */
    capturedAt: tz('captured_at'),
    /** Reviewer note at capture. */
    note: text('note'),
    /** `documents.reject`: duplicate | unreadable | not_ours | wrong_buyer_gstin | other. */
    rejectedReason: text('rejected_reason'),
    /** pg-boss retries ×3, then `failure_code = 'extraction_failed'` and manual typing is allowed. */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Last pg-boss job id, for support. */
    jobId: text('job_id'),
    /** Prompt profile chosen at pre-classification: tally | sap-reliance | guiltfree-dms | marg-gst-local | brand-dms-secondary. */
    promptProfile: text('prompt_profile'),
    qrStatus: documentQrStatus('qr_status').notNull().default('absent'),
    ...timestamps,
  },
  (t) => [
    index('documents_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('documents_supplier_idx').on(t.tenantId, t.supplierId, t.createdAt),
    uniqueIndex('documents_hash_idx')
      .on(t.tenantId, t.contentHash)
      .where(sql`content_hash IS NOT NULL`),
    pgPolicy('documents_tenant', {
      for: 'all',
      to: appRw,
      using: documentKindPredicate,
      withCheck: documentKindPredicate,
    }),
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
    /** Per-page hash; `documents.content_hash` is the sha256 of these in `page_no` order. */
    sha256: text('sha256'),
    /** "1 of 5" exactly as printed, for the page-completeness check. */
    printedPageLabel: text('printed_page_label'),
    qrDetected: boolean('qr_detected').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('document_pages_idx').on(t.tenantId, t.documentId, t.pageNo),
    pgPolicy('document_pages_tenant', {
      for: 'all',
      to: appRw,
      using: documentPagePredicate,
      withCheck: documentPagePredicate,
    }),
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
    /**
     * Denormalised header so the manager's queue (`docint.queue.list`) is index-only and never opens
     * `result`. Still back-office only: a total is a purchase figure.
     */
    invoiceNo: text('invoice_no'),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    supplierGstin: text('supplier_gstin'),
    buyerGstin: text('buyer_gstin'),
    totalPaise: paise('total_paise'),
    lineCount: integer('line_count'),
    engineVersion: text('engine_version'),
    /** The extraction this one escalated from (docs/05 step 7); plain id, self-reference, no FK. */
    escalatedFromExtractionId: text('escalated_from_extraction_id'),
    ...timestamps,
  },
  (t) => [
    /** Newest reading per document; subsumes the old (tenant_id, document_id) index (coordination §5.4). */
    index('extractions_latest_idx').on(t.tenantId, t.documentId, t.createdAt),
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
    /** The line the check is about; null = header / document level. */
    lineNo: integer('line_no'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('extraction_checks_extraction_idx').on(t.tenantId, t.extractionId),
    index('extraction_checks_failed_idx').on(t.tenantId, t.extractionId, t.passed),
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
    /** `auto` (the cascade) or `reviewer` (a human picked a variant outside the candidate set). */
    matchedBy: text('matched_by').notNull().default('auto'),
    /** Fusion inputs (alias hit, code hit, HSN prefix, MRP delta, trigram similarity) for the eval. */
    features: jsonb('features'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    /** One row per (line, variant) so `matches.rerun` upserts; subsumes the old (extraction, line) index. */
    uniqueIndex('sku_match_candidates_unique_idx').on(
      t.tenantId,
      t.extractionId,
      t.lineNo,
      t.variantId,
    ),
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
    /** Corrections made in this session: the ≤ 1.5-edits-per-10-lines acceptance metric (docs/17). */
    editsCount: integer('edits_count').notNull().default(0),
    /** Last `review.heartbeat`; the lock TTL is extended from here. */
    heartbeatAt: tz('heartbeat_at'),
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
    /** Times the alias resolved a document; ranks aliases in the cascade (mirrors `product_aliases.hits`). */
    hits: integer('hits').notNull().default(0),
    lastSeenAt: tz('last_seen_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supplier_aliases_idx').on(t.tenantId, t.normalized),
    tenantPolicy('supplier_aliases_tenant'),
  ],
).enableRLS()
