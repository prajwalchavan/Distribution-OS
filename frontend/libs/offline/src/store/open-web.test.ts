/**
 * DOS-167 ruling 3 (aa), (cc) — ONE web open at a time, and an open that never answers is not a hang.
 *
 * S-138, measured 41 times in the browser (`QA/evidence/batch2/dos-167/reproof2/diagnose`): on the first mount the
 * provider opened THREE different databases at once — the engine's own file, the legacy `dos-sales.db` destroy and
 * the 199952b interim sweep. With the expo-sqlite chunk and its wa-sqlite worker arriving late (a cold Metro start,
 * the first load after a deploy, a weak connection) the three landed 2-3 ms apart instead of 148-361, and:
 *
 * - `expo-sqlite/web/worker.ts` `maybeInitAsync()` assigns `_sqlite3` only AFTER `await WaSQLiteFactory(...)`, so
 *   every message that arrives before the first init resolves takes the CREATE branch: 3 WASM modules and 3
 *   `AccessHandlePoolVFS` instances over one OPFS directory;
 * - `wa-sqlite/sqlite-api.js:34-35` keeps ONE module-global scratch cell that `open_v2` writes and reads back
 *   across an await (:578-580), so concurrent opens clobber each other's filenames — `jOpen zName=""`, then
 *   `0.<random>` orphans flagged MAIN_DB that the pool's six slots never reclaim.
 *
 * The product cannot fix either library, so the product stops being concurrent: every `openStore` goes through one
 * module-level chain. Executed basis (ruling 3): this exact change passed 6/6 on Metro at 600 ms and 1500 ms and
 * 3/3 against the production export; the baseline 0/3; a library-side guard alone 0/3.
 *
 * The seam is `deps.loadSqlite`, so this runs in Node without mocking the bare specifier — the throwaway that did
 * went red for the wrong reason (calls 2 and 3 fell back to memory before they ever reached a database).
 */
import { afterEach, describe, expect, it } from 'vitest'

import { openStore, OPEN_DEADLINE_MS } from './open.web.js'
import type { ExpoDatabaseLike, ExpoSqliteLike } from './expo-sqlite.js'

/** Rahul at Tarsun, as `storeNameFor` writes it (ruling 2 (s)), and the two files the clean-ups ask for. */
const ENGINE = 's80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft'
const ENGINE_2 = 's80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmfu'
const LEGACY = 'dos-sales.db'
const INTERIM =
  'dos-sales__u-8760e17e-4830-7395-a946-1e02fffa1ad7__t-01a09a5b-3c58-71c1-a34d-b93c569b0099.db'

/** What a page needs before `open.web.ts` will even import expo-sqlite. */
const restore: (() => void)[] = []

function stub(key: string, value: unknown): void {
  const had = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  restore.push(() => {
    if (had === undefined) delete (globalThis as Record<string, unknown>)[key]
    else Object.defineProperty(globalThis, key, had)
  })
}

function asCrossOriginIsolatedBrowser(): void {
  stub('crossOriginIsolated', true)
  stub('Worker', function Worker() {})
  stub('navigator', { storage: { getDirectory: () => Promise.resolve({}) } })
}

afterEach(() => {
  while (restore.length > 0) restore.pop()?.()
})

function fakeDb(hooks: { onClose?: () => void } = {}): ExpoDatabaseLike {
  return {
    execAsync: async () => {},
    runAsync: async () => ({}),
    getAllAsync: async <T>() => [] as T[],
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    closeAsync: async () => {
      hooks.onClose?.()
    },
  }
}

describe('DOS-167 ruling 3: the web opener', () => {
  /*
   * (aa). The measured failure is three DIFFERENT names landing in one microtask batch, which is why `sweepStores`'
   * per-file `holdFile` is not enough — that serialises one name.
   */
  it('DOS-167 the web opener never has two opens in flight', async () => {
    asCrossOriginIsolatedBrowser()
    const attempted: string[] = []
    let live = 0
    let maxConcurrent = 0
    const loadSqlite = async (): Promise<ExpoSqliteLike> => ({
      openDatabaseAsync: async (name: string) => {
        attempted.push(name)
        live += 1
        maxConcurrent = Math.max(maxConcurrent, live)
        await new Promise((resolve) => setTimeout(resolve, 5))
        live -= 1
        return fakeDb()
      },
      deleteDatabaseAsync: async () => {},
    })

    // The three opens of a first mount, started WITHOUT awaiting between them.
    const stores = await Promise.all([
      openStore(ENGINE, { loadSqlite }),
      openStore(LEGACY, { loadSqlite }),
      openStore(INTERIM, { loadSqlite }),
    ])

    expect({ maxConcurrent, attempted, kinds: stores.map((store) => store.kind) }).toEqual({
      maxConcurrent: 1,
      attempted: [ENGINE, LEGACY, INTERIM],
      kinds: ['sqlite-web', 'sqlite-web', 'sqlite-web'],
    })
  })

  /*
   * (aa), the whole measured mechanism in a pure Node model of AccessHandlePoolVFS — no browser, no WASM.
   * Red drives the real `openStore` concurrently and the pool ends as the diagnosis found it: the engine's own
   * file never created, orphan slots that are never reclaimed, and `cannot create file` for the NEXT person on
   * that profile (`runs/next-person-01.json`).
   */
  it('DOS-167 three startup opens leave a usable pool', async () => {
    asCrossOriginIsolatedBrowser()

    class PoolVfs {
      /** `AccessHandlePoolVFS.DEFAULT_CAPACITY`; expo-sqlite never raises it, and raising it is NOT the fix. */
      static readonly CAPACITY = 6
      readonly files = new Map<string, { orphan: boolean }>()
      /** wa-sqlite's ONE module-global scratch cell for the path (`sqlite-api.js:34-35`, read back at :578-580). */
      private scratch = ''
      private invented = 0

      async open(name: string): Promise<string> {
        this.scratch = name
        await Promise.resolve()
        const effective = this.scratch
        this.scratch = ''
        // VFS.js:10 `mxPathname = 64`, less the 8 SQLite keeps for the journal suffix (ruling 2 (s)).
        if (effective !== '' && `./${effective}`.length > 56)
          throw new Error(`sqlite3_open_v2 failed: path too long (${effective.length})`)
        if (effective === '') {
          // `jOpen zName=""`: the VFS invents `0.<random>`, flags it MAIN_DB|CREATE|READWRITE and never reclaims it.
          this.take(`0.${(this.invented += 1)}`, true)
          this.take(`0.${(this.invented += 1)}-wal`, true)
          throw new Error('SQLiteError: not a database')
        }
        this.take(effective, false)
        return effective
      }

      private take(file: string, orphan: boolean): void {
        if (this.files.size >= PoolVfs.CAPACITY) throw new Error('cannot create file')
        this.files.set(file, { orphan })
      }

      release(file: string): void {
        if (this.files.get(file)?.orphan === false) this.files.delete(file)
      }

      get orphans(): string[] {
        return [...this.files].filter(([, slot]) => slot.orphan).map(([file]) => file)
      }
    }

    const vfs = new PoolVfs()
    const loadSqlite = async (): Promise<ExpoSqliteLike> => ({
      openDatabaseAsync: async (name: string) => {
        const opened = await vfs.open(name)
        return fakeDb({
          onClose: () => {
            vfs.release(opened)
          },
        })
      },
      deleteDatabaseAsync: async (name: string) => {
        vfs.release(name)
      },
    })

    /** One first mount: the engine's file, the legacy destroy and the interim sweep, started together. */
    async function mount(engineName: string): Promise<string[]> {
      const [engine, legacy, interim] = await Promise.all([
        openStore(engineName, { loadSqlite }),
        openStore(LEGACY, { loadSqlite }),
        openStore(INTERIM, { loadSqlite }),
      ])
      // The clean-ups let their files go again; the engine keeps its own open, as a signed-in app does.
      await legacy.destroy?.()
      await interim.close()
      return [engine, legacy, interim].map((store) => store.fallback?.reason ?? 'opened')
    }

    const first = await mount(ENGINE)
    const engineOpen = vfs.files.has(ENGINE)
    const nextPerson = await mount(ENGINE_2)

    expect({
      engineOpen,
      orphans: vfs.orphans,
      cannotCreate: [...first, ...nextPerson].filter((reason) =>
        reason.includes('cannot create file'),
      ),
      notADatabase: [...first, ...nextPerson].filter((reason) => reason.includes('not a database')),
      pool: [...vfs.files.keys()].sort(),
    }).toEqual({
      engineOpen: true,
      orphans: [],
      cannotCreate: [],
      notADatabase: [],
      // Both people's own files, and nothing else: the 94-character interim name never creates one.
      pool: [ENGINE, ENGINE_2].sort(),
    })
  })

  /*
   * (cc) 1. The re-proof's real harm was the silence: no `/sync` for 240 s over a store that never answered.
   * An open is bounded, the answer is an announced memory store, and a handle that arrives late is CLOSED —
   * never destroyed, because nothing we failed to read is thrown away (founder answer A).
   */
  it('DOS-167 an open that never settles answers memory within the deadline and closes the late handle', async () => {
    asCrossOriginIsolatedBrowser()
    expect(OPEN_DEADLINE_MS).toBe(15_000)

    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const attempted: string[] = []
    let closed = 0
    let destroyed = 0
    const loadSqlite = async (): Promise<ExpoSqliteLike> => ({
      openDatabaseAsync: async (name: string) => {
        attempted.push(name)
        await held
        return fakeDb({
          onClose: () => {
            closed += 1
          },
        })
      },
      deleteDatabaseAsync: async () => {
        destroyed += 1
      },
    })

    const timedOut = await openStore(ENGINE, { loadSqlite, timeoutMs: 20 })
    // The next open is already asked for, and must still wait for the first to settle.
    const next = openStore(LEGACY, { loadSqlite, timeoutMs: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const whileHeld = [...attempted]

    release()
    const second = await next

    expect({
      kind: timedOut.kind,
      reason: timedOut.fallback?.reason,
      whileHeld,
      attempted,
      secondKind: second.kind,
      closed,
      destroyed,
    }).toEqual({
      kind: 'memory',
      reason: 'open timed out after 20ms',
      whileHeld: [ENGINE],
      attempted: [ENGINE, LEGACY],
      secondKind: 'sqlite-web',
      // The late handle is closed once, and its file is never deleted.
      closed: 1,
      destroyed: 0,
    })
  })

  /*
   * (cc) 1 + Fable amendment A5 (2026-09-19): the OTHER half of a deadline. A deadline that is too tight does not
   * bound a hang, it MANUFACTURES one of S-138's symptoms — a browser with a perfectly good OPFS file told it cannot
   * keep anything, because the open was a second slower than somebody's guess. The worst load the diagnosis drove is
   * the expo-sqlite chunk and its wa-sqlite worker held back 1500 ms, and the serialised product still opened its
   * file 3/3 (`reproof2/diagnose/runs/vD-d1500-1..3.json`); the shipped deadline leaves ten times that. So: the
   * budget is asserted as a number, and a slow-but-succeeding open is driven against the REAL deadline — not an
   * override — and must come back as the person's own file, with no memory store handed out on the way.
   */
  it('DOS-167 a slow but succeeding open is never abandoned: the deadline leaves ten times the worst load measured', async () => {
    asCrossOriginIsolatedBrowser()

    /** The slowest load the S-138 diagnosis drove and still opened the store (vD-d1500, 3/3). */
    const WORST_MEASURED_LOAD_MS = 1_500
    /** Long enough to be a slow open by any browser's standard, short enough to be a test. */
    const SLOW_OPEN_MS = 250

    let destroyed = 0
    const loadSqlite = async (): Promise<ExpoSqliteLike> => ({
      openDatabaseAsync: async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_OPEN_MS))
        return fakeDb()
      },
      deleteDatabaseAsync: async () => {
        destroyed += 1
      },
    })

    // No `timeoutMs`: this is the deadline a rep's browser actually runs under.
    const store = await openStore(ENGINE, { loadSqlite })

    expect({
      headroom: Math.floor(OPEN_DEADLINE_MS / WORST_MEASURED_LOAD_MS),
      kind: store.kind,
      persistent: store.persistent,
      // Nothing was handed out instead of the file, so nothing said "will not keep" over a store that opened.
      fellBack: store.fallback?.reason ?? null,
      destroyed,
    }).toEqual({
      headroom: 10,
      kind: 'sqlite-web',
      persistent: true,
      fellBack: null,
      destroyed: 0,
    })

    await store.close()
  })

  /*
   * Fable amendment A4 (2026-09-19): the case ruling 3 left out. OPFS hands a synchronous access handle to ONE
   * holder, and wa-sqlite's pool takes the whole directory, so a SECOND TAB of the same signed-in person cannot have
   * the file the first tab is signed in on. What must never happen there is either of the two halves of S-138: a tab
   * that hangs or throws instead of carrying on, and a tab that "recovers" by clearing the file the other tab is
   * using. It falls to memory, says which file it wanted and why it could not have it — so (t)/(dd) print it and the
   * sheet withholds the keep — and the first tab's file, its queued op and the pool are exactly as they were
   * (founder answer A: nothing unsent is thrown away, and nothing of one person's is touched for another's sake).
   */
  it('DOS-167 a second tab of the same person falls to an announced memory store and leaves the first tab and its queue alone', async () => {
    asCrossOriginIsolatedBrowser()

    /** OPFS as the browser gives it: one holder per file, and a pool file is only ever removed by an explicit delete. */
    class ExclusiveOpfs {
      readonly rows = new Map<string, string[]>()
      readonly held = new Set<string>()
      readonly deleted: string[] = []

      acquire(name: string): void {
        if (this.held.has(name))
          throw new Error(
            'NoModificationAllowedError: Access Handles cannot be created if there is another open Access Handle',
          )
        this.held.add(name)
        if (!this.rows.has(name)) this.rows.set(name, [])
      }

      release(name: string): void {
        this.held.delete(name)
      }
    }

    const opfs = new ExclusiveOpfs()
    const loadSqlite = async (): Promise<ExpoSqliteLike> => ({
      openDatabaseAsync: async (name: string): Promise<ExpoDatabaseLike> => {
        opfs.acquire(name)
        return {
          execAsync: async () => {},
          runAsync: async (_sql, params) => {
            opfs.rows.get(name)?.push(String(params[0] ?? ''))
            return {}
          },
          getAllAsync: async <T>() => (opfs.rows.get(name) ?? []).map((id) => ({ id })) as T[],
          withTransactionAsync: async (fn: () => Promise<void>) => fn(),
          closeAsync: async () => {
            opfs.release(name)
          },
        }
      },
      deleteDatabaseAsync: async (name: string) => {
        opfs.deleted.push(name)
        opfs.rows.delete(name)
      },
    })

    // Tab 1: signed in, with one order still waiting to reach the office.
    const tabOne = await openStore(ENGINE, { loadSqlite })
    await tabOne.exec(`INSERT INTO outbox (op_id) VALUES (?)`, ['op-1'])

    // Tab 2: the same person, the same profile, the same file — and the file is taken.
    const tabTwo = await openStore(ENGINE, { loadSqlite })
    const stillWaiting = await tabOne.query<{ id: string }>('SELECT op_id AS id FROM outbox', [])

    expect({
      oneKind: tabOne.kind,
      onePersistent: tabOne.persistent,
      twoKind: tabTwo.kind,
      twoPersistent: tabTwo.persistent,
      // Said out loud, with the file it wanted and why it could not have it (ruling 2 (t), ruling 3 (dd)).
      twoWanted: tabTwo.fallback?.wanted,
      twoReason: /^open failed: NoModificationAllowedError/.test(tabTwo.fallback?.reason ?? ''),
      // Tab 1 is untouched: still holding its file, still holding its op, and no file deleted or added.
      held: [...opfs.held],
      queued: stillWaiting.map((row) => row.id),
      deleted: opfs.deleted,
      pool: [...opfs.rows.keys()],
    }).toEqual({
      oneKind: 'sqlite-web',
      onePersistent: true,
      twoKind: 'memory',
      twoPersistent: false,
      twoWanted: 'sqlite-web',
      twoReason: true,
      held: [ENGINE],
      queued: ['op-1'],
      deleted: [],
      pool: [ENGINE],
    })

    await tabOne.close()
  })
})
