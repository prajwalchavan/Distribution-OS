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

/**
 * Whether a read may go to a service at all.
 *
 * Every endpoint in this product needs a bearer token, so a read with nobody signed in can only ever
 * be a 401. It happens on any deep link opened signed out: expo-router mounts the requested route
 * BEFORE the root layout's redirect to `/sign-in` can run (the layout has to keep rendering its
 * `<Slot/>` — that is the navigator the redirect itself needs), so the route's own `useQuery` calls
 * fire first. Measured on the owner app: five 401s from one signed-out visit to `/`, each one an
 * error state painted for a moment on a screen the reader is being taken off. At a lakh of devices
 * that is a lakh of unauthenticated round trips per cold start.
 *
 * A session still holding a password somebody else chose is refused for the same reason: every app
 * puts that person on the change-password screen and nothing else (docs/23 §0 X2), so the route they
 * asked for mounts behind it and reads a register nobody will look at.
 *
 * `hydrating` is deliberately NOT a reason to wait: a restored session is a real session (the client
 * refreshes the access token around the request), and holding every read until the refresh lands
 * would make a returning user stare at a skeleton for a round trip.
 */
export function readsAllowed(state: SessionState, enabled: boolean): boolean {
  if (!enabled || state.session === null) return false
  return state.session.user.mustChangePassword !== true
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
  const { client, cache } = useApiContext()
  const { staleTime = 30_000, enabled = true } = options
  const hash = JSON.stringify(key)

  const sessionState = useSyncExternalStore(
    client.session.subscribe,
    client.session.getSnapshot,
    client.session.getSnapshot,
  )
  const mayRead = readsAllowed(sessionState, enabled)

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
  /**
   * What makes this effect run again. NOT `updatedAt === 0` as a boolean: a read that failed leaves
   * `updatedAt` at 0, so the flag was already true and a later `invalidate()` / `clear()` changed
   * nothing — the screen kept its empty state and never asked the server again. `generation` only
   * ever goes up, so every invalidation is a new value; `-1` while the entry holds a good value
   * keeps a successful read from refetching on every render.
   */
  const stale = entry.updatedAt === 0 ? entry.generation : -1

  useEffect(() => {
    if (!mayRead) return
    void cache
      .fetch(keyRef.current, () => runRef.current(), { staleTime })
      .catch(() => {
        // The failure is already on the entry; a hook never rejects into a render.
      })
  }, [cache, hash, mayRead, staleTime, stale])

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
 * (`UNIQUE(tenant_id, idempotency_key)`).
 *
 * **What identifies an intent is its INPUT.** A hook lives as long as the screen, and one screen
 * writes over and over: an approvals queue decides row after row, a settings page saves change after
 * change. Holding one key for the life of the hook made every write after the first a DIFFERENT
 * payload under the SAME key, which the server correctly refuses — measured on the owner app's
 * settings page as `POST /tenancy/settings → 409 Conflict` on the second save, and the same hook
 * shape would have let the approvals queue decide exactly one row per page load. So a call whose
 * input differs from the last one starts a new intent, and a call with the SAME input keeps the key
 * it had — which is what makes a double tap and a retry after a lost reply safe. `reset()` still
 * forces a new intent by hand (an export of the same range, asked for twice, on purpose).
 */

/** Stable across key order, so `{a,b}` and `{b,a}` are one intent. */
export function intentHash(input: unknown): string {
  try {
    return JSON.stringify(input, (_field, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        return Object.keys(record)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = record[k]
            return acc
          }, {})
      }
      return value
    })
  } catch {
    // A value JSON cannot carry (a File, a cyclic object) is treated as its own intent every time.
    return `unserialisable:${String(Date.now())}:${String(Math.random())}`
  }
}

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
  /** The input the current `meta` belongs to; `null` until this hook has been asked to write once. */
  const intentRef = useRef<string | null>(null)
  /** Read synchronously: `meta` from `useState` is a render behind two calls in the same tick. */
  const metaRef = useRef(meta)
  metaRef.current = meta

  const mutateAsync = useCallback(
    async (input: TInput): Promise<TResult> => {
      const hash = intentHash(input)
      let current = metaRef.current
      if (intentRef.current !== null && intentRef.current !== hash) {
        // A different payload is a different intent, and must not reuse a spent idempotency key.
        current = newMutation()
        metaRef.current = current
        setMeta(current)
      }
      intentRef.current = hash

      setState((s) => ({ ...s, status: 'pending', error: undefined }))
      try {
        const result = await runRef.current(input, current)
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
    [cache],
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
    const next = newMutation()
    metaRef.current = next
    intentRef.current = null
    setMeta(next)
    setState({ status: 'idle', error: undefined, data: undefined })
  }, [])

  return { mutate, mutateAsync, ...state, meta, reset }
}

export { QueryCache }
export type { QueryKey, QueryEntry, Session, SessionState, ApiError, MutationMeta }
