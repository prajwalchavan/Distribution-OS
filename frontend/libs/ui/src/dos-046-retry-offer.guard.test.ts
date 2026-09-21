/**
 * DOS-046 — "Try it again" is offered only where there is something to send again.
 *
 * A tray row does not always have an outbox row behind it: `pullErrors` brings back the rejections the server
 * still holds for this device after a reinstall or a cleared browser, and for those the op itself — the row, the
 * data, the place in the queue — is gone from this install. `retry()` answers null and changes nothing there
 * (there is nothing to send), so a button that offers it is a button that does nothing when pressed.
 *
 * The delivery tray has decided this by `item.op === null` since DOS-178 (`src/lib/tray.ts`); the warehouse tray
 * offered both buttons on every row. "Throw it away" stays on such a row — it clears the server's rejection from
 * this device's tray, which is exactly what a person wants to do with a stranger's leftover refusal.
 *
 * Read as source: a screen pulls in `@dos/ui` and `react-native`, which does not resolve outside Metro (same
 * reason as `dos-105-retailer-words.guard.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The screen with its comments taken out: a comment may TALK about a gate that is not in the code. */
function read(path: string): string {
  return readFileSync(join(frontend, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-046: the warehouse tray offers a retry only for an op it still holds', () => {
  const source = read('dos-app/app/warehouse/pick/attention.tsx')
  const retry = /<Button[\s\S]*?testID=\{`tray-retry-\$\{entry\.error\.opId\}`\}[\s\S]*?\/>/.exec(
    source,
  )?.[0]

  it('the retry button is still on the screen', () => {
    expect(retry).toBeDefined()
    expect(source).toMatch(/outbox\.retry\(/)
  })

  it('DOS-046 it is rendered behind a check that this device holds the op', () => {
    const gated = /entry\.op === null \? null : \([\s\S]*?tray-retry/.test(source)
    expect(gated).toBe(true)
  })

  it('DOS-046 throwing it away is offered either way', () => {
    const discard = /testID=\{`tray-discard-\$\{entry\.error\.opId\}`\}/.test(source)
    expect(discard).toBe(true)
    // The discard button is not inside the same conditional as the retry.
    const block = /entry\.op === null \? null : \([\s\S]*?\)\}/.exec(source)?.[0] ?? ''
    expect(block).not.toMatch(/tray-discard/)
  })
})
