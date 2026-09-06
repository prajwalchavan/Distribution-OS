/**
 * The honest fallback (docs/27 §2). `persistent: false`, so `<ConnectionStrip>` can say "Offline data
 * is not saved on this browser" rather than let a rep believe an order survives a reload.
 *
 * It is also the store every test runs against, which is the point: the same statements the phone
 * runs, with no WASM to load, no OPFS to be denied and no network anywhere.
 */
import { MemoryDatabase } from '../sql.js'
import type { SqlValue, SyncStore } from '../types.js'

class MemoryStore implements SyncStore {
  readonly persistent = false
  readonly kind = 'memory' as const
  private depth = 0

  constructor(private readonly db: MemoryDatabase) {}

  async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.db.run(sql, params)
  }

  async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.run(sql, params) as T[]
  }

  /**
   * Nested calls join the outer transaction, exactly as `withTenant` does on the server: the engine
   * takes ONE snapshot at the outermost call and rolls the whole thing back if anything throws.
   */
  async transaction<T>(fn: (tx: SyncStore) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this)
    const snapshot = this.db.snapshot()
    this.depth += 1
    try {
      return await fn(this)
    } catch (error) {
      this.db.restore(snapshot)
      throw error
    } finally {
      this.depth -= 1
    }
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

export function createMemoryStore(): SyncStore {
  return new MemoryStore(new MemoryDatabase())
}

/** The `StoreFactory` shape, so a test or a harness can pass it straight to `<OfflineProvider>`. */
export const memoryStoreFactory = async (_name: string): Promise<SyncStore> => {
  void _name
  return createMemoryStore()
}
