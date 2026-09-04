import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule } from '@orpc/nest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HealthModule } from './index.js'

describe('health', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ORPCModule.forRoot({}), HealthModule],
    }).compile()
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers /health without a database (db down, process up)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, db: 'down' })
  })

  it('serves the oRPC contract route /health/ping', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ping' })
    expect(res.statusCode).toBe(200)
    const body: { ok: boolean; db: string; version: string } = res.json()
    expect(body.db).toBe('down')
    expect(typeof body.version).toBe('string')
  })
})
