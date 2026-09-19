/**
 * DOS-172 — D2 Start the trip: the confirm dialog says what departing really does now.
 *
 * A bill leaves the godown only through a confirmed load sheet, whose confirm dispatches it. `depart`
 * dispatches nothing any more: it verifies, and refuses 409 `bill_not_loaded` naming every bill nobody
 * counted out. So the dialog body may no longer promise the driver that tapping sends the uncounted bills
 * out — UX-00 §6.12 is that the body is EXACTLY what will be written — and the refusal the server writes
 * must reach the driver word for word, because it is the sentence that names the bills still to count.
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

/** D2's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../app/trip/start.tsx', import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that names an element is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('D2 Start the trip: departing dispatches nothing', () => {
  it('DOS-172: the confirm body no longer promises that starting the trip sends out the bills the godown has not counted', () => {
    const body = catalogue['d2.confirmBody'] ?? ''
    expect(body.length, 'd2.confirmBody is missing').toBeGreaterThan(0)
    // It cannot claim a dispatch: `depart` verifies and refuses, and the load-out did the dispatching.
    expect(body).not.toMatch(/dispatch/i)
    expect(body).not.toMatch(/not already sent out/i)
    // It says whose count the load is, and that tracking starts.
    expect(body).toMatch(/counted out/i)
    expect(body).toMatch(/where the vehicle is/i)
    // The four facts the driver checks before tapping stay.
    for (const slot of ['{trip}', '{vehicle}', '{stops}', '{cash}']) expect(body).toContain(slot)
  })

  it('DOS-172: D2 prints the depart refusal verbatim, so the bills still to count are named on the phone (pinned, green before the fix)', async () => {
    const code = withoutComments(await readScreen())
    // The server's sentence, never a sentence of the screen's own: the godown's `bill_not_loaded` list.
    expect(code).toMatch(/testID="d2-error"/)
    expect(code).toMatch(/\{`\$\{t\('d2\.failed'\)\} — \$\{depart\.error\.message\}`\}/)
    // No branch on the refusal's code rewrites it into a screen-side sentence.
    expect(code).not.toMatch(/bill_not_loaded/)
  })
})
