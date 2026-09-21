/**
 * S3 — what happened to THIS order (DOS-180).
 *
 * The banner after "Place order" used to pick its title and its body from `local.online` at render
 * time (new.tsx:387-388). That is a global fact standing in for a per-order one, and the two come
 * apart in the ordinary case: a rep places an order in a dead spot, reads the honest "Saved on this
 * phone", stays on the screen, and the signal returns — whereupon the same banner re-renders as
 * "Order placed — The office has it, with its number and its price" over an order the office still
 * holds as a DRAFT with no number. Nothing about the order changed; only the radio did.
 *
 * THE TRUTH HAS TWO SOURCES, AND NEITHER IS THE RADIO.
 *
 *   `queued`  — the mutation's own reply. `false` means `orders.create` AND `orders.submit` were both
 *               answered 200: the order is placed, numbered and credit-checked.
 *   `pending` — for a queued order, the row's own `_pending`, which the engine moves: `queued` →
 *               `sending` → NULL when the office accepts it, or `rejected` when it refuses.
 *
 * And "acked" is NOT "placed". The queued op writes `state: 'draft'` (queue.ts) — the only thing
 * `orders.sync.ts` accepts from a device — so what the office holds has no number until somebody
 * submits it from My orders. Saying "Order placed" there would be the same lie one step later.
 */
import { keepClaim } from '@dos/offline'

export interface OrderOutcomeInput {
  /** The mutation's own reply: false = `orders.create` + `orders.submit` were answered. */
  readonly queued: boolean
  /** The order row's `_pending` on this device; null once the office has answered (or was never queued). */
  readonly pending: 'queued' | 'sending' | 'rejected' | 'kept' | null | undefined
  /** The office's number, once a pull has brought it back. A draft has none. */
  readonly orderNo: string | null | undefined
  /** Whether this device keeps what it holds (DOS-179): chooses the words of the held state. */
  readonly persistent: boolean | null | undefined
  /**
   * Whether this device's copy of the row has been READ yet. `useRow` answers `{ row: null }` for a
   * tick before its query resolves, and a null `_pending` read there would say "Reached the office as
   * a draft" about an order the tap has only just queued — the DOS-180 lie in miniature. Until the row
   * is known, a queued order is where the tap left it: on the phone.
   */
  readonly rowKnown: boolean
}

export interface OrderOutcome {
  readonly kind: 'placed' | 'held' | 'draft' | 'refused'
  /** The banner's title. */
  readonly titleKey: string
  /** The sentence under it. */
  readonly bodyKey: string
  /** What the spent "Place order" button reads now. */
  readonly buttonKey: string
  /** Where the banner's primary button goes: the order itself, or the tray that now owns it. */
  readonly action: 'openOrder' | 'openTray'
}

/**
 * What to say about one order, from facts about that order alone.
 *
 * The order of the branches is the order of certainty: a number from the office beats everything (a
 * queued order whose upload has come back numbered really is placed), then the device's own outbox
 * state, and "reached the office as a draft" is what is left.
 */
export function orderOutcome(input: OrderOutcomeInput): OrderOutcome {
  const numbered = input.orderNo !== null && input.orderNo !== undefined && input.orderNo !== ''
  if (!input.queued || numbered)
    return {
      kind: 'placed',
      titleKey: 's3.placedTitle',
      bodyKey: 's3.placedBody',
      buttonKey: 's3.placed',
      action: 'openOrder',
    }
  if (input.pending === 'rejected')
    return {
      kind: 'refused',
      titleKey: 's3.refusedTitle',
      bodyKey: 's3.refusedBody',
      buttonKey: 's3.refusedTitle',
      action: 'openTray',
    }
  if (!input.rowKnown || input.pending === 'queued' || input.pending === 'sending') {
    // DOS-179's words: a browser that keeps nothing never gets the phone's verb, even here.
    const device = keepClaim(input.persistent) === 'device'
    return {
      kind: 'held',
      titleKey: device ? 's3.queuedTitle' : 's3.queuedTitleTab',
      bodyKey: device ? 's3.queuedBody' : 's3.queuedBodyTab',
      buttonKey: device ? 's3.queued' : 's3.queuedTab',
      action: 'openOrder',
    }
  }
  /*
   * The office answered and the row is no longer pending — but the op wrote a DRAFT, so there is no
   * number and nobody has checked the shop's credit. "Order placed" here is DOS-180 one step later.
   */
  return {
    kind: 'draft',
    titleKey: 's3.draftTitle',
    bodyKey: 's3.draftBody',
    buttonKey: 's3.draftLabel',
    action: 'openOrder',
  }
}
