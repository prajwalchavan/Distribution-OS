/**
 * Opening the device database on Android and iOS (docs/27 §2).
 *
 * `expo-sqlite` is a native module: it exists only when the app's BINARY was built with it. An app
 * generated from the template before the dependency was added, or an old dev build on a rep's phone,
 * has the JavaScript and not the native side — so this asks for it dynamically and falls back to the
 * memory store, which says so in the strip, instead of a white screen on launch.
 *
 * The fallback carries the reason it was taken, and the engine says it (DOS-167 ruling 2 (t)): never silent.
 */
import { createMemoryStore } from './memory.js'
import { openExpoSqlite, type ExpoSqliteLike } from './expo-sqlite.js'
import type { StoreKind, SyncStore } from '../types.js'

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
 * HOW LONG AN OPEN MAY TAKE BEFORE THE APP CARRIES ON WITHOUT IT (DOS-167 ruling 3 (cc)). A store that never answers
 * must never be a hang: past the deadline the caller gets an announced memory store, and the real handle, when it
 * finally lands, is CLOSED — never destroyed, because nothing we failed to read is thrown away (founder answer A).
 * No chain here, unlike the web opener: each `openDatabaseAsync` on a phone is its own native handle (ruling 3 (aa)).
 */
export const OPEN_DEADLINE_MS = 15_000

/** The same optional seam the web opener carries, so an open can be driven in a test. `StoreFactory` is unchanged. */
export interface OpenStoreDeps {
  loadSqlite?: () => Promise<ExpoSqliteLike | null>
  timeoutMs?: number
}

function inMemory(reason: string): SyncStore {
  return createMemoryStore({ wanted: 'sqlite-native', reason })
}

async function openStoreInner(name: string, deps: OpenStoreDeps): Promise<SyncStore> {
  const sqlite = await (deps.loadSqlite ?? loadSqlite)()
  if (sqlite === null) return inMemory('expo-sqlite is not in this binary')
  try {
    return await openExpoSqlite(sqlite, name, 'sqlite-native')
  } catch (error) {
    return inMemory(`open failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function openStore(name: string, deps: OpenStoreDeps = {}): Promise<SyncStore> {
  const deadline = deps.timeoutMs ?? OPEN_DEADLINE_MS
  let answer: (store: SyncStore) => void = () => {}
  const answered = new Promise<SyncStore>((resolve) => {
    answer = resolve
  })
  let late = false
  const timer = setTimeout(() => {
    late = true
    answer(
      inMemory(
        `open timed out after ${deadline >= 1000 ? `${Math.round(deadline / 1000)}s` : `${deadline}ms`}`,
      ),
    )
  }, deadline)
  void openStoreInner(name, deps).then(
    async (store) => {
      clearTimeout(timer)
      if (!late) {
        answer(store)
        return
      }
      await store.close().catch(() => {})
    },
    (error: unknown) => {
      clearTimeout(timer)
      if (!late)
        answer(inMemory(`open failed: ${error instanceof Error ? error.message : String(error)}`))
    },
  )
  return answered
}

/** What this platform WOULD give, without opening anything — for a settings screen to be honest with. */
export async function probeStoreKind(): Promise<StoreKind> {
  return (await loadSqlite()) === null ? 'memory' : 'sqlite-native'
}
