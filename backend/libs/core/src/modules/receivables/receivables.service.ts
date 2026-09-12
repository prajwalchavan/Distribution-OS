import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AccountsListInput,
  AccountsListOutput,
  AgeingHistoryInput,
  AgeingHistoryOutput,
  DocumentRender,
  ReceiptDocumentInput,
  Allocation,
  BounceChequeInput,
  CashDiscountsListInput,
  CashDiscountsListOutput,
  CreateAllocationsInput,
  CreateAllocationsOutput,
  CreateReceiptInput,
  CreateReceiptOutput,
  CreateWriteOffInput,
  CreateWriteOffOutput,
  CreditCheckInput,
  DepositReceiptsInput,
  DepositReceiptsOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  JournalListInput,
  JournalListOutput,
  OutstandingGetInput,
  OutstandingGetOutput,
  OutstandingListInput,
  OutstandingListOutput,
  RebuildAgeingInput,
  RebuildAgeingOutput,
  ReceiptGetInput,
  ReceiptGetOutput,
  ReceiptMode,
  ReceiptsListInput,
  ReceiptsListOutput,
  RemoveAllocationInput,
  RemoveAllocationOutput,
  RetailerLedgerInput,
  RetailerLedgerOutput,
  RetailerOutstanding,
  ReverseReceiptInput,
  ReverseReceiptOutput,
  SendStatementsInput,
  SendStatementsOutput,
  SettledInvoice,
} from '@dos/contracts'
import { businessDate, isBankableReceiptMode, upiIntent, uuidv7 } from '@dos/domain'
import {
  allocations,
  auditLog,
  beatAssignments,
  cashDiscountConditions,
  creditNotes,
  invoices,
  receipts,
  retailerLinks,
  retailers,
  withTenant,
  writeOffs,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  OWNER,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import {
  allocatedAgainst,
  invoiceOpenPaise,
  loadInvoices,
  markWrittenOff,
  openConditions,
  planExplicit,
  planFifo,
  plannedAmount,
  realiseCondition,
  recomputeInvoiceStates,
  releaseConditionsOf,
  type InvoiceForAllocation,
  type PlannedAllocation,
} from './allocation.js'
import { checkCredit, type CreditVerdict } from './credit.js'
import {
  loadOpenBills,
  loadOutstanding,
  openPaiseOf,
  refreshOutstandingFor,
  retailerIdPage,
  toOpenBill,
  writeAgeingSnapshot,
} from './outstanding.js'
import {
  accountIdsByCode,
  emitEvent,
  findEntryByRef,
  postJournalEntry,
  reverseJournalEntry,
  stampReversed,
  type JournalEntryInput,
} from './posting.js'
import { ageingHistory } from './ageing-history.js'
import {
  collectionsRegister,
  type CollectionsRegisterFilter,
  type CollectionsRegisterRow,
} from './collections-register.js'
import { documentRender, type DocumentRenderKind } from '../../platform/documents.js'
import { sellerBranding } from '../tenancy/index.js'
import { toAllocation, toReceipt, toWriteOff, type ReceiptRow } from './receivables.mappers.js'
import {
  listAccounts,
  listCashDiscounts,
  listJournal,
  listOutstanding,
  listReceipts,
  receiptWithAllocations,
  retailerLedger,
  shiftDate,
} from './receivables.queries.js'

/**
 * Receivables — the money ledger (ADR 0004). It owns `accounts`, `journal_entries`, `journal_lines`,
 * `receipts`, `allocations`, `write_offs`, `retailer_outstanding_summary`, `ageing_snapshots` and
 * `cash_discount_conditions`, and it is the ONLY writer of those tables. Billing, delivery, claims and
 * integrations post through the service methods below, never with SQL of their own.
 *
 * The invariants this class exists to keep:
 *  - every journal entry balances to the paisa and is append-only; a mistake is a reversing entry;
 *  - a receipt is never edited (only `status` and the deposit/bounce metadata move); a correction is a
 *    second receipt with a negative amount;
 *  - an over-payment sits as unallocated credit and is never silently spread;
 *  - `invoices.state` is derived here and nowhere else (docs/plans/00-coordination.md §3.2);
 *  - `retailer_outstanding_summary` is refreshed in the same transaction as every posting, so it cannot
 *    drift from the books.
 *
 * WHO MAY TAKE MONEY (docs/17 §D4, the founder's answer): the desk and the delivery crew at the shop
 * door. A salesperson never collects — there is no role list in this file that includes one. A shop pays
 * for itself through `payments.initiate`, which creates no receipt at all.
 */

/** The desk plus the crew. Deliberately no `salesperson` (docs/17 §D4). `system` is the worker. */
const MONEY_COLLECTORS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'system',
]
/** Everyone who may look at a shop's dues, the shop itself included; RLS narrows it to its own rows. */
const MONEY_READERS: readonly ActorRole[] = [...MONEY_COLLECTORS, 'retailer']
/**
 * Who may look at ONE shop's dues and statement: the money readers plus the SALESPERSON on the beat
 * (docs/23 §8.1). "The salesperson never collects" (docs/17 §D4) forbids collecting, not seeing — the
 * outstanding chip on the beat screen is this. A rep is scoped in the handler to the shops of its own
 * beats (`assertRepServes`); nothing widens a write.
 */
const DUES_READERS: readonly ActorRole[] = [...MONEY_READERS, 'salesperson']
/** Who runs the credit check before an order: the collectors plus the rep on the device (never the shop). */
const CREDIT_CHECKERS: readonly ActorRole[] = [...MONEY_COLLECTORS, 'salesperson']
/**
 * The MONEY DESK (docs/22 2026-09-05): owner, manager, accountant — office receipts, reversals,
 * banking, bounces, allocations, write-offs, statements. The same members as BACK_OFFICE; named so
 * the accountant's write scope reads as exactly this list.
 */
const MONEY_DESK: readonly ActorRole[] = BACK_OFFICE
/** The shop's own online-payment path, and nothing else in this module. */
const SHOPKEEPER: readonly ActorRole[] = ['retailer']

/** How many shops one `ageing.rebuild` statement handles before taking the next page (scale rule 3). */
const AGEING_BATCH = 500
/** A statement of account never looks further back than this in one request (scale rule 3). */
const MAX_LEDGER_WINDOW_DAYS = 400
/** How long the UPI intent a shop is shown stays quotable. */
const PAYMENT_INTENT_MINUTES = 30

type CreateReceiptIn = z.infer<typeof CreateReceiptInput>
type CreateReceiptOut = z.infer<typeof CreateReceiptOutput>
type ReverseIn = z.infer<typeof ReverseReceiptInput>
type ReverseOut = z.infer<typeof ReverseReceiptOutput>
type BounceIn = z.infer<typeof BounceChequeInput>
type DepositIn = z.infer<typeof DepositReceiptsInput>
type DepositOut = z.infer<typeof DepositReceiptsOutput>
type InitiateIn = z.infer<typeof InitiatePaymentInput>
type InitiateOut = z.infer<typeof InitiatePaymentOutput>
type CreateAllocationsIn = z.infer<typeof CreateAllocationsInput>
type CreateAllocationsOut = z.infer<typeof CreateAllocationsOutput>
type RemoveAllocationIn = z.infer<typeof RemoveAllocationInput>
type RemoveAllocationOut = z.infer<typeof RemoveAllocationOutput>
type WriteOffIn = z.infer<typeof CreateWriteOffInput>
type WriteOffOut = z.infer<typeof CreateWriteOffOutput>
type RebuildIn = z.infer<typeof RebuildAgeingInput>
type RebuildOut = z.infer<typeof RebuildAgeingOutput>
type StatementsIn = z.infer<typeof SendStatementsInput>
type StatementsOut = z.infer<typeof SendStatementsOutput>

/** What billing hands over when it issues a bill; every field is the invoice's own, in paise. */
export interface InvoiceForPosting {
  id: string
  retailerId: string
  invoiceDate: string
  subtotalPaise: number
  discountPaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
  /** Receivables writes this column too (coordination §3.2): it is what the ageing buckets key on. */
  dueDate?: string | null | undefined
  /** When set, a `cash_discount_conditions` row is opened with the bill (ADR 0004, realised at receipt). */
  cashDiscountBps?: number | undefined
  cashDiscountUntil?: string | null | undefined
}

/** What billing hands over when it issues a credit note. */
export interface CreditNoteForPosting {
  id: string
  invoiceId: string
  retailerId: string
  noteDate: string
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
}

/** The transaction-scoped core of `receipts.create`; delivery and the sync handler call it directly. */
export interface RecordReceiptInput {
  id: string
  idempotencyKey: string
  retailerId: string
  mode: ReceiptMode
  amountPaise: number
  receivedAt?: string | undefined
  /** Defaults to the actor. Delivery passes the crew member who actually took the money. */
  receivedBy?: string | undefined
  reference?: string | null | undefined
  upiVpa?: string | null | undefined
  chequeDate?: string | null | undefined
  bankName?: string | null | undefined
  tripId?: string | null | undefined
  deviceId?: string | null | undefined
  clientReceiptNo?: string | null | undefined
  note?: string | null | undefined
  proofObjectKey?: string | null | undefined
  strategy?: 'fifo' | 'none' | 'explicit' | undefined
  allocations?: { id: string; invoiceId: string; amountPaise: number }[] | undefined
}

export type RecordReceiptResult = CreateReceiptOut

/** Where the money lands. Cash taken on a trip sits in CASH_VAN until the trip settlement hands it over. */
function receiptAccountCode(mode: ReceiptMode, tripId: string | null): string {
  switch (mode) {
    case 'cash':
      return tripId ? 'CASH_VAN' : 'CASH'
    case 'upi':
      return 'UPI'
    case 'bank_transfer':
      return 'BANK'
    case 'cheque':
      return 'CHEQUES'
    case 'adjustment':
      // A non-cash write-down of a bill (a rounding difference agreed at the counter). It is not a
      // bad debt and it is not a credit note, so it goes to Round off, the same place s.170 residues go.
      return 'ROUND_OFF'
  }
}

/** A receipt as the Tally receipt voucher reads it (integrations, slice 6). */
export interface ReceiptForExport {
  id: string
  receiptNo: string | null
  retailerId: string
  mode: string
  amountPaise: number
  receivedAt: string
  reference: string | null
  bankName: string | null
  chequeDate: string | null
  status: string
  cashDiscountPaise: number
  tripId: string | null
  depositedAt: string | null
  depositRef: string | null
}

@Injectable()
export class ReceivablesService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // =============================================================================================================
  // the surface other modules import (docs/plans/00-coordination.md §3.1)
  // =============================================================================================================

  /** One balanced, keyed, append-only journal entry. Nothing else in the codebase writes the book. */
  async postEntry(tx: Db, entry: JournalEntryInput): Promise<{ entryId: string }> {
    return postJournalEntry(tx, entry)
  }

  /**
   * Receipts in a window for the Tally receipt voucher (integrations, slice 6): collected or deposited
   * money, never a reversal mirror, bounded and date-ordered so a re-run emits the same vouchers.
   */
  async receiptsForExport(
    tx: Db,
    filter: {
      from: string
      to: string
      retailerId?: string | undefined
      limit?: number | undefined
    },
  ): Promise<ReceiptForExport[]> {
    const { tenantId } = currentTenant()
    const limit = Math.min(filter.limit ?? 5000, 20_000)
    const result = await tx.execute(sql`
      SELECT r.id, r.receipt_no, r.retailer_id, r.mode::text AS mode, r.amount_paise, r.received_at,
             r.reference, r.bank_name, r.cheque_date, r.status::text AS status, r.cash_discount_paise,
             r.trip_id, r.deposited_at, r.deposit_ref
        FROM receipts r
       WHERE r.tenant_id = ${tenantId}
         AND r.status IN ('collected', 'deposited')
         AND r.amount_paise > 0
         AND r.reverses_receipt_id IS NULL
         AND (r.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${filter.from} AND ${filter.to}
         AND (${filter.retailerId ?? null}::text IS NULL OR r.retailer_id = ${filter.retailerId ?? null})
       ORDER BY r.received_at ASC, r.id ASC
       LIMIT ${limit}`)
    return result.rows.map((r) => ({
      id: String(r.id),
      receiptNo: (r.receipt_no as string | null) ?? null,
      retailerId: String(r.retailer_id),
      mode: String(r.mode),
      amountPaise: Number(r.amount_paise),
      receivedAt: new Date(r.received_at as string | Date).toISOString(),
      reference: (r.reference as string | null) ?? null,
      bankName: (r.bank_name as string | null) ?? null,
      chequeDate: (r.cheque_date as string | null) ?? null,
      status: String(r.status),
      cashDiscountPaise: Number(r.cash_discount_paise ?? 0),
      tripId: (r.trip_id as string | null) ?? null,
      depositedAt: r.deposited_at ? new Date(r.deposited_at as string | Date).toISOString() : null,
      depositRef: (r.deposit_ref as string | null) ?? null,
    }))
  }

  /** The entry a document produced (`opening`, `invoice_issued`, …), so a caller can reverse it without carrying the id around. */
  async entryIdByRef(tx: Db, refType: string, refId: string): Promise<string | null> {
    return findEntryByRef(tx, refType, refId)
  }

  /** The only correction a ledger allows: a mirror entry, with `reversed_by_entry_id` on the original. */
  async reverseEntry(
    tx: Db,
    entryId: string,
    idempotencyKey: string,
    narration?: string,
  ): Promise<{ entryId: string }> {
    return reverseJournalEntry(tx, entryId, idempotencyKey, narration)
  }

  /**
   * DR AR total, DR Discounts allowed, CR Sales, CR the output-tax accounts, Round off for the residue.
   * It balances because `total = subtotal − discount + taxes + roundOff`. Called by billing inside its own
   * transaction at pack; it also writes the bill's due date and opens the cash-discount offer.
   */
  async postInvoiceIssued(tx: Db, invoice: InvoiceForPosting): Promise<{ entryId: string }> {
    const { tenantId } = currentTenant()
    const posted = await postJournalEntry(tx, {
      entryDate: invoice.invoiceDate,
      refType: 'invoice',
      refId: invoice.id,
      narration: `invoice ${invoice.id}`,
      idempotencyKey: `journal:invoice:${invoice.id}`,
      lines: [
        {
          accountCode: 'AR',
          amountPaise: invoice.totalPaise,
          partyType: 'retailer',
          partyId: invoice.retailerId,
        },
        { accountCode: 'DISCOUNTS', amountPaise: invoice.discountPaise },
        { accountCode: 'SALES', amountPaise: -invoice.subtotalPaise },
        { accountCode: 'OUTPUT_CGST', amountPaise: -invoice.cgstPaise },
        { accountCode: 'OUTPUT_SGST', amountPaise: -invoice.sgstPaise },
        { accountCode: 'OUTPUT_IGST', amountPaise: -invoice.igstPaise },
        { accountCode: 'OUTPUT_CESS', amountPaise: -invoice.cessPaise },
        { accountCode: 'ROUND_OFF', amountPaise: -invoice.roundOffPaise },
      ],
    })
    if (invoice.dueDate) {
      // module-boundary: receivables owns `state` and `due_date`, see docs/plans/00-coordination.md §3.2
      await tx
        .update(invoices)
        .set({ dueDate: invoice.dueDate, updatedAt: new Date() })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoice.id)))
    }
    if (invoice.cashDiscountBps && invoice.cashDiscountUntil) {
      await this.openCashDiscountCondition(tx, {
        id: uuidv7(),
        invoiceId: invoice.id,
        discountBps: invoice.cashDiscountBps,
        payBy: invoice.cashDiscountUntil,
      })
    }
    await this.refreshOutstanding(tx, invoice.retailerId)
    return posted
  }

  /**
   * DR Sales returns and the output taxes back, CR AR. By default the note is allocated straight to the
   * bill it corrects, which is what makes the shop's outstanding drop the moment the note is issued.
   */
  async postCreditNoteIssued(
    tx: Db,
    note: CreditNoteForPosting,
    opts: { autoAllocate?: boolean } = {},
  ): Promise<{ entryId: string }> {
    const posted = await postJournalEntry(tx, {
      entryDate: note.noteDate,
      refType: 'credit_note',
      refId: note.id,
      narration: `credit note ${note.id}`,
      idempotencyKey: `journal:credit_note:${note.id}`,
      lines: [
        { accountCode: 'SALES_RETURNS', amountPaise: note.taxablePaise },
        { accountCode: 'OUTPUT_CGST', amountPaise: note.cgstPaise },
        { accountCode: 'OUTPUT_SGST', amountPaise: note.sgstPaise },
        { accountCode: 'OUTPUT_IGST', amountPaise: note.igstPaise },
        { accountCode: 'OUTPUT_CESS', amountPaise: note.cessPaise },
        { accountCode: 'ROUND_OFF', amountPaise: note.roundOffPaise },
        {
          accountCode: 'AR',
          amountPaise: -note.totalPaise,
          partyType: 'retailer',
          partyId: note.retailerId,
        },
      ],
    })
    if (opts.autoAllocate !== false) {
      const open = await invoiceOpenPaise(tx, note.invoiceId)
      const amountPaise = Math.min(open, note.totalPaise)
      if (amountPaise > 0) {
        await this.allocateCreditNote(tx, {
          id: uuidv7(),
          invoiceId: note.invoiceId,
          creditNoteId: note.id,
          amountPaise,
        })
      }
    }
    await this.refreshOutstanding(tx, note.retailerId)
    return posted
  }

  /**
   * The migration path from whatever software the distributor is leaving: each carried-over bill enters as
   * an `invoices` row with `source = 'import'` and one DR AR / CR Opening balance equity entry, so
   * bill-to-bill allocation and the ageing buckets work from day one (docs/17 §D7).
   */
  async postOpeningBalance(
    tx: Db,
    input: {
      retailerId: string
      invoiceId: string
      amountPaise: number
      asOfDate: string
      importJobId: string
    },
  ): Promise<{ entryId: string }> {
    const posted = await postJournalEntry(tx, {
      entryDate: input.asOfDate,
      refType: 'opening',
      refId: input.invoiceId,
      narration: `opening balance from import ${input.importJobId}`,
      idempotencyKey: `journal:opening:${input.invoiceId}`,
      lines: [
        {
          accountCode: 'AR',
          amountPaise: input.amountPaise,
          partyType: 'retailer',
          partyId: input.retailerId,
        },
        { accountCode: 'OPENING', amountPaise: -input.amountPaise },
      ],
    })
    await this.refreshOutstanding(tx, input.retailerId)
    return posted
  }

  /** "2% if you pay within 7 days" attached to a bill. Idempotent: one offer per invoice. */
  async openCashDiscountCondition(
    tx: Db,
    input: { id: string; invoiceId: string; discountBps: number; payBy: string },
  ): Promise<void> {
    const { tenantId } = currentTenant()
    await tx
      .insert(cashDiscountConditions)
      .values({
        id: input.id,
        tenantId,
        invoiceId: input.invoiceId,
        discountBps: input.discountBps,
        payBy: input.payBy,
      })
      .onConflictDoNothing()
  }

  /** A credit note settling a bill. No journal row: the note's tax was posted when it was issued. */
  async allocateCreditNote(
    tx: Db,
    input: { id: string; invoiceId: string; creditNoteId: string; amountPaise: number },
  ): Promise<void> {
    const { tenantId, actorId } = currentTenant()
    await tx
      .insert(allocations)
      .values({
        id: input.id,
        tenantId,
        invoiceId: input.invoiceId,
        creditNoteId: input.creditNoteId,
        amountPaise: input.amountPaise,
        allocatedBy: actorId,
      })
      .onConflictDoNothing()
    await recomputeInvoiceStates(tx, [input.invoiceId])
  }

  /** What a bill still owes: `total_paise − Σ allocations`. */
  async invoiceOutstandingPaise(tx: Db, invoiceId: string): Promise<number> {
    return invoiceOpenPaise(tx, invoiceId)
  }

  /**
   * The same figure for a whole page of bills, in ONE query. Added by the billing slice
   * (coordination §3.1: a method another module needs is a small edit to receivables' own files, never a
   * second implementation): `GET /invoices` shows what each bill still owes, and doing that a row at a
   * time would be 200 round trips per page. Bills this caller cannot see are simply absent from the map.
   */
  async invoiceOutstandingMany(
    tx: Db,
    invoiceIds: readonly string[],
  ): Promise<Map<string, number>> {
    const found = await loadInvoices(tx, invoiceIds)
    return new Map([...found.values()].map((i) => [i.id, i.totalPaise - i.allocatedPaise]))
  }

  /** Credit control, shared by the order aggregate and the `creditCheck` procedure. */
  async creditVerdict(tx: Db, retailerId: string, orderTotalPaise: number): Promise<CreditVerdict> {
    return checkCredit(tx, retailerId, orderTotalPaise)
  }

  /** Recompute and store one shop's rollup, in the same transaction as the posting that changed it. */
  async refreshOutstanding(tx: Db, retailerId: string): Promise<void> {
    await refreshOutstandingFor(tx, [retailerId])
  }

  // =============================================================================================================
  // recording money
  // =============================================================================================================

  /**
   * The transaction-scoped core of `receipts.create`. Assigns the RCPT number, allocates (FIFO unless the
   * caller says otherwise), realises a cash discount when the money settles a bill in full inside its
   * window, posts ONE balanced entry, re-derives every touched bill's state and refreshes the rollup.
   *
   * Idempotent twice over: by the receipt's own id, and by `(device_id, client_receipt_no)` for a receipt
   * written on paper in the field and uploaded later (docs/07 §7.3).
   */
  async recordReceipt(tx: Db, input: RecordReceiptInput): Promise<RecordReceiptResult> {
    const { tenantId, actorId } = currentTenant()
    if (input.amountPaise <= 0) {
      throw new ORPCError('BAD_REQUEST', { message: 'a receipt must carry a positive amount' })
    }
    const retailer = await this.requireRetailer(tx, input.retailerId)
    const replay = await this.findExistingReceipt(tx, input)
    if (replay) return this.receiptReply(tx, replay, retailer.id)

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date()
    const paidOn = businessDate(receivedAt).date
    const tripId = input.tripId ?? null
    const receiptNo = await nextDocumentNumber(tx, 'RCPT', receivedAt)

    const plan = await this.planAllocations(tx, input, paidOn)
    const cashDiscountPaise = plan.reduce((s, l) => s + l.discountPaise, 0)

    await tx.insert(receipts).values({
      id: input.id,
      tenantId,
      receiptNo,
      retailerId: input.retailerId,
      mode: input.mode,
      amountPaise: input.amountPaise,
      receivedAt,
      receivedBy: input.receivedBy ?? actorId,
      tripId,
      reference: input.reference ?? null,
      upiVpa: input.upiVpa ?? null,
      chequeDate: input.chequeDate ?? null,
      bankName: input.bankName ?? null,
      cashDiscountPaise,
      proofObjectKey: input.proofObjectKey ?? null,
      note: input.note ?? null,
      deviceId: input.deviceId ?? null,
      clientReceiptNo: input.clientReceiptNo ?? null,
      idempotencyKey: input.idempotencyKey,
    })

    const written: Allocation[] = []
    for (const line of plan) {
      const amountPaise = plannedAmount(line)
      const id = this.allocationIdFor(input, line.invoiceId)
      const [row] = await tx
        .insert(allocations)
        .values({
          id,
          tenantId,
          invoiceId: line.invoiceId,
          receiptId: input.id,
          amountPaise,
          allocatedBy: actorId,
        })
        .returning()
      if (row) written.push(toAllocation(row))
      if (line.conditionId && line.discountPaise > 0) {
        await realiseCondition(tx, line.conditionId, input.id, line.discountPaise)
        await emitEvent(tx, 'invoice', line.invoiceId, 'CashDiscountRealised', {
          invoiceId: line.invoiceId,
          receiptId: input.id,
          realisedPaise: line.discountPaise,
        })
      }
    }

    await postJournalEntry(tx, {
      entryDate: paidOn,
      refType: 'receipt',
      refId: input.id,
      narration: `receipt ${receiptNo}`,
      idempotencyKey: `journal:receipt:${input.id}`,
      lines: [
        { accountCode: receiptAccountCode(input.mode, tripId), amountPaise: input.amountPaise },
        { accountCode: 'CASH_DISCOUNT', amountPaise: cashDiscountPaise },
        {
          accountCode: 'AR',
          amountPaise: -(input.amountPaise + cashDiscountPaise),
          partyType: 'retailer',
          partyId: input.retailerId,
        },
      ],
    })

    const settled = await recomputeInvoiceStates(
      tx,
      plan.map((l) => l.invoiceId),
    )
    const outstanding = await this.refreshAndRead(tx, input.retailerId)
    await emitEvent(tx, 'receipt', input.id, 'ReceiptRecorded', {
      receiptId: input.id,
      receiptNo,
      retailerId: input.retailerId,
      amountPaise: input.amountPaise,
      cashDiscountPaise,
      tripId,
    })
    for (const invoice of settled.filter((i) => i.state === 'paid')) {
      await emitEvent(tx, 'invoice', invoice.id, 'InvoicePaid', { invoiceId: invoice.id })
    }

    const stored = await receiptWithAllocations(tx, input.id)
    if (!stored) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'receipt vanished after insert' })
    }
    const item = toReceipt(stored.row, stored.allocatedPaise)
    return {
      item,
      allocations: written,
      invoices: settled,
      cashDiscountPaise,
      unallocatedPaise: item.unallocatedPaise,
      outstanding,
    }
  }

  async createReceipt(input: CreateReceiptIn): Promise<CreateReceiptOut> {
    requireRole(MONEY_COLLECTORS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () =>
        this.recordReceipt(tx, {
          ...input,
          allocations: input.allocations ?? [],
        }),
      ),
    )
  }

  async listReceipts(
    input: z.infer<typeof ReceiptsListInput>,
  ): Promise<z.infer<typeof ReceiptsListOutput>> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => listReceipts(tx, input))
  }

  async getReceipt(
    input: z.infer<typeof ReceiptGetInput>,
  ): Promise<z.infer<typeof ReceiptGetOutput>> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const found = await receiptWithAllocations(tx, input.id)
      // A row RLS hides is a 404, never a 403: a shop must not learn that another shop's receipt exists.
      if (!found) throw new ORPCError('NOT_FOUND', { message: `receipt ${input.id} not found` })
      const rows = await tx
        .select()
        .from(allocations)
        .where(and(eq(allocations.tenantId, ctx.tenantId), eq(allocations.receiptId, input.id)))
        .orderBy(asc(allocations.id))
      const [reversal] = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.tenantId, ctx.tenantId), eq(receipts.reversesReceiptId, input.id)))
        .limit(1)
      const reversalAllocated = reversal
        ? ((await allocatedAgainst(tx, 'receiptId', [reversal.id])).get(reversal.id) ?? 0)
        : 0
      return {
        item: toReceipt(found.row, found.allocatedPaise),
        allocations: rows.map(toAllocation),
        reversal: reversal ? toReceipt(reversal, reversalAllocated) : null,
        // The receipt is the third white-label document (docs/22 §4 D6): the distributor's own block.
        seller: await sellerBranding(tx),
      }
    })
  }

  /**
   * The printed / WhatsApp receipt. Nothing renders on the request path (docs/20 rule 3): the first
   * call queues `documents.pdf.render` with the `receipt` template and answers `queued`; once the
   * worker has written `receipts.pdf_object_key` every later call answers `ready` with a signed URL.
   */
  async receiptDocument(input: z.infer<typeof ReceiptDocumentInput>): Promise<DocumentRender> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const found = await receiptWithAllocations(tx, input.id)
      if (!found) throw new ORPCError('NOT_FOUND', { message: `receipt ${input.id} not found` })
      const kind: DocumentRenderKind = 'receipt'
      return documentRender(tx, {
        kind,
        id: found.row.id,
        objectKey: found.row.pdfObjectKey,
        format: input.format,
      })
    })
  }

  /** A receipt is never edited: a mirror row with a negative amount undoes it, and the original is kept. */
  async reverseReceipt(input: ReverseIn): Promise<ReverseOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () =>
        this.undoReceipt(tx, {
          originalId: input.id,
          reversalId: input.reversalId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          at: new Date(),
          kind: 'reverse',
          bankChargesPaise: 0,
        }),
      ),
    )
  }

  /** A returned cheque: the same mechanics, plus the bank's charge, and AR back to exactly where it was. */
  async bounceCheque(input: BounceIn): Promise<ReverseOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () =>
        this.undoReceipt(tx, {
          originalId: input.id,
          reversalId: input.reversalId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          at: new Date(input.bouncedAt),
          kind: 'bounce',
          bankChargesPaise: input.bankChargesPaise,
        }),
      ),
    )
  }

  async depositReceipts(input: DepositIn): Promise<DepositOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const rows = await tx
          .select()
          .from(receipts)
          .where(and(eq(receipts.tenantId, ctx.tenantId), inArray(receipts.id, input.receiptIds)))
        if (rows.length !== input.receiptIds.length) {
          throw new ORPCError('NOT_FOUND', { message: 'one of the receipts does not exist' })
        }
        for (const row of rows) {
          if (row.status !== 'collected') {
            throw new ORPCError('CONFLICT', {
              message: `receipt ${row.receiptNo ?? row.id} is ${row.status}, not collected`,
            })
          }
          if (!isBankableReceiptMode(row.mode)) {
            throw new ORPCError('CONFLICT', {
              message: `receipt ${row.receiptNo ?? row.id} is ${row.mode}; only cash and cheques are banked`,
            })
          }
        }
        const depositedAt = new Date(input.depositedAt)
        const bankId = (await accountIdsByCode(tx, [input.depositAccountCode])).get(
          input.depositAccountCode,
        )
        const totalPaise = rows.reduce((s, r) => s + r.amountPaise, 0)
        const bySource = new Map<string, number>()
        for (const row of rows) {
          const code = receiptAccountCode(row.mode as ReceiptMode, row.tripId)
          bySource.set(code, (bySource.get(code) ?? 0) + row.amountPaise)
        }
        await tx
          .update(receipts)
          .set({
            status: 'deposited',
            depositedAt,
            depositRef: input.depositRef ?? null,
            depositAccountId: bankId ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(receipts.tenantId, ctx.tenantId), inArray(receipts.id, input.receiptIds)))
        const posted = await postJournalEntry(tx, {
          entryDate: businessDate(depositedAt).date,
          refType: 'deposit',
          refId: input.id,
          narration: input.depositRef ?? `deposit ${input.id}`,
          idempotencyKey: `journal:deposit:${input.id}`,
          lines: [
            { accountCode: input.depositAccountCode, amountPaise: totalPaise },
            ...[...bySource].map(([code, amount]) => ({
              accountCode: code,
              amountPaise: -amount,
            })),
          ],
        })
        for (const row of rows) {
          await emitEvent(tx, 'receipt', row.id, 'ChequeDeposited', {
            receiptId: row.id,
            depositRef: input.depositRef ?? null,
            depositedAt: depositedAt.toISOString(),
          })
        }
        return { updated: rows.length, journalEntryId: posted.entryId, totalPaise }
      }),
    )
  }

  // =============================================================================================================
  // allocation
  // =============================================================================================================

  async createAllocations(input: CreateAllocationsIn): Promise<CreateAllocationsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const source = await this.loadAllocationSource(tx, input.sourceType, input.sourceId)
        const found = await loadInvoices(
          tx,
          input.lines.map((l) => l.invoiceId),
        )
        let requested = 0
        for (const line of input.lines) {
          const invoice = this.requireAllocatable(found, line.invoiceId, source.retailerId)
          const open = invoice.totalPaise - invoice.allocatedPaise
          if (line.amountPaise > open) {
            throw new ORPCError('CONFLICT', {
              message: `bill ${invoice.invoiceNo ?? invoice.id} owes ${String(open)} paise; ${String(line.amountPaise)} was offered`,
            })
          }
          requested += line.amountPaise
        }
        if (requested > source.freePaise) {
          throw new ORPCError('CONFLICT', {
            message: `only ${String(source.freePaise)} paise of this ${input.sourceType} is unallocated`,
          })
        }
        const written: Allocation[] = []
        for (const line of input.lines) {
          const [row] = await tx
            .insert(allocations)
            .values({
              id: line.id,
              tenantId: ctx.tenantId,
              invoiceId: line.invoiceId,
              receiptId: input.sourceType === 'receipt' ? input.sourceId : null,
              creditNoteId: input.sourceType === 'credit_note' ? input.sourceId : null,
              amountPaise: line.amountPaise,
              allocatedBy: ctx.actorId,
            })
            .returning()
          if (row) written.push(toAllocation(row))
        }
        const settled = await recomputeInvoiceStates(
          tx,
          input.lines.map((l) => l.invoiceId),
        )
        const outstanding = await this.refreshAndRead(tx, source.retailerId)
        await emitEvent(tx, 'retailer', source.retailerId, 'AllocationChanged', {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          invoiceIds: input.lines.map((l) => l.invoiceId),
        })
        return {
          items: written,
          invoices: settled,
          sourceUnallocatedPaise: source.freePaise - requested,
          outstanding,
        }
      }),
    )
  }

  /** How the desk fixes a mis-keyed split without reversing the money. Never touches the journal. */
  async removeAllocation(input: RemoveAllocationIn): Promise<RemoveAllocationOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [row] = await tx
          .select()
          .from(allocations)
          .where(and(eq(allocations.tenantId, ctx.tenantId), eq(allocations.id, input.id)))
          .limit(1)
        if (!row) {
          throw new ORPCError('NOT_FOUND', { message: `allocation ${input.id} not found` })
        }
        if (row.writeOffId) {
          throw new ORPCError('CONFLICT', {
            message: 'a write-off closes the bill; reverse the write-off instead of its allocation',
          })
        }
        if (row.receiptId) {
          const [receipt] = await tx
            .select({ status: receipts.status, retailerId: receipts.retailerId })
            .from(receipts)
            .where(and(eq(receipts.tenantId, ctx.tenantId), eq(receipts.id, row.receiptId)))
            .limit(1)
          if (receipt && receipt.status !== 'collected' && receipt.status !== 'deposited') {
            throw new ORPCError('CONFLICT', {
              message: `receipt ${row.receiptId} is ${receipt.status}; its allocations moved with it`,
            })
          }
        }
        const invoice = (await loadInvoices(tx, [row.invoiceId])).get(row.invoiceId)
        if (!invoice) {
          throw new ORPCError('NOT_FOUND', { message: `invoice ${row.invoiceId} not found` })
        }
        await tx
          .delete(allocations)
          .where(and(eq(allocations.tenantId, ctx.tenantId), eq(allocations.id, input.id)))
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          actorRole: ctx.actorRole,
          action: 'allocation.remove',
          entityType: 'allocation',
          entityId: input.id,
          before: {
            invoiceId: row.invoiceId,
            receiptId: row.receiptId,
            creditNoteId: row.creditNoteId,
            amountPaise: row.amountPaise,
            reason: input.reason,
          },
        })
        const settled = await recomputeInvoiceStates(tx, [row.invoiceId])
        const outstanding = await this.refreshAndRead(tx, invoice.retailerId)
        const column = row.receiptId ? 'receiptId' : 'creditNoteId'
        const sourceId = row.receiptId ?? row.creditNoteId ?? ''
        const source = await this.loadAllocationSource(
          tx,
          row.receiptId ? 'receipt' : 'credit_note',
          sourceId,
        ).catch(() => null)
        await emitEvent(tx, 'retailer', invoice.retailerId, 'AllocationChanged', {
          removed: input.id,
          [column]: sourceId,
        })
        return {
          removed: input.id,
          invoices: settled,
          sourceUnallocatedPaise: source?.freePaise ?? 0,
          outstanding,
        }
      }),
    )
  }

  // =============================================================================================================
  // reads
  // =============================================================================================================

  async getOutstanding(
    input: z.infer<typeof OutstandingGetInput>,
  ): Promise<z.infer<typeof OutstandingGetOutput>> {
    requireRole(DUES_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await this.requireRetailer(tx, input.retailerId)
      await this.assertRepServes(tx, input.retailerId)
      const asOf = businessDate().date
      const summary = await loadOutstanding(tx, input.retailerId, asOf)
      const bills = input.includeBills
        ? await loadOpenBills(tx, { retailerIds: [input.retailerId] })
        : []
      const open = bills.filter((b) => openPaiseOf(b) > 0)
      const newest = [...open].sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1))[0]
      return {
        ...summary,
        bills: open.map((bill) => toOpenBill(bill, asOf)),
        upiQrPayload: newest?.upiQrPayload ?? null,
      }
    })
  }

  /**
   * The collections register, grouped and totalled by mode (coordination §3.1: added by reporting (9)).
   * Transaction-scoped, so reporting composes it inside its own read — `collections-register.ts`.
   */
  collectionsRegister(
    tx: Db,
    filter: CollectionsRegisterFilter,
  ): Promise<CollectionsRegisterRow[]> {
    return collectionsRegister(tx, filter)
  }

  /**
   * The tenant's dues register as a transaction-scoped read (coordination §3.1: `outstandingList(tx,
   * filter)` by reporting (9)). The same function `receivables.outstanding.list` answers with — the
   * ageing arithmetic exists once — so reporting's CSV export and the owner's `<AgeingBuckets>` tile
   * can never disagree with the screen.
   */
  outstandingList(
    tx: Db,
    filter: z.infer<typeof OutstandingListInput>,
  ): Promise<z.infer<typeof OutstandingListOutput>> {
    return listOutstanding(tx, filter)
  }

  /**
   * The ageing history from `ageing_snapshots` (docs/23 §8.1), transaction-scoped: reporting's
   * `series.ageing` re-shapes these snapshots and NEVER re-ages a bill.
   */
  ageingHistoryFor(
    tx: Db,
    input: z.infer<typeof AgeingHistoryInput>,
  ): Promise<z.infer<typeof AgeingHistoryOutput>> {
    return ageingHistory(tx, input)
  }

  /** The tenant register is the desk's alone: the crew needs one shop at a time (docs/23 §5.3). */
  async listOutstanding(
    input: z.infer<typeof OutstandingListInput>,
  ): Promise<z.infer<typeof OutstandingListOutput>> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => listOutstanding(tx, input))
  }

  async creditCheck(input: z.infer<typeof CreditCheckInput>): Promise<CreditVerdict> {
    requireRole(CREDIT_CHECKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await this.assertRepServes(tx, input.retailerId)
      return checkCredit(tx, input.retailerId, input.orderTotalPaise)
    })
  }

  /**
   * The outstanding trend and the ageing history for the owner's charts (docs/23 §8.1), from the
   * nightly `ageing_snapshots`; never a live scan. Back office only: it is the tenant register over time.
   */
  async ageingHistory(
    input: z.infer<typeof AgeingHistoryInput>,
  ): Promise<z.infer<typeof AgeingHistoryOutput>> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => ageingHistory(tx, input))
  }

  async getLedger(
    input: z.infer<typeof RetailerLedgerInput>,
  ): Promise<z.infer<typeof RetailerLedgerOutput>> {
    requireRole(DUES_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await this.requireRetailer(tx, input.retailerId)
      await this.assertRepServes(tx, input.retailerId)
      const to = input.to ?? businessDate().date
      const from = input.from ?? shiftDate(to, -90)
      const earliest = shiftDate(to, -MAX_LEDGER_WINDOW_DAYS)
      // A shop cannot read `journal_lines` at all after migration 0006, so it gets the identical shape
      // rebuilt from its own documents; both paths close on the same balance (a spec asserts it).
      return retailerLedger(
        tx,
        { ...input, from: from < earliest ? earliest : from, to },
        ctx.actorRole !== 'retailer',
      )
    })
  }

  async listCashDiscounts(
    input: z.infer<typeof CashDiscountsListInput>,
  ): Promise<z.infer<typeof CashDiscountsListOutput>> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => listCashDiscounts(tx, input))
  }

  async listAccounts(
    input: z.infer<typeof AccountsListInput>,
  ): Promise<z.infer<typeof AccountsListOutput>> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => listAccounts(tx, input))
  }

  async listJournal(
    input: z.infer<typeof JournalListInput>,
  ): Promise<z.infer<typeof JournalListOutput>> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => listJournal(tx, input))
  }

  // =============================================================================================================
  // the shop's own online payment (docs/17 §D4)
  // =============================================================================================================

  /**
   * The retailer app's "pay my bills" button. It deliberately creates NO receipt and NO journal row: a shop
   * must never credit its own AR, and `receipts` is staff-write at the database. What it returns is the UPI
   * intent for the shop's own dues plus a reference the desk matches the UTR against; the desk (or, later, a
   * gateway callback running as `system`) records the receipt.
   *
   * The shop is taken from the actor's own link, never from the input, so it cannot name another shop.
   * The payee is the distributor's configured UPI id and display name from `sellerBranding` (tenancy),
   * and the intent is built HERE for this payment: the amount the shop chose, with its own `paymentRef`
   * in `tr` and in the note. A bill's `upi_qr_payload` is that bill's issue-time snapshot (its original
   * total, its invoice number) and is never reused as a payment intent (DOS-094).
   */
  async initiatePayment(input: InitiateIn): Promise<InitiateOut> {
    requireRole(SHOPKEEPER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [link] = await tx
          .select({ retailerId: retailerLinks.retailerId })
          .from(retailerLinks)
          .where(
            and(
              eq(retailerLinks.tenantId, ctx.tenantId),
              eq(retailerLinks.userId, ctx.actorId),
              eq(retailerLinks.status, 'active'),
            ),
          )
          .orderBy(asc(retailerLinks.id))
          .limit(1)
        if (!link) {
          throw new ORPCError('NOT_FOUND', {
            message: 'this sign-in is not linked to a shop of this distributor',
          })
        }
        const retailerId = link.retailerId
        const asOf = businessDate().date
        const all = (await loadOpenBills(tx, { retailerIds: [retailerId] })).filter(
          (b) => openPaiseOf(b) > 0,
        )
        const chosen =
          input.invoiceIds && input.invoiceIds.length > 0
            ? all.filter((b) => input.invoiceIds?.includes(b.id))
            : all
        const due = chosen.reduce((s, b) => s + openPaiseOf(b), 0)
        const amountPaise = input.amountPaise ?? due
        if (amountPaise <= 0) {
          throw new ORPCError('CONFLICT', { message: 'there is nothing outstanding to pay' })
        }
        const paymentRef = `PAY-${input.id.slice(-12)}`
        const seller = await sellerBranding(tx)
        const upi = upiIntent({
          vpa: seller.upiVpa,
          payeeName: seller.displayName,
          amountPaise,
          reference: paymentRef,
          note: paymentRef,
        })
        await emitEvent(tx, 'retailer', retailerId, 'PaymentIntentCreated', {
          intentId: input.id,
          retailerId,
          amountPaise,
          paymentRef,
          invoiceIds: chosen.map((b) => b.id),
          note: input.note ?? null,
        })
        return {
          intentId: input.id,
          retailerId,
          amountPaise,
          upiQrPayload: upi,
          upiIntentUrl: upi,
          payeeVpa: seller.upiVpa,
          payeeName: seller.displayName,
          paymentRef,
          expiresAt: new Date(Date.now() + PAYMENT_INTENT_MINUTES * 60_000).toISOString(),
          bills: chosen.map((bill) => toOpenBill(bill, asOf)),
        }
      }),
    )
  }

  // =============================================================================================================
  // statements, write-offs, ageing
  // =============================================================================================================

  /**
   * Long work never runs on the request path (scale rule 3): one `outbox_events` row per statement is
   * written inside the transaction and the worker renders and sends them.
   */
  async sendStatements(input: StatementsIn): Promise<StatementsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const ids = input.retailerIds?.length
          ? input.retailerIds
          : (
              await tx
                .select({ id: retailers.id })
                .from(retailers)
                .where(
                  and(
                    eq(retailers.tenantId, ctx.tenantId),
                    eq(retailers.active, true),
                    input.beatId ? eq(retailers.beatId, input.beatId) : undefined,
                  ),
                )
                .orderBy(asc(retailers.id))
                .limit(200)
            ).map((r) => r.id)
        const wanted = input.overdueOnly
          ? (await Promise.all(ids.map(async (id) => ({ id, out: await loadOutstanding(tx, id) }))))
              .filter((r) => r.out.overduePaise > 0)
              .map((r) => r.id)
          : ids
        for (const retailerId of wanted) {
          await emitEvent(tx, 'retailer', retailerId, 'StatementRequested', {
            jobId: input.id,
            retailerId,
            from: input.from,
            to: input.to,
            channel: input.channel,
            includeUpiQr: input.includeUpiQr,
          })
        }
        return { jobId: input.id, queued: wanted.length }
      }),
    )
  }

  /** Owner only, no rupee limit (docs/plans/00-coordination.md §7 q12). Never a credit note: a write-off is
   * a financial entry, DR Bad debts / CR AR, plus the `allocations` row that closes the bill. */
  async createWriteOff(input: WriteOffIn): Promise<WriteOffOut> {
    requireRole(MONEY_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const invoice = (await loadInvoices(tx, [input.invoiceId])).get(input.invoiceId)
        if (!invoice) {
          throw new ORPCError('NOT_FOUND', { message: `invoice ${input.invoiceId} not found` })
        }
        if (invoice.state !== 'issued' && invoice.state !== 'partially_paid') {
          throw new ORPCError('CONFLICT', {
            message: `bill ${invoice.invoiceNo ?? invoice.id} is ${invoice.state}; only an open bill can be written off`,
          })
        }
        const open = invoice.totalPaise - invoice.allocatedPaise
        if (input.amountPaise > open) {
          throw new ORPCError('CONFLICT', {
            message: `bill ${invoice.invoiceNo ?? invoice.id} owes ${String(open)} paise; ${String(input.amountPaise)} was offered`,
          })
        }
        // The id is the client's. A second write-off under an id that already exists (a different
        // idempotency key, so not a replay) is a 409, never the primary-key violation the insert
        // below would otherwise surface as a 500.
        const [clash] = await tx
          .select({ id: writeOffs.id })
          .from(writeOffs)
          .where(and(eq(writeOffs.tenantId, ctx.tenantId), eq(writeOffs.id, input.id)))
          .limit(1)
        if (clash) {
          throw new ORPCError('CONFLICT', { message: `write-off ${input.id} already exists` })
        }
        const [row] = await tx
          .insert(writeOffs)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            invoiceId: input.invoiceId,
            retailerId: invoice.retailerId,
            amountPaise: input.amountPaise,
            reason: input.reason,
            note: input.note ?? null,
            approvedBy: ctx.actorId,
            idempotencyKey: input.idempotencyKey,
          })
          .returning()
        if (!row) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'write-off insert returned nothing',
          })
        }
        await tx.insert(allocations).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          invoiceId: input.invoiceId,
          writeOffId: input.id,
          amountPaise: input.amountPaise,
          allocatedBy: ctx.actorId,
        })
        const posted = await postJournalEntry(tx, {
          entryDate: businessDate().date,
          refType: 'writeoff',
          refId: input.id,
          narration: input.note ?? `write-off (${input.reason})`,
          idempotencyKey: `journal:writeoff:${input.id}`,
          lines: [
            { accountCode: 'BAD_DEBTS', amountPaise: input.amountPaise },
            {
              accountCode: 'AR',
              amountPaise: -input.amountPaise,
              partyType: 'retailer',
              partyId: invoice.retailerId,
            },
          ],
        })
        const [stamped] = await tx
          .update(writeOffs)
          .set({ journalEntryId: posted.entryId, updatedAt: new Date() })
          .where(and(eq(writeOffs.tenantId, ctx.tenantId), eq(writeOffs.id, input.id)))
          .returning()
        let settled: SettledInvoice
        if (input.amountPaise === open) {
          await markWrittenOff(tx, input.invoiceId, invoice.state)
          settled = {
            id: invoice.id,
            invoiceNo: invoice.invoiceNo,
            state: 'written_off',
            openPaise: 0,
          }
        } else {
          const [recomputed] = await recomputeInvoiceStates(tx, [input.invoiceId])
          settled = recomputed ?? {
            id: invoice.id,
            invoiceNo: invoice.invoiceNo,
            state: 'partially_paid',
            openPaise: open - input.amountPaise,
          }
        }
        const outstanding = await this.refreshAndRead(tx, invoice.retailerId)
        await emitEvent(tx, 'invoice', input.invoiceId, 'InvoiceWrittenOff', {
          invoiceId: input.invoiceId,
          writeOffId: input.id,
          amountPaise: input.amountPaise,
        })
        return { item: toWriteOff(stamped ?? row), invoice: settled, outstanding }
      }),
    )
  }

  /** The same code path the nightly worker job runs, exposed so the owner can force a refresh. */
  async rebuildAgeing(input: RebuildIn): Promise<RebuildOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const asOf = input.asOf ?? businessDate().date
        let cursor: string | null = null
        let count = 0
        let outstandingPaise = 0
        let overduePaise = 0
        for (;;) {
          const ids: string[] = input.retailerId
            ? cursor === null
              ? [input.retailerId]
              : []
            : await retailerIdPage(tx, cursor, AGEING_BATCH)
          if (ids.length === 0) break
          const rows = await refreshOutstandingFor(tx, ids, asOf)
          await writeAgeingSnapshot(tx, asOf, [...rows.values()])
          for (const row of rows.values()) {
            count += 1
            outstandingPaise += row.outstandingPaise ?? 0
            overduePaise += row.overduePaise ?? 0
          }
          cursor = ids[ids.length - 1] ?? null
          if (input.retailerId || ids.length < AGEING_BATCH) break
        }
        return { asOf, retailers: count, outstandingPaise, overduePaise }
      }),
    )
  }

  // =============================================================================================================
  // internals
  // =============================================================================================================

  /** A shop the caller may see. RLS narrows a retailer actor to its own, so this is also the 404 guard. */
  private async requireRetailer(tx: Db, retailerId: string): Promise<{ id: string }> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ id: retailers.id })
      .from(retailers)
      .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, retailerId)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `retailer ${retailerId} not found` })
    return row
  }

  /**
   * A salesperson sees the dues of the shops it SERVES — the shops on a beat currently assigned to it —
   * and nobody else's (docs/23 §8.1 "for its own shops"). RLS lets a staff role read every summary row,
   * so this is the handler's rule; a shop off the rep's beats is a 403 with the reason.
   */
  private async assertRepServes(tx: Db, retailerId: string): Promise<void> {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'salesperson') return
    const today = businessDate().date
    const [row] = await tx
      .select({ id: retailers.id })
      .from(retailers)
      .innerJoin(
        beatAssignments,
        and(
          eq(beatAssignments.tenantId, retailers.tenantId),
          eq(beatAssignments.beatId, retailers.beatId),
          eq(beatAssignments.userId, ctx.actorId),
        ),
      )
      .where(
        and(
          eq(retailers.tenantId, ctx.tenantId),
          eq(retailers.id, retailerId),
          sql`${beatAssignments.validFrom} <= ${today}`,
          sql`(${beatAssignments.validTo} is null or ${beatAssignments.validTo} >= ${today})`,
        ),
      )
      .limit(1)
    if (!row)
      throw new ORPCError('FORBIDDEN', {
        message: 'a salesperson sees the dues of the shops on its own beats only',
      })
  }

  /** The receipt this call already produced, by its own id or by the crew's paper book number. */
  private async findExistingReceipt(tx: Db, input: RecordReceiptInput): Promise<ReceiptRow | null> {
    const { tenantId } = currentTenant()
    const [byId] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, input.id)))
      .limit(1)
    if (byId) return byId
    if (!input.deviceId || !input.clientReceiptNo) return null
    const [byDevice] = await tx
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.tenantId, tenantId),
          eq(receipts.deviceId, input.deviceId),
          eq(receipts.clientReceiptNo, input.clientReceiptNo),
        ),
      )
      .limit(1)
    return byDevice ?? null
  }

  private async receiptReply(
    tx: Db,
    row: ReceiptRow,
    retailerId: string,
  ): Promise<RecordReceiptResult> {
    const { tenantId } = currentTenant()
    const rows = await tx
      .select()
      .from(allocations)
      .where(and(eq(allocations.tenantId, tenantId), eq(allocations.receiptId, row.id)))
      .orderBy(asc(allocations.id))
    const settled = await recomputeInvoiceStates(
      tx,
      rows.map((a) => a.invoiceId),
    )
    const allocated = rows.reduce((s, a) => s + a.amountPaise, 0)
    const item = toReceipt(row, allocated)
    return {
      item,
      allocations: rows.map(toAllocation),
      invoices: settled,
      cashDiscountPaise: row.cashDiscountPaise,
      unallocatedPaise: item.unallocatedPaise,
      outstanding: await loadOutstanding(tx, retailerId),
    }
  }

  /** Deterministic so a replay of the same receipt against the same bill cannot write a second row. */
  private allocationIdFor(input: RecordReceiptInput, invoiceId: string): string {
    const explicit = input.allocations?.find((a) => a.invoiceId === invoiceId)
    return explicit?.id ?? uuidv7()
  }

  private async planAllocations(
    tx: Db,
    input: RecordReceiptInput,
    paidOn: string,
  ): Promise<PlannedAllocation[]> {
    const strategy = input.strategy ?? 'fifo'
    if (strategy === 'none') return []
    if (strategy === 'explicit') {
      const lines = input.allocations ?? []
      const found = await loadInvoices(
        tx,
        lines.map((l) => l.invoiceId),
      )
      for (const line of lines) this.requireAllocatable(found, line.invoiceId, input.retailerId)
      const total = lines.reduce((s, l) => s + l.amountPaise, 0)
      if (total > input.amountPaise) {
        throw new ORPCError('CONFLICT', {
          message: `the split comes to ${String(total)} paise but the receipt is ${String(input.amountPaise)}`,
        })
      }
      const conditions = await openConditions(
        tx,
        lines.map((l) => l.invoiceId),
      )
      return planExplicit(lines, found, conditions, paidOn)
    }
    const bills = (await loadOpenBills(tx, { retailerIds: [input.retailerId] })).filter(
      (b) => openPaiseOf(b) > 0,
    )
    const conditions = await openConditions(
      tx,
      bills.map((b) => b.id),
    )
    return planFifo(bills, input.amountPaise, conditions, paidOn)
  }

  private requireAllocatable(
    found: Map<string, InvoiceForAllocation>,
    invoiceId: string,
    retailerId: string,
  ): InvoiceForAllocation {
    const invoice = found.get(invoiceId)
    if (!invoice) throw new ORPCError('NOT_FOUND', { message: `invoice ${invoiceId} not found` })
    if (invoice.retailerId !== retailerId) {
      throw new ORPCError('CONFLICT', {
        message: `bill ${invoice.invoiceNo ?? invoice.id} belongs to another shop`,
      })
    }
    if (invoice.state !== 'issued' && invoice.state !== 'partially_paid') {
      throw new ORPCError('CONFLICT', {
        message: `bill ${invoice.invoiceNo ?? invoice.id} is ${invoice.state}; only an open bill takes money`,
      })
    }
    return invoice
  }

  private async loadAllocationSource(
    tx: Db,
    sourceType: 'receipt' | 'credit_note',
    sourceId: string,
  ): Promise<{ retailerId: string; freePaise: number }> {
    const { tenantId } = currentTenant()
    if (sourceType === 'receipt') {
      const [row] = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, sourceId)))
        .limit(1)
      if (!row) throw new ORPCError('NOT_FOUND', { message: `receipt ${sourceId} not found` })
      if (row.status === 'bounced' || row.status === 'cancelled') {
        throw new ORPCError('CONFLICT', {
          message: `receipt ${row.receiptNo ?? row.id} is ${row.status}; its money is gone`,
        })
      }
      const allocated = (await allocatedAgainst(tx, 'receiptId', [sourceId])).get(sourceId) ?? 0
      return {
        retailerId: row.retailerId,
        freePaise: row.amountPaise + row.cashDiscountPaise - allocated,
      }
    }
    const [note] = await tx
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, sourceId)))
      .limit(1)
    if (!note) throw new ORPCError('NOT_FOUND', { message: `credit note ${sourceId} not found` })
    if (note.state !== 'issued' && note.state !== 'applied') {
      throw new ORPCError('CONFLICT', {
        message: `credit note ${note.creditNoteNo ?? note.id} is ${note.state}`,
      })
    }
    const allocated = (await allocatedAgainst(tx, 'creditNoteId', [sourceId])).get(sourceId) ?? 0
    return { retailerId: note.retailerId, freePaise: note.totalPaise - allocated }
  }

  /**
   * Reversing and bouncing are the same movement: a mirror receipt with a negative amount, mirror
   * allocations, the cash-discount offer handed back, and one entry that puts AR back to exactly where it
   * was — the realised discount included. A bounce adds the bank's charge and marks the cheque returned.
   */
  private async undoReceipt(
    tx: Db,
    input: {
      originalId: string
      reversalId: string
      idempotencyKey: string
      reason: string
      at: Date
      kind: 'reverse' | 'bounce'
      bankChargesPaise: number
    },
  ): Promise<ReverseOut> {
    const { tenantId, actorId } = currentTenant()
    const [original] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, input.originalId)))
      .limit(1)
    if (!original) {
      throw new ORPCError('NOT_FOUND', { message: `receipt ${input.originalId} not found` })
    }
    if (input.kind === 'bounce' && original.mode !== 'cheque') {
      throw new ORPCError('CONFLICT', {
        message: `receipt ${original.receiptNo ?? original.id} is ${original.mode}; only a cheque bounces`,
      })
    }
    if (original.status !== 'collected' && original.status !== 'deposited') {
      throw new ORPCError('CONFLICT', {
        message: `receipt ${original.receiptNo ?? original.id} is already ${original.status}`,
      })
    }
    const today = businessDate(input.at).date
    const mirrored = await tx
      .select()
      .from(allocations)
      .where(and(eq(allocations.tenantId, tenantId), eq(allocations.receiptId, original.id)))
      .orderBy(asc(allocations.id))
    const receiptNo = await nextDocumentNumber(tx, 'RCPT', input.at)
    await tx.insert(receipts).values({
      id: input.reversalId,
      tenantId,
      receiptNo,
      retailerId: original.retailerId,
      mode: original.mode,
      amountPaise: -original.amountPaise,
      receivedAt: input.at,
      receivedBy: actorId,
      tripId: original.tripId,
      reference: original.reference,
      cashDiscountPaise: -original.cashDiscountPaise,
      status: 'cancelled',
      note: input.reason,
      reversesReceiptId: original.id,
      idempotencyKey: `${input.idempotencyKey}:reversal`,
    })
    for (const row of mirrored) {
      await tx.insert(allocations).values({
        id: uuidv7(),
        tenantId,
        invoiceId: row.invoiceId,
        receiptId: input.reversalId,
        amountPaise: -row.amountPaise,
        allocatedBy: actorId,
      })
    }
    await releaseConditionsOf(tx, original.id, today)

    // Where the money had landed: a banked cheque or cash credits the bank, not the tin it came out of.
    const sourceCode = original.depositedAt
      ? 'BANK'
      : receiptAccountCode(original.mode as ReceiptMode, original.tripId)
    const lines: JournalEntryInput['lines'] = [
      { accountCode: sourceCode, amountPaise: -original.amountPaise },
      { accountCode: 'CASH_DISCOUNT', amountPaise: -original.cashDiscountPaise },
      {
        accountCode: 'AR',
        amountPaise: original.amountPaise + original.cashDiscountPaise,
        partyType: 'retailer',
        partyId: original.retailerId,
      },
    ]
    if (input.bankChargesPaise > 0) {
      lines.push({ accountCode: 'BANK_CHARGES', amountPaise: input.bankChargesPaise })
      lines.push({ accountCode: 'BANK', amountPaise: -input.bankChargesPaise })
    }
    const posted = await postJournalEntry(tx, {
      entryDate: today,
      refType: 'receipt_reversal',
      refId: input.reversalId,
      narration: input.reason,
      idempotencyKey: `journal:receipt_reversal:${input.reversalId}`,
      lines,
    })
    const originalEntry = await findEntryByRef(tx, 'receipt', original.id)
    if (originalEntry) await stampReversed(tx, originalEntry, posted.entryId)

    await tx
      .update(receipts)
      .set(
        input.kind === 'bounce'
          ? {
              status: 'bounced',
              bouncedAt: input.at,
              bounceReason: input.reason,
              bankChargesPaise: input.bankChargesPaise,
              updatedAt: new Date(),
            }
          : { status: 'cancelled', updatedAt: new Date() },
      )
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, original.id)))

    const settled = await recomputeInvoiceStates(
      tx,
      mirrored.map((a) => a.invoiceId),
    )
    const outstanding = await this.refreshAndRead(tx, original.retailerId)
    await emitEvent(
      tx,
      'receipt',
      original.id,
      input.kind === 'bounce' ? 'ChequeBounced' : 'ReceiptReversed',
      {
        receiptId: original.id,
        reversalId: input.reversalId,
        reason: input.reason,
        bankChargesPaise: input.bankChargesPaise,
      },
    )
    const reversalRow = await receiptWithAllocations(tx, input.reversalId)
    const originalRow = await receiptWithAllocations(tx, original.id)
    if (!reversalRow || !originalRow) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'reversal vanished after insert' })
    }
    return {
      item: toReceipt(reversalRow.row, reversalRow.allocatedPaise),
      original: toReceipt(originalRow.row, originalRow.allocatedPaise),
      invoices: settled,
      outstanding,
    }
  }

  private async refreshAndRead(tx: Db, retailerId: string): Promise<RetailerOutstanding> {
    await refreshOutstandingFor(tx, [retailerId])
    return loadOutstanding(tx, retailerId)
  }
}
