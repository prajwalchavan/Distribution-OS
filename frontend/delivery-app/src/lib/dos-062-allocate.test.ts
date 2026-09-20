/**
 * DOS-062 — THE DOOR SAYS WHICH BILL THE MONEY PAYS, AND LETS THE DRIVER SAY IT INSTEAD.
 *
 * Measured at Vaibhav Kirana Mart: D5 listed "Bills on this stop: INV/0825 ₹7,856" over a pad, the
 * driver took ₹7,856 for that bill, and the office allocated it — correctly, by the founder's own
 * rule (docs/22 §6: "allocated bill-to-bill oldest first unless tagged") — to INV/0099 of 26 June.
 * INV/0825 stayed open. Nothing on the screen had said so before the money changed hands, there was
 * no way to TAG the bill the shopkeeper meant, and afterwards the same bill was still offered as
 * owed, so a second tap would have taken the money twice.
 *
 * So three rules live here, in one pure place the screen asks:
 *   - a bill the office has already marked `paid` is not money owed at this door, and cannot be tagged;
 *   - tagging sends an EXPLICIT split (`RecordCollectionInput.allocations`), oldest bill first among
 *     the tagged ones, each line capped at what that bill is worth and never more than the money taken;
 *   - what the office answers is read back as sentences naming the bills — what was paid, what is
 *     still open, and what is left on account.
 *
 * Pure TypeScript like `doorstep.ts`: the kit's string layer (`Translator`) and nothing else, so this
 * runs under vitest with no Metro and no renderer.
 */
import { createTranslator } from '@dos/ui'
import { describe, expect, it } from 'vitest'

import {
  appliedLines,
  billsThatTakeMoney,
  owedHerePaise,
  tagAllocations,
  whereTheMoneyGoes,
  type DoorBill,
} from './allocate'
import { keepApplied, takeApplied } from './door-money'
import { strings } from '../strings'

const t = createTranslator('en', strings)

/** Client ids are the screen's (UUIDv7); a fresh counter per call keeps the expectations readable. */
function ids(): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `id-${String(seq)}`
  }
}

/** ₹ in paise, as the screen would print it — the screen passes its own `formatINR`. */
const money = (p: number): string => `₹${(p / 100).toFixed(2)}`

const JUNE: DoorBill = {
  id: 'del-1',
  invoiceId: 'inv-0099',
  invoiceNo: 'INV/0099',
  invoiceDate: '2026-06-26',
  totalPaise: 785_600,
  state: 'issued',
}
const TODAY: DoorBill = {
  id: 'del-2',
  invoiceId: 'inv-0825',
  invoiceNo: 'INV/0825',
  invoiceDate: '2026-09-12',
  totalPaise: 785_600,
  state: 'issued',
}
const PAID: DoorBill = {
  id: 'del-3',
  invoiceId: 'inv-0829',
  invoiceNo: 'INV/0829',
  invoiceDate: '2026-08-04',
  totalPaise: 475_600,
  state: 'paid',
}

describe('DOS-062 where the money at this door goes', () => {
  it('DOS-062 a bill the office has marked paid is not owed here and cannot be tagged', () => {
    expect(billsThatTakeMoney([TODAY, PAID, JUNE]).map((b) => b.invoiceNo)).toEqual([
      'INV/0099',
      'INV/0825',
    ])
    // a-22: "Owed on the bills here ₹4,756.00" over a bill that had just been paid.
    expect(owedHerePaise([PAID])).toBe(0)
    expect(owedHerePaise([TODAY, PAID, JUNE])).toBe(1_571_200)
    expect(
      tagAllocations({
        bills: [PAID],
        tagged: new Set(['inv-0829']),
        amountPaise: 475_600,
        newId: ids(),
      }),
    ).toEqual([])
  })

  it('DOS-062 nothing tagged sends no split, and the screen says where the money will go', () => {
    expect(
      tagAllocations({
        bills: [JUNE, TODAY],
        tagged: new Set(),
        amountPaise: 785_600,
        newId: ids(),
      }),
    ).toBeNull()
    expect(whereTheMoneyGoes(t, { bills: [JUNE, TODAY], tagged: new Set(), openBills: 7 })).toBe(
      'Untagged, the office puts this on the oldest of the 7 bills this shop still owes — not always the bill in your hand. Tap a bill to send it there instead.',
    )
  })

  it('DOS-062 tagging a bill sends an explicit split, oldest tagged bill first and never over the money taken', () => {
    const split = tagAllocations({
      bills: [TODAY, JUNE],
      tagged: new Set(['inv-0825']),
      amountPaise: 785_600,
      newId: ids(),
    })
    expect(split).toEqual([{ id: 'id-1', invoiceId: 'inv-0825', amountPaise: 785_600 }])
    expect(
      whereTheMoneyGoes(t, { bills: [TODAY, JUNE], tagged: new Set(['inv-0825']), openBills: 7 }),
    ).toBe('This money goes to INV/0825.')
    // Two tagged bills and not enough money: the older one is filled first and the rest is dropped.
    expect(
      tagAllocations({
        bills: [TODAY, JUNE],
        tagged: new Set(['inv-0825', 'inv-0099']),
        amountPaise: 800_000,
        newId: ids(),
      }),
    ).toEqual([
      { id: 'id-1', invoiceId: 'inv-0099', amountPaise: 785_600 },
      { id: 'id-2', invoiceId: 'inv-0825', amountPaise: 14_400 },
    ])
    // More money than the tagged bills are worth: the surplus is left for the office to place.
    expect(
      tagAllocations({
        bills: [JUNE],
        tagged: new Set(['inv-0099']),
        amountPaise: 900_000,
        newId: ids(),
      }),
    ).toEqual([{ id: 'id-1', invoiceId: 'inv-0099', amountPaise: 785_600 }])
  })

  it('DOS-062 the office answer is read back as the bills it actually paid', () => {
    expect(
      appliedLines(t, {
        allocations: [{ invoiceId: 'inv-0099', amountPaise: 785_600 }],
        invoices: [
          { id: 'inv-0099', invoiceNo: 'INV/0099', state: 'paid', openPaise: 0 },
          { id: 'inv-0825', invoiceNo: 'INV/0825', state: 'issued', openPaise: 785_600 },
        ],
        unallocatedPaise: 0,
        money,
      }),
    ).toEqual(['This paid INV/0099 ₹7856.00', 'INV/0825 is still open — ₹7856.00'])
    // Money over the shop's bills stays on account, and the crew says so at the door.
    expect(
      appliedLines(t, {
        allocations: [],
        invoices: [],
        unallocatedPaise: 50_000,
        money,
      }),
    ).toEqual(['₹500.00 left on account'])
  })

  it('DOS-062 the lines reach the stop once and are gone on the mount after it', () => {
    // D5 is torn down by `router.replace` the moment the office answers (DOS-149), so the sentences
    // travel to the screen that is still standing — and are read exactly once.
    keepApplied(['This paid INV/0099 ₹7856.00'])
    expect(takeApplied()).toEqual(['This paid INV/0099 ₹7856.00'])
    expect(takeApplied()).toBeNull()
    // Nothing to say is no panel at all, never an empty one.
    keepApplied([])
    expect(takeApplied()).toBeNull()
  })
})
