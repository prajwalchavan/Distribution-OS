import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createServiceApp } from '@dos/core'
import { bearer, describePermissionMatrix } from '@dos/core/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { service } from './service.js'

const tenantId = '00000000-0000-7000-8000-000000000000'
const actorId = '00000000-0000-7000-8000-000000000001'

type OpenApi = {
  info: { title: string; description: string }
  security: unknown[]
  components: { securitySchemes: Record<string, { type: string; scheme: string }> }
  paths: Record<string, Record<string, { security?: unknown[]; 'x-roles'?: unknown }>>
}

describe('owner-service', () => {
  let app: NestFastifyApplication
  beforeAll(async () => {
    app = await createServiceApp(service, { logger: false })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('answers /health and publishes its OpenAPI document with only its own routes', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    const docs = await app.inject({ method: 'GET', url: '/docs/openapi.json' })
    expect(docs.statusCode).toBe(200)
    const spec: OpenApi = docs.json()
    expect(spec.info.title).toContain('Owner service')
    expect(Object.keys(spec.paths)).toContain('/health/ping')
    const page = await app.inject({ method: 'GET', url: '/docs' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
  })

  it('documents bearer auth: securityScheme, x-roles per operation, no security on public routes', async () => {
    const spec: OpenApi = (await app.inject({ method: 'GET', url: '/docs/openapi.json' })).json()
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(spec.security).toEqual([{ bearerAuth: [] }])
    expect(spec.info.description).toContain('http://localhost:3000/auth/login')
    expect(spec.info.description).toContain('Authorization: Bearer')
    const ping = spec.paths['/health/ping']?.get
    expect(ping?.['x-roles']).toBe('public')
    expect(ping?.security).toEqual([])
    const me = spec.paths['/tenancy/me']?.get
    expect(Array.isArray(me?.['x-roles'])).toBe(true)
    expect(me?.['x-roles']).toContain('owner')
    expect(me?.security).toBeUndefined()
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation['x-roles'], `${method.toUpperCase()} ${path}`).toBeDefined()
      }
    }
  })

  it('refuses roles this service does not serve, before any business logic', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/tenancy/me' })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json<{ message: string }>().message).toBe('sign in required')

    const denied = await app.inject({
      method: 'GET',
      url: '/tenancy/me',
      headers: await bearer({ tenantId, actorId, role: 'retailer' }),
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json<{ message: string }>().message).toBe(
      'owner-service does not serve the retailer role',
    )

    const allowed = await app.inject({
      method: 'GET',
      url: '/tenancy/me',
      headers: await bearer({ tenantId, actorId, role: 'owner' }),
    })
    // The gate let the owner through; with no membership for the fake ids the handler itself answers 401 (oRPC).
    expect([200, 401]).toContain(allowed.statusCode)
    if (allowed.statusCode === 401) {
      expect(allowed.json<{ code?: string }>().code).toBe('UNAUTHORIZED')
    }
  })
})

describePermissionMatrix(service, () => createServiceApp(service, { logger: false }))
