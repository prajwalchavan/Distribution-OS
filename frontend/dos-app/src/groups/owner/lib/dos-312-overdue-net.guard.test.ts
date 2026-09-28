/**
 * QA DOS-312, architect ruling 3: "keep both and add the net". The owner's home and the ageing ladder on
 * Money owed show the GROSS overdue of the bills. The register below the ladder had swapped its
 * "Overdue ₹" column, its totals and the shop panel to the net figure under the same label, so one word
 * showed ₹43,38,735 on the home and ₹43,07,788 on Money owed on the same data (blind check 1, M2).
 * "Overdue" is the gross figure everywhere; the net one sits beside it under its own words. The desk's
 * dues register follows the same rule.
 *
 * Read as source: a screen pulls in expo-router, which does not resolve outside Metro.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { strings as managerStrings } from '../../manager/strings'
import { strings as ownerStrings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let money = ''
let desk = ''
beforeAll(async () => {
  const fs = (await import(NODE_FS)) as NodeFs
  const url = (await import(NODE_URL)) as NodeUrl
  const here = url.fileURLToPath(new URL('.', import.meta.url))
  money = withoutComments(fs.readFileSync(`${here}../../../../app/owner/money/index.tsx`, 'utf8'))
  desk = withoutComments(
    fs.readFileSync(`${here}../../../../app/manager/registers/index.tsx`, 'utf8'),
  )
})

describe('QA DOS-312: "Overdue" is one amount on every screen, and the net is beside it', () => {
  it('Money owed: the "Overdue ₹" column and its total are the gross overdue, as on the home and the ladder', () => {
    expect(money).toMatch(
      /moneyColumn\('overdue', t\('o10\.overdue'\), \(row\) => row\.overduePaise\)/,
    )
    expect(money).toMatch(
      /overdue: <Money value=\{shown\?\.overduePaise \?\? 0\} size="cell" symbol=\{false\} \/>/,
    )
  })

  it('Money owed: the net overdue is its own column, total and panel field, under its own words', () => {
    expect(money).toMatch(/moneyColumn\('overdueNet', t\('o10\.overdueNet'\)/)
    expect(money).toMatch(/overdueNet: \(/)
    expect(money).toMatch(
      /<Field label=\{t\('o10\.overdue'\)\}>\s*<Money value=\{shop\.data\.overduePaise\}/,
    )
    expect(money).toMatch(/<Field label=\{t\('o10\.overdueNet'\)\}>/)
    // the chip filters on the server's net overdue, so it says so
    expect(money).toMatch(/\{ id: 'overdue', label: t\('o10\.overdueNetFilter'\)/)
    // the net figure is never printed under the plain "Overdue" label any more
    expect(money).not.toMatch(/t\('o10\.overdue'\), \(row\) => row\.netOverduePaise/)
  })

  it('the desk’s dues register shows the same two columns', () => {
    expect(desk).toMatch(
      /moneyColumn\('overdue', t\('m12\.overdue'\), \(row\) => row\.overduePaise\)/,
    )
    expect(desk).toMatch(/moneyColumn\(\s*'overdueNet',\s*t\('m12\.overdueNet'\)/)
    expect(desk).toMatch(
      /overdue: \(\s*<Money\s*value=\{outstanding\.data\?\.totals\.overduePaise \?\? 0\}/,
    )
  })

  it('the two labels are different words', () => {
    expect(ownerStrings['o10.overdue']).toBe('Overdue ₹')
    expect(ownerStrings['o10.overdueNet']).not.toBe(ownerStrings['o10.overdue'])
    expect(managerStrings['m12.overdue']).toBe('Overdue ₹')
    expect(managerStrings['m12.overdueNet']).not.toBe(managerStrings['m12.overdue'])
  })
})
