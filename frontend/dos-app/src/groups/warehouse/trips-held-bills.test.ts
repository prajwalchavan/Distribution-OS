/**
 * DOS-172 — W10 Trips: the planning board's held bills, shown and never offered.
 *
 * A bill that came back undelivered rides its van until that trip checks in. Until then the server
 * refuses to plan it (409 `bill_on_road`) and answers it apart from the plannable bills, under
 * `TripPlanningOutput.held`, with the trip that carries it. The screen only displays that list — the road
 * rule has one server home and no screen keeps a copy (design amendment (g)) — so each held bill sits
 * under the bills, disabled and not pressable, saying "Out on <trip> — back after check-in", and a page
 * that carries only held bills still draws them. "Disabled", not "greyed": A Ledger never greys a control
 * that is unavailable (`ui/src/web/css.ts:71`), so the sentence beneath the shop name is the whole of why
 * the row cannot be tapped, and it has to name the trip.
 *
 * Read as source, like `owner-app/src/settings-views.test.ts`: importing the screen in Node pulls in
 * `react-native` and `expo-router`, which do not resolve outside Metro. It lives under `src/`, not `app/`,
 * because expo-router treats every file in `app/` as a route, and Node's modules come in through
 * non-literal specifiers because `@types/node` is deliberately absent from an app (`env.d.ts`).
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

/** W10's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../app/warehouse/load/trips.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names a testID is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The source from `from` up to (not including) the next `to`. */
function between(code: string, from: string, to: string): string {
  const start = code.indexOf(from)
  expect(start, `app/load/trips.tsx has no ${from}`).toBeGreaterThan(-1)
  const end = code.indexOf(to, start)
  expect(end, `app/load/trips.tsx has no ${to} after ${from}`).toBeGreaterThan(start)
  return code.slice(start, end)
}

/** The self-closing JSX element whose `testID` is the template `<prefix>${…}`: its tag and its source. */
function elementWithTestIdPrefix(code: string, prefix: string): { tag: string; source: string } {
  const prop = 'testID={`' + prefix + '${'
  const at = code.indexOf(prop)
  expect(at, `no element carries ${prop}…}\` in app/load/trips.tsx`).toBeGreaterThan(-1)
  expect(code.indexOf(prop, at + 1), `${prop}…}\` is carried twice`).toBe(-1)
  const opens = [...code.slice(0, at).matchAll(/<([A-Z][A-Za-z]*)\b/g)]
  const open = opens[opens.length - 1]
  if (open === undefined) throw new Error(`no JSX element opens before ${prop}`)
  const end = code.indexOf('/>', at)
  return { tag: open[1] ?? '', source: code.slice(open.index, end === -1 ? undefined : end + 2) }
}

const catalogue: Readonly<Record<string, string>> = strings

describe('W10 Trips: bills held on the road', () => {
  it('DOS-172: W10 lists the planning board\'s held bills under the plannable bills, disabled and never pressable, each saying "Out on <trip> — back after check-in"', async () => {
    const code = withoutComments(await readScreen())

    // The rows are the board's own `held`, never a rule of the screen's.
    expect(code).toMatch(/board\.data\?\.held\b/)

    // Drawn by the bill list both panels use (plan a trip, add a bill), after the plannable bills.
    const list = between(code, 'const billList =', 'const crewRow =')
    const billAt = list.indexOf('testID={`w10-bill-${')
    const heldAt = list.indexOf('testID={`w10-held-${')
    expect(billAt).toBeGreaterThan(-1)
    expect(heldAt, 'the held rows are not drawn by billList').toBeGreaterThan(-1)
    expect(heldAt, 'the held rows come under the bills').toBeGreaterThan(billAt)

    const row = elementWithTestIdPrefix(code, 'w10-held-')
    expect(row.tag).toBe('ListRow')
    expect(row.source).toMatch(/testID=\{`w10-held-\$\{\w+\.invoiceId\}`\}/)
    // Disabled, and a tap does nothing: nobody plans a bill still on a van.
    expect(row.source).toMatch(/state="disabled"/)
    expect(row.source).not.toMatch(/\bonPress\b/)
    // The reason is the row's own sentence, because a disabled control is never greyed here.
    expect(row.source).toMatch(/\bsecondary=/)
    // It names the trip that carries it.
    expect(row.source).toMatch(/t\(\s*'w10\.heldOnTrip'/)
    expect(row.source).toMatch(/\.onTripNo\b/)
    expect(catalogue['w10.heldOnTrip']).toBe('Out on {trip} — back after check-in')
  })

  it('DOS-172: a W10 board page that carries only held bills draws them instead of "Every packed bill is already on a trip"', async () => {
    const code = withoutComments(await readScreen())
    const list = between(code, 'const billList =', 'const crewRow =')
    const empty = /\bempty=\{([^}]*)\}/.exec(list)?.[1] ?? ''
    expect(empty.length, 'the bill list has no empty condition').toBeGreaterThan(0)
    expect(empty).toMatch(/\bbills\.length\s*===\s*0/)
    expect(empty).toMatch(/\bheld\.length\s*===\s*0/)
  })

  it('DOS-172: `held` means the bills on the road everywhere in W10 — no tap callback shadows it with the chosen ids', async () => {
    const code = withoutComments(await readScreen())
    // One binding, and it is the board's.
    const bindings = [...code.matchAll(/\bconst\s+held\s*=/g)]
    expect(bindings, 'W10 binds `held` more than once').toHaveLength(1)
    expect(code).toMatch(/const\s+held\s*=\s*board\.data\?\.held\b/)
    /*
     * The `setChosen` updaters take the PREVIOUS CHOSEN INVOICE IDS, a `string[]`, not the held bills.
     * Naming that parameter `held` hid the board's own `held` inside the two tap callbacks and invited
     * the next reader to plan a bill that is still on a van.
     */
    expect(code).not.toMatch(/\(\s*held\s*\)\s*=>/)
    expect(code).not.toMatch(/setChosen\(\s*\(\s*held\b/)
  })
})
