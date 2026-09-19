/**
 * DOS-179 — no screen of a field app says "on this phone" over a store that keeps nothing.
 *
 * The browser fallback (no COOP/COEP, so no OPFS) is a store in memory that dies with the tab. The
 * strip now says so on every screen, which is the shared half. This is the OTHER half: every VERB that
 * claims to keep something — a button that reads "Save on this phone", the banner after it, a toast, a
 * chip on a picked line — has to change its words too, or the app spends the day contradicting its own
 * strip. Measured in the DOS-167 ruling-3 re-proof: the order button read "Save on this phone" and then
 * "Saved on this phone" over an order queued into a store that dies with the tab.
 *
 * ONE RULE FOR THE THREE APPS. `keepClaim(persistent)` in `@dos/offline` answers `'device'` only on a
 * RESOLVED persistent store — an OFFER treats null exactly as false (DOS-167 ruling 3 (ee)), because a
 * button must never promise a keep the device may not be able to make — and each app's `keep.ts` turns
 * that into the string key. A screen that reaches for the device key itself has stepped around the rule,
 * so that is what this guard forbids.
 *
 * Read as SOURCE, in the style of `dos-167-persistent-null.guard.test.ts`: importing a screen in Node
 * pulls in `react-native`, which does not resolve outside Metro. `@types/node` is deliberately absent
 * from an app, so the two Node functions come in through non-literal specifiers. It lives in the sales
 * app because that is where the finding was measured; it covers its two siblings from here, as the
 * delivery and warehouse halves of the same founder decision (2026-09-19).
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

/** Source with its comments taken out: a comment may quote the very string it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

interface App {
  /** The app's root, relative to this file. */
  readonly root: string
  /** Every keep verb it owns: the key it used to reach for, and the one for a store that keeps nothing. */
  readonly pairs: readonly { readonly device: string; readonly tab: string }[]
  /** The screens that say one of those verbs. Each must go through `keepKey`. */
  readonly screens: readonly string[]
}

const APPS: readonly App[] = [
  {
    root: '../..',
    pairs: [
      { device: 's3.queue', tab: 's3.queueTab' },
      { device: 's3.queued', tab: 's3.queuedTab' },
      { device: 's3.queuedTitle', tab: 's3.queuedTitleTab' },
      { device: 's3.queuedBody', tab: 's3.queuedBodyTab' },
      { device: 's5.trayOffline', tab: 's5.trayOfflineTab' },
      { device: 's5.queuedExplain', tab: 's5.queuedExplainTab' },
    ],
    screens: ['app/orders/new.tsx', 'app/orders/attention.tsx', 'app/orders/[id].tsx'],
  },
  {
    root: '../../../delivery-app',
    pairs: [
      { device: 'd.savedOnPhone', tab: 'd.savedOnPhoneTab' },
      { device: 'd.offlineWrite', tab: 'd.offlineWriteTab' },
      { device: 'd4.recordOffline', tab: 'd4.recordOfflineTab' },
      { device: 'd5.recordOffline', tab: 'd5.recordOfflineTab' },
      { device: 'd5.recordedQueued', tab: 'd5.recordedQueuedTab' },
      /*
       * The hand-over dialog on D10, added by DOS-178 one commit before this rule was written and so
       * never taken through it (merge review, 2026-09-19). It is the same claim as the rest — "stays on
       * this phone" — on the one screen that already prints `tray.storeMemory` above it, so on a store
       * that keeps nothing the crew read both sentences in one render.
       */
      { device: 'tray.handOverBody', tab: 'tray.handOverBodyTab' },
      { device: 'tray.handOverBodyNoBook', tab: 'tray.handOverBodyNoBookTab' },
    ],
    screens: [
      'app/stop/[id]/collect.tsx',
      'app/stop/[id]/deliver.tsx',
      'app/stop/[id]/index.tsx',
      'app/attention.tsx',
    ],
  },
  {
    root: '../../../warehouse-app',
    pairs: [
      { device: 'w.savedOnDevice', tab: 'w.savedOnDeviceTab' },
      { device: 'w5.offlineNote', tab: 'w5.offlineNoteTab' },
    ],
    screens: ['app/pick/[id].tsx'],
  },
]

/**
 * The three sentences the first pass left behind, found by the merge review of 2026-09-19.
 *
 * They are the same lie in paragraph form rather than button form, and the first of them sits three
 * lines under the Record button on the DOORSTEP MONEY screen — the one this batch made un-throwable in
 * DOS-178 — so the strip could read "Not kept in this browser" while the sentence beneath it promised
 * the money stayed on the phone. Listed one by one here, screen by screen, so the review's own finding
 * has a test of its own rather than only a row in the table above.
 */
const RESIDUE: readonly {
  readonly root: string
  readonly screen: string
  readonly device: string
  readonly tab: string
}[] = [
  {
    root: '../../../delivery-app',
    screen: 'app/stop/[id]/collect.tsx',
    device: 'd.offlineWrite',
    tab: 'd.offlineWriteTab',
  },
  {
    root: '../../../delivery-app',
    screen: 'app/stop/[id]/deliver.tsx',
    device: 'd.offlineWrite',
    tab: 'd.offlineWriteTab',
  },
  {
    root: '../..',
    screen: 'app/orders/[id].tsx',
    device: 's5.queuedExplain',
    tab: 's5.queuedExplainTab',
  },
  {
    root: '../../../warehouse-app',
    screen: 'app/pick/[id].tsx',
    device: 'w5.offlineNote',
    tab: 'w5.offlineNoteTab',
  },
]

/**
 * The hand-over dialog on D10, which THIS lane introduced (cfe2010) and then did not take through its
 * own rule one commit later.
 *
 * It is the worst place for the claim to survive: the screen prints `tray.storeMemory` — "Held in memory
 * only — a reload empties this device" — eleven lines above, so on a browser with no OPFS the crew read
 * the phone promising and denying the same keep in ONE render, over money the office has already refused
 * and the phone is now the only record of (never-list #12 and #13 in the same dialog).
 */
const HAND_OVER: readonly {
  readonly screen: string
  readonly device: string
  readonly tab: string
}[] = [
  {
    screen: 'app/attention.tsx',
    device: 'tray.handOverBody',
    tab: 'tray.handOverBodyTab',
  },
  {
    screen: 'app/attention.tsx',
    device: 'tray.handOverBodyNoBook',
    tab: 'tray.handOverBodyNoBookTab',
  },
]

/** One declared string's value, so the two words of a pair can be told apart by what they say. */
function valueOf(strings: string, key: string): string | null {
  const match = new RegExp(`'${key.replace('.', '\\.')}':\\s*'([^']*)'`).exec(strings)
  return match?.[1] ?? null
}

describe('DOS-179 a field app never claims a keep the store cannot make', () => {
  it('DOS-179 the three apps take every offline keep verb through keepKey, and each verb has both words', async () => {
    const seen: Record<string, unknown>[] = []
    for (const app of APPS) {
      const helper = await read(`${app.root}/src/lib/keep.ts`)
      const strings = await read(`${app.root}/src/strings.ts`)
      const screens = await Promise.all(app.screens.map((path) => read(`${app.root}/${path}`)))
      seen.push({
        root: app.root,
        // The rule itself is the library's, not re-implemented per app.
        usesKeepClaim: /keepClaim/.test(helper) && /@dos\/offline/.test(helper),
        // Both words exist for every verb: a missing tab key would ship the key itself to a rep.
        declared: app.pairs.filter(
          (pair) => !strings.includes(`'${pair.device}':`) || !strings.includes(`'${pair.tab}':`),
        ),
        /*
         * No screen reaches for the device word itself — that read IS the lie. The opening `t('key'`
         * and no more, so a claim that takes ARGUMENTS counts too: the hand-over dialog interpolates
         * the amount and the book number, and matching `t('key')` whole let it straight through.
         */
        direct: app.screens.flatMap((path, index) =>
          app.pairs
            .filter((pair) => (screens[index] ?? '').includes(`t('${pair.device}'`))
            .map((pair) => `${path}: ${pair.device}`),
        ),
        // And every one of those screens goes through the helper instead.
        viaHelper: app.screens.filter((path, index) => /keepKey\(/.test(screens[index] ?? '')),
      })
    }

    expect(seen).toEqual(
      APPS.map((app) => ({
        root: app.root,
        usesKeepClaim: true,
        declared: [],
        direct: [],
        viaHelper: [...app.screens],
      })),
    )
  })

  it('DOS-179 review: the doorstep money note, the queued-order sentence and the pick note say it too', async () => {
    const seen: Record<string, unknown>[] = []
    for (const row of RESIDUE) {
      const screen = await read(`${row.root}/${row.screen}`)
      const strings = await read(`${row.root}/src/strings.ts`)
      const device = valueOf(strings, row.device)
      const tab = valueOf(strings, row.tab)
      seen.push({
        screen: row.screen,
        // The paragraph is chosen the same way the buttons around it are.
        direct: screen.includes(`t('${row.device}')`),
        viaHelper: screen.includes(`keepKey('${row.device.split('.').pop() ?? ''}`),
        // And the two words really are two: only one of them may name the device.
        deviceSaysTab: device === null ? 'missing' : device.includes('this tab'),
        tabSaysTab: tab === null ? 'missing' : tab.includes('this tab'),
      })
    }

    expect(seen).toEqual(
      RESIDUE.map((row) => ({
        screen: row.screen,
        direct: false,
        viaHelper: true,
        deviceSaysTab: false,
        tabSaysTab: true,
      })),
    )
  })

  it('DOS-179 review: the D10 hand-over dialog asks the store like every other keep verb', async () => {
    const screen = await read('../../../delivery-app/app/attention.tsx')
    const strings = await read('../../../delivery-app/src/strings.ts')
    const seen = HAND_OVER.map((row) => {
      const word = row.device.split('.').pop() ?? ''
      const device = valueOf(strings, row.device)
      const tab = valueOf(strings, row.tab)
      return {
        key: row.device,
        // The dialog never reaches for the phone's words itself, arguments or no arguments.
        direct: screen.includes(`t('${row.device}'`),
        // It asks THE STORE, through the same helper the buttons on D4 and D5 go through.
        viaHelper: screen.includes(`keepKey('${word}', status.persistent)`),
        // And the two words really are two: only one of them may name the phone.
        deviceSaysPhone: device === null ? 'missing' : device.includes('on this phone'),
        tabSaysPhone: tab === null ? 'missing' : tab.includes('on this phone'),
        tabSaysTab: tab === null ? 'missing' : tab.includes('this tab'),
      }
    })

    expect(seen).toEqual(
      HAND_OVER.map((row) => ({
        key: row.device,
        direct: false,
        viaHelper: true,
        deviceSaysPhone: true,
        tabSaysPhone: false,
        tabSaysTab: true,
      })),
    )
  })
})
