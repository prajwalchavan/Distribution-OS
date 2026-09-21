/**
 * DOS-181 — at the shop door, "Record the delivery" did nothing.
 *
 * The prover read it as a dead `onPress` (the pressed style renders, so the view has the touch, and
 * still nothing is saved: no row, no outbox entry, no log line). The press was never dead. On the bill
 * it was measured with — SAI/0429 at Jain Kirana Mart, a `POST_FULFILLMENT` shop under the tenant's
 * `credit_only` proof-of-delivery policy — the screen took the press and refused it at
 * `if (podRequired && proof === null)`, wrote one sentence into `d4-error`, and returned. `d4-error`
 * is rendered at the END of the scrolling body, under the bill's lines and the whole proof panel:
 * on a Pixel 7 it sits roughly a screen and a half below the bottom bar the thumb just touched. No
 * haptic either. So the one refusal a driver meets on nearly every stop — a credit shop, no photo yet —
 * is the one the app says nothing about.
 *
 * THE CAUSE IS THAT THE SCREEN ACCEPTS A PRESS IT HAS ALREADY DECIDED TO REFUSE. Every other refusal
 * on this bill (already recorded, photo too big to travel, dropped + taken back not equal to the bill)
 * is a `disabled` button whose `disabledReason` the kit prints directly beneath it. The missing photo
 * was left out of that list, so it alone is enforced silently after the tap.
 *
 * These tests drive `doorstepFooter` — the one decision behind `d4-record` — and press it through the
 * very value the kit calls on release (`ButtonProps.onPress`). The last one reads the screen's source,
 * like `depart-confirm.test.ts`: importing a screen in Node pulls in `react-native` and `expo-router`,
 * which do not resolve outside Metro, and this app's ESLint config forbids a renderer import, so
 * nothing here may render the button for real.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions come in
 * through a non-literal specifier and their shapes are named here.
 */
import { createTranslator, wordFor } from '@dos/ui'
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { doorstepFooter, type DoorstepGate } from './doorstep'

const t = createTranslator('en', strings)

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** D4's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/delivery/stop/[id]/deliver.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names an element is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * SAI/0429 at Jain Kirana Mart, exactly as the Pixel 7 run had it: 444 pieces on the bill, all 444
 * going in, nothing recorded yet, and a credit shop — so the tenant's `credit_only` policy asks for a
 * photograph of the signed bill before this can be recorded.
 */
const creditShopNoPhoto: DoorstepGate = {
  alreadyRecorded: false,
  proofTooBig: false,
  photoRequired: true,
  hasPhoto: false,
  balanced: true,
}

/** What the footer did with the press, as the screen would have seen it. */
function press(
  gate: DoorstepGate,
  online = true,
  persistent: boolean | null = true,
): {
  disabled: boolean
  reason: string | undefined
  label: string
  recorded: number
  said: string[]
} {
  let recorded = 0
  const said: string[] = []
  const footer = doorstepFooter({
    t,
    gate,
    online,
    persistent,
    recordedOutcome: null,
    record: () => {
      recorded += 1
    },
    refuse: (sentence) => said.push(sentence),
  })
  footer.onPress()
  return {
    disabled: footer.disabled,
    reason: footer.disabledReason,
    label: footer.label,
    recorded,
    said,
  }
}

describe('D4 at the door: the footer never takes a press it will not act on', () => {
  it('DOS-181: at a credit shop with no photo yet, d4-record is refused BEFORE the press, with the credit sentence printed under the button', () => {
    const footer = doorstepFooter({
      t,
      gate: creditShopNoPhoto,
      online: true,
      persistent: true,
      recordedOutcome: null,
      record: () => {
        throw new Error('the doorstep write must not be attempted while the shop is owed a photo')
      },
      refuse: () => undefined,
    })
    expect(footer.label).toBe(t('d4.record'))
    expect(
      footer.disabled,
      'the button accepts a press it has already decided to refuse, so the driver gets nothing back',
    ).toBe(true)
    expect(
      footer.disabledReason,
      'the kit prints disabledReason under the button — this is the only place the driver is looking',
      // DOS-071 renamed this key: two policies, two sentences. The credit sentence is unchanged.
    ).toBe(t('d4.podRequiredCredit'))
  })

  it('DOS-181: the press REACHES the doorstep write — with the photo the shop is owed, pressing d4-record records the delivery', () => {
    const outcome = press({ ...creditShopNoPhoto, hasPhoto: true })
    expect(outcome.disabled).toBe(false)
    expect(outcome.reason).toBeUndefined()
    expect(outcome.recorded, 'the press did not reach the doorstep write').toBe(1)
    expect(outcome.said).toEqual([])
  })

  it('DOS-181: with no signal the press still reaches the write, and the button says which of the two is about to happen', () => {
    const outcome = press({ ...creditShopNoPhoto, hasPhoto: true }, false)
    expect(outcome.label).toBe(t('d4.recordOffline'))
    expect(outcome.recorded).toBe(1)
  })

  /*
   * DOS-179 / never-list #12, restored after the merge (merge review, 2026-09-20). The lane branched
   * before main routed this label through `keepKey`, and moving the label into `doorstepFooter` took
   * the keep claim back out with it: on a browser whose store is the memory fallback the offline
   * button would again read "Save on this phone" over a write that dies with the tab. The footer owns
   * the word now, so the footer asks the rule — and a store still opening (`null`) is a memory one,
   * because an OFFER may not promise a keep the device might not be able to make.
   */
  it('DOS-181 · DOS-179: with no signal the button promises a keep only on a store that keeps', () => {
    const ready = { ...creditShopNoPhoto, hasPhoto: true }
    expect(press(ready, false, true).label).toBe(t('d4.recordOffline'))
    expect(
      press(ready, false, false).label,
      'a browser with no persistent store was promised "Save on this phone"',
    ).toBe(t('d4.recordOfflineTab'))
    expect(
      press(ready, false, null).label,
      'a store still opening may not be offered as one that keeps',
    ).toBe(t('d4.recordOfflineTab'))
    // The words change; the write does not.
    expect(press(ready, false, false).recorded).toBe(1)
    // And online the button never names the phone at all.
    expect(press(ready, true, false).label).toBe(t('d4.record'))
  })

  it('DOS-181 · DOS-179: the screen hands the footer what the store turned out to be', async () => {
    const code = withoutComments(await readScreen())
    expect(code).toMatch(
      /const footer = doorstepFooter\(\{[\s\S]{0,400}?persistent: status\.persistent/,
    )
    // And no screen reads the phone's half of the pair by name (the @dos/offline guard's rule 5).
    expect(code).not.toContain("t('d4.recordOffline'")
  })

  it('DOS-181: a press that slips past the disabled state is refused OUT LOUD — nothing is written and the reason is said', () => {
    // The belt, on the value rather than through the screen: the kit's disabled button never calls
    // `onPress`, so nothing in the UI routes here today. It is asserted anyway because `onPress` is a
    // plain function anyone can hold, and a refusal it swallowed would be the original defect again.
    const outcome = press(creditShopNoPhoto)
    expect(outcome.recorded, 'a delivery was written while the shop was owed a photo').toBe(0)
    expect(outcome.said).toEqual([t('d4.podRequiredCredit')])
  })

  it('DOS-181: every refusal is named in the order the driver must fix it — recorded, then retake, then photo, then mismatch', () => {
    const recorded = doorstepFooter({
      t,
      gate: { ...creditShopNoPhoto, alreadyRecorded: true, balanced: false },
      online: true,
      persistent: true,
      recordedOutcome: 'delivered',
      record: () => undefined,
      refuse: () => undefined,
    })
    expect(recorded.disabledReason).toBe(t('d4.alreadyDone', { outcome: wordFor(t, 'delivered') }))

    expect(press({ ...creditShopNoPhoto, proofTooBig: true, hasPhoto: true }).reason).toBe(
      t('d4.podRetake'),
    )
    expect(press({ ...creditShopNoPhoto, hasPhoto: true, balanced: false }).reason).toBe(
      t('d4.mismatch'),
    )
    // Nothing is owed on a bill nobody can take: `podRequired` is already false on a failed drop.
    expect(press({ ...creditShopNoPhoto, photoRequired: false }).recorded).toBe(1)
  })

  it('DOS-181: the screen hands that decision straight to d4-record, and says a refusal where the thumb is', async () => {
    const code = withoutComments(await readScreen())

    // One rule for the footer, and the button is given it whole — no second opinion in between.
    expect(code).toMatch(/const footer = doorstepFooter\(/)
    expect(code).toMatch(/testID="d4-record"[\s\S]{0,400}?\{\.\.\.footer\}/)
    expect(code).toMatch(/record: commit/)
    expect(code).toMatch(/refuse: announce/)

    // A refusal is FELT as well as printed: every other dead end on this screen buzzes.
    expect(code).toMatch(/const announce[\s\S]{0,200}?haptics\.error\(\)[\s\S]{0,120}?setError\(/)

    // And it is printed in the bottom bar, above the button — not at the end of a long scroll.
    // `lastIndexOf`: the "nothing here yet" screen at the top of D4 carries the same testID.
    const bodyStartsAt = code.lastIndexOf('testID="d4-screen"')
    const bar = code.slice(code.indexOf('bottomBar={'), bodyStartsAt)
    expect(bar.length, 'the bottom bar could not be found in D4').toBeGreaterThan(0)
    expect(bar).toContain('testID="d4-error"')
    expect(bar.indexOf('testID="d4-error"')).toBeLessThan(bar.indexOf('testID="d4-record"'))
    expect(
      code.slice(bodyStartsAt),
      'the refusal is still written at the end of the body, where a driver cannot see it',
    ).not.toContain('testID="d4-error"')
  })
})
