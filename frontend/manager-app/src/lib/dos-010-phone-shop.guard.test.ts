/**
 * DOS-010 — on a phone the manager's order and bill rows must still say WHOSE they are.
 *
 * `<Register>` draws a table on the desk and grouped `<ListRow>`s below 1024 px, and the phone
 * rendering keeps exactly three cells: the `identity` column as `primary`, the `chip` column as
 * `secondary`, the `value` column as the trailing money (`ui/src/web/list.tsx:513`,
 * `ui/src/native/list.tsx:394`). Every other column — the Shop one among them — is dropped, so on the
 * Pixel 7 the Confirmed orders list and the Billing desk both read "order no · state · amount" with
 * an empty shop cell (`android/a-03-orders-confirmed.png`, `android/a-05-billing.png`).
 *
 * The cure is this app's, not the kit's: the identity cell itself carries the shop WHILE THE VIEWPORT
 * IS A PHONE. Teaching `<Register>` to render the `detail` priority would change every register in
 * every app, and on the desk the shop already has its own column — printing it twice there is the
 * other half of the same defect.
 *
 * Read as SOURCE, like `trips-held-bills.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro, and `@types/node` is deliberately absent from an
 * app (`env.d.ts`).
 */
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** A screen's source. `fileURLToPath`, never `URL.pathname`: the repository path has a space. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The whole of the call whose head matches `marker`, to its balanced closing parenthesis. A regex,
 * not a literal: prettier breaks a long call over several lines and the head is then `textColumn(\n
 * 'orderNo',`.
 */
function callAt(code: string, marker: RegExp, where: string): string {
  const head = marker.exec(code)
  expect(head, `${where} has no ${String(marker)}`).not.toBeNull()
  const start = head?.index ?? -1
  let depth = 0
  for (let i = code.indexOf('(', start); i < code.length; i += 1) {
    const ch = code[i]
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  throw new Error(`${where}: ${String(marker)} is never closed`)
}

describe('M2 order queue and M6 billing desk on a phone', () => {
  it("DOS-010: the order queue's identity cell names the shop at phone width, and the desk table keeps its Shop column", async () => {
    const code = withoutComments(await read('../../app/orders/index.tsx'))
    expect(code).toMatch(/useViewport\(\)/)

    const identity = callAt(code, /textColumn\(\s*'orderNo'/, 'app/orders/index.tsx')
    expect(identity).toContain("priority: 'identity'")
    expect(identity).toMatch(/row\.orderNo/)
    expect(identity, 'the identity cell never names the shop').toMatch(
      /names\.retailer\(row\.retailerId\)/,
    )
    expect(identity, 'the identity cell is not conditional on the phone shell').toMatch(/\bphone\b/)
    expect(code).toMatch(/textColumn\('shop'/)
  })

  it('DOS-010: both billing registers name the shop in the identity cell at phone width', async () => {
    const code = withoutComments(await read('../../app/billing/index.tsx'))
    expect(code).toMatch(/useViewport\(\)/)

    // The queue: packed orders with no live bill. Its own row carries `retailerName`.
    const queue = callAt(code, /textColumn\(\s*'orderNo'/, 'app/billing/index.tsx')
    expect(queue).toContain("priority: 'identity'")
    expect(queue).toMatch(/row\.orderNo/)
    expect(queue, 'the queue identity cell never names the shop').toMatch(/retailerName/)
    expect(queue, 'the queue identity cell is not conditional on the phone shell').toMatch(
      /\bphone\b/,
    )

    // The bills register: the buyer is the shop on an issued bill.
    const bills = callAt(code, /textColumn\(\s*'invoiceNo'/, 'app/billing/index.tsx')
    expect(bills).toContain("priority: 'identity'")
    expect(bills).toMatch(/row\.invoiceNo/)
    expect(bills, 'the bill identity cell never names the buyer').toMatch(/buyerName/)
    expect(bills, 'the bill identity cell is not conditional on the phone shell').toMatch(
      /\bphone\b/,
    )

    // The desk table keeps both of its own columns.
    expect(code).toMatch(/textColumn\('shop', t\('m6\.shop'\)/)
    expect(code).toMatch(/textColumn\('shop', t\('m6\.buyer'\)/)
  })
})
