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

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

import {
  appliedLines,
  billsThatTakeMoney,
  billsThatCanBeTagged,
  owedHerePaise,
  recordRefusal,
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
  openPaise: 785_600,
}
const TODAY: DoorBill = {
  id: 'del-2',
  invoiceId: 'inv-0825',
  invoiceNo: 'INV/0825',
  invoiceDate: '2026-09-12',
  totalPaise: 785_600,
  state: 'issued',
  openPaise: 785_600,
}
const PAID: DoorBill = {
  id: 'del-3',
  invoiceId: 'inv-0829',
  invoiceNo: 'INV/0829',
  invoiceDate: '2026-08-04',
  totalPaise: 475_600,
  state: 'paid',
  openPaise: 0,
}
/**
 * REVIEW OF DOS-062 — the bill this fix was refused on. `Tc803a3a5/1` rides on the ACTIVE trip in
 * the seed: total ₹1,180.00, state `issued` (NOT `partially_paid` — the office's own row), and
 * ₹1,020.00 of it already allocated, so ₹160.00 is what it still asks for.
 */
const PART_PAID: DoorBill = {
  id: 'del-4',
  invoiceId: 'inv-part',
  invoiceNo: 'Tc803a3a5/1',
  invoiceDate: '2026-09-10',
  totalPaise: 118_000,
  state: 'issued',
  openPaise: 16_000,
}
/** The same bill before the office has answered: the device holds its face value and nothing else. */
const UNKNOWN: DoorBill = { ...PART_PAID, openPaise: null }

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
    expect(
      whereTheMoneyGoes(t, { bills: [JUNE, TODAY], tagged: new Set(), openBills: 7, canTag: true }),
    ).toBe(
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
      whereTheMoneyGoes(t, {
        bills: [TODAY, JUNE],
        tagged: new Set(['inv-0825']),
        openBills: 7,
        canTag: true,
      }),
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
        doorBills: [JUNE, TODAY],
        unallocatedPaise: 0,
        money,
      }),
    ).toEqual(['This paid INV/0099 ₹7856.00', 'INV/0825 is still open — ₹7856.00'])
    // Money over the shop's bills stays on account, and the crew says so at the door.
    expect(
      appliedLines(t, {
        allocations: [],
        invoices: [],
        doorBills: [],
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

/**
 * THE REVIEW OF THIS FIX. Tagging sent `allocations: [{ invoiceId, amountPaise: bill.totalPaise }]`,
 * and the office refuses an explicit line bigger than what the bill still owes
 * (`planExplicit`, receivables/allocation.ts: 409 CONFLICT "bill X owes 16000 paise; 118000 was
 * offered"). On the seed's own ACTIVE trip two bills ride at a door with money already against them,
 * so the driver could take the printed figure, tag the bill in his hand and be refused — with the
 * cash already counted, and the raw paise of the server's sentence on the screen. The device does not
 * carry an open balance (`LocalInvoice` is total + state), so the office is ASKED for one
 * (`receivables.outstanding.get`, `includeBills`) and a bill can only be tagged once that answer is in.
 */
describe('DOS-062 review — a tag is capped at what the office says the bill still owes', () => {
  it('DOS-062 a part-paid bill is tagged at its open balance, never at its face value', () => {
    expect(
      tagAllocations({
        bills: [PART_PAID],
        tagged: new Set(['inv-part']),
        amountPaise: 118_000,
        newId: ids(),
      }),
    ).toEqual([{ id: 'id-1', invoiceId: 'inv-part', amountPaise: 16_000 }])
  })

  it('DOS-062 a bill whose open balance the office has not given cannot be tagged, and sends no line', () => {
    expect(billsThatCanBeTagged([JUNE, UNKNOWN]).map((b) => b.invoiceId)).toEqual(['inv-0099'])
    expect(
      tagAllocations({
        bills: [UNKNOWN],
        tagged: new Set(['inv-part']),
        amountPaise: 118_000,
        newId: ids(),
      }),
    ).toEqual([])
    // And the sentence under the bills does not invite a tap that does nothing.
    expect(
      whereTheMoneyGoes(t, {
        bills: [UNKNOWN],
        tagged: new Set(),
        openBills: 7,
        canTag: false,
      }),
    ).toBe(
      'Untagged, the office puts this on the oldest bill this shop still owes — not always the bill in your hand. What each bill still owes has not come from the office, so a bill cannot be tagged here.',
    )
  })

  it('DOS-062 "Owed on the bills here" is what the bills still ask for, not their face value', () => {
    expect(owedHerePaise([PART_PAID])).toBe(16_000)
    expect(owedHerePaise([PART_PAID, PAID, JUNE])).toBe(801_600)
    // Nothing left on it is nothing owed here, whatever the state on this phone still says.
    expect(billsThatTakeMoney([{ ...PART_PAID, openPaise: 0 }])).toEqual([])
    // Before the office answers, its face value is the only figure the device has.
    expect(owedHerePaise([UNKNOWN])).toBe(118_000)
  })

  it('DOS-062 a FIFO reply that touched only INV/0099 still names INV/0825 as open', () => {
    // The finding's own acceptance sentence: untagged cash of ₹7,856 at Vaibhav's door, the office
    // pays June's bill to the paisa, and the crew must be able to say "this paid INV/0099 of 26 Jun;
    // today's bill stays open". `invoices` is `settled` — THE BILLS THE RECEIPT TOUCHED — so INV/0825
    // is not in the reply at all, and a screen that reads only the reply says nothing about the bill
    // in the shopkeeper's hand. The bills riding on this door are what names it.
    expect(
      appliedLines(t, {
        allocations: [{ invoiceId: 'inv-0099', amountPaise: 785_600 }],
        invoices: [{ id: 'inv-0099', invoiceNo: 'INV/0099', state: 'paid', openPaise: 0 }],
        doorBills: [JUNE, TODAY],
        unallocatedPaise: 0,
        money,
      }),
    ).toEqual(['This paid INV/0099 ₹7856.00', 'INV/0825 is still open — ₹7856.00'])
    // A bill the office already had as paid is not owed at this door and is not read out as open,
    // and a door bill the reply DID touch is named once, from the reply's newer figure.
    expect(
      appliedLines(t, {
        allocations: [{ invoiceId: 'inv-part', amountPaise: 6_000 }],
        invoices: [
          { id: 'inv-part', invoiceNo: 'Tc803a3a5/1', state: 'partially_paid', openPaise: 10_000 },
        ],
        doorBills: [PAID, PART_PAID],
        unallocatedPaise: 0,
        money,
      }),
    ).toEqual(['This paid Tc803a3a5/1 ₹60.00', 'Tc803a3a5/1 is still open — ₹100.00'])
  })

  it('DOS-062 an office that refuses the split tells the driver what to do, not raw paise', () => {
    const refused = {
      kind: 'conflict',
      message: 'bill Tc803a3a5/1 owes 16000 paise; 118000 was offered',
    }
    expect(recordRefusal(t, refused, true)).toBe(
      'The office says a bill you tagged does not owe that much any more. Untag it and record again — untagged, this money goes to the oldest bill the shop owes.',
    )
    // Nothing tagged: the office's own sentence is the honest one.
    expect(recordRefusal(t, refused, false)).toBe(refused.message)
    // Any other refusal is the office's own sentence too.
    expect(recordRefusal(t, { kind: 'business', message: 'This trip is closed.' }, true)).toBe(
      'This trip is closed.',
    )
  })
})

/**
 * AND THE SCREEN ACTUALLY ASKS. The rule above is only as true as its wiring, and the wiring is what
 * the review found broken — so it is read here the way `dos-065-own-papers.test.ts` reads its
 * screens: importing D5 in Node pulls in `react-native` and `expo-router`, which resolve only under
 * Metro.
 */
describe('DOS-062 review — D5 asks the office before it lets a bill be tagged', () => {
  it('DOS-062 D5 asks for the shop’s open bills, and re-asks after money is taken', async () => {
    const d5 = await read('../../app/stop/[id]/collect.tsx')
    expect(d5).toMatch(/receivables\.outstanding\.get\(/)
    expect(d5).toMatch(/includeBills:\s*true/)
    // Not a value from before the last receipt at this same door.
    expect(d5).toMatch(/staleTime:\s*0/)
    expect(d5).toMatch(/invalidates:[^\n]*\['outstanding'\]/)
  })

  it('DOS-062 a row is tappable only when the office has said what that bill still owes', async () => {
    const d5 = await read('../../app/stop/[id]/collect.tsx')
    expect(d5).toMatch(/const canTag = status\.online && openByInvoice !== null/)
    expect(d5).toMatch(/canTag && taggable\.has\(invoiceId\)/)
    // The figure on the row is what the bill still asks for, not its face value.
    expect(d5).toMatch(
      /trailingMoney=\{\s*bill === undefined \? \(invoice\?\.total_paise \?\? null\) : owedOn\(bill\)\s*\}/,
    )
    // And a refusal is read through the rule, never printed raw.
    expect(d5).toMatch(/setError\(recordRefusal\(t, failed, splitSent\.current\)\)/)
  })
})
