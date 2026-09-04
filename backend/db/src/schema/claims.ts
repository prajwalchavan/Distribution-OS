import { sql } from 'drizzle-orm'
import { date, index, jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  id,
  paise,
  pieces,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import { tenantRef } from './platform.js'
import { schemes } from './pricing.js'
import { suppliers } from './tenant-catalog.js'

/** Schema now, UI post-pilot: money the manufacturer owes the distributor for schemes, damages and expiries. */

export const claimKind = pgEnum('claim_kind', [
  'scheme',
  'damage',
  'expiry',
  'shortage',
  'rate_difference',
  'other',
])
export const claimStatus = pgEnum('claim_status', [
  'draft',
  'submitted',
  'acknowledged',
  'settled',
  'partially_settled',
  'rejected',
])

export const claims = pgTable(
  'claims',
  {
    id: id(),
    tenantId: tenantRef(),
    claimNo: text('claim_no'),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    brandId: text('brand_id'),
    kind: claimKind('kind').notNull(),
    status: claimStatus('status').notNull().default('draft'),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    claimedPaise: paise('claimed_paise').notNull().default(0),
    settledPaise: paise('settled_paise').notNull().default(0),
    /** Manufacturer's reference (credit note no / settlement id). */
    externalRef: text('external_ref'),
    submittedAt: tz('submitted_at'),
    settledAt: tz('settled_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('claims_supplier_idx').on(t.tenantId, t.supplierId, t.periodFrom),
    index('claims_status_idx').on(t.tenantId, t.status),
    tenantRolePolicy('claims_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Reconstructed from invoice_lines.applied_rules for scheme claims; from discrepancies/credit notes for the rest. */
export const claimLines = pgTable(
  'claim_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    schemeId: text('scheme_id').references(() => schemes.id),
    /** invoice | credit_note | inbound_discrepancy | stock_ledger */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    variantId: text('variant_id'),
    qtyPcs: pieces('qty_pcs').notNull().default(0),
    amountPaise: paise('amount_paise').notNull(),
    detail: jsonb('detail'),
    ...timestamps,
  },
  (t) => [
    index('claim_lines_claim_idx').on(t.tenantId, t.claimId),
    index('claim_lines_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    tenantRolePolicy('claim_lines_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

export const claimEvidence = pgTable(
  'claim_evidence',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    documentId: text('document_id'),
    objectKey: text('object_key'),
    caption: text('caption'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('claim_evidence_claim_idx').on(t.tenantId, t.claimId),
    tenantRolePolicy('claim_evidence_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** The generated claim sheet in the manufacturer's format (per return_policies.claim_sheet_format). */
export const claimStatements = pgTable(
  'claim_statements',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    format: text('format').notNull(),
    objectKey: text('object_key').notNull(),
    generatedAt: tz('generated_at').notNull().defaultNow(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('claim_statements_claim_idx').on(t.tenantId, t.claimId),
    tenantRolePolicy('claim_statements_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()
