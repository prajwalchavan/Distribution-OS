/**
 * The React layer of docs/27 §11 — the whole surface a screen may touch.
 *
 * Screens never write SQL and never call `sync.pull` or `sync.upload`: they read `useTable`, write
 * `useOutbox().enqueue`, and show `useSyncStatus()` through `<ConnectionStrip>`. A live query is a
 * query re-run when the engine says the table it reads has changed — no subscription protocol, no
 * second copy of the data in a store, no cache library.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { OUTBOX_CHANNEL, ERRORS_CHANNEL } from './bus.js'
import {
  interimStoreName,
  legacyStoreName,
  storeNameFor,
  SyncEngine,
  type EndResult,
  type SyncEngineOptions,
} from './engine.js'
import { transportFromApi, type SyncApiLike } from './transport.js'
import type {
  EnqueueInput,
  NeedsAttentionItem,
  OutboxRow,
  StoreFactory,
  StoreKind,
  SyncIdentity,
  SyncStatus,
  SyncTransport,
  TableQuery,
} from './types.js'

const EngineContext = createContext<SyncEngine | null>(null)

export interface OfflineProviderProps {
  /** The `api` router of `@dos/api-client`; the provider builds the transport from it. */
  api?: SyncApiLike
  /** Or the transport itself — what a test and the harness pass. */
  transport?: SyncTransport
  /** One id per install (docs/27 §4), the same one `auth_sessions` names the device by. */
  deviceId: string
  /** `openStore` from `@dos/offline` by default; a test passes `memoryStoreFactory`. */
  storeFactory: StoreFactory
  /** Hold only these manifest tables; omit for the role's whole read set. */
  tables?: readonly string[]
  /**
   * Who is signed in (DOS-167): `sessionIdentity(session)` from `@dos/api-client`, `null` while nobody
   * is. The device database is that person's own file inside that distributorship, stamped with them
   * and checked at open. With `null` and no explicit `databaseName`, no engine runs at all.
   */
  identity: SyncIdentity | null
  /** The app's file prefix — `'dos-sales'`, `'dos-delivery'`, `'dos-warehouse'`; never a name built by hand. */
  storePrefix?: string
  /** An explicit file name, for the harness and tests. It wins over `storePrefix`. */
  databaseName?: string
  pullIntervalMs?: number
  /** False while nobody is signed in: no manifest, no pull, no queue. */
  enabled?: boolean
  onLog?: (line: string, detail?: unknown) => void
  children: ReactNode
}

/**
 * THE FILE 199952b NAMED (DOS-167 ruling 2 (s)). That build gave each person's file a name no browser could open,
 * and on the QA phones it opened and still holds what it kept: the provider sweeps it once for the person signing
 * in, by the sibling rule — deleted when nothing in it is queued, sending or refused; kept, and said, when something
 * is, because nothing unsent is ever thrown away. An id that could not have been in that name has no such file.
 */
export async function sweepInterimStore(
  storeFactory: StoreFactory,
  storePrefix: string,
  identity: SyncIdentity,
  onLog?: (line: string, detail?: unknown) => void,
): Promise<void> {
  let name: string
  try {
    name = interimStoreName(storePrefix, identity)
  } catch {
    return
  }
  const swept = await SyncEngine.sweepStores(storeFactory, [name], onLog)
  for (const file of swept.kept) onLog?.('offline: kept the store from before ruling 2', file)
}

export interface StartupCleanups {
  storeFactory: StoreFactory
  storePrefix: string
  identity: SyncIdentity
  /**
   * What the engine's own open turned out to be. A promise while it is still opening — and awaiting it IS the wait for
   * the rep's own file: the provider passes `engine.waiting().then(() => engine.status().store)`.
   */
  storeKind: StoreKind | Promise<StoreKind>
  /** The explicit file name, when an app passes one: an app still opening the fixed name is using that file. */
  databaseName?: string
  onLog?: (line: string, detail?: unknown) => void
}

/**
 * THE CLEAN-UPS OF EVERY EARLIER BUILD, AFTER THIS PERSON'S OWN FILE AND ONE AT A TIME (DOS-167 ruling 3 (bb)).
 *
 * They used to be two floating effects that fired 2-3 ms apart under load, beside the engine's own open: three
 * different web databases opening in one microtask batch, which is S-138 (see `store/open.web.ts`). Now the rep's own
 * data is opened FIRST — which also shortens the window behind S-140 — and then, in order, each awaited before the
 * next:
 *
 * 1. the fixed `<prefix>.db` of every build before DOS-167 (amendment i), deleted once;
 * 2. the file 199952b named, swept once by the sibling rule (ruling 2 (s)) — on a PHONE only.
 *
 * `'./' + interimStoreName(...)` is 94 characters against wa-sqlite's 64-character path budget, so on a browser that
 * open can only ever fail — and in the single-VFS trace its failure is precisely what poisoned the two healthy
 * connections beside it. No browser ever created such a file (ruling 2 (s)), so on web there is nothing to sweep.
 * A store in memory has no file for either.
 *
 * A plain async function, so all of it is provable in Node without a React harness.
 */
export async function runStartupCleanups(input: StartupCleanups): Promise<void> {
  const kind = await input.storeKind
  if (kind === 'memory') return
  await destroyLegacyStore(input)
  if (kind !== 'sqlite-native') return
  await sweepInterimStore(input.storeFactory, input.storePrefix, input.identity, input.onLog)
}

/**
 * THE FILE EVERY BUILD BEFORE DOS-167 KEPT (amendment i): `dos-sales.db`, `dos-delivery.db`, `dos-warehouse.db`, one
 * per app whoever was signed in. Every QA device and browser profile that ran such a build still holds the last rep's
 * rows in it at rest, so it is deleted once per person per mount, best effort. Where it never existed, opening creates
 * an empty file and deleting removes it again.
 */
async function destroyLegacyStore(input: StartupCleanups): Promise<void> {
  let legacy: string
  try {
    legacy = legacyStoreName(input.storePrefix)
  } catch {
    return
  }
  // An app still opening the fixed name is using that file.
  if (legacy === input.databaseName) return
  try {
    const store = await input.storeFactory(legacy)
    if (store.destroy === undefined) await store.close()
    else await store.destroy()
  } catch (error) {
    input.onLog?.('offline: could not delete the store from before DOS-167', error)
  }
}

/** The file the engine opens: the explicit name, else this person's file in this distributorship. */
function storeFileName(
  databaseName: string | undefined,
  storePrefix: string | undefined,
  identity: SyncIdentity | null,
): string {
  if (databaseName !== undefined) return databaseName
  if (storePrefix !== undefined && identity !== null) return storeNameFor(storePrefix, identity)
  return 'dos-offline.db'
}

/**
 * One per app, inside the session gate. It starts the engine when a session exists and stops it when
 * the session ends; the queue itself outlives both, because it is a table.
 *
 * The engine belongs to one person in one distributorship (DOS-167). A distributor switch stops the
 * engine on the old file — which keeps that person's queue — and starts one on the other file; nothing
 * is wiped. A session that simply ends (a refresh answered 401) stops the engine the same way, so the
 * queue waits in that person's own file, where nobody else's sign-in can ever open it. Only the app's
 * own sign-out, through `useLeaveSession().end`, drops what the file holds.
 */
export function OfflineProvider({
  api,
  transport,
  deviceId,
  storeFactory,
  tables,
  identity,
  storePrefix,
  databaseName,
  pullIntervalMs,
  enabled = true,
  onLog,
  children,
}: OfflineProviderProps): React.JSX.Element {
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const idKey = identity === null ? null : `${identity.userId}:${identity.tenantId}`
  let name: string | null = null
  let unnamed: unknown = null
  try {
    name = storeFileName(databaseName, storePrefix, identity)
  } catch (error) {
    // An id that cannot be a file name gets NO store — never a shared fallback file.
    unnamed = error
  }

  useEffect(() => {
    if (!enabled || (identity === null && databaseName === undefined)) {
      setEngine(null)
      return
    }
    const resolved = transport ?? (api === undefined ? null : transportFromApi(api))
    if (resolved === null || name === null) {
      if (name === null) onLog?.('offline: no device store for this identity', unnamed)
      setEngine(null)
      return
    }
    const options: SyncEngineOptions = {
      transport: resolved,
      deviceId,
      storeFactory,
      databaseName: name,
      ...(tables === undefined ? {} : { tables }),
      ...(identity === null ? {} : { identity }),
      ...(pullIntervalMs === undefined ? {} : { pullIntervalMs }),
      ...(onLog === undefined ? {} : { onLog }),
    }
    const next = new SyncEngine(options)
    let live = true
    setEngine(next)
    void next.start().catch((error: unknown) => {
      onLog?.('offline: start failed', error)
    })
    return () => {
      live = false
      void next.stop()
      if (!live) setEngine(null)
    }
    /*
     * DELIBERATELY NOT `[api, transport, tables, onLog]`. Most callers build the client object and the
     * table list inline, so a dependency on their identity would tear the engine down and re-open the
     * database on every render — closing SQLite under an in-flight upload. What identifies an engine is
     * the device, the store, the file name and the identity (`userId:tenantId`, never the object, and
     * never the role: a role change on one membership is the manifest's to handle); a new client for
     * the same device is the same engine.
     */
  }, [enabled, deviceId, storeFactory, name, idKey, pullIntervalMs])

  /*
   * THE CLEAN-UPS OF THE EARLIER BUILDS — ONE effect, after this person's own file is open, in order (ruling 3 (bb)).
   * Two floating effects raced the engine's open 2-3 ms apart under load, which on a browser is three databases
   * opening at once and the store lost for that profile (S-138). Once per person per mount, best effort.
   */
  const cleanedFor = useRef(new Set<string>())
  useEffect(() => {
    if (engine === null || storePrefix === undefined || identity === null || idKey === null) return
    if (cleanedFor.current.has(idKey)) return
    cleanedFor.current.add(idKey)
    const started = engine
    void runStartupCleanups({
      storeFactory,
      storePrefix,
      identity,
      // The rep's own data first: `waiting()` awaits the open, and what it opened decides what there is to clean up.
      storeKind: started.waiting().then(
        () => started.status().store,
        () => started.status().store,
      ),
      ...(databaseName === undefined ? {} : { databaseName }),
      ...(onLog === undefined ? {} : { onLog }),
    }).catch((error: unknown) => {
      onLog?.('offline: could not clean up the stores of earlier builds', error)
    })
  }, [engine, storeFactory, storePrefix, idKey, databaseName])

  /*
   * The radio, told to the engine rather than guessed at. On web these are the browser's own events;
   * on a device the app passes NetInfo through `engine.setNetworkHint`. Coming back is what clears the
   * backoff and drains the queue, so a rep walking out of a dead spot does not wait out a 60 s timer.
   */
  useEffect(() => {
    if (engine === null) return
    const scope = globalThis as {
      addEventListener?: (type: string, fn: () => void) => void
      removeEventListener?: (type: string, fn: () => void) => void
    }
    if (typeof scope.addEventListener !== 'function') return
    const up = (): void => {
      engine.setNetworkHint(true)
    }
    const down = (): void => {
      engine.setNetworkHint(false)
    }
    scope.addEventListener('online', up)
    scope.addEventListener('offline', down)
    return () => {
      scope.removeEventListener?.('online', up)
      scope.removeEventListener?.('offline', down)
    }
  }, [engine])

  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
}

/** The engine itself, for the rare screen that needs `sync()` on a pull-to-refresh. */
export function useSyncEngine(): SyncEngine | null {
  return useContext(EngineContext)
}

const IDLE: SyncStatus = {
  online: true,
  store: 'memory',
  // No engine: nothing has resolved, so nothing is claimed about keeping (ruling 3 (ee)).
  persistent: null,
  storeNote: null,
  lastPulledAt: null,
  pulling: false,
  pending: 0,
  oldestPendingAt: null,
  rejected: 0,
  uploading: false,
  schemaVersion: null,
  upgradeRequired: false,
  ready: false,
  lastError: null,
}

export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine()
  const [status, setStatus] = useState<SyncStatus>(() => engine?.status() ?? IDLE)
  useEffect(() => {
    if (engine === null) {
      setStatus(IDLE)
      return
    }
    setStatus(engine.status())
    return engine.onStatus(setStatus)
  }, [engine])
  return status
}

/**
 * The sign-out rule, in one place (DOS-167; founder, 2026-09-13): with nothing queued and nothing
 * refused, signing out is one tap. With anything waiting the app ASKS — send it now while there is a
 * signal, or sign out keeping it on this phone for this person only. Throwing a write away is never
 * offered here; it stays in the Needs-attention tray with its audit line (docs/27 §11).
 */
export function leaveDecision(counts: { pending: number; rejected: number }): 'leave' | 'ask' {
  return counts.pending > 0 || counts.rejected > 0 ? 'ask' : 'leave'
}

export interface LeaveSession {
  /** queued + sending, from the status snapshot: what the sheet SHOWS, never what the tap decides on. */
  pending: number
  rejected: number
  online: boolean
  /**
   * False while the device store is in memory (DOS-167 ruling 2 (t)): nothing waiting survives leaving, so the sheet
   * never offers to keep it — "Send now" with a signal, else the person stays signed in. Null while the store has not
   * resolved, which the sheet treats exactly as false (ruling 3 (ee)): it never offers a keep it may not be able to
   * make, and never promises one it is not offering.
   */
  persistent: boolean | null
  /**
   * What waits in this person's file, counted once the engine has opened it. The tap decides on this:
   * before the open the snapshot reads 0, and a sign-out decided on it deleted a queue it had not seen.
   */
  waiting: () => Promise<{ pending: number; rejected: number }>
  /** Upload what is queued now; what is still waiting afterwards, counted the same way. */
  sendNow: () => Promise<{ pending: number; rejected: number }>
  /**
   * End the engine once the session is cleared on the device (addendum (y)): `keepQueue: false` deletes this person's
   * file, `keepQueue: true` keeps the queue and the tray in it and drops everything else. From the call on the engine
   * refuses every new write; `after`, the session's removal from the platform store, is waited for before the file is
   * touched; a write already in hand lands first, and when anything waits once it has, the file is kept for this
   * person whatever was asked. `kept` says which (DOS-167, ruling (m)).
   */
  end: (options: { keepQueue: boolean; after?: Promise<unknown> }) => Promise<EndResult>
}

/**
 * What an app's sign-out flow needs of the device (DOS-167). With no engine — a role this app does not
 * serve, a provider that is switched off — there is nothing to send and nothing to end.
 */
export function useLeaveSession(): LeaveSession {
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const waiting = useCallback(async (): Promise<{ pending: number; rejected: number }> => {
    if (engine === null) return { pending: 0, rejected: 0 }
    return engine.waiting()
  }, [engine])
  const sendNow = useCallback(async (): Promise<{ pending: number; rejected: number }> => {
    if (engine === null) return { pending: 0, rejected: 0 }
    await engine.flush()
    return engine.waiting()
  }, [engine])
  const end = useCallback(
    async (options: { keepQueue: boolean; after?: Promise<unknown> }): Promise<EndResult> => {
      if (engine === null) return { kept: false, pending: 0, rejected: 0 }
      return engine.end(options)
    },
    [engine],
  )
  return useMemo(
    () => ({
      pending: status.pending,
      rejected: status.rejected,
      online: status.online,
      persistent: status.persistent,
      waiting,
      sendNow,
      end,
    }),
    [status.pending, status.rejected, status.online, status.persistent, waiting, sendNow, end],
  )
}

/**
 * A live query over one local table. `where` and `orderBy` are SQL fragments with `?` placeholders —
 * the only SQL a screen ever writes, and never with a value interpolated into it.
 */
export function useTable<T = Record<string, unknown>>(
  table: string,
  query: TableQuery = {},
): { rows: T[]; loading: boolean } {
  const engine = useSyncEngine()
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  // A stable identity for the query, so a caller may build the object inline without looping.
  const key = JSON.stringify([query.where, query.params, query.orderBy, query.limit, query.offset])
  const latest = useRef(query)
  latest.current = query

  useEffect(() => {
    if (engine === null) {
      setRows([])
      setLoading(false)
      return
    }
    let live = true
    const run = (): void => {
      void engine
        .queryTable<T>(table, latest.current)
        .then((result) => {
          if (!live) return
          setRows(result)
          setLoading(false)
        })
        .catch(() => {
          if (!live) return
          setRows([])
          setLoading(false)
        })
    }
    run()
    const off = engine.onTables((changed) => {
      if (changed.has(table)) run()
    })
    return () => {
      live = false
      off()
    }
  }, [engine, table, key])

  return { rows, loading }
}

/** What this device has read about ONE row, and WHICH row it read — the two are never separated. */
interface RowRead<T> {
  /** The id the answer below belongs to. */
  readonly id: string | null
  readonly row: T | null
  readonly loading: boolean
}

/**
 * The answer for `id`, given what the hook is holding (DOS-180).
 *
 * A CHANGED id is a different question, so nothing held answers it: not the previous row, and not the
 * previous "I have read it". `loading` used to belong to the hook rather than to the id — the mount
 * with no id resolved it to false and nothing put it back — so for one render after a tap handed the
 * hook a real id it answered "read, and there is nothing there" about a row it had never opened. S3
 * reads exactly that render (`rowKnown: !loading`) and printed "Reached the office as a draft" over an
 * order still in this phone's outbox, which is never-list #12.
 *
 * A null id is not a question at all: nothing is loading, and there is nothing to know.
 */
function answerFor<T>(held: RowRead<T>, id: string | null): RowRead<T> {
  if (held.id === id) return held
  return { id, row: null, loading: id !== null }
}

export function useRow<T = Record<string, unknown>>(
  table: string,
  id: string | null,
): { row: T | null; loading: boolean } {
  const engine = useSyncEngine()
  const [held, setHeld] = useState<RowRead<T>>({ id: null, row: null, loading: false })
  /*
   * Derived in the RENDER, not in an effect. An effect runs after the render that changed the id, so
   * it can only correct the answer one frame late — and one frame is the whole of this finding.
   */
  const answer = answerFor(held, id)

  useEffect(() => {
    /*
     * With no engine there is no device store to ask, so this device knows nothing about that row and
     * `answer` goes on saying so. Claiming "read, and absent" here would be the same lie by a shorter
     * route.
     */
    if (engine === null || id === null) return
    let live = true
    const run = (): void => {
      void engine
        .getRow<T>(table, id)
        .then((result) => {
          if (live) setHeld({ id, row: result, loading: false })
        })
        .catch(() => {
          if (live) setHeld({ id, row: null, loading: false })
        })
    }
    run()
    const off = engine.onTables((changed) => {
      if (changed.has(table)) run()
    })
    return () => {
      live = false
      off()
    }
  }, [engine, table, id])
  return { row: answer.row, loading: answer.loading }
}

export interface OutboxApi {
  enqueue: (input: EnqueueInput) => Promise<string>
  /** An aggregate — an order and its lines — as ONE write, whole or not at all (DOS-167 ruling 2 (u)). */
  enqueueMany: (inputs: readonly EnqueueInput[]) => Promise<string[]>
  rows: OutboxRow[]
  pending: number
  rejected: number
  retry: (opId: string) => Promise<void>
  /** Throws `KeptMoneyError` on a refused money write (DOS-178) — that one goes to the cashier instead. */
  discard: (opId: string) => Promise<void>
  /** DOS-178: the crew handed this refused payment and its slip to the cashier. Nothing is deleted. */
  handOver: (opId: string) => Promise<void>
  flush: () => Promise<void>
}

export function useOutbox(): OutboxApi {
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const [rows, setRows] = useState<OutboxRow[]>([])

  useEffect(() => {
    if (engine === null) {
      setRows([])
      return
    }
    let live = true
    const run = (): void => {
      void engine
        .outbox()
        .then((result) => {
          if (live) setRows(result)
        })
        .catch(() => {})
    }
    run()
    const off = engine.onTables((changed) => {
      if (changed.has(OUTBOX_CHANNEL)) run()
    })
    return () => {
      live = false
      off()
    }
  }, [engine])

  const enqueue = useCallback(
    async (input: EnqueueInput) => {
      if (engine === null) throw new Error('no offline engine: is <OfflineProvider> mounted?')
      return engine.enqueue(input)
    },
    [engine],
  )
  const enqueueMany = useCallback(
    async (inputs: readonly EnqueueInput[]) => {
      if (engine === null) throw new Error('no offline engine: is <OfflineProvider> mounted?')
      return engine.enqueueMany(inputs)
    },
    [engine],
  )
  const retry = useCallback(async (opId: string) => engine?.retry(opId) ?? undefined, [engine])
  const discard = useCallback(async (opId: string) => engine?.discard(opId) ?? undefined, [engine])
  const handOver = useCallback(
    async (opId: string) => engine?.handOver(opId) ?? undefined,
    [engine],
  )
  const flush = useCallback(async () => engine?.flush() ?? undefined, [engine])

  return useMemo(
    () => ({
      enqueue,
      enqueueMany,
      rows,
      pending: status.pending,
      rejected: status.rejected,
      retry,
      discard,
      handOver,
      flush,
    }),
    [enqueue, enqueueMany, rows, status.pending, status.rejected, retry, discard, handOver, flush],
  )
}

/** The "Needs attention" tray (docs/23 §8.11), readable with no network. */
export function useNeedsAttention(): { items: NeedsAttentionItem[]; loading: boolean } {
  const engine = useSyncEngine()
  const [items, setItems] = useState<NeedsAttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (engine === null) {
      setItems([])
      setLoading(false)
      return
    }
    let live = true
    const run = (): void => {
      void engine
        .needsAttention()
        .then((result) => {
          if (!live) return
          setItems(result)
          setLoading(false)
        })
        .catch(() => {})
    }
    run()
    const off = engine.onTables((changed) => {
      if (changed.has(ERRORS_CHANNEL) || changed.has(OUTBOX_CHANNEL)) run()
    })
    return () => {
      live = false
      off()
    }
  }, [engine])
  return { items, loading }
}
