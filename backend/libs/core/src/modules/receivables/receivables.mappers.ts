import type {
  Account,
  Allocation,
  JournalEntry,
  JournalLine,
  Receipt,
  ReceiptMode,
  WriteOff,
  WriteOffReason,
} from '@dos/contracts'
import type { accounts, allocations, journalEntries, receipts, writeOffs } from '@dos/db'

/** Drizzle rows in, contract shapes out (docs/16 §2): no Drizzle row ever leaves the module. */

export type ReceiptRow = typeof receipts.$inferSelect
export type AllocationRow = typeof allocations.$inferSelect
export type WriteOffRow = typeof writeOffs.$inferSelect
export type AccountRow = typeof accounts.$inferSelect
export type JournalEntryRow = typeof journalEntries.$inferSelect

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/**
 * The database enum still carries `credit_note`, which was never a way to take money: a credit note reaches
 * an invoice through `allocations.create`. Nothing writes it, and if an old row ever holds it we report the
 * neutral `adjustment` rather than failing the whole list on output validation.
 */
function toMode(mode: ReceiptRow['mode']): ReceiptMode {
  return mode === 'credit_note' ? 'adjustment' : mode
}

/**
 * `allocatedPaise` is the CASH of this receipt that sits against bills. A realised cash discount is also an
 * `allocations` row (it closes the bill), so the money the shop actually handed over is
 * `Σ allocations − cashDiscountPaise`, and what is left on account is `amountPaise − that`.
 */
export function toReceipt(row: ReceiptRow, allocatedPaise: number): Receipt {
  const applied = allocatedPaise - row.cashDiscountPaise
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    retailerId: row.retailerId,
    mode: toMode(row.mode),
    amountPaise: row.amountPaise,
    allocatedPaise: applied,
    unallocatedPaise: row.amountPaise - applied,
    cashDiscountPaise: row.cashDiscountPaise,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    receivedBy: row.receivedBy,
    tripId: row.tripId,
    reference: row.reference,
    upiVpa: row.upiVpa,
    chequeDate: row.chequeDate,
    bankName: row.bankName,
    deviceId: row.deviceId,
    clientReceiptNo: row.clientReceiptNo,
    reversesReceiptId: row.reversesReceiptId,
    depositedAt: iso(row.depositedAt),
    depositRef: row.depositRef,
    depositAccountId: row.depositAccountId,
    bouncedAt: iso(row.bouncedAt),
    bounceReason: row.bounceReason,
    bankChargesPaise: row.bankChargesPaise,
    proofObjectKey: row.proofObjectKey,
    pdfObjectKey: row.pdfObjectKey,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toAllocation(row: AllocationRow): Allocation {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    receiptId: row.receiptId,
    creditNoteId: row.creditNoteId,
    writeOffId: row.writeOffId,
    amountPaise: row.amountPaise,
    allocatedAt: row.allocatedAt.toISOString(),
    allocatedBy: row.allocatedBy,
  }
}

export function toWriteOff(row: WriteOffRow): WriteOff {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    retailerId: row.retailerId,
    amountPaise: row.amountPaise,
    reason: row.reason as WriteOffReason,
    note: row.note,
    approvedBy: row.approvedBy,
    journalEntryId: row.journalEntryId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toAccount(row: AccountRow, balancePaise: number): Account {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    tallyLedgerName: row.tallyLedgerName,
    active: row.active,
    balancePaise,
  }
}

export function toJournalEntry(row: JournalEntryRow, lines: JournalLine[]): JournalEntry {
  return {
    id: row.id,
    entryDate: row.entryDate,
    refType: row.refType,
    refId: row.refId,
    narration: row.narration,
    postedBy: row.postedBy,
    postedAt: row.postedAt.toISOString(),
    reversedByEntryId: row.reversedByEntryId,
    lines,
  }
}
