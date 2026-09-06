/**
 * Web storage: `localStorage`, with the risk documented in `@dos/api-client`'s `storage.ts` — a
 * browser page cannot read an httpOnly cookie, so the refresh token lives here and rotates on every
 * use. `secure` is `false` and says so; nothing in the product pretends otherwise.
 */
import type { PlatformStorage } from './types.js'

function box(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    const probe = '__dos__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    // Private browsing or storage disabled entirely: the session still works, it just does not survive.
    return null
  }
}

const memory = new Map<string, string>()

export const storage: PlatformStorage = {
  getItem: (key) => Promise.resolve(storage.getItemSync(key)),
  setItem: (key, value) => {
    storage.setItemSync(key, value)
    return Promise.resolve()
  },
  removeItem: (key) => {
    storage.setItemSync(key, null)
    return Promise.resolve()
  },
  getItemSync: (key) => {
    const store = box()
    if (store) return store.getItem(key)
    return memory.get(key) ?? null
  },
  setItemSync: (key, value) => {
    const store = box()
    if (value === null) {
      store?.removeItem(key)
      memory.delete(key)
      return
    }
    store?.setItem(key, value)
    memory.set(key, value)
  },
  prime: () => Promise.resolve(),
  secure: false,
}
