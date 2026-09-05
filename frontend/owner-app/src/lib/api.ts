import { createAuthedClient, ORPCError } from '@dos/api-client'
import {
  applyTokens,
  clearSession,
  deviceId,
  getTokens,
  hasPersistedSession,
  setRememberDevice,
  updateUser,
} from './session.js'

export { ORPCError }

/**
 * `api` talks to the tenant-scoped service (owner-service, same-origin `/api` proxied in dev — see
 * vite.config.ts); `auth` talks to auth-service. Both attach the in-memory access token and share one
 * refresh cycle on a 401 (see createAuthedClient in @dos/api-client); a refresh that fails clears the
 * session (`clearSession`).
 *
 * The two base URLs are shaped differently ON PURPOSE. owner-service's routes have no prefix
 * (`/tenancy/me`), so its base carries the `/api` the dev proxy strips. auth-service's routes already
 * begin with `/auth` (`/auth/login`), so its base is the BARE ORIGIN — appending `/auth` here would
 * produce `/auth/auth/login`, which is a 404.
 */
const { api, auth } = createAuthedClient({
  apiUrl: import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`,
  authUrl: import.meta.env.VITE_AUTH_URL ?? window.location.origin,
  getTokens,
  onTokens: applyTokens,
  onSignOut: clearSession,
})

export { api, auth }

/** Stable query keys: [domain, procedure, input]. */
export const qk = {
  me: () => ['tenancy', 'me'] as const,
  health: () => ['health', 'ping'] as const,
  catalogSearch: (q: string) => ['catalog', 'search', q] as const,
  tenantCatalog: (q: string, listedOnly: boolean) =>
    ['tenantCatalog', 'list', q, listedOnly] as const,
  costs: (variantId?: string) => ['tenantCatalog', 'costs', variantId ?? ''] as const,
  suppliers: () => ['tenantCatalog', 'suppliers'] as const,
}

/** One idempotency key per user intent (a click); regenerate only for a new intent. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

/**
 * Sign in with username + password. `remember` decides where the refresh token is kept (see
 * setRememberDevice in session.tsx): checked survives a browser restart, unchecked is cleared when
 * the tab closes.
 */
export async function login(username: string, password: string, remember: boolean): Promise<void> {
  setRememberDevice(remember)
  const pair = await auth.login({
    username,
    password,
    deviceId,
    deviceName: navigator.userAgent.slice(0, 120),
    platform: 'web',
  })
  applyTokens(pair)
}

/** Boot-time: if a refresh token survived a reload, exchange it for a fresh access token. Called
 * once from App.tsx; a no-op when nothing was persisted (first-ever visit, or after a sign-out). */
export async function hydrateSession(): Promise<void> {
  if (!hasPersistedSession()) return
  const { refreshToken } = getTokens()
  if (!refreshToken) return
  try {
    const pair = await auth.refresh({ refreshToken, deviceId })
    applyTokens(pair)
  } catch {
    clearSession()
  }
}

/** Best-effort: revoke this device's session server-side, then always clear locally. */
export async function signOut(): Promise<void> {
  const { refreshToken } = getTokens()
  if (refreshToken) {
    try {
      await auth.logout({ refreshToken })
    } catch {
      /* still sign out locally even if the network call failed */
    }
  }
  clearSession()
}

/** Open a session on another membership of the same signed-in user. */
export async function switchTenant(tenantId: string): Promise<void> {
  const { refreshToken } = getTokens()
  if (!refreshToken) throw new Error('Not signed in.')
  const pair = await auth.switchTenant({ refreshToken, deviceId, tenantId })
  applyTokens(pair)
}

/** Changing the password revokes every other session of this user (server-side); this device stays
 * signed in. Refreshes the local user record so `mustChangePassword` clears without a reload. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await auth.changePassword({ currentPassword, newPassword })
  const me = await auth.me()
  updateUser(me.user)
}
