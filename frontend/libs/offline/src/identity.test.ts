/**
 * DOS-167 — a device store belongs to one person in one distributorship (docs/27 §13, tests 12-16).
 *
 * The finding (S-98 probe, V5A and V5C): the offline copy was ONE file per app. The next person who signed in on a phone
 * inherited the last person's shops, orders, dues and sync cursor, and after a restart a rep of another distributor was
 * shown Tarsun's customer book for the moment before the manifest handshake re-snapshotted.
 *
 * Most tests here run on `fixedStoreFactory`, which hands back the SAME store whatever file name is asked for. That is
 * the one shape in which two identities can still meet on one database (a wrong-name bug, a test's fixed store), so
 * the file name cannot help and what is proved is the stamp checked at open and the sign-out that ends the engine.
 */
import { describe, expect, it } from 'vitest'

import { ERRORS_CHANNEL, OUTBOX_CHANNEL } from './bus.js'
import { legacyStoreName, storeNameFor, SyncEngine, type SyncEngineOptions } from './engine.js'
import { leaveDecision } from './react.js'
import { OUTBOX_TABLE, SYNC_ERRORS_TABLE } from './schema.js'
import { readAllState, readState } from './state.js'
import { openExpoSqlite, type ExpoDatabaseLike, type ExpoSqliteLike } from './store/expo-sqlite.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, tableManifest } from './test-support.js'
import type { StoreFactory, SyncIdentity, SyncStore, SyncTransport } from './types.js'
import type { PullOutput } from './wire.js'

const RETAILERS = tableManifest('retailers', [
  column('id'),
  column('name'),
  column('beat_id'),
  column('updated_at'),
])

const ORDERS = tableManifest(
  'sales_orders',
  [column('id'), column('retailer_id'), column('state'), column('updated_at')],
  { writable: true },
)

const TABLES = [RETAILERS, ORDERS]

/** The people of the probe: two reps of one distributor, and a rep of another. */
const RAHUL: SyncIdentity = { userId: 'rahul', tenantId: 'tarsun', role: 'salesperson' }
const AMIT: SyncIdentity = { userId: 'amit', tenantId: 'tarsun', role: 'salesperson' }
const KIRAN: SyncIdentity = { userId: 'kiran', tenantId: 'sai', role: 'salesperson' }

/** Rahul's shop, never on Amit's beat and never Sai's. */
const CHAVAN = { id: 'r-chavan', name: 'Chavan Kirana Stores' }

const now = (): number => Date.parse('2026-09-13T12:00:00.000Z')

function engineAs(
  identity: SyncIdentity,
  store: SyncStore,
  transport: SyncTransport,
  extra: Partial<SyncEngineOptions> = {},
): SyncEngine {
  return new SyncEngine({
    transport,
    deviceId: 'device-1',
    storeFactory: fixedStoreFactory(store),
    pullIntervalMs: 0,
    identity,
    now,
    ...extra,
  })
}

/** The transport, with the order in which calls ANSWERED written down. */
function recording(server: FakeServer, order: string[]): SyncTransport {
  const base = server.transport()
  return {
    ...base,
    manifest: async (input) => {
      const out = await base.manifest(input)
      order.push('manifest')
      return out
    },
    pull: async (input) => {
      const out = await base.pull(input)
      order.push('pull')
      return out
    },
    upload: async (input) => {
      const out = await base.upload(input)
      order.push('upload')
      return out
    },
  }
}

function page(id: string, cursor: string, hasMore: boolean): PullOutput {
  return {
    changes: [{ table: 'retailers', rows: [{ id, name: id }], deleted: [] }],
    cursor,
    hasMore,
    asOf: '2026-09-13T12:00:00.000Z',
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// 12 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 one file per app, person and distributor', () => {
  it('DOS-167 storeNameFor keys the file by app, user and distributor', () => {
    const rahul = storeNameFor('dos-sales', RAHUL)
    expect(rahul).toBe('dos-sales__u-rahul__t-tarsun.db')

    // A colleague at the same distributor, and the same rep at another one, each get their own file.
    expect(storeNameFor('dos-sales', AMIT)).not.toBe(rahul)
    expect(storeNameFor('dos-sales', { ...RAHUL, tenantId: 'sai' })).not.toBe(rahul)
    expect(storeNameFor('dos-delivery', RAHUL)).not.toBe(rahul)
    // The same pair is the same file: a role change on one membership is not a new person.
    expect(storeNameFor('dos-sales', { ...RAHUL, role: 'delivery' })).toBe(rahul)

    const real = storeNameFor('dos-warehouse', {
      userId: '0192f3c4-8a1b-7c2d-9e3f-4a5b6c7d8e9f',
      tenantId: '0192f3c4-0000-7000-8000-0000000000aa',
      role: 'warehouse',
    })
    for (const name of [rahul, real]) expect(name).toMatch(/^[A-Za-z0-9_.-]+$/)

    // A file name never carries an unchecked string.
    expect(() => storeNameFor('dos-sales', { ...RAHUL, userId: 'a/b' })).toThrow()
    expect(() => storeNameFor('dos-sales', { ...RAHUL, userId: '../rahul' })).toThrow()
    expect(() => storeNameFor('dos-sales', { ...RAHUL, tenantId: 'tarsun:sai' })).toThrow()
    expect(() => storeNameFor('dos-sales', { ...RAHUL, userId: '' })).toThrow()
    expect(() => storeNameFor('dos/sales', RAHUL)).toThrow()

    // The fixed name every build before DOS-167 used, which the provider deletes once.
    expect(legacyStoreName('dos-sales')).toBe('dos-sales.db')
  })

  it("DOS-167 a second user on the same store never renders the first user's rows and starts with no cursor", async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const rahul = engineAs(RAHUL, store, server.transport())
    await rahul.start()
    expect(await rahul.queryTable('retailers')).toHaveLength(1)
    await rahul.stop()

    // Amit signs in on the same phone in a dead spot: no handshake can run, so only the device decides.
    server.offline = true
    const amit = engineAs(AMIT, store, server.transport())
    await amit.start()
    const beforeHandshake = {
      rows: await amit.queryTable('retailers'),
      count: await amit.countRows('retailers'),
      cursor: await readState(store, 'cursor'),
      schemaVersion: await readState(store, 'schemaVersion'),
    }

    server.offline = false
    server.pulls = []
    server.queuePull({ changes: [], cursor: 'c-amit' })
    await amit.sync('again')
    const firstHandshake = {
      knownSchemaVersion: server.manifestCalls.at(-1)?.knownSchemaVersion,
      since: server.pullCalls.at(-1)?.since,
    }

    expect({ beforeHandshake, firstHandshake }).toEqual({
      beforeHandshake: { rows: [], count: 0, cursor: null, schemaVersion: null },
      // A full snapshot of his own beat, not Rahul's delta.
      firstHandshake: { knownSchemaVersion: undefined, since: undefined },
    })
    await amit.stop()
  })

  it('DOS-167 another distributor after a restart is wiped before any shape is restored and its queue never leaves', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const rahul = engineAs(RAHUL, store, server.transport())
    await rahul.start()
    server.offline = true
    await rahul.enqueue({
      table: 'sales_orders',
      id: 'o-rahul',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id },
    })
    await rahul.flush()
    expect(rahul.status().pending).toBe(1)
    await rahul.stop()

    // The app is restarted and Kiran of Sai Distributors signs in, online.
    server.offline = false
    server.pulls = []
    server.queuePull({ changes: [], cursor: 'c-kiran' })
    const pullsBefore = server.pullCalls.length
    const log: string[] = []
    const kiran = engineAs(KIRAN, store, server.transport(), {
      onLog: (line) => {
        log.push(line)
      },
    })
    // What a mounted list draws the instant it is told a table changed. The memory store runs the SELECT
    // synchronously, so each entry is the table as it stood at that emission.
    const painted: { tables: string[]; retailers: string[] }[] = []
    const reads: Promise<void>[] = []
    kiran.onTables((tables) => {
      reads.push(
        kiran.queryTable<{ id: string }>('retailers').then((rows) => {
          painted.push({ tables: [...tables].sort(), retailers: rows.map((row) => row.id) })
        }),
      )
    })
    await kiran.start()
    // What the foreground poll would do next.
    await kiran.flush()
    await Promise.all(reads)

    expect({
      told: painted.length > 0,
      paintedWithRows: painted.filter((paint) => paint.retailers.length > 0),
      uploaded: server.uploadCalls.flatMap((call) => call.ops.map((op) => op.id)),
      outbox: (await kiran.outbox()).map((op) => op.rowId),
      pulled: server.pullCalls.length > pullsBefore,
      firstPullSince: server.pullCalls[pullsBefore]?.since,
      wipeLogged: log.some((line) => line.includes('belonged to another identity')),
    }).toEqual({
      told: true,
      paintedWithRows: [],
      uploaded: [],
      outbox: [],
      pulled: true,
      firstPullSince: undefined,
      wipeLogged: true,
    })
    await kiran.stop()
  })

  it('DOS-167 the same identity keeps its rows, cursor and queue across a restart', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const first = engineAs(RAHUL, store, server.transport())
    await first.start()
    server.offline = true
    const opId = await first.enqueue({
      table: 'sales_orders',
      id: 'o-rahul',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id },
    })
    await first.flush()
    await first.stop()

    // docs/27 §14: the phone was restarted, not handed over. Everything stays.
    server.offline = false
    const pullsBefore = server.pullCalls.length
    const restarted = engineAs(RAHUL, store, server.transport())
    const painted: string[][] = []
    const reads: Promise<void>[] = []
    restarted.onTables(() => {
      reads.push(
        restarted.queryTable<{ id: string }>('retailers').then((rows) => {
          painted.push(rows.map((row) => row.id))
        }),
      )
    })
    await restarted.start()
    await Promise.all(reads)

    // The first thing the device publishes, before the handshake has answered, already holds his shops.
    expect(painted[0]).toEqual([CHAVAN.id])
    expect(server.pullCalls[pullsBefore]?.since).toBe('c1')
    expect((await restarted.outbox()).map((op) => [op.opId, op.status])).toEqual([[opId, 'queued']])
    await restarted.flush()
    expect(server.uploadCalls.at(-1)?.ops.map((op) => op.opId)).toEqual([opId])
    await restarted.stop()
  })

  /*
   * The stamp must not do the manifest's job badly. The session's role is fresh from the auth service, the
   * stored one is what the last handshake published; writing the first over the second at open would make
   * them agree before the manifest compares them, and a role changed on the server with an identical hash
   * would keep the old role's rows.
   */
  it('DOS-167 the stamp at open never hides a role change on the same membership from the manifest', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES, 'salesperson', 'v1')
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const asRep = engineAs(RAHUL, store, server.transport())
    await asRep.start()
    expect(await asRep.queryTable('retailers')).toHaveLength(1)
    await asRep.stop()

    // The owner made Rahul a delivery hand on the same membership; the role's tables hash the same.
    server.setManifest(TABLES, 'v1', 'delivery')
    server.pulls = []
    server.queuePull({ changes: [], cursor: 'c-delivery' })
    const pullsBefore = server.pullCalls.length
    const asCrew = engineAs({ ...RAHUL, role: 'delivery' }, store, server.transport())
    await asCrew.start()

    expect(await asCrew.queryTable('retailers')).toEqual([])
    expect(server.pullCalls[pullsBefore]?.since).toBeUndefined()
    expect(await readState(store, 'role')).toBe('delivery')
    await asCrew.stop()
  })

  /*
   * Ruling (o). The stamp is checked before a shape is restored, but the store used to be handed to the engine
   * before the check: `outbox()` and `needsAttention()` have no shape to gate them, and `useOutbox` asks the
   * moment the provider sets the engine, while `start()` is still opening.
   */
  it('DOS-167 outbox() and needsAttention() answer nothing until the identity is claimed', async () => {
    // Amit's file, holding an order he queued and one the office refused.
    const inner = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.offline = true
    const amit = engineAs(AMIT, inner, server.transport())
    await amit.start()
    await amit.stop()
    await inner.exec(
      `INSERT INTO ${OUTBOX_TABLE} (op_id, tbl, row_id, op, data, idempotency_key, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'op-amit',
        'sales_orders',
        'o-amit',
        'PUT',
        '{}',
        'op-amit',
        'queued',
        0,
        '2026-09-13T11:00:00.000Z',
      ],
    )
    await inner.exec(
      `INSERT INTO ${SYNC_ERRORS_TABLE} (op_id, tbl, row_id, code, message, created_at, discarded_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        'op-amit-refused',
        'sales_orders',
        'o-amit-refused',
        'credit_hold',
        'Shop is on credit hold',
        '2026-09-13T11:00:00.000Z',
      ],
    )

    // Rahul's engine is handed that file, and reading whose it is takes a moment.
    let openDoor = (): void => {}
    const door = new Promise<void>((resolve) => {
      openDoor = resolve
    })
    let firstStateRead = true
    const store: SyncStore = {
      persistent: inner.persistent,
      kind: inner.kind,
      exec: (sql, params) => inner.exec(sql, params),
      async query<T>(sql: string, params?: Parameters<SyncStore['exec']>[1]): Promise<T[]> {
        if (firstStateRead && sql.includes('_sync_state')) {
          firstStateRead = false
          await door
        }
        return inner.query<T>(sql, params)
      },
      transaction: (fn) => inner.transaction(fn),
      close: () => inner.close(),
    }
    const rahul = engineAs(RAHUL, store, server.transport())
    const starting = rahul.start()
    await sleep(0)

    const duringClaim = {
      outbox: (await rahul.outbox()).map((op) => op.opId),
      needsAttention: (await rahul.needsAttention()).map((item) => item.error.opId),
      pending: rahul.status().pending,
    }
    openDoor()
    await starting
    const afterClaim = {
      outbox: (await rahul.outbox()).map((op) => op.opId),
      needsAttention: (await rahul.needsAttention()).map((item) => item.error.opId),
    }

    expect({ duringClaim, afterClaim }).toEqual({
      duringClaim: { outbox: [], needsAttention: [], pending: 0 },
      // The foreign file was wiped at the claim.
      afterClaim: { outbox: [], needsAttention: [] },
    })
    await rahul.stop()
  })
})

// 13 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 sign-out ends the engine', () => {
  it('DOS-167 end() at sign-out with nothing queued drops the read set, emits every table and destroys the store', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const engine = engineAs(RAHUL, store, server.transport())
    await engine.start()
    expect(engine.status()).toMatchObject({ pending: 0, rejected: 0 })

    const told = new Set<string>()
    engine.onTables((tables) => {
      for (const table of tables) told.add(table)
    })
    await engine.end({ keepQueue: false })

    // A mounted list is told its table is gone, rather than keeping Rahul's rows in its state.
    expect([...told]).toEqual(
      expect.arrayContaining(['retailers', 'sales_orders', OUTBOX_CHANNEL, ERRORS_CHANNEL]),
    )
    // The provider's cleanup stops the engine after sign-out; that is a no-op now.
    await expect(engine.stop()).resolves.toBeUndefined()
    // The file itself is gone.
    await expect(store.query('SELECT * FROM "retailers"')).rejects.toThrow(/no such table/)
    await expect(readAllState(store)).rejects.toThrow(/no such table/)

    // The same person signing in again finds nothing and starts cleanly.
    server.offline = true
    const again = engineAs(RAHUL, store, server.transport())
    await again.start()
    expect(again.tables()).toEqual([])
    expect(await again.queryTable('retailers')).toEqual([])
    expect(await readAllState(store)).toEqual({
      deviceId: 'device-1',
      userId: RAHUL.userId,
      tenantId: RAHUL.tenantId,
      role: RAHUL.role,
    })
    server.offline = false
    server.pulls = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c2',
    })
    const pullsBefore = server.pullCalls.length
    await again.sync('signed-in-again')
    expect(server.pullCalls[pullsBefore]?.since).toBeUndefined()
    expect(await again.queryTable('retailers')).toHaveLength(1)
    await again.stop()
  })

  it('DOS-167 end() keeps the queue for the same person only', async () => {
    /** Rahul has one order refused by the office and one taken in a dead spot, and signs out keeping them. */
    async function rahulSignsOutKeepingHisQueue(): Promise<{
      store: SyncStore
      server: FakeServer
      order: string[]
      queuedOpId: string
    }> {
      const store = createMemoryStore()
      const server = new FakeServer(TABLES)
      const order: string[] = []
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      const rahul = engineAs(RAHUL, store, recording(server, order))
      await rahul.start()
      server.rejections.set('op-refused', {
        code: 'credit_hold',
        messageEn: 'Shop is on credit hold',
      })
      await rahul.enqueue({
        table: 'sales_orders',
        id: 'o-refused',
        op: 'PUT',
        data: { retailer_id: CHAVAN.id },
        opId: 'op-refused',
      })
      await rahul.flush()
      server.offline = true
      const queuedOpId = await rahul.enqueue({
        table: 'sales_orders',
        id: 'o-queued',
        op: 'PUT',
        data: { retailer_id: CHAVAN.id },
      })
      await rahul.flush()
      expect(rahul.status()).toMatchObject({ pending: 1, rejected: 1 })

      await rahul.end({ keepQueue: true })
      server.offline = false
      return { store, server, order, queuedOpId }
    }

    const kept = await rahulSignsOutKeepingHisQueue()
    // The read set is gone...
    await expect(kept.store.query('SELECT * FROM "retailers"')).rejects.toThrow(/no such table/)
    await expect(kept.store.query('SELECT * FROM "sales_orders"')).rejects.toThrow(/no such table/)
    expect(await readState(kept.store, 'cursor')).toBeNull()
    expect(await readState(kept.store, 'manifest')).toBeNull()
    // ...the queue, the tray mirror and whose file it is are not.
    expect(
      await kept.store.query<{ op_id: string; status: string }>(
        `SELECT op_id, status FROM ${OUTBOX_TABLE} ORDER BY seq`,
      ),
    ).toEqual([
      { op_id: 'op-refused', status: 'rejected' },
      { op_id: kept.queuedOpId, status: 'queued' },
    ])
    expect(await kept.store.query(`SELECT op_id FROM ${SYNC_ERRORS_TABLE}`)).toEqual([
      { op_id: 'op-refused' },
    ])
    expect(await readState(kept.store, 'userId')).toBe(RAHUL.userId)

    // Rahul signs in again: his order goes out FIRST, then his snapshot comes down.
    const mark = kept.order.length
    const pullsBefore = kept.server.pullCalls.length
    kept.server.pulls = []
    kept.server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c2',
    })
    const back = engineAs(RAHUL, kept.store, recording(kept.server, kept.order))
    await back.start()
    expect(kept.order.slice(mark)).toEqual(['manifest', 'upload', 'pull'])
    expect(kept.server.uploadCalls.at(-1)?.ops.map((op) => op.opId)).toEqual([kept.queuedOpId])
    expect(kept.server.pullCalls[pullsBefore]?.since).toBeUndefined()
    expect(back.status()).toMatchObject({ pending: 0, rejected: 1 })
    await back.stop()

    // Instead, a colleague signs in on that phone: nothing of Rahul's is sent under his token.
    const other = await rahulSignsOutKeepingHisQueue()
    const uploadsBefore = other.server.uploadCalls.length
    const amit = engineAs(AMIT, other.store, other.server.transport())
    await amit.start()
    await amit.flush()
    expect(other.server.uploadCalls).toHaveLength(uploadsBefore)
    expect(await amit.outbox()).toEqual([])
    expect(amit.status()).toMatchObject({ pending: 0, rejected: 0 })
    await amit.stop()
  })

  it('DOS-167 end() is safe under a running pull and upload', async () => {
    for (const keepQueue of [false, true]) {
      const store = createMemoryStore()
      const server = new FakeServer(TABLES)
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      const base = server.transport()
      let pullGate: Promise<void> | null = null
      let openPull = (): void => {}
      const transport: SyncTransport = {
        ...base,
        pull: async (input) => {
          if (pullGate !== null) await pullGate
          return base.pull(input)
        },
      }
      const engine = engineAs(RAHUL, store, transport)
      await engine.start()

      // A three-page delta on its way down and an order batch in the air when the rep taps Sign out.
      server.pulls = [page('r-p1', 'p1', true), page('r-p2', 'p2', true), page('r-p3', 'p3', false)]
      pullGate = new Promise<void>((resolve) => {
        openPull = resolve
      })
      const releaseUpload = server.hold()
      await engine.enqueue({
        table: 'sales_orders',
        id: 'o-in-the-air',
        op: 'PUT',
        data: { retailer_id: CHAVAN.id },
      })
      const pulling = engine.sync('delta')
      await sleep(0)

      const ending = engine.end({ keepQueue })
      releaseUpload()
      setTimeout(() => {
        openPull()
      }, 10)
      await expect(ending).resolves.toEqual({ kept: keepQueue, pending: 0, rejected: 0 })
      await expect(pulling).resolves.toBeUndefined()
      await sleep(30)

      // The batch went once and is not sent again; the delta stopped at the page that was in the air.
      expect(server.uploadCalls).toHaveLength(1)
      expect(server.pullCalls).toHaveLength(2)
      // Nothing landed after the drop.
      await expect(store.query('SELECT * FROM "retailers"')).rejects.toThrow(/no such table/)
      if (keepQueue) {
        expect(await readState(store, 'cursor')).toBeNull()
        expect(await readState(store, 'lastPulledAt')).toBeNull()
      } else {
        await expect(readAllState(store)).rejects.toThrow(/no such table/)
      }
    }
  })

  /*
   * Ruling (m). The one-tap sign-out counted nothing waiting and called end(); end() then waited for a pull already
   * in the air, and an order taken in that window landed in the outbox and was deleted with the file (verifier probe,
   * 2026-09-13). From the tap on, a write is REFUSED with a sentence: never saved, so never deleted.
   */
  it('DOS-167 a write that begins after end() has begun is refused and never deleted', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const base = server.transport()
    let pullGate: Promise<void> | null = null
    let openPull = (): void => {}
    const engine = engineAs(RAHUL, store, {
      ...base,
      pull: async (input) => {
        if (pullGate !== null) await pullGate
        return base.pull(input)
      },
    })
    await engine.start()

    // The poll's pull hangs in a dead spot; Rahul taps Sign out with nothing waiting.
    pullGate = new Promise<void>((resolve) => {
      openPull = resolve
    })
    server.queuePull({ changes: [], cursor: 'c2' })
    const pulling = engine.sync('poll')
    await sleep(0)
    const counted = await engine.waiting()
    const ending = engine.end({ keepQueue: false })

    // Before the sign-out has finished he submits an order for Chavan Kirana, and the rest of the writes try too.
    const outcome = (write: Promise<unknown>): Promise<unknown> =>
      write.then(
        (value) => ({ resolved: value ?? null }),
        (error: unknown) => {
          const { name, code, message } = error as {
            name?: unknown
            code?: unknown
            message?: unknown
          }
          return { name, code, message }
        },
      )
    const whileEnding = {
      enqueue: await outcome(
        engine.enqueue({
          table: 'sales_orders',
          id: 'o-late',
          op: 'PUT',
          data: { retailer_id: CHAVAN.id },
        }),
      ),
      recordGpsPoint: await outcome(
        engine.recordGpsPoint({ tripId: 't-1', lat: 19.24, lng: 73.13 }),
      ),
      retry: await outcome(engine.retry('x')),
      discard: await outcome(engine.discard('x')),
    }
    const pendingWhileEnding = engine.status().pending

    openPull()
    const ended = await ending
    await pulling
    const afterEnd = await outcome(
      engine.enqueue({ table: 'sales_orders', id: 'o-later', op: 'PUT', data: {} }),
    )

    const REFUSED = {
      name: 'SyncEngineEndedError',
      code: 'ended',
      message:
        'This phone is signing out; nothing more can be saved on it. Sign in again and enter it once more.',
    }
    expect({
      counted,
      whileEnding,
      pendingWhileEnding,
      ended,
      uploaded: server.uploadCalls,
      afterEnd,
    }).toEqual({
      counted: { pending: 0, rejected: 0 },
      whileEnding: { enqueue: REFUSED, recordGpsPoint: REFUSED, retry: REFUSED, discard: REFUSED },
      pendingWhileEnding: 0,
      ended: { kept: false, pending: 0, rejected: 0 },
      uploaded: [],
      // Not "has not started yet": the same sentence once the sign-out is over.
      afterEnd: REFUSED,
    })
    // Nothing was kept, so the file is gone.
    await expect(store.query(`SELECT * FROM ${OUTBOX_TABLE}`)).rejects.toThrow(/no such table/)
  })

  it('DOS-167 a write in hand when end() begins is finished, counted and kept for that person', async () => {
    /**
     * Rahul submits an order; it is inside its transaction (a slow disk) when he taps Sign out with nothing waiting,
     * and the sign-out is given every chance to run ahead of it.
     */
    async function inHandAtTheTap(): Promise<{
      store: SyncStore
      server: FakeServer
      order: string[]
      written: { opId: string } | { error: string }
      ended: unknown
    }> {
      const inner = createMemoryStore()
      let door: Promise<void> | null = null
      const store: SyncStore = {
        persistent: inner.persistent,
        kind: inner.kind,
        exec: (sql, params) => inner.exec(sql, params),
        query: <T>(sql: string, params?: Parameters<SyncStore['exec']>[1]): Promise<T[]> =>
          inner.query<T>(sql, params),
        transaction: async (fn) => {
          if (door !== null) await door
          return inner.transaction(fn)
        },
        close: () => inner.close(),
        destroy: () => inner.destroy?.() ?? Promise.resolve(),
      }
      const server = new FakeServer(TABLES)
      const order: string[] = []
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      const rahul = engineAs(RAHUL, store, recording(server, order))
      await rahul.start()

      let openDoor = (): void => {}
      door = new Promise<void>((resolve) => {
        openDoor = resolve
      })
      const writing = rahul.enqueue({
        table: 'sales_orders',
        id: 'o-in-hand',
        op: 'PUT',
        data: { retailer_id: CHAVAN.id },
      })
      await sleep(0)
      const ending = rahul.end({ keepQueue: false })
      await sleep(0)
      door = null
      openDoor()
      const written = await writing.then(
        (opId) => ({ opId }),
        (error: unknown) => ({ error: String(error) }),
      )
      const ended = await ending
      return { store, server, order, written, ended }
    }

    const kept = await inHandAtTheTap()
    const opId = 'opId' in kept.written ? kept.written.opId : null
    expect({ written: opId === null ? kept.written : 'landed', ended: kept.ended }).toEqual({
      written: 'landed',
      ended: { kept: true, pending: 1, rejected: 0 },
    })
    // The order is in the file, for Rahul; his read set is not.
    expect(
      await kept.store.query<{ op_id: string; status: string }>(
        `SELECT op_id, status FROM ${OUTBOX_TABLE}`,
      ),
    ).toEqual([{ op_id: opId, status: 'queued' }])
    await expect(kept.store.query('SELECT * FROM "retailers"')).rejects.toThrow(/no such table/)
    expect(await readState(kept.store, 'userId')).toBe(RAHUL.userId)
    expect(await readState(kept.store, 'cursor')).toBeNull()

    // Rahul signs in again on this phone: the order goes out first, then his snapshot comes down.
    const mark = kept.order.length
    kept.server.pulls = []
    kept.server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c2',
    })
    const back = engineAs(RAHUL, kept.store, recording(kept.server, kept.order))
    await back.start()
    expect(kept.order.slice(mark)).toEqual(['manifest', 'upload', 'pull'])
    expect(kept.server.uploadCalls.at(-1)?.ops.map((op) => op.opId)).toEqual([opId])
    await back.stop()

    // Instead, Amit signs in on that phone: nothing of Rahul's is sent under his token.
    const other = await inHandAtTheTap()
    const uploadsBefore = other.server.uploadCalls.length
    const amit = engineAs(AMIT, other.store, other.server.transport())
    await amit.start()
    await amit.flush()
    expect(other.server.uploadCalls).toHaveLength(uploadsBefore)
    expect(await amit.outbox()).toEqual([])
    await amit.stop()

    // A moment earlier: the order landed between the tap's count and end(), and the upload failed in the dead spot.
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const rahul = engineAs(RAHUL, store, server.transport())
    await rahul.start()
    server.offline = true
    const counted = await rahul.waiting()
    const landed = await rahul.enqueue({
      table: 'sales_orders',
      id: 'o-landed',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id },
    })
    await rahul.flush()
    const ended = await rahul.end({ keepQueue: false })
    expect({ counted, ended }).toEqual({
      counted: { pending: 0, rejected: 0 },
      ended: { kept: true, pending: 1, rejected: 0 },
    })
    expect(
      await store.query<{ op_id: string; status: string }>(
        `SELECT op_id, status FROM ${OUTBOX_TABLE}`,
      ),
    ).toEqual([{ op_id: landed, status: 'queued' }])
  })
})

// 14 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 the other distributorships of the person signing out', () => {
  it("DOS-167 sweepIdentityStores deletes a sibling identity's empty store and keeps one with a queue", async () => {
    const files = new Map<string, SyncStore>()
    const factory: StoreFactory = async (name) => {
      const held = files.get(name) ?? createMemoryStore()
      files.set(name, held)
      return held
    }
    const AT_SAI: SyncIdentity = { ...RAHUL, tenantId: 'sai' }
    const AT_BALAJI: SyncIdentity = { ...RAHUL, tenantId: 'balaji' }
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const options = (identity: SyncIdentity): SyncEngineOptions => ({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: factory,
      databaseName: storeNameFor('dos-sales', identity),
      identity,
      pullIntervalMs: 0,
      now,
    })

    // At Sai everything reached the office; at Balaji one order is still waiting.
    const sai = new SyncEngine(options(AT_SAI))
    await sai.start()
    await sai.stop()
    const balaji = new SyncEngine(options(AT_BALAJI))
    await balaji.start()
    server.offline = true
    await balaji.enqueue({ table: 'sales_orders', id: 'o-balaji', op: 'PUT', data: {} })
    await balaji.flush()
    await balaji.stop()
    server.offline = false

    const result = await SyncEngine.sweepIdentityStores(factory, 'dos-sales', [AT_SAI, AT_BALAJI])

    expect(result).toEqual({ destroyed: 1, kept: [{ identity: AT_BALAJI, pending: 1 }] })
    // Sai's file is emptied, as a deleted file would be.
    const saiFile = files.get(storeNameFor('dos-sales', AT_SAI))
    await expect(saiFile?.query('SELECT * FROM _sync_state')).rejects.toThrow(/no such table/)
    // Balaji's still holds the order for Rahul's next sign-in there.
    const balajiFile = files.get(storeNameFor('dos-sales', AT_BALAJI))
    expect(await balajiFile?.query(`SELECT row_id, status FROM ${OUTBOX_TABLE}`)).toEqual([
      { row_id: 'o-balaji', status: 'queued' },
    ])
  })
})

// 15 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 the SQLite file itself', () => {
  function fakeSqlite(options: { canDelete: boolean; closeError?: Error; deleteError?: Error }): {
    calls: string[]
    sqlite: ExpoSqliteLike
  } {
    const calls: string[] = []
    const db: ExpoDatabaseLike = {
      execAsync: async () => {},
      runAsync: async () => undefined,
      getAllAsync: async <T>() => [] as T[],
      withTransactionAsync: async (fn) => {
        await fn()
      },
      closeAsync: async () => {
        calls.push('closeAsync')
        if (options.closeError !== undefined) throw options.closeError
      },
    }
    const sqlite: ExpoSqliteLike = {
      openDatabaseAsync: async () => db,
      ...(options.canDelete
        ? {
            deleteDatabaseAsync: async (name: string) => {
              calls.push(`deleteDatabaseAsync ${name}`)
              if (options.deleteError !== undefined) throw options.deleteError
            },
          }
        : {}),
    }
    return { calls, sqlite }
  }

  it("DOS-167 the SQLite adapter's destroy closes then deletes the file by name", async () => {
    const name = storeNameFor('dos-sales', { userId: 'a', tenantId: 't1', role: 'salesperson' })
    expect(name).toBe('dos-sales__u-a__t-t1.db')

    const phone = fakeSqlite({ canDelete: true })
    const store = await openExpoSqlite(phone.sqlite, name, 'sqlite-native')
    await store.destroy?.()
    expect(phone.calls).toEqual(['closeAsync', 'deleteDatabaseAsync dos-sales__u-a__t-t1.db'])

    // A module without deleteDatabaseAsync only closes.
    const older = fakeSqlite({ canDelete: false })
    await (await openExpoSqlite(older.sqlite, name, 'sqlite-web')).destroy?.()
    expect(older.calls).toEqual(['closeAsync'])

    // end() closes before it destroys: the file is not closed twice, and one that is already gone is no error.
    const closedFirst = fakeSqlite({
      canDelete: true,
      deleteError: new Error(`Database '${name}' not found`),
    })
    const closed = await openExpoSqlite(closedFirst.sqlite, name, 'sqlite-native')
    await closed.close()
    await expect(closed.destroy?.()).resolves.toBeUndefined()
    expect(closedFirst.calls).toEqual(['closeAsync', `deleteDatabaseAsync ${name}`])

    const closedElsewhere = fakeSqlite({
      canDelete: true,
      closeError: new Error('Access to closed resource'),
    })
    const elsewhere = await openExpoSqlite(closedElsewhere.sqlite, name, 'sqlite-native')
    await expect(elsewhere.destroy?.()).resolves.toBeUndefined()
    expect(closedElsewhere.calls).toEqual(['closeAsync', `deleteDatabaseAsync ${name}`])

    // Anything else is a real failure and says so.
    const open = fakeSqlite({
      canDelete: true,
      deleteError: new Error(`Unable to delete database '${name}' that is currently open`),
    })
    await expect(
      (await openExpoSqlite(open.sqlite, name, 'sqlite-native')).destroy?.(),
    ).rejects.toThrow(/Unable to delete/)
  })
})

// 16 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 the sign-out rule', () => {
  it('DOS-167 leaveDecision asks only when something is queued or rejected', () => {
    expect(leaveDecision({ pending: 0, rejected: 0 })).toBe('leave')
    expect(leaveDecision({ pending: 1, rejected: 0 })).toBe('ask')
    expect(leaveDecision({ pending: 0, rejected: 1 })).toBe('ask')
  })

  it('DOS-167 a sign-out tapped while the store is still opening counts the file, not the snapshot, and asks', async () => {
    // Rahul took an order in a dead spot and signed out keeping it on this phone (founder answer A).
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const rahul = engineAs(RAHUL, store, server.transport())
    await rahul.start()
    server.offline = true
    const opId = await rahul.enqueue({
      table: 'sales_orders',
      id: 'o-dead-spot',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id },
    })
    await rahul.flush()
    await rahul.end({ keepQueue: true })

    // He signs in again on a phone that takes a moment to open the file, as OPFS and expo-sqlite do, and
    // the account menu is already on the screen.
    let open = (): void => {}
    const opening = new Promise<void>((resolve) => {
      open = resolve
    })
    const back = engineAs(RAHUL, store, server.transport(), {
      storeFactory: async () => {
        await opening
        return store
      },
    })
    const starting = back.start()

    // The status snapshot has counted nothing yet. A sign-out decided on it took the one-tap path and
    // deleted the order with no sheet (verifier probe, 2026-09-13).
    expect(back.status()).toMatchObject({ ready: false, pending: 0, rejected: 0 })
    expect(leaveDecision(back.status())).toBe('leave')

    // What the sign-out reads instead waits for the open and counts the file.
    const counting = back.waiting()
    open()
    const counts = await counting
    expect(counts).toEqual({ pending: 1, rejected: 0 })
    expect(leaveDecision(counts)).toBe('ask')
    expect(back.status()).toMatchObject({ ready: true, pending: 1 })
    expect(
      await store.query<{ op_id: string; status: string }>(
        `SELECT op_id, status FROM ${OUTBOX_TABLE}`,
      ),
    ).toEqual([{ op_id: opId, status: 'queued' }])
    await starting
    await back.stop()

    // A file that never opens is never waited on for ever: there is nothing in it to count or delete.
    const broken = engineAs(RAHUL, createMemoryStore(), server.transport(), {
      storeFactory: async () => {
        throw new Error('OPFS is not available in this browser')
      },
    })
    await expect(broken.start()).rejects.toThrow(/OPFS/)
    await expect(broken.waiting()).resolves.toEqual({ pending: 0, rejected: 0 })
  })
})
