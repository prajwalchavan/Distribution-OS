/**
 * DOS-011 / DOS-033 — a receipt says which bills it closed, and what the discount cost.
 *
 * The owner's panel showed Shop · Mode · Amount · On account and nothing about what the money DID:
 * the allocation to INV/0824 and the ₹1,464.90 cash discount were both in the database and neither
 * was on screen. The manager's panel had the allocation and printed it as "f2863866-…" (DOS-033),
 * because an allocation carries only an invoice id.
 *
 * `receipts.get` now answers the bills it settled, named, in allocation order (the backend half is
 * `receivables.spec.ts`). Both panels read THAT — never `billing.invoices.get` per allocation, which
 * is the N+1 read DOS-004's design refused.
 *
 * Read as SOURCE, like `dos-015-rebuild-ageing.guard.test.ts`.
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

describe('O11 receipts: what the money settled', () => {
  it('DOS-011: the receipt panel names each bill it settled and states the cash discount', async () => {
    const screen = await read('../../app/money/receipts.tsx')

    expect({
      // the bills come from the receipt's own read, keyed by id
      readsTheReply: /detail\.data\?\.invoices/.test(screen),
      namesTheBill: /bill\?\.invoiceNo/.test(screen),
      saysWhatIsLeft: /o11\.billOpen/.test(screen),
      showsDiscount: /receipt\.cashDiscountPaise/.test(screen),
      sumsIt: /o11\.settledLine/.test(screen),
      // and never a read per allocation (the N+1 DOS-004 refused)
      perAllocationRead: /invoices\.get\(/.test(screen),
    }).toEqual({
      readsTheReply: true,
      namesTheBill: true,
      saysWhatIsLeft: true,
      showsDiscount: true,
      sumsIt: true,
      perAllocationRead: false,
    })

    expect(catalogue['o11.settles']).toBe('Settles')
    expect(catalogue['o11.settledLine']).toBe(
      '{received} received + {discount} cash discount = {total} settled',
    )
  })

  it('DOS-033: the manager panel prints the bill number, not its uuid', async () => {
    const screen = await read('../../../manager-app/app/money/index.tsx')
    const block = /<Panel title=\{t\('m9\.allocations'\)\}[\s\S]*?<\/Panel>/.exec(screen)?.[0]
    expect(block, 'the allocations panel is gone').toBeDefined()

    expect(block).toMatch(/bill\?\.invoiceNo/)
    // the raw id survives only as the fallback for a bill the reply could not name
    expect(block).toMatch(/row\.invoiceId\.slice\(0, 8\)/)
    expect(block).not.toMatch(/primary=\{row\.invoiceId\}/)
    expect(screen).toMatch(/detail\.data\?\.invoices/)
    expect(screen).not.toMatch(/invoices\.get\(/)
  })
})
