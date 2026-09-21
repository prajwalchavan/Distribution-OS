/**
 * DOS-179 — the sentences around CLOSING THE TRIP never claim a keep the store cannot make.
 *
 * Found by reading the rendered screens after the first two passes (merge review, 2026-09-19). D1 and D8
 * both print `d8.pending` — "{count} writes are still on this phone" — under nothing but
 * `status.pending === 0 ? null :`. There is no keep gate anywhere in either file. On a browser with no
 * OPFS the `AppShell` strip on those same two screens already appends "· Not kept in this browser", so
 * the crew reads the strip denying the keep and the body asserting it in ONE render — over the outbox
 * that decides whether the trip can be closed at all (`checkInBlock` refuses the vehicle while it is not
 * empty). The same screen carries three more of the same claim: the button's `disabledReason`
 * (`d8.pendingBlocks`) and the two money sentences `dayEndCash` chooses, which say "This phone holds
 * ₹X in receipts" over money nothing is keeping.
 *
 * Never-list #12: the app never tells someone their work is saved on the device when it is not. The rule
 * is the library's — `keepClaim(persistent)` in `@dos/offline`, `'device'` only on a RESOLVED persistent
 * store — turned into a string key by this app's `keep.ts`. A screen that reaches for the phone's word
 * itself has stepped around it, so that is what this guard forbids.
 *
 * Read as SOURCE, in the style of `dos-167-persistent-null.guard.test.ts`: importing a screen in Node
 * pulls in `react-native`, which resolves only under Metro. `@types/node` is deliberately absent from an
 * app, so the two Node functions come in through non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

import { dayEndCash } from './check-in'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very string it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** One declared string's value, so the two words of a pair can be told apart by what they say. */
function valueOf(strings: string, key: string): string | null {
  const match = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`).exec(strings)
  return match?.[1] ?? null
}

/** Every keep claim printed while a trip is being closed, and the screens that print it. */
const CLAIMS: readonly {
  /** The `KeepWord` the screens must hand `keepKey`. */
  readonly word: string
  readonly device: string
  readonly tab: string
  readonly screens: readonly string[]
}[] = [
  {
    word: 'pending',
    device: 'd8.pending',
    tab: 'd8.pendingTab',
    screens: ['../../../../app/delivery/index.tsx', '../../../../app/delivery/day.tsx'],
  },
  {
    word: 'pendingBlocks',
    device: 'd8.pendingBlocks',
    tab: 'd8.pendingBlocksTab',
    screens: ['../../../../app/delivery/day.tsx'],
  },
  {
    word: 'uncounted',
    device: 'd8.uncounted',
    tab: 'd8.uncountedTab',
    screens: [],
  },
  {
    word: 'uncountedSettled',
    device: 'd8.uncountedSettled',
    tab: 'd8.uncountedSettledTab',
    screens: [],
  },
]

describe('DOS-179 closing the trip never claims a keep the store cannot make', () => {
  it('DOS-179 D1 and D8 take every outbox sentence through keepKey, and each has a tab twin', async () => {
    const strings = await read('../strings.ts')
    const seen: Record<string, unknown>[] = []
    for (const claim of CLAIMS) {
      const screens = await Promise.all(claim.screens.map((path) => read(path)))
      const device = valueOf(strings, claim.device)
      const tab = valueOf(strings, claim.tab)
      seen.push({
        word: claim.word,
        // Both words exist: a missing tab key ships the key itself to a driver.
        declared: device !== null && tab !== null,
        // Only one of the two names the phone; the other names the tab and says nothing is saved.
        deviceSaysPhone: device === null ? 'missing' : /this phone/i.test(device),
        tabSaysPhone: tab === null ? 'missing' : /this phone/i.test(tab),
        tabSaysTab: tab === null ? 'missing' : /this tab/i.test(tab),
        // No screen reaches for the phone's word itself — that read IS the lie.
        direct: claim.screens.filter((path, index) =>
          (screens[index] ?? '').includes(`t('${claim.device}'`),
        ),
        // Each one asks THE STORE, through the same helper D4 and D5 already go through.
        viaHelper: claim.screens.filter((path, index) =>
          new RegExp(`keepKey\\('${claim.word}',\\s*status\\.persistent\\)`).test(
            screens[index] ?? '',
          ),
        ),
      })
    }

    expect(seen).toEqual(
      CLAIMS.map((claim) => ({
        word: claim.word,
        declared: true,
        deviceSaysPhone: true,
        tabSaysPhone: false,
        tabSaysTab: true,
        direct: [],
        viaHelper: [...claim.screens],
      })),
    )
  })

  it('DOS-179 dayEndCash names a keep WORD, so D8 cannot print its money sentence ungated', async () => {
    const figures = {
      tripState: 'active',
      expectedCashPaise: 100_00,
      cashCollectedPaise: 0,
      upiCollectedPaise: 0,
      chequeCollectedPaise: 0,
    }

    // The rule hands back the KeepWord, never the phone's string key: the screen has to ask the store.
    const held = {
      officeUnreachable: false,
      openingCashPaise: 0,
      deviceCashPaise: 0,
      heldCashPaise: 0,
      heldAllPaise: 50_00,
    }
    expect(dayEndCash({ figures, ...held }).note).toBe('uncounted')
    expect(dayEndCash({ figures: { ...figures, tripState: 'settled' }, ...held }).note).toBe(
      'uncountedSettled',
    )
    expect(dayEndCash({ figures, ...held, heldAllPaise: 0 }).note).toBeNull()

    // S-183 added a third state this sentence can be chosen in: no signal at all, where the rule
    // answers from the device rather than going silent. It is a keep WORD there too.
    expect(dayEndCash({ figures: undefined, ...held, officeUnreachable: true }).note).toBe(
      'uncounted',
    )

    // And D8 renders whichever it chose through the helper, not straight into the translator.
    const day = await read('../../../../app/delivery/day.tsx')
    expect(day).toMatch(/t\(keepKey\(note,\s*status\.persistent\)/)
    expect(day).not.toMatch(/t\(note,/)
  })
})
