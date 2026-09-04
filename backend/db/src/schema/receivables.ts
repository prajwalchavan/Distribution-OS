import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  bps,
  id,
  paise,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  tenantPolicy,
  timestamps,
  tz,
} from './columns.js'
import { creditNotes, invoices } from './billing.js'
import { tenantRef } from './platform.js'
import { retailers } from './retailers.js'
import { users } from './tenancy.js'

/**
 * ADR 0004: double-entry money ledger. Invoices are never mutated for payment state; receipts are allocated
 * to invoices, outstanding = AR balance per party, ageing = open invoices minus allocations.
 */

export const accountKind = pgEnum('account_kind', [
  'asset',
  'liability',
  'income',
  'expense',
  'equity',
])

/** Chart of accounts seeded per tenant: AR, Cash, UPI clearing per VPA, Sales @ rate, Output GST, Discounts, Sales returns, Round off, Scheme/Claims receivable. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: tenantRef(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: accountKind('kind').notNull(),
    /** Sub-ledger party for AR/AP accounts: retailer or supplier id. */
    partyType: text('party_type'),
    partyId: text('party_id'),
    tallyLedgerName: text('tally_ledger_name'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('accounts_code_idx').on(t.tenantId, t.code),
    index('accounts_party_idx').on(t.tenantId, t.partyType, t.partyId),
    tenantPolicy('accounts_tenant'),
  ],
).enableRLS()

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantRef(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    /** invoice | credit_note | receipt | writeoff | adjustment | opening */
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    narration: text('narration'),
    idempotencyKey: text('idempotency_key').notNull(),
    postedBy: text('posted_by'),
    postedAt: tz('posted_at').notNull().defaultNow(),
    /** Set when a later entry reverses this one (never delete). */
    reversedByEntryId: text('reversed_by_entry_id'),
  },
  (t) => [
    uniqueIndex('journal_entries_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('journal_entries_ref_idx').on(t.tenantId, t.refType, t.refId),
    index('journal_entries_date_idx').on(t.tenantId, t.entryDate),
    tenantPolicy('journal_entries_tenant'),
  ],
).enableRLS()

/** Debits positive, credits negative in `amount_paise`; every entry sums to zero (service check + deferred trigger in migration). */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    entryId: text('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amountPaise: paise('amount_paise').notNull(),
    partyType: text('party_type'),
    partyId: text('party_id'),
    memo: text('memo'),
  },
  (t) => [
    index('journal_lines_entry_idx').on(t.tenantId, t.entryId),
    index('journal_lines_account_idx').on(t.tenantId, t.accountId),
    index('journal_lines_party_idx').on(t.tenantId, t.partyType, t.partyId),
    check('journal_lines_nonzero', sql`amount_paise <> 0`),
    tenantPolicy('journal_lines_tenant'),
  ],
).enableRLS()

export const receiptMode = pgEnum('receipt_mode', [
  'cash',
  'upi',
  'bank_transfer',
  'cheque',
  'credit_note',
  'adjustment',
])
export const receiptStatus = pgEnum('receipt_status', [
  'collected',
  'deposited',
  'bounced',
  'cancelled',
])

/** Money received from a retailer (by the delivery crew, rep, or owner). Allocation to invoices is separate. */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    tenantId: tenantRef(),
    receiptNo: text('receipt_no'),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    mode: receiptMode('mode').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    receivedAt: tz('received_at').notNull(),
    receivedBy: text('received_by')
      .notNull()
      .references(() => users.id),
    /** delivery.trips id when collected on a trip (plain id); settles into trip_settlements. */
    tripId: text('trip_id'),
    /** UPI UTR / cheque no / bank ref. */
    reference: text('reference'),
    upiVpa: text('upi_vpa'),
    chequeDate: date('cheque_date', { mode: 'string' }),
    bankName: text('bank_name'),
    status: receiptStatus('status').notNull().default('collected'),
    /** Cash discount granted at receipt because the invoice was paid within its window (ADR 0004). */
    cashDiscountPaise: paise('cash_discount_paise').notNull().default(0),
    proofObjectKey: text('proof_object_key'),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('receipts_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('receipts_retailer_idx').on(t.tenantId, t.retailerId, t.receivedAt),
    index('receipts_trip_idx').on(t.tenantId, t.tripId),
    check('receipts_amount_positive', sql`amount_paise > 0`),
    tenantOrOwnRetailerPolicy('receipts_read', 'retailer_id'),
    ...staffWritePolicy('receipts_write'),
  ],
).enableRLS()

/** How much of a receipt (or credit note) settles which invoice. Sum per invoice drives its derived state. */
export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    tenantId: tenantRef(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    receiptId: text('receipt_id').references(() => receipts.id),
    creditNoteId: text('credit_note_id').references(() => creditNotes.id),
    amountPaise: paise('amount_paise').notNull(),
    allocatedAt: tz('allocated_at').notNull().defaultNow(),
    allocatedBy: text('allocated_by'),
  },
  (t) => [
    index('allocations_invoice_idx').on(t.tenantId, t.invoiceId),
    index('allocations_receipt_idx').on(t.tenantId, t.receiptId),
    check('allocations_one_source', sql`(receipt_id IS NOT NULL) <> (credit_note_id IS NOT NULL)`),
    check('allocations_amount_positive', sql`amount_paise > 0`),
    tenantPolicy('allocations_tenant'),
  ],
).enableRLS()

/** Nightly snapshot of outstanding by bucket per retailer, so the owner dashboard and rep app read one row. */
export const ageingSnapshots = pgTable(
  'ageing_snapshots',
  {
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    outstandingPaise: paise('outstanding_paise').notNull(),
    bucket0to7Paise: paise('bucket_0_7_paise').notNull().default(0),
    bucket8to15Paise: paise('bucket_8_15_paise').notNull().default(0),
    bucket16to30Paise: paise('bucket_16_30_paise').notNull().default(0),
    bucket31to60Paise: paise('bucket_31_60_paise').notNull().default(0),
    bucket60PlusPaise: paise('bucket_60_plus_paise').notNull().default(0),
    openBills: integer('open_bills').notNull().default(0),
    oldestDueDate: date('oldest_due_date', { mode: 'string' }),
    breakdown: jsonb('breakdown'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.retailerId, t.asOf] }),
    tenantOrOwnRetailerPolicy('ageing_snapshots_read', 'retailer_id'),
    ...staffWritePolicy('ageing_snapshots_write'),
  ],
).enableRLS()

export const cashDiscountConditionStatus = pgEnum('cash_discount_condition_status', [
  'open',
  'realised',
  'lapsed',
])

/** "2% if paid within 7 days" is a conditional: tracked here, realised at receipt, lapsed by a nightly job. */
export const cashDiscountConditions = pgTable(
  'cash_discount_conditions',
  {
    id: id(),
    tenantId: tenantRef(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    discountBps: bps('discount_bps').notNull(),
    payBy: date('pay_by', { mode: 'string' }).notNull(),
    status: cashDiscountConditionStatus('status').notNull().default('open'),
    realisedReceiptId: text('realised_receipt_id').references(() => receipts.id),
    realisedPaise: paise('realised_paise'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cash_discount_conditions_invoice_idx').on(t.tenantId, t.invoiceId),
    index('cash_discount_conditions_status_idx').on(t.tenantId, t.status, t.payBy),
    tenantPolicy('cash_discount_conditions_tenant'),
  ],
).enableRLS()
