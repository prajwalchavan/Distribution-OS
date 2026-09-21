/**
 * S-168 — D8's office figures were read once per mount and never again.
 *
 * `useQuery` fetches on mount and on invalidation, and day.tsx invalidated `['settlement']` only
 * after `trips.return`. Nothing refetched when the outbox drained, when the signal came back, or when
 * the desk settled the trip — while `status.pending` and the device's own receipts went on changing
 * under the same figures. Risk (e)(1) of the DOS-168..170 ruling predicted a STALE note beside an
 * ENABLED button; measured on web at both widths it was worse in a quieter way: once the queue
 * drained on the same mount, "Cash the office expects" read **"—"**, no figure at all, beside an
 * enabled "Check the vehicle in". The right ₹1,944.00 came back only when D8 was re-opened. A driver
 * who took cash with no signal and watched the strip go green was invited to check in with no
 * hand-over figure on screen (money-web.md §5(A), phase 3).
 *
 * So the read is repeated when the three things that can change the office's answer change: the
 * signal, the outbox reaching empty, and a delta pull landing (a desk settling arrives that way).
 * A count going 3 → 2 is NOT one of them: the answer cannot change until the queue is empty, and a
 * read per upload is a read per upload times a lakh of phones (docs/20 rule 1).
 */
import { describe, expect, it } from 'vitest'

import { dayEndReadKey } from './check-in'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** One of this app's source files. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes the old rule is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const OFFLINE_HOLDING = { online: false, pending: 1, lastPulledAt: '2026-09-21T09:20:00.000Z' }

describe('S-168 when D8 reads the office’s figures again', () => {
  it('re-reads when the signal returns, when the outbox empties, and when a pull lands', () => {
    const held = dayEndReadKey(OFFLINE_HOLDING)

    // The walk's own sequence. Offline holding one receipt, then the signal comes back: the office
    // may now know something this screen does not.
    expect(dayEndReadKey({ ...OFFLINE_HOLDING, online: true })).not.toBe(held)

    // The queue drains on the same mount — the exact moment the figure blanked.
    expect(dayEndReadKey({ ...OFFLINE_HOLDING, online: true, pending: 0 })).not.toBe(
      dayEndReadKey({ ...OFFLINE_HOLDING, online: true }),
    )

    // A delta pull lands: the desk returning or settling this trip arrives that way.
    expect(
      dayEndReadKey({ ...OFFLINE_HOLDING, lastPulledAt: '2026-09-21T09:23:00.000Z' }),
    ).not.toBe(held)
  })

  it('does not re-read on every upload, or on a render that changed nothing', () => {
    // The same status twice is the same read: an effect keyed on this fires once.
    expect(dayEndReadKey(OFFLINE_HOLDING)).toBe(dayEndReadKey({ ...OFFLINE_HOLDING }))

    // A queue going 3 → 2 cannot change what the office would answer, and a read per upload is a
    // read per upload across every phone in the field.
    expect(dayEndReadKey({ ...OFFLINE_HOLDING, pending: 3 })).toBe(
      dayEndReadKey({ ...OFFLINE_HOLDING, pending: 2 }),
    )

    // A device that has never completed a pull is still one state, not a new one per render.
    expect(dayEndReadKey({ online: true, pending: 0, lastPulledAt: null })).toBe(
      dayEndReadKey({ online: true, pending: 0, lastPulledAt: null }),
    )
  })

  it('guard: app/day.tsx re-reads the preview on that key, and not only after a check-in', async () => {
    const code = withoutComments(await read('../../app/day.tsx'))

    expect(code).toMatch(
      /import\s*\{[^}]*\bdayEndReadKey\b[^}]*\}\s*from\s*'\.\.\/src\/lib\/check-in'/,
    )
    expect(code.match(/\bdayEndReadKey\s*\(/g) ?? []).toHaveLength(1)

    // The refetch is an effect on that key, not a call in the render body (which would loop), and it
    // is the SETTLEMENT preview that is read again — not merely some effect that happens to exist.
    expect(code).toMatch(/const refetchPreview = preview\.refetch/)
    expect(code).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?refetchPreview\(\)[\s\S]*?\}, \[readKey, refetchPreview, mayRead\]\)/,
    )
  })
})
