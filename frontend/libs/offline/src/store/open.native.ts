/**
 * Opening the device database on Android and iOS (docs/27 §2).
 *
 * `expo-sqlite` is a native module: it exists only when the app's BINARY was built with it. An app
 * generated from the template before the dependency was added, or an old dev build on a rep's phone,
 * has the JavaScript and not the native side — so this asks for it dynamically and falls back to the
 * memory store, which says so in the strip, instead of a white screen on launch.
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

export async function openStore(name: string): Promise<SyncStore> {
  const sqlite = await loadSqlite()
  if (sqlite === null) return createMemoryStore()
  try {
    return await openExpoSqlite(sqlite, name, 'sqlite-native')
  } catch {
    return createMemoryStore()
  }
}

/** What this platform WOULD give, without opening anything — for a settings screen to be honest with. */
export async function probeStoreKind(): Promise<StoreKind> {
  return (await loadSqlite()) === null ? 'memory' : 'sqlite-native'
}
