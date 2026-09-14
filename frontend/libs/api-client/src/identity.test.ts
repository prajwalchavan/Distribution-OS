/**
 * DOS-167 — who is signed in, defined once, and the online query cache keyed by it.
 *
 * The device store is one half of "nothing from a previous user is ever drawn". The other half is this package's
 * query cache: `useQuery` repaints a key's last value first (UX-00 §6.13), and only `useSession().signOut` and
 * `switchDistributor` used to clear it. A FORCED sign-out — a refresh answered 401, `client.ts` → `session.clear()` —
 * cleared nothing, so the next person to sign in on that phone was painted the last one's rows until revalidation.
 */
import { describe, expect, it, vi } from 'vitest'

import type { AuthTenant, AuthUser, MembershipRole, TokenPair } from '@dos/contracts'

import { QueryCache } from './cache.js'
import { createApiClient } from './client.js'
import { toApiError } from './errors.js'
import { identityKey, SessionStore, sessionIdentity, type Session } from './index.js'
import { bindCacheToSession } from './react/index.js'
import { memoryTokenStorage, type TokenStorage } from './storage.js'

const TARSUN: AuthTenant = {
  id: '0192f3c4-0000-7000-8000-0000000000a1',
  slug: 'tarsun',
  legalName: 'Tarsun Enterprises',
  displayName: 'Tarsun Enterprises',
  logoUrl: null,
}
const SAI: AuthTenant = {
  id: '0192f3c4-0000-7000-8000-0000000000a2',
  slug: 'sai-distributors',
  legalName: 'Sai Distributors',
  displayName: 'Sai Distributors, Dombivli',
  logoUrl: null,
}
const RAHUL: AuthUser = {
  id: '0192f3c4-0000-7000-8000-0000000000b1',
  username: 'rahul.deshmukh',
  name: 'Rahul Deshmukh',
  locale: 'en-IN',
  mustChangePassword: false,
}
const AMIT: AuthUser = {
  id: '0192f3c4-0000-7000-8000-0000000000b2',
  username: 'amit.pawar',
  name: 'Amit Pawar',
  locale: 'en-IN',
  mustChangePassword: false,
}

function session(
  user: AuthUser,
  tenant: AuthTenant,
  role: MembershipRole = 'salesperson',
): Session {
  return { user, tenant, role, memberships: [] }
}

function pair(user: AuthUser, tenant: AuthTenant): TokenPair {
  return {
    accessToken: `access-${user.id}`,
    tokenType: 'Bearer',
    accessExpiresIn: 900,
    refreshToken: `refresh-${user.id}-${tenant.id}`,
    refreshExpiresAt: '2026-09-20T12:00:00.000Z',
    user,
    tenant,
    role: 'salesperson',
    memberships: [],
  }
}

describe('DOS-167 who is signed in', () => {
  it('DOS-167 sessionIdentity and identityKey change with the user or the distributor and not with a password flag', () => {
    const rahul = sessionIdentity(session(RAHUL, TARSUN))
    expect(rahul).toEqual({ userId: RAHUL.id, tenantId: TARSUN.id, role: 'salesperson' })
    const key = identityKey(rahul)
    expect(key).toBe(`${RAHUL.id}:${TARSUN.id}`)

    // A colleague on the same distributor, and the same rep at another distributor, are other identities.
    expect(identityKey(sessionIdentity(session(AMIT, TARSUN)))).not.toBe(key)
    expect(identityKey(sessionIdentity(session(RAHUL, SAI)))).not.toBe(key)
    // A changed temporary password is the same person; so is a role change on the same membership, which
    // the device store re-snapshots through the manifest's own role check.
    expect(
      identityKey(sessionIdentity(session({ ...RAHUL, mustChangePassword: true }, TARSUN))),
    ).toBe(key)
    expect(identityKey(sessionIdentity(session(RAHUL, TARSUN, 'delivery')))).toBe(key)

    expect(sessionIdentity(null)).toBeNull()
    expect(identityKey(null)).toBeNull()
  })

  it('DOS-167 the query cache is cleared on every identity change, including a forced sign-out', async () => {
    const store = new SessionStore(memoryTokenStorage())
    const cache = new QueryCache()
    const unbind = bindCacheToSession(store, cache)

    store.applyTokens(pair(RAHUL, TARSUN))
    await cache.fetch(['orders'], async () => ['SO-0875'])
    expect(cache.get(['orders']).data).toEqual(['SO-0875'])

    // What `refreshNow` does when the refresh is answered 401. No `useSession().signOut` runs.
    store.clear()
    expect(cache.get(['orders'])).toMatchObject({ status: 'idle', data: undefined })

    // Amit signs in on the same phone, still holding the temporary password a manager read out.
    store.applyTokens(pair({ ...AMIT, mustChangePassword: true }, TARSUN))
    expect(cache.get(['orders'])).toMatchObject({ status: 'idle', data: undefined })
    await cache.fetch(['orders'], async () => ['SO-0901'])

    // He changes it: the same person at the same distributor, so nothing he has already read goes.
    store.updateUser({ ...AMIT, mustChangePassword: false })
    expect(cache.get(['orders']).data).toEqual(['SO-0901'])

    // A switch to another distributor is another identity.
    store.applyTokens(pair(AMIT, SAI))
    expect(cache.get(['orders'])).toMatchObject({ status: 'idle', data: undefined })

    // Unbound, the store no longer reaches the cache.
    unbind()
    await cache.fetch(['orders'], async () => ['SO-SAI-1'])
    store.clear()
    expect(cache.get(['orders']).data).toEqual(['SO-SAI-1'])
  })

  /*
   * Ruling 2 (v), ruling 1's (q) made mandatory. The sales order screen shows `place.error.message`, which passes through
   * `toApiError`: the engine's refusal at sign-out read "Something could not be completed. Try again." (web V5E, S-122),
   * where the delivery and warehouse screens showed the engine's own sentence. The check is by name: this package never
   * imports `@dos/offline`.
   */
  it('DOS-167 an engine that is signing out reaches the screen as a sign-in-again error in its own words', () => {
    const sentence =
      'This phone is signing out; nothing more can be saved on it. Sign in again and enter it once more.'
    const refused = toApiError(
      Object.assign(new Error(sentence), { name: 'SyncEngineEndedError', code: 'ended' }),
    )
    expect({ kind: refused.kind, message: refused.message }).toEqual({
      kind: 'auth',
      message: sentence,
    })
  })

  /*
   * Addendum (y). On iOS "Sign out, keep here" crashed Expo Go inside the engine's `end()` (2 of 2), and the relaunch came
   * back signed in as the rep who had chosen to sign out: the leave flow cleared the session last, after awaiting the
   * server's revoke. Signing out on the device clears the stored session at once, before any network call, runs the
   * device's leaving, and only then revokes with the token it kept — never waiting for the answer.
   */
  it('DOS-167 signing out on the device does not wait for the network', async () => {
    const storage = memoryTokenStorage()
    const calls: { path: string; body: unknown }[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const path = new URL(request.url).pathname
      const text = await request.clone().text()
      calls.push({ path, body: text === '' ? undefined : (JSON.parse(text) as unknown) })
      if (path === '/auth/login')
        return new Response(JSON.stringify(pair(RAHUL, TARSUN)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      // The office cannot be reached, and nothing tells the phone so: the revoke never answers.
      return new Promise<Response>(() => {})
    })
    try {
      const client = createApiClient({
        apiUrl: 'http://localhost:3003',
        authUrl: 'http://localhost:3000',
        storage,
        requestTimeoutMs: 0,
      })
      await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })
      const kept = storage.getRefreshToken()
      calls.length = 0

      // What the leaving finds the moment it begins — the engine's end, in the apps.
      const seen: { onTheDevice?: unknown } = {}
      const leaving = client.signOutOnDevice(async () => {
        seen.onTheDevice = {
          refreshToken: storage.getRefreshToken(),
          accessToken: client.session.accessToken,
          session: client.session.getSnapshot().session,
          networkCalls: calls.length,
        }
      })
      const answer = await Promise.race([
        Promise.resolve(leaving).then(() => 'answered'),
        sleep(30).then(() => 'still waiting'),
      ])
      await sleep(20)

      expect({
        kept: kept !== null,
        onTheDevice: seen.onTheDevice,
        // Asked once the leaving has settled, with the token kept in memory — and never answered.
        revoke: calls,
        answer,
        whileTheRevokeWaits: {
          refreshToken: storage.getRefreshToken(),
          session: client.session.getSnapshot().session,
        },
      }).toEqual({
        kept: true,
        onTheDevice: { refreshToken: null, accessToken: null, session: null, networkCalls: 0 },
        revoke: [{ path: '/auth/logout', body: { refreshToken: kept } }],
        answer: 'answered',
        whileTheRevokeWaits: { refreshToken: null, session: null },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /*
   * Merge review of ruling 2, problem 2. With the session cleared first, the sign-in form is on the screen while the
   * sign-out is still ending the engine, sweeping this person's other files and forgetting their drafts. Nothing
   * stopped the next person — or the same one — signing straight in on a phone that was still leaving.
   */
  it('DOS-167 a sign-in on this phone waits until the sign-out before it has left the device', async () => {
    const calls = stubAuth((path, body) => {
      if (path === '/auth/login') {
        const who = (body as { username?: string }).username === AMIT.username ? AMIT : RAHUL
        return json(pair(who, TARSUN))
      }
      if (path === '/auth/logout') return json({ ok: true })
      return json({ code: 'NOT_FOUND', message: path }, 404)
    })
    try {
      const client = createApiClient({
        apiUrl: 'http://localhost:3003',
        authUrl: 'http://localhost:3000',
        storage: memoryTokenStorage(),
        requestTimeoutMs: 0,
      })
      await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })
      calls.length = 0

      // Rahul signs out; ending the engine on his file takes a while (a page in flight).
      let finishLeaving = (): void => {}
      const leaving = client.signOutOnDevice(
        () =>
          new Promise<void>((resolve) => {
            finishLeaving = resolve
          }),
      )
      // Amit takes the phone and signs in at once.
      const signingIn = client.signIn({ username: 'amit.pawar', password: 'Dos@1234' })
      await sleep(30)
      const whileLeaving = {
        asked: calls.map((call) => call.path),
        session: client.session.getSnapshot().session,
      }
      finishLeaving()
      await leaving
      const signedIn = await signingIn
      await sleep(20)

      expect({
        whileLeaving,
        afterwards: {
          user: signedIn.user.username,
          asked: calls.map((call) => call.path).sort(),
        },
      }).toEqual({
        // Neither the sign-in nor the revoke goes while the phone is still leaving.
        whileLeaving: { asked: [], session: null },
        afterwards: { user: AMIT.username, asked: ['/auth/login', '/auth/logout'] },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /*
   * Merge review of ruling 2, problem 3. On a phone the refresh token is written through a synchronous cache to the
   * Keychain / EncryptedSharedPreferences, whose delete is asynchronous and was never awaited: the engine's `end()` ran
   * while it was still queued, and a native crash in that window relaunched signed in (`boot()` primes the cache from
   * the secure store).
   */
  it('DOS-167 the leaving is told when the session has left the platform store, not only its cache', async () => {
    stubAuth((path) =>
      path === '/auth/login' ? json(pair(RAHUL, TARSUN)) : new Promise<Response>(() => {}),
    )
    try {
      const cache = memoryTokenStorage()
      let keychainDone = (): void => {}
      let keychainAsked = 0
      const phone: TokenStorage = {
        ...cache,
        clearSession: () => {
          keychainAsked += 1
          return new Promise<void>((resolve) => {
            keychainDone = resolve
          })
        },
      }
      const client = createApiClient({
        apiUrl: 'http://localhost:3003',
        authUrl: 'http://localhost:3000',
        storage: phone,
        requestTimeoutMs: 0,
      })
      await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })

      const handed: { stored?: Promise<void> } = {}
      const leaving = client.signOutOnDevice(async (stored) => {
        handed.stored = stored
        await stored
      })
      const race = (promise: Promise<unknown> | undefined, done: string): Promise<string> =>
        promise === undefined
          ? Promise.resolve('never handed over')
          : Promise.race([promise.then(() => done), sleep(30).then(() => 'waiting')])
      const beforeTheKeychain = {
        asked: keychainAsked,
        cache: cache.getRefreshToken(),
        stored: await race(handed.stored, 'landed'),
      }
      keychainDone()
      const afterTheKeychain = await race(Promise.resolve(leaving), 'left')

      expect({ beforeTheKeychain, afterTheKeychain }).toEqual({
        // Out of the cache at once; the removal from the secure store is waited for, not assumed.
        beforeTheKeychain: { asked: 1, cache: null, stored: 'waiting' },
        afterTheKeychain: 'left',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /*
   * Merge review of ruling 2, problem 1 (verifier PROBE-Y3). The engine's calls go through this client, so an access
   * token that expired a moment before "Sign out, keep here" had a refresh in flight at the tap. When it answered,
   * `refreshNow` wrote the rotated pair back unguarded: the rep who had chosen to sign out was signed in again on the
   * device (session, access token and refresh token), with the call replayed under it — and, had the next person
   * already signed in, their session would have been replaced by his.
   */
  it('DOS-167 a refresh in flight when the person signs out on the device signs nobody back in', async () => {
    const RAHUL_REFRESH = `refresh-${RAHUL.id}-${TARSUN.id}`
    async function refreshLandsAfterTheSignOut(next: 'nobody' | 'amit'): Promise<unknown> {
      let answerRefresh = (): void => {}
      const refreshHeld = new Promise<void>((resolve) => {
        answerRefresh = resolve
      })
      let refreshArrived = (): void => {}
      const refreshAsked = new Promise<void>((resolve) => {
        refreshArrived = resolve
      })
      const calls = stubAuth(async (path, body, authorization) => {
        if (path === '/auth/login') {
          const who = (body as { username?: string }).username === 'amit.pawar' ? AMIT : RAHUL
          return json(pair(who, TARSUN))
        }
        if (path === '/auth/refresh') {
          refreshArrived()
          await refreshHeld
          return json({
            ...pair(RAHUL, TARSUN),
            accessToken: 'access-rotated',
            refreshToken: 'refresh-rotated',
          })
        }
        if (path === '/auth/logout') return json({ ok: true })
        // Rahul's first access token has just expired; any other is good.
        if (authorization === `Bearer access-${RAHUL.id}`)
          return json({ code: 'UNAUTHORIZED', message: 'expired' }, 401)
        return json({ ok: true, database: 'up' })
      })
      try {
        const client = createApiClient({
          apiUrl: 'http://localhost:3003',
          authUrl: 'http://localhost:3000',
          storage: memoryTokenStorage(),
          requestTimeoutMs: 0,
        })
        await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })
        // A call the engine makes on the expired token: the refresh goes out, and the office is slow to answer.
        const reading = client.api.health.ping().then(
          () => 'answered',
          (error: unknown) => toApiError(error).kind,
        )
        await refreshAsked
        // "Sign out, keep here".
        await client.signOutOnDevice(async (stored) => {
          await stored
        })
        if (next === 'amit') await client.signIn({ username: 'amit.pawar', password: 'Dos@1234' })
        answerRefresh()
        const read = await reading
        await sleep(20)
        return {
          read,
          signedIn: client.session.getSnapshot().session?.user.name ?? null,
          accessToken: client.session.accessToken,
          refreshToken: client.session.refreshToken,
          pings: calls
            .filter((call) => call.path === '/health/ping')
            .map((call) => call.authorization),
          revoked: calls
            .filter((call) => call.path === '/auth/logout')
            .map((call) => (call.body as { refreshToken?: string }).refreshToken),
        }
      } finally {
        vi.unstubAllGlobals()
      }
    }

    expect({
      nobody: await refreshLandsAfterTheSignOut('nobody'),
      amit: await refreshLandsAfterTheSignOut('amit'),
    }).toEqual({
      nobody: {
        // The call fails as signed out; nothing is written, and it is not replayed.
        read: 'auth',
        signedIn: null,
        accessToken: null,
        refreshToken: null,
        pings: [`Bearer access-${RAHUL.id}`],
        // His kept token once the leaving has settled, and the pair that came back too late.
        revoked: [RAHUL_REFRESH, 'refresh-rotated'],
      },
      amit: {
        read: 'auth',
        signedIn: AMIT.name,
        accessToken: `access-${AMIT.id}`,
        refreshToken: `refresh-${AMIT.id}-${TARSUN.id}`,
        pings: [`Bearer access-${RAHUL.id}`],
        revoked: [RAHUL_REFRESH, 'refresh-rotated'],
      },
    })
  })

  /*
   * Addendum (z2), merge review minor 1. A sign-in waited for the leaving before it with no end: a native close that never
   * answered held every sign-in on that phone behind a spinner until the app was killed. It waits at most 25 s, then goes
   * on and says so — the engine's file holds still keep one person's file from being opened twice — and a later sign-in
   * never waits for that same leaving again.
   */
  it('DOS-167 a leaving that never settles holds a sign-in for at most 25 seconds', async () => {
    const calls = stubAuth((path, body) => {
      if (path === '/auth/login') {
        const who = (body as { username?: string }).username === AMIT.username ? AMIT : RAHUL
        return json(pair(who, TARSUN))
      }
      if (path === '/auth/logout') return json({ ok: true })
      return json({ code: 'NOT_FOUND', message: path }, 404)
    })
    const warned: unknown[][] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args)
    })
    // The cap runs on the faked clock; a real one lets a sign-in that went on finish its stubbed round trip.
    const realTimeout = globalThis.setTimeout
    const settle = (): Promise<void> => new Promise((resolve) => realTimeout(resolve, 30))
    const logins = (): number => calls.filter((call) => call.path === '/auth/login').length
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const client = createApiClient({
        apiUrl: 'http://localhost:3003',
        authUrl: 'http://localhost:3000',
        storage: memoryTokenStorage(),
        requestTimeoutMs: 0,
      })
      await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })
      const signedIn: { amit: string | null; rahulAgain: string | null } = {
        amit: null,
        rahulAgain: null,
      }

      // Rahul signs out, and the close under `end()` never answers.
      void client.signOutOnDevice(() => new Promise<void>(() => {}))
      // Amit takes the phone and signs in.
      const before = logins()
      void client.signIn({ username: 'amit.pawar', password: 'Dos@1234' }).then((session) => {
        signedIn.amit = session.user.username
      })
      await vi.advanceTimersByTimeAsync(24_999)
      await settle()
      const justBefore = {
        logins: logins() - before,
        signedIn: signedIn.amit,
        warned: warned.length,
      }
      await vi.advanceTimersByTimeAsync(1)
      await settle()
      const atTheCap = { logins: logins() - before, signedIn: signedIn.amit, warned: [...warned] }

      // Amit signs out with nothing hung, and Rahul signs in again: no second wait for the leaving that never settled.
      await client.signOutOnDevice(async () => {})
      const again = logins()
      void client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' }).then((session) => {
        signedIn.rahulAgain = session.user.username
      })
      await settle()
      const next = { logins: logins() - again, signedIn: signedIn.rahulAgain }

      expect({ justBefore, atTheCap, next }).toEqual({
        justBefore: { logins: 0, signedIn: null, warned: 0 },
        atTheCap: {
          logins: 1,
          signedIn: AMIT.username,
          warned: [['sign-in did not wait for a leaving that took over 25 s']],
        },
        next: { logins: 1, signedIn: RAHUL.username },
      })
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The services as the phone reaches them: every call written down, in the order it was made. */
function stubAuth(
  answer: (
    path: string,
    body: unknown,
    authorization: string | null,
  ) => Response | Promise<Response>,
): { path: string; body: unknown; authorization: string | null }[] {
  const calls: { path: string; body: unknown; authorization: string | null }[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(request.url).pathname
    const text = await request.clone().text()
    const body = text === '' ? undefined : (JSON.parse(text) as unknown)
    const authorization = request.headers.get('authorization')
    calls.push({ path, body, authorization })
    return answer(path, body, authorization)
  })
  return calls
}
