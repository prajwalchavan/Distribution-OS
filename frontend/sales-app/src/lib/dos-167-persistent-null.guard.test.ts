/**
 * DOS-167 ruling 3 (ee) + Fable amendment A1, S-140 — "this browser will not keep" is never said while the store is
 * still opening.
 *
 * `SyncStatus.persistent` is a TRI-STATE: null until the open resolves, then true or false. Before the widening it
 * read `this.store?.persistent ?? false`, so every sign-in over a perfectly good OPFS file printed
 * "This browser will not keep the offline copy after you close it" for 39-82 ms — measured in four runs. The widening
 * only helps if every hop and every SCREEN treats null as "not resolved": a screen that renders the line on anything
 * other than `=== false` puts the flash straight back.
 *
 * Read as source, in the style of `dos-167-onlog.guard.test.ts` and `libs/ui/src/dos-1xx-*.guard.test.ts`: importing
 * a screen in Node pulls in `react-native`, which does not resolve outside Metro, so there is no render to assert on.
 * What is asserted instead is the GATE around the string — the thing a future edit would have to delete to bring the
 * flash back. `@types/node` is deliberately absent from an app, so the two Node functions come in through
 * non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The screen with its comments taken out: a comment may TALK about the gate it describes. */
async function readScreen(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The gates a persistence line may sit behind. Each leaves NOTHING on the screen while `persistent` is null:
 * `!== false ? null :` renders only on a resolved false; `=== null ? null :` and `=== null ? {} :` render only
 * once something has resolved. Anything else — `!persistent ?`, a bare `persistent ? … : …`, `?? false` — is the
 * S-140 flash again.
 */
const GATES: readonly RegExp[] = [
  /(?:status|local)\.persistent\s*!==\s*false\s*\?\s*null\s*:/,
  /(?:status|local)\.persistent\s*===\s*null\s*\?\s*null\s*:/,
  /(?:status|local)\.persistent\s*===\s*null\s*\?\s*\{\}\s*:/,
]

/** How far back from a plain `persistent` read its gate may sit: the same JSX expression, not somewhere in the file. */
const GATE_REACH = 300

/**
 * THE OTHER HALF OF RULING 3 (ee), and the one exception to the gate above.
 *
 * A STATEMENT about the store says nothing while the store is still opening — that is everything above.
 * An OFFER is the opposite: a label or a button that claims the device is holding something must never
 * claim a keep the device may turn out not to be able to make, so `keepClaim` in `@dos/offline` reads
 * null exactly as false and hands back the tab words. Both halves are the same founder decision
 * (DOS-179, 2026-09-19), and the screens that carry the store line now carry keep claims as well. So a
 * read handed straight to `keepKey('<word>', …)` is not a flash and is not counted as one; it is listed
 * by name instead, so an ungated truthiness read can never hide in here by calling itself an offer.
 */
const OFFER = /keepKey\(\s*'([A-Za-z]+)',\s*$/
/** How far back from the read the `keepKey('<word>',` may sit: the same call, nothing else. */
const OFFER_REACH = 80

export interface Screen {
  /** The screen, relative to the test file. */
  readonly path: string
  /** The string a person must never see while the store is still opening. */
  readonly memoryKey: string
  /** The string shown instead once the store HAS resolved and keeps; null when the screen says nothing in that case. */
  readonly diskKey: string | null
  /** The keep verbs this screen OFFERS through `keepKey`, in the order the source says them. */
  readonly offers: readonly string[]
}

const SCREENS: readonly Screen[] = [
  {
    path: '../../app/index.tsx',
    memoryKey: 's0.notPersisted',
    diskKey: null,
    /* The note under the beat, which says whose copy the screen is showing (DOS-179 sweep). */
    offers: ['offlineRead'],
  },
]

/** What the source says about one screen's persistence line. */
export async function inspectScreen(screen: Screen): Promise<Record<string, unknown>> {
  const source = await readScreen(screen.path)
  const at = source.indexOf(`'${screen.memoryKey}'`)
  const gatedBefore = (index: number): boolean =>
    GATES.some((gate) => gate.test(source.slice(Math.max(0, index - GATE_REACH), index)))
  const offerBefore = (index: number): string | null =>
    OFFER.exec(source.slice(Math.max(0, index - OFFER_REACH), index))?.[1] ?? null
  const reads = [...source.matchAll(/(?:status|local)\.persistent(?!\s*(?:===|!==))/g)]
  return {
    path: screen.path,
    // The line exists at all: a renamed string must not let this test pass by finding nothing to guard.
    present: at !== -1,
    // Something between the top of the file and the string routes a null away from it.
    gated: at !== -1 && gatedBefore(at),
    // And no plain truthiness read of `persistent` stands outside such a gate — that read IS the flash.
    ungated: reads
      .filter((match) => !gatedBefore(match.index ?? 0) && offerBefore(match.index ?? 0) === null)
      .map((match) =>
        source
          .slice(match.index ?? 0, (match.index ?? 0) + 60)
          .split('\n')[0]
          ?.trim(),
      ),
    // The reads that are OFFERS, named: null is the tab word there, and that is the ruling, not a flash.
    offers: reads
      .map((match) => offerBefore(match.index ?? 0))
      .filter((word): word is string => word !== null),
    // On a RESOLVED memory store the line is printed: withholding it there is the other half of the lie.
    onFalse:
      screen.diskKey === null
        ? new RegExp(
            `persistent\\s*!==\\s*false\\s*\\?\\s*null\\s*:[\\s\\S]{0,200}'${screen.memoryKey}'`,
          ).test(source)
        : new RegExp(
            `persistent\\s*\\?\\s*t\\('${screen.diskKey}'\\)\\s*:\\s*t\\('${screen.memoryKey}'\\)`,
          ).test(source),
  }
}

describe('DOS-167 the sales app never says "will not keep" before the store has resolved', () => {
  it('DOS-167 the sales beat screen hides the not-kept line while persistent is null and shows it on a resolved memory store', async () => {
    const seen = await Promise.all(SCREENS.map(inspectScreen))

    expect(seen).toEqual(
      SCREENS.map((screen) => ({
        path: screen.path,
        present: true,
        gated: true,
        ungated: [],
        offers: [...screen.offers],
        onFalse: true,
      })),
    )
  })
})
