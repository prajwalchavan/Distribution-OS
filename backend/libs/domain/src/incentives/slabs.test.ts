import { describe, expect, it } from 'vitest'
import {
  achievedPctBps,
  ACHIEVEMENT_FULL_BPS,
  evaluatePayout,
  matchSlab,
  slabPayoutPaise,
  SlabError,
  type PayoutSlabLike,
} from './slabs.js'

/**
 * The three founder rules (coordination §7 q32) as executable tests: only the slab reached, nothing
 * below the lowest, nothing extrapolated above the top. Every number here is hand-computed.
 */

/** ₹5,00,000 target, 0.5% at 80%, 1% at par, 1.5% past 120% — the demo table. */
const VALUE_TABLE: PayoutSlabLike[] = [
  { fromPct: 8_000, toPct: 10_000, payoutBps: 50 },
  { fromPct: 10_000, toPct: 12_000, payoutBps: 100 },
  { fromPct: 12_000, toPct: null, payoutBps: 150 },
]
const TARGET_PAISE = 50_000_000

/** A count target (lines / visits) pays flat rupees, never a share of a count. */
const FLAT_TABLE: PayoutSlabLike[] = [
  { fromPct: 5_000, toPct: 8_000, flatPaise: 50_000 },
  { fromPct: 8_000, toPct: 10_000, flatPaise: 150_000 },
  { fromPct: 10_000, flatPaise: 300_000 },
]

describe('achievedPctBps', () => {
  it('is basis points of the target, rounded half up', () => {
    expect(achievedPctBps(50_000_000, 50_000_000)).toBe(ACHIEVEMENT_FULL_BPS)
    expect(achievedPctBps(25_000_000, 50_000_000)).toBe(5_000)
    // 3 of 7 = 42.857% = 4285.71 bps -> 4286
    expect(achievedPctBps(3, 7)).toBe(4_286)
  })

  it('is uncapped: over-achievement reads past 10000', () => {
    expect(achievedPctBps(70_000_000, 50_000_000)).toBe(14_000)
    expect(achievedPctBps(500_000_000, 50_000_000)).toBe(100_000)
  })

  it('is 0 for nothing achieved and never divides by zero', () => {
    expect(achievedPctBps(0, 50_000_000)).toBe(0)
    expect(() => achievedPctBps(1, 0)).toThrow(SlabError)
    expect(() => achievedPctBps(1, -5)).toThrow(SlabError)
  })
})

describe('matchSlab', () => {
  it('matches the band containing the achievement, [fromPct, toPct) half-open', () => {
    // The boundary belongs to the HIGHER band: exactly 100% is the 1% slab, not the 0.5% one.
    expect(matchSlab(VALUE_TABLE, 9_999)?.payoutBps).toBe(50)
    expect(matchSlab(VALUE_TABLE, 10_000)?.payoutBps).toBe(100)
    expect(matchSlab(VALUE_TABLE, 11_999)?.payoutBps).toBe(100)
    expect(matchSlab(VALUE_TABLE, 12_000)?.payoutBps).toBe(150)
  })

  it('matches nothing below the lowest slab', () => {
    expect(matchSlab(VALUE_TABLE, 0)).toBeNull()
    expect(matchSlab(VALUE_TABLE, 7_999)).toBeNull()
    expect(matchSlab(VALUE_TABLE, 8_000)?.payoutBps).toBe(50)
  })

  it('keeps matching the open-ended top slab however far past it the rep goes', () => {
    expect(matchSlab(VALUE_TABLE, 20_000)?.payoutBps).toBe(150)
    expect(matchSlab(VALUE_TABLE, 100_000)?.payoutBps).toBe(150)
  })

  it('does not need the table sorted, and the highest fromPct wins an overlap', () => {
    const shuffled = [...VALUE_TABLE].reverse()
    expect(matchSlab(shuffled, 12_500)?.payoutBps).toBe(150)
    const overlapping: PayoutSlabLike[] = [
      { fromPct: 8_000, toPct: 20_000, flatPaise: 100 },
      { fromPct: 12_000, toPct: 20_000, flatPaise: 900 },
    ]
    expect(matchSlab(overlapping, 13_000)?.flatPaise).toBe(900)
    // Two bands with the same fromPct resolve to the one written first: deterministic, not arbitrary.
    const tied: PayoutSlabLike[] = [
      { fromPct: 8_000, flatPaise: 111 },
      { fromPct: 8_000, flatPaise: 222 },
    ]
    expect(matchSlab(tied, 9_000)?.flatPaise).toBe(111)
  })
})

describe('slabPayoutPaise', () => {
  it('reads payoutBps as a share of the target paise', () => {
    // 1% of ₹5,00,000 = ₹5,000 = 5_00_000 paise.
    expect(slabPayoutPaise({ fromPct: 10_000, payoutBps: 100 }, TARGET_PAISE)).toBe(500_000)
    // 0.5% = ₹2,500.
    expect(slabPayoutPaise({ fromPct: 8_000, payoutBps: 50 }, TARGET_PAISE)).toBe(250_000)
  })

  it('reads flatPaise as the amount itself, whatever the target measures', () => {
    expect(slabPayoutPaise({ fromPct: 10_000, flatPaise: 300_000 }, 120)).toBe(300_000)
  })

  it('refuses a slab with both rewards or neither', () => {
    expect(() => slabPayoutPaise({ fromPct: 0, payoutBps: 10, flatPaise: 5 }, 100)).toThrow(
      SlabError,
    )
    expect(() => slabPayoutPaise({ fromPct: 0 }, 100)).toThrow(SlabError)
  })

  it('rounds a bps share half up to the paise', () => {
    // 33 bps of 1_00_001 paise = 330.0033 -> 330.
    expect(slabPayoutPaise({ fromPct: 0, payoutBps: 33 }, 100_001)).toBe(330)
    // 1 bp of 15_000 paise = 1.5 -> 2 (half up).
    expect(slabPayoutPaise({ fromPct: 0, payoutBps: 1 }, 15_000)).toBe(2)
  })
})

describe('evaluatePayout', () => {
  it('pays each of the three bands at its boundary', () => {
    const at = (achieved: number) =>
      evaluatePayout({
        targetValue: TARGET_PAISE,
        achievedValue: achieved,
        payoutRule: VALUE_TABLE,
      })

    // 79.99% — below the table: nothing.
    expect(at(39_995_000)).toMatchObject({ achievedPct: 7_999, matchedSlab: null, payoutPaise: 0 })
    // exactly 80% — the first slab, 0.5% of target.
    expect(at(40_000_000)).toMatchObject({ achievedPct: 8_000, payoutPaise: 250_000 })
    // exactly 100% — the second slab, 1%. NOT 0.5% + 1%: the slab reached, never cumulative.
    expect(at(50_000_000)).toMatchObject({ achievedPct: 10_000, payoutPaise: 500_000 })
    // exactly 120% — the third slab, 1.5%.
    expect(at(60_000_000)).toMatchObject({ achievedPct: 12_000, payoutPaise: 750_000 })
  })

  it('never adds the lower slabs on top (cumulative would be 0.5 + 1 + 1.5 = 3%)', () => {
    const cumulativeWouldBe = 250_000 + 500_000 + 750_000
    const result = evaluatePayout({
      targetValue: TARGET_PAISE,
      achievedValue: 65_000_000,
      payoutRule: VALUE_TABLE,
    })
    expect(result.payoutPaise).toBe(750_000)
    expect(result.payoutPaise).not.toBe(cumulativeWouldBe)
  })

  it('does not extrapolate above the top slab: 300% pays what 120% pays', () => {
    const top = evaluatePayout({
      targetValue: TARGET_PAISE,
      achievedValue: 60_000_000,
      payoutRule: VALUE_TABLE,
    })
    const far = evaluatePayout({
      targetValue: TARGET_PAISE,
      achievedValue: 150_000_000,
      payoutRule: VALUE_TABLE,
    })
    expect(far.achievedPct).toBe(30_000)
    expect(far.payoutPaise).toBe(top.payoutPaise)
  })

  it('pays a count target its flat slab, and zero when nothing was done', () => {
    const lines = (achieved: number) =>
      evaluatePayout({ targetValue: 200, achievedValue: achieved, payoutRule: FLAT_TABLE })
    expect(lines(0)).toMatchObject({ achievedPct: 0, matchedSlab: null, payoutPaise: 0 })
    expect(lines(99)).toMatchObject({ achievedPct: 4_950, payoutPaise: 0 })
    expect(lines(100)).toMatchObject({ achievedPct: 5_000, payoutPaise: 50_000 })
    expect(lines(160)).toMatchObject({ achievedPct: 8_000, payoutPaise: 150_000 })
    expect(lines(200)).toMatchObject({ achievedPct: 10_000, payoutPaise: 300_000 })
    expect(lines(400)).toMatchObject({ achievedPct: 20_000, payoutPaise: 300_000 })
  })

  it('carries the matched slab back so a screen can name the band', () => {
    const result = evaluatePayout({
      targetValue: TARGET_PAISE,
      achievedValue: 55_000_000,
      payoutRule: VALUE_TABLE,
    })
    expect(result.matchedSlab).toEqual({ fromPct: 10_000, toPct: 12_000, payoutBps: 100 })
  })

  it('is a single-slab table when the owner writes one', () => {
    const single: PayoutSlabLike[] = [{ fromPct: 10_000, flatPaise: 1_000_000 }]
    expect(
      evaluatePayout({ targetValue: 10, achievedValue: 9, payoutRule: single }).payoutPaise,
    ).toBe(0)
    expect(
      evaluatePayout({ targetValue: 10, achievedValue: 10, payoutRule: single }).payoutPaise,
    ).toBe(1_000_000)
  })
})
