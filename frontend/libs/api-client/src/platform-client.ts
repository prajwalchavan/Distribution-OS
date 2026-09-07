/**
 * The client the PLATFORM CONSOLE uses (`frontend/admin-app`, admin-service :3007).
 *
 * WHY THIS IS A SECOND CLIENT AND NOT A FLAG ON THE FIRST. A `platform_admin` is staff of
 * Distribution OS itself: it holds no membership, so there is no tenant to sign into, no membership
 * role and nothing to switch between (`auth.ts` in `@dos/contracts` explains the same decision on the
 * backend side, where it produced `platformLogin` / `platformRefresh` / `platformMe` rather than a
 * nullable `tenant` on the token pair). Making `Session.tenant` nullable here would have pushed a
 * `?.` into six apps whose whole design is "there is always a distributor on screen", to serve the
 * one app where there is never one. What the two clients DO share is in `link.ts` (the URL join and
 * the request deadline), `errors.ts` (every failure becomes an `ApiError`) and the React layer.
 *
 * THE SUPPORT DOOR. Nothing here reads a distributor's rows. `supportPass()` turns an owner-approved
 * `support_grants` row into the five-minute signed pass of `auth.supportPass`, and `openTenant()`
 * builds a client on that DISTRIBUTOR's own service which sends the pass in `x-support-grant`
 * alongside the console's bearer token. Their service — not this one — then decides what the window
 * allows (GET only while the scope is read-only) and writes one `platform_audit` row per call. The
 * console cannot approve its own request: there is no such procedure in `admin.*`.
 */
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import {
  authContract,
  contract,
  type AuthPlatform,
  type PlatformMe,
  type PlatformTokenPair,
  type SupportPass,
} from '@dos/contracts'

import { ApiError, ORPCError, toApiError } from './errors.js'
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithDeadline, join } from './link.js'
import { newMutation, type ApiRouter, type AuthRouter, type MutationMeta } from './client.js'
import { PlatformSessionStore, type PlatformSession } from './session.js'
import { memoryTokenStorage, webTokenStorage, type TokenStorage } from './storage.js'

/** The auth procedures a console session may retry after a refresh; `platformRefresh` never is. */
const AUTH_RETRY_PATHS: ReadonlySet<string> = new Set([
  'platformMe',
  'supportPass',
  'sessions',
  'revokeSession',
  'changePassword',
])

export interface CreatePlatformClientOptions {
  /** Base URL of admin-service (:3007). */
  apiUrl: string
  /** Base URL of auth-service (:3000). Its routes already start with `/auth`. */
  authUrl: string
  /** All-in-one mode (docs/26 §7): the path admin-service is mounted behind, e.g. `/admin`. */
  prefix?: string
  authPrefix?: string
  /**
   * Where a DISTRIBUTOR's own service lives, for a support window. One origin serves them all in
   * every deployment this product has: owner-service :3001 locally, one host in the cloud.
   */
  tenantApiUrl?: string
  storage?: TokenStorage
  platform?: AuthPlatform
  deviceName?: string
  onSignOut?: (reason: ApiError | null) => void
  requestTimeoutMs?: number
}

export interface PlatformSignInOptions {
  username: string
  password: string
  /** "Remember this device": keeps the session across a browser restart. Default true. */
  remember?: boolean
}

export interface PlatformApiClient {
  /** admin-service's procedures. It mounts `health` and `admin` and nothing else. */
  readonly api: ApiRouter
  readonly auth: AuthRouter
  readonly session: PlatformSessionStore
  signIn: (options: PlatformSignInOptions) => Promise<PlatformSession>
  signOut: () => Promise<void>
  me: () => Promise<PlatformMe>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  hydrate: () => Promise<void>
  newMutation: () => MutationMeta
  /** An owner-approved grant → the short-lived pass that opens that one distributor's service. */
  supportPass: (grantId: string) => Promise<SupportPass>
  /**
   * A client on ONE distributor's own service, carrying the pass. Every call is audited there, and
   * a write is refused while the owner's scope is read-only — by their service, not by this app.
   */
  openTenant: (pass: string) => ApiRouter
  /** Where `openTenant` points, so a screen can say which service the window opens. */
  readonly tenantApiUrl: string
}

function defaultStorage(): TokenStorage {
  return typeof window === 'undefined' ? memoryTokenStorage() : webTokenStorage()
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof ORPCError && err.status === 401
}

export function createPlatformClient(options: CreatePlatformClientOptions): PlatformApiClient {
  const storage = options.storage ?? defaultStorage()
  const session = new PlatformSessionStore(storage)
  const tenantApiUrl = options.tenantApiUrl ?? 'http://127.0.0.1:3001'

  async function headers(): Promise<Record<string, string>> {
    const token = session.accessToken
    return token === null ? {} : { authorization: `Bearer ${token}` }
  }

  let refreshInFlight: Promise<void> | null = null

  /**
   * Only the SERVER may end a session (the same rule as `client.ts`): a 401 on the refresh means the
   * token is really gone, anything else means the request never arrived and the session still stands.
   */
  function endsTheSession(err: ApiError): boolean {
    return err.kind === 'auth'
  }

  async function refreshNow(): Promise<void> {
    const refreshToken = session.refreshToken
    if (refreshToken === null) {
      const err = new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
      session.clear()
      options.onSignOut?.(err)
      throw err
    }
    try {
      const pair = await authClient.platformRefresh({ refreshToken, deviceId: session.deviceId })
      session.applyTokens(pair)
    } catch (raw) {
      const err = toApiError(raw)
      if (endsTheSession(err)) {
        session.clear()
        options.onSignOut?.(err)
      }
      throw err
    }
  }

  function ensureFreshAccessToken(): Promise<void> {
    refreshInFlight ??= refreshNow().finally(() => {
      refreshInFlight = null
    })
    return refreshInFlight
  }

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
        } catch (refreshErr) {
          const failure = toApiError(refreshErr)
          throw endsTheSession(failure) ? toApiError(err) : failure
        }
        try {
          return await opts.next()
        } catch (second) {
          throw toApiError(second)
        }
      }
    }
  }

  const deadline = fetchWithDeadline(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)

  const authLink = new OpenAPILink(authContract, {
    url: join(options.authUrl, options.authPrefix),
    headers,
    fetch: deadline,
    interceptors: [interceptor((path) => AUTH_RETRY_PATHS.has(path[0] ?? ''))],
  })
  const authClient: AuthRouter = createORPCClient<AuthRouter>(authLink)

  const apiLink = new OpenAPILink(contract, {
    url: join(options.apiUrl, options.prefix),
    headers,
    fetch: deadline,
    interceptors: [interceptor(() => true)],
  })
  const apiClient: ApiRouter = createORPCClient<ApiRouter>(apiLink)

  const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent
  const deviceName =
    options.deviceName ?? (typeof userAgent === 'string' ? userAgent.slice(0, 120) : undefined)

  return {
    api: apiClient,
    auth: authClient,
    session,
    newMutation,
    tenantApiUrl,

    async signIn(input: PlatformSignInOptions): Promise<PlatformSession> {
      storage.setDurable?.(input.remember !== false)
      const pair: PlatformTokenPair = await authClient.platformLogin({
        username: input.username,
        password: input.password,
        deviceId: session.deviceId,
        ...(deviceName ? { deviceName } : {}),
        ...(options.platform ? { platform: options.platform } : {}),
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

    async me(): Promise<PlatformMe> {
      const answer = await authClient.platformMe()
      session.updateUser(answer.user)
      return answer
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      await authClient.changePassword({ currentPassword, newPassword })
      const answer = await authClient.platformMe()
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
        // A 401 has already cleared the session. Anything else leaves the snapshot in place: the
        // console opens on its last screen and every read says "No connection" until it is back.
      } finally {
        session.settleHydration()
      }
    },

    supportPass(grantId: string): Promise<SupportPass> {
      return authClient.supportPass({ grantId })
    },

    openTenant(pass: string): ApiRouter {
      const link = new OpenAPILink(contract, {
        url: tenantApiUrl.replace(/\/$/, ''),
        headers: async () => {
          const token = session.accessToken
          return {
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            'x-support-grant': pass,
          }
        },
        fetch: deadline,
        interceptors: [interceptor(() => true)],
      })
      return createORPCClient<ApiRouter>(link)
    },
  }
}
