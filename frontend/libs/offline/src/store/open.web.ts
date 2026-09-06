/**
 * Opening the device database in a browser (docs/27 §2).
 *
 * `expo-sqlite`'s web build is wa-sqlite writing into OPFS from a worker, and OPFS's synchronous
 * access handles are only granted to a page the browser considers CROSS-ORIGIN ISOLATED — which means
 * the page was served with `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp`. The hosted site sends both (docs/26); a plain
 * `expo start --web` and any page opened over `file://` do not.
 *
 * So the check is `crossOriginIsolated` plus the presence of OPFS itself, made BEFORE the import: a
 * store that cannot be persisted must announce itself as memory rather than half-open one that throws
 * on the first write. Nothing here throws — a missing capability answers with the fallback, the way
 * every `@dos/ui/platform` module does.
 */
import { createMemoryStore } from './memory.js'
import { openExpoSqlite, type ExpoSqliteLike } from './expo-sqlite.js'
import type { StoreKind, SyncStore } from '../types.js'

function opfsAvailable(): boolean {
  if (typeof globalThis === 'undefined') return false
  const scope = globalThis as {
    crossOriginIsolated?: boolean
    navigator?: { storage?: { getDirectory?: unknown } }
    Worker?: unknown
  }
  if (scope.crossOriginIsolated !== true) return false
  if (typeof scope.Worker !== 'function') return false
  return typeof scope.navigator?.storage?.getDirectory === 'function'
}

async function loadSqlite(): Promise<ExpoSqliteLike | null> {
  try {
    const module: unknown = await import('expo-sqlite')
    const candidate = module as Partial<ExpoSqliteLike>
    return typeof candidate.openDatabaseAsync === 'function' ? (candidate as ExpoSqliteLike) : null
  } catch {
    return null
  }
}

export async function openStore(name: string): Promise<SyncStore> {
  if (!opfsAvailable()) return createMemoryStore()
  const sqlite = await loadSqlite()
  if (sqlite === null) return createMemoryStore()
  try {
    return await openExpoSqlite(sqlite, name, 'sqlite-web')
  } catch {
    return createMemoryStore()
  }
}

export async function probeStoreKind(): Promise<StoreKind> {
  if (!opfsAvailable()) return 'memory'
  return (await loadSqlite()) === null ? 'memory' : 'sqlite-web'
}
