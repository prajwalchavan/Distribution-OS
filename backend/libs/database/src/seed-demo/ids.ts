import { createHash } from 'node:crypto'

/**
 * Global (platform-curated) row kinds. The manufacturers, brands, products, variants, pack sizes,
 * external codes, aliases and HSN rates are ONE curated catalog shared by every distributor
 * (ADR 0005), so their ids must be the same whichever tenant is being seeded. Everything else is
 * tenant data and gets the current demo scope mixed into its hash.
 */
const GLOBAL_KINDS = new Set([
  'manufacturer',
  'brand',
  'product',
  'variant',
  'pack',
  'external-code',
  'alias',
  'hsn-rate',
])

/**
 * The scope the next `demoId()` is namespaced by. Empty for the pilot tenant (Tarsun), so every id
 * the demo has ever produced stays byte-identical — the service `/docs` examples, `pnpm smoke` and
 * the specs all quote them. Each additional distributor seeds under its own scope, e.g. `'sai:'`.
 *
 * A module-level variable is enough because the seed is one sequential process: `seedDemo` runs one
 * tenant at a time inside `inDemoScope`, which restores the previous value in a `finally`.
 */
let scope = ''

/** The scope in force right now; `''` for the pilot tenant. */
export function currentDemoScope(): string {
  return scope
}

/** Runs `fn` with every non-global `demoId()` namespaced by `next`, then restores the old scope. */
export async function inDemoScope<T>(next: string, fn: () => Promise<T>): Promise<T> {
  const previous = scope
  scope = next
  try {
    return await fn()
  } finally {
    scope = previous
  }
}

/**
 * Deterministic, UUID-shaped id for demo rows: sha1(`dos-demo:${scope}${kind}:${n}`), formatted
 * 8-4-4-4-12, with the RFC 4122 version/variant nibbles forced so it validates as a real UUID (every
 * contract id field uses `z.uuid()`, which rejects a merely UUID-*shaped* string). Re-running the seed
 * derives the exact same ids every time, so `onConflictDoNothing()` makes the whole demo dataset
 * idempotent without needing to look anything up first.
 *
 * The scope (see `inDemoScope`) is what lets the same builders write three distributors' worth of
 * data into one database without a single id collision. Global kinds ignore it.
 */
export function demoId(kind: string, n: number | string): string {
  const prefix = GLOBAL_KINDS.has(kind) ? '' : scope
  const hex = createHash('sha1')
    .update(`dos-demo:${prefix}${kind}:${n}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '7' // version nibble: 7, matching uuidv7 used everywhere else in the app
  const variantValue = (parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8 // variant nibble: 8/9/a/b
  hex[16] = variantValue.toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
