/**
 * W7 — what the crew counts before a vehicle leaves, and what the confirm sends.
 *
 * Two findings meet on this screen. DOS-121: since DOS-039 the load-out moves ONLY the van stock the
 * crew counted, and this screen sent `countedVanStock: []` on every sheet, so a van-sales trip would
 * have left the godown with its van stock still booked in the godown. DOS-049: the blind carton count
 * had the answer printed under the keypad — "Cartons 7 / 12 / 12 / 4 / 3" adds up to the figure the
 * pad is asking for.
 *
 * Read as source, like `trips-held-bills.test.ts`: importing the screen in Node pulls in `react-native`
 * and `expo-router`, which do not resolve outside Metro. It lives under `src/`, not `app/`, because
 * expo-router treats every file in `app/` as a route, and Node's modules come in through non-literal
 * specifiers because `@types/node` is deliberately absent from an app (`env.d.ts`).
 */
import { describe, expect, it } from 'vitest'

import { strings } from './strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** W7's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../app/load/[id].tsx', import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that names a testID is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The source from `from` up to (not including) the next `to`. */
function between(code: string, from: string, to: string): string {
  const start = code.indexOf(from)
  expect(start, `app/load/[id].tsx has no ${from}`).toBeGreaterThan(-1)
  const end = code.indexOf(to, start)
  expect(end, `app/load/[id].tsx has no ${to} after ${from}`).toBeGreaterThan(start)
  return code.slice(start, end)
}

const catalogue: Readonly<Record<string, string>> = strings

describe('W7 load-out: the counts that leave the godown', () => {
  it('DOS-121: W7 counts the van-stock lots and sends them as countedVanStock, never a hard-coded empty list', async () => {
    const code = withoutComments(await readScreen())

    // The defect itself: an empty list on every sheet, whatever the van carries.
    expect(code).not.toMatch(/countedVanStock:\s*\[\]/)

    // The confirm sends what was counted, lot by lot, and only the lots with pieces on them
    // (`LoadSheetVanStockInput.qtyPcs` is positive: a lot counted 0 is left off the sheet).
    const body = between(code, 'api.api.warehouse.loadSheets.confirm(', 'const print =')
    expect(body).toMatch(/countedVanStock:\s*\w+/)
    expect(code).toMatch(/\.filter\(\s*\(\w+\)\s*=>\s*\w+\.qtyPcs\s*>\s*0\s*\)/)
    expect(code).toMatch(/lotId:\s*\w+\.lotId/)

    // The van lots are the sheet's own `source === 'van'` rows, and each one gets a count pad.
    expect(code).toMatch(/lots\.filter\(\s*\(\w+\)\s*=>\s*\w+\.source\s*===\s*'van'\s*\)/)
    expect(code).toMatch(/`w7-van-\$\{\w+\.lotId\}`/)
    expect(code).toMatch(/<NumberPad[\s\S]*?testID="w7-van-pad"/)

    // No vehicle leaves with an uncounted van lot: the confirm is blocked and says why.
    const blocked = /\bconst blocked =([\s\S]*?)\n\n/.exec(code)?.[1] ?? ''
    expect(blocked, 'W7 has no `blocked` expression').not.toBe('')
    expect(blocked).toMatch(/vanCounted/)
    expect(code).toMatch(/t\('w7\.countVanFirst'\)/)
    expect(catalogue['w7.countVanFirst']).toBe('Count the van-sale stock first')
    expect(catalogue['w7.vanPieces']).toBe('Pieces on the vehicle')

    // Blind here too: an uncounted van lot shows no quantity to copy into the pad.
    expect(catalogue['w7.vanUncounted']).toBe('Not counted yet')
    expect(code).toMatch(/t\('w7\.vanUncounted'\)/)
  })
})
