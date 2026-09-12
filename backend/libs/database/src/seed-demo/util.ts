/** Small deterministic helpers shared by every seed-demo module: dates, pseudo-randomness, GSTIN shape. */

/**
 * "Today" for the whole demo dataset: the LIVE day every screen opens on. It is the last working day
 * on or before the real IST date when the database was first seeded, and it is remembered in
 * `tenant_settings` (`demo.anchor_date`, see `resolveDemoToday` in index.ts) so a re-seed of the same
 * database reproduces byte-identical rows — a seed on a fresh database is live, a re-seed is a no-op.
 * `DEMO_TODAY=YYYY-MM-DD` pins it from outside (the verifier, a screenshot session).
 *
 * The Date object is mutated in place by `setDemoToday` rather than re-exported, so every module's
 * `TODAY.getTime()` sees the anchor whichever import evaluated first. Nothing may derive a module-level
 * constant from it (compute lazily instead). IST has no DST, so a UTC-midnight date works throughout.
 */
export const TODAY = new Date(defaultDemoToday().getTime())
export const FY = '2026-27'

/** The last working day on or before the real IST date right now. */
export function defaultDemoToday(): Date {
  const pinned = process.env.DEMO_TODAY
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned))
    return lastWorkingDayOnOrBefore(new Date(`${pinned}T00:00:00.000Z`))
  const ist = new Date(Date.now() + 330 * 60_000)
  const midnight = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()))
  return lastWorkingDayOnOrBefore(midnight)
}

export function lastWorkingDayOnOrBefore(d: Date): Date {
  let day = new Date(d.getTime())
  while (!isWorkingDay(day)) day = new Date(day.getTime() - 86_400_000)
  return day
}

/** Moves the demo's live day. Called once per seed run before any row is built. */
export function setDemoToday(d: Date): void {
  TODAY.setTime(lastWorkingDayOnOrBefore(d).getTime())
}

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

/**
 * The working day before TODAY: yesterday on a Tuesday–Saturday live day, SATURDAY on a Monday.
 * Everything "yesterday" means in the demo — the loads still on the road, the bill the crew is out
 * delivering, the cancelled order — is keyed on this, never on the calendar day before, because a
 * Monday seed would otherwise look for Sunday's book and find nothing (2026-09-08 review).
 */
export function previousWorkingDay(): Date {
  return lastWorkingDayOnOrBefore(daysAgo(1))
}

/** Whether `day` is the working day before TODAY. */
export function isPreviousWorkingDay(day: Date): boolean {
  return isoDate(day) === isoDate(previousWorkingDay())
}

/**
 * The first working day after `day` plus `gap` calendar days: tomorrow's plan on a Saturday is
 * MONDAY's, never Sunday's (the depot's weekly off; 2026-09-08 review).
 */
export function workingDayAfter(day: Date, gap: number): Date {
  let d = new Date(day.getTime() + gap * 86_400_000)
  while (!isWorkingDay(d)) d = new Date(d.getTime() + 86_400_000)
  return d
}

/** The working day after TODAY: tomorrow, or Monday on a Saturday. */
export function nextWorkingDay(): Date {
  return workingDayAfter(TODAY, 1)
}

/** Whole calendar days from `a` to `b` (both UTC-midnight dates); negative when b is earlier. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** A small deterministic integer in [0, mod) from a string, for per-key jitter without an RNG stream. */
export function hashMod(key: string, mod: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  return (((h >>> 0) % mod) + mod) % mod
}

/**
 * A timestamp for something that HAS HAPPENED. The live day's rows are stamped at business hours
 * (a pack at 11:30, a receipt at 16:30 IST); a seed run at eight in the morning must not leave them
 * in the future, so a stamp past the wall clock on the real live day is clamped to now. A pinned
 * `DEMO_TODAY` on another date is left alone: moving its rows would move them off their day.
 */
/**
 * When a journal entry handed a bare date (UTC midnight, 05:30 IST) was posted: 10:30 IST that day,
 * the desk's morning. A real timestamp passes through. Clamped to the wall clock on the live day.
 */
export function postingTime(d: Date): Date {
  const bare = d.getTime() % 86_400_000 === 0
  return occurred(bare ? atIstTime(d, 10, 30) : d)
}

export function occurred(d: Date): Date {
  const now = Date.now()
  if (d.getTime() <= now || !isRealToday(d, now)) return d
  return new Date(now)
}

/** Whether `d` falls on the real IST date right now. */
function isRealToday(d: Date, now: number): boolean {
  const istToday = new Date(now + 330 * 60_000).toISOString().slice(0, 10)
  const istStamp = new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10)
  return istStamp === istToday
}

/**
 * `occurred` for a trail of stamps that must stay distinct and in order (a GPS trail with a unique
 * index on its time): the stamps past the wall clock are packed into the seconds before now, one
 * second apart, so no two share an instant and a re-seed a minute later inserts nothing new.
 */
export function occurredSeries(dates: readonly Date[]): Date[] {
  const now = Date.now()
  const future = dates.filter((d) => d.getTime() > now && isRealToday(d, now)).length
  let k = future
  return dates.map((d) => {
    if (d.getTime() <= now || !isRealToday(d, now)) return d
    k -= 1
    return new Date(now - k * 1000)
  })
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

/**
 * Weighted draw: `[[weight, value], …]`, weights need not sum to 1. One RNG call per draw, so the
 * stream stays positional whatever the table looks like.
 */
export function pickWeighted<T>(rng: () => number, table: readonly (readonly [number, T])[]): T {
  const total = table.reduce((s, [w]) => s + w, 0)
  if (total <= 0) throw new Error('pickWeighted() needs a positive total weight')
  let roll = rng() * total
  for (const [w, value] of table) {
    roll -= w
    if (roll < 0) return value
  }
  const last = table[table.length - 1]
  if (!last) throw new Error('pickWeighted() from an empty table')
  return last[1]
}

/** Working days (Sundays excluded) from `a` to `b` inclusive, both UTC-midnight dates; 0 when b < a. */
export function workingDaysBetween(a: Date, b: Date): number {
  let n = 0
  for (let t = a.getTime(); t <= b.getTime(); t += 86_400_000) {
    if (isWorkingDay(new Date(t))) n += 1
  }
  return n
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
