/**
 * S-183 — offline, the one state D8 exists for, D8 said nothing about the money on the phone.
 *
 * Measured 3/3 on web at 1280×800 and 390×844 (QA/evidence/batch2/walks/money-web.md §5(A)): with the
 * phone offline holding one ₹1,544 doorstep receipt, `d8-uncounted` — "This phone holds ₹X in receipts
 * that have not reached the office yet" — **never rendered**, and the "Hand ₹X to the cashier" line
 * (`d8-hand-over`) disappeared with it. Only the bottom bar's own private fallback still showed the
 * right rupee (₹1,944 = float ₹400 + ₹1,544), so the driver was shown a figure and never TOLD what it
 * was made of.
 *
 * Two causes, both here:
 *
 * 1. `dayEndCash` gave up whenever `figures` was undefined, and `figures` is the SERVER's settlement
 *    preview, which cannot resolve with no signal. The device knows enough to answer: the float is on
 *    its own trip row and the doorstep receipts are its own. So the rule now answers from the device
 *    when the office cannot be reached — the same arithmetic the bottom bar was doing privately, in
 *    the one place that also chooses the sentence.
 * 2. The screen drew both lines INSIDE `<Async state={preview}>`, which paints `d.noConnectionRead`
 *    over its children the moment that read fails. Guarded below.
 *
 * And the held figure itself changes, per the DOS-168..170 ruling's risk (e)(2): held money is read
 * from the OUTBOX — this trip's receipts still queued, sending, or refused — never from
 * `Σ local receipts − Σ the office counted`. That subtraction is exact only while this phone's table
 * is a superset of the server's, and a trip has a driver AND a helper: a helper's landed receipt of
 * the same amount, not yet pulled here, masked this phone's own unsent one and the sentence vanished.
 *
 * Figures are literals shaped like the walk's trip: float ₹400, one ₹1,544 doorstep receipt.
 */
import { describe, expect, it } from 'vitest'

import { dayEndCash, deviceMoney } from './check-in'

/** The float the cashier handed out at the start of the trip. */
const FLOAT = 40000
/** The doorstep cash the walk took with the phone offline. */
const HELD = 154400
/** A doorstep receipt the office has already taken. */
const LANDED = 500000

/** What `trips.settlementPreview` answers once the office has counted `LANDED`. */
function figuresFor(tripState: string) {
  return {
    tripState,
    expectedCashPaise: FLOAT + LANDED,
    cashCollectedPaise: LANDED,
    upiCollectedPaise: 0,
    chequeCollectedPaise: 0,
  } as const
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** One of this app's source files. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes the old rule is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The body of D8's `<Async state={preview}>` — what a failed office read replaces with a sentence. */
function previewAsyncBody(code: string): string {
  const open = code.indexOf('<Async state={preview}')
  expect(open).toBeGreaterThan(-1)
  const close = code.indexOf('</Async>', open)
  expect(close).toBeGreaterThan(open)
  return code.slice(open, close)
}

describe('S-183 what D8 says about the money on the phone when the office cannot be reached', () => {
  it('answers from the device with no signal, and names what the office has not seen', () => {
    // The walk's state: no signal, float ₹400 on the trip row, one ₹1,544 receipt still queued.
    expect(
      dayEndCash({
        figures: undefined,
        officeUnreachable: true,
        openingCashPaise: FLOAT,
        deviceCashPaise: HELD,
        heldCashPaise: HELD,
        heldAllPaise: HELD,
      }),
    ).toEqual({ handOverPaise: FLOAT + HELD, uncountedAllPaise: HELD, note: 'uncounted' })

    // No signal and nothing waiting: the float is still the driver's to hand over, and there is
    // nothing to say about uncounted money.
    expect(
      dayEndCash({
        figures: undefined,
        officeUnreachable: true,
        openingCashPaise: FLOAT,
        deviceCashPaise: 0,
        heldCashPaise: 0,
        heldAllPaise: 0,
      }),
    ).toEqual({ handOverPaise: FLOAT, uncountedAllPaise: 0, note: null })

    // Held UPI is money the office has not counted either, but it is not in the driver's hand: the
    // sentence names all of it, the hand-over only the cash.
    expect(
      dayEndCash({
        figures: undefined,
        officeUnreachable: true,
        openingCashPaise: FLOAT,
        deviceCashPaise: 0,
        heldCashPaise: 0,
        heldAllPaise: HELD,
      }),
    ).toEqual({ handOverPaise: FLOAT, uncountedAllPaise: HELD, note: 'uncounted' })

    // The office read has NOT failed yet — it is simply still in flight. Nothing is claimed: the
    // panel's own skeleton stands, and a device figure must not flash under it and then change.
    expect(
      dayEndCash({
        figures: undefined,
        officeUnreachable: false,
        openingCashPaise: FLOAT,
        deviceCashPaise: HELD,
        heldCashPaise: HELD,
        heldAllPaise: HELD,
      }),
    ).toEqual({ handOverPaise: null, uncountedAllPaise: 0, note: null })
  })

  it('reads held money from the outbox, so a helper’s landed receipt cannot mask this phone’s own', () => {
    // Risk (e)(2) of the ruling, as rows. The helper's ₹5,000 landed and was pulled here; this
    // phone's own ₹1,544 is still queued. Held is the queued one — not the difference of two totals.
    const rows = [
      { mode: 'cash', amount_paise: LANDED, _pending: null },
      { mode: 'cash', amount_paise: HELD, _pending: 'queued' as const },
    ]
    expect(deviceMoney(rows)).toEqual({
      cashPaise: LANDED + HELD,
      heldCashPaise: HELD,
      heldAllPaise: HELD,
    })

    // And through the arithmetic: the office counted its own ₹5,000, the phone adds only the ₹1,544.
    const money = deviceMoney(rows)
    expect(
      dayEndCash({
        figures: figuresFor('active'),
        officeUnreachable: false,
        openingCashPaise: FLOAT,
        deviceCashPaise: money.cashPaise,
        heldCashPaise: money.heldCashPaise,
        heldAllPaise: money.heldAllPaise,
      }),
    ).toEqual({
      handOverPaise: FLOAT + LANDED + HELD,
      uncountedAllPaise: HELD,
      note: 'uncounted',
    })

    // THE MASK. The helper's receipt is the same ₹1,544 and has NOT been pulled to this phone yet,
    // so the old `Σ device − Σ counted` read 0 and said nothing, while this phone really was holding
    // ₹1,544 nobody had counted. Reading the outbox, the amounts never meet.
    expect(
      dayEndCash({
        figures: {
          ...figuresFor('active'),
          cashCollectedPaise: HELD,
          expectedCashPaise: FLOAT + HELD,
        },
        officeUnreachable: false,
        openingCashPaise: FLOAT,
        deviceCashPaise: HELD,
        heldCashPaise: HELD,
        heldAllPaise: HELD,
      }),
    ).toEqual({
      handOverPaise: FLOAT + HELD + HELD,
      uncountedAllPaise: HELD,
      note: 'uncounted',
    })

    // A receipt the office has taken is not held, so nothing is said and nothing is added.
    expect(deviceMoney([{ mode: 'cash', amount_paise: LANDED, _pending: null }])).toEqual({
      cashPaise: LANDED,
      heldCashPaise: 0,
      heldAllPaise: 0,
    })
  })

  it('DOS-178 a receipt handed to the cashier is not held, and is not in the device total either', () => {
    // It stays on the phone for ever (never-list #13) but the cashier has the notes: counting it
    // would ask the driver for the same rupee a second time, at the counter.
    const rows = [
      { mode: 'cash', amount_paise: LANDED, _pending: null },
      { mode: 'cash', amount_paise: HELD, _pending: 'kept' as const },
      // Refused by the office and NOT yet handed over: still the driver's money.
      { mode: 'upi', amount_paise: HELD, _pending: 'rejected' as const },
    ]
    expect(deviceMoney(rows)).toEqual({
      cashPaise: LANDED,
      heldCashPaise: 0,
      heldAllPaise: HELD,
    })
  })

  it('guard: app/day.tsx prints the hand-over line and the note OUTSIDE the office read', async () => {
    const code = withoutComments(await read('../../app/day.tsx'))
    const inAsync = previewAsyncBody(code)

    // `<Async>` replaces its children with "No connection. This is not the current picture." the
    // moment the preview fails — which is every offline mount. Both sentences must survive it.
    expect(inAsync).not.toMatch(/testID="d8-hand-over"/)
    expect(inAsync).not.toMatch(/testID="d8-uncounted"/)
    expect(code).toMatch(/testID="d8-hand-over"/)
    expect(code).toMatch(/testID="d8-uncounted"/)
  })

  it('guard: app/day.tsx keeps ONE money rule — the bottom bar no longer does its own arithmetic', async () => {
    const code = withoutComments(await read('../../app/day.tsx'))

    // The private fallback the walk measured: right by luck, and the reason the sentence could go
    // missing beside a correct figure. The rule that chooses the sentence now owns the figure too.
    expect(code).not.toMatch(/deviceCashPaise \+ \(trip\?\.opening_cash_paise/)
    expect(code.match(/\bdayEndCash\s*\(/g) ?? []).toHaveLength(1)
    expect(code.match(/\bdeviceMoney\s*\(/g) ?? []).toHaveLength(1)

    // The rule is told whether the office can be reached, and is handed the outbox figures.
    const call = /dayEndCash\(\{([\s\S]*?)\n {2}\}\)/.exec(code)
    expect(call).not.toBeNull()
    expect(call?.[1]).toMatch(/\bofficeUnreachable\b/)
    expect(call?.[1]).toMatch(/\bheldAllPaise\b/)
    expect(call?.[1]).not.toMatch(/\btripState\b/)
  })
})
