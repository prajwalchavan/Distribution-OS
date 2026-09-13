/**
 * DOS-105: words that mislead a shopkeeper.
 *
 * - A credit note reduces what the shop pays, but `returns.tsx` and `bills/[id].tsx` both printed
 *   `word(note.state)` — the SAME flat `word.<value>` lookup an invoice's `issued` state also uses
 *   (`word.issued` = "To pay"), so a credit note in state `issued` (finalised, the common case) read
 *   as if it were a bill still owed. The credit note's own state needs its own words.
 * - A cancelled order kept its bottom bar reading "You pay {total}" with nothing left to pay.
 * - A bargain the SALESPERSON raised on the shop's behalf read "You asked", when the shop asked
 *   nothing (`Bargain.requestedBy` names who actually asked).
 * - The cancel-order dialog offered "Cancel" beside "Cancel this order" — on a phone the plain one
 *   reads like a confirm. `DialogProps` already carries `cancelLabel`.
 *
 * Read as source: the retailer app has no test runner of its own to render these screens.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const retailerApp = join(here, '..', '..', '..', 'retailer-app', 'app')

function read(path: string): string {
  return readFileSync(join(retailerApp, path), 'utf8')
}

describe('DOS-105: a credit note is never badged with the invoice word for "issued"', () => {
  it('returns.tsx no longer runs a credit note state through the shared word() lookup', () => {
    expect(read('returns.tsx')).not.toMatch(/word\(note\.state\)/)
  })

  it("bills/[id].tsx's credit notes panel no longer runs a note state through word() either", () => {
    expect(read('bills/[id].tsx')).not.toMatch(/word\(note\.state\)/)
  })
})

describe('DOS-105: a cancelled order carries no "You pay"', () => {
  it("the order detail's bottom bar is conditioned on the order not being cancelled", () => {
    const source = read('orders/[id].tsx')
    const bar = /bottomBar=\{[\s\S]*?\n {6}\}\n/.exec(source)?.[0] ?? ''
    expect(bar.length).toBeGreaterThan(0)
    expect(bar).toMatch(/detail\.state\s*(!==|===)\s*'cancelled'/)
  })
})

describe('DOS-105: a bargain says who actually asked', () => {
  it("deals.tsx compares a bargain's requestedBy against the signed-in user", () => {
    const source = read('deals.tsx')
    expect(source).toMatch(/requestedBy\s*(!==|===)\s*session/)
  })
})

describe('DOS-105: the cancel-order dialog names the safe choice, not just the destructive one', () => {
  it('r8-cancel-dialog sets an explicit cancelLabel (Keep it), never the bare default', () => {
    const source = read('orders/[id].tsx')
    const dialog = /<Dialog\b[\s\S]*?testID="r8-cancel-dialog"/.exec(source)?.[0] ?? ''
    expect(dialog.length).toBeGreaterThan(0)
    expect(dialog).toMatch(/cancelLabel=/)
  })
})
