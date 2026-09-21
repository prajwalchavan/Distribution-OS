/**
 * DOS-180 — the banner after "Place order" tells the truth about THAT order, not about the radio.
 *
 * A rep places an order in a dead spot. The honest banner shows: "Saved on this phone". They stay on
 * the screen; the signal comes back; the banner re-renders as "Order placed — The office has it, with
 * its number and its price" over an order the office still holds as a DRAFT with no number, because
 * `title` and `meta` were picked from `local.online` at render time (new.tsx:387-388).
 *
 * The truth has two sources and neither is the radio: `place.data.queued` — false means `orders.create`
 * and `orders.submit` were both answered 200 — and, for a queued order, the row's own `_pending`.
 * "Reached the office as a draft" is a real and different state from "Order placed": the queued op
 * writes `state: 'draft'` (queue.ts) and a draft has no number until somebody submits it.
 *
 * Pure rules, no React, no kit.
 */
import { describe, expect, it } from 'vitest'

import { orderOutcome } from './outcome'

describe('DOS-180 the outcome banner is bound to the order, not to the radio', () => {
  it('DOS-180 a queued order stays saved-on-this-phone when the signal returns and becomes reached-as-a-draft only on the ack, never Order placed', () => {
    // Placed with a signal: both calls were answered, the order has its number and its price.
    expect(
      orderOutcome({
        queued: false,
        pending: null,
        orderNo: 'SO-1113',
        persistent: true,
        rowKnown: true,
      }),
    ).toEqual({
      kind: 'placed',
      titleKey: 's3.placedTitle',
      bodyKey: 's3.placedBody',
      buttonKey: 's3.placed',
      action: 'openOrder',
    })

    // Queued in a dead spot. The phone holds it and nothing has reached the office.
    const held = orderOutcome({
      queued: true,
      pending: 'queued',
      orderNo: null,
      persistent: true,
      rowKnown: true,
    })
    expect(held).toEqual({
      kind: 'held',
      titleKey: 's3.queuedTitle',
      bodyKey: 's3.queuedBody',
      buttonKey: 's3.queued',
      action: 'openOrder',
    })

    // THE BUG. The signal comes back while the rep is still on the screen. Until the outbox has been
    // answered the order is exactly where it was, and the banner says exactly what it said.
    expect(
      orderOutcome({
        queued: true,
        pending: 'sending',
        orderNo: null,
        persistent: true,
        rowKnown: true,
      }),
    ).toEqual({ ...held, kind: 'held' })

    // The office answered. It holds a DRAFT with no number — never "Order placed".
    const acked = orderOutcome({
      queued: true,
      pending: null,
      orderNo: null,
      persistent: true,
      rowKnown: true,
    })
    expect(acked.kind).toBe('draft')
    expect(acked.titleKey).toBe('s3.draftTitle')
    expect(acked.bodyKey).toBe('s3.draftBody')
    expect(acked.titleKey).not.toBe('s3.placedTitle')

    // The office refused it: the tray owns it now, and the banner sends the rep there.
    expect(
      orderOutcome({
        queued: true,
        pending: 'rejected',
        orderNo: null,
        persistent: true,
        rowKnown: true,
      }),
    ).toEqual({
      kind: 'refused',
      titleKey: 's3.refusedTitle',
      bodyKey: 's3.refusedBody',
      buttonKey: 's3.refusedTitle',
      action: 'openTray',
    })
  })

  it('DOS-180 a held order borrows the keep words of DOS-179, so it never claims a phone that keeps nothing', () => {
    const tab = orderOutcome({
      queued: true,
      pending: 'queued',
      orderNo: null,
      persistent: false,
      rowKnown: true,
    })
    expect(tab.titleKey).toBe('s3.queuedTitleTab')
    expect(tab.bodyKey).toBe('s3.queuedBodyTab')
    expect(tab.buttonKey).toBe('s3.queuedTab')

    // Still opening counts as not keeping: an offer never promises a keep it may not be able to make.
    expect(
      orderOutcome({
        queued: true,
        pending: 'queued',
        orderNo: null,
        persistent: null,
        rowKnown: true,
      }).titleKey,
    ).toBe('s3.queuedTitleTab')
  })

  it('DOS-180 a queued order whose row has not been read yet is held, never a draft', () => {
    // `useRow` answers `{ row: null }` for a tick. Reading that as "the office has it" would be the
    // same lie one frame after the tap.
    const unread = orderOutcome({
      queued: true,
      pending: null,
      orderNo: null,
      persistent: true,
      rowKnown: false,
    })
    expect(unread.kind).toBe('held')
    expect(unread.titleKey).toBe('s3.queuedTitle')
  })

  it('DOS-180 a queued order the office numbered is placed, whatever the outbox row still says', () => {
    // The pull after a successful upload brought the order back with its number: it really is placed.
    expect(
      orderOutcome({
        queued: true,
        pending: null,
        orderNo: 'SO-1114',
        persistent: true,
        rowKnown: true,
      }).kind,
    ).toBe('placed')
  })
})
