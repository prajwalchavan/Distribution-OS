import { createHash } from 'node:crypto'

/**
 * THE MARKER (brief rule 2). Every row the tool writes is findable again, by the database and by the API,
 * without a column of its own:
 *
 *  - its IDEMPOTENCY KEY starts `demo-fill:<business date>:` and names the step and the thing it acts on;
 *  - its ID is DERIVED from that key: a UUIDv7 whose 48-bit timestamp falls inside the business date (IST)
 *    the key names, whose version nibble is 7 and variant bits RFC 9562's, and which carries a fixed
 *    42-bit tag — `xxxxxxxx-xxxx-7d3f-bd3f-de30xxxxxxxx`. A server-made UUIDv7 carries that tag with a
 *    chance of 2^-42, so "is this ours?" is a pattern match (`isDemoId`, SQL `DEMO_ID_LIKE`), and "which
 *    day made it?" is the timestamp (`demoIdDate`).
 *
 * The same key always gives the same id, so the same date run twice addresses the same rows: the second
 * run finds them and writes nothing.
 */

export const DEMO_KEY_PREFIX = 'demo-fill'
/** Group 3, group 4 and the first four digits of group 5 of every id the tool makes. */
export const DEMO_TAG = { g3: '7d3f', g4: 'bd3f', g5: 'de30' } as const
/** For SQL: `id like DEMO_ID_LIKE`. */
export const DEMO_ID_LIKE = `%-${DEMO_TAG.g3}-${DEMO_TAG.g4}-${DEMO_TAG.g5}%`
const DEMO_ID_RE = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-${DEMO_TAG.g3}-${DEMO_TAG.g4}-${DEMO_TAG.g5}[0-9a-f]{8}$`,
)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const IST_OFFSET_MS = 5.5 * 3600 * 1000
const DAY_MS = 86_400_000
/** The server's cap on an idempotency key (`IdempotencyKeySchema`). */
const MAX_KEY = 128

export function assertIsoDate(date: string): void {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new Error(`not a date: ${date} (YYYY-MM-DD)`)
}

/**
 * `demo-fill:<date>:<part>:<part>…`. Parts are joined as given; a key that would pass the server's
 * 128-character cap keeps its readable head and ends in a digest of the whole, so two long keys never
 * collide and the date stays in front.
 */
export function demoKey(date: string, ...parts: readonly string[]): string {
  assertIsoDate(date)
  const full = [DEMO_KEY_PREFIX, date, ...parts].join(':')
  if (full.length <= MAX_KEY) return full
  const digest = createHash('sha256').update(full).digest('hex').slice(0, 24)
  return `${full.slice(0, MAX_KEY - digest.length - 1)}~${digest}`
}

/** The business date a demo key names, or null for any other key. */
export function demoKeyDate(key: string): string | null {
  const m = /^demo-fill:(\d{4}-\d{2}-\d{2}):/.exec(key)
  return m?.[1] ?? null
}

/** Midnight IST of `date`, in epoch milliseconds. */
export function istMidnightMs(date: string): number {
  assertIsoDate(date)
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS
}

/** The IST calendar date of an epoch-milliseconds instant. */
export function istDateOf(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * The id of the row a demo key writes. `key` must be a demo key (it carries the date the timestamp is
 * placed in). Deterministic: SHA-256 of the key decides the time of day and the free bits.
 */
export function demoIdFromKey(key: string): string {
  const date = demoKeyDate(key)
  if (!date) throw new Error('demoIdFromKey: not a demo-fill key')
  const h = createHash('sha256').update(`id:${key}`).digest()
  const ms = istMidnightMs(date) + (h.readUInt32BE(0) % DAY_MS)
  const ts = ms.toString(16).padStart(12, '0')
  const tail = h.subarray(4, 8).toString('hex')
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-${DEMO_TAG.g3}-${DEMO_TAG.g4}-${DEMO_TAG.g5}${tail}`
}

/** `demoIdFromKey(demoKey(date, …parts))`. */
export function demoId(date: string, ...parts: readonly string[]): string {
  return demoIdFromKey(demoKey(date, ...parts))
}

export function isDemoId(id: string | null | undefined): boolean {
  return typeof id === 'string' && DEMO_ID_RE.test(id)
}

/** The business date a demo id was made for, or null for an id the tool did not make. */
export function demoIdDate(id: string): string | null {
  if (!isDemoId(id)) return null
  const ms = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
  return istDateOf(ms)
}

/** A stable, NON-marked UUID for things that are not rows (a device id). */
export function stableUuid(seed: string): string {
  const b = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A deterministic number in [0, 1) from a seed: every choice the plan makes goes through this. */
export function unit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 4294967296
}

/** `list` in a deterministic order for `seed` (a stable shuffle). */
export function shuffled<T>(list: readonly T[], seed: string, keyOf: (item: T) => string): T[] {
  return [...list]
    .map((item) => ({ item, k: unit(`${seed}:${keyOf(item)}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.item)
}

/** Whole days from `a` to `b` (both ISO dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Today's IST business date. */
export function todayIst(now: number = Date.now()): string {
  return istDateOf(now)
}
