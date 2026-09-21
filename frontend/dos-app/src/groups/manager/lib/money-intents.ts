/**
 * Banking a receipt, returning a bounced cheque, drafting a credit note and approving a supplier bill,
 * as REQUESTS REBUILT FROM A SNAPSHOT (QA DOS-136) — the trip-plan pattern (DOS-131) applied to money.
 *
 * `useMutation` keys the idempotency key on its INPUT: the same payload keeps the key, a different one
 * starts a new intent. The service refuses a key sent again with a different body (409 "idempotencyKey
 * was already used with a different request"). So every client-made value in a request — the instant a
 * deposit was banked, the instant a cheque came back, a credit-note line's id — has to be made ONCE for
 * the intent and handed to the mutation, never made inside the call. Made inside, a retry after a lost
 * reply carries a new timestamp under the spent key and is refused, while the money is already banked.
 */
import { uuidv7 } from '@dos/domain'

/** What `useMutation` hands a write: the intent's client id and its idempotency key. */
export interface IntentMeta {
  readonly id: string
  readonly idempotencyKey: string
}

// ---------------------------------------------------------------------------
// Banking receipts
// ---------------------------------------------------------------------------

/** One press of "Bank it": which receipts, when they were banked, and the slip number typed. */
export interface DepositIntent {
  readonly receiptIds: readonly string[]
  readonly depositedAt: string
  readonly depositRef: string
}

/** The body `receivables.receipts.deposit` is sent. */
export interface DepositBody {
  id: string
  idempotencyKey: string
  receiptIds: string[]
  depositedAt: string
  depositRef?: string
}

export function depositIntent(
  receiptIds: readonly string[],
  depositRef: string,
  at: Date,
): DepositIntent {
  return Object.freeze({
    receiptIds: Object.freeze([...receiptIds]),
    depositedAt: at.toISOString(),
    depositRef,
  })
}

export function depositBody(intent: DepositIntent, meta: IntentMeta): DepositBody {
  return {
    id: meta.id,
    idempotencyKey: meta.idempotencyKey,
    receiptIds: [...intent.receiptIds],
    depositedAt: intent.depositedAt,
    ...(intent.depositRef === '' ? {} : { depositRef: intent.depositRef }),
  }
}

// ---------------------------------------------------------------------------
// A cheque the bank returned
// ---------------------------------------------------------------------------

export interface BounceIntent {
  readonly receiptId: string
  readonly bouncedAt: string
  readonly reason: string
  readonly chargesPaise: number | null
}

/** The body `receivables.receipts.bounce` is sent; `id` is the receipt, `reversalId` the new one. */
export interface BounceBody {
  id: string
  reversalId: string
  idempotencyKey: string
  bouncedAt: string
  reason: string
  bankChargesPaise?: number
}

export function bounceIntent(
  receiptId: string,
  reason: string,
  chargesPaise: number | null,
  at: Date,
): BounceIntent {
  return Object.freeze({ receiptId, bouncedAt: at.toISOString(), reason, chargesPaise })
}

export function bounceBody(intent: BounceIntent, meta: IntentMeta): BounceBody {
  return {
    id: intent.receiptId,
    reversalId: meta.id,
    idempotencyKey: meta.idempotencyKey,
    bouncedAt: intent.bouncedAt,
    reason: intent.reason,
    ...(intent.chargesPaise === null ? {} : { bankChargesPaise: intent.chargesPaise }),
  }
}

// ---------------------------------------------------------------------------
// Client-made row ids
// ---------------------------------------------------------------------------

/**
 * The id this surface has already made for each row, and a new one for each row it has not seen.
 *
 * A credit note's lines and a supplier bill's approved lines carry client-generated UUIDv7s. Made inside
 * the mutation they are new on every press, so a retry is a different request under the same key.
 */
export function keepIds(
  held: Readonly<Record<string, string>>,
  keys: readonly string[],
  make: () => string = uuidv7,
): Record<string, string> {
  const ids: Record<string, string> = {}
  for (const key of keys) ids[key] = held[key] ?? make()
  return ids
}

// ---------------------------------------------------------------------------
// A write whose outcome nobody knows
// ---------------------------------------------------------------------------

/**
 * True when a refused write MAY still have been saved (DOS-136).
 *
 * A 400 or a 409 is an answer: the service read the request and refused it, and the screen in front of
 * the reader is still true. A dropped reply and a 500 are not: the request may have committed on its
 * way to a reply that never arrived, so the panel behind the dialog is no longer known to be right and
 * the record is read back before the reader acts on it again.
 */
export function outcomeUnknown(error: { readonly kind?: string } | null | undefined): boolean {
  return error?.kind === 'network' || error?.kind === 'server'
}

// ---------------------------------------------------------------------------
// What a bounce dialog will not send
// ---------------------------------------------------------------------------

/**
 * Why "Mark bounced" may not be sent yet, or `null` (DOS-141).
 *
 * `receipts.bounce` requires a reason (`z.string().trim().min(1)`), and the dialog sent an empty one:
 * the desk pressed a live button and read "Input validation failed", which names no field and no fix.
 * The dialog asks for the bank's own words in the field itself instead, and sends nothing until they
 * are there. The server's rule is unchanged — this is the same rule, said earlier.
 */
export type BounceProblem = 'needsReason'

export function bounceProblem(reason: string): BounceProblem | null {
  return reason.trim() === '' ? 'needsReason' : null
}
