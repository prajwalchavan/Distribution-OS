/** Small deterministic helpers shared by every seed-demo module: dates, pseudo-randomness, GSTIN shape. */

/** "Today" for the whole demo dataset, pinned so re-runs are stable. IST has no DST, so a fixed date works. */
export const TODAY = new Date(Date.UTC(2026, 8, 4)) // 2026-09-04, UTC midnight
export const FY = '2026-27'

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** UTC midnight `n` days before TODAY. */
export function daysAgo(n: number): Date {
  return new Date(TODAY.getTime() - n * 86_400_000)
}

/** UTC midnight `n` days after TODAY. */
export function daysAhead(n: number): Date {
  return new Date(TODAY.getTime() + n * 86_400_000)
}

/** A timestamp on `day` at roughly `hourIst:minuteIst` IST (IST = UTC+5:30). */
export function atIstTime(day: Date, hourIst: number, minuteIst = 0): Date {
  const totalMinutesUtc = hourIst * 60 + minuteIst - 330
  return new Date(day.getTime() + totalMinutesUtc * 60_000)
}

/** Sundays are the weekly off for the depot and the sales team. */
export function isWorkingDay(d: Date): boolean {
  return d.getUTCDay() !== 0
}

/** The last `n` calendar days (0 = today) that are working days, oldest first. */
export function workingDaysBack(n: number): Date[] {
  const out: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = daysAgo(i)
    if (isWorkingDay(d)) out.push(d)
  }
  return out
}

/** Deterministic PRNG (mulberry32) seeded from a string, so re-runs generate byte-identical data. */
export function makeRng(seedStr: string): () => number {
  let seed = 0
  for (let i = 0; i < seedStr.length; i++) seed = (Math.imul(seed, 31) + seedStr.charCodeAt(i)) | 0
  return function mulberry32() {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)]
  if (item === undefined) throw new Error('pick() from an empty array')
  return item
}

/** Inclusive random integer in [min, max]. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function randChance(rng: () => number, probability: number): boolean {
  return rng() < probability
}

export function nth<T>(arr: readonly T[], i: number): T {
  const item = arr[i]
  if (item === undefined) throw new Error(`index ${i} out of range (length ${arr.length})`)
  return item
}

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Builds a GSTIN with a correct mod-36 check digit from a state code and a PAN-shaped 10-char seed. */
export function makeGstin(stateCode: string, panLike: string, entityCode = '1'): string {
  const base = `${stateCode}${panLike.toUpperCase()}${entityCode}Z`
  let total = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(base[i] ?? '0')
    const factor = i % 2 === 0 ? 1 : 2
    const product = value * factor
    total += Math.floor(product / 36) + (product % 36)
  }
  const check = GSTIN_ALPHABET[(36 - (total % 36)) % 36] ?? '0'
  return `${base}${check}`
}

/** Deterministic small offset around a centre point, e.g. retailer coordinates around Kalyan West. */
export function jitter(rng: () => number, centre: number, spread: number): number {
  return Math.round((centre + (rng() * 2 - 1) * spread) * 1_000_000) / 1_000_000
}
