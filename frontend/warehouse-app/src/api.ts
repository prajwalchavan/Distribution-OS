/**
 * The one API client this app uses, over the platform's own token store.
 *
 * `@dos/api-client` needs a SYNCHRONOUS `getRefreshToken()` — it reads before every request and
 * cannot await — while `expo-secure-store` is asynchronous. `boot()` therefore primes the platform
 * store's cache once and only then builds the client, which is why the root layout waits for it
 * instead of rendering a sign-in screen that would forget a live session on every launch.
 */
import { createApiClient, type ApiClient, type TokenStorage } from '@dos/api-client'
import { uuidv7 } from '@dos/domain'
import { os, storage } from '@dos/ui/platform'

import { API_PREFIX, API_URL, AUTH_URL } from './config'

const REFRESH_KEY = 'dos.auth.refresh'
const DEVICE_KEY = 'dos.device'
const SNAPSHOT_KEY = 'dos.auth.session'

/** Everything that must survive a restart. The ACCESS token is not here, and never is. */
export const PERSISTED_KEYS = [REFRESH_KEY, DEVICE_KEY, SNAPSHOT_KEY] as const

export async function boot(): Promise<ApiClient> {
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

  return createApiClient({
    apiUrl: API_URL,
    authUrl: AUTH_URL,
    ...(API_PREFIX === undefined ? {} : { prefix: API_PREFIX }),
    storage: tokens,
    platform: os,
  })
}

/**
 * The id of THIS install, for `@dos/offline`.
 *
 * Deliberately the same key `boot()` writes and `TokenStorage.getDeviceId()` returns: docs/27 §4
 * wants the sync device and the `auth_sessions` device to be one device, so a rejected pick can be
 * traced to the phone that made it. Reading it needs no await because `boot()` has already primed the
 * synchronous cache — and the root layout does not mount the offline provider until it has.
 */
export function deviceId(): string {
  const held = storage.getItemSync(DEVICE_KEY)
  if (held !== null) return held
  const fresh = uuidv7()
  storage.setItemSync(DEVICE_KEY, fresh)
  return fresh
}
