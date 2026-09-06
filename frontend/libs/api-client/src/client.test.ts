/**
 * Drives the real client against a stubbed `fetch`, so the refresh cycle, the single retry and the
 * typed errors are exercised end to end — the same code path a screen uses, with no service running.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from './client.js'
import { ApiError } from './errors.js'
import { memoryTokenStorage } from './storage.js'

const DEVICE = '01924f9a-0000-7000-8000-000000000001'
const TENANT = '01924f9a-0000-7000-8000-0000000000aa'

function tokenPair(accessToken: string, refreshToken: string): unknown {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessExpiresIn: 900,
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
