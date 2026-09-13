/**
 * The platform console's client, driven against a stubbed `fetch` — the same shape as
 * `client.test.ts`, because the two are twins that must never quietly become one.
 *
 * What is actually being pinned here: a console session goes to `/auth/platform/login` and NOT
 * `/auth/login`; it carries no tenant and no memberships; the refresh it uses is
 * `/auth/platform/refresh`; and a support pass travels in `x-support-grant` to the DISTRIBUTOR's own
 * service rather than to admin-service — which is the whole of docs/22 §8's "the console asks, the
 * owner approves" expressed as HTTP.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPlatformClient } from './platform-client.js'
import { PlatformSessionStore } from './session.js'
import { memoryTokenStorage } from './storage.js'

const DEVICE = '01924f9a-0000-7000-8000-000000000009'
const GRANT = '01a077fc-0754-7428-b0fb-8e66432d8892'

const USER = {
  id: 'fc49cfb2-2ff4-78cb-a9a4-2d71a738b199',
  name: 'Rohit Nair',
  username: 'dos.admin',
  mustChangePassword: false,
  locale: 'en-IN',
}

function platformPair(
  accessToken: string,
  refreshToken: string,
  level: 'super' | 'support' | 'billing' = 'super',
): unknown {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessExpiresIn: 900,
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: USER,
    role: 'platform_admin',
    level,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  url: string
  path: string
  method: string
  authorization: string | null
  supportGrant: string | null
}

function stubFetch(handler: (call: Call, body: unknown) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const call: Call = {
      url: request.url,
      path: url.pathname,
      method: request.method,
      authorization: request.headers.get('authorization'),
      supportGrant: request.headers.get('x-support-grant'),
    }
    calls.push(call)
    const text = await request.clone().text()
    const body: unknown = text === '' ? undefined : JSON.parse(text)
    return handler(call, body)
  })
  return calls
}

function console_(): ReturnType<typeof createPlatformClient> {
  return createPlatformClient({
    apiUrl: 'http://admin.test',
    authUrl: 'http://auth.test',
    tenantApiUrl: 'http://owner.test',
    storage: memoryTokenStorage(DEVICE),
    platform: 'web',
    deviceName: 'vitest',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platform sign-in', () => {
  it('signs in at /auth/platform/login and holds a session with no distributor', async () => {
    const calls = stubFetch((call) =>
      call.path === '/auth/platform/login'
        ? json(platformPair('access-1', 'refresh-1'))
        : json({}, 404),
    )
    const c = console_()
    const session = await c.signIn({ username: 'dos.admin', password: 'Dos@1234' })
    expect(calls[0]?.path).toBe('/auth/platform/login')
    expect(session.role).toBe('platform_admin')
    expect(session.user.username).toBe('dos.admin')
    expect('tenant' in session).toBe(false)
    expect(c.session.accessToken).toBe('access-1')
  })

  it('never sends a tenantId: a console account belongs to no distributor', async () => {
    let sent: Record<string, unknown> = {}
    stubFetch((call, body) => {
      if (call.path === '/auth/platform/login') {
        sent = body as Record<string, unknown>
        return json(platformPair('a', 'r'))
      }
      return json({}, 404)
    })
    await console_().signIn({ username: 'dos.admin', password: 'Dos@1234' })
    expect(sent['tenantId']).toBeUndefined()
    expect(sent['deviceId']).toBe(DEVICE)
  })
})

describe('refresh', () => {
  it('refreshes at /auth/platform/refresh and replays the call once', async () => {
    let expired = true
    const calls = stubFetch((call) => {
      if (call.path === '/auth/platform/login') return json(platformPair('access-1', 'refresh-1'))
      if (call.path === '/auth/platform/refresh') {
        expired = false
        return json(platformPair('access-2', 'refresh-2'))
      }
      if (call.path === '/admin/tenants') {
        if (expired) return json({ message: 'Sign in to continue' }, 401)
        return json({ items: [], nextCursor: null })
      }
      return json({}, 404)
    })
    const c = console_()
    await c.signIn({ username: 'dos.admin', password: 'Dos@1234' })
    const answer = await c.api.admin.tenants.list({ limit: 50 })
    expect(answer.items).toEqual([])
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/platform/login',
      '/admin/tenants',
      '/auth/platform/refresh',
      '/admin/tenants',
    ])
    expect(c.session.accessToken).toBe('access-2')
  })
})

describe('support window', () => {
  it("sends the pass to the DISTRIBUTOR's service, not to admin-service", async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/platform/login') return json(platformPair('access-1', 'refresh-1'))
      if (call.path === '/auth/platform/support-pass') {
        return json({
          pass: 'pass-token-that-is-long-enough-to-pass',
          tenantId: '01a06c94-5a6c-752a-ab3c-65716a47362f',
          tenantSlug: 'tarsun',
          scope: 'read_only',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          grantExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
      }
      if (call.path === '/tenancy/me') {
        return json({
          user: {
            id: '01a06c94-5a84-73d7-92bd-c2a5068ed43d',
            username: 'sunil.tarsun',
            phone: '+919876543210',
            name: 'Sunil Tarsun',
            locale: 'en-IN',
          },
          tenant: {
            id: '01a06c94-5a6c-752a-ab3c-65716a47362f',
            slug: 'tarsun',
            legalName: 'M/s. Tarsun Enterprise',
            gstin: null,
            stateCode: '27',
            plan: 'pro',
            status: 'active',
          },
          membership: {
            id: '01a06c94-5a84-73d7-92bd-c2a5068ed43e',
            tenantId: '01a06c94-5a6c-752a-ab3c-65716a47362f',
            userId: '01a06c94-5a84-73d7-92bd-c2a5068ed43d',
            role: 'owner',
            status: 'active',
          },
        })
      }
      return json({}, 404)
    })
    const c = console_()
    await c.signIn({ username: 'dos.admin', password: 'Dos@1234' })
    const pass = await c.supportPass(GRANT)
    expect(pass.scope).toBe('read_only')

    const inside = c.openTenant(pass.pass)
    const me = await inside.tenancy.me()
    expect(me.tenant.slug).toBe('tarsun')

    const read = calls.find((call) => call.path === '/tenancy/me')
    expect(read?.url.startsWith('http://owner.test')).toBe(true)
    expect(read?.supportGrant).toBe('pass-token-that-is-long-enough-to-pass')
    expect(read?.authorization).toBe('Bearer access-1')
    // The pass is minted on auth-service, which is the only process holding the signing key.
    expect(calls.some((call) => call.path === '/auth/platform/support-pass')).toBe(true)
  })
})

describe('console level (DOS-106)', () => {
  it('DOS-106: keeps the console level from the sign-in and refresh replies, and restores a session saved before the level existed with no level', async () => {
    let expired = true
    stubFetch((call) => {
      if (call.path === '/auth/platform/login') {
        return json(platformPair('access-1', 'refresh-1', 'support'))
      }
      if (call.path === '/auth/platform/refresh') {
        expired = false
        return json(platformPair('access-2', 'refresh-2', 'billing'))
      }
      if (call.path === '/admin/tenants') {
        if (expired) return json({ message: 'Sign in to continue' }, 401)
        return json({ items: [], nextCursor: null })
      }
      return json({}, 404)
    })
    const c = console_()
    const session = await c.signIn({ username: 'dos.support', password: 'Dos@1234' })
    expect(session.level).toBe('support')
    expect(c.session.getSnapshot().session?.level).toBe('support')

    // A refresh settles the level as the server reads it NOW, so a changed level reaches the console
    // at its next refresh rather than at its next sign-in.
    await c.api.admin.tenants.list({ limit: 50 })
    expect(c.session.accessToken).toBe('access-2')
    expect(c.session.getSnapshot().session?.level).toBe('billing')

    // A snapshot written by a build from before the level existed restores with NO level (null, not
    // undefined), so every level-gated control stays hidden until the boot refresh fills it in.
    const storage = memoryTokenStorage(DEVICE)
    storage.setRefreshToken('refresh-from-an-older-build')
    storage.setItem('dos.auth.session', JSON.stringify({ user: USER, role: 'platform_admin' }))
    const restored = new PlatformSessionStore(storage).getSnapshot()
    expect(restored.hydrating).toBe(true)
    expect(restored.session?.user.username).toBe('dos.admin')
    expect(restored.session?.level).toBeNull()
  })
})
