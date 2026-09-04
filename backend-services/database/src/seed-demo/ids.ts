import { createHash } from 'node:crypto'

/**
 * Deterministic, UUID-shaped id for demo rows: sha1(`dos-demo:${kind}:${n}`), formatted 8-4-4-4-12,
 * with the RFC 4122 version/variant nibbles forced so it validates as a real UUID (every contract id
 * field uses `z.uuid()`, which rejects a merely UUID-*shaped* string). Re-running the seed derives the
 * exact same ids every time, so `onConflictDoNothing()` makes the whole demo dataset idempotent
 * without needing to look anything up first.
 */
export function demoId(kind: string, n: number | string): string {
  const hex = createHash('sha1')
    .update(`dos-demo:${kind}:${n}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '7' // version nibble: 7, matching uuidv7 used everywhere else in the app
  const variantValue = (parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8 // variant nibble: 8/9/a/b
  hex[16] = variantValue.toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
