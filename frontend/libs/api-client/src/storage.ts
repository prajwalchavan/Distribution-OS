/**
 * Where the refresh token lives.
 *
 * The ACCESS token never comes here: it stays in a module-level variable for the life of the process
 * (see `session.ts`), so it is gone the moment the tab or the app closes.
 *
 * **Web risk note (deliberate, documented).** A browser page cannot read an httpOnly cookie, and this
 * client talks to the auth service directly rather than through a same-origin session endpoint, so
 * the refresh token is kept in `localStorage`/`sessionStorage`. That means any script that runs on the
 * app's origin can read it. What limits the damage: refresh tokens rotate on every use and a REUSED
 * token revokes the whole session server-side (`auth_sessions`, docs/22 section 7), the token is bound
 * to one `deviceId`, the app ships no third-party script and no user-generated HTML, and "Remember
 * this device" off keeps it in `sessionStorage`, which dies with the tab. Moving to an httpOnly
 * cookie needs a same-origin auth endpoint on the reverse proxy; it is recorded as an open point.
 *
 * **Native.** Pass `secureStoreTokenStorage(SecureStore)` with `expo-secure-store` — Keychain on iOS,
 * EncryptedSharedPreferences on Android. The module is injected rather than imported so this package
 * carries no Expo dependency and stays usable from a plain web build.
 */
import { uuidv7 } from '@dos/domain'

export interface TokenStorage {
  /** Synchronous read, called before every request. Null when signed out. */
  getRefreshToken: () => string | null
  setRefreshToken: (token: string | null) => void
  /** Stable for the life of the install; the same id goes to login, refresh, logout and sync. */
  getDeviceId: () => string
  /** Anything else the session needs to survive a reload (the last session snapshot, as JSON). */
  getItem: (key: string) => string | null
  setItem: (key: string, value: string | null) => void
  /**
   * "Remember this device". `true` keeps the session across a browser restart, `false` clears it when
   * the tab closes. Storages with only one durability (memory, secure store) leave this undefined.
   */
  setDurable?: (durable: boolean) => void
}

const REFRESH_KEY = 'dos.auth.refresh'
const DEVICE_KEY = 'dos.device'

/** Never persists. The default in tests, and the fallback when a browser blocks storage. */
export function memoryTokenStorage(deviceId = uuidv7()): TokenStorage {
  const map = new Map<string, string>()
  return {
    getRefreshToken: () => map.get(REFRESH_KEY) ?? null,
    setRefreshToken: (token) => {
      if (token === null) map.delete(REFRESH_KEY)
      else map.set(REFRESH_KEY, token)
    },
    getDeviceId: () => deviceId,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (value === null) map.delete(key)
      else map.set(key, value)
    },
  }
}

/** The subset of the Web Storage API this module uses; `localStorage` and `sessionStorage` both fit. */
export interface WebStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function safeStorage(pick: () => WebStorageLike): WebStorageLike | null {
  try {
    const store = pick()
    const probe = '__dos__'
    store.setItem(probe, '1')
    store.removeItem(probe)
    return store
  } catch {
    // Private browsing, a blocked third-party context, or storage disabled entirely.
    return null
  }
}

export interface WebTokenStorageOptions {
  /** "Remember this device": `true` survives a browser restart, `false` dies with the tab. */
  remember?: boolean
}

/**
 * `localStorage` (or `sessionStorage`) with the risk documented above. Falls back to memory when the
 * browser refuses storage, so a private window still signs in — it just does not survive a reload.
 */
export function webTokenStorage(options: WebTokenStorageOptions = {}): TokenStorage {
  if (typeof window === 'undefined') return memoryTokenStorage()
  const local = safeStorage(() => window.localStorage)
  const session = safeStorage(() => window.sessionStorage)
  if (!local && !session) return memoryTokenStorage()

  let durable = options.remember !== false
  const active = (): WebStorageLike => (durable ? (local ?? session!) : (session ?? local!))
  const other = (): WebStorageLike | null => (durable ? session : local)

  // The device id is always long-lived: it identifies the install, not the session.
  const idStore = local ?? session!
  let deviceId = idStore.getItem(DEVICE_KEY)
  if (!deviceId) {
    deviceId = uuidv7()
    idStore.setItem(DEVICE_KEY, deviceId)
  }
  const id = deviceId

  // Read from wherever the value actually is: a reload does not know which box the last sign-in used.
  const read = (key: string): string | null =>
    active().getItem(key) ?? other()?.getItem(key) ?? null
  const write = (key: string, value: string | null): void => {
    other()?.removeItem(key)
    if (value === null) active().removeItem(key)
    else active().setItem(key, value)
  }

  return {
    getRefreshToken: () => read(REFRESH_KEY),
    setRefreshToken: (token) => {
      write(REFRESH_KEY, token)
    },
    getDeviceId: () => id,
    getItem: read,
    setItem: write,
    setDurable: (next) => {
      if (next === durable) return
      const carried = [REFRESH_KEY, 'dos.auth.session'].map((key) => [key, read(key)] as const)
      for (const [key] of carried) write(key, null)
      durable = next
      for (const [key, value] of carried) write(key, value)
    },
  }
}

/** The two synchronous calls of `expo-secure-store` this adapter needs. */
export interface SecureStoreLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  deleteItemAsync?: (key: string) => Promise<void>
}

/**
 * `import * as SecureStore from 'expo-secure-store'` in the app, then
 * `secureStoreTokenStorage(SecureStore)`. Injected so this package needs no Expo dependency.
 */
export function secureStoreTokenStorage(secureStore: SecureStoreLike): TokenStorage {
  let deviceId = secureStore.getItem(DEVICE_KEY)
  if (!deviceId) {
    deviceId = uuidv7()
    secureStore.setItem(DEVICE_KEY, deviceId)
  }
  const id = deviceId
  const write = (key: string, value: string | null): void => {
    if (value === null) {
      if (secureStore.deleteItemAsync) void secureStore.deleteItemAsync(key)
      else secureStore.setItem(key, '')
      return
    }
    secureStore.setItem(key, value)
  }
  return {
    getRefreshToken: () => {
      const value = secureStore.getItem(REFRESH_KEY)
      return value === null || value === '' ? null : value
    },
    setRefreshToken: (token) => {
      write(REFRESH_KEY, token)
    },
    getDeviceId: () => id,
    getItem: (key) => {
      const value = secureStore.getItem(key)
      return value === null || value === '' ? null : value
    },
    setItem: (key, value) => {
      write(key, value)
    },
  }
}
