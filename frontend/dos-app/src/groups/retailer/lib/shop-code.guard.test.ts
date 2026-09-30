/**
 * m4 (blind check of the shopkeeper's sign-up) — the shopkeeper reads its own shop code where it looks for it: on its
 * shop's page (the public shape carries `shopCode` since this repair) and on a bill (`buyerShopCode`), as the bill's
 * PDF and the desk's shop page already showed it. Read as SOURCE, like the other app guards.
 */
import { InvoiceDetailSchema, RetailerPublicSchema } from '@dos/contracts'
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
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the shopkeeper sees its own shop code', () => {
  it('is on the shop’s own record and on its bill, by contract', () => {
    expect(Object.keys(RetailerPublicSchema.shape)).toContain('shopCode')
    expect(Object.keys(InvoiceDetailSchema.shape)).toContain('buyerShopCode')
  })

  it('shows it on the shop page and on a bill, in words', async () => {
    const shop = await read('../../../../app/retailer/shop.tsx')
    const bill = await read('../../../../app/retailer/bills/[id].tsx')
    const words = strings as Record<string, string>
    expect({
      shopPage: /<Field label=\{t\('r11\.shopCode'\)\}>\{shop\.shopCode\}<\/Field>/.test(shop),
      billScreen: /t\('r4\.shopCode', \{ code: bill\.buyerShopCode \}\)/.test(bill),
      words: [words['r11.shopCode'], words['r4.shopCode']?.includes('{code}')],
    }).toEqual({ shopPage: true, billScreen: true, words: ['Shop code', true] })
  })
})
