/**
 * m3 (blind check of the shopkeeper's sign-up) — a distributor the shop left is not one it buys from: not on Me's
 * "Your distributors", not in its count, not in the switcher. The screens are read as SOURCE, like the other app
 * guards: importing them in Node pulls in `react-native`.
 */
import { describe, expect, it } from 'vitest'

import { joinedDistributors } from './joined'

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

describe('a distributor the shop left is not one it buys from', () => {
  it('keeps only the active memberships, in their order', () => {
    const memberships = [
      { tenantId: 'a', status: 'active' },
      { tenantId: 'b', status: 'disabled' },
      { tenantId: 'c', status: 'active' },
    ]
    expect(joinedDistributors(memberships).map((m) => m.tenantId)).toEqual(['a', 'c'])
    expect(joinedDistributors([])).toEqual([])
  })

  it('is what Me’s distributor cards and the switcher both list and count', async () => {
    const cards = await read('./distributors.tsx')
    const layout = await read('../../../../app/retailer/_layout.tsx')
    expect({
      cardsFiltered:
        /const memberships = joinedDistributors\(session\?\.memberships \?\? \[\]\)/.test(cards),
      cardsUnfiltered: /const memberships = session\?\.memberships \?\? \[\]/.test(cards),
      switcherFiltered: /joinedDistributors\(session\?\.memberships \?\? \[\]\)/.test(layout),
      chipCountsJoined:
        /if \(joinedDistributors\(session\?\.memberships \?\? \[\]\)\.length <= 1\)/.test(cards),
      chipCountsAll: /session\?\.memberships\.length/.test(cards),
    }).toEqual({
      cardsFiltered: true,
      cardsUnfiltered: false,
      switcherFiltered: true,
      chipCountsJoined: true,
      chipCountsAll: false,
    })
  })
})
