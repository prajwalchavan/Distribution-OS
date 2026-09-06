/**
 * The real store: `expo-sqlite` (docs/27 §2).
 *
 * ONE adapter serves both SQLite kinds because `expo-sqlite` ships the same API on both — native
 * (Android/iOS) and its web build, which is wa-sqlite over OPFS in a worker. What differs is whether
 * the platform can give it a place to write, and that is decided by the two openers beside this file.
 *
 * The module is imported DYNAMICALLY, never at the top of a file the bundler follows unconditionally:
 * `@dos/offline` is a dependency of every app through the template, and a static import would put a
 * native module into the bundle of an app whose binary has not been rebuilt with it, where it throws
 * on the first launch instead of falling back to memory. Vitest and the Vite harness would not resolve
 * it at all.
 */
import type { SqlValue, SyncStore } from '../types.js'

/**
 * The slice of `expo-sqlite`'s `SQLiteDatabase` this adapter uses, declared structurally so nothing
 * here depends on the package's types being resolvable in Node.
 */
export interface ExpoDatabaseLike {
  execAsync(sql: string): Promise<void>
  runAsync(sql: string, params: readonly SqlValue[]): Promise<unknown>
  getAllAsync<T>(sql: string, params: readonly SqlValue[]): Promise<T[]>
  withTransactionAsync(fn: () => Promise<void>): Promise<void>
  closeAsync(): Promise<void>
}

export interface ExpoSqliteLike {
  openDatabaseAsync(name: string, options?: Record<string, unknown>): Promise<ExpoDatabaseLike>
}

class ExpoSqliteStore implements SyncStore {
  readonly persistent = true
  private depth = 0

  constructor(
    private readonly db: ExpoDatabaseLike,
    readonly kind: 'sqlite-native' | 'sqlite-web',
  ) {}

  async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    if (params.length === 0) {
      // `execAsync` is the only call that takes a multi-statement script.
      await this.db.execAsync(sql)
      return
    }
    await this.db.runAsync(sql, params)
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params)
  }

  /**
   * `withTransactionAsync` commits when the callback resolves and rolls back when it throws. SQLite
   * has no nested transactions, so an inner call joins the outer one — the same rule the memory
   * adapter and `withTenant` on the server follow.
   */
  async transaction<T>(fn: (tx: SyncStore) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this)
    let result: T
    let captured: unknown = null
    let ok = false
    this.depth += 1
    try {
      await this.db.withTransactionAsync(async () => {
        try {
          result = await fn(this)
          ok = true
        } catch (error) {
          captured = error
          throw error
        }
      })
    } finally {
      this.depth -= 1
    }
    if (!ok) throw captured
    // `result` is assigned whenever `ok` is true; the compiler cannot see across the callback.
    return result!
  }

  async close(): Promise<void> {
    await this.db.closeAsync()
  }
}

/**
 * WAL and `synchronous=NORMAL` are docs/27 §2's settings: a write that survives an app crash without
 * paying a full fsync per statement, which is what makes a 200-line order feel instant on a budget
 * phone. The web build ignores both, harmlessly.
 */
export async function openExpoSqlite(
  sqlite: ExpoSqliteLike,
  name: string,
  kind: 'sqlite-native' | 'sqlite-web',
): Promise<SyncStore> {
  const db = await sqlite.openDatabaseAsync(name)
  try {
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  } catch {
    /* the web build has no journal to set; the database is still usable */
  }
  return new ExpoSqliteStore(db, kind)
}
