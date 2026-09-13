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
import {
  interimStoreName,
  legacyStoreName,
  parseStoreName,
  storeNameFor,
  SyncEngine,
  type SyncEngineOptions,
} from './engine.js'
import { leaveDecision, sweepInterimStore } from './react.js'
import { createSystemTables, OUTBOX_TABLE, SYNC_ERRORS_TABLE } from './schema.js'
import { readAllState, readState, writeState } from './state.js'
import { openExpoSqlite, type ExpoDatabaseLike, type ExpoSqliteLike } from './store/expo-sqlite.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, tableManifest } from './test-support.js'
import type { EnqueueInput, StoreFactory, SyncIdentity, SyncStore, SyncTransport } from './types.js'
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

/**
 * Where a test needs a FILE NAME, the ids are UUIDs, as every id in this system is (ruling 2 (s)): Rahul and Tarsun
 * as the QA data gives them, and the other people and distributors made up in the same shape.
 */
const RAHUL_ID = '8760e17e-4830-7395-a946-1e02fffa1ad7'
const TARSUN_ID = '01a09a5b-3c58-71c1-a34d-b93c569b0099'
const AMIT_ID = '0192f3c4-8a1b-7c2d-9e3f-4a5b6c7d8e9f'
const SAI_ID = '82f5c562-b7eb-7521-8e19-4aa6befc64f8'
const BALAJI_ID = '0192f3c4-0000-7000-8000-0000000000aa'
const RAHUL_AT_TARSUN: SyncIdentity = { userId: RAHUL_ID, tenantId: TARSUN_ID, role: 'salesperson' }

/** 128-bit ids across the whole range, the same ones on every run. */
function spreadOfUuids(count: number): string[] {
  let seed = 0x1a2b3c4d
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
  return Array.from({ length: count }, () => {
    const hex = Array.from({ length: 4 }, () => next().toString(16).padStart(8, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  })
}

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

/** A store whose `close` is counted and may wait, and whose `query` may wait at a door first. */
function watched(
  inner: SyncStore,
  hooks: {
    closed?: { count: number }
    closeWaits?: Promise<void>
    beforeQuery?: (sql: string) => Promise<void>
  } = {},
): SyncStore {
  return {
    persistent: inner.persistent,
    kind: inner.kind,
    exec: (sql, params) => inner.exec(sql, params),
    async query<T>(sql: string, params?: Parameters<SyncStore['exec']>[1]): Promise<T[]> {
      if (hooks.beforeQuery !== undefined) await hooks.beforeQuery(sql)
      return inner.query<T>(sql, params)
    },
    transaction: (fn) => inner.transaction(fn),
    async close(): Promise<void> {
      if (hooks.closed !== undefined) hooks.closed.count += 1
      if (hooks.closeWaits !== undefined) await hooks.closeWaits
      await inner.close()
    },
  }
}

// 12 -------------------------------------------------------------------------------------------------------------

describe('DOS-167 one file per app, person and distributor', () => {
  /*
   * Ruling 2 (s). The web proof of 199952b: `dos-sales__u-<uuid>__t-<uuid>.db` is 92 characters, expo-sqlite's web
   * build opens `./<name>` through wa-sqlite, whose VFS allows 64 characters of path and SQLite keeps 8 of them for
   * the journal suffix, so nothing longer than 54 opens — and the open fell back, silently, to a store in memory.
   */
  it('DOS-167 storeNameFor keys the file by app, user and distributor', () => {
    const rahul = storeNameFor('dos-sales', RAHUL_AT_TARSUN)
    expect(rahul).toBe('s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft')

    // Every name is one app letter and two 25-digit base-36 ids, which web SQLite opens, and reads back exactly.
    const ids = [
      ...spreadOfUuids(200),
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]
    const APPS = ['dos-sales', 'dos-delivery', 'dos-warehouse'] as const
    const wrong: unknown[] = []
    ids.forEach((userId, index) => {
      const tenantId = ids[ids.length - 1 - index] ?? userId
      const prefix = APPS[index % APPS.length] ?? 'dos-sales'
      const name = storeNameFor(prefix, { userId, tenantId, role: 'salesperson' })
      const back = parseStoreName(name)
      const fits = /^[sdw][0-9a-z]{50}$/.test(name) && `./${name}`.length <= 56
      if (!fits || back?.prefix !== prefix || back.userId !== userId || back.tenantId !== tenantId)
        wrong.push({ userId, tenantId, prefix, name, back })
    })
    expect(wrong).toEqual([])
    // A listing also holds `-wal` and `-shm` files and other apps' names: those are not store names.
    expect(parseStoreName(`${rahul}-wal`)).toBeNull()
    expect(parseStoreName('dos-sales.db')).toBeNull()

    // A colleague at the same distributor, the same rep at another one, and another app each get their own file.
    expect(storeNameFor('dos-sales', { ...RAHUL_AT_TARSUN, userId: AMIT_ID })).not.toBe(rahul)
    expect(storeNameFor('dos-sales', { ...RAHUL_AT_TARSUN, tenantId: SAI_ID })).not.toBe(rahul)
    expect(storeNameFor('dos-delivery', RAHUL_AT_TARSUN)).not.toBe(rahul)
    // The same pair is the same file: a role change on one membership is not a new person.
    expect(storeNameFor('dos-sales', { ...RAHUL_AT_TARSUN, role: 'delivery' })).toBe(rahul)
    // One case only, so no case-folding file system can take two people's files for one.
    expect(
      storeNameFor('dos-sales', {
        ...RAHUL_AT_TARSUN,
        userId: RAHUL_ID.toUpperCase(),
        tenantId: TARSUN_ID.toUpperCase(),
      }),
    ).toBe(rahul)

    // A file name never carries an unchecked string.
    for (const userId of ['a', 'a/b', '../rahul', ''])
      expect(() => storeNameFor('dos-sales', { ...RAHUL_AT_TARSUN, userId }), userId).toThrow()
    for (const prefix of ['dos/sales', 'dos-shop'])
      expect(() => storeNameFor(prefix, RAHUL_AT_TARSUN), prefix).toThrow()

    // The fixed name every build before DOS-167 used, which the provider deletes once.
    expect(legacyStoreName('dos-sales')).toBe('dos-sales.db')
  })

  /*
   * Ruling 2 (s). The QA phones hold files under the name 199952b gave them. The provider sweeps that file once for
   * the person signing in, by the sibling rule: nothing unsent in it and it goes; anything unsent and it stays, said.
   */
  it('DOS-167 the 199952b store is swept once for the signed-in person: deleted when empty, kept and logged with a queue', async () => {
    const interim = interimStoreName('dos-sales', RAHUL_AT_TARSUN)
    // What the Android proof listed on the Pixel 7 under 199952b.
    expect(interim).toBe(`dos-sales__u-${RAHUL_ID}__t-${TARSUN_ID}.db`)

    async function signsInAfter199952b(queued: boolean): Promise<unknown> {
      const files = new Map<string, SyncStore>()
      const asked: string[] = []
      const factory: StoreFactory = async (name) => {
        asked.push(name)
        const held = files.get(name) ?? createMemoryStore()
        files.set(name, held)
        return held
      }
      const server = new FakeServer(TABLES)
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      // The 199952b build, on its long name.
      const before = new SyncEngine({
        transport: server.transport(),
        deviceId: 'device-1',
        storeFactory: factory,
        databaseName: interim,
        identity: RAHUL_AT_TARSUN,
        pullIntervalMs: 0,
        now,
      })
      await before.start()
      if (queued) {
        server.offline = true
        await before.enqueue({
          table: 'sales_orders',
          id: 'o-before-ruling-2',
          op: 'PUT',
          data: { retailer_id: CHAVAN.id },
        })
        await before.flush()
      }
      await before.stop()
      // This build's own file for him, stamped already.
      const current = createMemoryStore()
      await createSystemTables(current)
      await writeState(current, 'userId', RAHUL_ID)
      files.set(storeNameFor('dos-sales', RAHUL_AT_TARSUN), current)

      asked.length = 0
      const log: string[] = []
      await sweepInterimStore(factory, 'dos-sales', RAHUL_AT_TARSUN, (line) => {
        log.push(line)
      })
      return {
        asked,
        log,
        // A deleted file has no tables left to read.
        interim: await files
          .get(interim)
          ?.query(`SELECT row_id, status FROM ${OUTBOX_TABLE}`)
          .catch((error: unknown) =>
            /no such table/.test(String(error)) ? 'deleted' : String(error),
          ),
        current: await readState(current, 'userId'),
      }
    }

    expect({
      empty: await signsInAfter199952b(false),
      holding: await signsInAfter199952b(true),
    }).toEqual({
      empty: {
        asked: [interim],
        log: [],
        interim: 'deleted',
        current: RAHUL_ID,
      },
      holding: {
        asked: [interim],
        log: ['offline: kept the store from before ruling 2'],
        interim: [{ row_id: 'o-before-ruling-2', status: 'queued' }],
        current: RAHUL_ID,
      },
    })
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

  it('DOS-167 an engine stopped while its store opens or is claimed closes that store and never attaches it', async () => {
    /*
     * Merge review, leak lens, blocker 1. The provider stops an engine the moment the session changes, and that can
     * land while the file is still opening — a cold start whose refresh token is dead, or the first OPFS open on web.
     * `stop()` found no store to close, so `start()` carried on: it attached the file to the stopped engine and ran
     * the handshake and the tray mirror through the one api client the app keeps — as whoever is signed in by then,
     * into this person's file — and nothing ever closed it (on a phone, a later delete fails "currently open").
     */
    const server = new FakeServer(TABLES)
    let errorsAsked = 0
    const transport: SyncTransport = {
      ...server.transport(),
      listErrors: async () => {
        errorsAsked += 1
        return { items: [], nextCursor: null }
      },
    }
    const writeAfterStop = (engine: SyncEngine): Promise<string> =>
      engine.enqueue({ table: 'sales_orders', id: 'o-after-stop', op: 'PUT', data: {} }).then(
        () => 'saved',
        (error: unknown) => (error as Error).message,
      )

    // Stopped while the claim reads whose file it is.
    const claimedFile = createMemoryStore()
    const claimedClosed = { count: 0 }
    let openDoor = (): void => {}
    const door = new Promise<void>((resolve) => {
      openDoor = resolve
    })
    let firstStateRead = true
    const duringClaim = engineAs(
      RAHUL,
      watched(claimedFile, {
        closed: claimedClosed,
        beforeQuery: async (sql) => {
          if (!firstStateRead || !sql.includes('_sync_state')) return
          firstStateRead = false
          await door
        },
      }),
      transport,
    )
    const startingClaim = duringClaim.start()
    await sleep(0)
    await duringClaim.stop()
    openDoor()
    await startingClaim

    // Stopped while the file itself opens.
    const openedFile = createMemoryStore()
    const openedClosed = { count: 0 }
    let finishOpen = (): void => {}
    const opening = new Promise<void>((resolve) => {
      finishOpen = resolve
    })
    const duringOpen = engineAs(RAHUL, openedFile, transport, {
      storeFactory: async () => {
        await opening
        return watched(openedFile, { closed: openedClosed })
      },
    })
    const startingOpen = duringOpen.start()
    await sleep(0)
    await duringOpen.stop()
    finishOpen()
    await startingOpen

    const NOT_STARTED = 'the sync engine has not started yet'
    expect({
      claim: {
        closed: claimedClosed.count,
        ready: duringClaim.status().ready,
        write: await writeAfterStop(duringClaim),
        manifest: await readState(claimedFile, 'manifest'),
        schemaVersion: await readState(claimedFile, 'schemaVersion'),
      },
      open: {
        closed: openedClosed.count,
        ready: duringOpen.status().ready,
        write: await writeAfterStop(duringOpen),
      },
      office: {
        manifest: server.manifestCalls.length,
        pull: server.pullCalls.length,
        errors: errorsAsked,
      },
    }).toEqual({
      claim: { closed: 1, ready: false, write: NOT_STARTED, manifest: null, schemaVersion: null },
      open: { closed: 1, ready: false, write: NOT_STARTED },
      office: { manifest: 0, pull: 0, errors: 0 },
    })
    // Nothing was written into the file that finished opening after the stop.
    await expect(openedFile.query(`SELECT * FROM ${OUTBOX_TABLE}`)).rejects.toThrow(/no such table/)
  })

  it('DOS-167 a stopped engine asks the office for nothing more: no tray after a page in flight, no handshake while it closes', async () => {
    /*
     * Merge review, leak lens, blocker 1 and the defect folded into it. A pull page in flight when the engine
     * stopped still came back to `pullErrors`, which asked `sync.errors.list`; a reconnect that landed while
     * `stop()` was closing the file ran a whole handshake. Both go through the one api client, whoever holds it.
     */
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })
    const base = server.transport()
    let errorsAsked = 0
    let pullGate: Promise<void> | null = null
    let openPull = (): void => {}
    const transport: SyncTransport = {
      ...base,
      pull: async (input) => {
        if (pullGate !== null) await pullGate
        return base.pull(input)
      },
      listErrors: async () => {
        errorsAsked += 1
        return { items: [], nextCursor: null }
      },
    }

    // A page in flight when the engine stops.
    const midPull = engineAs(RAHUL, createMemoryStore(), transport)
    await midPull.start()
    const errorsAtStart = errorsAsked
    pullGate = new Promise<void>((resolve) => {
      openPull = resolve
    })
    server.queuePull({ changes: [], cursor: 'c2' })
    const pulling = midPull.sync('poll')
    await sleep(0)
    await midPull.stop()
    openPull()
    await pulling
    const errorsAfterPage = errorsAsked
    pullGate = null

    // A reconnect while `stop()` is still closing the file.
    let releaseClose = (): void => {}
    const closeWaits = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const closing = engineAs(AMIT, watched(createMemoryStore(), { closeWaits }), transport)
    await closing.start()
    const handshakes = server.manifestCalls.length
    const stopping = closing.stop()
    const reconnect = closing.sync('reconnect')
    releaseClose()
    await stopping
    await reconnect

    expect({
      errorsAtStart,
      errorsAfterPage,
      handshakesWhileClosing: server.manifestCalls.length - handshakes,
    }).toEqual({ errorsAtStart: 1, errorsAfterPage: 1, handshakesWhileClosing: 0 })
  })

  /*
   * Ruling 2 (t). On the web proof of 199952b every open failed and `openStore` handed back a store in memory
   * without a word: the rep was told his order was kept on this phone while only the tab held it.
   */
  it('DOS-167 a memory store is announced at start and named in the status', async () => {
    const server = new FakeServer(TABLES)
    const said: { line: string; detail: unknown }[] = []
    const inMemory = engineAs(
      RAHUL,
      createMemoryStore({ wanted: 'sqlite-web', reason: 'open failed: sqlite3_open_v2' }),
      server.transport(),
      {
        onLog: (line, detail) => {
          said.push({ line, detail })
        },
      },
    )
    await inMemory.start()

    // A store that keeps, as expo-sqlite's is.
    const inner = createMemoryStore()
    const disk: SyncStore = {
      persistent: true,
      kind: 'sqlite-native',
      exec: (sql, params) => inner.exec(sql, params),
      query: <T>(sql: string, params?: Parameters<SyncStore['exec']>[1]): Promise<T[]> =>
        inner.query<T>(sql, params),
      transaction: (fn) => inner.transaction(fn),
      close: () => inner.close(),
    }
    const onDiskSaid: string[] = []
    const onDisk = engineAs(RAHUL, disk, server.transport(), {
      onLog: (line) => {
        onDiskSaid.push(line)
      },
    })
    await onDisk.start()

    expect({
      announced: said.filter(
        (entry) => entry.line === 'offline: no persistent store; running in memory',
      ),
      note: inMemory.status().storeNote,
      onDiskAnnounced: onDiskSaid.filter((line) => line.includes('no persistent store')),
      onDiskNote: onDisk.status().storeNote,
    }).toEqual({
      announced: [
        {
          line: 'offline: no persistent store; running in memory',
          detail: {
            name: 'dos-offline.db',
            fallback: { wanted: 'sqlite-web', reason: 'open failed: sqlite3_open_v2' },
          },
        },
      ],
      note: 'open failed: sqlite3_open_v2',
      onDiskAnnounced: [],
      onDiskNote: null,
    })
    await inMemory.stop()
    await onDisk.stop()
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

  /*
   * Ruling 2 (u). The order screen queued the header, then one enqueue per line. A sign-out that began between them
   * refused the lines after the header had landed, and the office got a draft with no lines (web V5E, S-120).
   */
  it('DOS-167 an order and its lines are queued whole or not at all', async () => {
    const ORDER_LINES = tableManifest(
      'sales_order_lines',
      [column('id'), column('order_id'), column('variant_id'), column('updated_at')],
      { writable: true },
    )
    const WITH_LINES = [...TABLES, ORDER_LINES]
    const header = {
      table: 'sales_orders',
      id: 'o-whole',
      op: 'PUT' as const,
      data: { retailer_id: CHAVAN.id, state: 'draft' },
    }
    const line = (n: number): EnqueueInput => ({
      table: 'sales_order_lines',
      id: `l-${String(n)}`,
      op: 'PUT',
      data: { order_id: 'o-whole', variant_id: `v-${String(n)}` },
    })
    const outcome = (write: Promise<unknown>): Promise<string> =>
      write.then(
        () => 'saved',
        (error: unknown) => `${(error as Error).name}: ${(error as Error).message}`,
      )

    // (1) Rahul has tapped Sign out, and a pull is still in the air: the whole order is refused.
    const signingOut = createMemoryStore()
    const signingOutServer = new FakeServer(WITH_LINES)
    signingOutServer.queuePull({ changes: [], cursor: 'c1' })
    const base = signingOutServer.transport()
    let pullGate: Promise<void> | null = null
    let openPull = (): void => {}
    const leaving = engineAs(RAHUL, signingOut, {
      ...base,
      pull: async (input) => {
        if (pullGate !== null) await pullGate
        return base.pull(input)
      },
    })
    await leaving.start()
    pullGate = new Promise<void>((resolve) => {
      openPull = resolve
    })
    const pulling = leaving.sync('poll')
    await sleep(0)
    const ending = leaving.end({ keepQueue: false })
    const refusedWhileEnding = await outcome(leaving.enqueueMany([header, line(1)]))
    const outboxWhileEnding = await signingOut.query(`SELECT op_id FROM ${OUTBOX_TABLE}`)
    openPull()
    await pulling
    const ended = await ending

    // (2) One line for a table this role may only read: nothing of the order is written.
    const readOnly = createMemoryStore()
    const readOnlyEngine = engineAs(RAHUL, readOnly, new FakeServer(WITH_LINES).transport())
    await readOnlyEngine.start()
    const refusedReadOnly = await outcome(
      readOnlyEngine.enqueueMany([
        header,
        line(1),
        { table: 'retailers', id: CHAVAN.id, op: 'PATCH', data: { name: 'Chavan Kirana' } },
      ]),
    )
    const readOnlyOutbox = await readOnly.query(`SELECT op_id FROM ${OUTBOX_TABLE}`)
    const readOnlyOrders = await readOnly.query('SELECT id FROM "sales_orders"')
    const readOnlyLines = await readOnly.query('SELECT id FROM "sales_order_lines"')
    await readOnlyEngine.stop()

    // (3) The whole order: three rows in call order, one message to every table it touched.
    const whole = createMemoryStore()
    const wholeServer = new FakeServer(WITH_LINES)
    const wholeEngine = engineAs(RAHUL, whole, wholeServer.transport())
    await wholeEngine.start()
    // The upload the write starts waits here, so nothing else is told meanwhile.
    const releaseUpload = wholeServer.hold()
    const told: string[][] = []
    wholeEngine.onTables((tables) => {
      told.push([...tables].sort())
    })
    const opIds = await wholeEngine.enqueueMany([header, line(1), line(2)])
    const rows = await whole.query<{ seq: number; op_id: string; tbl: string; row_id: string }>(
      `SELECT seq, op_id, tbl, row_id FROM ${OUTBOX_TABLE} ORDER BY seq`,
    )
    const toldOutbox = told.filter((tables) => tables.includes(OUTBOX_CHANNEL))
    const pending = wholeEngine.status().pending
    releaseUpload()
    await wholeEngine.flush()
    await wholeEngine.stop()

    expect({
      whileEnding: { refused: refusedWhileEnding, outbox: outboxWhileEnding, ended },
      readOnly: {
        refused: refusedReadOnly.includes('download-only'),
        outbox: readOnlyOutbox,
        orders: readOnlyOrders,
        lines: readOnlyLines,
      },
      whole: {
        sameOpIds: rows.map((row) => row.op_id).join() === opIds.join(),
        order: rows.map((row) => `${row.tbl} ${row.row_id}`),
        ascending: rows.every((row, index) => index === 0 || row.seq > (rows[index - 1]?.seq ?? 0)),
        toldOutbox,
        pending,
      },
    }).toEqual({
      whileEnding: {
        refused:
          'SyncEngineEndedError: This phone is signing out; nothing more can be saved on it. Sign in again and enter it once more.',
        outbox: [],
        ended: { kept: false, pending: 0, rejected: 0 },
      },
      readOnly: { refused: true, outbox: [], orders: [], lines: [] },
      whole: {
        sameOpIds: true,
        order: ['sales_orders o-whole', 'sales_order_lines l-1', 'sales_order_lines l-2'],
        ascending: true,
        toldOutbox: [[OUTBOX_CHANNEL, 'sales_order_lines', 'sales_orders']],
        pending: 3,
      },
    })
  })

  /*
   * Addendum (x). "Sign out, keep here" crashed the delivery app on Android (2 of 2) and Expo Go on iOS (2 of 2): SIGSEGV in
   * expo-sqlite's `exsqlite3_reset`. expo-sqlite's close finalizes every prepared statement and marks the database
   * closed only after `sqlite3_close` (SQLiteModule.kt `closeDatabase`), while a `runAsync` already on another
   * dispatcher thread passes that check and resets a statement that is gone. What was in flight: the reads the emit of
   * the dropped tables re-ran (`useOutbox`, `useNeedsAttention` query the moment they are told), and any read a screen
   * had started before the tap.
   */
  it('DOS-167 end() never lets a store call start or run after close begins', async () => {
    /** A store that answers on a later turn, as the native bridge does, and writes down what reached it against the close. */
    function bridged(inner: SyncStore): {
      store: SyncStore
      late: string[]
      order: string[]
      hold: (fragment: string) => () => void
    } {
      const late: string[] = []
      const order: string[] = []
      const holds: { fragment: string; door: Promise<void> }[] = []
      let closing = false
      const call = async <T>(sql: string, run: () => Promise<T>): Promise<T> => {
        if (closing) late.push(`started after close began: ${sql}`)
        const held = holds.find((entry) => sql.includes(entry.fragment))
        if (held !== undefined) holds.splice(holds.indexOf(held), 1)
        try {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (held !== undefined) await held.door
          return await run()
        } finally {
          if (closing) late.push(`finished after close began: ${sql}`)
          if (held !== undefined) order.push('the slow read landed')
        }
      }
      return {
        late,
        order,
        hold: (fragment) => {
          let open = (): void => {}
          const door = new Promise<void>((resolve) => {
            open = resolve
          })
          holds.push({ fragment, door })
          return () => {
            open()
          }
        },
        store: {
          persistent: true,
          kind: 'sqlite-native',
          exec: (sql, params) => call(sql, () => inner.exec(sql, params)),
          query: <T>(sql: string, params?: Parameters<SyncStore['exec']>[1]): Promise<T[]> =>
            call(sql, () => inner.query<T>(sql, params)),
          transaction: (fn) => call('BEGIN', () => inner.transaction(fn)),
          close: async () => {
            closing = true
            order.push('close began')
            await inner.close()
          },
          destroy: async () => {
            order.push('destroy')
            await inner.destroy?.()
          },
        },
      }
    }

    async function signsOutWhileAScreenReads(keepQueue: boolean): Promise<unknown> {
      const bridge = bridged(createMemoryStore())
      const server = new FakeServer(TABLES)
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      const engine = engineAs(RAHUL, bridge.store, server.transport())
      await engine.start()
      if (keepQueue) {
        // An order the office refused and one taken in a dead spot: the queue and the tray both hold rows.
        server.rejections.set('op-refused', {
          code: 'credit_hold',
          messageEn: 'Shop is on credit hold',
        })
        await engine.enqueue({
          table: 'sales_orders',
          id: 'o-refused',
          op: 'PUT',
          data: { retailer_id: CHAVAN.id },
          opId: 'op-refused',
        })
        await engine.flush()
        server.offline = true
        await engine.enqueue({
          table: 'sales_orders',
          id: 'o-queued',
          op: 'PUT',
          data: { retailer_id: CHAVAN.id },
        })
        await engine.flush()
      }
      // The mounted screens: told a table changed, each asks again at once.
      const rereads: Promise<unknown>[] = []
      engine.onTables((tables) => {
        if (tables.has('retailers')) rereads.push(engine.queryTable('retailers').catch(() => []))
        if (tables.has(OUTBOX_CHANNEL)) rereads.push(engine.outbox().catch(() => []))
        if (tables.has(OUTBOX_CHANNEL) || tables.has(ERRORS_CHANNEL))
          rereads.push(engine.needsAttention().catch(() => []))
      })
      // The shops list is still reading when the rep taps Sign out.
      const openTheSlowRead = bridge.hold('FROM "retailers"')
      const slowRead = engine.queryTable('retailers').catch(() => [])
      await sleep(0)
      const ending = engine.end({ keepQueue })
      setTimeout(openTheSlowRead, 20)
      const ended = await ending
      await slowRead
      await Promise.all(rereads)
      await sleep(20)
      return { ended, late: bridge.late, order: bridge.order }
    }

    expect({
      keep: await signsOutWhileAScreenReads(true),
      oneTap: await signsOutWhileAScreenReads(false),
    }).toEqual({
      keep: {
        ended: { kept: true, pending: 1, rejected: 1 },
        late: [],
        order: ['the slow read landed', 'close began'],
      },
      oneTap: {
        ended: { kept: false, pending: 0, rejected: 0 },
        late: [],
        order: ['the slow read landed', 'close began', 'destroy'],
      },
    })
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
    const AT_SAI: SyncIdentity = { ...RAHUL_AT_TARSUN, tenantId: SAI_ID }
    const AT_BALAJI: SyncIdentity = { ...RAHUL_AT_TARSUN, tenantId: BALAJI_ID }
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

  /*
   * Ruling (p). On a phone expo-sqlite keeps a connection it opened; a file left open by a sweep that could not
   * count it refuses every later delete of that file for the life of the process ("currently open").
   */
  it('DOS-167 sweepIdentityStores closes a store it could not count and never deletes it', async () => {
    const AT_SAI: SyncIdentity = { ...RAHUL_AT_TARSUN, tenantId: SAI_ID }
    const AT_BALAJI: SyncIdentity = { ...RAHUL_AT_TARSUN, tenantId: BALAJI_ID }
    const events: string[] = []
    const corrupt = { closed: 0, destroyed: 0 }
    const clean = createMemoryStore()
    const factory: StoreFactory = async (name) => {
      if (name === storeNameFor('dos-sales', AT_BALAJI)) return clean
      const broken: SyncStore = {
        persistent: true,
        kind: 'sqlite-native',
        exec: async () => {},
        query: async () => {
          throw new Error('database disk image is malformed')
        },
        transaction: async () => {
          throw new Error('database disk image is malformed')
        },
        close: async () => {
          corrupt.closed += 1
          events.push('close')
        },
        destroy: async () => {
          corrupt.destroyed += 1
          events.push('destroy')
        },
      }
      return broken
    }

    const result = await SyncEngine.sweepIdentityStores(
      factory,
      'dos-sales',
      [AT_SAI, AT_BALAJI],
      (line) => {
        events.push(line)
      },
    )

    expect({ result, corrupt, events }).toEqual({
      // The clean file at Balaji is deleted; the one at Sai that could not be counted is neither kept nor deleted.
      result: { destroyed: 1, kept: [] },
      corrupt: { closed: 1, destroyed: 0 },
      events: ['close', 'offline: sweep skipped a store'],
    })
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
    const name = storeNameFor('dos-sales', RAHUL_AT_TARSUN)
    expect(name).toBe('s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft')

    const phone = fakeSqlite({ canDelete: true })
    const store = await openExpoSqlite(phone.sqlite, name, 'sqlite-native')
    await store.destroy?.()
    expect(phone.calls).toEqual([
      'closeAsync',
      'deleteDatabaseAsync s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft',
    ])

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

  /*
   * Addendum (x), rule 3. Whatever the engine does, the adapter is the last door before the native binding: a call made
   * once the close has begun is refused with a typed error instead of reaching a connection whose statements are being
   * finalized, and the close runs once.
   */
  it('DOS-167 the SQLite adapter refuses a call after close began', async () => {
    const calls: string[] = []
    let finishClose = (): void => {}
    const closed = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    const db: ExpoDatabaseLike = {
      execAsync: async (sql) => {
        calls.push(`execAsync ${sql}`)
      },
      runAsync: async (sql) => {
        calls.push(`runAsync ${sql}`)
      },
      getAllAsync: async <T>(sql: string) => {
        calls.push(`getAllAsync ${sql}`)
        return [] as T[]
      },
      withTransactionAsync: async (fn) => {
        calls.push('withTransactionAsync')
        await fn()
      },
      closeAsync: () => {
        calls.push('closeAsync')
        return closed
      },
    }
    const store = await openExpoSqlite(
      { openDatabaseAsync: async () => db },
      storeNameFor('dos-sales', RAHUL_AT_TARSUN),
      'sqlite-native',
    )
    calls.length = 0

    const closing = store.close()
    const reached = (call: Promise<unknown>): Promise<unknown> =>
      call.then(
        () => 'reached the binding',
        (error: unknown) => ({
          name: (error as Error).name,
          code: (error as { code?: unknown }).code,
        }),
      )
    const late = {
      query: await reached(store.query(`SELECT * FROM ${OUTBOX_TABLE}`)),
      exec: await reached(store.exec(`DELETE FROM ${OUTBOX_TABLE}`)),
      run: await reached(
        store.exec(`UPDATE ${OUTBOX_TABLE} SET status = ? WHERE op_id = ?`, ['queued', 'op-1']),
      ),
      transaction: await reached(store.transaction(async () => 'written')),
    }
    const again = store.close()
    finishClose()
    await closing
    await again
    await store.close()

    const REFUSED = { name: 'StoreClosedError', code: 'closed' }
    expect({ late, calls }).toEqual({
      late: { query: REFUSED, exec: REFUSED, run: REFUSED, transaction: REFUSED },
      calls: ['closeAsync'],
    })
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
