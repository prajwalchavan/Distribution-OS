import { createORPCClient, ORPCError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { authContract, contract, type TokenPair } from '@dos/contracts'

export type { contract }
export type ApiClient = ContractRouterClient<typeof contract>
export type AuthClient = ContractRouterClient<typeof authContract>

/**
 * Read fresh on every outgoing request (never cached across calls): `accessToken`/`refreshToken` are
 * null before sign-in, `deviceId` is stable for the life of the install (used by both clients so a
 * refreshed session and the sync queue agree on which device this is).
 */
export interface TokenSnapshot {
  accessToken: string | null
  refreshToken: string | null
  deviceId: string
}

export interface CreateAuthedClientOptions {
  /** Base URL of the tenant-scoped service (owner-service etc). Same-origin `/api` in dev (Vite proxy). */
  apiUrl: string
  /** Base URL of auth-service. Contract paths already start with `/auth`, so this is just the origin. */
  authUrl: string
  /** Synchronous snapshot of the current tokens; called fresh before every request. */
  getTokens: () => TokenSnapshot
  /** A new token pair was obtained (login, refresh, switch-tenant): persist it. */
  onTokens: (pair: TokenPair) => void
  /** A refresh definitively failed (no refresh token, or it was rejected/reused): clear the session. */
  onSignOut: () => void
}

export interface AuthedClient {
  /** Tenant-scoped procedures (catalog, orders, pricing, ...), all requiring a Bearer access token. */
  api: ApiClient
  /** auth-service procedures: login/refresh/logout/switchTenant/jwks are public; me/sessions/
   * revokeSession/changePassword need the Bearer token like `api` does. */
  auth: AuthClient
}

/**
 * The auth.* procedures that carry a Bearer token and are worth a refresh-and-retry on 401.
 * login/refresh/logout/switchTenant/jwks authenticate via the request body (or not at all) and must
 * never be retried through this path — retrying `refresh` on its own 401 would just loop.
 */
const AUTH_RETRY_PATHS = new Set(['me', 'sessions', 'revokeSession', 'changePassword'])

function isExpiredAccessToken(err: unknown): boolean {
  return err instanceof ORPCError && err.status === 401
}

/**
 * Two oRPC clients (OpenAPI/REST link, matching the NestJS side) sharing one refresh cycle:
 * `auth` talks to auth-service, `api` talks to the tenant-scoped service. Both attach
 * `Authorization: Bearer <accessToken>` from `getTokens()`. A 401 on a token-bearing call triggers
 * ONE shared refresh (single-flight — concurrent 401s across both clients await the same promise)
 * and retries the call once with the fresh token; a failed refresh calls `onSignOut()` and rethrows
 * the ORIGINAL error (not the refresh failure), so the caller sees the real reason it was signed out.
 */
export function createAuthedClient(options: CreateAuthedClientOptions): AuthedClient {
  const { apiUrl, authUrl, getTokens, onTokens, onSignOut } = options

  async function headers(): Promise<Record<string, string>> {
    const { accessToken } = getTokens()
    return accessToken ? { authorization: `Bearer ${accessToken}` } : {}
  }

  // Hoisted; only read once a request is actually in flight, by which point `authClient` below
  // (declared later in this scope) is already assigned — refreshNow is never called synchronously.
  let refreshPromise: Promise<void> | null = null

  async function refreshNow(): Promise<void> {
    const { refreshToken, deviceId } = getTokens()
    if (!refreshToken) {
      onSignOut()
      throw new Error('Not signed in.')
    }
    try {
      const pair = await authClient.refresh({ refreshToken, deviceId })
      onTokens(pair)
    } catch (err) {
      onSignOut()
      throw err
    }
  }

  /** Single-flight: a burst of 401s from several in-flight calls shares one refresh, not one each. */
  function ensureFreshAccessToken(): Promise<void> {
    refreshPromise ??= refreshNow().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  const authLink = new OpenAPILink(authContract, {
    url: authUrl,
    headers,
    interceptors: [
      async (opts) => {
        try {
          return await opts.next()
        } catch (err) {
          if (isExpiredAccessToken(err) && AUTH_RETRY_PATHS.has(opts.path[0] ?? '')) {
            try {
              await ensureFreshAccessToken()
            } catch {
              throw err
            }
            return opts.next()
          }
          throw err
        }
      },
    ],
  })
  const authClient: AuthClient = createORPCClient<AuthClient>(authLink)

  const apiLink = new OpenAPILink(contract, {
    url: apiUrl,
    headers,
    interceptors: [
      async (opts) => {
        try {
          return await opts.next()
        } catch (err) {
          if (isExpiredAccessToken(err)) {
            try {
              await ensureFreshAccessToken()
            } catch {
              throw err
            }
            return opts.next()
          }
          throw err
        }
      },
    ],
  })
  const apiClient = createORPCClient<ApiClient>(apiLink)

  return { api: apiClient, auth: authClient }
}

export { ORPCError }
