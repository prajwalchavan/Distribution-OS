/**
 * DOS-217 — the desk posts a fully counted goods receipt.
 *
 * The rule as a function (`grn-post.ts`), then the screen read as SOURCE (importing it in Node pulls in
 * `react-native` and `expo-router`): the Post button's `disabled` comes from that rule and no longer
 * from `grn.status !== 'counting'`, the state the server refuses to post from.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { postReadiness, type ReceiptForPost } from './grn-post'

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

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

const lines = (counted: readonly (number | null)[]): ReceiptForPost['lines'] =>
  counted.map((qty, i) => ({ id: `l${String(i)}`, variantId: `v${String(i)}`, countedQtyPcs: qty }))

describe('DOS-217: when the desk may post a goods receipt', () => {
  it('a fully counted receipt (the server made it `reconciled`) posts — the day-1 case', () => {
    const r = postReadiness({ status: 'reconciled', lines: lines([1248, 144, 432, 240]) })
    expect(r.canPost).toBe(true)
    expect(r.done).toBe(4)
  })

  it('a partly counted receipt says how many lines and which are still owed', () => {
    const r = postReadiness({ status: 'counting', lines: lines([1248, null, 432, null]) })
    expect(r).toMatchObject({
      canPost: false,
      reason: 'partlyCounted',
      done: 2,
      total: 4,
      missing: ['v1', 'v3'],
    })
  })

  it('an uncounted, a posted and a cancelled receipt each say what they are', () => {
    expect(postReadiness({ status: 'counting', lines: lines([null, null]) })).toMatchObject({
      canPost: false,
      reason: 'notCounted',
    })
    expect(postReadiness({ status: 'posted', lines: lines([1, 2]) })).toMatchObject({
      canPost: false,
      reason: 'posted',
    })
    expect(postReadiness({ status: 'cancelled', lines: lines([null]) })).toMatchObject({
      canPost: false,
      reason: 'cancelled',
    })
  })

  it('the Inbound panel reads the rule, not `status !== counting`', async () => {
    const code = withoutComments(await read('../../../../app/manager/inbound/index.tsx'))
    expect(code).not.toMatch(/grn\.status !== 'counting'/)
    expect(code).toMatch(/disabled=\{readiness\?\.canPost !== true\}/)
    expect(code).toMatch(/m4\.partlyCounted/)
    // the outcome is printed from the 2xx reply, with the number the receipt was given
    expect(code).toMatch(/postGrn\.status === 'success' && postGrn\.data\?\.item\.id === grnId/)
    expect(catalogue['m4.partlyCounted']).toContain('{names}')
  })

  it('Today lists receipts waiting for the desk, not only those waiting for the gate', async () => {
    const code = withoutComments(await read('../../../../app/manager/index.tsx'))
    expect(code).toMatch(/grns\.list\(\{ status: 'reconciled'/)
    expect(catalogue['m1.grnToPost']).toBe('Receipts to post')
  })
})
