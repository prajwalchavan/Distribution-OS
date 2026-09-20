/**
 * DOS-063 — THE SCREEN A DRIVER LANDS ON AFTER A WRITE SHOWS THE WRITE.
 *
 * D4 and D5 both record at the office and then `router.replace` back to D3, which reads everything it
 * draws off this phone's SQLite. Nothing told the device to go and fetch what the office had just
 * written, so the stop went on saying "Not started · Deliver this bill" and "Owes ₹75,228.00" until the
 * 60-second poll came round — up to forty seconds of a driver reading a bill he has just handed over as
 * undelivered, and dues he has just been paid. A driver who trusts the screen delivers or collects a
 * second time (QA DOS-062), and the second one is refused at the door.
 *
 * The fix is the one the device already has: the public `useSyncEngine().sync()` (`@dos/offline/react`),
 * the same call `sales-app/app/orders/[id].tsx` and `warehouse-app/app/pick/[id].tsx` make after their
 * own writes. NOT a new engine method that writes server rows into the local tables — a screen that
 * writes its own copy of what the office said is a second source of truth on the device.
 *
 * BUT ASKING IS NOT PULLING. `SyncEngine.sync()` opens with `if (this.pulling || this.ended ||
 * !this.started) return`, so the ask is DROPPED whenever the 60 s poll or an upload tail is already
 * pulling — the symptom comes back at random, on the same screen, for the same reason (integration
 * review, 2026-09-20: the first version of this test was a source grep and proved only the wiring).
 * So `pullAfterDoorstepWrite` is run here against a stand-in that reproduces that rule line for line,
 * and the first test below is the trap itself: what the plain call does mid-flight.
 *
 * Only the ONLINE path pulls: the offline path has no signal by definition, and `queueDelivery` /
 * `queueReceipt` have already written the device's own row.
 *
 * The screens themselves are still read as SOURCE, in the style of `dos-179-trip-close.guard.test.ts`:
 * importing a screen in Node pulls in `react-native`, which resolves only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { type DoorstepSync, pullAfterDoorstepWrite } from './at-the-door'

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
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The slice of a screen between two markers — here, one mutation's success handler. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  if (start < 0) return ''
  const end = source.indexOf(to, start + from.length)
  return source.slice(start, end < 0 ? source.length : end)
}

/** Let every microtask settle, the way a real frame would. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface FakeEngine extends DoorstepSync {
  /** The reasons of the pulls that actually RAN — a dropped ask leaves nothing here. */
  readonly pulls: string[]
  /** Something else starts pulling: the 60 s poll, or the tail of an upload. */
  readonly begin: () => void
  /** …and finishes. */
  readonly finish: () => void
  readonly listeners: () => number
}

/**
 * The engine's own pull rule, copied from `@dos/offline` `engine.ts` `sync()`: a pull asked for while
 * one is running returns immediately and is never run. Everything else here is bookkeeping.
 */
function fakeEngine(options: { failing?: boolean } = {}): FakeEngine {
  let pulling = false
  const pulls: string[] = []
  const listeners = new Set<(status: { readonly pulling: boolean }) => void>()
  const emit = (): void => {
    for (const listener of [...listeners]) listener({ pulling })
  }
  return {
    pulls,
    listeners: () => listeners.size,
    begin: () => {
      pulling = true
      emit()
    },
    finish: () => {
      pulling = false
      emit()
    },
    status: () => ({ pulling }),
    onStatus: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sync: async (reason) => {
      if (pulling) return
      pulling = true
      emit()
      await Promise.resolve()
      if (options.failing === true) {
        pulling = false
        emit()
        throw new Error('the office did not answer')
      }
      pulls.push(reason)
      pulling = false
      emit()
    },
  }
}

describe('DOS-063 the stop is pulled again after a doorstep write', () => {
  it('DOS-063 the trap: a bare sync() asked for mid-pull is dropped and the driver’s write is never read back', async () => {
    const engine = fakeEngine()
    // The 60 s poll is already in flight when the driver presses Record.
    engine.begin()
    await engine.sync('delivery recorded')
    engine.finish()
    expect(engine.pulls).toEqual([])
  })

  it('DOS-063 an idle engine pulls once, with the screen’s own reason', async () => {
    const engine = fakeEngine()
    expect(await pullAfterDoorstepWrite(engine, 'delivery recorded')).toBe('pulled')
    expect(engine.pulls).toEqual(['delivery recorded'])
    expect(engine.listeners()).toBe(0)
  })

  it('DOS-063 a pull asked for mid-flight is made again as soon as the running one ends', async () => {
    const engine = fakeEngine()
    engine.begin()
    const pulled = pullAfterDoorstepWrite(engine, 'payment recorded', 1_000)
    await tick()
    // Nothing yet: the write is not in the pull that was already running.
    expect(engine.pulls).toEqual([])
    engine.finish()
    expect(await pulled).toBe('pulled-after-wait')
    expect(engine.pulls).toEqual(['payment recorded'])
    expect(engine.listeners()).toBe(0)
  })

  it('DOS-063 a pull that never ends is waited for once and then let go, with no listener left behind', async () => {
    const engine = fakeEngine()
    engine.begin()
    expect(await pullAfterDoorstepWrite(engine, 'delivery recorded', 10)).toBe('gave-up')
    expect(engine.pulls).toEqual([])
    expect(engine.listeners()).toBe(0)
  })

  it('DOS-063 no engine and a refused pull are both silent: the screen is already being replaced', async () => {
    expect(await pullAfterDoorstepWrite(null, 'delivery recorded')).toBe('no-engine')
    const engine = fakeEngine({ failing: true })
    await expect(pullAfterDoorstepWrite(engine, 'delivery recorded')).resolves.toBe('pulled')
    expect(engine.listeners()).toBe(0)
  })

  it('DOS-063 D4 and D5 hold the public sync engine and pull with it before they leave the screen', async () => {
    const screens = [
      { name: 'deliver', source: await read('../../app/stop/[id]/deliver.tsx') },
      { name: 'collect', source: await read('../../app/stop/[id]/collect.tsx') },
    ]

    const seen = screens.map(({ name, source }) => {
      const success = between(source, 'onSuccess:', 'onError:')
      const pull = success.indexOf('pullAfterDoorstepWrite(engine,')
      const replace = success.indexOf('router.replace(')
      return {
        name,
        // The hook, from the offline library's own React layer — never a new engine method.
        holdsEngine: /const engine = useSyncEngine\(\)/.test(source),
        importsHook: /import \{[^}]*\buseSyncEngine\b[^}]*\} from '@dos\/offline\/react'/.test(
          source,
        ),
        // The office answered: go and read back what it wrote, then go to the stop.
        pullsOnSuccess: pull >= 0,
        pullsBeforeLeaving: pull >= 0 && replace >= 0 && pull < replace,
        // Never the bare call the first test above shows being dropped.
        noBareSync: !/engine\?\.sync\(/.test(source),
      }
    })

    expect(seen).toEqual([
      {
        name: 'deliver',
        holdsEngine: true,
        importsHook: true,
        pullsOnSuccess: true,
        pullsBeforeLeaving: true,
        noBareSync: true,
      },
      {
        name: 'collect',
        holdsEngine: true,
        importsHook: true,
        pullsOnSuccess: true,
        pullsBeforeLeaving: true,
        noBareSync: true,
      },
    ])
  })

  it('DOS-063 neither screen writes the office’s answer into the device tables itself', async () => {
    const deliver = await read('../../app/stop/[id]/deliver.tsx')
    const collect = await read('../../app/stop/[id]/collect.tsx')
    for (const source of [deliver, collect]) {
      // No local write of a server row: the pull is the only thing that fills the device.
      expect(source).not.toMatch(/engine\?\.(putRow|applyRows|upsert|writeRow)\(/)
    }
  })
})
