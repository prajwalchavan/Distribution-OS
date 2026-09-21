/**
 * THE ONE API CLIENT of the one app — docs/31 §2.
 *
 * `@dos/api-client` needs a SYNCHRONOUS `getRefreshToken()` — it reads before every request and
 * cannot await — while `expo-secure-store` is asynchronous. `boot()` therefore primes the platform
 * store's cache once and only then builds the client, which is why the root layout waits for it
 * instead of rendering a sign-in screen that would forget a live session on every launch.
 *
 * SIX SERVICES, ONE CLIENT, ONE PROVIDER. The six apps each knew one service. This one knows the
 * table (`serviceFor`) and asks the ELECTED role, per request, which service this call belongs to.
 * Rebuilding the client when the role changes would drop the in-memory access token and the
 * single-flight refresh with it, so the client is built ONCE and its base is a function.
 *
 * WHAT THIS FILE DOES NOT SEND. There is no `actAs` constant here: with the six `src/config.ts` gone
 * there is no `APP.role` to ask on the person's behalf, so the PERSON elects at the Continue-as
 * chooser and the choice travels as `signIn({ actAs })` and `electRole()` (docs/31 ruling B3).
 * `platform` stays the DEVICE KIND — `web | android | ios`, never the elected group (ruling B2) — so
 * `auth_sessions` keeps naming the device honestly.
 */
import { createApiClient, serviceFor, type ApiClient, type TokenStorage } from '@dos/api-client'
import { uuidv7 } from '@dos/domain'
import { os, storage } from '@dos/ui/platform'

import { API_BASE, AUTH_URL, GROUPS } from './config'
/*
 * The ONE group key the install has to prime (DOS-102). `storage.prime()` is given exactly this list
 * at boot, and on a phone `getItemSync` answers out of the cache that fills — so a key left off it is
 * written to the Keychain and never read back, and a shopkeeper who buys from three distributors
 * lands in the wrong one after a restart. The root imports the group's own constant rather than
 * repeating the string: two spellings of one key is how that bug comes back.
 */
import { LAST_TENANT_KEY } from './groups/retailer/lib/last-distributor'

/**
 * ONE SESSION PER BROWSER PROFILE, and per install.
 *
 * None of these keys is namespaced by role or by group, and that is the decision, not an
 * oversight (architect's ruling): one origin serves all six groups now, so a second sign-in beside
 * the first would have to share `localStorage` with it and one of the two would win silently.
 * Changing role is `electRole` and changing distributor is the switcher — both mint a new token on
 * the SAME session. Somebody who really needs two at once opens a second browser profile.
 *
 * `dos.device` outlives every session: it names the DEVICE in `auth_sessions`, not the person.
 */
const REFRESH_KEY = 'dos.auth.refresh'
const DEVICE_KEY = 'dos.device'
const SNAPSHOT_KEY = 'dos.auth.session'
/** The last role this person chose at the chooser, so the next sign-in preselects it (ruling B3). */
export const LAST_ROLE_KEY = 'dos.lastRole'

/** Everything that must survive a restart. The ACCESS token is not here, and never is. */
export const PERSISTED_KEYS = [
  REFRESH_KEY,
  DEVICE_KEY,
  SNAPSHOT_KEY,
  LAST_ROLE_KEY,
  LAST_TENANT_KEY,
] as const

/**
 * The group whose service a call leaves for before anybody has signed in.
 *
 * There is no elected role then, and no tenant-scoped call to make: every procedure on the six
 * services needs a token, so such a request is a 401 whichever origin it goes to. Naming one keeps
 * `apiUrl` a real URL rather than an empty string the link would have to guess about.
 */
const BEFORE_ANY_SESSION = GROUPS.owner.role

export async function boot(): Promise<ApiClient> {
  await storage.prime(PERSISTED_KEYS)

  let held = storage.getItemSync(DEVICE_KEY)
  if (held === null) {
    // One id for the life of the install: it names the device in `auth_sessions`, not the session.
    held = uuidv7()
    storage.setItemSync(DEVICE_KEY, held)
  }
  const device = held

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
    /*
     * Out of the Keychain / EncryptedSharedPreferences, not only out of the cache in front of it (DOS-167 addendum (y)):
     * a sign-out's engine touches the file only once this has landed, so a crash inside it relaunches to the sign-in form.
     */
    clearSession: async () => {
      await Promise.all([storage.removeItem(REFRESH_KEY), storage.removeItem(SNAPSHOT_KEY)])
    },
  }

  /*
   * The client reads its own session to answer "which service?", so the reference is filled in a
   * line after it is built. `apiUrlFor` is never called during construction — the first call is the
   * first request — so the `null` below is only ever seen by the compiler.
   */
  let client: ApiClient | null = null
  client = createApiClient({
    apiUrl: serviceFor(BEFORE_ANY_SESSION, API_BASE),
    authUrl: AUTH_URL,
    storage: tokens,
    platform: os,
    apiUrlFor: () => {
      const role = client?.session.getSnapshot().session?.role
      return role === undefined ? undefined : serviceFor(role, API_BASE)
    },
  })
  return client
}

/**
 * The id of THIS install, for `@dos/offline`.
 *
 * It is deliberately the same key `boot()` writes and `TokenStorage.getDeviceId()` returns: docs/27
 * §4 wants the sync device and the `auth_sessions` device to be one device, so a rejected write can
 * be traced to the phone that made it. Reading it needs no await because `boot()` has already primed
 * the synchronous cache — and no group layout mounts the offline provider until it has.
 */
export function deviceId(): string {
  const held = storage.getItemSync(DEVICE_KEY)
  if (held !== null) return held
  const fresh = uuidv7()
  storage.setItemSync(DEVICE_KEY, fresh)
  return fresh
}
