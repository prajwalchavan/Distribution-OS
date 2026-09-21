/**
 * S-184 — D8's check-in button, disabled with no signal, gave a VAN SALE sentence as its reason.
 *
 * Measured 3/3 on web at 1280×800 and 390×844 (QA/evidence/batch2/walks/money-web.md §5(A)): with the
 * phone offline holding one ₹1,544 doorstep receipt, "Check the vehicle in" was disabled — the gate
 * holds — and the reason under it read **"A van sale needs a signal: it makes a numbered GST bill."**
 * (`d6.online`), on a trip with `vanSalesEnabled: false`, where the real reason is that the driver's
 * own records have not left the phone.
 *
 * Two faults, one sentence:
 *
 * 1. `checkInBlock` answered `'offline'` before `'pending'`, so `d8.pendingBlocks` — the sentence the
 *    DOS-168..170 ruling names for exactly this state (item 5(A): "the button is disabled with the
 *    `d8.pendingBlocks` sentence (count 1)") — was unreachable while offline, and was never seen in
 *    10.2 s of 300 ms samples across the drain window either. The outbox is the reason that will
 *    STILL be there when the signal comes back; the signal is only how it clears. So it goes first.
 * 2. The `'offline'` reason borrowed D6's van-sale string. D8 gets its own.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions the screen
 * guard needs are imported through a non-literal specifier and their shapes are named here.
 */
import { describe, expect, it } from 'vitest'

import { checkInBlock } from './check-in'

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

describe('S-184 the reason D8 gives for refusing check-in', () => {
  it('names the outbox before the signal: the records are what must still reach the office', () => {
    // The state the walk measured: no signal, one doorstep receipt still on the phone. The driver is
    // told about the RECORD, not about a van sale.
    expect(checkInBlock({ onTheRoad: true, online: false, pending: 1, odometerBad: false })).toBe(
      'pending',
    )

    // The same with the odometer also wrong: the outbox still wins, as it already did online.
    expect(checkInBlock({ onTheRoad: true, online: false, pending: 2, odometerBad: true })).toBe(
      'pending',
    )

    // Nothing held: then the signal IS the reason, and it is the only state that says so.
    expect(checkInBlock({ onTheRoad: true, online: false, pending: 0, odometerBad: false })).toBe(
      'offline',
    )

    // A trip that is not on the road is not checked in from here at all, whatever else is true.
    expect(checkInBlock({ onTheRoad: false, online: false, pending: 3, odometerBad: true })).toBe(
      'notActive',
    )

    // Unchanged: online with a full outbox, and the clear road behind it.
    expect(checkInBlock({ onTheRoad: true, online: true, pending: 1, odometerBad: false })).toBe(
      'pending',
    )
    expect(checkInBlock({ onTheRoad: true, online: true, pending: 0, odometerBad: true })).toBe(
      'odometer',
    )
    expect(
      checkInBlock({ onTheRoad: true, online: true, pending: 0, odometerBad: false }),
    ).toBeNull()
  })

  it('guard: app/day.tsx no longer borrows the van-sale sentence for a missing signal', async () => {
    const code = withoutComments(await read('../../../../app/delivery/day.tsx'))

    // The measured sentence. D6 keeps `d6.online` for its own screen; D8 must not reach for it.
    expect(code).not.toMatch(/d6\.online/)
    expect(code).toMatch(/blocked === 'offline'[\s\S]{0,120}d8\.offlineBlocks/)
  })

  it('guard: the sentence is a real key in this app’s strings', async () => {
    // `Translator` is `(key: string, ...) => string`, so a key that does not exist type-checks and
    // ships its own name to a driver.
    expect(await read('../strings.ts')).toContain(`'d8.offlineBlocks':`)
  })
})
