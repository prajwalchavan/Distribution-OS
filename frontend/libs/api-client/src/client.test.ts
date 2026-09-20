/**
 * Drives the real client against a stubbed `fetch`, so the refresh cycle, the single retry and the
 * typed errors are exercised end to end — the same code path a screen uses, with no service running.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from './client.js'
import { ApiError, defaultMessageFor } from './errors.js'
import { memoryTokenStorage } from './storage.js'

const DEVICE = '01924f9a-0000-7000-8000-000000000001'
const TENANT = '01924f9a-0000-7000-8000-0000000000aa'

function tokenPair(accessToken: string, refreshToken: string, accessExpiresIn = 900): unknown {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessExpiresIn,
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: '01924f9a-0000-7000-8000-0000000000b1',
      name: 'Sunil Tarsun',
      username: 'sunil.tarsun',
      phone: '+919876543210',
      mustChangePassword: false,
      locale: 'en-IN',
    },
    tenant: {
      id: TENANT,
      slug: 'tarsun',
      legalName: 'Tarsun Enterprises',
      displayName: 'Tarsun Enterprises',
      logoUrl: null,
    },
    role: 'owner',
    memberships: [
      {
        tenantId: TENANT,
        tenantSlug: 'tarsun',
        tenantName: 'Tarsun Enterprises',
        displayName: 'Tarsun Enterprises',
        logoUrl: null,
        role: 'owner',
        status: 'active',
      },
    ],
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  path: string
  method: string
  authorization: string | null
}

function stubFetch(handler: (call: Call, body: unknown) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const call: Call = {
      path: url.pathname,
      method: request.method,
      authorization: request.headers.get('authorization'),
    }
    calls.push(call)
    const text = await request.clone().text()
    const body: unknown = text === '' ? undefined : JSON.parse(text)
    return handler(call, body)
  })
  return calls
}

function client(storage = memoryTokenStorage(DEVICE)): ReturnType<typeof createApiClient> {
  return createApiClient({
    apiUrl: 'http://api.test',
    authUrl: 'http://auth.test',
    storage,
    platform: 'web',
    deviceName: 'vitest',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sign-in', () => {
  it('posts username + password with the install’s device id and keeps the session', async () => {
    const calls = stubFetch((call) =>
      call.path === '/auth/login' ? json(tokenPair('access-1', 'refresh-1')) : json({}, 404),
    )
    const c = client()
    const session = await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    expect(calls[0]?.path).toBe('/auth/login')
    expect(session.user.username).toBe('sunil.tarsun')
    expect(session.role).toBe('owner')
    expect(c.session.accessToken).toBe('access-1')
    expect(c.session.refreshToken).toBe('refresh-1')
  })

  it('omits tenantId unless the caller supplies one (docs/22 section 7)', async () => {
    let sent: Record<string, unknown> = {}
    stubFetch((call, body) => {
      if (call.path === '/auth/login') {
        sent = body as Record<string, unknown>
        return json(tokenPair('a', 'r'))
      }
      return json({}, 404)
    })
    await client().signIn({ username: 'ramesh.gupta', password: 'Dos@1234' })
    expect(sent['tenantId']).toBeUndefined()
    expect(sent['deviceId']).toBe(DEVICE)

    await client().signIn({ username: 'ramesh.gupta', password: 'Dos@1234', tenantId: TENANT })
    expect(sent['tenantId']).toBe(TENANT)
  })

  it('turns a wrong password into a typed error, never a raw throw', async () => {
    stubFetch(() => json({ code: 'UNAUTHORIZED', message: 'Wrong username or password.' }, 401))
    await expect(client().signIn({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(ApiError)
  })

  it('reports a suspended distributorship as its own kind', async () => {
    stubFetch(() => json({ code: 'LOCKED', message: 'This distributorship is suspended.' }, 423))
    await expect(client().signIn({ username: 'x', password: 'y' })).rejects.toMatchObject({
      kind: 'suspended',
    })
  })
})

describe('the access token', () => {
  it('rides on every call as a Bearer header', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.api.health.ping()
    expect(calls.at(-1)?.authorization).toBe('Bearer access-1')
  })

  it('refreshes ONCE on a 401 and replays the call with the new token', async () => {
    let expired = true
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      if (call.path === '/auth/refresh') {
        expired = false
        return json(tokenPair('access-2', 'refresh-2'))
      }
      if (expired) return json({ code: 'UNAUTHORIZED', message: 'expired' }, 401)
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    const result = await c.api.health.ping()

    expect(result).toEqual({ ok: true, database: 'up' })
    const paths = calls.map((x) => x.path)
    expect(paths).toEqual(['/auth/login', '/health/ping', '/auth/refresh', '/health/ping'])
    expect(calls.at(-1)?.authorization).toBe('Bearer access-2')
    expect(c.session.refreshToken).toBe('refresh-2')
  })

  it('shares ONE refresh across a burst of 401s instead of one per call', async () => {
    let expired = true
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      if (call.path === '/auth/refresh') {
        expired = false
        return json(tokenPair('access-2', 'refresh-2'))
      }
      if (expired) return json({ code: 'UNAUTHORIZED', message: 'expired' }, 401)
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await Promise.all([c.api.health.ping(), c.api.health.ping(), c.api.health.ping()])
    expect(calls.filter((x) => x.path === '/auth/refresh')).toHaveLength(1)
  })

  it('gives up after ONE retry and signs out when the refresh itself is refused', async () => {
    const onSignOut = vi.fn()
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      if (call.path === '/auth/refresh') {
        return json({ code: 'UNAUTHORIZED', message: 'Session ended.' }, 401)
      }
      return json({ code: 'UNAUTHORIZED', message: 'expired' }, 401)
    })
    const c = createApiClient({
      apiUrl: 'http://api.test',
      authUrl: 'http://auth.test',
      storage: memoryTokenStorage(DEVICE),
      onSignOut,
    })
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await expect(c.api.health.ping()).rejects.toBeInstanceOf(ApiError)

    expect(calls.filter((x) => x.path === '/health/ping')).toHaveLength(1)
    expect(calls.filter((x) => x.path === '/auth/refresh')).toHaveLength(1)
    expect(c.session.getSnapshot().session).toBeNull()
    expect(c.session.refreshToken).toBeNull()
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 403: the permission matrix will say no again', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      return json({ code: 'FORBIDDEN', message: 'Salespeople cannot record a receipt.' }, 403)
    })
    const c = client()
    await c.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234' })
    await expect(c.api.health.ping()).rejects.toMatchObject({ kind: 'permission' })
    expect(calls.filter((x) => x.path === '/auth/refresh')).toHaveLength(0)
  })
})

describe('the rest of the session', () => {
  it('switches distributor with the refresh token and the same device id', async () => {
    const other = '01924f9a-0000-7000-8000-0000000000bb'
    let sent: Record<string, unknown> = {}
    stubFetch((call, body) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      if (call.path === '/auth/switch-tenant') {
        sent = body as Record<string, unknown>
        return json(tokenPair('a2', 'r2'))
      }
      return json({}, 404)
    })
    const c = client()
    await c.signIn({ username: 'ramesh.gupta', password: 'Dos@1234' })
    await c.switchDistributor(other)
    expect(sent).toMatchObject({ refreshToken: 'r1', deviceId: DEVICE, tenantId: other })
    expect(c.session.accessToken).toBe('a2')
  })

  it('signs out locally even when the network call fails', async () => {
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      throw new TypeError('Failed to fetch')
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.signOut()
    expect(c.session.getSnapshot().session).toBeNull()
    expect(c.session.refreshToken).toBeNull()
  })

  it('hydrates a surviving refresh token into a live session on boot', async () => {
    const storage = memoryTokenStorage(DEVICE)
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      if (call.path === '/auth/refresh') return json(tokenPair('a2', 'r2'))
      return json({}, 404)
    })
    const first = client(storage)
    await first.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })

    // A reload: same storage, a brand new client with no access token in memory.
    const reloaded = client(storage)
    expect(reloaded.session.accessToken).toBeNull()
    expect(reloaded.session.getSnapshot().hydrating).toBe(true)
    expect(reloaded.session.getSnapshot().session?.user.username).toBe('sunil.tarsun')
    await reloaded.hydrate()
    expect(reloaded.session.accessToken).toBe('a2')
    expect(reloaded.session.getSnapshot().hydrating).toBe(false)
  })

  it('does not call the service on boot when nothing was persisted', async () => {
    const calls = stubFetch(() => json({}, 404))
    const c = client()
    await c.hydrate()
    expect(calls).toHaveLength(0)
    expect(c.session.getSnapshot().hydrating).toBe(false)
  })

  /**
   * The field rule of UX-00 section 12: "the session survives a phone call and a day without signal".
   * Only the SERVER may end a session — a refresh that never arrived says nothing about the token.
   */
  it('KEEPS the session when the boot refresh cannot reach the service', async () => {
    const storage = memoryTokenStorage(DEVICE)
    const onSignOut = vi.fn()
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      throw new TypeError('Failed to fetch')
    })
    const first = client(storage)
    await first.signIn({ username: 'ganesh.more', password: 'Dos@1234' })

    // The van drives into a dead spot and the driver reopens the app.
    const reloaded = createApiClient({
      apiUrl: 'http://api.test',
      authUrl: 'http://auth.test',
      storage,
      onSignOut,
    })
    await reloaded.hydrate()

    expect(reloaded.session.getSnapshot().hydrating).toBe(false)
    expect(reloaded.session.getSnapshot().session).not.toBeNull()
    expect(reloaded.session.refreshToken).toBe('r1')
    expect(onSignOut).not.toHaveBeenCalled()
  })

  it('ENDS the session when the boot refresh is refused by the service', async () => {
    const storage = memoryTokenStorage(DEVICE)
    const onSignOut = vi.fn()
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      return json({ code: 'UNAUTHORIZED', message: 'Session ended.' }, 401)
    })
    const first = client(storage)
    await first.signIn({ username: 'ganesh.more', password: 'Dos@1234' })

    const reloaded = createApiClient({
      apiUrl: 'http://api.test',
      authUrl: 'http://auth.test',
      storage,
      onSignOut,
    })
    await reloaded.hydrate()

    expect(reloaded.session.getSnapshot().session).toBeNull()
    expect(reloaded.session.refreshToken).toBeNull()
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('reports a lost signal as `network`, not as "Signed out", when the retry-refresh fails', async () => {
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('a1', 'r1'))
      if (call.path === '/auth/refresh') throw new TypeError('Failed to fetch')
      return json({ code: 'UNAUTHORIZED', message: 'expired' }, 401)
    })
    const c = client()
    await c.signIn({ username: 'ganesh.more', password: 'Dos@1234' })
    await expect(c.api.health.ping()).rejects.toMatchObject({ kind: 'network' })
    expect(c.session.getSnapshot().session).not.toBeNull()
    expect(c.session.refreshToken).toBe('r1')
  })
})

describe('all-in-one mode (docs/26 section 7)', () => {
  it('mounts this app’s service behind its path prefix without changing a route', async () => {
    const calls = stubFetch(() => json({ ok: true, database: 'up' }))
    const c = createApiClient({
      apiUrl: 'http://one.test',
      authUrl: 'http://one.test',
      prefix: '/owner',
      storage: memoryTokenStorage(DEVICE),
    })
    await c.api.health.ping()
    expect(calls[0]?.path).toBe('/owner/health/ping')
  })
})

describe('mutation identity', () => {
  it('gives every intent its own UUIDv7 id and idempotency key', () => {
    const c = client()
    const a = c.newMutation()
    const b = c.newMutation()
    expect(a.id).not.toBe(b.id)
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('a service that accepts the connection and never answers', () => {
  /**
   * The realistic dead spot: the TCP connection is made and no reply ever comes. `fetch` has no
   * timeout of its own, so before the deadline every screen sat on a skeleton for the OS timeout
   * (measured: 40 s and counting against a suspended owner-service) while the connection strip said
   * "Updated just now".
   */
  function stubSilentFetch(): void {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (new URL(request.url).pathname === '/auth/login') {
        return json(tokenPair('access-1', 'refresh-1'))
      }
      const signal = init?.signal ?? request.signal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error)
        })
      })
    })
  }

  it('becomes "No connection" at the deadline instead of hanging for ever', async () => {
    stubSilentFetch()
    const c = createApiClient({
      apiUrl: 'http://api.test',
      authUrl: 'http://auth.test',
      storage: memoryTokenStorage(DEVICE),
      platform: 'web',
      deviceName: 'vitest',
      requestTimeoutMs: 40,
    })
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    const err = await c.api.tenancy.me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('network')
    expect((err as ApiError).message).toContain('No connection')
  })

  it('keeps the link’s own request options — the deadline replaces nothing', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (init) seen.push(init)
      return new URL(request.url).pathname === '/auth/login'
        ? json(tokenPair('access-1', 'refresh-1'))
        : json({ id: 't', legalName: 'Tarsun Enterprises' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.api.tenancy.me()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((init) => init.redirect === 'manual')).toBe(true)
    expect(seen.every((init) => init.signal !== undefined)).toBe(true)
  })
})

describe('DOS-156 a phone whose native fetch cannot reach the service', () => {
  /**
   * On Android and iOS Expo installs expo/fetch as the global `fetch` (expo/src/winter/runtime.native.ts).
   * It rejects a refused connection AND the deadline's abort with `FetchError`: message 'fetch failed: …',
   * `name` still 'Error'. The manager app says "No connection. Check the signal, then press again." only
   * for kind `network` (manager-app/src/lib/ui.tsx), so while this client read that error as `unknown`
   * every write pressed with no connection said "Something could not be completed. Try again."
   */
  const PICKING_SHEET = {
    id: '01924f9a-0000-7000-8000-0000000000c1',
    idempotencyKey: '01924f9a-0000-7000-8000-0000000000c2',
    orderIds: ['01924f9a-0000-7000-8000-0000000000c3'],
    pickDate: '2026-09-13',
  }

  function stubNativeFetch(failure: (signal: AbortSignal) => Promise<Response>): void {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (new URL(request.url).pathname === '/auth/login') return json(tokenPair('a1', 'r1'))
      return failure(init?.signal ?? request.signal)
    })
  }

  it("DOS-156 a manager write whose native fetch is refused, or cut off at the deadline, rejects as `network` — never 'Something could not be completed'", async () => {
    stubNativeFetch(() =>
      Promise.reject(
        new Error('fetch failed: java.net.ConnectException: Failed to connect to /127.0.0.1:3002'),
      ),
    )
    const refusedClient = client()
    await refusedClient.signIn({ username: 'vikas.kadam', password: 'Dos@1234' })
    const refused = await refusedClient.api.warehouse.picklists
      .create(PICKING_SHEET)
      .catch((e: unknown) => e)

    stubNativeFetch(
      (signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('fetch failed: The operation was aborted.'))
          })
        }),
    )
    const cutOffClient = createApiClient({
      apiUrl: 'http://api.test',
      authUrl: 'http://auth.test',
      storage: memoryTokenStorage(DEVICE),
      platform: 'android',
      deviceName: 'vitest',
      requestTimeoutMs: 40,
    })
    await cutOffClient.signIn({ username: 'vikas.kadam', password: 'Dos@1234' })
    const cutOff = await cutOffClient.api.warehouse.picklists
      .create(PICKING_SHEET)
      .catch((e: unknown) => e)

    for (const failure of [refused, cutOff]) {
      expect(failure).toBeInstanceOf(ApiError)
      expect((failure as ApiError).kind).toBe('network')
      expect((failure as ApiError).message).toBe(defaultMessageFor('network'))
      expect((failure as ApiError).message).not.toBe(defaultMessageFor('unknown'))
    }
  })
})

describe('DOS-112 the wire request of a Day-end settle', () => {
  /**
   * `trips.settle` CREATES a `trip_settlements` row, so its input carries two ids: the new row's own
   * client-generated `id` and the `tripId` it settles. The link fills every `{param}` of the route from
   * the input field of that name and drops the field from the body, so the route has to name the TRIP,
   * or the new settlement id lands in the URL and the service's path/body check refuses every settle.
   * The input below is exactly what manager-app/app/money/day-end.tsx sends.
   */
  const TRIP = '01924f9a-0000-7000-8000-0000000000d1'

  it('DOS-112 Day-end settle: the client link puts the trip in the path and the settlement id in the body', async () => {
    const sent: { method: string; url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const url = new URL(request.url)
      if (url.pathname === '/auth/login') return json(tokenPair('a1', 'r1'))
      const text = await request.clone().text()
      sent.push({
        method: request.method,
        url: `${url.pathname}${url.search}`,
        body: text === '' ? undefined : JSON.parse(text),
      })
      return json({
        item: { id: 'stub', tripId: TRIP },
        tripState: 'settled',
        stockAdjustments: [],
      })
    })
    const desk = client()
    await desk.signIn({ username: 'vikas.kadam', password: 'Dos@1234' })
    const meta = desk.newMutation()

    const answer = await desk.api.delivery.trips.settle({
      id: meta.id,
      idempotencyKey: meta.idempotencyKey,
      tripId: TRIP,
      handedOverCashPaise: 195_000,
      acceptVariance: false,
      note: 'counted with the crew',
    })

    expect(answer.tripState).toBe('settled')
    expect(sent, `trip ${TRIP}, new settlement id ${meta.id}`).toEqual([
      {
        method: 'POST',
        url: `/delivery/trips/${TRIP}/settle`,
        body: {
          id: meta.id,
          idempotencyKey: meta.idempotencyKey,
          handedOverCashPaise: 195_000,
          acceptVariance: false,
          note: 'counted with the crew',
        },
      },
    ])
    expect(sent[0]?.url).not.toContain(meta.id)
  })
})

/**
 * DOS-089 — the token is refreshed BEFORE it dies, not after a 401.
 *
 * The access token lives 15 minutes and nothing watched the clock, so every first call after it expired was a
 * 401 that the interceptor then healed: 31 of them on `/sync/manifest` alone in one sales afternoon, one per
 * navigation, each costing a round trip and a line in every service log. The pair the server hands back has
 * always carried `accessExpiresIn`; it was simply never read. Now a call that is about to go out under a token
 * with less than a minute left refreshes first — single-flight, so a burst pays for one — and the 401 path stays
 * exactly where it was, for a token revoked early or a clock that disagrees.
 */
describe('DOS-089 the access token is refreshed before it expires', () => {
  it('DOS-089 a call under an almost-expired token refreshes first and goes out with the new one', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1', 20))
      if (call.path === '/auth/refresh') return json(tokenPair('access-2', 'refresh-2'))
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    const result = await c.api.health.ping()

    expect(result).toEqual({ ok: true, database: 'up' })
    // No 401 anywhere: the refresh happens before the call, not because of it.
    expect(calls.map((x) => x.path)).toEqual(['/auth/login', '/auth/refresh', '/health/ping'])
    expect(calls.at(-1)?.authorization).toBe('Bearer access-2')
    expect(c.session.accessToken).toBe('access-2')
  })

  it('DOS-089 a burst under an almost-expired token still pays for ONE refresh', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1', 20))
      if (call.path === '/auth/refresh') return json(tokenPair('access-2', 'refresh-2'))
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await Promise.all([c.api.health.ping(), c.api.health.ping(), c.api.health.ping()])

    expect(calls.filter((x) => x.path === '/auth/refresh')).toHaveLength(1)
    expect(calls.filter((x) => x.path === '/health/ping')).toHaveLength(3)
  })

  it('DOS-089 a token with its whole life ahead of it is not refreshed on every call', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      if (call.path === '/auth/refresh') return json(tokenPair('access-2', 'refresh-2'))
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.api.health.ping()

    expect(calls.map((x) => x.path)).toEqual(['/auth/login', '/health/ping'])
    expect(calls.at(-1)?.authorization).toBe('Bearer access-1')
  })

  it('DOS-089 a refresh that cannot reach the office does not stop the call it was meant to help', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1', 20))
      if (call.path === '/auth/refresh') throw new TypeError('Failed to fetch')
      return json({ ok: true, database: 'up' })
    })
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    const result = await c.api.health.ping()

    // The token it has is the only one there is, and the session is still this person's.
    expect(result).toEqual({ ok: true, database: 'up' })
    expect(calls.at(-1)?.authorization).toBe('Bearer access-1')
    expect(c.session.getSnapshot().session).not.toBeNull()
  })
})
