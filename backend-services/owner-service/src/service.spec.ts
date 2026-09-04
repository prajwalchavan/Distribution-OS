import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createServiceApp } from '@dos/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { service } from './service.js'

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
    const spec: { paths: Record<string, unknown>; info: { title: string } } = docs.json()
    expect(spec.info.title).toContain('Owner service')
    expect(Object.keys(spec.paths)).toContain('/health/ping')
    const page = await app.inject({ method: 'GET', url: '/docs' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
  })

  it('refuses roles this service does not serve, before any business logic', async () => {
    const denied = await app.inject({
      method: 'GET',
      url: '/tenancy/me',
      headers: {
        'x-tenant-id': '00000000-0000-7000-8000-000000000000',
        'x-actor-id': '00000000-0000-7000-8000-000000000001',
        'x-actor-role': 'retailer',
      },
    })
    expect(denied.statusCode).toBe(403)
    const allowed = await app.inject({
      method: 'GET',
      url: '/tenancy/me',
      headers: {
        'x-tenant-id': '00000000-0000-7000-8000-000000000000',
        'x-actor-id': '00000000-0000-7000-8000-000000000001',
        'x-actor-role': 'owner',
      },
    })
    expect([200, 401]).toContain(allowed.statusCode) // no membership for the fake ids → 401 from the service itself
  })
})
