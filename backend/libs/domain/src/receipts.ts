/**
 * What the money desk may do with a receipt: carry it to the bank, or take it back as a bounced cheque.
 * The rules `ReceivablesService.depositReceipts` and its bounce path enforce, stated once so the manager
 * app's Day-end and Receipts screens offer exactly the actions the server accepts. Pure and
 * dependency-free, like `piecesLeftToCredit()`.
 *
 * `mode` and `status` are plain strings because this library cannot import the contracts, and because a
 * row written before `ReceiptModeSchema` narrowed (a legacy `credit_note` mode) still reaches a screen.
 * Nothing here reads `tripId`: whether a trip's money has been handed over is a server fact, not a rule a
 * screen can compute (DOS-132) — `receipts.get` answers `withCrew`, `receipts.list` takes `withCrew=false`,
 * and `receipts.deposit` refuses a receipt from a trip that is not settled with 409 `trip_cash_not_settled`.
 */

/** Cash and cheques are the only money a desk carries to the bank; UPI and bank transfers are already there. */
export function isBankableReceiptMode(mode: string): boolean {
  return mode === 'cash' || mode === 'cheque'
}

/** A deposit batch takes a receipt only while it is still `collected` and is cash or a cheque. */
export function receiptMayBeDeposited(receipt: {
  readonly mode: string
  readonly status: string
}): boolean {
  return receipt.status === 'collected' && isBankableReceiptMode(receipt.mode)
}

/**
 * UPI money is not carried to the bank: it is CONFIRMED at Day-end against the bank or the UPI app (DOS-256,
 * architect ruling 2026-09-28). The movement in the book is the one a deposit makes — UPI clearing → Bank —
 * and the receipt then reads `deposited` like banked cash, so "Banked" counts it. Nothing confirms itself.
 */
export function isConfirmableReceiptMode(mode: string): boolean {
  return mode === 'upi'
}

/** A UPI receipt still `collected` is waiting for the desk to confirm it at Day-end. */
export function receiptMayBeConfirmed(receipt: {
  readonly mode: string
  readonly status: string
}): boolean {
  return receipt.status === 'collected' && isConfirmableReceiptMode(receipt.mode)
}

/**
 * What a payment reference is compared as (DOS-310): trimmed, every inner space removed, upper case. " utr 1790
 * 5645 " and "UTR17905645" are the same transfer. The database compares with `dos_normalise_reference()`
 * (migration 0079), which does the same.
 */
export function normaliseReference(reference: string): string {
  return reference.replace(/\s+/g, '').toUpperCase()
}

/**
 * The word a bill's payment state is shown with (DOS-320). A bill the money closed reads `paid`; one closed by
 * credit notes alone — refused at the door and credited, never paid — reads `closed_by_credit_note` ("Credited"
 * on screen; a key of its own, because a goods receipt already has a `credited`); one closed by both reads `paid`,
 * with the credited amount beside it. Derived from what closed it, never a state of the invoice machine.
 * `paidPaise` and `creditedPaise` are the bill's receipt and credit-note allocations (`invoices.list/get`).
 */
export function invoiceStateShown(invoice: {
  readonly state: string
  readonly paidPaise?: number | null | undefined
  readonly creditedPaise?: number | null | undefined
}): string {
  const paid = invoice.paidPaise ?? null
  const credited = invoice.creditedPaise ?? 0
  if (invoice.state === 'paid' && paid !== null && paid <= 0 && credited > 0)
    return 'closed_by_credit_note'
  return invoice.state
}

/** Only a cheque bounces, and only while it is in hand (`collected`) or banked (`deposited`). */
export function receiptMayBounce(receipt: {
  readonly mode: string
  readonly status: string
}): boolean {
  return (
    receipt.mode === 'cheque' && (receipt.status === 'collected' || receipt.status === 'deposited')
  )
}
