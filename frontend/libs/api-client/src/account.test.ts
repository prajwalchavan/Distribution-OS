/**
 * THE SHOPKEEPER'S OWN ACCOUNT (founder, 2026-09-29, docs/22 §8): signed in with no distributor, it lives in
 * `SessionState.account` — never in `session`, which the six groups read and which can never have a null tenant —
 * until a distributor approves and the next refresh answers a session on that distributor's shop. Driven through the
 * real client against a stubbed `fetch`, the same code path the app's screens use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from './client.js'
import { readsAllowed } from './react/index.js'
import { isAccountSession } from './session.js'
import { memoryTokenStorage } from './storage.js'

const DEVICE = '01924f9a-0000-7000-8000-000000000001'
const TENANT = '01924f9a-0000-7000-8000-0000000000aa'
const USER = '01924f9a-0000-7000-8000-0000000000b9'

const user = {
  id: USER,
  name: 'Ramesh Gupta',
  username: 'ramesh.shop',
  mustChangePassword: false,
  locale: 'en-IN',
}

function accountPair(accessToken: string, refreshToken: string): unknown {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessExpiresIn: 900,
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user,
    tenant: null,
    role: null,
    memberships: [],
  }
}

function shopPair(accessToken: string, refreshToken: string): unknown {
  return {
    ...(accountPair(accessToken, refreshToken) as Record<string, unknown>),
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Call {
  path: string
  body: Record<string, unknown> | undefined
  authorization: string | null
}

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const text = await request.clone().text()
    const call: Call = {
      path: new URL(request.url).pathname,
      body: text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>),
      authorization: request.headers.get('authorization'),
    }
    calls.push(call)
    return handler(call)
  })
  return calls
}

function client(storage = memoryTokenStorage(DEVICE), accountWithoutDistributor = true) {
  return createApiClient({
    apiUrl: 'http://api.test',
    authUrl: 'http://auth.test',
    storage,
    platform: 'web',
    deviceName: 'vitest',
    accountWithoutDistributor,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the shopkeeper’s own account', () => {
  it('signs up with the install’s device id and lands in `account`, never in `session`', async () => {
    const calls = stubFetch((call) =>
      call.path === '/auth/sign-up' ? json(accountPair('a-1', 'r-1')) : json({}, 404),
    )
    const c = client()
    const account = await c.signUp({
      id: USER,
      phone: '+919876543210',
      username: 'ramesh.shop',
      password: 'OwnWay2468',
      name: 'Ramesh Gupta',
      shopName: 'Gupta Kirana',
    })
    expect(isAccountSession(account)).toBe(true)
    expect(calls[0]?.body).toMatchObject({ id: USER, deviceId: DEVICE, platform: 'web' })
    const state = c.session.getSnapshot()
    expect(state.session).toBeNull()
    expect(state.account?.user.id).toBe(USER)
    expect(readsAllowed(state, true)).toBe(true)
    expect(c.session.accessToken).toBe('a-1')
  })

  it('asks for an account at sign-in only when the app says it can show one', async () => {
    const sent: Record<string, unknown>[] = []
    stubFetch((call) => {
      if (call.body) sent.push(call.body)
      return json(accountPair('a-1', 'r-1'))
    })
    await client().signIn({ username: 'ramesh.shop', password: 'OwnWay2468' })
    await client(memoryTokenStorage(DEVICE), false).signIn({
      username: 'ramesh.shop',
      password: 'OwnWay2468',
    })
    expect(sent[0]?.accountWithoutDistributor).toBe(true)
    expect(sent[1]?.accountWithoutDistributor).toBeUndefined()
  })

  it('moves from the account to the distributor’s shop at the refresh after an approval', async () => {
    let approved = false
    stubFetch((call) => {
      if (call.path === '/auth/login') return json(accountPair('a-1', 'r-1'))
      if (call.path === '/auth/refresh')
        return json(approved ? shopPair('a-3', 'r-3') : accountPair('a-2', 'r-2'))
      return json({}, 404)
    })
    const c = client()
    await c.signIn({ username: 'ramesh.shop', password: 'OwnWay2468' })
    await c.refreshSession()
    expect(c.session.getSnapshot().account).not.toBeNull()
    approved = true
    await c.refreshSession()
    const state = c.session.getSnapshot()
    expect(state.account).toBeNull()
    expect(state.session?.tenant.id).toBe(TENANT)
    expect(state.session?.role).toBe('retailer')
  })

  it('restores an account from the device after a reload', async () => {
    stubFetch(() => json(accountPair('a-1', 'r-1')))
    const storage = memoryTokenStorage(DEVICE)
    await client(storage).signIn({ username: 'ramesh.shop', password: 'OwnWay2468' })
    const reloaded = client(storage)
    const state = reloaded.session.getSnapshot()
    expect(state.session).toBeNull()
    expect(state.account?.user.username).toBe('ramesh.shop')
    expect(state.hydrating).toBe(true)
  })

  it('leaves a distributor, then takes the fresh pair the server moved this device to', async () => {
    const calls = stubFetch((call) => {
      if (call.path === '/auth/login') return json(shopPair('a-1', 'r-1'))
      if (call.path === '/auth/joins/leave') return json({ ok: true })
      if (call.path === '/auth/refresh') return json(accountPair('a-2', 'r-2'))
      return json({}, 404)
    })
    const c = client()
    await c.signIn({ username: 'ramesh.shop', password: 'OwnWay2468' })
    await c.leaveDistributor(TENANT)
    expect(calls.map((x) => x.path)).toEqual(['/auth/login', '/auth/joins/leave', '/auth/refresh'])
    expect(calls[1]?.authorization).toBe('Bearer a-1')
    expect(calls[1]?.body).toMatchObject({ tenantId: TENANT })
    expect(c.session.getSnapshot().account?.user.id).toBe(USER)
    expect(c.session.getSnapshot().session).toBeNull()
  })
})
