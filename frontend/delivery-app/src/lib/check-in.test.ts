/**
 * DOS-168 · DOS-169 · DOS-170 — D8 End of day: the check-in gate and the hand-over figure.
 *
 * Two faults met on this screen. The office never counted a doorstep receipt that was taken with no
 * signal, so D8 added the phone's own cash on top of the office figure to keep the driver honest
 * (day.tsx :143-154, measured on TRIP-NEXT: the office said ₹5,000, the phone held ₹7,500, the screen
 * asked for ₹11,070 with nothing saying why). DOS-169 fixes the office half — settlement now counts
 * the trip's receipts however they arrived — so the phone must add only what it STILL HOLDS, and
 * nothing at all once the trip has settled, or the same rupee is asked for twice.
 *
 * And the button: a driver could check the vehicle in while the outbox still held those receipts.
 * The office then settles a trip whose money has not arrived, and the receipt that lands afterwards
 * is refused `trip_settled` (the founder's answer, 2026-09-14). So the phone's records go first.
 *
 * Figures are literals shaped like sai-distributors TRIP-NEXT, never read from a database: float
 * ₹3,000, the office counted ₹5,000 of cash, the phone still holds ₹2,500 it has not sent.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions the
 * screen guard needs are imported through a non-literal specifier and their shapes are named here.
 */
import { describe, expect, it } from 'vitest'

import { checkInBlock, dayEndCash } from './check-in'

/** The float the cashier handed over at the start of the trip. */
const FLOAT = 300000
/** Doorstep cash that reached the office: `settlementPreview` counts it. */
const COUNTED = 500000
/** Doorstep money still sitting in this phone's outbox. */
const HELD = 250000

/** What `trips.settlementPreview` answers for the trip above once the office has counted ₹5,000. */
const FIGURES = {
  expectedCashPaise: FLOAT + COUNTED,
  cashCollectedPaise: COUNTED,
  upiCollectedPaise: 0,
  chequeCollectedPaise: 0,
} as const

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The End-of-day screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../../app/day.tsx', import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes the old rule is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('D8 End of day: checking the vehicle in, and what the office is owed', () => {
  it('DOS-169 check-in waits for the outbox, after the trip and signal checks and before the odometer', () => {
    // Two doorstep records still on the phone: they go before the office can close the trip, even
    // though the odometer is also wrong — the outbox is the reason the driver is told.
    expect(checkInBlock({ onTheRoad: true, online: true, pending: 2, odometerBad: true })).toBe(
      'pending',
    )

    // Emptied outbox: the odometer is now the only thing in the way.
    expect(checkInBlock({ onTheRoad: true, online: true, pending: 0, odometerBad: true })).toBe(
      'odometer',
    )

    // No signal is asked about before the outbox: check-in itself needs the office.
    expect(checkInBlock({ onTheRoad: true, online: false, pending: 2, odometerBad: true })).toBe(
      'offline',
    )

    // A trip that is not out on the road is not checked in from here at all.
    expect(checkInBlock({ onTheRoad: false, online: false, pending: 2, odometerBad: true })).toBe(
      'notActive',
    )

    // Nothing in the way: the button works.
    expect(
      checkInBlock({ onTheRoad: true, online: true, pending: 0, odometerBad: false }),
    ).toBeNull()

    // Rejected writes do not block (docs/27 §10: `pending` is queued + sending; the tray owns the
    // rest), and one queued record is as blocking as ten.
    expect(checkInBlock({ onTheRoad: true, online: true, pending: 1, odometerBad: false })).toBe(
      'pending',
    )
  })

  it('DOS-169 D8 adds only what has not reached the office, and nothing on a settled trip', () => {
    // Everything this phone holds has reached the office: the office figure stands on its own, and
    // there is no sentence about uncounted money.
    expect(
      dayEndCash({
        tripState: 'active',
        figures: FIGURES,
        deviceCashPaise: COUNTED,
        deviceAllPaise: COUNTED,
      }),
    ).toEqual({ handOverPaise: FLOAT + COUNTED, uncountedAllPaise: 0, note: null })

    // ₹2,500 of doorstep cash is still on the phone: the driver hands it over with the rest, and the
    // screen says why the figure is bigger than the office's.
    expect(
      dayEndCash({
        tripState: 'closing',
        figures: FIGURES,
        deviceCashPaise: COUNTED + HELD,
        deviceAllPaise: COUNTED + HELD,
      }),
    ).toEqual({
      handOverPaise: FLOAT + COUNTED + HELD,
      uncountedAllPaise: HELD,
      note: 'd8.uncounted',
    })

    // The trip settled while that receipt was still queued. The settled figure is what the office
    // counted; the held money is named as the cashier's, never added to the hand-over again.
    expect(
      dayEndCash({
        tripState: 'settled',
        figures: FIGURES,
        deviceCashPaise: COUNTED + HELD,
        deviceAllPaise: COUNTED + HELD,
      }),
    ).toEqual({
      handOverPaise: FLOAT + COUNTED,
      uncountedAllPaise: HELD,
      note: 'd8.uncountedSettled',
    })

    // A hand-over short of the tolerance the owner accepted closes the trip the same way.
    expect(
      dayEndCash({
        tripState: 'settled_with_variance',
        figures: FIGURES,
        deviceCashPaise: COUNTED + HELD,
        deviceAllPaise: COUNTED + HELD,
      }),
    ).toEqual({
      handOverPaise: FLOAT + COUNTED,
      uncountedAllPaise: HELD,
      note: 'd8.uncountedSettled',
    })

    // Held UPI is money the office has not counted either, but it is not cash in the driver's hand:
    // the note names all of it, the hand-over figure only the cash half.
    expect(
      dayEndCash({
        tripState: 'active',
        figures: FIGURES,
        deviceCashPaise: COUNTED,
        deviceAllPaise: COUNTED + HELD,
      }),
    ).toEqual({ handOverPaise: FLOAT + COUNTED, uncountedAllPaise: HELD, note: 'd8.uncounted' })

    // The office is ahead of the phone (a receipt the desk recorded itself): nothing is subtracted.
    expect(
      dayEndCash({
        tripState: 'active',
        figures: FIGURES,
        deviceCashPaise: 0,
        deviceAllPaise: 0,
      }),
    ).toEqual({ handOverPaise: FLOAT + COUNTED, uncountedAllPaise: 0, note: null })

    // No signal to read the preview with: the screen has no office figure to show at all.
    expect(
      dayEndCash({
        tripState: 'active',
        figures: undefined,
        deviceCashPaise: COUNTED + HELD,
        deviceAllPaise: COUNTED + HELD,
      }),
    ).toEqual({ handOverPaise: null, uncountedAllPaise: 0, note: null })
  })

  it('DOS-169 guard: app/day.tsx takes the button rule from checkInBlock and the hand-over figure from dayEndCash, and no longer disables check-in on the trip state alone', async () => {
    const code = withoutComments(await readScreen())

    expect(code).toMatch(
      /import\s*\{[^}]*\bcheckInBlock\b[^}]*\}\s*from\s*'\.\.\/src\/lib\/check-in'/,
    )
    expect(code).toMatch(
      /import\s*\{[^}]*\bdayEndCash\b[^}]*\}\s*from\s*'\.\.\/src\/lib\/check-in'/,
    )

    // The button rule lives in `checkInBlock` and the arithmetic in `dayEndCash`, each called once.
    expect(code.match(/\bcheckInBlock\s*\(/g) ?? []).toHaveLength(1)
    expect(code.match(/\bdayEndCash\s*\(/g) ?? []).toHaveLength(1)

    // The old rule is gone: a full outbox blocks the button too.
    expect(code).not.toMatch(/disabled=\{\s*!\s*onTheRoad/)
    expect(code).not.toMatch(/uncountedCashPaise/)

    // The uncounted sentence is whichever one `dayEndCash` chose, not a hard-coded key.
    expect(code).toMatch(/testID="d8-uncounted"/)
    expect(code).not.toMatch(/t\(\s*'d8\.uncounted'/)
  })
})
