/**
 * QA DOS-313 at the approval door: the last approval, or the desk's own confirm, may now HOLD an order
 * for credit instead of confirming it. The rule reads the reply; the three screens where the desk takes
 * those actions say it. The screens are read as source, like the other guard tests: importing one in
 * Node pulls in expo-router, which resolves only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { heldForCredit } from './credit-hold'
import { strings as manager } from './groups/manager/strings'
import { strings as owner } from './groups/owner/strings'

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
}

describe('QA DOS-313: an order held for credit by a decision says so', () => {
  it('is held when the reply is still submitted with a pending credit gate', () => {
    expect(
      heldForCredit({
        state: 'submitted',
        approvals: [
          { kind: 'bargain', status: 'approved' },
          { kind: 'credit_limit', status: 'pending' },
        ],
      }),
    ).toBe(true)
  })

  it('is not held when it was confirmed, when another gate still waits, or when there is no reply', () => {
    expect(
      heldForCredit({
        state: 'confirmed',
        approvals: [{ kind: 'credit_limit', status: 'approved' }],
      }),
    ).toBe(false)
    expect(
      heldForCredit({ state: 'submitted', approvals: [{ kind: 'bargain', status: 'pending' }] }),
    ).toBe(false)
    expect(heldForCredit({ state: 'submitted' })).toBe(false)
    expect(heldForCredit(null)).toBe(false)
    expect(heldForCredit(undefined)).toBe(false)
  })

  it('the owner’s Approvals, the owner’s Orders and the manager’s order queue say it after the decision', async () => {
    const approvals = await read('../app/owner/approvals.tsx')
    expect(approvals).toMatch(/heldForCredit\(result\.order\)/)
    expect(approvals).toContain("t('o3.heldForCredit'")
    const ownerOrders = await read('../app/owner/orders/index.tsx')
    expect(ownerOrders).toMatch(/heldForCredit\(result\.item\)/)
    expect(ownerOrders).toContain("t('o5.heldForCredit'")
    const queue = await read('../app/manager/orders/index.tsx')
    expect(queue).toMatch(/heldForCredit\(result\.item\)/)
    expect(queue).toMatch(/heldForCredit\(result\.order\)/)
    expect(queue).toContain("t('m2.heldForCredit'")
    // a confirm that raised a gate must refresh the gates the queue shows
    for (const code of [ownerOrders, queue])
      expect(code).toMatch(
        /api\.api\.orders\.confirm\(\{ id, idempotencyKey: meta\.idempotencyKey \}\),[\s\S]{0,200}?invalidates: \[\['approvals'\]/,
      )
  })

  it('every word is in the strings files, naming the order and what to do next', () => {
    for (const text of [
      owner['o3.heldForCredit'],
      owner['o5.heldForCredit'],
      manager['m2.heldForCredit'],
    ]) {
      expect(text).toContain('{order}')
      expect(text).toMatch(/^\{order\} is held for credit — .* (Approvals|credit gate)/)
    }
  })
})
