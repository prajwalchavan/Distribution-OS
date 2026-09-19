/**
 * DOS-179 — the one line between what the store turned out to be and what a screen may claim.
 *
 * `SyncStatus.persistent` is a TRI-STATE: null while the store is still opening (DOS-167 ruling 3 (ee)),
 * then true or false. Two different questions read it, and they read it differently:
 *
 *   - the STRIP, which STATES a fact: it says "not kept" only on a resolved false, so a sign-in over a
 *     perfectly good file never flashes the sentence (S-140);
 *   - a VERB that OFFERS a keep ("Save on this phone"): null is treated exactly as false, because a
 *     button must never promise a keep the device may not be able to make.
 *
 * `keepClaim` is that second rule, in one pure function, so all three field apps ask the same question
 * instead of each writing its own truthiness test.
 */
import { describe, expect, it } from 'vitest'

import { connectionStateFrom, keepClaim } from './connection.js'
import type { SyncStatus } from './types.js'

function statusWith(persistent: boolean | null): SyncStatus {
  return {
    online: true,
    store: persistent === false ? 'memory' : 'sqlite-web',
    persistent,
    storeNote: persistent === false ? 'not cross-origin isolated (no COOP/COEP)' : null,
    lastPulledAt: '2026-09-19T06:00:00.000Z',
    pulling: false,
    pending: 0,
    oldestPendingAt: null,
    rejected: 0,
    uploading: false,
    schemaVersion: 'v1',
    upgradeRequired: false,
    ready: true,
    lastError: null,
  }
}

describe('DOS-179 the store says what it is, on every screen', () => {
  it('DOS-179 connectionStateFrom carries persistent as a tri-state and keepClaim offers the device only on true', () => {
    // The mapping is a pass-through, not a truthiness test: all three values reach the strip intact.
    expect(connectionStateFrom(statusWith(true)).persistent).toBe(true)
    expect(connectionStateFrom(statusWith(false)).persistent).toBe(false)
    expect(connectionStateFrom(statusWith(null)).persistent).toBeNull()

    // And nothing else about the state changed.
    expect(connectionStateFrom(statusWith(false))).toEqual({
      online: true,
      lastSyncedAt: Date.parse('2026-09-19T06:00:00.000Z'),
      pendingWrites: 0,
      needsAttention: 0,
      staleSince: Date.parse('2026-09-19T06:00:00.000Z'),
      persistent: false,
    })

    // An OFFER is stricter than a statement: only a resolved, persistent store earns the phone's word.
    expect(keepClaim(true)).toBe('device')
    expect(keepClaim(false)).toBe('tab')
    expect(keepClaim(null)).toBe('tab')
    expect(keepClaim(undefined)).toBe('tab')
  })
})
