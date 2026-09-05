/**
 * UUIDv7 generated on the client so records can be created offline and stay time-ordered.
 * Human-facing numbers (invoice GL/1686, order numbers) are separate server-assigned columns.
 */
type RandomBytes = (length: number) => Uint8Array

let lastMs = 0
let lastSeq = 0

function defaultRandom(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (!c?.getRandomValues)
    throw new Error(
      'crypto.getRandomValues is unavailable; install react-native-get-random-values on RN',
    )
  c.getRandomValues(bytes)
  return bytes
}

export function uuidv7(now: number = Date.now(), random: RandomBytes = defaultRandom): string {
  if (now === lastMs) {
    lastSeq = (lastSeq + 1) & 0xfff
    if (lastSeq === 0) now = ++lastMs
  } else {
    lastMs = now
    lastSeq = random(2).reduce((acc, b) => (acc << 8) | b, 0) & 0x7ff
  }
  const rand = random(8)
  const bytes = new Uint8Array(16)
  bytes[0] = (now / 2 ** 40) & 0xff
  bytes[1] = (now / 2 ** 32) & 0xff
  bytes[2] = (now >>> 24) & 0xff
  bytes[3] = (now >>> 16) & 0xff
  bytes[4] = (now >>> 8) & 0xff
  bytes[5] = now & 0xff
  bytes[6] = 0x70 | ((lastSeq >>> 8) & 0x0f)
  bytes[7] = lastSeq & 0xff
  bytes[8] = 0x80 | ((rand[0] ?? 0) & 0x3f)
  for (let i = 1; i < 8; i++) bytes[8 + i] = rand[i] ?? 0
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Milliseconds embedded in a v7 id (useful for offline conflict ordering). */
export function uuidv7Time(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12)
  return parseInt(hex, 16)
}
