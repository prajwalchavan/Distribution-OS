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
import { legacyStoreName, storeNameFor, SyncEngine, type SyncEngineOptions } from './engine.js'
import { transportFromApi, type SyncApiLike } from './transport.js'
import type {
  EnqueueInput,
  NeedsAttentionItem,
  OutboxRow,
  StoreFactory,
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
   * and checked at open. Not passing it at all keeps the behaviour from before DOS-167, for the field
   * layouts that still pass `tenantId` and a fixed `databaseName`.
   */
  identity?: SyncIdentity | null
  /** The app's file prefix — `'dos-sales'`, `'dos-delivery'`, `'dos-warehouse'`; never a name built by hand. */
  storePrefix?: string
  /**
   * @deprecated The distributor alone, from before DOS-167. Read only when `identity` is not passed;
   * it goes once the three field layouts pass `identity` and `storePrefix`.
   */
  tenantId?: string
  /** An explicit file name, for the harness and tests. It wins over `storePrefix`. */
  databaseName?: string
  pullIntervalMs?: number
  /** False while nobody is signed in: no manifest, no pull, no queue. */
  enabled?: boolean
  onLog?: (line: string, detail?: unknown) => void
  children: ReactNode
}

/** The file the engine opens: the explicit name, else this person's file in this distributorship. */
function storeFileName(
  databaseName: string | undefined,
  storePrefix: string | undefined,
  identity: SyncIdentity | null | undefined,
): string {
  if (databaseName !== undefined) return databaseName
  if (storePrefix !== undefined && identity !== undefined && identity !== null)
    return storeNameFor(storePrefix, identity)
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
  tenantId,
  databaseName,
  pullIntervalMs,
  enabled = true,
  onLog,
  children,
}: OfflineProviderProps): React.JSX.Element {
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const idKey =
    identity === undefined || identity === null
      ? identity
      : `${identity.userId}:${identity.tenantId}`
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
      ...(identity === undefined || identity === null ? {} : { identity }),
      ...(identity === undefined && tenantId !== undefined ? { tenantId } : {}),
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
  }, [enabled, deviceId, storeFactory, name, idKey, pullIntervalMs, tenantId])

  /*
   * THE FILE EVERY BUILD BEFORE DOS-167 KEPT (amendment i): `dos-sales.db`, `dos-delivery.db`,
   * `dos-warehouse.db`, one per app whoever was signed in. Every QA device and browser profile that ran
   * such a build still holds the last rep's rows in it at rest, so it is deleted once per mount, best
   * effort. Where it never existed, opening creates an empty file and deleting removes it again; the
   * memory adapter has nothing to delete.
   */
  useEffect(() => {
    if (storePrefix === undefined) return
    let legacy: string
    try {
      legacy = legacyStoreName(storePrefix)
    } catch {
      return
    }
    // An app still opening the fixed name is using that file.
    if (legacy === databaseName) return
    void (async () => {
      try {
        const store = await storeFactory(legacy)
        if (store.destroy === undefined) await store.close()
        else await store.destroy()
      } catch (error) {
        onLog?.('offline: could not delete the store from before DOS-167', error)
      }
    })()
  }, [storeFactory, storePrefix, databaseName])

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
  persistent: false,
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
  /** queued + sending */
  pending: number
  rejected: number
  online: boolean
  /** Upload what is queued now; the counts that are still waiting afterwards. */
  sendNow: () => Promise<{ pending: number; rejected: number }>
  /**
   * End the engine BEFORE the session is cleared: `keepQueue: false` deletes this person's file,
   * `keepQueue: true` keeps the queue and the tray in it and drops everything else.
   */
  end: (options: { keepQueue: boolean }) => Promise<void>
}

/**
 * What an app's sign-out flow needs of the device (DOS-167). With no engine — a role this app does not
 * serve, a provider that is switched off — there is nothing to send and nothing to end.
 */
export function useLeaveSession(): LeaveSession {
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const sendNow = useCallback(async (): Promise<{ pending: number; rejected: number }> => {
    if (engine === null) return { pending: 0, rejected: 0 }
    await engine.flush()
    const after = engine.status()
    return { pending: after.pending, rejected: after.rejected }
  }, [engine])
  const end = useCallback(
    async (options: { keepQueue: boolean }): Promise<void> => {
      if (engine === null) return
      await engine.end(options)
    },
    [engine],
  )
  return useMemo(
    () => ({
      pending: status.pending,
      rejected: status.rejected,
      online: status.online,
      sendNow,
      end,
    }),
    [status.pending, status.rejected, status.online, sendNow, end],
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

export function useRow<T = Record<string, unknown>>(
  table: string,
  id: string | null,
): { row: T | null; loading: boolean } {
  const engine = useSyncEngine()
  const [row, setRow] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (engine === null || id === null) {
      setRow(null)
      setLoading(false)
      return
    }
    let live = true
    const run = (): void => {
      void engine
        .getRow<T>(table, id)
        .then((result) => {
          if (!live) return
          setRow(result)
          setLoading(false)
        })
        .catch(() => {
          if (!live) return
          setRow(null)
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
  }, [engine, table, id])
  return { row, loading }
}

export interface OutboxApi {
  enqueue: (input: EnqueueInput) => Promise<string>
  rows: OutboxRow[]
  pending: number
  rejected: number
  retry: (opId: string) => Promise<void>
  discard: (opId: string) => Promise<void>
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
      void engine.outbox().then((result) => {
        if (live) setRows(result)
      })
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
  const retry = useCallback(async (opId: string) => engine?.retry(opId) ?? undefined, [engine])
  const discard = useCallback(async (opId: string) => engine?.discard(opId) ?? undefined, [engine])
  const flush = useCallback(async () => engine?.flush() ?? undefined, [engine])

  return useMemo(
    () => ({
      enqueue,
      rows,
      pending: status.pending,
      rejected: status.rejected,
      retry,
      discard,
      flush,
    }),
    [enqueue, rows, status.pending, status.rejected, retry, discard, flush],
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
      void engine.needsAttention().then((result) => {
        if (!live) return
        setItems(result)
        setLoading(false)
      })
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
