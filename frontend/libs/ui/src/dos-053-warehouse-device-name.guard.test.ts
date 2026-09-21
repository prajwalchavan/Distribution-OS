/**
 * DOS-053 — the godown's "Signed-in devices" names a device, not a user agent.
 *
 * W12 listed each session as `one.deviceName ?? one.platform`, and `@dos/api-client` sends the browser's user
 * agent as `deviceName` (120 characters of it): the warehouse gate saw
 * "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 … HeadlessChrome/145…" as the name of the
 * device a picker is being asked to end. The manager, sales and retailer registers already answer the only
 * question the screen asks — WHICH device is this — with "Chrome on Mac", through a `deviceLabel()` of their
 * own; the warehouse is the one that still printed the string.
 *
 * Read as source, in the style of `dos-105-retailer-words.guard.test.ts`: importing a screen in Node pulls in
 * `react-native`, which does not resolve outside Metro, so there is no render to assert on. What is asserted is
 * the shape of the label — the thing an edit would have to undo to put the user agent back on the screen.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The screen with its comments taken out: a comment may TALK about the user agent it removed. */
function read(group: string, file: string): string {
  return readFileSync(join(frontend, 'dos-app', 'app', group, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-053: the warehouse names a device the way the other apps do', () => {
  it('W12 renders the session rows through deviceLabel(), never the stored name itself', () => {
    const source = read('warehouse', 'settings.tsx')
    const panel = /testID="x4-sessions"[\s\S]*?testID="x4-inbox"/.exec(source)?.[0] ?? ''
    expect(panel.length).toBeGreaterThan(0)
    expect(panel).toMatch(/deviceLabel\(/)
    expect(panel).not.toMatch(/one\.deviceName\s*\?\?/)
  })

  it('W12 carries the same label as the manager, sales and retailer registers', () => {
    const source = read('warehouse', 'settings.tsx')
    const label = /export function deviceLabel\([\s\S]*?\n}/.exec(source)?.[0] ?? ''
    expect(label.length).toBeGreaterThan(0)
    // A user agent is recognised by its own first token, and only then taken apart.
    expect(label).toMatch(/startsWith\('Mozilla\/'\)/)
    for (const browser of ['Edge', 'Opera', 'Chrome', 'Firefox', 'Safari']) {
      expect(label).toContain(`'${browser}'`)
    }
    for (const machine of ['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'Linux']) {
      expect(label).toContain(`'${machine}'`)
    }
    // A name that is not a user agent is passed through, and an empty one says so in words.
    expect(label).toMatch(/if \(raw === ''\) return unnamed/)
  })
})
