/**
 * DOS-068 — a failed read on the van's phone says something, never a machine word.
 *
 * `<Async>` is where every delivery screen's failure is decided once, and it printed the ApiError's own `kind` as
 * the detail line under the sentence: with the API path cut, Trip history read "Something could not be completed.
 * Try again. · unknown · Try again" on the Pixel 7. `kind` is this codebase's internal vocabulary — 'unknown',
 * 'business', 'notFound' — and UX-00 §12 says a screen shows the business reason and the next action, never a
 * code. The sentence above it is already the whole answer, and a network failure gets the plain one.
 *
 * Read as source: `src/lib/ui.tsx` imports `@dos/ui`, which pulls in `react-native` and does not resolve outside
 * Metro, so there is no render to assert on (same reason as `dos-105-retailer-words.guard.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The file with its comments taken out: a comment may TALK about the kind it no longer prints. */
function read(path: string): string {
  return readFileSync(join(frontend, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-068: the delivery app never puts an error kind in front of a driver', () => {
  const source = read('dos-app/src/groups/delivery/lib/ui.tsx')
  const failure = /if \(failed\?\.error !== undefined\) \{[\s\S]*?\n {2}\}/.exec(source)?.[0] ?? ''

  it('the Async failure branch is where this is decided, once', () => {
    expect(failure.length).toBeGreaterThan(0)
  })

  it('DOS-068 no error kind is rendered as the detail line', () => {
    expect(failure).not.toMatch(/detail=\{[^}]*\bkind\b/)
    expect(source).not.toMatch(/detail=\{failed\.error\.kind\}/)
  })

  it('DOS-068 a read that never reached the office still says so in plain words', () => {
    expect(failure).toMatch(/kind === 'network'[\s\S]*?t\('d\.noConnectionRead'\)/)
  })
})
