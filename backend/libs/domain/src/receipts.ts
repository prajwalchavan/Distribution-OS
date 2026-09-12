/**
 * What the money desk may do with a receipt: carry it to the bank, or take it back as a bounced cheque.
 * The rules `ReceivablesService.depositReceipts` and its bounce path enforce, stated once so the manager
 * app's Day-end and Receipts screens offer exactly the actions the server accepts. Pure and
 * dependency-free, like `piecesLeftToCredit()`.
 *
 * `mode` and `status` are plain strings because this library cannot import the contracts, and because a
 * row written before `ReceiptModeSchema` narrowed (a legacy `credit_note` mode) still reaches a screen.
 * Nothing here reads `tripId`: the server's deposit does not either.
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

/** Only a cheque bounces, and only while it is in hand (`collected`) or banked (`deposited`). */
export function receiptMayBounce(receipt: {
  readonly mode: string
  readonly status: string
}): boolean {
  return (
    receipt.mode === 'cheque' && (receipt.status === 'collected' || receipt.status === 'deposited')
  )
}
