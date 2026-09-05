import { oc } from '@orpc/contract'
import { z } from 'zod'
import { NetUnitSchema } from './catalog.js'
import {
  BpsSchema,
  GstinSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
  StateCodeSchema,
} from './common.js'
import { FileMimeTypeSchema, FileUploadUrlOutput } from './files.js'
import { SupplierInvoiceWithLinesSchema } from './procurement.js'

/**
 * Docint — document intelligence, the inbound half of docs/22 §5 ("zero typing except the gate
 * count"). A photograph or a PDF of a supplier's bill becomes a REVIEWED, HUMAN-APPROVED draft of a
 * supplier invoice: capture → QR/IRN verify → engine extraction (worker) → deterministic validators →
 * SKU match → review (single-writer lock) → approve. It owns `documents`, `document_pages`,
 * `extractions`, `extraction_checks`, `sku_match_candidates`, `review_sessions`, `corrections_log`,
 * `engine_disagreements` and `supplier_aliases`, and writes nothing else except ONE call to
 * `SupplierInvoiceService.create` at `documents.approve` (coordination §4).
 *
 * WHICH SERVICES MOUNT `docint` (docs/plans/00-coordination.md §6 table):
 *
 *   owner :3001      YES — the whole surface: capture, the review desk, the queue, the stats, approve
 *   manager :3002    YES — manager + accountant: the review desk (M3), the queue (M1), approve. The
 *                    accountant reviews and approves inbound invoices (brief §5 "the CA reviews inbound
 *                    invoices"; `procurement.supplierInvoices.create` is BACK_OFFICE for the same
 *                    reason) — approving a supplier's bill is bookkeeping, not one of the approvals the
 *                    founder took away from the accountant (docs/22 2026-09-05: prices, schemes, credit,
 *                    order approvals, settings)
 *   sales :3003      NO  — a rep never sees a supplier bill; it is a page full of purchase rates
 *   warehouse :3004  YES — CAPTURE AND STATUS ONLY (W2): `documents.create/pageUploadUrl/addPage/
 *                    verifyQr/submit/list/get/status/pageUrl`. Every extraction, match, review, queue,
 *                    stats and approve procedure refuses the warehouse role in PERMISSIONS, so mounting
 *                    the key exposes no rate. See "THE WAREHOUSE AND RATES" below
 *   delivery :3005   NO  — the crew captures a proof of delivery through `delivery.deliveries.addPod`
 *                    and `files.uploadUrl` (`domain: 'pod'`), never through this key
 *   retailer :3006   NO  — a shopkeeper reads no document of any kind (never-list 9; RLS returns 0 rows)
 *
 * THE WAREHOUSE AND RATES (coordination §6: "every other docint.* = BACK_OFFICE"; never-list 1):
 *
 *  - The database is the guarantee, not this file. Migrations 0016/0017 leave `documents` and
 *    `document_pages` kind-scoped (the inbound desk — owner, manager, accountant, warehouse — reads every
 *    kind; the field only `pod` / `claim_sheet` / `other`; the shop nothing) and keep `extractions`,
 *    `extraction_checks`, `sku_match_candidates`, `review_sessions`, `corrections_log` and
 *    `engine_disagreements` at `BACK_OFFICE_ROLES`. `rls.test.ts` asserts the warehouse role reads
 *    ZERO rows of those six tables ("not even the gate staff"). So on the CAP surface a warehouse
 *    caller sees a document, its pages and its pipeline status, and `checkSummary` / `lock` /
 *    `latestExtractionId` come back NULL for it — the rows are invisible, not hidden by the mapper.
 *  - `documents.approve` is BACK_OFFICE: the draft it creates carries printed purchase rates and
 *    becomes `tenant_product_costs` at `procurement.grns.post`. The brief's open question (docint §8
 *    q1, "may the gate approve?") was assumed NO. If the founder ever says yes, the switch is a tenant
 *    setting (`docint.warehouse_may_approve`, default off, to join `TENANT_SETTING_KEYS` in `@dos/db`)
 *    read by the handler — but PERMISSIONS is static and the RLS above denies the rows, so flipping it
 *    also needs `'warehouse'` in the approve tuple and a policy migration; it is a founder decision plus
 *    a slice, never a handler-only change. Nothing in this file pre-widens for it.
 *  - The review payload is SPLIT so that a rate-free projection exists on the wire without reshaping
 *    it later: `ReviewedLineQuantitiesSchema` (what was printed, how many pieces, which variant, which
 *    batch — the gate's half) and `ReviewedLineRatesSchema` (rate, basis, discount, tax, line total —
 *    the desk's half) compose into `ReviewedLineSchema`; `ReviewedHeaderSchema` and
 *    `ReviewedHeaderMoneySchema` do the same for the header. Today the whole `ReviewedInvoice` is served
 *    only to BACK_OFFICE (the review procedures). The warehouse's "quantities and matches" view of an
 *    approved bill IS the GRN (`procurement.grns.open/get`: `expectedQtyPcs` per `variantId`, no rate)
 *    — the projection already exists where the gate needs it, at the moment it needs it.
 *
 * FOUNDER ANSWERS (docs/17 §D, docs/22 §8) THAT SHAPE THIS FILE:
 *
 *  - Never-list 6: DOCUMENT INTAKE NEVER COMMITS ON ITS OWN. `review.submit` asserts "the reading is
 *    right" (zero red checks); `documents.approve` is a second, deliberate call that books the DRAFT:
 *    ONE `supplier_invoices` row (`source = 'docint'`, `document_id` set, status `approved` when every
 *    line resolved to a variant, else `in_review` — `SupplierInvoiceService.create` decides) with its
 *    lines. NEVER a GRN, a lot, a `stock_ledger` row, a cost or a journal line: `procurement.grns.open →
 *    count → post` does all of that, by a human, later.
 *  - Never-list 5 / ADR 0014: a `brand_dms_invoice` (Too Yumm billed in FieldAssist) is captured,
 *    extracted and reviewed here, but `documents.approve` refuses it with `NOT_IMPLEMENTED` in this
 *    slice; its commit path is billing's `importBrandDms` (external series, never a second legal
 *    invoice).
 *  - docs/17 A4: a printed per-case rate is stored AS PRINTED — `ratePaise` + `rateBasis = 'case'` +
 *    `basisQty` = pieces per case. ₹135.43 / 12 is not an integer paise; the per-piece figure is the
 *    GRN's (`tenant_product_costs.per_piece_cost`), never this module's.
 *  - docs/17 B: the BUY-SIDE pack size is `supplier_pack_configs.pcs_per_case`, resolved printed
 *    description → existing pack config → `product_variants.default_case_size`. A disagreement is the
 *    amber check `review.case_size_disagreement`; the reviewer's `pcsPerCase` on `matches.accept/choose`
 *    is the second (and last) number a human is allowed to type, and it upserts the pack config.
 *  - §D6 white-label: nothing here is printed for a shopkeeper. §D3 B2B: `buyerGstin` must equal the
 *    tenant's GSTIN; a mismatch is the red check `review.buyer_gstin_mismatch`, which only an OWNER
 *    reviewer may clear by patching `header.buyerGstin` (recorded in `corrections_log`).
 *  - English only: every message is English; no `hi-IN` anywhere.
 *
 * COORDINATION FACTS THAT SHAPE THIS FILE:
 *
 *  - `documents.pageUploadUrl` is a THIN WRAPPER over the platform object storage (`createObjectStorage().
 *    putUrl`, coordination §3.3, docs/23 §8.5), never a second signed-URL implementation: it mints the
 *    slots `tenant/{tenantId}/docs/{documentId}/page-{n}.{ext}` and answers the same
 *    `FileUploadUrlOutput` shape as `files.uploadUrl`, one per page. Both drivers today answer
 *    `inline: false` with a pre-signed PUT (the local driver signs the service's own `/storage/{key}`
 *    route); `addPage.contentBase64` is the fallback for a driver that answers `inline: true`, and
 *    `addPage.objectKey` always names the slot, so no cross-field rule is needed on the wire. Page
 *    images never pass through the database and, on S3, never through the service (docs/20 rule 15).
 *  - `documents.pageUrl` and `DocumentPageSchema.readUrl` are `getUrl` (TTL 10 minutes). The
 *    per-domain role table in files.ts says `docs` is read by BACK_OFFICE_OR_WAREHOUSE only; RLS on
 *    `document_pages` enforces the same by kind (docs/17 A12).
 *  - `documents.submit` writes the outbox row `docint.document.submitted`; the worker's relay (§3.6,
 *    built by this module's core slice) turns it into the pg-boss `docint.extract` job. With
 *    `DOCINT_INLINE_JOBS=1` (specs, local demo) the pipeline runs inside the request and the response
 *    already shows `extracted` / `needs_review`; `jobId` is null then.
 *  - Duplicates are BLOCKED, not merged: IRN → (supplier, invoice no, invoice date) → content hash.
 *    `verifyQr` surfaces the first two as `duplicate` and leaves the document alone; `addPage` answers
 *    409 with the existing `documentId` on the third; `approve` inherits procurement's refusal.
 *
 * Money is integer paise, quantities integer pieces, percentages basis points, dates IST (`businessDate()`,
 * `financialYear()` for the IRN hash), ids client-generated UUIDv7, every list caps `limit` at 200 and
 * pages on `cursor` = the last row's id. `documents.status` moves only through the document machine
 * (`uploaded → verifying → extracting → extracted → needs_review → reviewed → committed`, `rejected` /
 * `failed` from any non-terminal state); `review_sessions.status` through `open → submitted | abandoned`.
 * JSON paths (`header.invoiceNo`, `lines[3].qtyPcs`) are ONE grammar shared by `fieldConfidence`,
 * `corrections_log.path` and `engine_disagreements.path`.
 */

const IsoDateSchema = z.iso.date()
const IsoDateTimeSchema = z.iso.datetime({ offset: true })
/** The phone that captured the pages; kept on the document for "which device photographed this". */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}
/**
 * `DOCINT_MAX_PAGES`: a supplier bill is at most 20 pages per document (docs/20 rule 3, bounded work
 * per request and per engine call). A longer bill is two documents.
 */
export const DOCINT_MAX_PAGES = 20
const PageNoSchema = z.number().int().min(1).max(DOCINT_MAX_PAGES)
/** A JSON path into the reviewed invoice: `header.invoiceNo`, `lines[3].qtyPcs`. */
export const ReviewPathSchema = z.string().regex(/^(header\.[a-zA-Z]+|lines\[\d+\]\.[a-zA-Z]+)$/)
/** 0–1: the engine's own confidence in one field, or in the whole reading. */
const ConfidenceSchema = z.number().min(0).max(1)
const MAX_PAGE_BYTES = 15 * 1024 * 1024

// ---------------------------------------------------------------------------------------------------------------
// enums (verbatim from backend/libs/database/src/schema/docint.ts)

export const DocumentKindSchema = z.enum([
  'supplier_invoice',
  'lorry_receipt',
  'brand_dms_invoice',
  'claim_sheet',
  'pod',
  'other',
])
export type DocumentKind = z.infer<typeof DocumentKindSchema>

/** The document machine (see the header); `rejected` and `failed` are terminal, `committed` too. */
export const DocumentStatusSchema = z.enum([
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
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>

/**
 * What the e-invoice QR told us, apart from `irnVerified`: `absent` (no QR or not scanned), `decoded`
 * (payload read, signature not checked), `verified` (signature checks out against the IRP key),
 * `signature_failed` (amber — capture continues on vision), `mismatched` (payload contradicts the page).
 */
export const DocumentQrStatusSchema = z.enum([
  'absent',
  'decoded',
  'verified',
  'signature_failed',
  'mismatched',
])
export type DocumentQrStatus = z.infer<typeof DocumentQrStatusSchema>

/** Why a document was rejected by the desk. A committed document is never rejected: it gets a credit note. */
export const DocumentRejectReasonSchema = z.enum([
  'duplicate',
  'unreadable',
  'not_ours',
  'wrong_buyer_gstin',
  'other',
])
export type DocumentRejectReason = z.infer<typeof DocumentRejectReasonSchema>

/** A page is a photo or a PDF; HEIC/WEBP are converted on the phone before upload (UX-00 §8.3). */
export const DocumentPageMimeTypeSchema = FileMimeTypeSchema.extract([
  'image/jpeg',
  'image/png',
  'application/pdf',
])
export type DocumentPageMimeType = z.infer<typeof DocumentPageMimeTypeSchema>

/** Every engine that may have produced a reading (`extraction_engine` in the schema). */
export const ExtractionEngineSchema = z.enum([
  'irn_pull',
  'qr',
  'llm_vision',
  'llm_vision_secondary',
  'template',
  'manual',
])
export type ExtractionEngine = z.infer<typeof ExtractionEngineSchema>

/** The engines a human may ASK for on `extractions.run`; `qr` / `irn_pull` / `manual` are never requested. */
export const ExtractionRunEngineSchema = ExtractionEngineSchema.extract([
  'llm_vision',
  'llm_vision_secondary',
  'template',
])
export type ExtractionRunEngine = z.infer<typeof ExtractionRunEngineSchema>

/** `error` = red (blocks `review.submit`), `warn` = amber (shown, never blocks). */
export const CheckSeveritySchema = z.enum(['error', 'warn'])
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>

/** The cascade step that produced a candidate (docs/05 step 8), or `reviewer` for a human pick. */
export const SkuMatchReasonSchema = z.enum([
  'supplier_alias',
  'external_code',
  'ean',
  'hsn_brand_mrp',
  'trgm',
  'reviewer',
])
export type SkuMatchReason = z.infer<typeof SkuMatchReasonSchema>

export const SkuMatchedBySchema = z.enum(['auto', 'reviewer'])
export type SkuMatchedBy = z.infer<typeof SkuMatchedBySchema>

/** Why the reviewer rejected a candidate (or the whole line's match). */
export const SkuMatchRejectReasonSchema = z.enum([
  'wrong_product',
  'wrong_pack',
  'not_in_catalog',
  'duplicate_line',
  'other',
])
export type SkuMatchRejectReason = z.infer<typeof SkuMatchRejectReasonSchema>

export const ReviewSessionStatusSchema = z.enum(['open', 'submitted', 'abandoned'])
export type ReviewSessionStatus = z.infer<typeof ReviewSessionStatusSchema>

/** docs/17 A4: the printed rate is per piece or per case of `basisQty` pieces. */
export const RateBasisSchema = z.enum(['piece', 'case'])
export type RateBasis = z.infer<typeof RateBasisSchema>

/** The statuses a document can have while it sits in the manager's worklist. */
export const QueueStatusSchema = DocumentStatusSchema.extract([
  'extracted',
  'needs_review',
  'reviewed',
  'failed',
])
export type QueueStatus = z.infer<typeof QueueStatusSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — documents (CAP: no money field anywhere in these)

/** The ten fields of the e-invoice QR (docs/05 step 1), normalised: total in paise, dates ISO. */
export const QrPayloadSchema = z.object({
  sellerGstin: GstinSchema,
  buyerGstin: GstinSchema,
  docNo: z.string(),
  docTyp: z.enum(['INV', 'CRN', 'DBN']),
  /** ISO date, converted from the QR's dd/MM/yyyy. */
  docDt: IsoDateSchema,
  totInvValPaise: PaiseSchema,
  itemCnt: z.number().int().nonnegative(),
  mainHsnCode: z.string(),
  irn: z.string().regex(/^[0-9a-f]{64}$/i),
  irnDt: IsoDateTimeSchema,
})
export type QrPayload = z.infer<typeof QrPayloadSchema>

/**
 * A page of a document. `readUrl` is object storage `getUrl` (TTL 10 min, `readUrlExpiresAt`); refresh
 * an expired one with `documents.pageUrl` instead of re-fetching the document.
 */
export const DocumentPageSchema = z.object({
  id: IdSchema,
  pageNo: z.number().int().positive(),
  objectKey: z.string(),
  mimeType: DocumentPageMimeTypeSchema,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  /** "1 of 5" exactly as printed; feeds the page-completeness check. */
  printedPageLabel: z.string().nullable(),
  qrDetected: z.boolean(),
  readUrl: z.string(),
  readUrlExpiresAt: z.string(),
})
export type DocumentPage = z.infer<typeof DocumentPageSchema>

/**
 * The list row. NO MONEY FIELD: the CAP surface (warehouse included) reads this. Totals live on
 * `Extraction` and `QueueItem`, both BACK_OFFICE.
 */
export const DocumentSchema = z.object({
  id: IdSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  supplierId: IdSchema.nullable(),
  supplierName: z.string().nullable(),
  irn: z.string().nullable(),
  irnVerified: z.boolean(),
  qrStatus: DocumentQrStatusSchema,
  pageCount: z.number().int().nonnegative(),
  expectedPages: z.number().int().nullable(),
  /** pg-boss retries ×3, then `failureCode = 'extraction_failed'` and manual typing is allowed. */
  attemptCount: z.number().int().nonnegative(),
  failureCode: z.string().nullable(),
  rejectedReason: DocumentRejectReasonSchema.nullable(),
  /** Prompt profile chosen at pre-classification (tally | sap-reliance | guiltfree-dms | …). */
  promptProfile: z.string().nullable(),
  /** `supplier_invoice` + the id of the draft once approved. */
  committedEntityType: z.string().nullable(),
  committedEntityId: z.string().nullable(),
  committedAt: z.string().nullable(),
  uploadedBy: IdSchema,
  uploadedByName: z.string().nullable(),
  capturedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Document = z.infer<typeof DocumentSchema>

/** Counts of failed checks on the newest extraction. Null for a warehouse caller (RLS) or before extraction. */
export const CheckSummarySchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
})
export type CheckSummary = z.infer<typeof CheckSummarySchema>

/** Who holds the single-writer review lock right now. Null when nobody does, or for a warehouse caller. */
export const ReviewLockSchema = z.object({
  reviewSessionId: IdSchema,
  reviewerId: IdSchema,
  reviewerName: z.string().nullable(),
  lockedUntil: z.string(),
})
export type ReviewLock = z.infer<typeof ReviewLockSchema>

/**
 * The document with its pages and where it is in the pipeline. `qrPayload`, `checkSummary`, `lock` and
 * `latestExtractionId` are what `verifyQr` and the worker left behind; for a warehouse caller the last
 * three are null because the rows are invisible to it (see the header).
 */
export const DocumentDetailSchema = DocumentSchema.extend({
  pages: z.array(DocumentPageSchema),
  qrPayload: QrPayloadSchema.nullable(),
  checkSummary: CheckSummarySchema.nullable(),
  lock: ReviewLockSchema.nullable(),
  latestExtractionId: IdSchema.nullable(),
  /** Last pg-boss job id, for support. */
  jobId: z.string().nullable(),
})
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>

const DocumentItemOutput = z.object({ item: DocumentDetailSchema })

/** The cheap poll after `submit`: no pages, no signed URLs. */
export const DocumentStatusOutput = z.object({
  id: IdSchema,
  status: DocumentStatusSchema,
  qrStatus: DocumentQrStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  failureCode: z.string().nullable(),
  jobId: z.string().nullable(),
  latestExtractionId: IdSchema.nullable(),
  checkSummary: CheckSummarySchema.nullable(),
  lock: ReviewLockSchema.nullable(),
  updatedAt: z.string(),
})
export type DocumentStatusView = z.infer<typeof DocumentStatusOutput>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — the engine's reading (BACK_OFFICE: carries printed purchase rates)

/**
 * Where a line was read from: the page, the printed row text and (optionally) the box on the page as
 * fractions of its width/height. REQUIRED per line (brief §4.13): a reading without evidence is a
 * hallucination candidate and fails validation before it reaches review.
 */
export const LineEvidenceSchema = z.object({
  pageNo: z.number().int().positive(),
  rowText: z.string(),
  /** [x0, y0, x1, y1] in 0–1 page fractions; null when the engine gave no box. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
})
export type LineEvidence = z.infer<typeof LineEvidenceSchema>

/** The header as the engine read it. Everything nullable: an engine may fail to read a field. */
export const ExtractedHeaderSchema = z.object({
  supplierName: z.string().nullable(),
  supplierGstin: z.string().nullable(),
  buyerName: z.string().nullable(),
  buyerGstin: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceDate: IsoDateSchema.nullable(),
  irn: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
  placeOfSupplyState: StateCodeSchema.nullable(),
  subtotalPaise: PaiseSchema.nullable(),
  discountPaise: PaiseSchema.nullable(),
  cgstPaise: PaiseSchema.nullable(),
  sgstPaise: PaiseSchema.nullable(),
  igstPaise: PaiseSchema.nullable(),
  cessPaise: PaiseSchema.nullable(),
  freightPaise: PaiseSchema.nullable(),
  roundOffPaise: PaiseSchema.nullable(),
  totalPaise: PaiseSchema.nullable(),
})
export type ExtractedHeader = z.infer<typeof ExtractedHeaderSchema>

/** One printed line as the engine read it, money already in paise (`fromRupees()`, never `parseFloat * 100`). */
export const ExtractedLineSchema = z.object({
  lineNo: z.number().int().positive(),
  description: z.string(),
  supplierCode: z.string().nullable(),
  hsnCode: z.string().nullable(),
  batchNo: z.string().nullable(),
  mfgDate: IsoDateSchema.nullable(),
  expiryDate: IsoDateSchema.nullable(),
  mrpPaise: PaiseSchema.nullable(),
  printedQty: z.number().int().nullable(),
  printedUnit: z.string().nullable(),
  /** Parsed from the description (`x 90`, `_120`, `(16+5.5)`); null when nothing parsed. */
  caseSize: z.number().int().positive().nullable(),
  qtyPcs: PiecesSchema.nullable(),
  freeQtyPcs: PiecesSchema.nullable(),
  ratePaise: PaiseSchema.nullable(),
  rateBasis: RateBasisSchema.nullable(),
  basisQty: z.number().int().positive().nullable(),
  discountBps: BpsSchema.nullable(),
  discountPaise: PaiseSchema.nullable(),
  gstBps: BpsSchema.nullable(),
  cessBps: BpsSchema.nullable(),
  taxablePaise: PaiseSchema.nullable(),
  taxPaise: PaiseSchema.nullable(),
  lineTotalPaise: PaiseSchema.nullable(),
  evidence: LineEvidenceSchema,
})
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>

/**
 * A handwritten note on the page ("short 2 cs", a corrected rate). Shown in its own panel; applying
 * one is an explicit reviewer edit (`review.save.annotations`) and NEVER silently overwrites a printed
 * value (brief §4.14).
 */
export const HandwrittenAnnotationSchema = z.object({
  id: z.string(),
  pageNo: z.number().int().positive(),
  text: z.string(),
  /** The field the engine thinks the note is about, and what it would change it to. */
  nearPath: ReviewPathSchema.nullable(),
  suggestedValue: z.unknown().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
})
export type HandwrittenAnnotation = z.infer<typeof HandwrittenAnnotationSchema>

/** Confidence per field, keyed by review path: `{ 'header.invoiceNo': 0.99, 'lines[3].qtyPcs': 0.71 }`. */
export const FieldConfidenceSchema = z.record(ReviewPathSchema, ConfidenceSchema)
export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>

/** The normalised invoice JSON one engine produced (`extractions.result`). */
export const ExtractedInvoiceSchema = z.object({
  header: ExtractedHeaderSchema,
  lines: z.array(ExtractedLineSchema).max(500),
  fieldConfidence: FieldConfidenceSchema,
  handwrittenAnnotations: z.array(HandwrittenAnnotationSchema),
  pageCount: z.number().int().nonnegative(),
})
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>

/** One deterministic validator's verdict; `lineNo` null = header / document level. */
export const ExtractionCheckSchema = z.object({
  id: IdSchema,
  /** `gstin_checksum`, `line_arithmetic`, `sum_lines_equals_total`, `page_completeness`, `review.*` … */
  check: z.string(),
  passed: z.boolean(),
  severity: CheckSeveritySchema,
  lineNo: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
})
export type ExtractionCheck = z.infer<typeof ExtractionCheckSchema>

/** One engine run. `result` (the full reading) is present only when asked for (`includeResult`) or on `get`. */
export const ExtractionSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  engine: ExtractionEngineSchema,
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  engineVersion: z.string().nullable(),
  /** Overall confidence of the reading; per field is `result.fieldConfidence`. */
  confidence: ConfidenceSchema.nullable(),
  costPaise: PaiseSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  supplierGstin: z.string().nullable(),
  buyerGstin: z.string().nullable(),
  totalPaise: PaiseSchema.nullable(),
  lineCount: z.number().int().nullable(),
  escalatedFromExtractionId: IdSchema.nullable(),
  createdAt: z.string(),
  checks: z.array(ExtractionCheckSchema),
  result: ExtractedInvoiceSchema.nullable(),
})
export type Extraction = z.infer<typeof ExtractionSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — SKU match candidates (BACK_OFFICE)

/** A candidate variant for one printed line, joined to the catalog through `CatalogService`. MRP is public; no cost. */
export const SkuCandidateSchema = z.object({
  id: IdSchema,
  extractionId: IdSchema,
  lineNo: z.number().int().positive(),
  variantId: IdSchema,
  variantName: z.string(),
  productName: z.string(),
  brandName: z.string().nullable(),
  netQty: z.number().int(),
  netUnit: NetUnitSchema,
  defaultCaseSize: z.number().int().positive(),
  mrpPaise: PaiseSchema.nullable(),
  /** The tenant's remembered buy-side pack for this supplier + variant, when one exists. */
  packPcsPerCase: z.number().int().positive().nullable(),
  score: ConfidenceSchema,
  reason: SkuMatchReasonSchema,
  chosen: z.boolean(),
  matchedBy: SkuMatchedBySchema,
  /** Fusion inputs (alias hit, code hit, HSN prefix, MRP delta, trigram similarity) for the eval. */
  features: z.record(z.string(), z.unknown()).nullable(),
})
export type SkuCandidate = z.infer<typeof SkuCandidateSchema>

/** A line's candidates after a change, plus where the line now stands. */
export const SkuLineOutput = z.object({
  lineNo: z.number().int().positive(),
  /** `green` = a chosen candidate, `amber` = candidates but none chosen, `red` = no candidate at all. */
  band: z.enum(['green', 'amber', 'red']),
  items: z.array(SkuCandidateSchema),
})
export type SkuLine = z.infer<typeof SkuLineOutput>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — the reviewed invoice (BACK_OFFICE), split into the gate's half and the desk's half

/** The header WITHOUT money: identity, dates, references. */
export const ReviewedHeaderSchema = z.object({
  supplierId: IdSchema.nullable(),
  supplierName: z.string().nullable(),
  supplierGstin: z.string().nullable(),
  buyerGstin: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceDate: IsoDateSchema.nullable(),
  irn: z.string().nullable(),
  ewayBillNo: z.string().nullable(),
  placeOfSupplyState: StateCodeSchema.nullable(),
  purchaseOrderId: IdSchema.nullable(),
  dueDate: IsoDateSchema.nullable(),
})
export type ReviewedHeader = z.infer<typeof ReviewedHeaderSchema>

/** The header's money: what `CreateSupplierInvoiceInput` needs, nullable until the reviewer has it. */
export const ReviewedHeaderMoneySchema = z.object({
  subtotalPaise: PaiseSchema.nullable(),
  discountPaise: PaiseSchema.nullable(),
  cgstPaise: PaiseSchema.nullable(),
  sgstPaise: PaiseSchema.nullable(),
  igstPaise: PaiseSchema.nullable(),
  cessPaise: PaiseSchema.nullable(),
  freightPaise: PaiseSchema.nullable(),
  roundOffPaise: PaiseSchema.nullable(),
  totalPaise: PaiseSchema.nullable(),
})
export type ReviewedHeaderMoney = z.infer<typeof ReviewedHeaderMoneySchema>

/**
 * THE GATE'S HALF of a line: what was printed, how many pieces, which variant, which batch and expiry,
 * the MRP on the pack. No purchase rate in here — this is the projection a warehouse role could be
 * served (see the header) and it is exactly what the GRN line carries.
 */
export const ReviewedLineQuantitiesSchema = z.object({
  lineNo: z.number().int().positive(),
  description: z.string(),
  supplierCode: z.string().nullable(),
  variantId: IdSchema.nullable(),
  hsnCode: z.string().nullable(),
  batchNo: z.string().nullable(),
  mfgDate: IsoDateSchema.nullable(),
  expiryDate: IsoDateSchema.nullable(),
  mrpPaise: PaiseSchema.nullable(),
  printedQty: z.number().int().nullable(),
  printedUnit: z.string().nullable(),
  /** The resolved buy-side pack (docs/17 B); null while the case-size disagreement is unresolved. */
  caseSize: z.number().int().positive().nullable(),
  qtyPcs: PiecesSchema.nullable(),
  freeQtyPcs: PiecesSchema,
})
export type ReviewedLineQuantities = z.infer<typeof ReviewedLineQuantitiesSchema>

/** THE DESK'S HALF: the printed rate as printed (docs/17 A4), discount, tax and the line total. */
export const ReviewedLineRatesSchema = z.object({
  ratePaise: PaiseSchema.nullable(),
  rateBasis: RateBasisSchema,
  basisQty: z.number().int().positive(),
  discountBps: BpsSchema,
  discountPaise: PaiseSchema,
  gstBps: BpsSchema,
  cessBps: BpsSchema,
  taxablePaise: PaiseSchema.nullable(),
  taxPaise: PaiseSchema.nullable(),
  lineTotalPaise: PaiseSchema.nullable(),
})
export type ReviewedLineRates = z.infer<typeof ReviewedLineRatesSchema>

export const ReviewedLineSchema = ReviewedLineQuantitiesSchema.extend(ReviewedLineRatesSchema.shape)
export type ReviewedLine = z.infer<typeof ReviewedLineSchema>

/** A handwritten annotation's fate in this session. */
export const ReviewedAnnotationSchema = z.object({
  id: z.string(),
  applied: z.boolean(),
})

/** `review_sessions.reviewed`: the engine's best reading merged with the chosen candidates and the reviewer's edits. */
export const ReviewedInvoiceSchema = z.object({
  header: ReviewedHeaderSchema.extend(ReviewedHeaderMoneySchema.shape),
  lines: z.array(ReviewedLineSchema).max(500),
  annotations: z.array(ReviewedAnnotationSchema),
})
export type ReviewedInvoice = z.infer<typeof ReviewedInvoiceSchema>

/** Two engines read one field differently (`engine_disagreements`); the reviewer sees both. */
export const EngineDisagreementSchema = z.object({
  id: IdSchema,
  path: ReviewPathSchema,
  values: z.record(z.string(), z.unknown()),
  resolvedValue: z.unknown().nullable(),
})
export type EngineDisagreement = z.infer<typeof EngineDisagreementSchema>

/** PO cases, lorry-receipt packages and the gate's package count next to the bill (docs/22 §5 three-way match). */
export const ThreeWayMatchSchema = z.object({
  poCases: z.number().int().nullable(),
  lrPackages: z.number().int().nullable(),
  gateCount: z.number().int().nullable(),
})
export type ThreeWayMatch = z.infer<typeof ThreeWayMatchSchema>

export const ReviewSessionSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  reviewerId: IdSchema,
  reviewerName: z.string().nullable(),
  baseExtractionId: IdSchema.nullable(),
  status: ReviewSessionStatusSchema,
  lockedUntil: z.string(),
  heartbeatAt: z.string().nullable(),
  /** Corrections made in this session: the ≤ 1.5-edits-per-10-lines acceptance metric (docs/17). */
  editsCount: z.number().int().nonnegative(),
  submittedAt: z.string().nullable(),
  reviewed: ReviewedInvoiceSchema,
  checks: z.array(ExtractionCheckSchema),
  /** Failed checks with `severity = 'error'`: `review.submit` refuses while this is above zero. */
  blocking: z.number().int().nonnegative(),
  disagreements: z.array(EngineDisagreementSchema),
  threeWayMatch: ThreeWayMatchSchema.nullable(),
  createdAt: z.string(),
})
export type ReviewSession = z.infer<typeof ReviewSessionSchema>

const ReviewSessionOutput = z.object({ session: ReviewSessionSchema })
/** After a save or a submit: the session, the checks as they stand and how many still block. */
const ReviewSessionWithChecksOutput = z.object({
  session: ReviewSessionSchema,
  checks: z.array(ExtractionCheckSchema),
  blocking: z.number().int().nonnegative(),
})

// ---------------------------------------------------------------------------------------------------------------
// output shapes — the queue and the stats (BACK_OFFICE: carry totals)

/** One row of the manager's inbound worklist: `documents` joined to the newest extraction's denormalised header. */
export const QueueItemSchema = z.object({
  documentId: IdSchema,
  kind: DocumentKindSchema,
  status: QueueStatusSchema,
  supplierId: IdSchema.nullable(),
  supplierName: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  totalPaise: PaiseSchema.nullable(),
  lineCount: z.number().int().nullable(),
  redCount: z.number().int().nonnegative(),
  amberCount: z.number().int().nonnegative(),
  unmatchedLines: z.number().int().nonnegative(),
  irnVerified: z.boolean(),
  qrStatus: DocumentQrStatusSchema,
  /** Minutes since capture: the queue is drained oldest first. */
  ageMinutes: z.number().int().nonnegative(),
  uploadedBy: IdSchema,
  uploadedByName: z.string().nullable(),
  lockedByUserId: IdSchema.nullable(),
  lockedByName: z.string().nullable(),
  createdAt: z.string(),
})
export type QueueItem = z.infer<typeof QueueItemSchema>

export const SupplierDocintStatsSchema = z.object({
  supplierId: IdSchema,
  supplierName: z.string(),
  documents: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  editsPerTenLines: z.number().nonnegative(),
  /** failed / documents, 0–1. */
  failureRate: z.number().min(0).max(1),
})

/**
 * The docs/11 alarm surface and the docs/17 acceptance metric (≤ 1.5 edits per 10-line invoice). Totals
 * for a date range; the owner's day-by-day series (O26 "Docint quality") is `reporting.series`, not here.
 */
export const DocintStatsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  documents: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  avgLatencyMs: z.number().int().nonnegative().nullable(),
  p95LatencyMs: z.number().int().nonnegative().nullable(),
  costPaise: PaiseSchema,
  editsPerDocument: z.number().nonnegative(),
  editsPerTenLines: z.number().nonnegative(),
  /** Hard-capped at 400 suppliers. */
  bySupplier: z.array(SupplierDocintStatsSchema).max(400),
})
export type DocintStats = z.infer<typeof DocintStatsSchema>

// ---------------------------------------------------------------------------------------------------------------
// inputs — capture (CAP)

export const CreateDocumentInput = MutationBase.extend({
  id: IdSchema,
  kind: DocumentKindSchema,
  /** Known at capture when the loader picked the supplier; otherwise resolved from the QR / the reading. */
  supplierId: IdSchema.optional(),
  /** "1 of 5" as printed: `submit` refuses until every page is there. */
  expectedPages: PageNoSchema.optional(),
  capturedAt: IsoDateTimeSchema.optional(),
  note: z.string().trim().max(200).optional(),
  deviceId: DeviceIdSchema.optional(),
})
export type CreateDocumentIn = z.infer<typeof CreateDocumentInput>
export const CreateDocumentOutput = DocumentItemOutput

/** One page to mint a slot for. */
export const PageUploadSlotInput = z.object({
  pageNo: PageNoSchema,
  mimeType: DocumentPageMimeTypeSchema,
  bytes: z.number().int().positive().max(MAX_PAGE_BYTES),
})

/**
 * Mint the upload slot(s) for one or more pages in one call: the object keys are
 * `tenant/{tenantId}/docs/{documentId}/page-{pageNo}.{ext}`, chosen by the server, and each slot is
 * the platform's `putUrl` (coordination §3.3). Does not write `document_pages`; `addPage` does, once
 * the bytes are there. Re-minting a slot for a page already registered is refused (409).
 */
export const PageUploadUrlInput = MutationBase.extend({
  id: IdSchema,
  pages: z.array(PageUploadSlotInput).min(1).max(DOCINT_MAX_PAGES),
})
export type PageUploadUrlIn = z.infer<typeof PageUploadUrlInput>

export const PageUploadSlotSchema = FileUploadUrlOutput.extend({
  pageNo: z.number().int().positive(),
})
export type PageUploadSlot = z.infer<typeof PageUploadSlotSchema>
export const PageUploadUrlOutput = z.object({ slots: z.array(PageUploadSlotSchema) })

/**
 * Register one uploaded page. `objectKey` is ALWAYS the slot `pageUploadUrl` minted for this page: on
 * both drivers the bytes were already PUT there, and `contentBase64` stays absent. When the slot
 * answered `inline: true` (a driver with nowhere to PUT) the bytes travel here instead and the server
 * writes them to `objectKey` before registering the page. Recomputes `documents.content_hash` from the
 * page hashes in `pageNo` order; a collision is 409 `duplicate_document` carrying the existing
 * `documentId`. Refused once `status` is beyond `extracting`.
 */
export const AddPageInput = MutationBase.extend({
  id: IdSchema,
  /** Client id of the `document_pages` row. */
  pageId: IdSchema,
  pageNo: PageNoSchema,
  mimeType: DocumentPageMimeTypeSchema,
  bytes: z.number().int().positive().max(MAX_PAGE_BYTES).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  objectKey: z.string().trim().min(1).max(512),
  /** The inline fallback only; capped well under the request body limit. */
  contentBase64: z.base64().max(700_000).optional(),
  printedPageLabel: z.string().trim().max(20).optional(),
  qrDetected: z.boolean().optional(),
})
export type AddPageIn = z.infer<typeof AddPageInput>
export const AddPageOutput = DocumentItemOutput

/**
 * The e-invoice QR is an RS256 JWT printed on page 1. Decoded, its ten fields are checked against the
 * page and its signature against the IRP keys when `DOCINT_IRP_KEYS` is configured; a failed
 * signature is amber (`qr_status = 'signature_failed'`), never an error. `supplierId` is resolved from
 * `sellerGstin` via `supplier_aliases.gstin` then `suppliers.gstin`.
 */
export const VerifyQrInput = MutationBase.extend({
  id: IdSchema,
  qrText: z.string().trim().min(1).max(4000),
})
export type VerifyQrIn = z.infer<typeof VerifyQrInput>

/** A duplicate is BLOCKED: the same IRN already on a supplier invoice or on another document. */
export const DuplicateHintSchema = z.object({
  supplierInvoiceId: IdSchema.nullable(),
  documentId: IdSchema.nullable(),
})
export type DuplicateHint = z.infer<typeof DuplicateHintSchema>
export const VerifyQrOutput = z.object({
  item: DocumentDetailSchema,
  qr: QrPayloadSchema.nullable(),
  duplicate: DuplicateHintSchema.nullable(),
})

/**
 * Capture is closed. Page completeness first (`expectedPages` or a parsed "n of m" label): missing pages
 * → 400 `pages_missing` listing them, status unchanged. Otherwise `uploaded → verifying`, the outbox row
 * `docint.document.submitted`, and the pg-boss `docint.extract` job (`jobId`; null when the pipeline ran
 * inline).
 */
export const SubmitDocumentInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
export type SubmitDocumentIn = z.infer<typeof SubmitDocumentInput>
export const SubmitDocumentOutput = z.object({
  item: DocumentDetailSchema,
  jobId: z.string().nullable(),
})

export const DocumentsListInput = z.object({
  kind: DocumentKindSchema.optional(),
  status: DocumentStatusSchema.optional(),
  /** Several statuses in one call (`statuses[0]=extracted&statuses[1]=needs_review`). */
  statuses: z.array(DocumentStatusSchema).max(9).optional(),
  supplierId: IdSchema.optional(),
  uploadedBy: IdSchema.optional(),
  /** The caller's own captures — the warehouse phone's "what I photographed today". */
  mine: QueryBoolSchema.optional(),
  /** Created on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const DocumentsListOutput = z.object({
  items: z.array(DocumentSchema),
  nextCursor: z.string().nullable(),
})

export const DocumentGetInput = z.object({ id: IdSchema })
export const DocumentGetOutput = DocumentItemOutput

export const DocumentStatusInput = z.object({ id: IdSchema })

export const DocumentPageUrlInput = z.object({
  id: IdSchema,
  pageNo: QueryIntSchema.min(1).max(DOCINT_MAX_PAGES),
})
/** A fresh signed GET for one page (object storage `getUrl`, TTL 10 minutes). */
export const DocumentPageUrlOutput = z.object({
  objectKey: z.string(),
  url: z.string(),
  expiresAt: z.string(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — the desk (BACK_OFFICE)

/** `status → rejected`; any `open` review session becomes `abandoned`. Refused on a committed document. */
export const RejectDocumentInput = MutationBase.extend({
  id: IdSchema,
  reason: DocumentRejectReasonSchema,
  note: z.string().trim().max(200).optional(),
})
export type RejectDocumentIn = z.infer<typeof RejectDocumentInput>
export const RejectDocumentOutput = DocumentItemOutput

/**
 * Retry or escalate by hand. Bumps `attemptCount`, `status → extracting`, enqueues `docint.extract`
 * (or `docint.escalate` for `llm_vision_secondary`). Refused while a review session is `open` or the
 * document is `committed`; `force` is required to re-read a document that already has an extraction.
 */
export const RunExtractionInput = MutationBase.extend({
  id: IdSchema,
  engine: ExtractionRunEngineSchema.default('llm_vision'),
  force: z.boolean().default(false),
})
export type RunExtractionIn = z.infer<typeof RunExtractionInput>
export const RunExtractionOutput = z.object({
  item: DocumentDetailSchema,
  jobId: z.string().nullable(),
})

export const ExtractionsListInput = z.object({
  id: IdSchema,
  /** Include the full reading (`result`) on every row; off by default, the queue never needs it. */
  includeResult: QueryBoolSchema.default(false),
})
export const ExtractionsListOutput = z.object({ items: z.array(ExtractionSchema) })

export const ExtractionGetInput = z.object({ id: IdSchema })
export const ExtractionGetOutput = z.object({ item: ExtractionSchema })

export const MatchesListInput = z.object({
  extractionId: IdSchema,
  lineNo: QueryIntSchema.min(1).optional(),
  /** Only lines with no chosen candidate (the amber and red ones). */
  unmatchedOnly: QueryBoolSchema.optional(),
  ...CursorInput,
})
/** Candidates ordered `lineNo asc, score desc`, paged on the candidate id. */
export const MatchesListOutput = z.object({
  items: z.array(SkuCandidateSchema),
  nextCursor: z.string().nullable(),
})

/** Common head of the three per-line match writes: the extraction (path) and the printed line (body). */
const MatchLineBase = {
  id: IdSchema,
  lineNo: z.number().int().positive(),
}
const MatchPackFields = {
  /**
   * The buy-side pack (docs/17 B): the second number a human may type. Defaults to the parsed pack, else
   * the existing pack config, else the variant's default case size. Upserts `supplier_pack_configs`.
   */
  pcsPerCase: z.number().int().positive().max(10_000).optional(),
  /** Remember the printed description as a `supplier_aliases` hit so the next bill matches green. */
  rememberAlias: z.boolean().default(true),
}

/** ACCEPT one of the listed candidates: it becomes `chosen`, the rest of the line `chosen = false`. */
export const AcceptMatchInput = MutationBase.extend({
  ...MatchLineBase,
  candidateId: IdSchema,
  ...MatchPackFields,
})
export type AcceptMatchIn = z.infer<typeof AcceptMatchInput>

/**
 * REJECT a candidate (`candidateId`) or the line's match as a whole (no `candidateId`): the line goes
 * back to amber/red with no chosen candidate and the reason is kept on the candidate's `features` and,
 * when a session is open, in `corrections_log`. `not_in_catalog` is the cue for `catalog.propose` followed
 * by `matches.rerun`.
 */
export const RejectMatchInput = MutationBase.extend({
  ...MatchLineBase,
  candidateId: IdSchema.optional(),
  reason: SkuMatchRejectReasonSchema,
  note: z.string().trim().max(200).optional(),
})
export type RejectMatchIn = z.infer<typeof RejectMatchInput>

/**
 * PICK ANOTHER: a variant outside the candidate set (found through `catalog.search`). Inserted as a
 * candidate with `score = 1`, `reason = 'reviewer'`, `matchedBy = 'reviewer'`, `chosen = true`.
 */
export const ChooseMatchInput = MutationBase.extend({
  ...MatchLineBase,
  variantId: IdSchema,
  ...MatchPackFields,
})
export type ChooseMatchIn = z.infer<typeof ChooseMatchInput>

/** The line after any of the three writes. */
export const SkuMatchLineOutput = z.object({ line: SkuLineOutput })

/**
 * Re-run the cascade for every line with no chosen candidate — right after `catalog.propose` created
 * the missing product. Upserts through the unique index; never disturbs a chosen line.
 */
export const RerunMatchesInput = MutationBase.extend({ id: IdSchema })
export type RerunMatchesIn = z.infer<typeof RerunMatchesInput>
export const RerunMatchesOutput = z.object({
  green: z.number().int().nonnegative(),
  amber: z.number().int().nonnegative(),
  red: z.number().int().nonnegative(),
})

/**
 * Take the single-writer lock (docs/05 step 10). An `open` session held by SOMEONE ELSE with
 * `lockedUntil > now` → 409 `locked` carrying the holder's name (the second manager sees read-only); a
 * stale one is flipped to `abandoned` first. `reviewed` is seeded from the best extraction, the chosen
 * candidates and the pack-size normalisation; `status → needs_review`.
 */
export const StartReviewInput = MutationBase.extend({
  id: IdSchema,
  /** Client id of the `review_sessions` row. */
  sessionId: IdSchema,
  /** Which reading to review; defaults to the one that passes the most checks. */
  baseExtractionId: IdSchema.optional(),
})
export type StartReviewIn = z.infer<typeof StartReviewInput>
export const StartReviewOutput = ReviewSessionOutput

/** Extends the lock by `DOCINT_LOCK_TTL_SECONDS` (300). 403 unless the caller holds it and it is `open`. */
export const HeartbeatReviewInput = MutationBase.extend({ id: IdSchema })
export type HeartbeatReviewIn = z.infer<typeof HeartbeatReviewInput>
export const HeartbeatReviewOutput = z.object({ lockedUntil: z.string() })

/** A header patch: any subset of the identity fields and the money fields. */
export const ReviewHeaderPatchSchema = ReviewedHeaderSchema.extend(
  ReviewedHeaderMoneySchema.shape,
).partial()
export type ReviewHeaderPatch = z.infer<typeof ReviewHeaderPatchSchema>

/** A line patch: `lineNo` names the line, everything else is optional. */
export const ReviewLinePatchSchema = ReviewedLineSchema.partial().extend({
  lineNo: z.number().int().positive(),
})
export type ReviewLinePatch = z.infer<typeof ReviewLinePatchSchema>

/**
 * Merge a patch into `reviewed`: ONE `corrections_log` row per changed path, `editsCount` bumped, the
 * `review.*` validators re-run over the merged document (the engine's own checks are kept for the
 * eval). Applying a handwritten annotation is an explicit edit here, never an automatic overwrite.
 * `header.buyerGstin` may be patched by an OWNER reviewer only (docs/17 §D3; brief §4.10).
 */
export const SaveReviewInput = MutationBase.extend({
  id: IdSchema,
  patch: z.object({
    header: ReviewHeaderPatchSchema.optional(),
    lines: z.array(ReviewLinePatchSchema).max(500).optional(),
    annotations: z.array(ReviewedAnnotationSchema).max(100).optional(),
  }),
})
export type SaveReviewIn = z.infer<typeof SaveReviewInput>
export const SaveReviewOutput = ReviewSessionWithChecksOutput

/** `open → abandoned`; the document falls back to `extracted` so another manager may take it. */
export const ReleaseReviewInput = MutationBase.extend({ id: IdSchema })
export type ReleaseReviewIn = z.infer<typeof ReleaseReviewInput>
export const ReleaseReviewOutput = ReviewSessionOutput

/**
 * "The reading is right": refused with 400 `checks_blocking` while any `error` check fails. Session
 * `open → submitted`, document `→ reviewed`, outbox `docint.document.reviewed`. Creates NOTHING in
 * procurement — approving is the separate, deliberate call below.
 */
export const SubmitReviewInput = MutationBase.extend({ id: IdSchema })
export type SubmitReviewIn = z.infer<typeof SubmitReviewInput>
export const SubmitReviewOutput = ReviewSessionWithChecksOutput

/**
 * "Book it": only from `reviewed`. Maps the submitted `reviewed` payload onto procurement's
 * `CreateSupplierInvoiceInput` (`source: 'docint'`, `documentId`, printed `rateBasis` / `basisQty`)
 * and calls `SupplierInvoiceService.create` in the same transaction, so its header-total check and its
 * IRN / (supplier, no, date) duplicate refusal apply unchanged. The result is the supplier invoice
 * DRAFT — `in_review` or `approved` — that `procurement.grns.open` will pick up. NEVER a GRN.
 * Idempotent on the document: a replay answers the same supplier invoice.
 */
export const ApproveDocumentInput = MutationBase.extend({
  id: IdSchema,
  /** Client id of the `supplier_invoices` row this creates. */
  supplierInvoiceId: IdSchema,
  /** Defaults to the reviewed header's supplier; required when the review left it unresolved. */
  supplierId: IdSchema.optional(),
  purchaseOrderId: IdSchema.optional(),
  /** Client ids of the `supplier_invoice_lines` rows, one per reviewed line; a count mismatch is 400. */
  lineIds: z
    .array(z.object({ lineNo: z.number().int().positive(), id: IdSchema }))
    .min(1)
    .max(500),
})
export type ApproveDocumentIn = z.infer<typeof ApproveDocumentInput>
export const ApproveDocumentOutput = z.object({
  item: DocumentDetailSchema,
  supplierInvoice: SupplierInvoiceWithLinesSchema,
})

export const QueueListInput = z.object({
  status: QueueStatusSchema.optional(),
  kind: DocumentKindSchema.optional(),
  supplierId: IdSchema.optional(),
  ...CursorInput,
})
export const QueueListOutput = z.object({
  items: z.array(QueueItemSchema),
  nextCursor: z.string().nullable(),
})

export const StatsSummaryInput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  supplierId: IdSchema.optional(),
  kind: DocumentKindSchema.optional(),
})
export const StatsSummaryOutput = DocintStatsSchema

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `docint: docintContract` in contract.ts

export const docintContract = {
  documents: {
    create: oc
      .route({
        method: 'POST',
        path: '/docint/documents',
        summary: 'Start capturing a document (supplier bill, lorry receipt, brand-DMS bill)',
      })
      .input(CreateDocumentInput)
      .output(CreateDocumentOutput),
    pageUploadUrl: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/pages/upload-urls',
        summary: 'Mint pre-signed upload slots for one or more pages (object storage putUrl)',
      })
      .input(PageUploadUrlInput)
      .output(PageUploadUrlOutput),
    addPage: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/pages',
        summary: 'Register an uploaded page; a duplicate document is refused with its id',
      })
      .input(AddPageInput)
      .output(AddPageOutput),
    verifyQr: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/qr',
        summary: 'Decode and verify the e-invoice QR (IRN); reports a duplicate, never blocks',
      })
      .input(VerifyQrInput)
      .output(VerifyQrOutput),
    submit: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/submit',
        summary: 'Close capture and start the pipeline (page completeness checked first)',
      })
      .input(SubmitDocumentInput)
      .output(SubmitDocumentOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/docint/documents',
        summary: 'Captured documents, newest first (no money field)',
      })
      .input(DocumentsListInput)
      .output(DocumentsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/docint/documents/{id}',
        summary: 'One document with its pages (signed read URLs), QR result and pipeline status',
      })
      .input(DocumentGetInput)
      .output(DocumentGetOutput),
    status: oc
      .route({
        method: 'GET',
        path: '/docint/documents/{id}/status',
        summary: 'Pipeline status only: the cheap poll after submit',
      })
      .input(DocumentStatusInput)
      .output(DocumentStatusOutput),
    pageUrl: oc
      .route({
        method: 'GET',
        path: '/docint/documents/{id}/page-url',
        summary: 'A fresh signed read URL for one page image (object storage getUrl)',
      })
      .input(DocumentPageUrlInput)
      .output(DocumentPageUrlOutput),
    reject: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/reject',
        summary: 'Reject a document with a reason (never a committed one)',
      })
      .input(RejectDocumentInput)
      .output(RejectDocumentOutput),
    approve: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/approve',
        summary:
          'Book the reviewed reading as a supplier invoice DRAFT for procurement.grns (never a GRN)',
      })
      .input(ApproveDocumentInput)
      .output(ApproveDocumentOutput),
  },
  extractions: {
    run: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/extract',
        summary: 'Retry or escalate the extraction by hand',
      })
      .input(RunExtractionInput)
      .output(RunExtractionOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/docint/documents/{id}/extractions',
        summary: 'Every engine reading of a document with its checks (back office: carries rates)',
      })
      .input(ExtractionsListInput)
      .output(ExtractionsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/docint/extractions/{id}',
        summary: 'One reading in full: header, lines with evidence, confidence per field',
      })
      .input(ExtractionGetInput)
      .output(ExtractionGetOutput),
  },
  matches: {
    list: oc
      .route({
        method: 'GET',
        path: '/docint/extractions/{extractionId}/candidates',
        summary: 'SKU match candidates per printed line, best first',
      })
      .input(MatchesListInput)
      .output(MatchesListOutput),
    accept: oc
      .route({
        method: 'POST',
        path: '/docint/extractions/{id}/matches/accept',
        summary: 'Accept a listed candidate for a line (remembers the alias and the pack)',
      })
      .input(AcceptMatchInput)
      .output(SkuMatchLineOutput),
    reject: oc
      .route({
        method: 'POST',
        path: '/docint/extractions/{id}/matches/reject',
        summary: "Reject a candidate, or the line's match as a whole, with a reason",
      })
      .input(RejectMatchInput)
      .output(SkuMatchLineOutput),
    choose: oc
      .route({
        method: 'POST',
        path: '/docint/extractions/{id}/matches/choose',
        summary: 'Pick another variant from the catalog for a line',
      })
      .input(ChooseMatchInput)
      .output(SkuMatchLineOutput),
    rerun: oc
      .route({
        method: 'POST',
        path: '/docint/extractions/{id}/rematch',
        summary: 'Re-run the SKU cascade for every unmatched line (after catalog.propose)',
      })
      .input(RerunMatchesInput)
      .output(RerunMatchesOutput),
  },
  review: {
    start: oc
      .route({
        method: 'POST',
        path: '/docint/documents/{id}/review',
        summary: 'Open a review session and take the single-writer lock',
      })
      .input(StartReviewInput)
      .output(StartReviewOutput),
    heartbeat: oc
      .route({
        method: 'POST',
        path: '/docint/review-sessions/{id}/heartbeat',
        summary: 'Keep the review lock alive',
      })
      .input(HeartbeatReviewInput)
      .output(HeartbeatReviewOutput),
    save: oc
      .route({
        method: 'POST',
        path: '/docint/review-sessions/{id}',
        summary: 'Save corrections; every changed path is logged and the validators re-run',
      })
      .input(SaveReviewInput)
      .output(SaveReviewOutput),
    release: oc
      .route({
        method: 'POST',
        path: '/docint/review-sessions/{id}/release',
        summary: 'Give the document up so another reviewer may take it',
      })
      .input(ReleaseReviewInput)
      .output(ReleaseReviewOutput),
    submit: oc
      .route({
        method: 'POST',
        path: '/docint/review-sessions/{id}/submit',
        summary: 'Assert the reading is right (refused while any red check stands)',
      })
      .input(SubmitReviewInput)
      .output(SubmitReviewOutput),
  },
  queue: {
    list: oc
      .route({
        method: 'GET',
        path: '/docint/queue',
        summary: 'The inbound review worklist, oldest first (back office)',
      })
      .input(QueueListInput)
      .output(QueueListOutput),
  },
  stats: {
    summary: oc
      .route({
        method: 'GET',
        path: '/docint/stats',
        summary: 'Extraction quality, latency, cost and edits per invoice for a date range',
      })
      .input(StatsSummaryInput)
      .output(StatsSummaryOutput),
  },
}
