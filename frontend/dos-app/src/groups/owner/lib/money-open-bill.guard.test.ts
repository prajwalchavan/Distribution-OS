/**
 * Founder, 2026-09-26, on the real data: "on click of date can I see receipt of that — what items
 * were there?" The Money owed panel lists a shop's open bills; a selected bill must open in the Bills
 * register (whose panel prints the lines), and the register must honour the `bill` it is sent.
 * Read as source: a screen pulls in expo-router, which does not resolve outside Metro.
 */
import { beforeAll, describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

let money = ''
let billing = ''
beforeAll(async () => {
  const fs = (await import(NODE_FS)) as NodeFs
  const url = (await import(NODE_URL)) as NodeUrl
  const here = url.fileURLToPath(new URL('.', import.meta.url))
  money = fs.readFileSync(`${here}../../../../app/owner/money/index.tsx`, 'utf8')
  billing = fs.readFileSync(`${here}../../../../app/owner/billing/index.tsx`, 'utf8')
})

describe('dues → shop → bill → items (2026-09-26)', () => {
  it('the Money owed panel opens the selected bill in the Bills register', () => {
    expect(money).toMatch(/go\.push\(`\/billing\?bill=\$\{billId \?\? ''\}`\)/)
    expect(money).toContain('testID="money-open-bill"')
  })
  it('the Bills register opens the bill it is sent', () => {
    expect(billing).toMatch(/useLocalSearchParams<\{ q\?: string; bill\?: string \}>/)
    expect(billing).toMatch(
      /typeof params\.bill === 'string' && params\.bill !== '' \? params\.bill : null/,
    )
  })
  it('no dangling "Average days to pay" label without a number', () => {
    expect(money).not.toContain("t('o6.avgDaysToPay')")
  })
})
