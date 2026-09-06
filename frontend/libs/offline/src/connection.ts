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
  }
}
