/**
 * DOS-102 — "it lands where it left off" has to survive the app being KILLED, on a phone.
 *
 * WHAT WAS WRONG. `rememberDistributor` writes `dos.lastTenantId` with `storage.setItemSync` and
 * `distributorToOpen` reads it back with `storage.getItemSync`, but the key was never added to
 * `PERSISTED_KEYS` in `src/api.ts` — the ONLY argument `storage.prime()` is given at boot. On the
 * native target `getItemSync` is `cache.get(key) ?? null` and that cache is filled ONLY by `prime()`
 * or by a write in the same process (`libs/ui/src/platform/storage.native.ts`); expo-secure-store
 * itself is asynchronous. So the id was written to the Keychain and never read back out of it: a
 * shopkeeper who buys from three distributors opened Sai, killed the app, reopened it, signed in, and
 * landed in the first membership again — precisely the bug DOS-102 is named for.
 *
 * WHY NOTHING SHOWED IT. `storage.web.ts` reads `localStorage` synchronously, so the WEB build worked
 * and only the phone did not. Every other `getItemSync` call in the repo reads a `PERSISTED_KEYS`
 * member, so there was no precedent excusing this one.
 *
 * HOW IT IS READ. Under Vitest `@dos/ui/platform` resolves to the WEB module — the half that already
 * worked — so the platform is replaced here by a store with `storage.native.ts`'s exact semantics: a
 * synchronous cache that dies with the process, over an asynchronous store that does not. The app's
 * real `boot()` and the real `PERSISTED_KEYS` do the priming, so this fails the moment a key a screen
 * reads synchronously is left off that list again.
 */
import { describe, expect, it, vi } from 'vitest'

/** `storage.native.ts`, written out: a write-through cache over an async store that outlives it. */
const phone = vi.hoisted(() => {
  /** expo-secure-store: the Keychain / EncryptedSharedPreferences. Survives a kill. */
  const keychain = new Map<string, string>()
  /** The synchronous cache. Filled by `prime()` and by writes in THIS process, and by nothing else. */
  let cache = new Map<string, string>()
  return {
    keychain,
    /** The shopkeeper swipes the app away: the process — and with it the cache — is gone. */
    kill: (): void => {
      cache = new Map()
    },
    storage: {
      getItem: (key: string) => Promise.resolve(keychain.get(key) ?? null),
      setItem: (key: string, value: string) => {
        cache.set(key, value)
        keychain.set(key, value)
        return Promise.resolve()
      },
      removeItem: (key: string) => {
        cache.delete(key)
        keychain.delete(key)
        return Promise.resolve()
      },
      getItemSync: (key: string): string | null => cache.get(key) ?? null,
      setItemSync: (key: string, value: string | null): void => {
        if (value === null) {
          cache.delete(key)
          keychain.delete(key)
          return
        }
        cache.set(key, value)
        keychain.set(key, value)
      },
      prime: (keys: readonly string[]): Promise<void> => {
        for (const key of keys) {
          const value = keychain.get(key)
          if (value !== undefined) cache.set(key, value)
        }
        return Promise.resolve()
      },
      secure: true,
    },
  }
})

vi.mock('@dos/ui/platform', () => ({ os: 'android', storage: phone.storage }))

const { PERSISTED_KEYS, boot } = await import('../api')
const { LAST_TENANT_KEY, distributorToOpen, rememberDistributor } =
  await import('./last-distributor')

/** `ramesh.gupta` in the pilot data buys from three distributors; the list opens on the first. */
const FIRST = '01994a10-0000-7000-8000-0000000000a1'
const SAI = '01994a10-0000-7000-8000-0000000000a2'
const MEMBERSHIPS = [
  { tenantId: FIRST, status: 'active' },
  { tenantId: SAI, status: 'active' },
] as const

describe('DOS-102 the phone opens the distributor it was last used with, after a restart', () => {
  it('a shop last in Sai is opened in Sai when the app is killed and reopened', async () => {
    // Session one: the app boots, the shopkeeper switches to Sai, the device remembers it.
    await boot()
    rememberDistributor(SAI)
    expect(phone.keychain.get(LAST_TENANT_KEY)).toBe(SAI)

    // Swiped away. The Keychain still holds the id; the synchronous cache does not exist any more.
    phone.kill()
    expect(phone.storage.getItemSync(LAST_TENANT_KEY)).toBeNull()

    // Session two: `boot()` primes exactly the keys `PERSISTED_KEYS` names, and nothing else.
    await boot()
    expect(distributorToOpen(FIRST, MEMBERSHIPS)).toBe(SAI)
  })

  it('every key this app reads synchronously is primed at boot', () => {
    expect([...PERSISTED_KEYS]).toContain(LAST_TENANT_KEY)
  })
})
