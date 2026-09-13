/**
 * DOS-154 (same class as DOS-146, DOS-124): the Pay screen's amount field kept showing the FULL dues
 * after bills were ticked, contradicting the bottom bar and the intent it was about to send —
 * `pay.tsx` computes `payable` correctly (`chosen.length > 0 ? chosenTotal : (amount ?? owed)`) and
 * uses it for the bottom bar and the Start button, but the RupeeInput itself was still wired to the
 * raw `amount ?? owed`, ignoring which bills were ticked. Per the DOS-146 verdict: fix this as one
 * value, never with a second `?? 0`.
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
