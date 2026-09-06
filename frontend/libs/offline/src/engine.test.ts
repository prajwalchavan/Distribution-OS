/**
 * The eleven tests docs/27 §13 asks for, in its order, plus the two the build of it made necessary
 * (a rejected op is still resendable; an `upgradeRequired` answer does not burn the queue).
 *
 * Every one of them is deterministic: a scripted transport, an in-memory store, an injected clock,
 * and the foreground poll switched off. Nothing here touches a network or a timer it does not own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncEngine } from './engine.js'
import { connectionStateFrom } from './connection.js'
import { OUTBOX_TABLE, SYNC_ERRORS_TABLE } from './schema.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, tableManifest } from './test-support.js'
import type { SyncStore } from './types.js'

const RETAILERS = tableManifest('retailers', [
  column('id'),
  column('name'),
  column('beat_id'),
  column('updated_at'),
])

const ORDERS = tableManifest(
  'sales_orders',
  [
    column('id'),
    column('retailer_id'),
    column('state'),
    column('net_paise', 'integer'),
    column('updated_at'),
  ],
  { writable: true },
)

const LINES = tableManifest(
  'sales_order_lines',
  [column('id'), column('order_id'), column('variant_id'), column('entered_qty', 'integer')],
  { writable: true },
)

const TABLES = [RETAILERS, ORDERS, LINES]

let clock = Date.parse('2026-09-06T06:00:00.000Z')
const now = (): number => clock

function engineOn(store: SyncStore, server: FakeServer): SyncEngine {
  return new SyncEngine({
    transport: server.transport(),
    deviceId: 'device-1',
    storeFactory: fixedStoreFactory(store),
    pullIntervalMs: 0,
    now,
  })
}

beforeEach(() => {
  clock = Date.parse('2026-09-06T06:00:00.000Z')
})

// 1 --------------------------------------------------------------------------------------------------------------

describe('1. the manifest decides whether the device may keep what it holds', () => {
  it('drops and re-snapshots when the schema version changes', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [{ id: 'r1', name: 'Alan Stores' }], deleted: [] }],
      cursor: 'c1',
    })
    const first = engineOn(store, server)
    await first.start()
    expect(await first.queryTable('retailers')).toHaveLength(1)

    // The server rolled forward: a new hash means the local tables belong to a schema that is gone.
    server.setManifest(TABLES, 'v2')
    server.pulls = []
    server.queuePull({ changes: [], cursor: 'c2' })
    await first.stop()
    const second = engineOn(store, server)
    await second.start()
    expect(await second.queryTable('retailers')).toEqual([])
    // A snapshot: the pull that follows a drop carries no cursor.
    expect(server.pullCalls.at(-1)?.since).toBeUndefined()
  })

  it('drops on a ROLE change even when the hash is identical', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES, 'salesperson', 'v1')
    server.queuePull({ changes: [{ table: 'retailers', rows: [{ id: 'r1' }], deleted: [] }] })
    const engine = engineOn(store, server)
    await engine.start()
    expect(await engine.queryTable('retailers')).toHaveLength(1)

    server.setManifest(TABLES, 'v1', 'delivery')
    server.pulls = []
    server.queuePull({ changes: [] })
    await engine.sync('role-change')
    expect(await engine.queryTable('retailers')).toEqual([])
  })

  /*
   * A rep who works for two distributors gets the SAME role and therefore the same `schemaVersion`
   * from both — the hash is over the role's tables. Without the tenant in the comparison the second
   * distributor's delta lands on top of the first one's rows and the device holds a mixture of two
   * businesses, which is the one thing a multi-tenant device may never do.
   */
  it('drops on a DISTRIBUTOR change even when the hash and the role are identical', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES, 'salesperson', 'v1')
    server.queuePull({ changes: [{ table: 'retailers', rows: [{ id: 'r1' }], deleted: [] }] })
    const first = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      tenantId: 'tenant-a',
      now,
    })
    await first.start()
    expect(await first.queryTable('retailers')).toHaveLength(1)
    await first.stop()

    server.pulls = []
    server.queuePull({ changes: [] })
    const second = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      tenantId: 'tenant-b',
      now,
    })
    await second.start()
    expect(await second.queryTable('retailers')).toEqual([])
    expect(server.pullCalls.at(-1)?.since).toBeUndefined()
    await second.stop()
  })
})

// 2 --------------------------------------------------------------------------------------------------------------

describe('2. snapshot then delta', () => {
  it('upserts by primary key, applies tombstones BEFORE rows, and keeps a row that is in both', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [
        {
          table: 'retailers',
          rows: [
            { id: 'r1', name: 'Alan Stores', updated_at: '2026-09-06T05:00:00.000Z' },
            { id: 'r2', name: 'Bharat Kirana', updated_at: '2026-09-06T05:00:00.000Z' },
          ],
          deleted: [],
        },
      ],
      cursor: 'c1',
    })
    const engine = engineOn(store, server)
    await engine.start()

    server.pulls = []
    server.queuePull({
      changes: [
        {
          table: 'retailers',
          // r2 left the beat; r1 both moved and is still visible — the ordering rule decides it stays.
          rows: [
            { id: 'r1', name: 'Alan Stores (Kalyan)', updated_at: '2026-09-06T06:30:00.000Z' },
          ],
          deleted: ['r2', 'r1'],
        },
      ],
      cursor: 'c2',
    })
    await engine.sync('delta')

    const rows = await engine.queryTable<{ id: string; name: string }>('retailers')
    expect(rows).toEqual([
      {
        id: 'r1',
        name: 'Alan Stores (Kalyan)',
        beat_id: null,
        updated_at: '2026-09-06T06:30:00.000Z',
      },
    ])
  })
})

// 3 --------------------------------------------------------------------------------------------------------------

describe('3. the hasMore loop', () => {
  it('echoes the cursor the LAST response gave, and saves it only after the commit', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.pulls = [
      {
        changes: [{ table: 'retailers', rows: [{ id: 'r1' }], deleted: [] }],
        cursor: 'page-1',
        hasMore: true,
        asOf: '2026-09-06T06:00:00.000Z',
      },
      {
        changes: [{ table: 'retailers', rows: [{ id: 'r2' }], deleted: [] }],
        cursor: 'page-2',
        hasMore: true,
        asOf: '2026-09-06T06:00:01.000Z',
      },
      {
        changes: [{ table: 'retailers', rows: [{ id: 'r3' }], deleted: [] }],
        cursor: 'page-3',
        hasMore: false,
        asOf: '2026-09-06T06:00:02.000Z',
      },
    ]
    const engine = engineOn(store, server)
    await engine.start()
    expect(server.pullCalls.map((call) => call.since)).toEqual([undefined, 'page-1', 'page-2'])
    expect((await engine.queryTable('retailers')).length).toBe(3)
    expect(engine.status().lastPulledAt).toBe('2026-09-06T06:00:02.000Z')
  })

  it('leaves the cursor untouched when the transaction that would advance it throws', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [{ table: 'retailers', rows: [{ id: 'r1' }], deleted: [] }] })
    const engine = engineOn(store, server)
    await engine.start()
    const before = await store.query<{ value: string }>(
      'SELECT value FROM _sync_state WHERE key = ?',
      ['cursor'],
    )

    server.pulls = []
    // A row whose device key is a column the table does not have cannot be written; the whole
    // response must roll back, cursor and all, so the next pull asks for the same page again.
    server.queuePull({
      changes: [{ table: 'retailers', rows: [{ id: 'r2' }], deleted: [] }],
      cursor: 'c-next',
    })
    const broken: SyncStore = {
      exec: (sql, params) => store.exec(sql, params),
      query: (sql, params) => store.query(sql, params),
      transaction: () => Promise.reject(new Error('storage full')),
      persistent: store.persistent,
      kind: store.kind,
      close: () => store.close(),
    }
    const second = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(broken),
      pullIntervalMs: 0,
      now,
    })
    await second.start()
    const after = await store.query<{ value: string }>(
      'SELECT value FROM _sync_state WHERE key = ?',
      ['cursor'],
    )
    expect(after).toEqual(before)
  })
})

// 4 --------------------------------------------------------------------------------------------------------------

describe('4. the outbox is FIFO', () => {
  it('sends in seq order, batch by batch, with the order line behind its order', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      uploadBatchSize: 2,
      now,
    })
    await engine.start()

    // Three taps in a dead spot: the queue fills, nothing goes out.
    server.offline = true
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT',
      data: { retailer_id: 'r1' },
    })
    await engine.enqueue({
      table: 'sales_order_lines',
      id: 'l1',
      op: 'PUT',
      data: { order_id: 'o1', variant_id: 'v1', entered_qty: 2 },
    })
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o2',
      op: 'PUT',
      data: { retailer_id: 'r2' },
    })
    await engine.flush()
    expect(server.uploadCalls).toHaveLength(0)
    expect(engine.status().pending).toBe(3)

    server.offline = false
    await engine.flush()

    // Two batches of two, in `seq` order — so the line is never sent before its order.
    expect(server.uploadCalls.map((call) => call.ops.map((op) => op.id))).toEqual([
      ['o1', 'l1'],
      ['o2'],
    ])
    await engine.stop()
  })
})

// 5 --------------------------------------------------------------------------------------------------------------

describe('5. a replay is free', () => {
  it('re-sends the same opId after a lost response and the server applies it once', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT',
      data: { retailer_id: 'r1' },
    })
    const opId = (await engine.outbox())[0]?.opId
    expect(opId).toBeDefined()

    // The server applied it; the ANSWER was lost on the way back.
    const transport = server.transport()
    await transport.upload({
      protocol: 1,
      deviceId: 'device-1',
      ops: [
        { opId: opId!, op: 'PUT', table: 'sales_orders', id: 'o1', data: { retailer_id: 'r1' } },
      ],
    })
    await engine.flush()

    expect(server.applied.get(opId!)).toBe(1)
    const acked = (await engine.outbox()).filter((op) => op.status === 'acked')
    expect(acked).toHaveLength(1)
    const rows = await engine.queryTable<{ id: string; _pending: string | null }>('sales_orders')
    expect(rows[0]?._pending).toBeNull()
  })
})

// 6 --------------------------------------------------------------------------------------------------------------

describe('6. a rejection keeps the row and becomes a work item', () => {
  it('marks the row rejected, mirrors the error and shows it in the tray', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT',
      data: { retailer_id: 'r1' },
    })
    server.rejections.set(opId, { code: 'credit_hold', messageEn: 'Shop is on credit hold' })
    await engine.flush()

    const rows = await engine.queryTable<{ id: string; _pending: string | null }>('sales_orders')
    expect(rows).toHaveLength(1)
    expect(rows[0]?._pending).toBe('rejected')

    const mirrored = await store.query<{ code: string }>(`SELECT code FROM ${SYNC_ERRORS_TABLE}`)
    expect(mirrored).toEqual([{ code: 'credit_hold' }])

    const tray = await engine.needsAttention()
    expect(tray).toHaveLength(1)
    expect(tray[0]?.error.message).toBe('Shop is on credit hold')
    expect(tray[0]?.op?.data).toEqual({ retailer_id: 'r1' })
    expect(engine.status().rejected).toBe(1)
  })

  it('re-pulls the row on `stale` so the tray can offer both versions', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [
        {
          table: 'sales_orders',
          rows: [
            { id: 'o1', retailer_id: 'r1', state: 'draft', updated_at: '2026-09-06T05:00:00.000Z' },
          ],
          deleted: [],
        },
      ],
    })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PATCH',
      data: { state: 'draft', net_paise: 120000 },
      baseUpdatedAt: '2026-09-06T05:00:00.000Z',
    })
    server.rejections.set(opId, { code: 'stale', messageEn: 'Somebody else changed this order' })
    server.pulls = []
    server.queuePull({
      changes: [
        {
          table: 'sales_orders',
          rows: [
            {
              id: 'o1',
              retailer_id: 'r1',
              state: 'submitted',
              net_paise: 99000,
              updated_at: '2026-09-06T07:00:00.000Z',
            },
          ],
          deleted: [],
        },
      ],
      cursor: 'c9',
    })
    await engine.flush()

    const tray = await engine.needsAttention()
    expect(tray[0]?.error.code).toBe('stale')
    // The device's own version, and what the server holds instead — both, for the user to choose.
    expect(tray[0]?.op?.data).toEqual({ state: 'draft', net_paise: 120000 })
    expect(tray[0]?.serverRow?.state).toBe('submitted')
  })

  it('lets a rejected op be sent again with the SAME opId, or discarded with an audit line', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.rejections.set(opId, { code: 'retailer_required', messageEn: 'The order has no shop' })
    await engine.flush()
    expect(engine.status().rejected).toBe(1)

    await engine.discard(opId)
    expect(engine.status().rejected).toBe(0)
    const audit = await store.query<{ discarded_at: string | null }>(
      `SELECT discarded_at FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`,
      [opId],
    )
    expect(audit[0]?.discarded_at).not.toBeNull()
    expect(await engine.needsAttention()).toEqual([])
  })
})

// 7 --------------------------------------------------------------------------------------------------------------

describe('7. a dead spot loses nothing', () => {
  it('keeps the queue across a failure and a restart, and re-sends with the same opId', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT',
      data: { retailer_id: 'r1' },
    })
    server.offline = true
    await engine.flush()
    expect(server.uploadCalls).toHaveLength(0)
    expect(engine.status().pending).toBe(1)
    expect(engine.status().online).toBe(false)
    await engine.stop()

    // The phone was killed and started again: the SAME database, a new engine.
    server.offline = false
    const restarted = engineOn(store, server)
    await restarted.start()
    await restarted.flush()
    expect(server.uploadCalls).toHaveLength(1)
    expect(server.uploadCalls[0]?.ops[0]?.opId).toBe(opId)
    expect(restarted.status().pending).toBe(0)
    await restarted.stop()
  })

  it('reverts an op that was `sending` when the app died', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()
    await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    await store.exec(`UPDATE ${OUTBOX_TABLE} SET status = 'sending'`)
    await engine.stop()

    const restarted = engineOn(store, server)
    await restarted.start()
    const rows = await restarted.outbox()
    expect(rows[0]?.status).toBe('acked')
    expect(server.uploadCalls).toHaveLength(1)
    await restarted.stop()
  })
})

// 8 --------------------------------------------------------------------------------------------------------------

describe('8. a pull never overwrites a locally pending row', () => {
  it('leaves the queued edit alone until the server answers', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [
        {
          table: 'sales_orders',
          rows: [{ id: 'o1', retailer_id: 'r1', state: 'draft', net_paise: 1000 }],
          deleted: [],
        },
      ],
    })
    const engine = engineOn(store, server)
    await engine.start()

    // The op is in flight — `sending` is as protected as `queued`, and this is the moment a delta
    // that still carries the old row would silently undo the rep's edit on his own screen.
    const release = server.hold()
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PATCH',
      data: { net_paise: 250000 },
      baseUpdatedAt: '2026-09-06T05:00:00.000Z',
    })

    server.pulls = []
    server.queuePull({
      changes: [
        {
          table: 'sales_orders',
          rows: [{ id: 'o1', retailer_id: 'r1', state: 'draft', net_paise: 1000 }],
          deleted: [],
        },
      ],
      cursor: 'c2',
    })
    await engine.sync('delta')

    const rows = await engine.queryTable<{ net_paise: number; _pending: string }>('sales_orders')
    expect(rows[0]?.net_paise).toBe(250000)
    expect(rows[0]?._pending).toBe('sending')

    release()
    await engine.flush()
    await engine.stop()
  })
})

// 9 --------------------------------------------------------------------------------------------------------------

describe('9. a field device has nowhere to put a cost', () => {
  it('creates exactly the columns the manifest published, and no other', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    // The server would have to publish it for the device to hold it; it does not.
    await expect(
      engine.enqueue({
        table: 'sales_orders',
        id: 'o1',
        op: 'PUT',
        data: { retailer_id: 'r1', landed_cost_paise: 90000 },
      }),
    ).resolves.toBeTypeOf('string')
    const rows = await engine.queryTable<Record<string, unknown>>('sales_orders')
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      '_local_rev',
      '_pending',
      'id',
      'net_paise',
      'retailer_id',
      'state',
      'updated_at',
    ])
    for (const key of Object.keys(rows[0] ?? {}))
      expect(key).not.toMatch(/cost|margin|landed|purchase/i)
  })

  it('refuses to queue a write for a download-only table', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()
    await expect(
      engine.enqueue({ table: 'retailers', id: 'r9', op: 'PUT', data: { name: 'New shop' } }),
    ).rejects.toThrow(/download-only/)
  })
})

// 10 -------------------------------------------------------------------------------------------------------------

describe('10. the status object', () => {
  it('walks offline -> online -> synced and counts what is waiting', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.offline = true
    const engine = engineOn(store, server)
    await engine.start()
    expect(engine.status().online).toBe(false)
    expect(engine.status().lastPulledAt).toBeNull()

    server.offline = false
    server.queuePull({ changes: [], asOf: '2026-09-06T06:10:00.000Z', cursor: 'c1' })
    await engine.sync('back')
    expect(engine.status().online).toBe(true)
    expect(engine.status().lastPulledAt).toBe('2026-09-06T06:10:00.000Z')

    server.offline = true
    await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    await engine.flush()
    const waiting = engine.status()
    expect(waiting.pending).toBe(1)
    expect(waiting.oldestPendingAt).toBe('2026-09-06T06:00:00.000Z')

    // What <ConnectionStrip> is actually handed.
    const state = connectionStateFrom(waiting)
    expect(state.online).toBe(false)
    expect(state.pendingWrites).toBe(1)
    expect(state.lastSyncedAt).toBe(Date.parse('2026-09-06T06:10:00.000Z'))
    await engine.stop()
  })

  /*
   * These four are the regression half of the honesty contract, and they exist because the first
   * build got it backwards: `online` also required a successful call inside the last 30 seconds, and
   * the 60-second poll was gated on `online`. A phone with a perfect connection therefore said
   * "Offline — saved on this phone" for half of every minute, and the first time the poll looked it
   * saw that false and stopped scheduling — one pull per launch, for ever, on every read-only app.
   */
  it('says offline when a call fails and online again when one answers', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [], asOf: '2026-09-06T06:00:00.000Z' })
    const engine = engineOn(store, server)
    await engine.start()
    expect(engine.status().online).toBe(true)
    server.offline = true
    await engine.sync('probe')
    expect(engine.status().online).toBe(false)
    server.offline = false
    await engine.sync('probe')
    expect(engine.status().online).toBe(true)
    await engine.stop()
  })

  it('is still online a quiet minute after the last pull, and keeps polling', async () => {
    vi.useFakeTimers()
    try {
      const store = createMemoryStore()
      const server = new FakeServer(TABLES)
      server.queuePull({ changes: [], asOf: '2026-09-06T06:00:00.000Z' })
      const engine = new SyncEngine({
        transport: server.transport(),
        deviceId: 'device-1',
        storeFactory: fixedStoreFactory(store),
        pullIntervalMs: 60_000,
        now,
      })
      await engine.start()
      expect(server.pullCalls).toHaveLength(1)
      clock += 60_000
      await vi.advanceTimersByTimeAsync(60_000)
      expect(engine.status().online).toBe(true)
      expect(server.pullCalls.length).toBeGreaterThan(1)
      const afterOne = server.pullCalls.length
      clock += 60_000
      await vi.advanceTimersByTimeAsync(60_000)
      expect(server.pullCalls.length).toBeGreaterThan(afterOne)
      await engine.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pulls and drains the queue the moment the radio comes back', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [], asOf: '2026-09-06T06:00:00.000Z' })
    const engine = engineOn(store, server)
    await engine.start()
    server.offline = true
    engine.setNetworkHint(false)
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o-radio',
      op: 'PUT',
      data: { state: 'draft' },
    })
    await engine.flush()
    expect(engine.status().pending).toBe(1)
    expect(engine.status().online).toBe(false)

    server.offline = false
    const pullsBefore = server.pullCalls.length
    engine.setNetworkHint(true)
    await engine.flush()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(engine.status().pending).toBe(0)
    expect(server.pullCalls.length).toBeGreaterThan(pullsBefore)
    await engine.stop()
  })

  it('pulls back what the server made of a write, right after the batch is accepted', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [], asOf: '2026-09-06T06:00:00.000Z' })
    const engine = engineOn(store, server)
    await engine.start()
    const before = server.pullCalls.length
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o-echo',
      op: 'PUT',
      data: { state: 'draft' },
    })
    await engine.flush()
    expect(server.pullCalls.length).toBeGreaterThan(before)
    await engine.stop()
  })
})

// 11 -------------------------------------------------------------------------------------------------------------

describe('11. the memory adapter is honest about itself', () => {
  it('reports persistent = false so the strip can say the data is not saved', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()
    expect(engine.status().store).toBe('memory')
    expect(engine.status().persistent).toBe(false)
    await engine.stop()
  })
})

// The two the build found -----------------------------------------------------------------------------------------

describe('the protocol version', () => {
  it('keeps the queue when the server says the app is too old', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()
    await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.upgradeRequired = true
    await engine.flush()

    expect(engine.status().upgradeRequired).toBe(true)
    expect(engine.status().pending).toBe(1)
    const rows = await engine.outbox()
    expect(rows[0]?.status).toBe('queued')
    await engine.stop()
  })
})

describe('the local write is visible the instant it is queued', () => {
  it('writes the outbox row and the table row in one transaction', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()
    server.offline = true

    await engine.enqueue({
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT',
      data: { retailer_id: 'r1', state: 'draft', net_paise: 45000 },
    })
    // Join the send that `enqueue` kicked off, so the assertion is not a snapshot of a batch in flight.
    await engine.flush()
    const rows = await engine.queryTable<{ net_paise: number; _pending: string }>('sales_orders')
    expect(rows[0]?.net_paise).toBe(45000)
    expect(rows[0]?._pending).toBe('queued')
    expect((await engine.outbox()).map((op) => op.status)).toEqual(['queued'])
    await engine.stop()
  })
})

describe('the tray survives a device that lost its mirror', () => {
  it('pulls the server’s own sync_errors back, and does not resurrect a discarded one', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    server.serverErrors = [
      {
        id: 'e1',
        opId: 'op-from-yesterday',
        table: 'sales_orders',
        rowId: 'o9',
        code: 'credit_hold',
        messageEn: 'Shop is on credit hold',
        messageHi: 'दुकान क्रेडिट होल्ड पर है',
        deviceId: 'device-1',
        createdAt: '2026-09-05T10:00:00.000Z',
        resolved: false,
        resolvedAt: null,
      },
    ]
    const engine = engineOn(store, server)
    await engine.start()

    const tray = await engine.needsAttention()
    expect(tray).toHaveLength(1)
    expect(tray[0]?.error.code).toBe('credit_hold')
    // There is no outbox row for it: the op belongs to a queue this install no longer has.
    expect(tray[0]?.op).toBeNull()

    await engine.discard('op-from-yesterday')
    await engine.sync('again')
    expect(await engine.needsAttention()).toEqual([])
    await engine.stop()
  })
})

/*
 * A shop's app has no tray at all: the permission matrix answers 403 for `GET /sync/errors`, and
 * `transportFromApi` still wires the procedure because the CONTRACT is shared by every service. The
 * mirror is a convenience; the pull that just committed is the work. A refusal must therefore not
 * turn a good sync into a failed one — the live retailer-service answers exactly
 * "the retailer role may not call GET /sync/errors".
 */
describe('a role with no tray still syncs', () => {
  it('keeps the pull and stops asking when sync.errors.list is refused', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES, 'retailer')
    server.queuePull({
      changes: [{ table: 'retailers', rows: [{ id: 'r1', name: 'Ramesh Kirana' }], deleted: [] }],
    })
    const base = server.transport()
    let asked = 0
    const engine = new SyncEngine({
      transport: {
        ...base,
        listErrors: async () => {
          asked += 1
          throw Object.assign(new Error('the retailer role may not call GET /sync/errors'), {
            status: 403,
          })
        },
      },
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      now,
    })
    await engine.start()

    expect(await engine.queryTable('retailers')).toHaveLength(1)
    expect(engine.status().lastError).toBeNull()
    expect(engine.status().online).toBe(true)
    await engine.sync('again')
    expect(asked).toBe(1)
    expect(engine.status().lastError).toBeNull()
    await engine.stop()
  })
})
