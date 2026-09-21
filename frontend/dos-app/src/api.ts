/**
 * PLACEHOLDER — the one API client of the one app.
 *
 * The real file (docs/31 §2, root lane) gives `createApiClient` an `apiUrlFor` that reads the elected
 * role on every request, so ONE provider, ONE in-memory access token and ONE refresh single-flight
 * serve all six groups. It also sends the chooser's `actAs` (ruling B3) — never a `platform` value,
 * which stays the device kind (ruling B2).
 *
 * What is here is the template's own `boot()` with the app's role removed, so the project builds
 * before the groups exist.
 */
import { createApiClient, type ApiClient, type TokenStorage } from '@dos/api-client'
import { uuidv7 } from '@dos/domain'
import { os, storage } from '@dos/ui/platform'

import { API_BASE, AUTH_URL } from './config'

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
    apiUrl: API_BASE ?? 'http://127.0.0.1:3001',
    authUrl: AUTH_URL,
    storage: tokens,
    platform: os,
  })
}
