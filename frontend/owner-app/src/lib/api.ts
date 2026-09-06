import { ApiError, createApiClient } from '@dos/api-client'

/**
 * The owner console's one client. Everything about tokens, refresh, retry and typed errors lives in
 * `@dos/api-client`; this file only decides the two base URLs and names the query keys.
 *
 * The URLs are shaped differently ON PURPOSE. owner-service's routes carry no prefix (`/tenancy/me`),
 * so its base carries the `/api` the dev proxy strips (see vite.config.ts). auth-service's routes
 * already begin with `/auth` (`/auth/login`), so its base is the BARE ORIGIN — appending `/auth` here
 * would produce `/auth/auth/login`, which is a 404.
 *
 * Against the all-in-one process (docs/26 section 7) nothing changes but the values:
 * `VITE_API_URL=https://api.example.in/owner`, `VITE_AUTH_URL=https://api.example.in`.
 */
export const client = createApiClient({
  apiUrl: import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`,
  authUrl: import.meta.env.VITE_AUTH_URL ?? window.location.origin,
  platform: 'web',
})

export const api = client.api
export const auth = client.auth

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
  return client.newMutation().idempotencyKey
}

/** `remember` decides where the refresh token is kept: localStorage, or sessionStorage for this tab. */
export async function login(username: string, password: string, remember: boolean): Promise<void> {
  await client.signIn({ username, password, remember })
}

/** Boot-time: exchange a surviving refresh token for a fresh access token. */
export function hydrateSession(): Promise<void> {
  return client.hydrate()
}

export function signOut(): Promise<void> {
  return client.signOut()
}

/** Open a session on another membership of the same signed-in user. */
export async function switchTenant(tenantId: string): Promise<void> {
  await client.switchDistributor(tenantId)
}

/** Revokes every OTHER session of this user server-side; this device stays signed in. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return client.changePassword(currentPassword, newPassword)
}

export { ApiError }
