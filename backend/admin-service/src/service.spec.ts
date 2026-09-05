import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createServiceApp } from '@dos/core'
import { bearer, describePermissionMatrix, platformBearer } from '@dos/core/testing'
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

describe('admin-service', () => {
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
    expect(spec.info.title).toContain('Admin console service')
    expect(Object.keys(spec.paths)).toContain('/health/ping')
    expect(Object.keys(spec.paths)).toContain('/admin/tenants')
    // The console serves ONLY its own key: nothing a distributor's app calls is published here.
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/orders'))).toBe(false)
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/tenancy'))).toBe(false)
    const page = await app.inject({ method: 'GET', url: '/docs' })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
  })

  it('documents bearer auth and x-roles on every operation', async () => {
    const spec: OpenApi = (await app.inject({ method: 'GET', url: '/docs/openapi.json' })).json()
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(spec.security).toEqual([{ bearerAuth: [] }])
    expect(spec.info.description).toContain('/auth/platform/login')
    const tenantsList = spec.paths['/admin/tenants']?.get
    expect(tenantsList?.['x-roles']).toEqual(['platform_admin'])
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation['x-roles'], `${method.toUpperCase()} ${path}`).toBeDefined()
      }
    }
  })

  /**
   * The founder's isolation rule, at the gate: a distributor's own manager — or owner, or anybody
   * else with a membership — is refused before a handler runs, and the sentence says why. The full
   * seven-role sweep over all fifteen procedures is `describePermissionMatrix` below.
   */
  it('refuses a manager token, and every other membership role, before any business logic', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/admin/tenants' })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json<{ message: string }>().message).toBe('sign in required')

    for (const role of ['manager', 'owner', 'accountant', 'retailer'] as const) {
      const denied = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: await bearer({ tenantId, actorId, role }),
      })
      expect(denied.statusCode, role).toBe(403)
      expect(denied.json<{ message: string }>().message).toBe(
        `admin-service does not serve the ${role} role`,
      )
    }
  })

  it('lets a platform token through the gate', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: await platformBearer(actorId),
    })
    // The gate passed; with no seeded administrator behind this fake id the handler itself refuses.
    expect([200, 403]).toContain(allowed.statusCode)
    if (allowed.statusCode === 403) {
      expect(allowed.json<{ message: string }>().message).toContain('console account')
    }
  })

  /**
   * A support pass is for a DISTRIBUTOR's service. Presented here it is refused, because the role it
   * acts as (`owner`) is one this service does not serve — the same check, read the other way round.
   */
  it('refuses a support pass on the console itself', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: {
        ...(await platformBearer(actorId)),
        'x-support-grant': 'not-a-real-pass',
      },
    })
    expect(res.statusCode).toBe(403)
  })
})

describePermissionMatrix(service, () => createServiceApp(service, { logger: false }))
