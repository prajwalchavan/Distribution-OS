import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
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
import { users } from './tenancy.js'
import { claimChannel, claimValueBasis, suppliers } from './tenant-catalog.js'

/**
 * Claims: money the manufacturer owes the distributor — company-funded scheme spend already given away
 * on invoices, damaged / expired goods the brand takes back, inbound shortages and rate differences
 * (docs/plans/claims.md). Five tables, every one of them BACK OFFICE ONLY: `claim_lines.rate_paise` on a
 * damage line IS purchase cost, and a scheme line says which schemes the brand funds — the two secrets
 * the field must never learn (docs/22 §9 never-list 1, claims §4.21). Served by owner-service and
 * manager-service alone; never registered with SyncRegistry, never in a PowerSync bucket.
 *
 * Migration 0021 (generated) + 0022 (hand-written guarantees) expanded the 0002 tables; every change is
 * expand-only (no column dropped, no type narrowed).
 */

export const claimKind = pgEnum('claim_kind', [
  'scheme',
  'damage',
  'expiry',
  'shortage',
  'rate_difference',
  'other',
])
/**
 * Driven only through `claimMachine.next()` (@dos/domain): draft → submitted → acknowledged →
 * partially_settled → settled; submitted / acknowledged may be rejected; submitted / acknowledged /
 * partially_settled may be written_off (owner or accountant: accepting a loss); a DRAFT may be
 * cancelled (discarded before any number or journal exists). `written_off` was added in 0021 and
 * `cancelled` in 0026 (`ALTER TYPE … ADD VALUE`, so neither may be USED by a migration in the same run —
 * they are first used by application code; the partial index below spells "cancelled" as
 * "no number and not a draft" for that reason).
 */
export const claimStatus = pgEnum('claim_status', [
  'draft',
  'submitted',
  'acknowledged',
  'settled',
  'partially_settled',
  'rejected',
  'written_off',
  'cancelled',
])
/**
 * How a brand paid a claim: its credit note, money in the bank, a cheque in hand (0026), replacement
 * goods on a GRN, or a book adjustment.
 */
export const claimSettlementMode = pgEnum('claim_settlement_mode', [
  'credit_note',
  'bank_receipt',
  'goods_replacement',
  'adjustment',
  'cheque',
])
/**
 * `open` on a draft, `claimed` once submitted, `settled` when the brand's money covers it, `rejected` when
 * the claim (or the line at build time: out of the claim window) is refused — a rejected line frees its
 * source for a later claim, which is what the partial unique index below keys on — and `written_off`.
 */
export const claimLineStatus = pgEnum('claim_line_status', [
  'open',
  'claimed',
  'settled',
  'rejected',
  'written_off',
])

export const claims = pgTable(
  'claims',
  {
    id: id(),
    tenantId: tenantRef(),
    /** Allocated from the CLAIM series at submit only; a draft never has one, a rejected claim keeps it. */
    claimNo: text('claim_no'),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    brandId: text('brand_id'),
    kind: claimKind('kind').notNull(),
    status: claimStatus('status').notNull().default('draft'),
    /**
     * Frozen at open from `tenant_brands.claim_channel`. A `brand_dms` claim (Too Yumm inside FieldAssist)
     * is numbered, built and exported as a record only: no journal entry, ever, and out of the ageing
     * totals — the brand settles it inside its own DMS (docs/17 A1, ADR 0014).
     */
    claimChannel: claimChannel('claim_channel').notNull().default('dos'),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    /** Σ `claim_lines.amount_paise` of the non-rejected lines — recomputed after every mutation, never incremented. */
    claimedPaise: paise('claimed_paise').notNull().default(0),
    settledPaise: paise('settled_paise').notNull().default(0),
    writtenOffPaise: paise('written_off_paise').notNull().default(0),
    /** Manufacturer's reference (credit note no / settlement id). */
    externalRef: text('external_ref'),
    submittedAt: tz('submitted_at'),
    /** `submitted_on + return_policies.settlement_days`; "overdue" is computed against it, never stored. */
    dueDate: date('due_date', { mode: 'string' }),
    acknowledgedAt: tz('acknowledged_at'),
    settledAt: tz('settled_at'),
    rejectedAt: tz('rejected_at'),
    rejectionReason: text('rejection_reason'),
    /** When the accrual entry was posted through receivables (NULL for a `brand_dms` claim, always). */
    accruedAt: tz('accrued_at'),
    createdBy: text('created_by').references(() => users.id),
    submittedBy: text('submitted_by').references(() => users.id),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('claims_supplier_idx').on(t.tenantId, t.supplierId, t.periodFrom),
    index('claims_status_idx').on(t.tenantId, t.status),
    /** The ageing and the overdue sweep: `status IN (…) AND due_date < today`. */
    index('claims_due_idx').on(t.tenantId, t.status, t.dueDate),
    /**
     * One LIVE claim per supplier × brand × kind × period; a rejected or a cancelled one may be
     * re-raised. `brand_id` is nullable (shortage / rate-difference claims are per supplier), and NULLs
     * are distinct in a unique index, hence the coalesce. "Live" is spelled without the `cancelled`
     * literal on purpose: a cancelled claim is exactly a non-draft with NO number (only a draft can be
     * cancelled and only a submit allocates a number), and Postgres refuses an enum value inside the
     * transaction that added it while drizzle's migrator applies every pending migration in one
     * transaction (coordination §2 rule 4) — an `::text` cast is not IMMUTABLE and cannot index either.
     */
    uniqueIndex('claims_open_period_idx')
      .on(t.tenantId, t.supplierId, sql`coalesce(brand_id, '')`, t.kind, t.periodFrom, t.periodTo)
      .where(sql`status <> 'rejected' AND (claim_no IS NOT NULL OR status = 'draft')`),
    /** The service answers 409 first; this is the guarantee (claims §4.16). */
    check('claims_settled_within_claimed', sql`settled_paise + written_off_paise <= claimed_paise`),
    check('claims_period_order', sql`period_from <= period_to`),
    tenantRolePolicy('claims_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/**
 * Reconstructed from invoice_lines.applied_rules for scheme claims; from credit notes / the stock ledger
 * for damage and expiry; from inbound discrepancies for shortage and rate difference; `manual` for what
 * no source can reconstruct. Not a ledger: a line on a draft is deleted, not reversed.
 */
export const claimLines = pgTable(
  'claim_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    /** Position on the claim sheet, assigned in (source_type, source_id) order by the build. */
    lineNo: integer('line_no').notNull().default(0),
    status: claimLineStatus('status').notNull().default('open'),
    schemeId: text('scheme_id').references(() => schemes.id),
    /** invoice | credit_note | inbound_discrepancy | stock_ledger | manual */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    /** Plain id: retailers is upstream of claims and the shop is denormalised here for the claim sheet. */
    retailerId: text('retailer_id'),
    variantId: text('variant_id'),
    /** Plain id (inventory owns lots); batch, expiry and the LOT'S OWN case size are copied so a sheet reprints "3 cs + 12 pcs" after the case size changes (docs/17 A2). */
    lotId: text('lot_id'),
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date', { mode: 'string' }),
    caseSize: integer('case_size'),
    qtyPcs: pieces('qty_pcs').notNull().default(0),
    mrpPaise: paise('mrp_paise'),
    /** PURCHASE COST on a damage / expiry line (`basis` = ptd | landed_cost): the reason this table is back office only. */
    ratePaise: paise('rate_paise'),
    basis: claimValueBasis('basis'),
    amountPaise: paise('amount_paise').notNull(),
    /** Never above `amount_paise`; a settlement spreads the remainder to the next line with `allocate()`. */
    settledPaise: paise('settled_paise').notNull().default(0),
    /** { invoiceNo, ruleKind, rewardKind, appliedRule, ledgerRef, reason? ('out_of_window') } */
    detail: jsonb('detail'),
    ...timestamps,
  },
  (t) => [
    index('claim_lines_claim_idx').on(t.tenantId, t.claimId),
    index('claim_lines_source_idx').on(t.tenantId, t.sourceType, t.sourceId),
    index('claim_lines_status_idx').on(t.tenantId, t.claimId, t.status),
    /**
     * A source is claimable exactly once (claims §4.9): the build catches the conflict and counts it in
     * `skipped`; rejecting a claim (or a line, out of window) frees the source for the next claim.
     * Coordination §5.4: no `claim_lines_claim_source_idx` — this index is the guarantee and
     * `claim_lines_claim_idx` the lookup.
     */
    uniqueIndex('claim_lines_source_unique_idx')
      .on(t.tenantId, t.sourceType, t.sourceId)
      .where(sql`status <> 'rejected'`),
    check('claim_lines_settled_within_amount', sql`settled_paise <= amount_paise`),
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
    /** damage_photo | claim_sheet | brand_credit_note | email | other */
    kind: text('kind').notNull().default('other'),
    /** Exactly one of the two: a docint `documents` row (plain id, docint is upstream) or an object key the client uploaded to. */
    documentId: text('document_id'),
    objectKey: text('object_key'),
    caption: text('caption'),
    uploadedBy: text('uploaded_by').references(() => users.id),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('claim_evidence_claim_idx').on(t.tenantId, t.claimId),
    check('claim_evidence_has_target', sql`document_id IS NOT NULL OR object_key IS NOT NULL`),
    tenantRolePolicy('claim_evidence_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/**
 * The generated claim sheet in the manufacturer's format (per return_policies.claim_sheet_format).
 * The request path inserts the row with `object_key = NULL` and a `payload` snapshot and enqueues an
 * `export_jobs` row; the worker renders the file and fills `object_key` / `row_count` / `generated_at`
 * (docs/20 rule 3). `ready = object_key IS NOT NULL`.
 */
export const claimStatements = pgTable(
  'claim_statements',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    format: text('format').notNull(),
    objectKey: text('object_key'),
    /** Plain id: `export_jobs` is integrations' (downstream in the FK chain). */
    exportJobId: text('export_job_id'),
    rowCount: integer('row_count'),
    /** Nullable since 0021; the default stays, so the API inserts `generatedAt: null` explicitly and the worker sets it. */
    generatedAt: tz('generated_at').defaultNow(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('claim_statements_claim_idx').on(t.tenantId, t.claimId),
    tenantRolePolicy('claim_statements_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/**
 * How the brand paid: one row per credit note / bank receipt / replacement GRN / adjustment against a
 * claim. Adds to `claims.settled_paise` (the claim-level check keeps the sum inside `claimed_paise`) and
 * moves the claim through `settle_partial` / `settle_full`. The journal entry (Dr AP | BANK | PURCHASES /
 * Cr the receivable) is posted through receivables and referenced here; skipped for `brand_dms`.
 */
export const claimSettlements = pgTable(
  'claim_settlements',
  {
    id: id(),
    tenantId: tenantRef(),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id),
    settledOn: date('settled_on', { mode: 'string' }).notNull(),
    amountPaise: paise('amount_paise').notNull(),
    mode: claimSettlementMode('mode').notNull(),
    /** The brand's credit note number / UTR; unique per claim when present. */
    externalRef: text('external_ref'),
    /** Plain ids: the docint document of the brand's credit note, the replacement GRN (procurement), the receivables entry. */
    documentId: text('document_id'),
    grnId: text('grn_id'),
    journalEntryId: text('journal_entry_id'),
    note: text('note'),
    recordedBy: text('recorded_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('claim_settlements_claim_idx').on(t.tenantId, t.claimId),
    uniqueIndex('claim_settlements_ref_idx')
      .on(t.tenantId, t.claimId, t.externalRef)
      .where(sql`external_ref IS NOT NULL`),
    check('claim_settlements_amount_positive', sql`amount_paise > 0`),
    tenantRolePolicy('claim_settlements_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()
