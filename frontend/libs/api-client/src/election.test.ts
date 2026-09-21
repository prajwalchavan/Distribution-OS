/**
 * docs/31 §2 and ruling B3 — ONE client, six services, and the election the PERSON made.
 *
 * Two things are proven here that no screen can prove for itself:
 *
 * 1. **The base follows the elected role, and is pinned per request.** `apiUrlFor` is read once,
 *    before the first attempt, and the 401 replay goes back to the SAME origin. A replay that asked
 *    again would, on the one render where the app has just re-elected, send an owner's call to
 *    delivery-service — a 403 the screen would report as a refusal of the thing the person asked for.
 * 2. **`actAs` comes from the chooser, not from a constant.** `signIn({ actAs })` sends the person's
 *    choice; `electRole` mints a NEW token for a different role on the same distributor; a
 *    distributor switch repeats the election rather than quietly reverting to the membership role.
 *
 * Driven against a stubbed `fetch`, so the whole path a screen uses runs with no service up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from './client.js'
import { memoryTokenStorage } from './storage.js'
import { serviceFor } from './services.js'

const DEVICE = '01924f9a-0000-7000-8000-000000000001'
const TENANT = '01924f9a-0000-7000-8000-0000000000aa'
const OTHER_TENANT = '01924f9a-0000-7000-8000-0000000000ab'

function tokenPair(role: string, accessToken = 'access-1'): unknown {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessExpiresIn: 900,
    refreshToken: 'refresh-1',
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: '01924f9a-0000-7000-8000-0000000000b1',
      name: 'Sunil Tarsun',
      username: 'sunil.tarsun',
      locale: 'en-IN',
      mustChangePassword: false,
    },
    tenant: {
      id: TENANT,
      slug: 'tarsun',
      legalName: 'Tarsun Enterprises',
      displayName: 'Tarsun Enterprises',
      logoUrl: null,
    },
    role,
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
      {
        tenantId: OTHER_TENANT,
        tenantSlug: 'sai',
        tenantName: 'Sai Distributors',
        displayName: 'Sai Distributors',
        logoUrl: null,
        role: 'manager',
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
  url: string
  origin: string
  path: string
  body: unknown
}

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const text = await request.clone().text()
    const call: Call = {
      url: request.url,
      origin: url.origin,
      path: url.pathname,
      body: text === '' ? undefined : JSON.parse(text),
    }
    calls.push(call)
    return handler(call)
  })
  return calls
}

/** The one app's own wiring: no `actAs` constant, and a base that reads the elected role. */
function oneAppClient(base?: string): ReturnType<typeof createApiClient> {
  let client: ReturnType<typeof createApiClient> | null = null
  client = createApiClient({
    apiUrl: 'http://no-service.test',
    authUrl: 'http://auth.test',
    storage: memoryTokenStorage(DEVICE),
    platform: 'web',
    deviceName: 'vitest',
    apiUrlFor: () => {
      const role = client?.session.getSnapshot().session?.role
      return role === undefined ? undefined : serviceFor(role, base)
    },
  })
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the api base follows the elected role', () => {
  it('leaves for the elected role s service, never for the app s own apiUrl', async () => {
    const calls = stubFetch((call) =>
      call.path.endsWith('/auth/login')
        ? json(tokenPair('delivery'))
        : json({ items: [], nextCursor: null }),
    )
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234', actAs: 'delivery' })
    await client.api.delivery.trips.list({})

    const api = calls.filter((call) => call.origin !== 'http://auth.test')
    expect(api).toHaveLength(1)
    expect(api[0]?.origin).toBe('http://127.0.0.1:3005')
    expect(api[0]?.origin).not.toBe('http://no-service.test')
  })

  it('re-points the SAME client when the role changes, with no rebuild', async () => {
    const calls = stubFetch((call) =>
      call.path.endsWith('/auth/login')
        ? json(tokenPair('owner'))
        : call.path.endsWith('/auth/switch-tenant') || call.path.endsWith('/auth/switchTenant')
          ? json(tokenPair('delivery', 'access-2'))
          : json({ items: [], nextCursor: null }),
    )
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234', actAs: 'owner' })
    await client.api.orders.list({})
    const before = client.session.accessToken

    await client.electRole('delivery')
    await client.api.delivery.trips.list({})

    const api = calls.filter((call) => call.origin !== 'http://auth.test')
    expect(api.map((call) => call.origin)).toEqual([
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3005',
    ])
    // A new token, not a client-side group change under the old one (ruling B3).
    expect(client.session.accessToken).not.toBe(before)
    expect(client.session.getSnapshot().session?.role).toBe('delivery')
  })

  it('uses the all-in-one prefix under one origin when a base is set (docs/26 §7)', async () => {
    const calls = stubFetch((call) =>
      call.path.endsWith('/auth/login')
        ? json(tokenPair('salesperson'))
        : json({ items: [], nextCursor: null }),
    )
    const client = oneAppClient('https://api.distributionos.in')
    await client.signIn({ username: 'rahul.deshmukh', password: 'Dos@1234', actAs: 'salesperson' })
    await client.api.orders.list({})

    const api = calls.filter((call) => call.origin !== 'http://auth.test')
    expect(api[0]?.url.startsWith('https://api.distributionos.in/sales/')).toBe(true)
  })

  it('falls back to the app s own apiUrl when nothing has been elected yet', async () => {
    const calls = stubFetch(() => json({ items: [], nextCursor: null }))
    const client = oneAppClient()
    await client.api.orders.list({}).catch(() => undefined)
    expect(calls[0]?.origin).toBe('http://no-service.test')
  })
})

describe('the base is pinned for the request s replay', () => {
  it('replays a 401 against the origin the call set off for, even after a re-election', async () => {
    let elected = 'owner'
    const calls = stubFetch((call) => {
      if (call.path.endsWith('/auth/login')) return json(tokenPair('owner'))
      if (call.path.includes('/auth/refresh')) {
        // The refresh is the moment the app has a chance to be somewhere else: pretend the person
        // re-elected while this call was in flight. The REPLAY must not follow them.
        elected = 'delivery'
        return json(tokenPair('owner', 'access-2'))
      }
      return call.origin === 'http://127.0.0.1:3001' && calls.length > 2
        ? json({ items: [], nextCursor: null })
        : json({ message: 'expired' }, 401)
    })

    let client: ReturnType<typeof createApiClient> | null = null
    client = createApiClient({
      apiUrl: 'http://no-service.test',
      authUrl: 'http://auth.test',
      storage: memoryTokenStorage(DEVICE),
      platform: 'web',
      deviceName: 'vitest',
      // Deliberately NOT read off the session: this asks the mutable `elected` above, so a base that
      // was re-asked on the replay would visibly change.
      apiUrlFor: () =>
        client?.session.getSnapshot().session === null
          ? undefined
          : serviceFor(elected as 'owner', undefined),
    })

    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234', actAs: 'owner' })
    await client.api.orders.list({})

    const api = calls.filter((call) => call.origin.startsWith('http://127.0.0.1'))
    expect(api).toHaveLength(2)
    expect(api[0]?.origin).toBe('http://127.0.0.1:3001')
    // The replay, pinned: the same service, not the one elected mid-flight.
    expect(api[1]?.origin).toBe('http://127.0.0.1:3001')
  })
})

describe('actAs comes from the chooser, not from a constant', () => {
  it('sends the person s choice on login', async () => {
    const calls = stubFetch(() => json(tokenPair('warehouse')))
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234', actAs: 'warehouse' })
    const login = calls.find((call) => call.path.endsWith('/auth/login'))
    expect((login?.body as { actAs?: string }).actAs).toBe('warehouse')
  })

  it('sends NO actAs when the person elected nothing: the membership s own role signs in', async () => {
    const calls = stubFetch(() => json(tokenPair('owner')))
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    const login = calls.find((call) => call.path.endsWith('/auth/login'))
    expect(Object.keys(login?.body as object)).not.toContain('actAs')
  })

  it('carries the election to another distributor, rather than reverting to the membership role', async () => {
    const calls = stubFetch((call) =>
      call.path.endsWith('/auth/login')
        ? json(tokenPair('delivery'))
        : json(tokenPair('delivery', 'access-2')),
    )
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234', actAs: 'delivery' })
    await client.switchDistributor(OTHER_TENANT)
    const switched = calls.at(-1)
    expect((switched?.body as { actAs?: string; tenantId?: string }).actAs).toBe('delivery')
    expect((switched?.body as { tenantId?: string }).tenantId).toBe(OTHER_TENANT)
  })

  it('elects on THIS distributor by minting a token for it, not by switching away', async () => {
    const calls = stubFetch((call) =>
      call.path.endsWith('/auth/login')
        ? json(tokenPair('owner'))
        : json(tokenPair('salesperson', 'access-2')),
    )
    const client = oneAppClient()
    await client.signIn({ username: 'sunil.tarsun', password: 'Dos@1234' })
    await client.electRole('salesperson')
    const elected = calls.at(-1)
    expect((elected?.body as { actAs?: string }).actAs).toBe('salesperson')
    expect((elected?.body as { tenantId?: string }).tenantId).toBe(TENANT)
  })

  it('refuses to elect with no session: there is nothing to mint a token from', async () => {
    stubFetch(() => json({}, 401))
    const client = oneAppClient()
    await expect(client.electRole('delivery')).rejects.toThrow(/signed out/i)
  })
})
