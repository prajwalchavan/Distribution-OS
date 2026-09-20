/**
 * DOS-091 — the rep can list a shop's bills but cannot open one, and "Due 10 Sep · 2 days" does not
 * say which side of the due date those two days are on.
 *
 * Both halves are the app's. The backend has served the salesperson `GET /invoices/{id}` and
 * `GET /invoices/{id}/pdf` since billing was mounted on sales-service (`billing.invoices.get` and
 * `.pdf` are ANY_MEMBER); the S12 tab simply drew rows with no tap target, so a rep standing at the
 * counter with a shopkeeper disputing a bill had nothing to show them. And `OpenBill.ageDays` is
 * "days since the due date, negative when it is not due yet" — a sign the copy threw away.
 */
import { describe, expect, it } from 'vitest'

import { dueKey } from './dates'

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

async function source(relative: string): Promise<string> {
  return (await read(relative)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-091 a bill the rep can open, with copy that reads the sign of ageDays', () => {
  it('DOS-091 says "overdue" only past the due date and "due in" before it', () => {
    expect(dueKey(2)).toBe('s12.overdue')
    expect(dueKey(41)).toBe('s12.overdue')
    expect(dueKey(0)).toBe('s12.dueToday')
    expect(dueKey(-1)).toBe('s12.dueIn')
    expect(dueKey(-12)).toBe('s12.dueIn')
  })

  it('DOS-091 the bills tab opens a bill detail route that reads the invoice and its PDF', async () => {
    const card = await source('../../app/shops/[id].tsx')
    const detail = await source('../../app/bills/[id].tsx')
    const strings = await source('../strings.ts')

    expect({
      // Every row is a tap target, online rows and the phone's own copy alike.
      opensOnline: /onPress=\{\(\) => \{\s*router\.push\(`\/bills\/\$\{bill\.id\}`\)/.test(card),
      opensLocal: /onPress=\{\(\) => \{\s*router\.push\(`\/bills\/\$\{bill\.id\}`\)/g.test(card),
      taps: (card.match(/router\.push\(`\/bills\/\$\{bill\.id\}`\)/g) ?? []).length,
      // The ambiguous "{age} days" line is gone from both the list and the detail.
      ambiguous: /'s12\.due':\s*'Due \{when\} · \{age\} days'/.test(strings),
      readsSign: (card.match(/dueKey\(/g) ?? []).length,
      // The detail screen is the server's, because a bill is not on the phone in full.
      getsInvoice: /api\.api\.billing\.invoices\.get\(/.test(detail),
      getsPdf: /api\.api\.billing\.invoices\.pdf\(/.test(detail),
      // And the document a rep shows across the counter is the server's PDF, never a redraw.
      opensPdf: /documents\.open\(/.test(detail),
      // Screens import only @dos/ui (docs/08 §0).
      noReactNative: /from 'react-native'/.test(detail),
    }).toEqual({
      opensOnline: true,
      opensLocal: true,
      taps: 2,
      ambiguous: false,
      readsSign: 1,
      getsInvoice: true,
      getsPdf: true,
      opensPdf: true,
      noReactNative: false,
    })
  })

  it('DOS-091 docs/23 no longer says the wiring is missing on sales-service', async () => {
    const docs = await read('../../../../docs/23-app-screens-and-api-gaps.md')
    const s12 = docs.split('\n').find((line) => line.startsWith('- **S12 '))

    expect(s12).toBeDefined()
    expect(s12).not.toMatch(/wiring ✗ on sales-service/)
    expect(s12).toMatch(/billing\.invoices\.(list\/)?get/)
  })
})
