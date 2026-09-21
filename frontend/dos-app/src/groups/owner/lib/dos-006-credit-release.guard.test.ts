/**
 * DOS-006 — approving an "Over credit limit" gate releases the ORDER, not the limit.
 *
 * The owner read "requested ₹1,70,000", approved, and nothing about the shop changed: the server
 * confirms the order and never writes `retailers.credit_limit_paise` (`approvals.service.ts`), and
 * the requested figure existed only in the demo seed. Founder, 2026-09-13 (docs/22 §8): approving
 * lets only that one order through; the limit is a setting changed on the shop's page, audited.
 *
 * So the screen must say exactly that before the owner presses Approve, and offer the one place the
 * limit is actually changed. This guard also pins the semantics: the decision carries no new limit,
 * so the alternative ("approve also raises the limit") cannot creep back in through the dialog.
 *
 * Read as SOURCE, like `dos-015-rebuild-ageing.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('O3 approvals: what approving an over-limit gate actually does', () => {
  it('DOS-006: the approve dialog says the gate releases only that order and offers the shop page', async () => {
    const screen = await read('../../../../app/owner/approvals.tsx')
    const dialog = /<Dialog\s+open=\{confirm !== null[\s\S]*?testID="approval-confirm"/.exec(
      screen,
    )?.[0]
    expect(dialog, 'the confirm dialog is gone').toBeDefined()

    expect({
      // The sentence, on a credit gate being approved and nowhere else (a reject releases nothing).
      saysWhatApproveDoes: /o3\.creditRelease/.test(dialog ?? ''),
      onlyForCreditGates: /kind === 'credit_limit'/.test(dialog ?? ''),
      onlyOnApprove: /confirm === 'approve'/.test(dialog ?? ''),
      // and the one place the limit IS changed, one tap away, filtered to this shop.
      offersTheShopPage: /o3\.changeLimit/.test(dialog ?? ''),
      landsOnShops: /\/shops\?q=\$\{encodeURIComponent/.test(screen),
    }).toEqual({
      saysWhatApproveDoes: true,
      onlyForCreditGates: true,
      onlyOnApprove: true,
      offersTheShopPage: true,
      landsOnShops: true,
    })

    expect(catalogue['o3.creditRelease']).toBe(
      'Approving lets {order} through for {total}. The limit stays {limit} — change it under Shops.',
    )
    expect(catalogue['o3.changeLimit']).toBe("Change the shop's limit")
  })

  it('DOS-006: the decision carries no new credit limit — approving never raises it', async () => {
    const screen = await read('../../../../app/owner/approvals.tsx')
    const decide = /approvals\.decide\(\{[\s\S]*?\}\)/.exec(screen)?.[0]
    expect(decide, 'the decide call is gone').toBeDefined()
    expect(decide).not.toMatch(/[Ll]imit/)
    // Nor does the screen set a limit of its own: `retailers.setCredit` belongs to Shops.
    expect(screen).not.toMatch(/setCredit/)
  })
})
