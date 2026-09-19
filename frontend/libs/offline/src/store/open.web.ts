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
 *
 * AND NOTHING HERE IS SILENT (DOS-167 ruling 2 (t)). The fallback carries the reason it was taken, and the engine
 * says it: on the web proof of 199952b every open failed, this answered memory without a word, and a rep was told his
 * order was kept on the phone while only the tab held it.
 *
 * AND ONE AT A TIME (DOS-167 ruling 3 (aa), S-138). A first mount asked for THREE databases in the same tick — this
 * person's file, the legacy `dos-sales.db` destroy, the 199952b interim sweep — and when the expo-sqlite chunk and
 * its wa-sqlite worker arrived late (a cold start, the first load after a deploy, a weak connection) all three
 * reached the worker before its first init had resolved. `expo-sqlite/web/worker.ts` `maybeInitAsync()` sets
 * `_sqlite3` only AFTER its own await, so each built its own WASM module and its own `AccessHandlePoolVFS` over one
 * OPFS directory; `wa-sqlite/sqlite-api.js:34-35` keeps ONE module-global scratch cell that `open_v2` writes and
 * reads back across an await, so the three clobbered each other's file names. Measured 41 times: `jOpen zName=""`,
 * `0.<random>` orphans that hold a pool slot for ever, `SQLiteError: not a database`, no `/sync` for 240 s — and
 * the next person on that browser profile broken too. Neither library is ours to fix, so the PRODUCT stops being
 * concurrent: every open goes through one chain, and a second waits for the first to settle either way.
 */
import { createMemoryStore } from './memory.js'
import { openExpoSqlite, type ExpoSqliteLike } from './expo-sqlite.js'
import type { StoreKind, SyncStore } from '../types.js'

/** Why this page cannot have OPFS, or null when it can. */
function whyNoOpfs(): string | null {
  const scope = globalThis as {
    crossOriginIsolated?: boolean
    navigator?: { storage?: { getDirectory?: unknown } }
    Worker?: unknown
  }
  if (scope.crossOriginIsolated !== true) return 'not cross-origin isolated (no COOP/COEP)'
  if (typeof scope.Worker !== 'function') return 'no OPFS'
  return typeof scope.navigator?.storage?.getDirectory === 'function' ? null : 'no OPFS'
}

function inMemory(reason: string): SyncStore {
  return createMemoryStore({ wanted: 'sqlite-web', reason })
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

/**
 * The seam that makes the rule above testable in Node, without mocking the bare `expo-sqlite` specifier — which is
 * what a throwaway did during the diagnosis, and it went red for the wrong reason. Optional, so `openStore` is
 * still a `StoreFactory` and no caller changes.
 */
export interface OpenStoreDeps {
  loadSqlite?: () => Promise<ExpoSqliteLike | null>
  timeoutMs?: number
}

/** ONE open at a time, for the life of the page (ruling 3 (aa)). It never rejects, so nothing can break the chain. */
let webOpens: Promise<void> = Promise.resolve()

async function openStoreInner(name: string, deps: OpenStoreDeps): Promise<SyncStore> {
  const missing = whyNoOpfs()
  if (missing !== null) return inMemory(missing)
  const sqlite = await (deps.loadSqlite ?? loadSqlite)()
  if (sqlite === null) return inMemory('expo-sqlite did not load')
  try {
    return await openExpoSqlite(sqlite, name, 'sqlite-web')
  } catch (error) {
    return inMemory(`open failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function openStore(name: string, deps: OpenStoreDeps = {}): Promise<SyncStore> {
  const mine = webOpens.then(async () => openStoreInner(name, deps))
  webOpens = mine.then(
    () => undefined,
    () => undefined,
  )
  return mine
}

export async function probeStoreKind(): Promise<StoreKind> {
  if (whyNoOpfs() !== null) return 'memory'
  return (await loadSqlite()) === null ? 'memory' : 'sqlite-web'
}
