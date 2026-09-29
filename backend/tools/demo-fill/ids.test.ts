import { describe, expect, it } from 'vitest'
import {
  DEMO_ID_LIKE,
  addDays,
  daysBetween,
  demoId,
  demoIdDate,
  demoIdFromKey,
  demoKey,
  demoKeyDate,
  isDemoId,
  istMidnightMs,
  shuffled,
  stableUuid,
  todayIst,
  unit,
} from './ids.js'

const T = '01a0eb1e-3c50-74e3-8bdb-c81a7fd0d498'

/** SQL `LIKE` as a regular expression, to prove the pattern the marker check uses. */
function likeToRegExp(like: string): RegExp {
  const body = like
    .split('')
    .map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${body}$`)
}

describe('the marker: keys and the ids derived from them', () => {
  it('starts every key with demo-fill:<business date>: and keeps the parts readable', () => {
    const key = demoKey('2026-09-29', 'order', 't1.3', 'create')
    expect(key).toBe('demo-fill:2026-09-29:order:t1.3:create')
    expect(demoKeyDate(key)).toBe('2026-09-29')
    expect(demoKeyDate('some-other-key')).toBeNull()
  })

  it('caps a long key at the server limit of 128 without losing the date or colliding', () => {
    const long = 'x'.repeat(200)
    const a = demoKey('2026-09-29', 'finish', long, 'a')
    const b = demoKey('2026-09-29', 'finish', long, 'b')
    expect(a.length).toBeLessThanOrEqual(128)
    expect(b.length).toBeLessThanOrEqual(128)
    expect(a).not.toBe(b)
    expect(demoKeyDate(a)).toBe('2026-09-29')
  })

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(() => demoKey('29-09-2026', 'x')).toThrow()
    expect(() => demoKey('2026-13-45', 'x')).toThrow()
  })

  it('derives the same id from the same key, a different id from another', () => {
    expect(demoId(T, '2026-09-29', 'order', 'h1')).toBe(demoId(T, '2026-09-29', 'order', 'h1'))
    expect(demoId(T, '2026-09-29', 'order', 'h1')).not.toBe(demoId(T, '2026-09-29', 'order', 'h2'))
    expect(demoId(T, '2026-09-29', 'order', 'h1')).not.toBe(demoId(T, '2026-09-28', 'order', 'h1'))
    expect(() => demoIdFromKey(T, 'not-a-demo-key')).toThrow()
  })

  it('gives two distributors on one database different ids for the same key', () => {
    const key = demoKey('2026-09-29', 'order', 'h1')
    const other = '01a0eb35-6ca8-76cf-acb7-9bb46e5ff354'
    expect(demoIdFromKey(T, key)).not.toBe(demoIdFromKey(other, key))
    expect(demoIdDate(demoIdFromKey(other, key))).toBe('2026-09-29')
    expect(() => demoIdFromKey('', key)).toThrow()
  })

  it('makes a valid UUIDv7 whose time falls inside the business date in IST and carries the tag', () => {
    for (let n = 0; n < 200; n++) {
      const id = demoId(T, '2026-09-29', 'probe', String(n))
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(isDemoId(id)).toBe(true)
      expect(demoIdDate(id)).toBe('2026-09-29')
      const ms = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
      expect(ms).toBeGreaterThanOrEqual(istMidnightMs('2026-09-29'))
      expect(ms).toBeLessThan(istMidnightMs('2026-09-30'))
    }
  })

  it('is found by the SQL pattern of the marker check, and a server id is not', () => {
    const like = likeToRegExp(DEMO_ID_LIKE)
    expect(like.test(demoId(T, '2026-09-29', 'receipt', 'x'))).toBe(true)
    const server = '01a0eb1e-3c50-74e3-8bdb-c81a7fd0d498'
    expect(like.test(server)).toBe(false)
    expect(isDemoId(server)).toBe(false)
    expect(demoIdDate(server)).toBeNull()
    expect(isDemoId(null)).toBe(false)
  })

  it('gives a device id that is stable, a UUIDv7 shape, and NOT marked', () => {
    const device = stableUuid('demo-fill:device:tarsun:tester.driver1')
    expect(device).toBe(stableUuid('demo-fill:device:tarsun:tester.driver1'))
    expect(device).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(isDemoId(device)).toBe(false)
  })
})

describe('dates and choices', () => {
  it("names today's date in IST, not UTC", () => {
    // 20:00 UTC on 28 Sep is 01:30 IST on 29 Sep.
    expect(todayIst(Date.parse('2026-09-28T20:00:00Z'))).toBe('2026-09-29')
    expect(todayIst(Date.parse('2026-09-28T18:00:00Z'))).toBe('2026-09-28')
  })

  it('adds and counts whole days across a month end', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(daysBetween('2026-09-22', '2026-09-29')).toBe(7)
  })

  it('draws numbers in [0, 1) and shuffles the same way for the same seed', () => {
    for (let n = 0; n < 100; n++) {
      const u = unit(`seed:${String(n)}`)
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
    const list = ['a', 'b', 'c', 'd', 'e', 'f']
    const one = shuffled(list, 's', (x) => x)
    expect(shuffled(list, 's', (x) => x)).toEqual(one)
    expect([...one].sort()).toEqual(list)
  })
})
