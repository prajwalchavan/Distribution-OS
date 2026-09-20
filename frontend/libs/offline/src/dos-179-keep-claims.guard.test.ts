/**
 * DOS-179 — ONE repo-wide rule: no app says a phone, a device or a browser is holding something unless
 * `keepClaim` has been asked first.
 *
 * Never-list #12 (founder, 2026-09-19): the app never tells someone their work is saved on the device
 * when it is not. Two passes fixed the claims each pass happened to look at, and a third read of the
 * rendered screens found two more — `d8.pending` on D1 and D8, and the chip on every waiting row of D10,
 * both on screens whose own `ConnectionStrip` was already saying the opposite in the same render. A
 * per-screen list cannot stop that: it only ever holds what somebody remembered to add.
 *
 * So this guard reads the STRING CATALOGUES, which is where a claim is born. Every app's `src/strings.ts`
 * is scanned for the vocabulary of holding — "this phone", "this device", "this browser", "the phone" —
 * and each key that matches must be classified below as exactly one of:
 *
 *   keep      a claim that this device is holding something → routed through `keepKey` (which asks
 *             `keepClaim`), with a tab twin, and never read by name outside `src/lib/keep.ts`.
 *   store     the honest statement ABOUT the store, printed only under a resolved `persistent` gate
 *             (the DOS-167 guards own those render sites).
 *   leave     a body of the sign-out sheet, chosen by `leaveSentence`, which asks `keepClaim` and swaps
 *             the whole body for `leave.bodyMemory` on anything but a store that keeps.
 *   absent    says the device does NOT hold something. It cannot mislead anyone into trusting a keep.
 *   hardware  about the machine, the session or the channel — a camera, a signed-in device, a phone call.
 *   progress  a pull in flight ("still filling this phone"), an action rather than a keep.
 *
 * A NEW string with any of that vocabulary fails this test until someone classifies it, and classifying
 * it `keep` is what forces the twin, the routing and the screen check. That is the fail-closed half. The
 * judgement of WHICH kind a sentence is stays human — but it is made once, here, in the open, instead of
 * seven times in seven screens.
 *
 * It lives in `@dos/offline` because `keepClaim` does: this package owns the rule, and all seven apps
 * are read from here rather than the rule being copied into each of them. Read as SOURCE — importing an
 * app pulls in `react-native`, which resolves only under Metro — and `@types/node` is deliberately not a
 * dependency of this package, so the Node functions come in through non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

interface Dirent {
  readonly name: string
  isDirectory: () => boolean
  isFile: () => boolean
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
  readdirSync: (path: string, options: { withFileTypes: true }) => Dirent[]
  existsSync: (path: string) => boolean
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function fs(): Promise<NodeFs> {
  return (await import(NODE_FS)) as NodeFs
}

/** An absolute path inside the repo, from a specifier relative to this file. */
async function at(relative: string): Promise<string> {
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return fileURLToPath(new URL(relative, import.meta.url))
}

/** Source with its comments taken out: a comment may quote the very string it explains. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Every `'key': 'value'` of a strings catalogue, comments already gone. */
function catalogue(source: string): Map<string, string> {
  const found = new Map<string, string>()
  const entry = /'([A-Za-z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g
  let match: RegExpExecArray | null
  while ((match = entry.exec(source)) !== null) found.set(match[1] ?? '', match[2] ?? '')
  return found
}

/** Every `{ device, tab }` pair an app's `keep.ts` declares. */
function keepPairs(source: string): Map<string, string> {
  const pairs = new Map<string, string>()
  const entry = /\{\s*device:\s*'([A-Za-z0-9_.]+)',\s*tab:\s*'([A-Za-z0-9_.]+)'\s*\}/g
  let match: RegExpExecArray | null
  while ((match = entry.exec(source)) !== null) pairs.set(match[1] ?? '', match[2] ?? '')
  return pairs
}

/** Every `.ts`/`.tsx` of an app that a person can see the output of: no tests, no `keep.ts` itself. */
async function screenSources(root: string): Promise<{ path: string; code: string }[]> {
  const node = await fs()
  const out: { path: string; code: string }[] = []
  const walk = (dir: string, shown: string): void => {
    if (!node.existsSync(dir)) return
    for (const entry of node.readdirSync(dir, { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`
      const label = `${shown}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(next, label)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      if (label.endsWith('/src/lib/keep.ts')) continue
      out.push({ path: label, code: withoutComments(node.readFileSync(next, 'utf8')) })
    }
  }
  walk(`${root}/app`, 'app')
  walk(`${root}/src`, 'src')
  return out
}

/** The words that say a machine is holding something. Broad on purpose: a claim is born in the words. */
const DEVICE_WORDS = /\b(this|the)\s+(phone|device|browser)\b/i

type Kind = 'keep' | 'store' | 'leave' | 'absent' | 'hardware' | 'progress'

/**
 * Every string in the seven apps that names a phone, a device or a browser, and what kind of sentence it
 * is. The three field apps write offline and carry the keeps; the other four write nothing offline, and
 * are here so that the first keep claim anyone adds to them fails this test instead of shipping.
 */
const CLASSIFIED: Readonly<Record<string, Readonly<Partial<Record<Kind, readonly string[]>>>>> = {
  delivery: {
    keep: [
      'd.savedOnPhone',
      'd.offlineWrite',
      'd1.trackingHeld',
      'd4.recordOffline',
      'd5.recordOffline',
      'd5.recordedQueued',
      'd8.pending',
      'd8.pendingBlocks',
      'd8.uncounted',
      'd8.uncountedSettled',
      'd12.tablesLabel',
      'tray.waitingOnPhone',
      'tray.handOverBody',
      'tray.handOverBodyNoBook',
    ],
    store: ['tray.storeDisk', 'tray.storeMemory'],
    leave: [
      'leave.bodySignOut',
      'leave.bodySignOutRefused',
      'leave.bodySignOutBoth',
      'leave.bodySwitch',
      'leave.bodySwitchRefused',
      'leave.bodySwitchBoth',
      'leave.bodyMemory',
    ],
    absent: [
      'd.billNotHere',
      'd1.trackingDenied',
      'd6.unknown',
      'd11.notThisPhone',
      'tray.notOnPhone',
      'tray.moneyNotOnPhone',
    ],
    hardware: [
      'app.rememberDevice',
      'd4.podNoCamera',
      'd9.shared',
      'd12.thisDevice',
      'd12.noDevices',
      'd12.revoke',
    ],
    progress: ['d.filling', 'd.tripProvisional', 'd.waitForFill'],
  },
  sales: {
    keep: [
      's0.offlineNote',
      's3.queue',
      's3.queued',
      's3.queuedTitle',
      /*
       * DOS-086 (merge review, 2026-09-20) gave this body the phone's verb — the held order now reads
       * "…and this phone submits it the moment it lands" instead of sending the rep to My orders to do
       * it by hand. It was already the device half of `keepWords.queuedBody`; saying so here is what
       * makes the twin, the routing and the screen check apply to the sentence as well as the title.
       */
      's3.queuedBody',
      's3.addItemsMeta',
      's5.deviceTotal',
      's5.queuedExplain',
      's5.trayOffline',
      's11.stockNeedsSignal',
      's12.offline',
    ],
    store: ['s0.notPersisted'],
    leave: [
      'leave.bodySignOut',
      'leave.bodySignOutRefused',
      'leave.bodySignOutBoth',
      'leave.bodySwitch',
      'leave.bodySwitchRefused',
      'leave.bodySwitchBoth',
      'leave.bodyMemory',
    ],
    absent: [
      's0.catalogMissing',
      's2.noShops',
      's2.notOnDevice',
      's2.visitNeedsSignal',
      's3.unpriced',
      's5.notOnDevice',
      's9.targetsMeta',
      's11.empty',
    ],
    hardware: ['x4.thisDevice'],
    /*
     * `s3.draftBody` joins the two of these for the same reason `s0.filling` is here: DOS-086's sweep
     * is an ACTION the device is taking ("this phone is submitting it now"), over an order the same
     * sentence says the OFFICE already has. It claims no keep — the opposite — so it needs no tab twin.
     */
    progress: ['s0.filling', 's3.draftBody', 's4.appliesAfterSync'],
  },
  warehouse: {
    keep: ['w.savedOnDevice', 'w5.offlineNote', 'x4.tables', 'x4.tablesLabel'],
    store: ['x4.storeDisk', 'x4.storeMemory'],
    leave: [
      'leave.bodySignOut',
      'leave.bodySignOutRefused',
      'leave.bodySignOutBoth',
      'leave.bodySwitch',
      'leave.bodySwitchRefused',
      'leave.bodySwitchBoth',
      'leave.bodyMemory',
    ],
    absent: ['w.unknownItem'],
    hardware: ['x4.thisDevice', 'x4.noDevices', 'w.scanUnavailable'],
    progress: ['w.filling'],
  },
  owner: { hardware: ['word.device'] },
  manager: { hardware: ['x4.thisDevice', 'word.device', 'm3.captureHint'] },
  retailer: {
    absent: ['app.onlineOnly', 'r5.noUpiApp'],
    hardware: ['x4.revoke', 'word.phone'],
  },
  admin: { hardware: ['p9.thisDevice'] },
}

/** The three apps that write offline: they own a `keep.ts` and a leave sheet. */
const FIELD_APPS = ['delivery', 'sales', 'warehouse'] as const

interface Problem {
  readonly app: string
  readonly key: string
  readonly wrong: string
}

describe('DOS-179 no app claims a keep without asking keepClaim', () => {
  it('DOS-179 every phone-word string in every app is classified, and every keep claim is routed', async () => {
    const node = await fs()
    const problems: Problem[] = []

    for (const [app, kinds] of Object.entries(CLASSIFIED)) {
      const root = await at(`../../../${app}-app`)
      const strings = catalogue(
        withoutComments(node.readFileSync(`${root}/src/strings.ts`, 'utf8')),
      )
      const keepFile = `${root}/src/lib/keep.ts`
      const pairs = node.existsSync(keepFile)
        ? keepPairs(withoutComments(node.readFileSync(keepFile, 'utf8')))
        : new Map<string, string>()
      const tabHalves = new Set(pairs.values())

      const declared = new Map<string, Kind>()
      for (const [kind, keys] of Object.entries(kinds)) {
        for (const key of keys ?? []) {
          if (declared.has(key)) problems.push({ app, key, wrong: 'classified twice' })
          declared.set(key, kind as Kind)
        }
      }

      // 1. The catalogue is the source of truth: nothing with the vocabulary may go unclassified.
      for (const [key, value] of strings) {
        if (!DEVICE_WORDS.test(value)) continue
        if (tabHalves.has(key)) continue
        if (!declared.has(key)) {
          problems.push({ app, key, wrong: `unclassified device claim: ${value.slice(0, 70)}` })
        }
      }

      // 2. And the register does not rot: a key that no longer exists has to leave it.
      for (const key of declared.keys()) {
        if (!strings.has(key))
          problems.push({ app, key, wrong: 'classified but no longer a string' })
      }

      const sources = await screenSources(root)
      for (const [key, kind] of declared) {
        if (kind !== 'keep') continue

        // 3. A keep claim is a device half of a pair, with a tab twin that really exists…
        const tab = pairs.get(key)
        if (tab === undefined) {
          problems.push({ app, key, wrong: 'a keep claim with no keepKey pair in src/lib/keep.ts' })
          continue
        }
        if (!strings.has(tab)) {
          problems.push({ app, key, wrong: `tab twin ${tab} is not declared` })
          continue
        }

        // 4. …a twin that does NOT name the machine, or the pair says the same thing twice.
        if (DEVICE_WORDS.test(strings.get(tab) ?? '')) {
          problems.push({ app, key, wrong: `tab twin ${tab} names the device too` })
        }

        // 5. And nothing outside keep.ts reaches for the phone's half by name — that read IS the lie.
        for (const source of sources) {
          if (source.code.includes(`t('${key}'`)) {
            problems.push({ app, key, wrong: `read directly in ${source.path}` })
          }
        }

        /*
         * 6. A keep claim may not live in the `word.` namespace. `wordFor` builds its key from the VALUE
         * (`word.${value}`), so a claim there is reachable with no screen ever naming it — which is
         * exactly how the chip on D10 survived two passes of this sweep.
         */
        if (key.startsWith('word.')) {
          problems.push({
            app,
            key,
            wrong: 'a keep claim under `word.`, reachable through wordFor',
          })
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('DOS-179 the sign-out sheet asks keepClaim too, in all three field apps', async () => {
    const node = await fs()
    const seen: Record<string, unknown>[] = []
    for (const app of FIELD_APPS) {
      const root = await at(`../../../${app}-app`)
      const leave = withoutComments(node.readFileSync(`${root}/src/lib/leave.ts`, 'utf8'))
      seen.push({
        app,
        // The rule comes from the library, not from a second copy of `persistent === false || null`.
        imports: /import\s*\{[^}]*\bkeepClaim\b[^}]*\}\s*from\s*'@dos\/offline'/.test(leave),
        // And it is what chooses between the six "stays on this phone" bodies and `leave.bodyMemory`.
        asks: /keepClaim\(\s*input\.persistent\s*\)\s*===\s*'device'/.test(leave),
        handWritten: /persistent\s*===\s*false\s*\|\|\s*input\.persistent\s*===\s*null/.test(leave),
      })
    }

    expect(seen).toEqual(
      FIELD_APPS.map((app) => ({ app, imports: true, asks: true, handWritten: false })),
    )
  })
})
