/**
 * DOS-066 — WHAT THE PERSON HOLDING THE GOODS KNOWS BEFORE HE HANDS THEM OVER.
 *
 * Measured at Vaibhav Kirana Mart: the stop said "Owes ₹75,228.00 · Still due ₹75,228.00 · 7 bills
 * still open". The device already held the rest of that row — ₹52,176 of it PAST DUE, oldest bill
 * due 10 July, 65 days late — and the shop at stop 9 was on credit mode `stop` in the office's own
 * books and looked exactly like every other shop on the road.
 *
 * The founder's rule (docs/22 §8, 2026-09-13): the crew hands over goods the office has already
 * invoiced and loaded, and the stop TELLS them. Nothing blocks the delivery on the phone or the
 * server — the credit check stays at order submit, where this bill was approved — and only credit
 * mode `stop` earns the chip: `strict` and `indicate` look exactly as they did.
 *
 * Pure TypeScript, the `doorstep.ts` pattern: dates from `./dates`, money and days from `@dos/domain`,
 * no component and no platform module, so this runs under vitest with no Metro.
 */
import { formatINR, paise } from '@dos/domain'
import { createTranslator } from '@dos/ui'
import { describe, expect, it } from 'vitest'

import { doorDues, overdueLine } from './dues'
import type { LocalOutstanding } from './local'
import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Screen source with its comments taken out: a comment may quote the very line it explains. */
async function readScreen(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const t = createTranslator('en', strings)

/** Vaibhav's row, exactly as `retailer_outstanding_summary` reached the phone (db-01, db-02). */
const VAIBHAV: LocalOutstanding = {
  retailer_id: 'shop-vaibhav',
  outstanding_paise: 7_522_800,
  overdue_paise: 5_217_600,
  unallocated_credit_paise: 0,
  open_bills: 7,
  oldest_due_date: '2026-07-10',
  as_of: '2026-09-13T04:00:00.000Z',
}

const money = (p: number): string => formatINR(paise(p))

describe('DOS-066 the dues the door shows', () => {
  it('DOS-066 Vaibhav is 65 days late on the oldest of seven bills, and the line says so', () => {
    const door = doorDues(VAIBHAV, 'indicate', '2026-09-13')
    expect(door).toEqual({
      outstandingPaise: 7_522_800,
      overduePaise: 5_217_600,
      oldestDueDate: '2026-07-10',
      daysLate: 65,
      stopped: false,
      tone: 'overdue',
    })
    expect(overdueLine(t, door, money)).toBe('Overdue ₹52,176.00 · oldest due 10 Jul')
  })

  it('DOS-066 only credit mode stop earns the chip; strict and indicate look exactly as they did', () => {
    expect(doorDues(VAIBHAV, 'stop', '2026-09-13').stopped).toBe(true)
    expect(doorDues(VAIBHAV, 'stop', '2026-09-13').tone).toBe('stopped')
    for (const mode of ['strict', 'indicate', null]) {
      expect(doorDues(VAIBHAV, mode, '2026-09-13').stopped).toBe(false)
      expect(doorDues(VAIBHAV, mode, '2026-09-13').tone).toBe('overdue')
    }
    // A shop on `stop` with nothing overdue still carries the chip: the office stopped its credit.
    const clean: LocalOutstanding = { ...VAIBHAV, overdue_paise: 0, oldest_due_date: null }
    expect(doorDues(clean, 'stop', '2026-09-13').tone).toBe('stopped')
  })

  it('DOS-066 a shop that owes but is not late is not called late, and a shop with no row says nothing', () => {
    const notLate: LocalOutstanding = { ...VAIBHAV, overdue_paise: 0, oldest_due_date: null }
    const due = doorDues(notLate, 'indicate', '2026-09-13')
    expect(due.tone).toBe('due')
    expect(due.daysLate).toBe(0)
    expect(overdueLine(t, due, money)).toBeNull()

    const nothing = doorDues(null, 'stop', '2026-09-13')
    expect(nothing).toEqual({
      outstandingPaise: 0,
      overduePaise: 0,
      oldestDueDate: null,
      daysLate: 0,
      stopped: true,
      tone: 'stopped',
    })
    expect(overdueLine(t, nothing, money)).toBeNull()

    // Nothing owed and no mode: the chip row is exactly what it was before this finding.
    expect(
      doorDues({ ...VAIBHAV, outstanding_paise: 0, overdue_paise: 0 }, null, '2026-09-13').tone,
    ).toBe('clear')
  })

  it('DOS-066 an oldest due date in the future is not days late, however the office pulled it', () => {
    const ahead: LocalOutstanding = { ...VAIBHAV, oldest_due_date: '2026-09-20' }
    expect(doorDues(ahead, 'indicate', '2026-09-13').daysLate).toBe(0)
  })
})

/**
 * AND THE STOP ACTUALLY SHOWS IT. The review of this fix found the rule above proved and its SCREEN
 * proved by nothing: reverting the D3 hunk alone left every test in this app green, so the five lines
 * the finding is about could have gone back to a single untinted chip without a word from the suite.
 *
 * So the screen is read here the way `dos-065-own-papers.test.ts` reads its screens — importing D3 in
 * Node pulls in `react-native` and `expo-router`, which resolve only under Metro.
 */
describe('DOS-066 review — the stop itself carries the overdue lines', () => {
  it('DOS-066 D3 draws its chips and its panel from this rule, not from outstanding alone', async () => {
    const d3 = await readScreen('../../app/stop/[id]/index.tsx')
    expect(d3).toMatch(/import \{ doorDues, overdueLine \} from '\.\.\/\.\.\/\.\.\/src\/lib\/dues'/)
    expect(d3).toMatch(/const door = doorDues\(dues, shop\?\.credit_mode \?\? null\)/)
    expect(d3).toMatch(/const overdue = overdueLine\(t, door,/)
    for (const id of [
      'd3-overdue',
      'd3-credit-stopped',
      'd3-overdue-amount',
      'd3-days-late',
      'd3-stopped-line',
    ]) {
      expect(d3).toContain(`testID="${id}"`)
    }
  })

  it('DOS-066 nothing at the door is gated on what the shop owes — tell, never block', async () => {
    const d3 = await readScreen('../../app/stop/[id]/index.tsx')
    // docs/22 §8 (2026-09-13): the goods were invoiced and loaded; the credit gate was at submit.
    expect(d3).not.toMatch(/disabled=\{[^}]*door\./)
    expect(d3).not.toMatch(/disabled=\{[^}]*stopped/)
    expect(d3).not.toMatch(/disabled=\{[^}]*overdue/)
  })
})
