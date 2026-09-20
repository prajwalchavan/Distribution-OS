import { describe, expect, it } from 'vitest'

import { creditAsk, creditChipCopy, placedCopy } from './placed'
import { orderOutcome } from './outcome'

/**
 * DOS-081: "Order placed. The office has it, with its number and its price." was what the rep read
 * for a strict shop whose order was HELD on a credit gate, for a stop shop, and for a warn shop over
 * its limit alike — the hold was visible only if the rep opened the order. The submit reply already
 * says which it was (`state` and `approvalFlags`); this is the sentence that follows from it.
 */
const online = {
  queued: false,
  pending: null,
  orderNo: 'SO-0879',
  persistent: true,
  rowKnown: true,
}

describe('DOS-081: what the rep is told when the order is held, not placed', () => {
  it('a submit reply of state submitted with approvalFlags [credit_limit] reads held for credit, not Order placed', () => {
    const copy = placedCopy(orderOutcome(online), {
      state: 'submitted',
      approvalFlags: ['credit_limit'],
    })
    expect(copy).toEqual({
      titleKey: 's3.heldCreditTitle',
      bodyKey: 's3.heldCreditBody',
      buttonKey: 's3.held',
    })
  })

  it('names the rate the rep asked for, and the floor, when those are what it waits on', () => {
    expect(
      placedCopy(orderOutcome(online), { state: 'submitted', approvalFlags: ['bargain'] }).titleKey,
    ).toBe('s3.heldBargainTitle')
    expect(
      placedCopy(orderOutcome(online), { state: 'submitted', approvalFlags: ['below_floor'] })
        .titleKey,
    ).toBe('s3.heldFloorTitle')
    // Credit first when more than one gate stands: it is the one that stops the goods.
    expect(
      placedCopy(orderOutcome(online), {
        state: 'submitted',
        approvalFlags: ['bargain', 'credit_limit'],
      }).titleKey,
    ).toBe('s3.heldCreditTitle')
  })

  it('a confirmed order still reads Order placed, and a queued one keeps the words the device chose', () => {
    expect(placedCopy(orderOutcome(online), { state: 'confirmed', approvalFlags: [] })).toEqual({
      titleKey: 's3.placedTitle',
      bodyKey: 's3.placedBody',
      buttonKey: 's3.placed',
    })
    const queued = orderOutcome({ ...online, queued: true, orderNo: null, pending: 'queued' })
    expect(placedCopy(queued, null).titleKey).toBe(queued.titleKey)
    // Nothing reached the office, so a stale "held" from an earlier reply must not speak for it.
    expect(
      placedCopy(queued, { state: 'submitted', approvalFlags: ['credit_limit'] }).titleKey,
    ).toBe(queued.titleKey)
  })
})

/**
 * DOS-081: the rep is in CREDIT_CHECKERS and the shop card says the office checks "not here", so a
 * strict shop's order was built, read out and placed before anybody learned it would be held. The
 * chip says so BEFORE the tap — and never disables it: stop and strict hold the order, the doorway
 * does not refuse it (docs/plans/receivables.md §4.14).
 */
describe('DOS-081: the credit chip before Place', () => {
  const base = { reasons: ['limit_exceeded'], headroomPaise: -35_843_00, overdueDays: 0 }

  it('says the order will be held for a strict or a stop shop', () => {
    expect(creditChipCopy({ ...base, creditMode: 'strict' }, 'payable')).toEqual({
      family: 'brick',
      key: 's3.creditWillHoldOver',
      overPaise: 35_843_00,
      overdueDays: 0,
    })
    expect(creditChipCopy({ ...base, creditMode: 'stop' }, 'payable')?.family).toBe('brick')
  })

  it('says warn only for an indicate shop, in ochre', () => {
    expect(creditChipCopy({ ...base, creditMode: 'indicate' }, 'payable')).toEqual({
      family: 'ochre',
      key: 's3.creditWarnOver',
      overPaise: 35_843_00,
      overdueDays: 0,
    })
  })

  it('names days overdue and open bills when those are the breach', () => {
    expect(
      creditChipCopy(
        {
          creditMode: 'strict',
          reasons: ['overdue_days_exceeded'],
          headroomPaise: 5_000,
          overdueDays: 41,
        },
        'payable',
      ),
    ).toEqual({ family: 'brick', key: 's3.creditWillHoldOverdue', overPaise: 0, overdueDays: 41 })
    expect(
      creditChipCopy(
        {
          creditMode: 'indicate',
          reasons: ['bill_count_exceeded'],
          headroomPaise: 5_000,
          overdueDays: 0,
        },
        'payable',
      )?.key,
    ).toBe('s3.creditWarnBills')
  })

  it('is absent with no reasons, and absent when there is no verdict to show', () => {
    expect(
      creditChipCopy(
        { creditMode: 'strict', reasons: [], headroomPaise: 90_000, overdueDays: 0 },
        'payable',
      ),
    ).toBeNull()
    expect(creditChipCopy(null, 'payable')).toBeNull()
  })
})

/**
 * DOS-081 (review): the chip's rupee figure is only as honest as the AMOUNT the office was asked
 * about. The first build asked `creditCheck` with the device engine's before-GST net while the
 * server's submit-time gate runs on the order's GST-inclusive total (`orders.internals.ts`
 * `approvalFlags()` → `checkCredit(tx, retailerId, order.totalPaise)`): a strict shop with a
 * ₹50,000 limit owing ₹20,000 and a ₹28,739.70 net / ₹32,030 payable read NO chip (20,000 +
 * 28,739.70 fits) and was held at submit (20,000 + 32,030 does not) — the very defect DOS-081
 * reports. `creditBasis` makes the call site declare which figure it sent, so a chip computed on a
 * net can never be read out as the payable, and the design's own wording ("the figure is before GST
 * until DOS-083 supplies the payable; say '(before GST)'") is carried by the string, not by hope.
 */
describe('DOS-081: the credit chip says which figure the office was asked about', () => {
  const overByNet = {
    creditMode: 'strict',
    reasons: ['limit_exceeded'],
    headroomPaise: -1_260_00,
    overdueDays: 0,
  } as const

  it('marks the over-the-limit figure "before GST" when the net is all the phone has', () => {
    expect(creditChipCopy(overByNet, 'before-gst')).toEqual({
      family: 'brick',
      key: 's3.creditWillHoldOverNet',
      overPaise: 1_260_00,
      overdueDays: 0,
    })
    expect(creditChipCopy({ ...overByNet, creditMode: 'indicate' }, 'before-gst')).toEqual({
      family: 'ochre',
      key: 's3.creditWarnOverNet',
      overPaise: 1_260_00,
      overdueDays: 0,
    })
  })

  it('drops the qualifier once the payable is the figure that was sent', () => {
    expect(creditChipCopy(overByNet, 'payable')?.key).toBe('s3.creditWillHoldOver')
    expect(creditChipCopy({ ...overByNet, creditMode: 'indicate' }, 'payable')?.key).toBe(
      's3.creditWarnOver',
    )
  })

  it('leaves the breaches that no amount moves alone: days overdue and open bills', () => {
    // Neither sentence carries a rupee figure, so neither needs the qualifier on either basis.
    const overdue = {
      creditMode: 'strict',
      reasons: ['overdue_days_exceeded'],
      headroomPaise: 5_000,
      overdueDays: 41,
    } as const
    expect(creditChipCopy(overdue, 'before-gst')?.key).toBe('s3.creditWillHoldOverdue')
    expect(creditChipCopy(overdue, 'payable')?.key).toBe('s3.creditWillHoldOverdue')
    const bills = {
      creditMode: 'indicate',
      reasons: ['bill_count_exceeded'],
      headroomPaise: 5_000,
      overdueDays: 0,
    } as const
    expect(creditChipCopy(bills, 'before-gst')?.key).toBe('s3.creditWarnBills')
    expect(creditChipCopy(bills, 'payable')?.key).toBe('s3.creditWarnBills')
  })

  it('asks the office about the payable whenever the screen has one', () => {
    // The order screen's own choice, as a value: the payable when the quote fits the basket on
    // screen, the device net only when there is no such quote — and the basis follows it.
    expect(creditAsk(3_203_000, 2_873_970)).toEqual({
      amountPaise: 3_203_000,
      basis: 'payable',
    })
    expect(creditAsk(null, 2_873_970)).toEqual({
      amountPaise: 2_873_970,
      basis: 'before-gst',
    })
    // Nothing on the pad yet: no amount, so nothing to ask.
    expect(creditAsk(null, 0)).toEqual({ amountPaise: 0, basis: 'before-gst' })
  })
})
