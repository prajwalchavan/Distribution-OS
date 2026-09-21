/**
 * DOS-149 — THE DRIVER READS THE OUTCOME ON THE SCREEN HE LANDS ON.
 *
 * Measured on the Pixel 7: a part delivery recorded at 03:24:58 wrote CN/9007 and answered 200, and the
 * driver saw no toast at all. D4's `onSuccess` set the toast into its OWN state and then `router.replace`d
 * away from the screen that would have drawn it, so the one sentence naming the credit note was rendered
 * for less than a frame on a screen already being torn down. The stop he landed on said nothing.
 *
 * So D4 and D5 do not raise toasts. They hand the outcome to the stop screen — the screen that is still
 * there a second later — and D3 says it. The credit note is named by its NUMBER, `item.creditNote`, not
 * by the first eight characters of a UUID: "CN/9007" is what the shopkeeper is holding.
 *
 * Read as SOURCE, in the style of `dos-179-trip-close.guard.test.ts`: importing a screen in Node pulls
 * in `react-native`, which resolves only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { DOOR_DONE_CLEARED, doorDoneHref, doorDoneMessage } from './at-the-door'

/** The delivery app's own catalogue, as `<ThemeProvider>` merges it: key in, sentence out. */
const t = (key: string, vars?: Record<string, string | number>): string => {
  const line = (strings as Record<string, string>)[key] ?? key
  return vars === undefined
    ? line
    : line.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole))
}

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

describe('DOS-149 the doorstep outcome is said on the stop screen', () => {
  it('DOS-149 D4 and D5 raise no toast of their own and hand every outcome to the stop they replace', async () => {
    const screens = [
      { name: 'deliver', source: await read('../../../../app/delivery/stop/[id]/deliver.tsx') },
      { name: 'collect', source: await read('../../../../app/delivery/stop/[id]/collect.tsx') },
    ]

    const seen = screens.map(({ name, source }) => {
      // Prettier wraps a long call over several lines, so each departure is read as the 120
      // characters that follow it, not as the rest of its own line.
      const replaces = [...source.matchAll(/router\.replace\(/g)].map((hit) =>
        source.slice(hit.index, hit.index + 120),
      )
      return {
        name,
        // Nothing is said on a screen that is about to be replaced.
        setsToast: /setToast\(/.test(source),
        drawsToast: /<Toast\b/.test(source),
        // Every departure from this screen carries what happened to the screen that stays.
        replaces: replaces.length,
        handsOver: replaces.filter((line) => line.includes('doorDoneHref(')).length,
      }
    })

    expect(seen).toEqual([
      { name: 'deliver', setsToast: false, drawsToast: false, replaces: 2, handsOver: 2 },
      { name: 'collect', setsToast: false, drawsToast: false, replaces: 2, handsOver: 2 },
    ])
  })

  it('DOS-149 D4 names the credit note by its NUMBER, never by a slice of its id', async () => {
    const deliver = await read('../../../../app/delivery/stop/[id]/deliver.tsx')
    expect(deliver).toMatch(/creditNote\?\.creditNoteNo/)
    expect(deliver).not.toMatch(/creditNoteId\.slice\(/)
  })

  it('DOS-149 the credit note travels by number and comes back as the sentence naming it', () => {
    expect(doorDoneHref('stop-1', { code: 'credit', note: 'CN/9007' })).toBe(
      '/stop/stop-1?done=credit&doneNo=CN%2F9007',
    )
    expect(doorDoneMessage(t, true, { done: 'credit', doneNo: 'CN/9007' })).toBe(
      'Credit note CN/9007 raised for what did not go in',
    )
    // A full drop raises no note and says so; a note the office has not numbered still says something.
    expect(doorDoneHref('stop-1', { code: 'delivered' })).toBe('/stop/stop-1?done=delivered')
    expect(doorDoneMessage(t, true, { done: 'delivered' })).toBe('Delivery recorded')
    expect(doorDoneMessage(t, true, { done: 'credit' })).toBe('Delivery recorded')
  })

  it('DOS-149 an offline write is worded against the store the DESTINATION turned out to have', () => {
    // Never-list #12: the keep is decided again where the sentence is drawn, never carried in the route.
    expect(doorDoneMessage(t, true, { done: 'kept' })).toBe(
      'Saved on this phone. It goes as soon as there is a signal.',
    )
    expect(doorDoneMessage(t, false, { done: 'kept' })).toBe(
      'Held in this tab only — not saved. It goes as soon as there is a signal; close this tab and it is gone.',
    )
    // A store that has not resolved is treated exactly as a memory one (DOS-167 ruling 3 (ee)).
    expect(doorDoneMessage(t, null, { done: 'kept' })).toBe(
      doorDoneMessage(t, false, { done: 'kept' }),
    )
    expect(doorDoneMessage(t, true, { done: 'moneyKept', doneNo: 'B-114' })).toBe(
      'Receipt B-114 written on this phone',
    )
    expect(doorDoneMessage(t, false, { done: 'moneyKept', doneNo: 'B-114' })).toBe(
      'Receipt B-114 held in this tab only',
    )
    expect(doorDoneMessage(t, true, { done: 'money', doneNo: 'RCP/0042' })).toBe('Receipt RCP/0042')
  })

  it('DOS-149 a stop opened in the ordinary way, or with a code this app never wrote, says nothing', () => {
    expect(doorDoneMessage(t, true, {})).toBeNull()
    expect(doorDoneMessage(t, true, { done: 'delivered-everything-to-everyone' })).toBeNull()
    expect(doorDoneMessage(t, true, { done: 'd4.recorded' })).toBeNull()
    // A receipt handed over with no number to name says nothing rather than half a sentence.
    expect(doorDoneMessage(t, true, { done: 'money' })).toBeNull()
    // Expo-router hands a repeated parameter back as an array; the first one is the answer.
    expect(doorDoneMessage(t, true, { done: ['delivered', 'kept'] })).toBe('Delivery recorded')
  })

  /**
   * MINOR 1 (merge review, 2026-09-20) — A DISMISSED HANDOVER IS NOT SAID A SECOND TIME.
   *
   * `handoffSeen` lives in the mount: a reload of the stop, or walking back to an earlier instance of
   * it, reads the same `done`/`doneNo` off the route and announces a credit note the driver has
   * already read, beside the bill that now plainly shows it. The dismissal therefore strips both
   * parameters. The integration verifier reversed that line and no test noticed; these two are why it
   * cannot happen again — what the strip DOES (the message goes silent, for every code that had one),
   * and that the dismissal is the thing that does it.
   */
  it('DOS-149 minor 1 — every handover goes silent once the route parameters are cleared', () => {
    const said = [
      { done: 'delivered' },
      { done: 'credit', doneNo: 'CN/9007' },
      { done: 'kept' },
      { done: 'money', doneNo: 'RCP/0042' },
      { done: 'moneyKept', doneNo: 'B-114' },
    ]
    for (const params of said) {
      // It is said once…
      expect(doorDoneMessage(t, true, params)).not.toBeNull()
      // …and the dismissal leaves a route that says nothing, on this mount or the next one.
      expect(doorDoneMessage(t, true, { ...params, ...DOOR_DONE_CLEARED })).toBeNull()
      expect(doorDoneMessage(t, false, { ...params, ...DOOR_DONE_CLEARED })).toBeNull()
    }
    expect(DOOR_DONE_CLEARED).toEqual({ done: undefined, doneNo: undefined })
  })

  it('DOS-149 minor 1 — dismissing the toast on D3 both marks it seen and clears the route', async () => {
    const stop = await read('../../../../app/delivery/stop/[id]/index.tsx')
    const hit = stop.indexOf('onDismiss={')
    expect(hit).toBeGreaterThan(-1)
    const dismissal = stop.slice(hit, hit + 200)
    expect(dismissal).toContain('setHandoffSeen(true)')
    expect(dismissal).toContain('router.setParams(DOOR_DONE_CLEARED)')
  })

  it('DOS-149 D3 says what the driver has just done, and still says its own arrivals', async () => {
    const stop = await read('../../../../app/delivery/stop/[id]/index.tsx')
    // The handed-over sentence, resolved on the screen that draws it.
    expect(stop).toMatch(/doorDoneMessage\(/)
    // D3's own writes ("I am at the shop", "Nothing delivered") keep the toast they always had.
    expect(stop).toMatch(/setToast\(/)
    expect(stop).toMatch(/<Toast\b/)
  })
})
