/**
 * The one API client this console uses, over the platform's own token store.
 *
 * It is `createPlatformClient`, not `createApiClient`: a `platform_admin` signs in at
 * `POST /auth/platform/login`, refreshes at `/auth/platform/refresh` and holds a session with no
 * distributor (`@dos/contracts` `auth.ts` states why that is three separate procedures rather than a
 * nullable tenant). Everything else is identical to the other six apps — the refresh token in the
 * platform store, the access token in memory only, one transparent refresh per 401, a 20-second
 * deadline on every request and one idempotency key per intent.
 *
 * `@dos/api-client` needs a SYNCHRONOUS `getRefreshToken()` — it reads before every request and
 * cannot await — while `expo-secure-store` is asynchronous. `boot()` therefore primes the platform
 * store's cache once and only then builds the client, which is why the root layout waits for it
 * instead of rendering a sign-in screen that would forget a live session on every launch.
 */
import { createPlatformClient, type PlatformApiClient, type TokenStorage } from '@dos/api-client'
import { uuidv7 } from '@dos/domain'
import { os, storage } from '@dos/ui/platform'

import { API_PREFIX, API_URL, AUTH_URL, TENANT_API_URL } from './config'

const REFRESH_KEY = 'dos.auth.refresh'
const DEVICE_KEY = 'dos.device'
const SNAPSHOT_KEY = 'dos.auth.session'

/** Everything that must survive a restart. The ACCESS token is not here, and never is. */
export const PERSISTED_KEYS = [REFRESH_KEY, DEVICE_KEY, SNAPSHOT_KEY] as const

export async function boot(): Promise<PlatformApiClient> {
  await storage.prime(PERSISTED_KEYS)

  let deviceId = storage.getItemSync(DEVICE_KEY)
  if (deviceId === null) {
    // One id for the life of the install: it names the device in `auth_sessions`, not the session.
    deviceId = uuidv7()
    storage.setItemSync(DEVICE_KEY, deviceId)
  }
  const device = deviceId

  const tokens: TokenStorage = {
    getRefreshToken: () => storage.getItemSync(REFRESH_KEY),
    setRefreshToken: (token) => {
      storage.setItemSync(REFRESH_KEY, token)
    },
    getDeviceId: () => device,
    getItem: (key) => storage.getItemSync(key),
    setItem: (key, value) => {
      storage.setItemSync(key, value)
    },
  }

  return createPlatformClient({
    apiUrl: API_URL,
    authUrl: AUTH_URL,
    tenantApiUrl: TENANT_API_URL,
    ...(API_PREFIX === undefined ? {} : { prefix: API_PREFIX }),
    storage: tokens,
    platform: os,
  })
}
