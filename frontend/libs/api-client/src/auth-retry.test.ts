/**
 * DOS-102 — every auth procedure that carries a Bearer token is healed exactly like any other read.
 *
 * WHAT WAS WRONG. The auth link's interceptor asked an allow-list of four names — me, sessions,
 * revokeSession, changePassword — read off `path[0]`. `auth.memberships.summary` is nested, so its
 * `path[0]` is 'memberships', and the one predicate gates BOTH halves of the client's healing: the
 * refresh that runs BEFORE a call on a token inside its last minute, and the refresh-and-replay after
 * a 401. So the shop's home screen — which dispatches this read first, before the five that each renew
 * the token on their way out — sent it on a dying token, got a 401 nothing retried, and printed the
 * throw as "You owe Rs 0.00 across 3 distributors" to a shop that owes lakhs.
 *
 * HOW IT IS READ. The real `createApiClient` against a stubbed `fetch`, so what is asserted is the
 * sequence of REQUESTS a phone would make, not a re-description of the predicate. The last test walks
 * the auth contract itself, so a procedure added tomorrow cannot fall outside the healing in silence.
 */
import { authContract, type MembershipRole } from '@dos/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient, isBearerAuthPath } from './client.js'
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
      name: 'Ramesh Gupta',
      username: 'ramesh.gupta',
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
    role: 'retailer',
    memberships: [
      {
        tenantId: TENANT,
        tenantSlug: 'tarsun',
        tenantName: 'Tarsun Enterprises',
        displayName: 'Tarsun Enterprises',
        logoUrl: null,
        role: 'retailer',
        extraRoles: [],
        status: 'active',
      },
    ],
  }
}

/** ₹91,494 across three distributors — the figure the shop's home screen must quote. */
const SUMMARY = {
  items: [],
  totalOutstandingPaise: 9_149_400,
  totalOverduePaise: 0,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  path: string
  authorization: string | null
  /** The request body as it went out, so a test can read what the phone actually ASKED for. */
  body: string
}

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const call: Call = {
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization'),
      body: await request.clone().text(),
    }
    calls.push(call)
    return handler(call)
  })
  return calls
}

function client(actAs?: MembershipRole): ReturnType<typeof createApiClient> {
  return createApiClient({
    apiUrl: 'http://api.test',
    authUrl: 'http://auth.test',
    storage: memoryTokenStorage(DEVICE),
    platform: 'android',
    deviceName: 'vitest',
    ...(actAs === undefined ? {} : { actAs }),
  })
}

/** Signs in, then answers 401 until `/auth/refresh` is called, exactly as an expired token does. */
function expiringStub(): Call[] {
  let expired = true
  return stubFetch((call) => {
    if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
    if (call.path === '/auth/refresh') {
      expired = false
      return json(tokenPair('access-2', 'refresh-2'))
    }
    if (expired) return json({ code: 'UNAUTHORIZED', message: 'Access token expired.' }, 401)
    return json(SUMMARY)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a Bearer-carrying auth read is healed like any other read', () => {
  it('refreshes ONCE on a 401 and replays `auth.memberships.summary`', async () => {
    const calls = expiringStub()
    const c = client()
    await c.signIn({ username: 'ramesh.gupta', password: 'Dos@1234' })

    const summary = await c.auth.memberships.summary()

    expect(summary.totalOutstandingPaise).toBe(9_149_400)
    expect(calls.map((x) => x.path)).toEqual([
      '/auth/login',
      '/auth/memberships/summary',
      '/auth/refresh',
      '/auth/memberships/summary',
    ])
    expect(calls.at(-1)?.authorization).toBe('Bearer access-2')
  })

  it('refreshes BEFORE the call when the token is inside its last minute', async () => {
    // 30 s of life left: inside REFRESH_BEFORE_EXPIRY_MS, so nothing should go out on this token.
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1', 30))
      if (call.path === '/auth/refresh') return json(tokenPair('access-2', 'refresh-2'))
      return json(SUMMARY)
    })
    const c = client()
    await c.signIn({ username: 'ramesh.gupta', password: 'Dos@1234' })

    await c.auth.memberships.summary()

    expect(calls.map((x) => x.path)).toEqual([
      '/auth/login',
      '/auth/refresh',
      '/auth/memberships/summary',
    ])
    expect(calls.at(-1)?.authorization).toBe('Bearer access-2')
  })
})

/** Every leaf of a contract router, as the dotted path the interceptor is handed. */
function leafPaths(node: unknown, prefix: readonly string[] = []): string[] {
  if (node === null || typeof node !== 'object') return []
  // A nested router is an object LITERAL (`memberships: { summary }`); a procedure is a class instance.
  if (Object.getPrototypeOf(node) !== Object.prototype) return [prefix.join('.')]
  return Object.entries(node).flatMap(([key, child]) => leafPaths(child, [...prefix, key]))
}

describe('the auth contract, procedure by procedure', () => {
  it('heals everything that carries a Bearer token, and only body-authenticated routes are left out', () => {
    const paths = leafPaths(authContract)

    // The guard would be vacuous if the walk found nothing, or missed the nested one it exists for.
    expect(paths).toContain('memberships.summary')
    expect(paths.length).toBeGreaterThan(10)

    expect(paths.filter((path) => !isBearerAuthPath(path.split('.'))).sort()).toEqual(
      [
        'forgotPassword',
        'jwks',
        'login',
        'logout',
        'platformLogin',
        'platformRefresh',
        'refresh',
        'resetPassword',
        'switchTenant',
      ].sort(),
    )
  })
})

/**
 * docs/29 §2 field apps always ask for their own role.
 *
 * A van phone is shared and droppable, so the owner who drives on Tuesdays must get a DELIVERY token
 * on it and never an owner token that reaches owner-service for the life of its refresh. The client's
 * half of that is one word on two calls: `actAs` on login and on switch-tenant, sent by the three
 * field apps and by nobody else. What is asserted is the request a phone actually makes.
 */
describe('docs/29 §2 field apps always ask for their own role', () => {
  const stub = (): Call[] =>
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(tokenPair('access-1', 'refresh-1'))
      if (call.path === '/auth/switch-tenant') return json(tokenPair('access-2', 'refresh-2'))
      return json(SUMMARY)
    })

  it('sends actAs on login and on switch-tenant when the app declares a role', async () => {
    const calls = stub()
    const c = client('delivery')
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.switchDistributor(TENANT)

    const login = calls.find((x) => x.path === '/auth/login')
    const switched = calls.find((x) => x.path === '/auth/switch-tenant')
    expect(JSON.parse(login?.body ?? '{}')).toMatchObject({ actAs: 'delivery' })
    expect(JSON.parse(switched?.body ?? '{}')).toMatchObject({ actAs: 'delivery' })
  })

  it('sends nothing at all when the app declares none — the owner signs in as the owner', async () => {
    const calls = stub()
    const c = client()
    await c.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await c.switchDistributor(TENANT)

    for (const path of ['/auth/login', '/auth/switch-tenant']) {
      const body: unknown = JSON.parse(calls.find((x) => x.path === path)?.body ?? '{}')
      expect(Object.keys(body as Record<string, unknown>)).not.toContain('actAs')
    }
  })
})
