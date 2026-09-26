import { describe, expect, it } from 'vitest'

import { batchLabel, expiryText } from './batch'

/** The group strings, as the screens pass them (manager and warehouse carry the same `batch.*` keys). */
const WORDS: Readonly<Record<string, string>> = {
  'batch.batch': 'Batch {batch}',
  'batch.expires': 'Expires {date}',
  'batch.daysLeft': '{count} days left',
  'batch.daysLeft.one': '{count} day left',
  'batch.expired': 'Expired',
}
const t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  (WORDS[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

describe('QA DOS-220: a receipt line names the carton it is', () => {
  it('three batches of one item read as three different lines', () => {
    const today = '2026-09-26'
    const lines = [
      { batchNo: 'SIM1-7-A', expiryDate: '2026-10-20' },
      { batchNo: 'SIM1-7-B', expiryDate: '2027-02-20' },
      { batchNo: 'SIM1-7-C', expiryDate: '2027-03-15' },
    ]
    const texts = lines.map((line) => batchLabel(line, t, today)?.text)
    expect(texts).toEqual([
      'Batch SIM1-7-A · Expires 20 Oct 2026',
      'Batch SIM1-7-B · Expires 20 Feb 2027',
      'Batch SIM1-7-C · Expires 15 Mar 2027',
    ])
    expect(new Set(texts).size).toBe(3)
  })

  it('flags the short-life batch in words (24 days left), not the long-life ones', () => {
    const today = '2026-09-26'
    const short = batchLabel({ batchNo: 'SIM1-7-A', expiryDate: '2026-10-20' }, t, today)
    expect(short).toMatchObject({ daysLeft: 24, shortLife: true, warning: '24 days left' })
    const long = batchLabel({ batchNo: 'SIM1-7-B', expiryDate: '2027-02-20' }, t, today)
    expect(long).toMatchObject({ shortLife: false, warning: null })
    expect(batchLabel({ batchNo: 'X', expiryDate: '2026-09-27' }, t, today)?.warning).toBe(
      '1 day left',
    )
    expect(batchLabel({ batchNo: 'X', expiryDate: '2026-09-20' }, t, today)?.warning).toBe(
      'Expired',
    )
  })

  it('says whichever half the bill printed, and nothing when it printed neither', () => {
    const today = '2026-09-26'
    expect(batchLabel({ batchNo: 'B7', expiryDate: null }, t, today)?.text).toBe('Batch B7')
    expect(batchLabel({ batchNo: null, expiryDate: '2027-01-15' }, t, today)?.text).toBe(
      'Expires 15 Jan 2027',
    )
    expect(batchLabel({ batchNo: '  ', expiryDate: null }, t, today)).toBeNull()
    expect(batchLabel({ batchNo: null, expiryDate: null }, t, today)).toBeNull()
  })

  it('prints the expiry with its year', () => {
    expect(expiryText('2026-10-20')).toBe('20 Oct 2026')
    expect(expiryText('2027-01-05')).toBe('5 Jan 2027')
  })
})
