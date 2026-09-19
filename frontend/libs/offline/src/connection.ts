/**
 * The one line between the engine and the honesty contract (UX-00 §6.11, docs/27 §10).
 *
 * `<ConnectionStrip>` takes a `ConnectionState`; the engine produces a `SyncStatus`. The mapping is
 * here rather than in the kit so that `@dos/ui` keeps no knowledge of sync, and it is a pure function
 * so it can be tested without rendering anything.
 *
 * `staleSince` is the last successful pull: past four hours the strip says "Stock as of 6:10 am" in
 * ochre rather than letting a rep quote yesterday's availability as today's.
 */
import type { SyncStatus } from './types.js'

/** Structurally `ConnectionState` from `@dos/ui`; declared here so this package imports no renderer. */
export interface ConnectionStateLike {
  online: boolean
  lastSyncedAt?: number | null
  pendingWrites?: number
  needsAttention?: number
  staleSince?: number | null
  /**
   * DOS-179: whether this device keeps what it holds — the tri-state, passed THROUGH, never flattened.
   * The strip appends "Not kept in this browser" on a resolved `false` and says nothing on `null`.
   */
  persistent?: boolean | null
}

export function connectionStateFrom(status: SyncStatus): ConnectionStateLike {
  const at = status.lastPulledAt === null ? null : Date.parse(status.lastPulledAt)
  const lastSyncedAt = at === null || Number.isNaN(at) ? null : at
  return {
    online: status.online,
    lastSyncedAt,
    pendingWrites: status.pending,
    needsAttention: status.rejected,
    staleSince: lastSyncedAt,
    persistent: status.persistent,
  }
}

/**
 * Which word an app may use when it OFFERS to keep something (DOS-179).
 *
 * `'device'` — "Save on this phone", "Saved on this phone" — is earned only by a store that has
 * resolved AND keeps. `null` (still opening) counts as `'tab'`, because an offer is a promise: the
 * strip may withhold a STATEMENT until the open resolves (DOS-167 ruling 3 (ee), S-140), but a button
 * must never promise a keep the device may turn out not to be able to make.
 *
 * Every keep verb in the sales, delivery and warehouse apps goes through this, so the three cannot
 * drift apart and no screen can contradict the strip above it.
 */
export function keepClaim(persistent: boolean | null | undefined): 'device' | 'tab' {
  return persistent === true ? 'device' : 'tab'
}
