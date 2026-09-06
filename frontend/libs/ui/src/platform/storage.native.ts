/**
 * Native storage: `expo-secure-store` — Keychain on iOS, EncryptedSharedPreferences on Android. A
 * stolen phone does not hand over a distributor's refresh token.
 *
 * SecureStore's API is asynchronous, and `@dos/api-client` reads the refresh token synchronously
 * before every request, so a small write-through cache is primed at boot (`prime()`) and kept in step
 * by every write. That cache is the ONLY copy in plain memory and it dies with the process.
 */
import * as SecureStore from 'expo-secure-store'

import type { PlatformStorage } from './types.js'

const cache = new Map<string, string>()

/** SecureStore keys are alphanumeric plus `.`, `-` and `_`; ours already are, but be sure. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_')
}

export const storage: PlatformStorage = {
  getItem: async (key) => {
    const value = await SecureStore.getItemAsync(safeKey(key))
    if (value === null) cache.delete(key)
    else cache.set(key, value)
    return value
  },
  setItem: async (key, value) => {
    cache.set(key, value)
    await SecureStore.setItemAsync(safeKey(key), value)
  },
  removeItem: async (key) => {
    cache.delete(key)
    await SecureStore.deleteItemAsync(safeKey(key))
  },
  getItemSync: (key) => cache.get(key) ?? null,
  setItemSync: (key, value) => {
    if (value === null) {
      cache.delete(key)
      void SecureStore.deleteItemAsync(safeKey(key))
      return
    }
    cache.set(key, value)
    void SecureStore.setItemAsync(safeKey(key), value)
  },
  prime: async (keys) => {
    await Promise.all(
      keys.map(async (key) => {
        const value = await SecureStore.getItemAsync(safeKey(key))
        if (value !== null) cache.set(key, value)
      }),
    )
  },
  secure: true,
}
