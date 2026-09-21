/**
 * DOS-155 — the decision that confirms an order must say so, before and after (manager half).
 *
 * The finding is the owner's Approvals screen, and its fix names "the manager order sheet" too: the
 * gates listed under "Waiting on" in the order panel are decided from the same dialog, and approving
 * the last of them confirms the order and reserves its stock (`approvals.service.ts:187`) with
 * nothing on screen saying so.
 *
 * The panel already knows exactly which gates the open order is still waiting on — `order.approvals`
 * from `orders.get` — so "this is the last one" is a fact here, not a guess. A card in the approvals
 * list below is a different matter: it is somebody else's order, whose other gates this screen has
 * not read, so it claims nothing beforehand. Both get the sentence AFTERWARDS, from
 * `DecideApprovalOutput.order`, which is `confirmed` only when the decision actually confirmed it.
 *
 * Read as SOURCE, like `trips-held-bills.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro.
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

describe('M2 order panel: the decision that confirms an order', () => {
  it('DOS-155: the gate decision dialog says when it is the last one, and only for the open order', async () => {
    const code = withoutComments(await read('../../../../app/manager/orders/index.tsx'))

    // The panel's own gates say it: "last" is `waitingOn`, the open order's pending approvals.
    expect(code).toMatch(/last: waitingOn\.length === 1/)
    // A card in the approvals list is another order, whose other gates this screen has not read.
    expect(code).toMatch(/last: false/)

    const dialog = /<Dialog\s+open=\{deciding !== null\}[\s\S]*?testID="decision-dialog"/.exec(
      code,
    )?.[0]
    expect(dialog, 'the decision dialog is gone').toBeDefined()
    expect(dialog).toMatch(/deciding\?\.last/)
    expect(dialog).toMatch(/m2\.lastGate/)
    // Only on approve: rejecting a gate confirms nothing.
    expect(dialog).toMatch(/decision === 'approve'/)
    expect(catalogue['m2.lastGate']).toBe(
      'This is the last decision: {order} will be confirmed and its stock held.',
    )
  })

  it('DOS-155: after the decision a toast names the order that was confirmed', async () => {
    const code = withoutComments(await read('../../../../app/manager/orders/index.tsx'))

    expect(code).toMatch(/result\.order/)
    expect(code).toMatch(/'confirmed'/)
    expect(code).toMatch(/setToast\(/)
    expect(code).toMatch(/<Toast/)
    // `pricing.bargains.decide` answers `{ item }` with no order: nothing reads one off it.
    expect(code).not.toMatch(/decideBargain[\s\S]{0,200}?result\.order/)
    expect(catalogue['m2.orderConfirmed']).toBe('{order} confirmed — stock held')
  })
})
