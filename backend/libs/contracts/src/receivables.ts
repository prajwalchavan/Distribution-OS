import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { CreditModeSchema, PaymentTermsSchema } from './retailers.js'

/**
 * Receivables — the money ledger (ADR 0004). It owns `accounts`, `journal_entries`, `journal_lines`,
 * `receipts`, `allocations`, `write_offs`, `retailer_outstanding_summary`, `ageing_snapshots` and
 * `cash_discount_conditions`. Every rupee that enters or leaves the AR position is posted here.
 *
 * WHICH SERVICES MOUNT `receivables` (coordination §6, corrected by the founder's answer in docs/17 §D4):
 *
 *   owner :3001      YES — the whole surface, plus the owner-only write-off and ageing rebuild
 *   manager :3002    YES — manager + accountant: the desk records payments, allocates, deposits,
 *                    bounces, reads the journal, the chart of accounts and the registers
 *   sales :3003      NO  — "the salesperson does NOT collect money" (docs/17 §D4). The rep app has no
 *                    receivables surface in this slice; see the note on the salesperson role below
 *   warehouse :3004  NO  — the warehouse role never touches money
 *   delivery :3005   YES — the crew collects at the shop door: `receipts.create`, the read surfaces and
 *                    `creditCheck` before a van sale. Never `reverse`/`deposit`/`bounce`/`journal`
 *   retailer :3006   YES — its own bills only: `outstanding.get`, `ledger.get`, `receipts.list/get`
 *                    (RLS narrows every one of them to the shop) and `payments.initiate`, the shop's own
 *                    online-payment path. A retailer never creates, allocates or reverses a receipt
 *
 * TWO RULES FROM THE FOUNDER (docs/17 §D2 and §D4) THAT SHAPE THIS FILE:
 *
 *  1. Only the delivery crew and the desk take money, plus the shop paying online for itself. There is
 *     deliberately no salesperson anywhere in this contract's permission rows, and the shop's online
 *     payment is `payments.initiate` — a separate procedure with the retailer role — never a widening of
 *     `receipts.create`.
 *  2. Cash discount is REPORTED on the invoice and realised at receipt as a financial credit note. There
 *     is therefore no on-invoice deduction procedure: `receipts.create` realises the condition when the
 *     money lands inside the window, and `cashDiscounts.list` is the desk's "collect before it shuts" queue.
 *
 * Money is integer paise, percentages basis points, dates IST (`businessDate()`), ids client-generated
 * UUIDv7. Sign convention inside a journal entry: debit positive, credit negative, every entry sums to 0.
 */

const IsoDateSchema = z.iso.date()
const IsoDateTimeSchema = z.iso.datetime({ offset: true })
/** The device that produced a receipt offline; with `clientReceiptNo` it is the offline dedupe key. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// enums

/** `credit_note` is not a receipt: a credit note is allocated through `allocations.create`. */
export const ReceiptModeSchema = z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'adjustment'])
export type ReceiptMode = z.infer<typeof ReceiptModeSchema>

export const ReceiptStatusSchema = z.enum(['collected', 'deposited', 'bounced', 'cancelled'])
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>

/** `fifo` = oldest due bill first; `none` = leave the money on account; `explicit` = the caller's split. */
export const AllocationStrategySchema = z.enum(['fifo', 'none', 'explicit'])
export type AllocationStrategy = z.infer<typeof AllocationStrategySchema>

export const AllocationSourceTypeSchema = z.enum(['receipt', 'credit_note'])
export type AllocationSourceType = z.infer<typeof AllocationSourceTypeSchema>

export const WriteOffReasonSchema = z.enum(['bad_debt', 'rounding', 'settlement', 'other'])
export type WriteOffReason = z.infer<typeof WriteOffReasonSchema>

/** Ageing buckets are keyed on the bill's due date measured against `asOf` (docs/plans/receivables.md §4.13). */
export const AgeingBucketSchema = z.enum(['b0_7', 'b8_15', 'b16_30', 'b31_60', 'b61_90', 'b90plus'])
export type AgeingBucket = z.infer<typeof AgeingBucketSchema>

export const CashDiscountStatusSchema = z.enum(['open', 'realised', 'lapsed'])
export type CashDiscountStatus = z.infer<typeof CashDiscountStatusSchema>

export const AccountKindSchema = z.enum(['asset', 'liability', 'income', 'expense', 'equity'])
export type AccountKind = z.infer<typeof AccountKindSchema>

/**
 * The invoice payment state receivables derives and writes back (coordination §3.2). Billing (slice 2)
 * owns the `invoices` table and every other column; when `billing.ts` lands it re-uses this enum rather
 * than declaring a second one.
 */
export const InvoicePaymentStateSchema = z.enum([
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'written_off',
  'cancelled',
])
export type InvoicePaymentState = z.infer<typeof InvoicePaymentStateSchema>

export const RetailerLedgerKindSchema = z.enum([
  'opening',
  'invoice',
  'credit_note',
  'receipt',
  'write_off',
])
export type RetailerLedgerKind = z.infer<typeof RetailerLedgerKindSchema>

export const OutstandingSortSchema = z.enum(['outstanding', 'overdue', 'oldest', 'name'])

export const StatementChannelSchema = z.enum(['whatsapp', 'pdf'])

/** Where banked money lands. A single code today; the enum keeps the door open for a second bank account. */
export const DepositAccountCodeSchema = z.enum(['BANK'])

export const CreditBreachReasonSchema = z.enum([
  'limit_exceeded',
  'bill_count_exceeded',
  'overdue_days_exceeded',
])
export type CreditBreachReason = z.infer<typeof CreditBreachReasonSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes

/**
 * A receipt is append-only: only `status` and the deposit/bounce metadata are ever updated. A correction is
 * a second receipt with a negative amount and `reversesReceiptId` set.
 */
export const ReceiptSchema = z.object({
  id: IdSchema,
  /** Assigned from the `RCPT` series at create; a receipt has no draft state. */
  receiptNo: z.string().nullable(),
  retailerId: IdSchema,
  mode: ReceiptModeSchema,
  /** Negative on a reversal or a bounce mirror. */
  amountPaise: PaiseSchema,
  /** Of `amountPaise`, how much is settled against bills, and what is still on account. */
  allocatedPaise: PaiseSchema,
  unallocatedPaise: PaiseSchema,
  /** Cash discount realised with this receipt (docs/17 §D2: at receipt, never on the invoice). */
  cashDiscountPaise: PaiseSchema,
  status: ReceiptStatusSchema,
  receivedAt: z.string(),
  receivedBy: IdSchema,
  /** Set when the crew collected on a trip: the money posts to CASH_VAN, not CASH. */
  tripId: IdSchema.nullable(),
  reference: z.string().nullable(),
  upiVpa: z.string().nullable(),
  chequeDate: z.string().nullable(),
  bankName: z.string().nullable(),
  /** The crew's paper book number, unique per device — never the legal receipt number. */
  deviceId: z.string().nullable(),
  clientReceiptNo: z.string().nullable(),
  reversesReceiptId: IdSchema.nullable(),
  depositedAt: z.string().nullable(),
  depositRef: z.string().nullable(),
  depositAccountId: IdSchema.nullable(),
  bouncedAt: z.string().nullable(),
  bounceReason: z.string().nullable(),
  bankChargesPaise: PaiseSchema,
  proofObjectKey: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
})
export type Receipt = z.infer<typeof ReceiptSchema>

/** Exactly one of `receiptId` / `creditNoteId` / `writeOffId` is set. */
export const AllocationSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  receiptId: IdSchema.nullable(),
  creditNoteId: IdSchema.nullable(),
  writeOffId: IdSchema.nullable(),
  amountPaise: PaiseSchema,
  allocatedAt: z.string(),
  allocatedBy: IdSchema.nullable(),
})
export type Allocation = z.infer<typeof AllocationSchema>

/** The bills a mutation touched, with the payment state receivables recomputed for each. */
export const SettledInvoiceSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  state: InvoicePaymentStateSchema,
  openPaise: PaiseSchema,
})
export type SettledInvoice = z.infer<typeof SettledInvoiceSchema>

export const AgeingBucketsSchema = z.object({
  b0_7: PaiseSchema,
  b8_15: PaiseSchema,
  b16_30: PaiseSchema,
  b31_60: PaiseSchema,
  b61_90: PaiseSchema,
  b90plus: PaiseSchema,
})
export type AgeingBuckets = z.infer<typeof AgeingBucketsSchema>

/** One row of `retailer_outstanding_summary`: the read surface for every dues number (scale rule 9). */
export const RetailerOutstandingSchema = z.object({
  retailerId: IdSchema,
  outstandingPaise: PaiseSchema,
  overduePaise: PaiseSchema,
  unallocatedCreditPaise: PaiseSchema,
  openBills: z.number().int(),
  oldestDueDate: z.string().nullable(),
  oldestInvoiceDate: z.string().nullable(),
  lastReceiptAt: z.string().nullable(),
  lastReceiptPaise: PaiseSchema.nullable(),
  buckets: AgeingBucketsSchema,
  asOf: z.string(),
})
export type RetailerOutstanding = z.infer<typeof RetailerOutstandingSchema>

/** An open bill in the shop's pending-bills file. `openPaise = totalPaise − Σ allocations`. */
export const OpenBillSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable(),
  totalPaise: PaiseSchema,
  openPaise: PaiseSchema,
  /** Days since the due date (negative when it is not due yet), measured in IST against today. */
  ageDays: z.number().int(),
  bucket: AgeingBucketSchema,
  /** The cash-discount offer printed on this bill, while its window is still open. */
  cashDiscountBps: BpsSchema,
  cashDiscountUntil: z.string().nullable(),
})
export type OpenBill = z.infer<typeof OpenBillSchema>

export const OutstandingListItemSchema = z.object({
  retailerId: IdSchema,
  code: z.string().nullable(),
  name: z.string(),
  beatId: IdSchema.nullable(),
  outstandingPaise: PaiseSchema,
  overduePaise: PaiseSchema,
  openBills: z.number().int(),
  oldestDueDate: z.string().nullable(),
  /** The value in the requested `bucket`, or null when no bucket filter was given. */
  bucketPaise: PaiseSchema.nullable(),
  creditMode: CreditModeSchema,
})
export type OutstandingListItem = z.infer<typeof OutstandingListItemSchema>

/**
 * One line of the shop's statement of account. Staff read it from `journal_lines` on AR, so it ties to
 * the trial balance to the paisa; a retailer actor cannot read the journal, so the service builds the
 * identical shape from invoices + credit notes + receipts + allocations. Both paths close on the same
 * `closingPaise` (docs/plans/receivables.md §5.24).
 */
export const RetailerLedgerRowSchema = z.object({
  date: z.string(),
  kind: RetailerLedgerKindSchema,
  refId: IdSchema,
  refNo: z.string().nullable(),
  narration: z.string().nullable(),
  debitPaise: PaiseSchema,
  creditPaise: PaiseSchema,
  balancePaise: PaiseSchema,
})
export type RetailerLedgerRow = z.infer<typeof RetailerLedgerRowSchema>

export const CashDiscountConditionSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  invoiceNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  discountBps: BpsSchema,
  payBy: z.string(),
  status: CashDiscountStatusSchema,
  realisedReceiptId: IdSchema.nullable(),
  realisedPaise: PaiseSchema.nullable(),
  /** What the shop would save by paying inside the window: `percentOf(invoice.totalPaise, discountBps)`. */
  potentialPaise: PaiseSchema,
  invoiceOpenPaise: PaiseSchema,
})
export type CashDiscountCondition = z.infer<typeof CashDiscountConditionSchema>

/** Chart of accounts row. No purchase cost lives here: the balance is a sum of journal lines. */
export const AccountSchema = z.object({
  id: IdSchema,
  code: z.string(),
  name: z.string(),
  kind: AccountKindSchema,
  tallyLedgerName: z.string().nullable(),
  active: z.boolean(),
  /** Debit positive, credit negative, as of the requested date. Zero when `withBalances` is false. */
  balancePaise: PaiseSchema,
})
export type Account = z.infer<typeof AccountSchema>

export const JournalLineSchema = z.object({
  id: IdSchema,
  accountId: IdSchema,
  accountCode: z.string(),
  accountName: z.string(),
  /** Debit positive, credit negative. */
  amountPaise: PaiseSchema,
  partyType: z.string().nullable(),
  partyId: z.string().nullable(),
  memo: z.string().nullable(),
})
export type JournalLine = z.infer<typeof JournalLineSchema>

/** Append-only. A mistake is corrected by a reversing entry, which stamps `reversedByEntryId` here. */
export const JournalEntrySchema = z.object({
  id: IdSchema,
  entryDate: z.string(),
  refType: z.string(),
  refId: z.string(),
  narration: z.string().nullable(),
  postedBy: z.string().nullable(),
  postedAt: z.string(),
  reversedByEntryId: IdSchema.nullable(),
  lines: z.array(JournalLineSchema),
})
export type JournalEntry = z.infer<typeof JournalEntrySchema>

export const WriteOffSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  retailerId: IdSchema,
  amountPaise: PaiseSchema,
  reason: WriteOffReasonSchema,
  note: z.string().nullable(),
  approvedBy: IdSchema,
  journalEntryId: IdSchema.nullable(),
  createdAt: z.string(),
})
export type WriteOff = z.infer<typeof WriteOffSchema>

// ---------------------------------------------------------------------------------------------------------------
// receipts

/** One line of an explicit split. `id` is the client-generated id of the `allocations` row it creates. */
export const ReceiptAllocationInput = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  amountPaise: PaiseSchema.positive(),
})

/**
 * Money taken from a shopkeeper. Roles: the desk (owner/manager/accountant) at the office and `delivery`
 * at the shop door — never a salesperson (docs/17 §D4). A shop paying itself uses `payments.initiate`.
 */
export const CreateReceiptInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema,
  mode: ReceiptModeSchema,
  amountPaise: PaiseSchema.positive(),
  /** Defaults to now. A device clock skewed more than 10 minutes is a sync warning, never a rejection. */
  receivedAt: IsoDateTimeSchema.optional(),
  /** UPI UTR, cheque number or bank reference. */
  reference: z.string().trim().min(1).max(64).optional(),
  upiVpa: z.string().trim().min(3).max(120).optional(),
  chequeDate: IsoDateSchema.optional(),
  bankName: z.string().trim().min(1).max(120).optional(),
  /** Cash collected on a trip posts to CASH_VAN and settles at the trip handover. */
  tripId: IdSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
  clientReceiptNo: z.string().trim().min(1).max(32).optional(),
  note: z.string().trim().max(500).optional(),
  proofObjectKey: z.string().trim().max(300).optional(),
  strategy: AllocationStrategySchema.default('fifo'),
  allocations: z.array(ReceiptAllocationInput).max(100).optional(),
}).refine(
  (r) =>
    r.strategy === 'explicit'
      ? (r.allocations?.length ?? 0) > 0
      : (r.allocations?.length ?? 0) === 0,
  'allocations are required for strategy `explicit` and must be empty for `fifo` and `none`',
)
export const CreateReceiptOutput = z.object({
  item: ReceiptSchema,
  allocations: z.array(AllocationSchema),
  invoices: z.array(SettledInvoiceSchema),
  cashDiscountPaise: PaiseSchema,
  unallocatedPaise: PaiseSchema,
  outstanding: RetailerOutstandingSchema,
})

export const ReceiptsListInput = z.object({
  retailerId: IdSchema.optional(),
  tripId: IdSchema.optional(),
  mode: ReceiptModeSchema.optional(),
  status: ReceiptStatusSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** The desk's "money sitting on account" filter. */
  unallocatedOnly: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const ReceiptsListOutput = z.object({
  items: z.array(ReceiptSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({ countedPaise: PaiseSchema, unallocatedPaise: PaiseSchema }),
})

export const ReceiptGetInput = z.object({ id: IdSchema })
export const ReceiptGetOutput = z.object({
  item: ReceiptSchema,
  allocations: z.array(AllocationSchema),
  /** The reversing receipt, when this one was reversed or bounced. */
  reversal: ReceiptSchema.nullable(),
})

/** A receipt is never edited. `reversalId` is the client-generated id of the mirror receipt. */
export const ReverseReceiptInput = MutationBase.extend({
  id: IdSchema,
  reversalId: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const ReverseReceiptOutput = z.object({
  item: ReceiptSchema,
  original: ReceiptSchema,
  invoices: z.array(SettledInvoiceSchema),
  outstanding: RetailerOutstandingSchema,
})

/** Banking a batch of cash and cheque receipts. No AR movement: DR BANK, CR CASH / CHEQUES. */
export const DepositReceiptsInput = MutationBase.extend({
  /** Client-generated id of the deposit batch; becomes the journal entry's `ref_id`. */
  id: IdSchema,
  receiptIds: z.array(IdSchema).min(1).max(200),
  depositAccountCode: DepositAccountCodeSchema.default('BANK'),
  depositedAt: IsoDateTimeSchema,
  depositRef: z.string().trim().min(1).max(64).optional(),
})
export const DepositReceiptsOutput = z.object({
  updated: z.number().int(),
  journalEntryId: IdSchema,
  totalPaise: PaiseSchema,
})

/** Cheque mode only. AR returns to exactly its pre-receipt value, cash discount included. */
export const BounceChequeInput = MutationBase.extend({
  id: IdSchema,
  reversalId: IdSchema,
  bouncedAt: IsoDateTimeSchema,
  reason: z.string().trim().min(1).max(200),
  /** Posted DR BANK_CHARGES / CR BANK; the shop is not charged (docs/plans/00-coordination.md §7 q9). */
  bankChargesPaise: PaiseSchema.nonnegative().default(0),
})
export const BounceChequeOutput = ReverseReceiptOutput

// ---------------------------------------------------------------------------------------------------------------
// the shop's own online payment (docs/17 §D4) — retailer role only, never a widening of receipts.create

/**
 * The retailer app's "pay my bills" button. It creates no money: it returns the UPI intent for the shop's
 * own dues and a reference the desk can match when the payment lands. The receipt itself is recorded by
 * the desk (or, later, by a payment-gateway callback running as `system`), because `receipts` is
 * staff-write at the database and a shop must never credit its own AR.
 *
 * The retailer is taken from the actor's link, never from the input: a shop cannot name another shop.
 */
export const InitiatePaymentInput = MutationBase.extend({
  /** Client-generated id of the payment intent; the same key returns the same intent on retry. */
  id: IdSchema,
  /** Defaults to the shop's whole outstanding. */
  amountPaise: PaiseSchema.positive().optional(),
  /** The bills the shop chose to pay; empty means "against my dues, oldest first". */
  invoiceIds: z.array(IdSchema).max(50).optional(),
  note: z.string().trim().max(200).optional(),
})
export const InitiatePaymentOutput = z.object({
  intentId: IdSchema,
  retailerId: IdSchema,
  amountPaise: PaiseSchema,
  /** UPI intent payload (pa, pn, am, tr) to render as a QR, and the same thing as a deep link. */
  upiQrPayload: z.string().nullable(),
  upiIntentUrl: z.string().nullable(),
  payeeVpa: z.string().nullable(),
  /** The distributor's own display name — the product is white-labelled per tenant (docs/17 §D6). */
  payeeName: z.string().nullable(),
  /** The `tr` reference the shop quotes and the desk matches the UTR against. */
  paymentRef: z.string(),
  expiresAt: z.string(),
  bills: z.array(OpenBillSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// allocations

export const AllocationLineInput = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  amountPaise: PaiseSchema.positive(),
})

/** Bill-to-bill allocation of on-account money or an issued credit note. Writes no journal rows. */
export const CreateAllocationsInput = MutationBase.extend({
  /** Client-generated id of the batch; the individual rows carry their own ids in `lines`. */
  id: IdSchema,
  sourceType: AllocationSourceTypeSchema,
  sourceId: IdSchema,
  lines: z.array(AllocationLineInput).min(1).max(100),
})
export const CreateAllocationsOutput = z.object({
  items: z.array(AllocationSchema),
  invoices: z.array(SettledInvoiceSchema),
  sourceUnallocatedPaise: PaiseSchema,
  outstanding: RetailerOutstandingSchema,
})

/** How the desk fixes a mis-keyed split without reversing the money. Never touches the journal. */
export const RemoveAllocationInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const RemoveAllocationOutput = z.object({
  removed: IdSchema,
  invoices: z.array(SettledInvoiceSchema),
  sourceUnallocatedPaise: PaiseSchema,
  outstanding: RetailerOutstandingSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// outstanding, credit and the ledger

export const OutstandingGetInput = z.object({
  retailerId: IdSchema,
  includeBills: QueryBoolSchema.default(true),
})
export const OutstandingGetOutput = RetailerOutstandingSchema.extend({
  bills: z.array(OpenBillSchema),
  /** Copied from the newest open invoice so the shop can pay from the dues screen. */
  upiQrPayload: z.string().nullable(),
})

/** The ageing register. Reads the summary table joined to retailers; never available to the shop. */
export const OutstandingListInput = z.object({
  beatId: IdSchema.optional(),
  overdueOnly: QueryBoolSchema.optional(),
  minOutstandingPaise: QueryIntSchema.optional(),
  bucket: AgeingBucketSchema.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: OutstandingSortSchema.default('outstanding'),
  ...CursorInput,
})
export const OutstandingListOutput = z.object({
  items: z.array(OutstandingListItemSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    outstandingPaise: PaiseSchema,
    overduePaise: PaiseSchema,
    retailers: z.number().int(),
  }),
})

/** The HTTP face of `ReceivablesService.creditVerdict()`, so app and server apply one rule. */
export const CreditCheckInput = z.object({
  retailerId: IdSchema,
  orderTotalPaise: QueryIntSchema.default(0),
})
export const CreditCheckOutput = z.object({
  retailerId: IdSchema,
  creditMode: CreditModeSchema,
  paymentTerms: PaymentTermsSchema,
  creditLimitPaise: PaiseSchema,
  creditLimitBills: z.number().int(),
  creditDays: z.number().int(),
  outstandingPaise: PaiseSchema,
  openBills: z.number().int(),
  oldestDueDate: z.string().nullable(),
  overdueDays: z.number().int(),
  orderTotalPaise: PaiseSchema,
  headroomPaise: PaiseSchema,
  /** `indicate` annotates and never breaches; `strict` and `stop` do. */
  breached: z.boolean(),
  reasons: z.array(CreditBreachReasonSchema),
})

export const RetailerLedgerInput = z.object({
  retailerId: IdSchema,
  /** Defaults to `to − 90 days`. The window is capped at 400 days (scale rule 3). */
  from: IsoDateSchema.optional(),
  /** Defaults to today in IST. */
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const RetailerLedgerOutput = z.object({
  openingPaise: PaiseSchema,
  items: z.array(RetailerLedgerRowSchema),
  closingPaise: PaiseSchema,
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// statements, write-offs, cash discounts, the books

/** Long work never runs on the request path: this queues one outbox row per statement (scale rule 3). */
export const SendStatementsInput = MutationBase.extend({
  /** Client-generated id of the statement job. */
  id: IdSchema,
  retailerIds: z.array(IdSchema).max(200).optional(),
  beatId: IdSchema.optional(),
  from: IsoDateSchema,
  to: IsoDateSchema,
  channel: StatementChannelSchema.default('whatsapp'),
  includeUpiQr: z.boolean().default(true),
  overdueOnly: z.boolean().default(false),
})
  .refine((s) => s.from <= s.to, 'from must not be after to')
  .refine(
    (s) => (s.retailerIds?.length ?? 0) > 0 !== (s.beatId !== undefined),
    'name either retailerIds or beatId, not both',
  )
export const SendStatementsOutput = z.object({
  jobId: IdSchema,
  queued: z.number().int(),
})

/** Owner only. Not the accountant, not the manager (docs/plans/00-coordination.md §7 q12). */
export const CreateWriteOffInput = MutationBase.extend({
  id: IdSchema,
  invoiceId: IdSchema,
  amountPaise: PaiseSchema.positive(),
  reason: WriteOffReasonSchema,
  note: z.string().trim().max(200).optional(),
})
export const CreateWriteOffOutput = z.object({
  item: WriteOffSchema,
  invoice: SettledInvoiceSchema,
  outstanding: RetailerOutstandingSchema,
})

export const CashDiscountsListInput = z.object({
  status: CashDiscountStatusSchema.optional(),
  payByBefore: IsoDateSchema.optional(),
  retailerId: IdSchema.optional(),
  ...CursorInput,
})
export const CashDiscountsListOutput = z.object({
  items: z.array(CashDiscountConditionSchema),
  nextCursor: z.string().nullable(),
})

/** The accountant's trial balance: `totals.debitPaise + totals.creditPaise` is 0 (a spec asserts it). */
export const AccountsListInput = z.object({
  kind: AccountKindSchema.optional(),
  /** Defaults to today in IST; balances sum journal lines with `entry_date <= asOf`. */
  asOf: IsoDateSchema.optional(),
  withBalances: QueryBoolSchema.default(true),
  partyType: z.string().trim().min(1).max(32).optional(),
  partyId: IdSchema.optional(),
})
export const AccountsListOutput = z.object({
  items: z.array(AccountSchema),
  totals: z.object({ debitPaise: PaiseSchema, creditPaise: PaiseSchema }),
})

/**
 * The day book. Back office at the edge AND at the database: the 0007 policy gives a salesperson,
 * a delivery actor or a shop zero rows, which is the ADR 0002 cost guarantee (purchases and GRN
 * postings are readable through the journal today).
 */
export const JournalListInput = z.object({
  refType: z.string().trim().min(1).max(32).optional(),
  refId: IdSchema.optional(),
  accountCode: z.string().trim().min(1).max(32).optional(),
  partyType: z.string().trim().min(1).max(32).optional(),
  partyId: IdSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const JournalListOutput = z.object({
  items: z.array(JournalEntrySchema),
  nextCursor: z.string().nullable(),
})

/** The same code path the nightly worker job runs, exposed so the owner can force a refresh. */
export const RebuildAgeingInput = MutationBase.extend({
  id: IdSchema,
  /** Defaults to `businessDate()`. */
  asOf: IsoDateSchema.optional(),
  /** One shop only; omit to rebuild the whole tenant in batches of 500. */
  retailerId: IdSchema.optional(),
})
export const RebuildAgeingOutput = z.object({
  asOf: z.string(),
  retailers: z.number().int(),
  outstandingPaise: PaiseSchema,
  overduePaise: PaiseSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `receivables: receivablesContract` in contract.ts

export const receivablesContract = {
  receipts: {
    create: oc
      .route({
        method: 'POST',
        path: '/receipts',
        summary: 'Record money from a shop and allocate it to bills (desk and delivery crew)',
      })
      .input(CreateReceiptInput)
      .output(CreateReceiptOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/receipts',
        summary: 'Receipts (a shop sees only its own)',
      })
      .input(ReceiptsListInput)
      .output(ReceiptsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/receipts/{id}',
        summary: 'One receipt with its allocations and its reversal, if any',
      })
      .input(ReceiptGetInput)
      .output(ReceiptGetOutput),
    reverse: oc
      .route({
        method: 'POST',
        path: '/receipts/{id}/reverse',
        summary: 'Reverse a receipt with a mirror receipt; the original is never edited',
      })
      .input(ReverseReceiptInput)
      .output(ReverseReceiptOutput),
    deposit: oc
      .route({
        method: 'POST',
        path: '/receipts/deposit',
        summary: 'Bank a batch of cash and cheque receipts',
      })
      .input(DepositReceiptsInput)
      .output(DepositReceiptsOutput),
    bounce: oc
      .route({
        method: 'POST',
        path: '/receipts/{id}/bounce',
        summary: 'Return a bounced cheque and restore the outstanding exactly',
      })
      .input(BounceChequeInput)
      .output(BounceChequeOutput),
  },
  payments: {
    initiate: oc
      .route({
        method: 'POST',
        path: '/receivables/payments/initiate',
        summary: 'A shop starts an online payment against its own bills',
      })
      .input(InitiatePaymentInput)
      .output(InitiatePaymentOutput),
  },
  allocations: {
    create: oc
      .route({
        method: 'POST',
        path: '/allocations',
        summary: 'Allocate on-account money or a credit note to specific bills',
      })
      .input(CreateAllocationsInput)
      .output(CreateAllocationsOutput),
    remove: oc
      .route({
        method: 'POST',
        path: '/allocations/{id}/remove',
        summary: 'Undo one allocation without reversing the money',
      })
      .input(RemoveAllocationInput)
      .output(RemoveAllocationOutput),
  },
  outstanding: {
    get: oc
      .route({
        method: 'GET',
        path: '/receivables/outstanding/{retailerId}',
        summary: "One shop's dues with its open bills",
      })
      .input(OutstandingGetInput)
      .output(OutstandingGetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/receivables/outstanding',
        summary: 'The ageing register: dues by shop, bucket and beat',
      })
      .input(OutstandingListInput)
      .output(OutstandingListOutput),
  },
  creditCheck: oc
    .route({
      method: 'GET',
      path: '/receivables/credit-check',
      summary: "Whether this order fits the shop's credit terms",
    })
    .input(CreditCheckInput)
    .output(CreditCheckOutput),
  ledger: {
    get: oc
      .route({
        method: 'GET',
        path: '/receivables/ledger/{retailerId}',
        summary: "A shop's statement of account with a running balance",
      })
      .input(RetailerLedgerInput)
      .output(RetailerLedgerOutput),
  },
  statements: {
    send: oc
      .route({
        method: 'POST',
        path: '/receivables/statements',
        summary: 'Queue statements for a beat or a list of shops',
      })
      .input(SendStatementsInput)
      .output(SendStatementsOutput),
  },
  writeOffs: {
    create: oc
      .route({
        method: 'POST',
        path: '/receivables/write-offs',
        summary: 'Write off a bad debt (owner only)',
      })
      .input(CreateWriteOffInput)
      .output(CreateWriteOffOutput),
  },
  cashDiscounts: {
    list: oc
      .route({
        method: 'GET',
        path: '/receivables/cash-discounts',
        summary: 'Cash-discount windows still open, soonest first',
      })
      .input(CashDiscountsListInput)
      .output(CashDiscountsListOutput),
  },
  accounts: {
    list: oc
      .route({
        method: 'GET',
        path: '/receivables/accounts',
        summary: 'Chart of accounts with balances (trial balance)',
      })
      .input(AccountsListInput)
      .output(AccountsListOutput),
  },
  journal: {
    list: oc
      .route({
        method: 'GET',
        path: '/receivables/journal',
        summary: 'The day book: journal entries with their lines (back office)',
      })
      .input(JournalListInput)
      .output(JournalListOutput),
  },
  ageing: {
    rebuild: oc
      .route({
        method: 'POST',
        path: '/receivables/ageing/rebuild',
        summary: 'Recompute the outstanding summary and the ageing snapshot (owner only)',
      })
      .input(RebuildAgeingInput)
      .output(RebuildAgeingOutput),
  },
}
