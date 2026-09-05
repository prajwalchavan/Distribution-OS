import type {
  CheckSummary,
  Document,
  DocumentDetail,
  DocumentPage,
  DocumentRejectReason,
  DocumentStatusView,
  EngineDisagreement,
  Extraction,
  ExtractionCheck,
  QrPayload,
  ReviewedInvoice,
  ReviewLock,
  ReviewSession,
  SkuCandidate,
  ThreeWayMatch,
} from '@dos/contracts'
import {
  DocumentRejectReasonSchema,
  ExtractedInvoiceSchema,
  ReviewedInvoiceSchema,
  SkuMatchReasonSchema,
} from '@dos/contracts'
import type {
  documentPages,
  engineDisagreements,
  extractionChecks,
  extractions,
  reviewSessions,
  skuMatchCandidates,
} from '@dos/db'
import type { DocumentRow } from './pipeline/steps.js'

export type PageRow = typeof documentPages.$inferSelect
export type ExtractionRow = typeof extractions.$inferSelect
export type CheckRow = typeof extractionChecks.$inferSelect
export type CandidateRow = typeof skuMatchCandidates.$inferSelect
export type SessionRow = typeof reviewSessions.$inferSelect
export type DisagreementRow = typeof engineDisagreements.$inferSelect

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

function rejectReason(value: string | null): DocumentRejectReason | null {
  const parsed = DocumentRejectReasonSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The list row: NO money field (the CAP surface, warehouse included, reads it). */
export function toDocument(
  row: DocumentRow,
  extras: { supplierName: string | null; uploadedByName: string | null; pageCount: number },
): Document {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    supplierId: row.supplierId,
    supplierName: extras.supplierName,
    irn: row.irn,
    irnVerified: row.irnVerified,
    qrStatus: row.qrStatus,
    pageCount: extras.pageCount,
    expectedPages: row.expectedPages,
    attemptCount: row.attemptCount,
    failureCode: row.failureCode,
    rejectedReason: rejectReason(row.rejectedReason),
    promptProfile: row.promptProfile,
    committedEntityType: row.committedEntityType,
    committedEntityId: row.committedEntityId,
    committedAt: iso(row.committedAt),
    uploadedBy: row.uploadedBy,
    uploadedByName: extras.uploadedByName,
    capturedAt: iso(row.capturedAt),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toPage(row: PageRow, readUrl: string, readUrlExpiresAt: string): DocumentPage {
  return {
    id: row.id,
    pageNo: row.pageNo,
    objectKey: row.objectKey,
    mimeType: row.mimeType as DocumentPage['mimeType'],
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    sha256: row.sha256,
    printedPageLabel: row.printedPageLabel,
    qrDetected: row.qrDetected,
    readUrl,
    readUrlExpiresAt,
  }
}

export function toDocumentDetail(
  row: DocumentRow,
  extras: {
    supplierName: string | null
    uploadedByName: string | null
    pages: DocumentPage[]
    qrPayload: QrPayload | null
    checkSummary: CheckSummary | null
    lock: ReviewLock | null
    latestExtractionId: string | null
  },
): DocumentDetail {
  return {
    ...toDocument(row, { ...extras, pageCount: extras.pages.length }),
    pages: extras.pages,
    qrPayload: extras.qrPayload,
    checkSummary: extras.checkSummary,
    lock: extras.lock,
    latestExtractionId: extras.latestExtractionId,
    jobId: row.jobId,
  }
}

export function toStatusView(
  row: DocumentRow,
  extras: {
    latestExtractionId: string | null
    checkSummary: CheckSummary | null
    lock: ReviewLock | null
  },
): DocumentStatusView {
  return {
    id: row.id,
    status: row.status,
    qrStatus: row.qrStatus,
    attemptCount: row.attemptCount,
    failureCode: row.failureCode,
    jobId: row.jobId,
    latestExtractionId: extras.latestExtractionId,
    checkSummary: extras.checkSummary,
    lock: extras.lock,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toCheck(row: CheckRow): ExtractionCheck {
  return {
    id: row.id,
    check: row.check,
    passed: row.passed,
    severity: row.severity === 'warn' ? 'warn' : 'error',
    lineNo: row.lineNo,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  }
}

/** Rates live in `result`; only back-office procedures return this shape. */
export function toExtraction(
  row: ExtractionRow,
  checks: CheckRow[],
  includeResult: boolean,
): Extraction {
  const parsed = includeResult ? ExtractedInvoiceSchema.safeParse(row.result) : null
  return {
    id: row.id,
    documentId: row.documentId,
    engine: row.engine,
    model: row.model,
    promptVersion: row.promptVersion,
    engineVersion: row.engineVersion,
    confidence: row.confidence,
    costPaise: row.costPaise,
    latencyMs: row.latencyMs,
    invoiceNo: row.invoiceNo,
    invoiceDate: row.invoiceDate,
    supplierGstin: row.supplierGstin,
    buyerGstin: row.buyerGstin,
    totalPaise: row.totalPaise,
    lineCount: row.lineCount,
    escalatedFromExtractionId: row.escalatedFromExtractionId,
    createdAt: row.createdAt.toISOString(),
    checks: checks.map(toCheck),
    result: parsed?.success ? parsed.data : null,
  }
}

export interface CandidateVariant {
  variantName: string
  productName: string
  brandName: string | null
  netQty: number
  netUnit: SkuCandidate['netUnit']
  defaultCaseSize: number
  mrpPaise: number | null
  packPcsPerCase: number | null
}

export function toCandidate(row: CandidateRow, variant: CandidateVariant): SkuCandidate {
  const reason = SkuMatchReasonSchema.safeParse(row.reason)
  return {
    id: row.id,
    extractionId: row.extractionId,
    lineNo: row.lineNo,
    variantId: row.variantId,
    variantName: variant.variantName,
    productName: variant.productName,
    brandName: variant.brandName,
    netQty: variant.netQty,
    netUnit: variant.netUnit,
    defaultCaseSize: variant.defaultCaseSize,
    mrpPaise: variant.mrpPaise,
    packPcsPerCase: variant.packPcsPerCase,
    score: Math.min(1, Math.max(0, row.score)),
    reason: reason.success ? reason.data : 'trgm',
    chosen: row.chosen,
    matchedBy: row.matchedBy === 'reviewer' ? 'reviewer' : 'auto',
    features: (row.features as Record<string, unknown> | null) ?? null,
  }
}

export function toDisagreement(row: DisagreementRow): EngineDisagreement {
  return {
    id: row.id,
    path: row.path,
    values: (row.values as Record<string, unknown> | null) ?? {},
    resolvedValue: row.resolvedValue ?? null,
  }
}

export function reviewedOf(row: SessionRow): ReviewedInvoice {
  const parsed = ReviewedInvoiceSchema.safeParse(row.reviewed)
  if (parsed.success) return parsed.data
  return { header: EMPTY_HEADER, lines: [], annotations: [] }
}

const EMPTY_HEADER: ReviewedInvoice['header'] = {
  supplierId: null,
  supplierName: null,
  supplierGstin: null,
  buyerGstin: null,
  invoiceNo: null,
  invoiceDate: null,
  irn: null,
  ewayBillNo: null,
  placeOfSupplyState: null,
  purchaseOrderId: null,
  dueDate: null,
  subtotalPaise: null,
  discountPaise: null,
  cgstPaise: null,
  sgstPaise: null,
  igstPaise: null,
  cessPaise: null,
  freightPaise: null,
  roundOffPaise: null,
  totalPaise: null,
}

export function toSession(
  row: SessionRow,
  extras: {
    reviewerName: string | null
    checks: CheckRow[]
    blocking: number
    disagreements: DisagreementRow[]
    threeWayMatch: ThreeWayMatch | null
  },
): ReviewSession {
  return {
    id: row.id,
    documentId: row.documentId,
    reviewerId: row.reviewerId,
    reviewerName: extras.reviewerName,
    baseExtractionId: row.baseExtractionId,
    status: row.status,
    lockedUntil: row.lockedUntil.toISOString(),
    heartbeatAt: iso(row.heartbeatAt),
    editsCount: row.editsCount,
    submittedAt: iso(row.submittedAt),
    reviewed: reviewedOf(row),
    checks: extras.checks.map(toCheck),
    blocking: extras.blocking,
    disagreements: extras.disagreements.map(toDisagreement),
    threeWayMatch: extras.threeWayMatch,
    createdAt: row.createdAt.toISOString(),
  }
}
