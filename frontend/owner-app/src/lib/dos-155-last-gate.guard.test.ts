/**
 * DOS-155 — the decision that confirms an order must say so, before and after.
 *
 * SO-0910's only pending gate was a bargain. The owner approved it from O3 Approvals; the dialog read
 * "Approve SO-0910 · Bargain · ₹44.80 · Approve / Cancel", the row vanished, and in the same second
 * the order moved submitted → confirmed and 24 pieces were reserved. DOS-020's whole point was that
 * a decision never confirms an order silently, and on the screen where owners actually decide it
 * still did.
 *
 * Two sentences fix it, and both come from facts the product already has:
 *
 *  - BEFORE: the order's own approvals (`orders.get` → `approvals`) say whether this gate is the
 *    LAST one pending. The dialog then states the consequence — the order will be confirmed and its
 *    stock held. The pending-queue page is not the source: a gate on another page would make "last"
 *    a guess, and this line is a promise.
 *  - AFTER: `DecideApprovalOutput.order` is the order AFTER the decision, `confirmed` only when the
 *    last gate cleared it (`approvals.service.ts:187`). A toast names it.
 *
 * A rate request decided outside a gate (`pricing.bargains.decide`) confirms nothing — its output
 * carries no order at all — so neither sentence may reach it.
 *
 * Read as SOURCE, like `dos-012-refusal.guard.test.ts`: importing a screen in Node pulls in
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
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('O3 Approvals: the decision that confirms an order', () => {
  it('DOS-155: the confirm dialog says the last gate will confirm the order and hold its stock', async () => {
    const code = withoutComments(await read('../../app/approvals.tsx'))

    // "Last" is read from the ORDER's own approvals, not from the page of pending rows on screen.
    expect(code).toMatch(/api\.api\.orders\.get\(/)
    expect(code).toMatch(/const lastGate =/)
    expect(code).toMatch(/status === 'pending'/)

    const dialog = /<Dialog[\s\S]*?testID="approval-confirm"/.exec(code)?.[0] ?? ''
    expect(dialog.length, 'the confirm dialog is gone').toBeGreaterThan(0)
    expect(dialog).toMatch(/lastGate/)
    expect(dialog).toMatch(/o3\.lastGate/)
    // Only on approve: rejecting a gate does not confirm anything.
    expect(dialog).toMatch(/confirm === 'approve'/)
    expect(catalogue['o3.lastGate']).toBe(
      'This is the last decision: {order} will be confirmed and its stock held.',
    )
  })

  it('DOS-155: after the decision a toast names the order that was confirmed', async () => {
    const code = withoutComments(await read('../../app/approvals.tsx'))

    // The order AFTER the decision, from the reply — never assumed from what was on screen.
    expect(code).toMatch(/result\.order/)
    expect(code).toMatch(/'confirmed'/)
    expect(code).toMatch(/setToast\(/)
    expect(code).toMatch(/<Toast/)
    expect(catalogue['o3.orderConfirmed']).toBe('{order} confirmed — stock held')
  })

  it('DOS-155: a rate request decided outside a gate never claims to confirm an order', async () => {
    const code = withoutComments(await read('../../app/approvals.tsx'))

    // `lastGate` is only ever true for an approval row that names an order.
    const lastGate = /const lastGate =([\s\S]*?)\n\n/.exec(code)?.[1] ?? ''
    expect(lastGate.length, 'lastGate is not computed').toBeGreaterThan(0)
    expect(lastGate).toMatch(/stream === 'approval'/)
    expect(lastGate).toMatch(/orderId/)
    // `pricing.bargains.decide` answers `{ item }` with no order, so nothing reads one off it.
    expect(code).not.toMatch(/decideBargain[\s\S]{0,200}?result\.order/)
  })
})
