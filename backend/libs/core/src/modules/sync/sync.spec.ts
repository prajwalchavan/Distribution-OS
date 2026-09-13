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

/**
 * The note that makes the stand-in fail the way a row policy does (DOS-166): Drizzle wraps the driver
 * error, so SQLSTATE 42501 arrives on `cause.code`, exactly as `platform/pg-errors.ts` reads it.
 */
const REFUSED_BY_POLICY = 'refused-by-policy'

/** A stand-in for a real module: accepts `visits` rows, rejects any with an empty note as a business error. */
@Injectable()
class FakeVisitsSync implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    this.registry.register(
      'visits',
      async (_tx, op) => {
        if (op.op !== 'DELETE' && !op.data?.note)
          throw new SyncRejection('note_required', 'Visit note is required', 'विज़िट नोट ज़रूरी है')
        if (op.data?.note === REFUSED_BY_POLICY)
          throw new Error('Failed query: insert into "visits" ...', {
            cause: Object.assign(
              new Error('new row violates row-level security policy for table "visits"'),
              { code: '42501' },
            ),
          })
      },
      { standsFor: ['retailers.visits.record'] },
    )
    // The pull side: the tenant's beats since the cursor, through the generic table reader. A rep is
    // deliberately denied one column here (`area`) so the specs can prove that a column a role does
    // not RECEIVE is also a column its manifest never PUBLISHES — the phone has nowhere to put it.
    this.registry.registerPull(
      'beats',
      tablePull(beats, { omit: (role) => (role === 'salesperson' ? ['area'] : []) }),
    )
    // A table only the desk holds on its device.
    this.registry.registerPull('desk_only', {
      roles: ['owner', 'manager'],
      handler: async () => ({ rows: [{ id: 'x' }], at: [''], deleted: [], deletedAt: [] }),
      describe: () => [{ name: 'id', type: 'string', nullable: false }],
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

  it('publishes a device schema that matches what pull actually sends, and a version that moves with the role', async () => {
    type Manifest = {
      protocol: number
      schemaVersion: string
      changed: boolean
      role: string
      tables: {
        table: string
        primaryKey: string[]
        columns: { name: string; type: string; nullable: boolean }[]
        writable: boolean
      }[]
      asOf: string
    }
    const repManifest = await call<Manifest>(app, rep, 'GET', '/sync/manifest')
    expect(repManifest.status).toBe(200)
    expect(repManifest.body.role).toBe('salesperson')
    expect(repManifest.body.protocol).toBe(1)
    // First run: the device stored nothing, so the schema is "changed" and must be created.
    expect(repManifest.body.changed).toBe(true)

    // The manifest names exactly the tables `pull` serves this role — not one more, or the phone
    // creates a local table nothing ever fills.
    const pulled = await call<{ changes: { table: string }[] }>(app, rep, 'GET', '/sync/pull', {
      deviceId,
    })
    expect(repManifest.body.tables.map((t) => t.table).sort()).toEqual(
      pulled.body.changes.map((c) => c.table).sort(),
    )
    expect(repManifest.body.tables.map((t) => t.table)).not.toContain('desk_only')

    // ...and exactly the columns those rows carry. `beats` strips `area` for a rep, so the manifest
    // strips it too: there is one `omit` behind both halves.
    const beatsManifest = repManifest.body.tables.find((t) => t.table === 'beats')
    expect(beatsManifest?.primaryKey).toEqual(['id'])
    expect(beatsManifest?.writable).toBe(false) // no upload handler for beats: download-only
    const beatsColumns = (beatsManifest?.columns ?? []).map((c) => c.name).sort()
    const beatsRow = pulled.body.changes.find((c) => c.table === 'beats') as unknown as {
      rows: Record<string, unknown>[]
    }
    expect(Object.keys(beatsRow.rows[0] ?? {}).sort()).toEqual(beatsColumns)
    expect(beatsColumns).not.toContain('area')
    // The types come from the schema: a paise/integer column is `integer`, a timestamp is a string.
    const byName = new Map((beatsManifest?.columns ?? []).map((c) => [c.name, c]))
    expect(byName.get('id')?.type).toBe('string')
    expect(byName.get('active')).toEqual({ name: 'active', type: 'boolean', nullable: false })
    expect(byName.get('visit_days')?.type).toBe('object')
    expect(byName.get('updated_at')?.type).toBe('string')

    // A device that sends back the version it holds is told nothing changed — that is the whole point
    // of the field, and it is what stops an app start from dropping a full local database.
    const again = await call<Manifest>(app, rep, 'GET', '/sync/manifest', {
      knownSchemaVersion: repManifest.body.schemaVersion,
    })
    expect(again.body.changed).toBe(false)
    expect(again.body.schemaVersion).toBe(repManifest.body.schemaVersion)

    // The manager holds a table the rep does not AND the column the rep is denied, so the two roles
    // must not share a schema version — a hash over the tables alone would tell the second phone its
    // stale schema is still good.
    const deskManifest = await call<Manifest>(app, manager, 'GET', '/sync/manifest')
    expect(deskManifest.body.role).toBe('manager')
    expect(deskManifest.body.tables.map((t) => t.table)).toContain('desk_only')
    expect(
      deskManifest.body.tables.find((t) => t.table === 'beats')?.columns.map((c) => c.name),
    ).toContain('area')
    expect(deskManifest.body.schemaVersion).not.toBe(repManifest.body.schemaVersion)

    // ...and it is a read like any other: anonymous is 401, never the 404 an unimplemented
    // contract procedure answers (that is exactly how this gap was found).
    expect((await call(app, null, 'GET', '/sync/manifest')).status).toBe(401)
  })

  it('DOS-166: answers a row policy refusal (42501) inside a handler as a not_permitted rejection, never a 500', async () => {
    // A policy that refuses THIS actor refuses this device's op; retrying it can never succeed. As a 5xx it
    // rolled the whole batch back, wrote no sync_ops row and wedged the queue behind it (the warehouse probe,
    // QA/evidence/batch2/sync-role-probe 03). It must be a durable 2xx rejection like any business refusal.
    const opId = `op-42501-${run}`
    const batch = {
      protocol: 1,
      deviceId,
      ops: [{ opId, op: 'PUT', table: 'visits', id: uuidv7(), data: { note: REFUSED_BY_POLICY } }],
    }
    type Upload = {
      accepted: number
      replayed: number
      rejected: { opId: string; code: string; messageEn: string }[]
    }
    const res = await call<Upload>(app, rep, 'POST', '/sync/upload', batch)
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(0)
    expect(res.body.rejected.map((r) => [r.opId, r.code])).toEqual([[opId, 'not_permitted']])

    const ops = (
      await db.execute(
        sql`select outcome from sync_ops
             where tenant_id = ${tenantId} and device_id = ${deviceId} and op_id = ${opId}`,
      )
    ).rows as { outcome: { ok: boolean; rejection?: { code: string } } }[]
    expect(ops).toHaveLength(1)
    expect(ops[0]?.outcome.ok).toBe(false)
    expect(ops[0]?.outcome.rejection?.code).toBe('not_permitted')
    const tray = (
      await db.execute(
        sql`select user_id, code from sync_errors
             where tenant_id = ${tenantId} and device_id = ${deviceId} and op_id = ${opId}`,
      )
    ).rows
    expect(tray).toEqual([{ user_id: repId, code: 'not_permitted' }])

    // Durable: the retried batch replays the stored refusal instead of running the handler again.
    const again = await call<Upload>(app, rep, 'POST', '/sync/upload', batch)
    expect(again.status).toBe(200)
    expect(again.body.replayed).toBe(1)
    expect(again.body.rejected.map((r) => r.code)).toEqual(['not_permitted'])
  })

  it('DOS-080 a page holding a row with no instant (the desk_only stub) issues a cursor the next pull accepts', async () => {
    // A handler that cannot say WHEN its row changed stays outside the page budget, rides along on
    // every page, and never becomes the cursor: a cursor that is not a microsecond instant is one the
    // next call answers 400 on, and a device on a 400 never finishes its read set.
    type PullBody = {
      changes: { table: string; rows: Record<string, unknown>[] }[]
      cursor: string
      hasMore: boolean
    }
    const only = await call<PullBody>(app, manager, 'GET', '/sync/pull', {
      deviceId,
      'tables[0]': 'desk_only',
      limit: 1,
    })
    expect(only.status).toBe(200)
    expect(only.body.changes).toEqual([{ table: 'desk_only', rows: [{ id: 'x' }], deleted: [] }])
    const again = await call(app, manager, 'GET', '/sync/pull', {
      deviceId,
      'tables[0]': 'desk_only',
      since: only.body.cursor,
      limit: 1,
    })
    expect(again.status).toBe(200)

    // ...and beside a table that fills a one-row page, every cursor of the pass is accepted and the
    // pass delivers each beat once.
    const names = (
      (await db.execute(sql`select name from beats where tenant_id = ${tenantId}`)).rows as {
        name: string
      }[]
    ).map((r) => r.name)
    let since: string | undefined
    const seen: string[] = []
    for (let page = 1; ; page += 1) {
      expect(page, 'pages in the pass').toBeLessThanOrEqual(names.length + 2)
      const res = await call<PullBody>(app, manager, 'GET', '/sync/pull', {
        deviceId,
        'tables[0]': 'beats',
        'tables[1]': 'desk_only',
        limit: 1,
        ...(since === undefined ? {} : { since }),
      })
      expect(res.status, `page ${page}`).toBe(200)
      expect(res.body.changes.find((c) => c.table === 'desk_only')?.rows).toEqual([{ id: 'x' }])
      const beatRows = res.body.changes.find((c) => c.table === 'beats')?.rows ?? []
      seen.push(...beatRows.map((r) => String(r.name)))
      since = res.body.cursor
      if (!res.body.hasMore) break
    }
    expect(seen.sort()).toEqual(names.sort())
  })
})
