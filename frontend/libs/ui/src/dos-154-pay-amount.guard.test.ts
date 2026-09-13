/**
 * DOS-154 (same class as DOS-146, DOS-124): the Pay screen's amount field kept showing the FULL dues
 * after bills were ticked, contradicting the bottom bar and the intent it was about to send —
 * `pay.tsx` computes `payable` correctly (`chosen.length > 0 ? chosenTotal : (amount ?? owed)`) and
 * uses it for the bottom bar and the Start button, but the RupeeInput itself was still wired to the
 * raw `amount ?? owed`, ignoring which bills were ticked. Per the DOS-146 verdict: fix this as one
 * value, never with a second `?? 0`.
 *
 * Merge-review blockers (Fable, 2026-09-13): the field's `onChange` was still bare `setAmount`, so an
 * emptied field reported `null` from the kit, `payable` fell back to `owed` again on the very next
 * render, and web's blur / the pad's Clear reformatted to the full dues — the exact snap-back the
 * DOS-146 verdict forbids. And a 0 typed by hand disabled Start with "Nothing is pending. You are
 * clear.", which is a lie while dues are still outstanding. Fixed: `onChange` maps an emptied field to
 * `0` (never leaves `null` to be re-read as "untouched"), and `disabledReason` gets a third branch —
 * outstanding dues with nothing entered reads "Enter an amount", never r3.noBills.
 *
 * The field-density RupeeInput frame (native, retailer's own touch) also rendered identically whether
 * or not it was disabled — the "Leave it as it is" helper was the only sign, easy to miss on a phone.
 *
 * Read as source: the retailer app has no test runner of its own, and native/money.tsx renders React
 * Native primitives this repo has no harness (react-test-renderer / RNTL) to mount under vitest.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('DOS-154: the Pay amount field shows what is actually payable', () => {
  const pay = readFileSync(join(here, '..', '..', '..', 'retailer-app', 'app', 'pay.tsx'), 'utf8')

  it('never wires the RupeeInput value to the raw amount, blind to ticked bills', () => {
    expect(pay).not.toMatch(/value=\{amount\s*\?\?\s*owed\}/)
  })

  it('wires it to the same `payable` the bottom bar and Start already agree on', () => {
    const rupeeInput = /<RupeeInput\b[\s\S]*?\/>/.exec(pay)?.[0] ?? ''
    expect(rupeeInput).toMatch(/value=\{payable\}/)
  })

  it('never wires onChange to bare setAmount, which lets an emptied field snap back to owed', () => {
    const rupeeInput = /<RupeeInput\b[\s\S]*?\/>/.exec(pay)?.[0] ?? ''
    expect(rupeeInput).not.toMatch(/onChange=\{setAmount\}/)
  })

  it('maps an emptied field (kit reports null) to 0, so it stays 0 rather than falling back to owed', () => {
    const rupeeInput = /<RupeeInput\b[\s\S]*?\/>/.exec(pay)?.[0] ?? ''
    expect(rupeeInput).toMatch(/onChange=\{[^}]*next\s*\?\?\s*0[^}]*\}/)
  })

  it('gives Start a third disabled reason — outstanding dues with nothing entered, not "you are clear"', () => {
    expect(pay).toMatch(/owed > 0/)
    expect(pay).toMatch(/r5\.enterAmount/)
  })
})

describe('DOS-154: the disabled Pay amount frame looks disabled (native, field density)', () => {
  const money = readFileSync(join(here, 'native', 'money.tsx'), 'utf8')
  const start = money.indexOf('export function RupeeInput(')
  const end = money.indexOf('\nexport function ', start + 1)
  const rupeeInput = money.slice(start, end === -1 ? money.length : end)

  it("dashes the field-density frame's border while disabled, the same convention TextInput uses", () => {
    expect(rupeeInput).toMatch(/borderStyle:\s*disabled\s*===\s*true\s*\?\s*'dashed'\s*:\s*'solid'/)
  })

  it('gives the amount a secondary tone while disabled, so it reads differently from an editable one', () => {
    expect(rupeeInput).toMatch(/tone=\{disabled === true \? 'secondary' : 'default'\}/)
  })
})
