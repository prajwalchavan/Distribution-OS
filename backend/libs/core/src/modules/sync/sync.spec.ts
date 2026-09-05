import { Injectable, Module, type OnModuleInit } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { beats, createDb, createPool, memberships, tenants, users } from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { SyncModule, SyncRegistry, SyncRejection, tablePull } from './index.js'

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
    // The pull side: the tenant's beats since the cursor, through the generic table reader.
    this.registry.registerPull('beats', { handler: tablePull(beats) })
    // A table only the desk holds on its device.
    this.registry.registerPull('desk_only', {
      roles: ['owner', 'manager'],
      handler: async () => ({ rows: [{ id: 'x' }], deleted: [] }),
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
  const otherRepId = uuidv7()
  const managerId = uuidv7()
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const otherRep: Actor = { tenantId, actorId: otherRepId, role: 'salesperson' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `sync-${run}`, legalName: 'Sync test', stateCode: '27' })
    await db.insert(users).values([
      { id: repId, phone: `+91902${run}1`, name: 'Rep' },
      { id: otherRepId, phone: `+91902${run}2`, name: 'Other rep' },
      { id: managerId, phone: `+91902${run}3`, name: 'Manager' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: otherRepId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
    ])
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

  it('lists the rejections back for the Needs-attention tray: own rows for a rep, everyone for the desk', async () => {
    const mine = await call<{
      items: { opId: string; table: string; code: string; resolved: boolean; deviceId: string }[]
      nextCursor: string | null
    }>(app, rep, 'GET', '/sync/errors', { deviceId })
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThanOrEqual(2)
    expect(mine.body.items.map((i) => i.code).sort()).toEqual(
      expect.arrayContaining(['note_required', 'unknown_table']),
    )
    expect(mine.body.items.every((i) => i.deviceId === deviceId && !i.resolved)).toBe(true)
    // another rep sees nothing of it (the handler forces user_id = actor; RLS agrees)
    const theirs = await call<{ items: unknown[] }>(app, otherRep, 'GET', '/sync/errors', {
      deviceId,
    })
    expect(theirs.body.items).toEqual([])
    // the desk sees it for support triage, and pages
    const desk = await call<{ items: unknown[]; nextCursor: string | null }>(
      app,
      manager,
      'GET',
      '/sync/errors',
      {
        deviceId,
        limit: 1,
      },
    )
    expect(desk.body.items).toHaveLength(1)
    expect(desk.body.nextCursor).not.toBeNull()
    expect((await call(app, null, 'GET', '/sync/errors')).status).toBe(401)
  })

  it('pulls the device read set since a cursor, per role, never 4xx on an empty delta', async () => {
    await db.insert(beats).values({ id: uuidv7(), tenantId, name: `Beat ${run}`, visitDays: [] })
    const full = await call<{
      changes: { table: string; rows: Record<string, unknown>[] }[]
      cursor: string
      hasMore: boolean
      asOf: string
    }>(app, rep, 'GET', '/sync/pull', { deviceId })
    expect(full.status).toBe(200)
    const beatsChange = full.body.changes.find((c) => c.table === 'beats')
    expect(beatsChange?.rows.some((r) => r.name === `Beat ${run}`)).toBe(true)
    // a rep does not receive the desk-only table; the manager does
    expect(full.body.changes.find((c) => c.table === 'desk_only')).toBeUndefined()
    const desk = await call<{ changes: { table: string }[] }>(app, manager, 'GET', '/sync/pull', {
      deviceId,
    })
    expect(desk.body.changes.map((c) => c.table)).toContain('desk_only')
    expect(full.body.cursor.length).toBeGreaterThan(10)
    expect(full.body.hasMore).toBe(false)

    // the delta: the cursor sits five seconds behind `asOf` (rows committed by a transaction that
    // started earlier are still caught), so a row that is seconds old may come again — the device
    // upserts by id. What must never come back is a row older than the overlap.
    const delta = await call<{
      changes: { table: string; rows: Record<string, unknown>[] }[]
      cursor: string
    }>(app, rep, 'GET', '/sync/pull', { deviceId, since: full.body.cursor })
    expect(delta.status).toBe(200)
    const sinceMs = Date.parse(full.body.asOf) - 5_000
    for (const row of delta.body.changes.find((c) => c.table === 'beats')?.rows ?? [])
      expect(Date.parse(String(row.updated_at))).toBeGreaterThan(sinceMs)
    // a change after the cursor comes through on the next delta
    await new Promise((r) => setTimeout(r, 20))
    await db.insert(beats).values({ id: uuidv7(), tenantId, name: `Beat ${run} B`, visitDays: [] })
    const next = await call<{ changes: { table: string; rows: Record<string, unknown>[] }[] }>(
      app,
      rep,
      'GET',
      '/sync/pull',
      {
        deviceId,
        since: full.body.cursor,
      },
    )
    const rows = next.body.changes.find((c) => c.table === 'beats')?.rows ?? []
    expect(rows.some((r) => r.name === `Beat ${run} B`)).toBe(true)
    // a cursor this server never issued is a clear 400, and `tables` narrows the pull
    expect((await call(app, rep, 'GET', '/sync/pull', { deviceId, since: 'garbage' })).status).toBe(
      400,
    )
    const narrowed = await call<{ changes: { table: string }[] }>(app, rep, 'GET', '/sync/pull', {
      deviceId,
      'tables[0]': 'nope',
    })
    expect(narrowed.body.changes).toEqual([])
  })
})
