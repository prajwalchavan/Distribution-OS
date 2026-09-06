/**
 * `@dos/api-client/react` — the React layer: one provider, one session hook, one read hook and one
 * write hook. Written here rather than pulled from a data library so the six apps share exactly one
 * cache implementation and one retry rule (the kit is ours).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { QueryCache, type QueryEntry, type QueryKey } from '../cache.js'
import { toApiError, type ApiError } from '../errors.js'
import { newMutation, type ApiClient, type MutationMeta, type SignInOptions } from '../client.js'
import type { Session, SessionState } from '../session.js'

interface ApiContextValue {
  client: ApiClient
  cache: QueryCache
}

const ApiContext = createContext<ApiContextValue | null>(null)

export interface ApiProviderProps {
  client: ApiClient
  /** Share one cache across the tree. A second one is only ever wanted in a test. */
  cache?: QueryCache
  /** Exchange a surviving refresh token for a live access token on mount. Default true. */
  hydrateOnMount?: boolean
  children: ReactNode
}

export function ApiProvider({
  client,
  cache,
  hydrateOnMount = true,
  children,
}: ApiProviderProps): React.JSX.Element {
  const value = useMemo<ApiContextValue>(
    () => ({ client, cache: cache ?? new QueryCache() }),
    [client, cache],
  )
  useEffect(() => {
    if (hydrateOnMount) void value.client.hydrate()
  }, [value, hydrateOnMount])
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApi() outside <ApiProvider>')
  return ctx
}

/** The client. `useApi().api.orders.list({...})` is the whole calling convention. */
export function useApi(): ApiClient {
  return useApiContext().client
}

export function useQueryCache(): QueryCache {
  return useApiContext().cache
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface UseSession extends SessionState {
  signIn: (options: SignInOptions) => Promise<Session>
  signOut: () => Promise<void>
  switchDistributor: (tenantId: string) => Promise<Session>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** True when the signed-in user works for more than one distributor. */
  hasManyDistributors: boolean
}

/** The signed-in user and the four things a screen does with a session. */
export function useSession(): UseSession {
  const { client, cache } = useApiContext()
  const state = useSyncExternalStore(
    client.session.subscribe,
    client.session.getSnapshot,
    client.session.getSnapshot,
  )
  const signOut = useCallback(async (): Promise<void> => {
    await client.signOut()
    // The next user never sees the last one's rows.
    cache.clear()
  }, [client, cache])
  const switchDistributor = useCallback(
    async (tenantId: string): Promise<Session> => {
      const next = await client.switchDistributor(tenantId)
      cache.clear()
      return next
    },
    [client, cache],
  )
  return {
    ...state,
    signIn: client.signIn,
    signOut,
    switchDistributor,
    changePassword: client.changePassword,
    hasManyDistributors: (state.session?.memberships.length ?? 0) > 1,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface UseQueryOptions {
  /** How long a cached value counts as fresh. Default 30 s. */
  staleTime?: number
  /** Skip the read entirely (a detail screen with no id yet). */
  enabled?: boolean
}

export interface UseQueryResult<T> {
  data: T | undefined
  error: ApiError | undefined
  status: QueryEntry['status']
  /** First load, with nothing cached to show. */
  isLoading: boolean
  /** Any request in flight, including a background revalidation. */
  isFetching: boolean
  /** Epoch ms of the last successful read; feeds `<ConnectionStrip>`. */
  updatedAt: number
  refetch: () => Promise<T | undefined>
}

/**
 * Reads through the shared cache. The screen repaints from the cached value on mount and the
 * revalidation lands behind it, so a visited screen never opens blank (UX-00 section 6.13).
 */
export function useQuery<T>(
  key: QueryKey,
  run: () => Promise<T>,
  options: UseQueryOptions = {},
): UseQueryResult<T> {
  const { cache } = useApiContext()
  const { staleTime = 30_000, enabled = true } = options
  const hash = JSON.stringify(key)

  // `run` changes identity every render; the cache calls the LATEST one.
  const runRef = useRef(run)
  runRef.current = run

  // `key` is re-created every render; `hash` is its identity, and keyRef holds the latest array.
  const keyRef = useRef(key)
  keyRef.current = key

  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(keyRef.current, listener),
    [cache, hash],
  )
  const getSnapshot = useCallback(() => cache.get<T>(keyRef.current), [cache, hash])
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const invalidated = entry.updatedAt === 0

  useEffect(() => {
    if (!enabled) return
    void cache
      .fetch(keyRef.current, () => runRef.current(), { staleTime })
      .catch(() => {
        // The failure is already on the entry; a hook never rejects into a render.
      })
  }, [cache, hash, enabled, staleTime, invalidated])

  const refetch = useCallback(async (): Promise<T | undefined> => {
    try {
      return await cache.fetch(keyRef.current, () => runRef.current(), { force: true })
    } catch {
      return undefined
    }
  }, [cache, hash])

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    isLoading: entry.status === 'loading' && entry.data === undefined,
    isFetching: entry.fetching,
    updatedAt: entry.updatedAt,
    refetch,
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface UseMutationOptions<TInput, TResult> {
  /** Key prefixes to invalidate after a success: `[['orders'], ['receivables']]`. */
  invalidates?: readonly QueryKey[]
  onSuccess?: (result: TResult, input: TInput) => void
  onError?: (error: ApiError, input: TInput) => void
}

export interface UseMutationResult<TInput, TResult> {
  /** Fire and forget; the state below carries the outcome. */
  mutate: (input: TInput) => void
  /** Awaitable; rejects with an `ApiError`, never a raw fetch error. */
  mutateAsync: (input: TInput) => Promise<TResult>
  status: 'idle' | 'pending' | 'success' | 'error'
  error: ApiError | undefined
  data: TResult | undefined
  /** The id + idempotency key of the CURRENT intent. Retrying reuses both, by design. */
  meta: MutationMeta
  /** Start a new intent: a fresh id and a fresh idempotency key. */
  reset: () => void
}

/**
 * One user intent = one `MutationMeta`. A retry of the SAME intent re-sends the same
 * `idempotencyKey`, so a double tap or a lost reply can never write a second row
 * (`UNIQUE(tenant_id, idempotency_key)`); `reset()` is what starts a new intent.
 */
export function useMutation<TInput, TResult>(
  run: (input: TInput, meta: MutationMeta) => Promise<TResult>,
  options: UseMutationOptions<TInput, TResult> = {},
): UseMutationResult<TInput, TResult> {
  const { cache } = useApiContext()
  const [meta, setMeta] = useState<MutationMeta>(newMutation)
  const [state, setState] = useState<{
    status: 'idle' | 'pending' | 'success' | 'error'
    error: ApiError | undefined
    data: TResult | undefined
  }>({ status: 'idle', error: undefined, data: undefined })

  const runRef = useRef(run)
  runRef.current = run
  const optionsRef = useRef(options)
  optionsRef.current = options

  const mutateAsync = useCallback(
    async (input: TInput): Promise<TResult> => {
      setState((s) => ({ ...s, status: 'pending', error: undefined }))
      try {
        const result = await runRef.current(input, meta)
        setState({ status: 'success', error: undefined, data: result })
        for (const key of optionsRef.current.invalidates ?? []) cache.invalidate(key)
        optionsRef.current.onSuccess?.(result, input)
        return result
      } catch (raw) {
        const error = toApiError(raw)
        setState((s) => ({ ...s, status: 'error', error }))
        optionsRef.current.onError?.(error, input)
        throw error
      }
    },
    [cache, meta],
  )

  const mutate = useCallback(
    (input: TInput): void => {
      void mutateAsync(input).catch(() => {
        // The error is already on the state; a fire-and-forget call never rejects unhandled.
      })
    },
    [mutateAsync],
  )

  const reset = useCallback((): void => {
    setMeta(newMutation())
    setState({ status: 'idle', error: undefined, data: undefined })
  }, [])

  return { mutate, mutateAsync, ...state, meta, reset }
}

export { QueryCache }
export type { QueryKey, QueryEntry, Session, SessionState, ApiError, MutationMeta }
