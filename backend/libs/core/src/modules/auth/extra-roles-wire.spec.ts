/**
 * docs/31 ruling B5 — extra roles on the wire, proven against the SEEDED person who has one.
 *
 * `pnpm db:seed` gives Dinesh Patil (`dinesh.patil`, warehouse at Tarsun) `extra_roles = {delivery}`:
 * he keeps the godown and drives the second van on Tuesdays (seed-demo/people.ts, `extraRolesFor`).
 * Before this ruling his sign-in answered `memberships[]` with `role: 'warehouse'` and nothing else,
 * so the one app's chooser (which lists `electableRoles(own, extraRoles)`) had a one-row list and never
 * opened — the verifier's major on `qa/one-app`. This spec signs him in for real and asserts the
 * field on every read that builds a membership summary: the login pair, `/auth/me`,
 * `/auth/memberships/summary`, and the pair a `switch-tenant` (the device's `electRole`) returns.
 *
 * A retailer membership answers `[]`: the contract refuses an extra role on a retailer before the
 * column is ever written, and the wire says so rather than leaving the field off.
 *
 * It needs the demo seed (CI runs `pnpm db:seed` before `pnpm test`); a database without Dinesh fails
 * loudly here rather than passing on an empty list.
 */
import { eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { createDb, createPool, memberships, users } from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call } from '../../testing/app.js'
import { AuthModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const DINESH = 'dinesh.patil'
const SHOP = 'ramesh.gupta'
const DEMO_PASSWORD = 'Dos@1234'

interface Summary {
  tenantId: string
  role: string
  extraRoles?: unknown
  status: string
}
interface Pair {
  accessToken: string
  refreshToken: string
  tenant: { id: string }
  role: string
  memberships: Summary[]
  message?: string
}
interface Me {
  tenant: { id: string } | null
  role: string | null
  memberships: Summary[]
}
interface Dues {
  items: { tenantId: string; role: string; extraRoles?: unknown }[]
}

describeDb('ruling B5: a membership’s extra roles travel with the sign-in (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  let app: NestFastifyApplication
  /** What the seed wrote for Dinesh, read straight off the row so the spec cannot drift from it. */
  let seeded: { tenantId: string; role: string; extraRoles: string[] }

  beforeAll(async () => {
    const [row] = await db
      .select({
        tenantId: memberships.tenantId,
        role: memberships.role,
        extraRoles: memberships.extraRoles,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.username, DINESH))
    if (!row) throw new Error(`${DINESH} is not in this database: run pnpm db:seed first`)
    seeded = row
    app = await bootTestApp([AuthModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const login = (username: string, extra: Record<string, unknown> = {}) =>
    call<Pair>(app, null, 'POST', '/auth/login', {
      username,
      password: DEMO_PASSWORD,
      deviceId: uuidv7(),
      deviceName: 'B5 spec phone',
      platform: 'android',
      ...extra,
    })

  async function bearer<T>(token: string, method: 'GET' | 'POST', path: string, payload?: object) {
    const res = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'POST' ? { payload: JSON.stringify(payload ?? {}) } : {}),
    })
    return { status: res.statusCode, body: res.json<T>() }
  }

  it('the seed itself still grants Dinesh an extra role, or this spec proves nothing', () => {
    expect(seeded.role).toBe('warehouse')
    expect(seeded.extraRoles).toEqual(['delivery'])
  })

  it('the login pair carries memberships[].extraRoles equal to the row', async () => {
    const res = await login(DINESH)
    expect(res.status).toBe(200)
    const mine = res.body.memberships.find((m) => m.tenantId === seeded.tenantId)
    expect(mine?.role).toBe(seeded.role)
    expect(mine?.extraRoles).toEqual(seeded.extraRoles)
  })

  it('/auth/me carries it on every membership', async () => {
    const res = await login(DINESH)
    const me = await bearer<Me>(res.body.accessToken, 'GET', '/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.memberships.find((m) => m.tenantId === seeded.tenantId)?.extraRoles).toEqual(
      seeded.extraRoles,
    )
    for (const m of me.body.memberships) expect(Array.isArray(m.extraRoles)).toBe(true)
  })

  it('/auth/memberships/summary carries it on the dues row', async () => {
    const res = await login(DINESH)
    const dues = await bearer<Dues>(res.body.accessToken, 'GET', '/auth/memberships/summary')
    expect(dues.status).toBe(200)
    expect(dues.body.items.find((m) => m.tenantId === seeded.tenantId)?.extraRoles).toEqual(
      seeded.extraRoles,
    )
  })

  it('switch-tenant — the device’s electRole — hands back a pair that carries it too', async () => {
    const device = uuidv7()
    const first = await login(DINESH, { deviceId: device })
    const switched = await call<Pair>(app, null, 'POST', '/auth/switch-tenant', {
      refreshToken: first.body.refreshToken,
      deviceId: device,
      tenantId: seeded.tenantId,
      actAs: 'delivery',
    })
    expect(switched.status).toBe(200)
    // The election is granted from the same column the wire now shows.
    expect(switched.body.role).toBe('delivery')
    const mine = switched.body.memberships.find((m) => m.tenantId === seeded.tenantId)
    expect(mine?.role).toBe('warehouse')
    expect(mine?.extraRoles).toEqual(['delivery'])
  })

  it('a retailer membership answers [] — present, and empty', async () => {
    const res = await login(SHOP)
    expect(res.status).toBe(200)
    expect(res.body.memberships.length).toBeGreaterThan(0)
    for (const m of res.body.memberships) {
      expect(m.role).toBe('retailer')
      expect(m.extraRoles).toEqual([])
    }
  })
})
