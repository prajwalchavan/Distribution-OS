import { Injectable, Module, type OnModuleInit } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { createDb, createPool, memberships, tenants, users } from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { SyncModule, SyncRegistry, SyncRejection } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** A stand-in for a real module: accepts `visits` rows, rejects any with an empty note as a business error. */
@Injectable()
class FakeVisitsSync implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    this.registry.register('visits', async (_tx, op) => {
      if (op.op !== 'DELETE' && !op.data?.note)
        throw new SyncRejection('note_required', 'Visit note is required', 'विज़िट नोट ज़रूरी है')
    })
  }
}
@Module({ providers: [FakeVisitsSync] })
class FakeModule {}

describeDb('sync upload (ADR 0007)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const repId = uuidv7()
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `sync-${run}`, legalName: 'Sync test', stateCode: '27' })
    await db.insert(users).values({ id: repId, phone: `+91902${run}1`, name: 'Rep' })
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId, userId: repId, role: 'salesperson' })
    app = await bootTestApp([SyncModule, FakeModule])
  })
  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const deviceId = `device-${run}`
  const good = {
    opId: `op1-${run}`,
    op: 'PUT',
    table: 'visits',
    id: uuidv7(),
    data: { note: 'ordered' },
  }
  const bad = { opId: `op2-${run}`, op: 'PUT', table: 'visits', id: uuidv7(), data: {} }
  const unknown = { opId: `op3-${run}`, op: 'PUT', table: 'nope', id: uuidv7(), data: {} }

  it('accepts good ops, rejects bad ones with 2xx + sync_errors, and never 4xx', async () => {
    const res = await call<{
      accepted: number
      rejected: { opId: string; code: string }[]
      replayed: number
    }>(app, rep, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [good, bad, unknown],
    })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(1)
    expect(res.body.rejected.map((r) => r.code).sort()).toEqual(['note_required', 'unknown_table'])
    const errs = (
      await db.execute(
        sql`select code from sync_errors where tenant_id = ${tenantId} order by code`,
      )
    ).rows as { code: string }[]
    expect(errs.map((e) => e.code)).toEqual(['note_required', 'unknown_table'])
  })

  it('replays a retried batch from sync_ops without re-running handlers', async () => {
    const res = await call<{ accepted: number; rejected: unknown[]; replayed: number }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      { protocol: 1, deviceId, ops: [good, bad, unknown] },
    )
    expect(res.status).toBe(200)
    expect(res.body.replayed).toBe(3)
    expect(res.body.accepted).toBe(1)
    const errs = (
      await db.execute(
        sql`select count(*)::int as n from sync_errors where tenant_id = ${tenantId}`,
      )
    ).rows as { n: number }[]
    expect(errs[0]?.n).toBe(2) // no duplicate error rows
  })

  it('answers 2xx with upgradeRequired for an old protocol', async () => {
    const res = await call<{ upgradeRequired: boolean; rejected: unknown[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      { protocol: 0, deviceId, ops: [good] },
    )
    expect(res.status).toBe(200)
    expect(res.body.upgradeRequired).toBe(true)
    expect(res.body.rejected).toHaveLength(1)
  })

  it('flags clock skew as a warning, not a rejection', async () => {
    const res = await call<{ accepted: number; warnings: { code: string }[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId,
        ops: [
          {
            ...good,
            opId: `op4-${run}`,
            clientTime: new Date(Date.now() - 3_600_000).toISOString(),
          },
        ],
      },
    )
    expect(res.body.accepted).toBe(1)
    expect(res.body.warnings[0]?.code).toBe('clock_skew')
  })
})
