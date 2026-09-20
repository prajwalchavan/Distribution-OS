/**
 * DOS-089 — the sync engine does not start before the session has a token.
 *
 * A cold start with a remembered session restores the snapshot (so `session` is not null) and sets `hydrating`
 * while the boot refresh is in flight — the ONE moment in an app's life when there is a person but no access
 * token, and `SessionStore` sets that flag in its constructor and nowhere else. The sales app mounted the engine
 * on `session !== null` alone, so the very first thing the engine did on every launch was `GET /sync/manifest`
 * with no Authorization header at all: a 401, a refresh, and the same call again. Functionally self-healing, and
 * a wasted round trip on a rep's data plan every single launch.
 *
 * The provider itself stays mounted — unmounting it would throw away a memory store holding a queue, which is
 * what the comment above it has always been about. Only `enabled` waits.
 *
 * Read as source: a root layout pulls in expo-router and `react-native`, neither of which resolves outside Metro
 * (same reason as `dos-105-retailer-words.guard.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The layout with its comments taken out: a comment may TALK about a wait that is not in the code. */
function read(app: string): string {
  return readFileSync(join(frontend, app, 'app', '_layout.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-089: the sales engine waits for the boot refresh', () => {
  const source = read('sales-app')
  const mount = /<Offline\b[\s\S]*?>/.exec(source)?.[0] ?? ''

  it('the engine is mounted through <Offline enabled=…>, once, above the gate', () => {
    expect(mount).toMatch(/enabled=\{/)
    expect(source.match(/<Offline\b/g) ?? []).toHaveLength(1)
  })

  it('DOS-089 it is not enabled while the session is still hydrating', () => {
    expect(mount).toMatch(/!hydrating/)
  })

  it('DOS-089 the provider itself is still mounted for the life of the app, hydrating or not', () => {
    // The skeleton is a CHILD of <Offline>, never a branch that returns before it.
    expect(source).toMatch(/<Offline[\s\S]*?\{content\}[\s\S]*?<\/Offline>/)
  })
})
