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
 * HOW IT IS READ, AND WHAT IT IS NOT. Under Vitest `@dos/ui/platform` resolves to the WEB module —
 * the half that already worked, because there is no Metro here to pick the native entry point — so
 * the app is handed the SHIPPED `storage.native.ts` by path, with `expo-secure-store` stubbed by a
 * map that outlives the module registry. Killing the app is `vi.resetModules()`: the native module is
 * evaluated again and its `const cache = new Map()` is a new, empty one, exactly as a new process's
 * would be, while the Keychain map is not. The app's real `boot()` and the real `PERSISTED_KEYS` do
 * the priming, so this fails the moment a key a screen reads synchronously is left off that list.
 *
 * It is still not a phone. It runs the shipped native module's own code, but not the Android or iOS
 * binary, and SecureStore's real behaviour (a biometric lock, a Keychain cleared by a restore) is
 * stubbed. A walk on the Pixel 7 is owed on top of this, not replaced by it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * expo-secure-store: the Keychain / EncryptedSharedPreferences. It lives in the TEST file's own
 * scope, which no module reset touches — that is the whole point: the phone's secure store survives
 * the kill that empties the in-memory cache sitting over it.
 */
const keychain = new Map<string, string>()

const secureStore = {
  getItemAsync: (key: string): Promise<string | null> => Promise.resolve(keychain.get(key) ?? null),
  setItemAsync: (key: string, value: string): Promise<void> => {
    keychain.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string): Promise<void> => {
    keychain.delete(key)
    return Promise.resolve()
  },
}

interface Launch {
  boot: () => Promise<unknown>
  PERSISTED_KEYS: readonly string[]
  LAST_TENANT_KEY: string
  rememberDistributor: (tenantId: string) => void
  distributorToOpen: (
    landedTenantId: string,
    memberships: readonly { tenantId: string; status: string }[],
  ) => string | null
  getItemSync: (key: string) => string | null
}

/**
 * A cold start.
 *
 * `vi.doMock` rather than `vi.mock`: a hoisted mock's factory is evaluated ONCE and its result is
 * handed out again after `vi.resetModules()`, which would have kept the very cache this test has to
 * destroy (measured: the second launch still answered `getItemSync` with the first launch's value).
 * Re-registered here, the factory runs per launch, imports `storage.native.ts` afresh, and its
 * `const cache = new Map()` is a new, empty one — a new process, which is what a force-stop leaves.
 */
async function launch(): Promise<Launch> {
  vi.resetModules()
  vi.doMock('expo-secure-store', () => secureStore)
  // Under Vitest `@dos/ui/platform` resolves to the WEB half — there is no Metro here to pick the
  // native entry point — so the app is handed the SHIPPED native module by path.
  vi.doMock('@dos/ui/platform', async () => {
    const { storage } = await import('../../../../../libs/ui/src/platform/storage.native')
    return { os: 'android', storage }
  })
  const { boot, PERSISTED_KEYS } = await import('../../../api')
  const { LAST_TENANT_KEY, distributorToOpen, rememberDistributor } =
    await import('./last-distributor')
  const { storage } = (await import('@dos/ui/platform')) as {
    storage: { getItemSync: (key: string) => string | null }
  }
  return {
    boot,
    PERSISTED_KEYS,
    LAST_TENANT_KEY,
    distributorToOpen,
    rememberDistributor,
    getItemSync: storage.getItemSync,
  }
}

/** `ramesh.gupta` in the pilot data buys from three distributors; the list opens on the first. */
const FIRST = '01994a10-0000-7000-8000-0000000000a1'
const SAI = '01994a10-0000-7000-8000-0000000000a2'
const MEMBERSHIPS = [
  { tenantId: FIRST, status: 'active' },
  { tenantId: SAI, status: 'active' },
] as const

beforeEach(() => {
  keychain.clear()
})

describe('DOS-102 the phone opens the distributor it was last used with, after a restart', () => {
  it('a shop last in Sai is opened in Sai when the app is killed and reopened', async () => {
    // Session one: the app boots, the shopkeeper switches to Sai, the device remembers it.
    const first = await launch()
    await first.boot()
    first.rememberDistributor(SAI)
    expect(keychain.get(first.LAST_TENANT_KEY)).toBe(SAI)

    // Swiped away. The Keychain still holds the id; the cache that was over it does not exist.
    const second = await launch()
    expect(second.getItemSync(second.LAST_TENANT_KEY)).toBeNull()

    // Session two: `boot()` primes exactly the keys `PERSISTED_KEYS` names, and nothing else.
    await second.boot()
    expect(second.getItemSync(second.LAST_TENANT_KEY)).toBe(SAI)
    expect(second.distributorToOpen(FIRST, MEMBERSHIPS)).toBe(SAI)
  })

  it('every key this app reads synchronously is primed at boot', async () => {
    const app = await launch()
    expect([...app.PERSISTED_KEYS]).toContain(app.LAST_TENANT_KEY)
  })

  it('and the guard is real: a key left OFF that list is invisible after the kill', async () => {
    const first = await launch()
    await first.boot()
    // Written exactly as `rememberDistributor` writes, under a key nobody primes.
    keychain.set('dos.notPrimed', SAI)

    const second = await launch()
    await second.boot()
    expect(second.getItemSync('dos.notPrimed')).toBeNull()
  })
})
