/**
 * The typed client every Distribution OS app uses.
 *
 * Two oRPC clients over one session: `auth` talks to auth-service, `api` talks to this app's own
 * service (owner :3001, manager :3002, ...). Both attach the in-memory access token, share ONE
 * single-flight refresh, retry a 401 exactly once, and convert everything they can throw into an
 * `ApiError` before it reaches a screen.
 *
 * Base URLs: one per app, from `VITE_API_URL` / `EXPO_PUBLIC_API_URL`. The optional `prefix` is what
 * makes the same build work against the all-in-one process (docs/26 section 7), where every service is
 * mounted behind a path: `apiUrl` `https://api.example.in` + `prefix` `/owner`.
 */
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { uuidv7 } from '@dos/domain'
import {
  authContract,
  contract,
  type AuthMe,
  type AuthPlatform,
  type TokenPair,
} from '@dos/contracts'

import { ApiError, ORPCError, toApiError } from './errors.js'
import { SessionStore, type Session, type SessionState } from './session.js'
import { memoryTokenStorage, webTokenStorage, type TokenStorage } from './storage.js'

export type ApiRouter = ContractRouterClient<typeof contract>
export type AuthRouter = ContractRouterClient<typeof authContract>

/**
 * The auth procedures that carry a Bearer token and are worth a refresh-and-retry on 401. `login`,
 * `refresh`, `logout`, `switchTenant` and `jwks` authenticate through the body (or not at all);
 * retrying `refresh` on its own 401 would loop.
 */
const AUTH_RETRY_PATHS: ReadonlySet<string> = new Set([
  'me',
  'sessions',
  'revokeSession',
  'changePassword',
])

export interface CreateApiClientOptions {
  /** Base URL of this app's own service. Same-origin `/api` behind a dev proxy is fine. */
  apiUrl: string
  /** Base URL of auth-service. Its contract routes already start with `/auth`, so this is the origin. */
  authUrl: string
  /** All-in-one mode: the path this app's service is mounted behind, e.g. `/owner`. */
  prefix?: string
  /** All-in-one mode: normally `/auth` is part of the route, so this stays empty. */
  authPrefix?: string
  /** Defaults to `webTokenStorage()` in a browser and to memory anywhere else. */
  storage?: TokenStorage
  /** Which app this is; sent on login so `auth_sessions` can name the device. */
  platform?: AuthPlatform
  /** Device name for the sessions list. Defaults to the browser's user agent, trimmed. */
  deviceName?: string
  /** Called whenever the session ends, including when a refresh is rejected. */
  onSignOut?: (reason: ApiError | null) => void
}

export interface SignInOptions {
  username: string
  password: string
  /** Only for a user who belongs to more than one distributor. Omit otherwise (docs/22 section 7). */
  tenantId?: string
  /** "Remember this device": keeps the session across a browser restart. Default true. */
  remember?: boolean
}

/** The id and the idempotency key one user intent carries — the SAME pair on every retry. */
export interface MutationMeta {
  /** Client-generated UUIDv7 primary key for the row being created. */
  readonly id: string
  /** `UNIQUE(tenant_id, idempotency_key)`: a replay returns the stored result, never a second row. */
  readonly idempotencyKey: string
}

/** One per user intent (a tap). Regenerate for a NEW intent, never for a retry of the same one. */
export function newMutation(): MutationMeta {
  return { id: uuidv7(), idempotencyKey: uuidv7() }
}

export function newId(): string {
  return uuidv7()
}

export interface ApiClient {
  /** Tenant-scoped procedures: catalog, orders, pricing, receivables, ... */
  readonly api: ApiRouter
  /** auth-service procedures. */
  readonly auth: AuthRouter
  readonly session: SessionStore
  /** Sign in with username + password. Resolves once the session is live. */
  signIn: (options: SignInOptions) => Promise<Session>
  /** Revokes this device's session server-side (best effort), then always clears locally. */
  signOut: () => Promise<void>
  /** Who am I, in this distributorship. Refreshes the local session snapshot. */
  me: () => Promise<AuthMe>
  /** Open a session on another membership of the same user. */
  switchDistributor: (tenantId: string) => Promise<Session>
  /** Change the password; the server revokes every OTHER session, this device stays signed in. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** Boot: exchange a surviving refresh token for a live access token. A no-op when there is none. */
  hydrate: () => Promise<void>
  /** One id + one idempotency key per user intent. */
  newMutation: () => MutationMeta
}

function join(base: string, prefix: string | undefined): string {
  if (!prefix) return base.replace(/\/$/, '')
  return `${base.replace(/\/$/, '')}/${prefix.replace(/^\//, '').replace(/\/$/, '')}`
}

function defaultStorage(): TokenStorage {
  return typeof window === 'undefined' ? memoryTokenStorage() : webTokenStorage()
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof ORPCError && err.status === 401
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const storage = options.storage ?? defaultStorage()
  const session = new SessionStore(storage)

  async function headers(): Promise<Record<string, string>> {
    const token = session.accessToken
    return token === null ? {} : { authorization: `Bearer ${token}` }
  }

  let refreshInFlight: Promise<void> | null = null

  async function refreshNow(): Promise<void> {
    const refreshToken = session.refreshToken
    if (refreshToken === null) {
      const err = new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
      session.clear()
      options.onSignOut?.(err)
      throw err
    }
    try {
      const pair = await authClient.refresh({ refreshToken, deviceId: session.deviceId })
      session.applyTokens(pair)
    } catch (raw) {
      const err = toApiError(raw)
      // A rejected or REUSED refresh token means the server already revoked the session.
      session.clear()
      options.onSignOut?.(err)
      throw err
    }
  }

  /** Single-flight: a burst of 401s across both clients shares one refresh, not one each. */
  function ensureFreshAccessToken(): Promise<void> {
    refreshInFlight ??= refreshNow().finally(() => {
      refreshInFlight = null
    })
    return refreshInFlight
  }

  /**
   * One interceptor for both links. On a 401 it refreshes ONCE and replays the call; every other
   * failure — and a second 401 — leaves as an `ApiError`, so no screen ever sees a raw fetch error.
   */
  function interceptor(retryable: (path: readonly string[]) => boolean) {
    return async (opts: {
      next: () => Promise<unknown>
      path: readonly string[]
    }): Promise<unknown> => {
      try {
        return await opts.next()
      } catch (err) {
        if (!isUnauthorized(err) || !retryable(opts.path)) throw toApiError(err)
        try {
          await ensureFreshAccessToken()
        } catch {
          throw toApiError(err)
        }
        try {
          return await opts.next()
        } catch (second) {
          throw toApiError(second)
        }
      }
    }
  }

  const authLink = new OpenAPILink(authContract, {
    url: join(options.authUrl, options.authPrefix),
    headers,
    interceptors: [interceptor((path) => AUTH_RETRY_PATHS.has(path[0] ?? ''))],
  })
  const authClient: AuthRouter = createORPCClient<AuthRouter>(authLink)

  const apiLink = new OpenAPILink(contract, {
    url: join(options.apiUrl, options.prefix),
    headers,
    interceptors: [interceptor(() => true)],
  })
  const apiClient: ApiRouter = createORPCClient<ApiRouter>(apiLink)

  /**
   * React Native has a `navigator`, but not a `userAgent` on it — reading `.slice` off `undefined`
   * threw before the first request on a phone (found running the universal template in the iOS
   * simulator, 2026-09-06). The sessions list simply goes unnamed where the platform has no string.
   */
  const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent
  const deviceName =
    options.deviceName ?? (typeof userAgent === 'string' ? userAgent.slice(0, 120) : undefined)

  return {
    api: apiClient,
    auth: authClient,
    session,
    newMutation,

    async signIn(input: SignInOptions): Promise<Session> {
      storage.setDurable?.(input.remember !== false)
      const pair: TokenPair = await authClient.login({
        username: input.username,
        password: input.password,
        deviceId: session.deviceId,
        ...(deviceName ? { deviceName } : {}),
        ...(options.platform ? { platform: options.platform } : {}),
        // Sent ONLY for a user with more than one membership: a tenantId they are not a member of is
        // a 403, including the sample value an API console pre-fills (auth contract, LoginInput).
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      })
      session.applyTokens(pair)
      const current = session.getSnapshot().session
      if (!current) throw new ApiError({ kind: 'unknown', message: 'Sign-in did not settle.' })
      return current
    },

    async signOut(): Promise<void> {
      const refreshToken = session.refreshToken
      if (refreshToken !== null) {
        try {
          await authClient.logout({ refreshToken })
        } catch {
          // Sign out locally even when the network call failed: the token is already unusable here.
        }
      }
      session.clear()
      options.onSignOut?.(null)
    },

    async me(): Promise<AuthMe> {
      const answer = await authClient.me()
      session.updateUser(answer.user)
      return answer
    },

    async switchDistributor(tenantId: string): Promise<Session> {
      const refreshToken = session.refreshToken
      if (refreshToken === null) {
        throw new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
      }
      const pair = await authClient.switchTenant({
        refreshToken,
        deviceId: session.deviceId,
        tenantId,
      })
      session.applyTokens(pair)
      const current = session.getSnapshot().session
      if (!current) throw new ApiError({ kind: 'unknown', message: 'Switch did not settle.' })
      return current
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      await authClient.changePassword({ currentPassword, newPassword })
      const answer = await authClient.me()
      session.updateUser(answer.user)
    },

    async hydrate(): Promise<void> {
      if (!session.hasPersistedSession) {
        session.settleHydration()
        return
      }
      try {
        await ensureFreshAccessToken()
      } catch {
        // `refreshNow` has already cleared the session and told `onSignOut`.
      } finally {
        session.settleHydration()
      }
    },
  }
}

export type { Session, SessionState }
