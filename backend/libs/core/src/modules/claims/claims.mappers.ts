import type {
  ClaimEvidence,
  ClaimLine,
  ClaimPolicy,
  ClaimSettlement,
  ClaimStatement,
  ClaimSummary,
} from '@dos/contracts'
import type { ReturnPolicyRow } from '../tenant-catalog/index.js'
import {
  detailOf,
  OPEN_STATUSES,
  type ClaimEvidenceRow,
  type ClaimLineRow,
  type ClaimRow,
  type ClaimSettlementRow,
  type ClaimStatementRow,
} from './claims.internals.js'

/** Drizzle rows in, contract shapes out (docs/16 §2): no Drizzle row ever leaves the module. */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export interface ClaimNames {
  supplierName: string
  brandName: string | null
  lineCount: number
}

/** `outstanding = claimed − settled − writtenOff`; `overdue` is computed against `today` (IST), never stored. */
export function toClaimSummary(row: ClaimRow, names: ClaimNames, today: string): ClaimSummary {
  const outstanding = row.claimedPaise - row.settledPaise - row.writtenOffPaise
  return {
    id: row.id,
    claimNo: row.claimNo,
    supplierId: row.supplierId,
    supplierName: names.supplierName,
    brandId: row.brandId,
    brandName: names.brandName,
    kind: row.kind,
    status: row.status,
    claimChannel: row.claimChannel,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    claimedPaise: row.claimedPaise,
    settledPaise: row.settledPaise,
    writtenOffPaise: row.writtenOffPaise,
    outstandingPaise: outstanding,
    lineCount: names.lineCount,
    externalRef: row.externalRef,
    submittedAt: iso(row.submittedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    dueDate: row.dueDate,
    overdue: OPEN_STATUSES.includes(row.status) && row.dueDate !== null && row.dueDate < today,
    settledAt: iso(row.settledAt),
    rejectedAt: iso(row.rejectedAt),
    rejectionReason: row.rejectionReason,
    accruedAt: iso(row.accruedAt),
    note: row.note,
    createdBy: row.createdBy,
    submittedBy: row.submittedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toClaimLine(row: ClaimLineRow): ClaimLine {
  return {
    id: row.id,
    claimId: row.claimId,
    lineNo: row.lineNo,
    status: row.status,
    sourceType: row.sourceType as ClaimLine['sourceType'],
    sourceId: row.sourceId,
    schemeId: row.schemeId,
    retailerId: row.retailerId,
    variantId: row.variantId,
    lotId: row.lotId,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    mrpPaise: row.mrpPaise,
    qtyPcs: row.qtyPcs,
    caseSize: row.caseSize,
    ratePaise: row.ratePaise,
    basis: row.basis,
    amountPaise: row.amountPaise,
    settledPaise: row.settledPaise,
    detail: detailOf(row),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toClaimEvidence(row: ClaimEvidenceRow): ClaimEvidence {
  return {
    id: row.id,
    claimId: row.claimId,
    kind: row.kind as ClaimEvidence['kind'],
    documentId: row.documentId,
    objectKey: row.objectKey,
    caption: row.caption,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toClaimStatement(row: ClaimStatementRow): ClaimStatement {
  return {
    id: row.id,
    claimId: row.claimId,
    format: row.format,
    objectKey: row.objectKey,
    rowCount: row.rowCount,
    exportJobId: row.exportJobId,
    generatedAt: row.objectKey ? iso(row.generatedAt) : null,
    ready: row.objectKey !== null,
  }
}

export function toClaimSettlement(row: ClaimSettlementRow): ClaimSettlement {
  return {
    id: row.id,
    claimId: row.claimId,
    settledOn: row.settledOn,
    amountPaise: row.amountPaise,
    mode: row.mode,
    externalRef: row.externalRef,
    documentId: row.documentId,
    grnId: row.grnId,
    journalEntryId: row.journalEntryId,
    note: row.note,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toClaimPolicy(row: ReturnPolicyRow): ClaimPolicy {
  return {
    id: row.id,
    brandId: row.brandId,
    brandName: row.brandName,
    claimSupplierId: row.claimSupplierId,
    claimSupplierName: row.claimSupplierName,
    damageClaimable: row.damageClaimable,
    expiryClaimable: row.expiryClaimable,
    claimWindowDays: row.claimWindowDays,
    claimSheetFormat: row.claimSheetFormat,
    claimPeriodKind: row.claimPeriodKind,
    claimCutoffDay: row.claimCutoffDay,
    settlementDays: row.settlementDays,
    damageValueBasis: row.damageValueBasis,
    expiryValueBasis: row.expiryValueBasis,
    claimChannel: row.claimChannel,
    saleableReturnDays: row.saleableReturnDays,
    notes: row.notes,
  }
}
