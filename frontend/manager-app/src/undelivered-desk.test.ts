/**
 * DOS-196 — M7 Trips: the desk can see what came back, and can open a van that is still out.
 *
 * The chain's §4 and §8 both ended at the same wall: a bill refused at a shop's counter looked, on the
 * desk's billing panel, exactly like a delivered one, no screen anywhere listed what had come back, and
 * Fulfilment → Trips asked for `planned` and `loading` only — so while Today said "3 trips active" the
 * desk had no screen that could open one of them.
 *
 * So M7 now carries an **Undelivered** register above the trips: every bill whose last stop failed or
 * was refused, with the reason and the crew's note, the trip it is riding and the one action the desk
 * takes — wait for the van to check in, then plan it again. The rows are the server's own answer
 * (`delivery.deliveries.list` with `undeliveredOnly`), never a rule the screen keeps a copy of.
 *
 * Read as source, like `src/trips-held-bills.test.ts`: importing the screen in Node pulls in
 * `react-native` and `expo-router`, which do not resolve outside Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from './strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** M7 Trips' source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../app/fulfilment/trips.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names a testID is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('M7 Trips: what came back, and the vans still out', () => {
  it('DOS-196: M7 carries an Undelivered register read from the server, naming the bill, the shop, the money, the reason, the note and the trip', async () => {
    const code = withoutComments(await readScreen())

    // The rows are the server's own answer, and the screen keeps no second definition of "undelivered".
    expect(code).toMatch(/delivery\.deliveries\.list\(\s*\{[^}]*undeliveredOnly:\s*true/s)
    expect(code).toMatch(/testID="desk-undelivered"/)
    expect(code).toMatch(/testID="desk-undelivered-register"/)

    // Every column the desk needs to act without opening anything else.
    for (const read of [
      /row\.invoiceNo\b/,
      /row\.retailerName\b/,
      /row\.invoiceTotalPaise\b/,
      /row\.stopFailureReason\b/,
      /row\.stopFailureNote\b/,
      /row\.tripNo\b/,
    ])
      expect(code, `the Undelivered register never reads ${String(read)}`).toMatch(read)

    // And it says what happens next, in words, off the trip's own state — not a guess by the screen.
    expect(code).toMatch(/row\.tripState\b/)
    expect(catalogue['m7u.title']).toBe('Came back undelivered')
    expect(catalogue['m7u.onTheRoad']).toBe('Out on {trip} — back after check-in')
    expect(catalogue['m7u.backAtTheGodown']).toBe('Back at the godown — plan it again')
    expect(catalogue['m7u.empty']).toBe('Every bill that went out was delivered')
  })

  it('DOS-196: the trips register includes the vans that are out, and never offers "Add a bill" on one', async () => {
    const code = withoutComments(await readScreen())

    // The register asks for the trips on the road as well as the ones still to leave.
    const query = /trips\.list\(\s*\{\s*states:\s*\[([^\]]*)\]/s.exec(code)?.[1] ?? ''
    expect(query, 'M7 still asks for planned and loading only').toMatch(/'active'/)
    for (const state of ["'planned'", "'loading'"]) expect(query).toContain(state)

    // A trip that has left is read-only: only a trip still at the godown opens the add-a-bill panel.
    expect(code).toMatch(/const mayAddTo\s*=/)
    expect(code).toMatch(/TRIP_TAKES_A_LATE_BILL/)
    expect(code).toMatch(/TRIP_TAKES_A_LATE_BILL[^=]*=\s*new Set\(\['planned', 'loading'\]\)/)
    expect(catalogue['m7t.onTheRoad']).toBe('On the road — the desk cannot change it')
  })
})
