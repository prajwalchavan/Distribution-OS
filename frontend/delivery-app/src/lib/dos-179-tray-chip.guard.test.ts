/**
 * DOS-179 — the chip on a waiting op says where it really is.
 *
 * D10 draws one `StatusChip` per row of the outbox, labelled by `wordFor(t, row.status)`. For the
 * `queued` half that resolved to `word.queued` — **"On this phone"** — with no keep gate anywhere near
 * it. It is the same screen the DOS-178 commit repaired: twenty lines above this chip the tray prints
 * `tray.storeMemory`, "Held in memory only — a reload empties this device", and the hand-over dialog
 * below it was taken through `keepKey` one commit later. So on a browser with no OPFS the crew read the
 * store denying the keep at the top of the screen and a chip asserting it on every row underneath —
 * rows that include doorstep RECEIPTS, the money the office has not counted yet.
 *
 * The previous pass declined this one as "a vocabulary decision rather than a mechanical repair". It is
 * not a decision: never-list #12 and the founder's DOS-179 rule of 2026-09-19 already decided it. The
 * chip goes through `keepClaim` like every other keep claim in the three apps.
 *
 * `wordFor` builds its key from the VALUE (`word.${value}`), so a grep for `t('word.queued'` would never
 * have found this — which is why the chip survived two passes. What the guard asserts is that D10 no
 * longer labels an outbox row by its raw status at all.
 *
 * Read as SOURCE, like this app's other guards: importing a screen in Node pulls in `react-native`,
 * which resolves only under Metro, and `@types/node` is deliberately absent from an app.
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

/** One declared string's value, so the two words of a pair can be told apart by what they say. */
function valueOf(strings: string, key: string): string | null {
  const match = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'([^']*)'`).exec(strings)
  return match?.[1] ?? null
}

describe('DOS-179 the waiting chip on D10 says where the op really is', () => {
  it('DOS-179 word.queued has a tab twin, and only one of the two names the phone', async () => {
    const strings = await read('../strings.ts')
    const device = valueOf(strings, 'word.queued')
    const tab = valueOf(strings, 'word.queuedTab')

    expect({
      device,
      tabDeclared: tab !== null,
      deviceSaysPhone: device === null ? 'missing' : /this phone/i.test(device),
      tabSaysPhone: tab === null ? 'missing' : /this phone/i.test(tab),
      tabSaysTab: tab === null ? 'missing' : /this tab/i.test(tab),
    }).toEqual({
      device: 'On this phone',
      tabDeclared: true,
      deviceSaysPhone: true,
      tabSaysPhone: false,
      tabSaysTab: true,
    })
  })

  it('DOS-179 D10 never labels a waiting op by its raw status, and asks the store instead', async () => {
    const screen = await read('../../app/attention.tsx')

    expect({
      // `wordFor(t, row.status)` is the read that produced "On this phone" with nothing gating it.
      rawStatusLabel: /wordFor\(\s*t,\s*row\.status\s*\)/.test(screen),
      // The queued half asks the store, through the same helper the hand-over dialog below it uses.
      viaHelper: /keepKey\('waitingChip',\s*status\.persistent\)/.test(screen),
      // The sending half is not a keep claim at all and keeps its own word.
      sendingWord: /'word\.sending'/.test(screen),
      // And the device key is never reached for by name either.
      direct: /t\('word\.queued'/.test(screen),
    }).toEqual({
      rawStatusLabel: false,
      viaHelper: true,
      sendingWord: true,
      direct: false,
    })
  })
})
