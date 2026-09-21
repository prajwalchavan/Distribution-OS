/**
 * DOS-119 — A WAVE THIS PHONE HAD NEVER HEARD OF, WITH "TAKE IT TO PACKING" UNDER IT.
 *
 * Measured on the desk at 1280 x 800: W4 raises a wave online and navigates straight to `/pick/{id}`,
 * and W5 draws everything off this phone's `picklists` and `pick_lines`. Nothing told the device to go
 * and fetch what the office had just written, so 1.6 s after the 200 create reply PICK-0083's screen
 * read "Picklist · Nothing here yet · 0 of 0 picked" with Scan and "Take it to packing" ENABLED. The
 * lines and Start appeared 57 s later; PICK-0082 took 33 s. Every new wave costs that, and its primary
 * button invites a picker to walk to the packing bench with nothing picked.
 *
 * Two halves. The engine is asked to pull as soon as the wave exists — and ASKING IS NOT PULLING:
 * `SyncEngine.sync()` opens with `if (this.pulling || this.ended || !this.started) return`, so an ask
 * made while the 60-second poll is pulling is dropped, silently and at random (DOS-063, proven on the
 * delivery app in this same batch). The first two cases below are that trap, run against a stand-in
 * engine that reproduces the rule line for line. And W5 stops claiming things about a sheet it has not
 * read: "0 of 0 picked" and "Nothing here yet" are both answers, and the honest word is that the wave
 * is still coming. Hiding Scan and the confirm while the status is unknown already landed with
 * DOS-182; `dos-182-pick-gate.test.ts` holds that half.
 *
 * The screens are read as SOURCE: importing one in Node pulls in `react-native`, which resolves only
 * under Metro.
 */
import { describe, expect, it } from 'vitest'

import { type PullableEngine, pullAfterWrite } from './pull-after-write'
import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  // `fileURLToPath`, never `URL.pathname`: the path has a space in it.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The slice of a screen between two markers — here, one mutation's success handler. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  if (start < 0) return ''
  const end = source.indexOf(to, start + from.length)
  return source.slice(start, end < 0 ? source.length : end)
}

/**
 * A stand-in for `SyncEngine`, with its drop rule copied from `@dos/offline` engine.ts:1095 —
 * `if (this.pulling || this.ended || !this.started) return`. `finish()` ends the pull that was in
 * flight and tells the listeners, exactly as the engine's `finally` block does.
 */
function standIn(startsPulling: boolean): {
  engine: PullableEngine
  reasons: string[]
  finish: () => void
} {
  let pulling = startsPulling
  const reasons: string[] = []
  const listeners = new Set<(status: { pulling: boolean }) => void>()
  const engine: PullableEngine = {
    sync: (reason: string) => {
      if (pulling) return Promise.resolve()
      reasons.push(reason)
      return Promise.resolve()
    },
    status: () => ({ pulling }),
    onStatus: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    engine,
    reasons,
    finish: () => {
      pulling = false
      for (const listener of [...listeners]) listener({ pulling })
    },
  }
}

const catalogue = strings as Readonly<Record<string, string | undefined>>

describe('DOS-119 a fresh wave is fetched, and nothing is claimed until it is here', () => {
  it('DOS-119: an idle engine pulls once, with the reason it was given', async () => {
    const { engine, reasons } = standIn(false)
    await expect(pullAfterWrite(engine, 'wave raised')).resolves.toBe('pulled')
    expect(reasons).toEqual(['wave raised'])
  })

  it('DOS-119: an ask made while the poll is already pulling is DROPPED, so it is made again', async () => {
    // The trap itself. A bare `void engine?.sync(...)` here records nothing and returns 'pulled'.
    const { engine, reasons, finish } = standIn(true)
    const pull = pullAfterWrite(engine, 'wave raised', 200)
    await Promise.resolve()
    expect(reasons, 'the engine took the ask while it was already pulling').toEqual([])
    finish()
    await expect(pull).resolves.toBe('pulled-after-wait')
    expect(reasons, 'the wave was never fetched at all').toEqual(['wave raised'])
  })

  it('DOS-119: a pull that never ends is given up on, with no listener left behind', async () => {
    const { engine, reasons } = standIn(true)
    await expect(pullAfterWrite(engine, 'wave raised', 10)).resolves.toBe('gave-up')
    expect(reasons).toEqual([])
  })

  it('DOS-119: no engine on this device is said as much, never as a pull that happened', async () => {
    await expect(pullAfterWrite(null, 'wave raised')).resolves.toBe('no-engine')
  })

  it('DOS-119: W4 asks the device for the wave it has just raised, before it navigates to it', async () => {
    const screen = await read('../../../../app/warehouse/pick/index.tsx')
    const success = between(screen, 'onSuccess: (result)', 'onError:')

    expect(success, "the create's success handler could not be found").not.toBe('')
    expect(success, 'nothing tells this phone the wave exists').toContain('pullAfterWrite(')
    expect(
      success.indexOf('pullAfterWrite('),
      'the pull is asked for after the screen has already gone',
    ).toBeLessThan(success.indexOf('router.push('))
  })

  it('DOS-119: W5 says the wave is still coming instead of "0 of 0 picked" over a sheet it has not read', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')

    expect(catalogue['w5.waiting'], 'no sentence exists for a wave still on its way').toBeTruthy()
    expect(screen, 'the waiting sentence is never rendered').toContain('w5-waiting')

    // The two claims the finding measured, each now behind the gate's own answer.
    const barAt = screen.indexOf('bottomBar={')
    const bodyAt = screen.indexOf('<LocalAsync')
    const waitingAt = screen.indexOf('testID="w5-waiting"')
    expect(
      waitingAt,
      'the waiting sentence is not in the bottom bar with the figure it replaces',
    ).toBeGreaterThan(barAt)
    expect(waitingAt).toBeLessThan(bodyAt)
    expect(
      between(screen, '<LocalAsync', '>'),
      'an unread sheet still reads as an empty one',
    ).toContain('w5.waiting')
  })
})
