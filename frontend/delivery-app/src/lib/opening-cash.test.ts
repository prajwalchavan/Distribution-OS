/**
 * DOS-146 — "Cash handed to you" on D2 Start the trip can hold any float, ₹0 included.
 *
 * The trip is shaped like sai-distributors TRIP-NEXT in dos_qa on 13 Sep 2026: planned, float ₹3,000
 * (300000 paise), driven by sachin.dalvi. The figures are literals, never read from a database.
 *
 * The pad and the web field are driven through the kit's own helpers from `@dos/ui` (the renderer
 * Metro would pick is not named: `parity.test.ts` pins both `<NumberPad>`s to these helpers). The
 * screen itself cannot be imported in Node (it pulls in `react-native` and `expo-router`), so the
 * last test reads its source, like `sales-app/src/order-entry-layout.test.ts`.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions the screen
 * guard needs are imported through a non-literal specifier and their shapes are named here.
 */
import {
  formatPadEntry,
  padEntryFromPaise,
  paiseFromPadEntry,
  parseRupees,
  pressMoneyPadKey,
  reconcilePadEntry,
  speakMoney,
  toEditableRupees,
  type MoneyPadKey,
} from '@dos/ui'
import { describe, expect, it } from 'vitest'

import { openingCashEntered, openingCashShown } from './opening-cash'

/** sai-distributors TRIP-NEXT: the float planned at the office. */
const PLANNED = 300000
/** What the cashier actually handed over. */
const HANDED = 475600

interface Driven {
  /** The pad's live preview. */
  readonly preview: string
  /** The preview's accessibility label. */
  readonly spoken: string
  /** The value the field holds when the pad closes (Done or back). */
  readonly held: number | null
  /** What `depart` is given; `null` means the key is left out. */
  readonly sent: number | null
}

/**
 * The controlled loop the native `<NumberPad>` (money mode) and the screen run together: the pad
 * mounts on the field's value, every key reconciles the typed entry with that value first, the pad
 * reports `paiseFromPadEntry(entry)`, and the screen stores it and renders the field again.
 */
function drive(planned: number, keys: readonly MoneyPadKey[]): Driven {
  let entered: number | null = null
  let shown = openingCashShown(entered, planned)
  let entry = padEntryFromPaise(shown)
  for (const key of keys) {
    const current = reconcilePadEntry(entry, shown)
    entry = pressMoneyPadKey(current, key)
    entered = openingCashEntered(paiseFromPadEntry(entry))
    shown = openingCashShown(entered, planned)
  }
  const onScreen = reconcilePadEntry(entry, shown)
  return {
    preview: formatPadEntry(onScreen),
    spoken: speakMoney(paiseFromPadEntry(onScreen) ?? 0),
    held: shown,
    sent: entered,
  }
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The Start-the-trip screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../../app/trip/start.tsx', import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes the old fallback is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('D2 Start the trip: the float in "Cash handed to you"', () => {
  it('DOS-146: on TRIP-NEXT planned with a ₹3,000 float, opening the pad, Clear, then 4 7 5 6 and Done holds ₹4,756 (475600 paise), not ₹3,00,04,756', () => {
    const typed = drive(PLANNED, ['clear', '4', '7', '5', '6'])
    expect(typed.preview).toBe('₹4,756')
    expect(typed.spoken).toBe('4756 rupees')
    expect(typed.held).toBe(HANDED)
    expect(typed.sent).toBe(HANDED)
  })

  it("DOS-146: Clear on the pre-filled ₹3,000 previews ₹0 ('0 rupees') and holds 0, and ⌫ eight times from ₹4,756 ends at ₹0 with Done leaving 0 to send, never the planned 300000 again", () => {
    const cleared = drive(PLANNED, ['clear'])
    expect(cleared.preview).toBe('₹0')
    expect(cleared.spoken).toBe('0 rupees')
    expect(cleared.held).toBe(0)
    expect(cleared.sent).toBe(0)

    const backspaced = drive(PLANNED, [
      'clear',
      '4',
      '7',
      '5',
      '6',
      ...Array<MoneyPadKey>(8).fill('back'),
    ])
    expect(backspaced.preview).toBe('₹0')
    expect(backspaced.spoken).toBe('0 rupees')
    expect(backspaced.held).toBe(0)
    expect(backspaced.sent).toBe(0)

    // ⌫ down to nothing without Clear first: the plan does not come back either.
    const emptied = drive(PLANNED, ['back', 'back', 'back', 'back', 'back'])
    expect(emptied.held).toBe(0)
    expect(emptied.sent).toBe(0)

    // After Clear, digits start a new amount (the lone 0 is replaced, not appended to).
    expect(drive(PLANNED, ['clear', '4']).held).toBe(400)
  })

  it("DOS-146 guard: an untouched field shows the planned 300000 and sends nothing (depart keeps trips.opening_cash_paise); a touched field keeps the driver's entry when the trip is re-read with the plan", () => {
    // Opened and closed with no key pressed: the plan is shown and the key is left out of depart.
    const untouched = drive(PLANNED, [])
    expect(untouched.preview).toBe('₹3,000')
    expect(untouched.spoken).toBe('3000 rupees')
    expect(untouched.held).toBe(PLANNED)
    expect(untouched.sent).toBeNull()

    // Before the trip has loaded there is no plan to show.
    expect(openingCashShown(null, undefined)).toBeNull()
    expect(openingCashShown(null, null)).toBeNull()

    // The trip is read again after "Tell the godown to load": the driver's entry stays.
    expect(openingCashShown(HANDED, PLANNED)).toBe(HANDED)
    expect(openingCashShown(0, PLANNED)).toBe(0)
    expect(openingCashEntered(HANDED)).toBe(HANDED)
  })

  it('DOS-146: an emptied web field (onChange(null)) holds 0, so blur formats it as 0.00 instead of snapping back to 3000.00', () => {
    // The web `<RupeeInput>` mounts on the field's value.
    let entered: number | null = null
    let value = openingCashShown(entered, PLANNED)
    expect(toEditableRupees(value)).toBe('3000.00')

    // Select all, delete: an empty text reports onChange(null).
    const emptiedText = ''
    const parsed = parseRupees(emptiedText)
    expect(parsed).toEqual({ ok: false, reason: 'empty' })
    entered = openingCashEntered(null)
    value = openingCashShown(entered, PLANNED)

    // Blur: an empty text is replaced by the value the screen now holds.
    const onBlur = parseRupees(emptiedText)
    expect(onBlur.ok ? toEditableRupees(onBlur.paise) : toEditableRupees(value)).toBe('0.00')
    expect(value).toBe(0)
    expect(entered).toBe(0)

    // Then 4756 typed and blurred reads 4756.00.
    const typed = parseRupees('4756')
    expect(typed).toEqual({ ok: true, paise: HANDED })
    entered = openingCashEntered(typed.ok ? typed.paise : null)
    value = openingCashShown(entered, PLANNED)
    expect(toEditableRupees(value)).toBe('4756.00')
  })

  it("DOS-146: trip/start.tsx renders, edits and confirms 'Cash handed to you' through openingCashShown/openingCashEntered, with no `cashPaise ?? detail?.openingCashPaise` fallback left and depart still leaving out only a null float", async () => {
    const code = withoutComments(await readScreen())

    // No render-time fallback from an emptied entry to the plan is left anywhere.
    expect(code).not.toMatch(/cashPaise\s*\?\?\s*detail\?\.openingCashPaise/)

    expect(code).toMatch(
      /import\s*\{[^}]*\bopeningCashEntered\b[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/lib\/opening-cash'/,
    )
    expect(code).toMatch(
      /import\s*\{[^}]*\bopeningCashShown\b[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/lib\/opening-cash'/,
    )

    // The field's value and the confirm body read the float through the same rule.
    const shown = code.match(
      /openingCashShown\(\s*cashPaise\s*,\s*detail\?\.openingCashPaise\s*,?\s*\)/g,
    )
    expect(shown ?? []).toHaveLength(2)

    // The field stores an emptied entry as 0 through the helper.
    const field = code.match(/<RupeeInput\b[^>]*?testID="d2-cash"[\s\S]*?\/>/)
    expect(field, 'the d2-cash <RupeeInput> is not in app/trip/start.tsx').not.toBeNull()
    expect(field?.[0] ?? '').toMatch(
      /onChange=\{\s*\(\s*next\s*\)\s*=>\s*\{?\s*setCashPaise\(\s*openingCashEntered\(\s*next\s*\)\s*\)\s*;?\s*\}?\s*\}/,
    )
    expect(field?.[0] ?? '').toMatch(
      /value=\{\s*openingCashShown\(\s*cashPaise\s*,\s*detail\?\.openingCashPaise\s*,?\s*\)\s*\}/,
    )

    // Depart leaves the float out only when it is null (never a falsy check, so 0 is sent).
    expect(code).toMatch(
      /\.\.\.\(\s*input\.cashPaise\s*===\s*null\s*\?\s*\{\s*\}\s*:\s*\{\s*openingCashPaise:\s*input\.cashPaise\s*\}\s*\)/,
    )
  })
})
