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
import { SyncEngine, type SyncEngineOptions } from './engine.js'
import { transportFromApi, type SyncApiLike } from './transport.js'
import type {
  EnqueueInput,
  NeedsAttentionItem,
  OutboxRow,
  StoreFactory,
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
  /** The signed-in distributor. A switch re-snapshots rather than mixing two read sets (docs/27 §5). */
  tenantId?: string
  databaseName?: string
  pullIntervalMs?: number
  /** False while nobody is signed in: no manifest, no pull, no queue. */
  enabled?: boolean
  onLog?: (line: string, detail?: unknown) => void
  children: ReactNode
}

/**
 * One per app, inside the session gate. It starts the engine when a session exists and stops it when
 * the session ends; the queue itself outlives both, because it is a table.
 */
export function OfflineProvider({
  api,
  transport,
  deviceId,
  storeFactory,
  tables,
  tenantId,
  databaseName,
  pullIntervalMs,
  enabled = true,
  onLog,
  children,
}: OfflineProviderProps): React.JSX.Element {
  const [engine, setEngine] = useState<SyncEngine | null>(null)

  useEffect(() => {
    if (!enabled) {
      setEngine(null)
      return
    }
    const resolved = transport ?? (api === undefined ? null : transportFromApi(api))
    if (resolved === null) {
      setEngine(null)
      return
    }
    const options: SyncEngineOptions = {
      transport: resolved,
      deviceId,
      storeFactory,
      ...(tables === undefined ? {} : { tables }),
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(databaseName === undefined ? {} : { databaseName }),
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
     * the device, the store and the database name; a new client for the same device is the same engine.
     */
  }, [enabled, deviceId, storeFactory, databaseName, pullIntervalMs, tenantId])

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
