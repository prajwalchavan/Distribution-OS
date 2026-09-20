/**
 * DOS-027 — "Waiting on" is the queue's one decision-support column, and it was blank.
 *
 * SO-0867 sat in Submitted with two gates pending — `below_floor` on the order itself and
 * `credit_limit` on its shop R-0018 — and the column read "—", because it printed
 * `sales_orders.approval_flags`, a column the seed leaves empty and nothing keeps in step with the
 * approvals themselves. The gates are rows in `orders.approvals.list`, which is the list the panel
 * below already reads, so the column is derived from THEM: the truth the server enforces (an order
 * cannot confirm while any of its gates is pending) rather than a copy of it.
 *
 * A gate raised at submit carries its `orderId` (`orders.service.ts:307`). A credit-limit gate
 * raised against the SHOP carries none — `entityType: 'retailer'` — so it is matched by
 * `retailerId`, and only that kind is: a trip settlement with no order behind it never belongs to
 * somebody's order.
 */
import { describe, expect, it } from 'vitest'

import { waitingOnKinds, type GatedOrder, type PendingGate } from './waiting-on'

const order: GatedOrder = { id: 'so-0867', retailerId: 'r-0018' }

const gate = (over: Partial<PendingGate>): PendingGate => ({
  kind: 'below_floor',
  status: 'pending',
  orderId: null,
  retailerId: null,
  ...over,
})

describe('waitingOnKinds', () => {
  it('DOS-027: an order with two pending gates names both — the one on the order and the credit gate on its shop', () => {
    const pending = [
      gate({ kind: 'below_floor', orderId: 'so-0867' }),
      gate({ kind: 'credit_limit', orderId: null, retailerId: 'r-0018' }),
    ]
    expect(waitingOnKinds(order, pending)).toEqual(['below_floor', 'credit_limit'])
  })

  it('DOS-027: an order with nothing pending waits on nothing', () => {
    expect(waitingOnKinds(order, [])).toEqual([])
  })

  it("DOS-027: another order's gate and another shop's credit gate are not this order's", () => {
    const pending = [
      gate({ kind: 'below_floor', orderId: 'so-0900' }),
      gate({ kind: 'credit_limit', orderId: null, retailerId: 'r-0099' }),
    ]
    expect(waitingOnKinds(order, pending)).toEqual([])
  })

  it('DOS-027: a gate already decided is not waiting on anybody', () => {
    const pending = [
      gate({ kind: 'below_floor', orderId: 'so-0867', status: 'approved' }),
      gate({ kind: 'bargain', orderId: 'so-0867', status: 'rejected' }),
      gate({ kind: 'credit_limit', retailerId: 'r-0018', status: 'expired' }),
    ]
    expect(waitingOnKinds(order, pending)).toEqual([])
  })

  it('DOS-027: two bargain gates on the same order are one word, in the order they were raised', () => {
    const pending = [
      gate({ kind: 'bargain', orderId: 'so-0867' }),
      gate({ kind: 'bargain', orderId: 'so-0867' }),
      gate({ kind: 'credit_limit', orderId: 'so-0867' }),
    ]
    expect(waitingOnKinds(order, pending)).toEqual(['bargain', 'credit_limit'])
  })

  it('DOS-027: only a credit gate reaches an order through its shop — a settlement with no order does not', () => {
    const pending = [
      gate({ kind: 'trip_settlement', orderId: null, retailerId: 'r-0018' }),
      gate({ kind: 'bargain', orderId: null, retailerId: 'r-0018' }),
    ]
    expect(waitingOnKinds(order, pending)).toEqual([])
  })
})

/**
 * And the column itself prints those kinds. Read as SOURCE, like `trips-held-bills.test.ts`:
 * importing a screen in Node pulls in `react-native` and `expo-router`, which resolve only under
 * Metro.
 */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function readScreen(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('M2 order queue: the "Waiting on" column', () => {
  it('DOS-027: the column is derived from the pending approvals, never from the stored approvalFlags', async () => {
    const code = withoutComments(await readScreen('../../app/orders/index.tsx'))

    const flags = /textColumn\(\s*'flags'[\s\S]*?\),\n/.exec(code)?.[0] ?? ''
    expect(flags.length, 'the queue has no flags column').toBeGreaterThan(0)
    expect(flags, 'the column still prints the stored flags').not.toMatch(/approvalFlags/)
    expect(flags).toMatch(/waitingOnKinds\(/)
    // The gates come from the list this screen already reads, not from a second read of its own.
    expect(code).toMatch(/import \{ waitingOnKinds \} from '\.\.\/\.\.\/src\/lib\/waiting-on'/)
  })
})
