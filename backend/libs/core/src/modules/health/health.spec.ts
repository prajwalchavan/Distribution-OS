import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule } from '@orpc/nest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadDotenv } from '@dos/db'
import { DbModule } from '../../platform/index.js'
import { HealthModule } from './index.js'

// The repo-root .env is auto-loaded, so locally the DB is usually reachable; without it the process still answers.
loadDotenv()
const expectDb = process.env.DATABASE_URL ? 'up' : 'down'

describe('health', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ORPCModule.forRoot({}), DbModule, HealthModule],
    }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers /health and reports database reachability', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: expectDb === 'up', db: expectDb })
  })

  it('serves the oRPC contract route /health/ping', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ping' })
    expect(res.statusCode).toBe(200)
    const body: { ok: boolean; db: string; version: string } = res.json()
    expect(body.db).toBe(expectDb)
    expect(typeof body.version).toBe('string')
  })
})
