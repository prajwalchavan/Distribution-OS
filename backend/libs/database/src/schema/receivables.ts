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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  bps,
  id,
  invoiceScopedReadPolicy,
  paise,
  roleInsertPolicy,
  roleReadPolicy,
  roleUpdatePolicy,
  roleWritePolicies,
  staffWritePolicy,
  STAFF_ROLES,
  tenantOrOwnRetailerPolicy,
  tenantRolePolicy,
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

/**
 * Who may POST to the book but never read it: the field roles that take money at the doorstep or the desk.
 * `STAFF_ROLES` minus `warehouse` — a store keeper never touches money (docs/plans/00-coordination.md §5.3).
 * Reading the journal stays back-office only, because `PURCHASES`, `STOCK` and every GRN posting sit in the
 * same two tables and would otherwise leak purchase cost to a rep, a delivery crew and a shopkeeper.
 */
export const LEDGER_POSTING_ROLES = STAFF_ROLES.filter((r) => r !== 'warehouse')

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
    // No amounts live here and posting needs the code -> id lookup, so every staff role reads it; the
    // retailer role loses access (it never posts, and the chart of accounts is not a shopkeeper's business).
    roleReadPolicy('accounts_read', STAFF_ROLES),
    ...roleWritePolicies('accounts_write', BACK_OFFICE_ROLES),
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
    // ADR 0002 cost guarantee: the book is readable by the back office only. Field roles may post (a
    // doorstep receipt is a balanced entry) and never read. No DELETE policy — the 0003 trigger also refuses.
    roleReadPolicy('journal_entries_read', BACK_OFFICE_ROLES),
    roleInsertPolicy('journal_entries_post', LEDGER_POSTING_ROLES),
    roleUpdatePolicy('journal_entries_amend', BACK_OFFICE_ROLES),
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
    // Same split as journal_entries. Narrowing SELECT here is what defeats the 0003 balance trigger unless
    // it is SECURITY DEFINER — see 0007_receivables_guarantees.sql and coordination §5.2.
    roleReadPolicy('journal_lines_read', BACK_OFFICE_ROLES),
    roleInsertPolicy('journal_lines_post', LEDGER_POSTING_ROLES),
    roleUpdatePolicy('journal_lines_amend', BACK_OFFICE_ROLES),
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
    /** The rendered receipt handed to the shop (`receivables.receipts.document`, docs/23 §8.1): the third white-label document. */
    pdfObjectKey: text('pdf_object_key'),
    note: text('note'),
    /** Device that captured an offline receipt; half of the offline dedupe key (docs/07 §7.3). */
    deviceId: text('device_id'),
    /** The crew's paper receipt-book number. Never the legal number — that is `receipt_no`. */
    clientReceiptNo: text('client_receipt_no'),
    /** A correction is a second, negative receipt pointing back here; the original is never edited. */
    reversesReceiptId: text('reverses_receipt_id').references((): AnyPgColumn => receipts.id),
    /** Banking of cash/cheque: set together when a deposit batch is posted. */
    depositedAt: tz('deposited_at'),
    depositRef: text('deposit_ref'),
    depositAccountId: text('deposit_account_id').references(() => accounts.id),
    /** Cheque return. */
    bouncedAt: tz('bounced_at'),
    bounceReason: text('bounce_reason'),
    /** Bank charges on a return, posted DR BANK_CHARGES / CR BANK (docs/plans/receivables.md §8.8). */
    bankChargesPaise: paise('bank_charges_paise').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('receipts_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('receipts_retailer_idx').on(t.tenantId, t.retailerId, t.receivedAt),
    index('receipts_trip_idx').on(t.tenantId, t.tripId),
    uniqueIndex('receipts_device_client_no_idx')
      .on(t.tenantId, t.deviceId, t.clientReceiptNo)
      .where(sql`client_receipt_no IS NOT NULL`),
    index('receipts_status_idx').on(t.tenantId, t.status, t.receivedAt),
    // Nonzero, not positive: a reversal and a bounce are the same row shape with a negative amount.
    check('receipts_amount_nonzero', sql`amount_paise <> 0`),
    tenantOrOwnRetailerPolicy('receipts_read', 'retailer_id'),
    ...staffWritePolicy('receipts_write'),
  ],
).enableRLS()

/**
 * A bad debt the owner has decided to stop chasing. Never a credit note (that is a tax document): a write-off
 * is a financial entry DR BAD_DEBTS / CR AR plus an `allocations` row that closes the bill.
 */
export const writeOffs = pgTable(
  'write_offs',
  {
    id: id(),
    tenantId: tenantRef(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    amountPaise: paise('amount_paise').notNull(),
    /** bad_debt | rounding | settlement | other */
    reason: text('reason').notNull(),
    note: text('note'),
    approvedBy: text('approved_by')
      .notNull()
      .references(() => users.id),
    journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('write_offs_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('write_offs_invoice_idx').on(t.tenantId, t.invoiceId),
    check('write_offs_amount_positive', sql`amount_paise > 0`),
    tenantRolePolicy('write_offs_back_office', BACK_OFFICE_ROLES),
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
    writeOffId: text('write_off_id').references(() => writeOffs.id),
    amountPaise: paise('amount_paise').notNull(),
    allocatedAt: tz('allocated_at').notNull().defaultNow(),
    allocatedBy: text('allocated_by'),
  },
  (t) => [
    index('allocations_invoice_idx').on(t.tenantId, t.invoiceId),
    index('allocations_receipt_idx').on(t.tenantId, t.receiptId),
    index('allocations_write_off_idx').on(t.tenantId, t.writeOffId),
    // Exactly one source of three: a receipt's cash, a credit note's value, or a write-off closing the bill.
    check(
      'allocations_one_source',
      sql`((receipt_id IS NOT NULL)::int + (credit_note_id IS NOT NULL)::int + (write_off_id IS NOT NULL)::int) = 1`,
    ),
    // Nonzero, not positive: reversing a receipt mirrors each allocation with a negative amount.
    check('allocations_amount_nonzero', sql`amount_paise <> 0`),
    invoiceScopedReadPolicy('allocations_read', 'invoice_id', 'allocations'),
    ...staffWritePolicy('allocations_write'),
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
    /** Legacy roll-up kept for older readers: always bucket_61_90 + bucket_90_plus (a spec asserts it). */
    bucket60PlusPaise: paise('bucket_60_plus_paise').notNull().default(0),
    bucket61to90Paise: paise('bucket_61_90_paise').notNull().default(0),
    bucket90PlusPaise: paise('bucket_90_plus_paise').notNull().default(0),
    /** Open value of bills whose due date is before `as_of`. */
    overduePaise: paise('overdue_paise').notNull().default(0),
    unallocatedCreditPaise: paise('unallocated_credit_paise').notNull().default(0),
    openBills: integer('open_bills').notNull().default(0),
    oldestDueDate: date('oldest_due_date', { mode: 'string' }),
    breakdown: jsonb('breakdown'),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.retailerId, t.asOf] }),
    /** `receivables.ageing.history` (docs/23 §8.1): the tenant's outstanding trend over a date range, one row per shop per day. */
    index('ageing_snapshots_as_of_idx').on(t.tenantId, t.asOf),
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
    // A shop may see the offer attached to its own bill; only staff may create or realise one.
    invoiceScopedReadPolicy(
      'cash_discount_conditions_read',
      'invoice_id',
      'cash_discount_conditions',
    ),
    ...staffWritePolicy('cash_discount_conditions_write'),
  ],
).enableRLS()

/**
 * The read surface for every "what does this shop owe" screen: the owner tile, the rep's shop card, the
 * accountant's follow-up list and the retailer app's "my dues". Deliberately a TABLE, not a view — PowerSync
 * stream queries allow no GROUP BY, and scale rule 9 makes rollups the read surface, so no dashboard number
 * ever scans `journal_lines`. Rebuilt UPDATE-first by `refreshOutstanding()` after every posting and by the
 * nightly ageing job. Carries no credit-limit column on purpose: credit terms belong to `retailers`.
 */
export const retailerOutstandingSummary = pgTable(
  'retailer_outstanding_summary',
  {
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    outstandingPaise: paise('outstanding_paise').notNull().default(0),
    overduePaise: paise('overdue_paise').notNull().default(0),
    unallocatedCreditPaise: paise('unallocated_credit_paise').notNull().default(0),
    openBills: integer('open_bills').notNull().default(0),
    oldestDueDate: date('oldest_due_date', { mode: 'string' }),
    oldestInvoiceDate: date('oldest_invoice_date', { mode: 'string' }),
    lastReceiptAt: tz('last_receipt_at'),
    lastReceiptPaise: paise('last_receipt_paise'),
    bucket0to7Paise: paise('bucket_0_7_paise').notNull().default(0),
    bucket8to15Paise: paise('bucket_8_15_paise').notNull().default(0),
    bucket16to30Paise: paise('bucket_16_30_paise').notNull().default(0),
    bucket31to60Paise: paise('bucket_31_60_paise').notNull().default(0),
    bucket61to90Paise: paise('bucket_61_90_paise').notNull().default(0),
    bucket90PlusPaise: paise('bucket_90_plus_paise').notNull().default(0),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.retailerId] }),
    index('retailer_outstanding_overdue_idx').on(t.tenantId, t.overduePaise),
    index('retailer_outstanding_amount_idx').on(t.tenantId, t.outstandingPaise),
    tenantOrOwnRetailerPolicy('retailer_outstanding_read', 'retailer_id'),
    ...staffWritePolicy('retailer_outstanding_write'),
  ],
).enableRLS()
