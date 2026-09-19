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
    ],
    screens: ['app/orders/new.tsx', 'app/orders/attention.tsx'],
  },
  {
    root: '../../../delivery-app',
    pairs: [
      { device: 'd.savedOnPhone', tab: 'd.savedOnPhoneTab' },
      { device: 'd4.recordOffline', tab: 'd4.recordOfflineTab' },
      { device: 'd5.recordOffline', tab: 'd5.recordOfflineTab' },
      { device: 'd5.recordedQueued', tab: 'd5.recordedQueuedTab' },
    ],
    screens: ['app/stop/[id]/collect.tsx', 'app/stop/[id]/deliver.tsx', 'app/stop/[id]/index.tsx'],
  },
  {
    root: '../../../warehouse-app',
    pairs: [{ device: 'w.savedOnDevice', tab: 'w.savedOnDeviceTab' }],
    screens: ['app/pick/[id].tsx'],
  },
]

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
        // No screen reaches for the device word itself — that read IS the lie.
        direct: app.screens.flatMap((path, index) =>
          app.pairs
            .filter((pair) => (screens[index] ?? '').includes(`t('${pair.device}')`))
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
})
