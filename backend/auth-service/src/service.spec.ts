import { randomUUID } from 'node:crypto'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createServiceApp } from '@dos/core'
import { createDb, createPool, hashPassword, memberships, tenants, users } from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { service } from './service.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describe('auth-service', () => {
  let app: NestFastifyApplication
  beforeAll(async () => {
    app = await createServiceApp(service, { logger: false })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('answers /health and publishes an OpenAPI document with the sign-in routes', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    const docs = await app.inject({ method: 'GET', url: '/docs/openapi.json' })
    expect(docs.statusCode).toBe(200)
    const spec: { paths: Record<string, unknown>; info: { title: string } } = docs.json()
    expect(spec.info.title).toContain('Auth service')
    const paths = Object.keys(spec.paths)
    expect(paths).toContain('/health/ping')
    expect(paths).toContain('/auth/login')
    expect(paths).toContain('/auth/refresh')
    expect(paths).toContain('/.well-known/jwks.json')
    expect(paths).not.toContain('/tenancy/me')
    const page = await app.inject({ method: 'GET', url: '/docs' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
  })

  it('serves the public keys and refuses token-bearing procedures without a token', async () => {
    const jwks = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })
    expect(jwks.statusCode).toBe(200)
    const body: { keys: { kid: string; d?: string }[] } = jwks.json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]?.d).toBeUndefined()
    const me = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(me.statusCode).toBe(401)
    const sessions = await app.inject({
      method: 'GET',
      url: '/auth/sessions',
      headers: { authorization: 'Bearer definitely.not.a.token' },
    })
    expect(sessions.statusCode).toBe(401)
  })

  describeDb('sign-in against the database', () => {
    const pool = createPool(url ?? '')
    const db = createDb(pool)
    const run = String(Date.now()).slice(-8)
    const tenantId = randomUUID()
    const userId = randomUUID()
    const deviceId = randomUUID()
    const username = `smoke.${run}`
    const password = 'Smoke1234'

    beforeAll(async () => {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `auth-smoke-${run}`,
        legalName: 'Auth smoke tenant',
        stateCode: '27',
      })
      await db.insert(users).values({
        id: userId,
        phone: `+919${run}9`,
        name: 'Smoke User',
        username,
        passwordHash: await hashPassword(password),
      })
      await db.insert(memberships).values({ id: randomUUID(), tenantId, userId, role: 'warehouse' })
    })

    afterAll(async () => {
      await pool.end()
    })

    it('logs a fixture user in and answers /auth/me with the access token', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username, password, deviceId, platform: 'web' }),
      })
      expect(login.statusCode).toBe(200)
      const pair: {
        accessToken: string
        refreshToken: string
        role: string
        tenant: { id: string }
      } = login.json()
      expect(pair.role).toBe('warehouse')
      expect(pair.tenant.id).toBe(tenantId)

      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${pair.accessToken}` },
      })
      expect(me.statusCode).toBe(200)
      const body: { user: { id: string; username: string }; role: string } = me.json()
      expect(body.user.id).toBe(userId)
      expect(body.user.username).toBe(username)
      expect(body.role).toBe('warehouse')

      const wrong = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username, password: 'Wrong1234', deviceId }),
      })
      expect(wrong.statusCode).toBe(401)
      const counted = await pool.query<{ failed_login_count: number }>(
        'select failed_login_count from users where id = $1',
        [userId],
      )
      expect(counted.rows[0]?.failed_login_count).toBe(1)
    })
  })
})
