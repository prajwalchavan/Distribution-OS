/**
 * DOS-216 (never-list #12) — the gate-count review says "Saved" only after the server acknowledged it.
 *
 * Two halves. The rule (`count-save.ts`) as a function: a keyed figure is "Not saved yet" until a
 * `grns.get` or the count's own 2xx reply holds the same pieces. And the screen, read as SOURCE like
 * the other warehouse guards (importing it in Node pulls in `react-native` and `expo-router`): the
 * chip comes from that rule, never from the local figure alone, and a failed save keeps the figures.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { acknowledgedLines, lineSaveState, unsavedCount } from './count-save'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/warehouse/inbound/[id].tsx', import.meta.url)),
    'utf8',
  )
}

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('DOS-216: a counted line is Saved only once the server holds it', () => {
  it('keyed on the pad, server still NULL (the day-1 evidence: four chips, four NULL rows) → not saved', () => {
    expect(lineSaveState(1248, 0, { countedQtyPcs: null, damagedQtyPcs: 0 })).toBe('unsaved')
    expect(lineSaveState(144, undefined, undefined)).toBe('unsaved')
  })

  it('nothing keyed and nothing on the server → waiting', () => {
    expect(lineSaveState(undefined, undefined, { countedQtyPcs: null, damagedQtyPcs: 0 })).toBe(
      'waiting',
    )
    expect(lineSaveState(undefined, undefined, undefined)).toBe('waiting')
  })

  it('the server holds the same good AND damaged pieces → saved', () => {
    expect(lineSaveState(432, 0, { countedQtyPcs: 432, damagedQtyPcs: 0 })).toBe('saved')
    expect(lineSaveState(142, 2, { countedQtyPcs: 142, damagedQtyPcs: 2 })).toBe('saved')
    // counted in an earlier visit, nothing re-keyed now
    expect(lineSaveState(undefined, undefined, { countedQtyPcs: 240, damagedQtyPcs: 0 })).toBe(
      'saved',
    )
  })

  it('a re-keyed figure the server does not hold yet is not saved, even if an older one is', () => {
    expect(lineSaveState(240, 0, { countedQtyPcs: 238, damagedQtyPcs: 0 })).toBe('unsaved')
    expect(lineSaveState(240, 3, { countedQtyPcs: 240, damagedQtyPcs: 0 })).toBe('unsaved')
  })

  it("the save's own 2xx reply wins over the read it arrived before", () => {
    const read = [{ id: 'a', countedQtyPcs: null, damagedQtyPcs: 0 }]
    const reply = [{ id: 'a', countedQtyPcs: 1248, damagedQtyPcs: 0 }]
    expect(acknowledgedLines(read, undefined).get('a')?.countedQtyPcs).toBeNull()
    expect(acknowledgedLines(read, reply).get('a')?.countedQtyPcs).toBe(1248)
  })

  it('counts the lines the bottom bar must warn about', () => {
    const server = acknowledgedLines(
      [
        { id: 'a', countedQtyPcs: null, damagedQtyPcs: 0 },
        { id: 'b', countedQtyPcs: 5, damagedQtyPcs: 0 },
        { id: 'c', countedQtyPcs: null, damagedQtyPcs: 0 },
      ],
      undefined,
    )
    expect(unsavedCount(['a', 'b', 'c'], { a: 1, b: 5 }, {}, server)).toBe(1)
    expect(unsavedCount(['a', 'b', 'c'], {}, {}, server)).toBe(0)
  })

  it('the review screen draws its chip from the rule, never "Saved" off a local figure', async () => {
    const code = withoutComments(await readScreen())
    expect(code).toMatch(/lineSaveState\(counted\[row\.id\], damaged\[row\.id\], server\)/)
    // the old shape: `counted[row.id] === undefined ? … : <StatusChip label={t('w.saved')} …`
    expect(code).not.toMatch(/label=\{t\('w\.saved'\)\}/)
    expect(code).toMatch(/save\.status === 'success' \? save\.data\?\.item\.lines : undefined/)
    expect(catalogue['w3.notSaved']).toBe('Not saved yet')
  })

  it('a failed save says what failed and never clears the keyed figures', async () => {
    const code = withoutComments(await readScreen())
    expect(code).toMatch(/testID="w3-save-error"/)
    expect(code).toMatch(/w3\.saveFailedBecause/)
    expect(code).toMatch(/w3\.keptFigures/)
    expect(code).not.toMatch(/setCounted\(\{\}\)/)
    expect(code).not.toMatch(/setDamaged\(\{\}\)/)
  })
})
