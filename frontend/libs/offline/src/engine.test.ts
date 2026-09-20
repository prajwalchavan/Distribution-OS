/**
 * The eleven tests docs/27 §13 asks for, in its order, plus the two the build of it made necessary
 * (a rejected op is still resendable; an `upgradeRequired` answer does not burn the queue).
 *
 * Every one of them is deterministic: a scripted transport, an in-memory store, an injected clock,
 * and the foreground poll switched off. Nothing here touches a network or a timer it does not own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeptMoneyError, SyncEngine } from './engine.js'
import { connectionStateFrom } from './connection.js'
import {
  OUTBOX_TABLE,
  SYNC_ERRORS_TABLE,
  SYSTEM_TABLE_ADDITIONS,
  SYSTEM_TABLE_STATEMENTS,
} from './schema.js'
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

/** DOS-178: an insert-only MONEY table — a person entered rupees into it, so nothing here is ever thrown away. */
const RECEIPTS = tableManifest(
  'receipts',
  [
    column('id'),
    column('retailer_id'),
    column('mode'),
    column('amount_paise', 'integer'),
    column('client_receipt_no'),
    column('trip_id'),
    column('updated_at'),
  ],
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

// 0 --------------------------------------------------------------------------------------------------------------

describe('0. a device that already holds its rows answers on the first launch', () => {
  /*
   * The delivery gate's Pixel 7 case. `queryTable` answers `[]` for a table whose SHAPE it does not
   * know yet, the shapes arrive with `restoreManifest`, and `useTable` re-runs only when a table
   * CHANGES — so a screen that mounted before the engine was ready asked once, got nothing, and kept
   * nothing. On a full store whose delta pull brings nothing new, no change ever comes: the delivery
   * home screen said "Nothing is on the road yet" over a SQLite file holding an active trip, on
   * every cold start. Becoming able to answer is itself the change.
   */
  it('emits a change for every table it can now answer for, the moment it is ready', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({
      changes: [{ table: 'retailers', rows: [{ id: 'r1', name: 'Alan Stores' }], deleted: [] }],
      cursor: 'c1',
    })
    const first = engineOn(store, server)
    await first.start()
    await first.stop()

    // Second launch: the store is full and the server has nothing new to send.
    server.pulls = []
    server.queuePull({ changes: [], cursor: 'c2' })
    const second = engineOn(store, server)
    const seen: string[][] = []
    second.onTables((tables) => {
      seen.push([...tables].sort())
    })
    await second.start()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toContain('retailers')
    expect(await second.queryTable('retailers')).toHaveLength(1)
  })
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
   *
   * Since DOS-167 the device settles this AT OPEN, before a shape is restored or a row is read: the
   * store is stamped with the person and the distributor it belongs to, and a store stamped for
   * another distributor is wiped before the handshake, not after it.
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
      identity: { userId: 'user-1', tenantId: 'tenant-a', role: 'salesperson' },
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
      identity: { userId: 'user-1', tenantId: 'tenant-b', role: 'salesperson' },
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

describe('DOS-056 a batch is bounded in bytes as well as in ops', () => {
  it('DOS-056 sends photo-carrying ops in smaller FIFO batches under the byte budget, and an op larger than the budget still goes on its own', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      uploadBatchBytes: 1_000_000,
      now,
    })
    await engine.start()

    // A dead-spot afternoon: three doorstep writes with a compressed photo inline, one that is bigger
    // than a whole batch, and a small one behind it.
    server.offline = true
    const photo = 'A'.repeat(400_000)
    for (const id of ['o1', 'o2', 'o3'])
      await engine.enqueue({ table: 'sales_orders', id, op: 'PUT', data: { retailer_id: photo } })
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o4',
      op: 'PUT',
      data: { retailer_id: 'A'.repeat(1_500_000) },
    })
    await engine.enqueue({
      table: 'sales_orders',
      id: 'o5',
      op: 'PUT',
      data: { retailer_id: 'r5' },
    })
    await engine.flush()
    expect(server.uploadCalls).toHaveLength(0)

    server.offline = false
    await engine.flush()

    expect(server.uploadCalls.map((call) => call.ops.map((op) => op.id))).toEqual([
      ['o1', 'o2'],
      ['o3'],
      ['o4'],
      ['o5'],
    ])
    for (const call of server.uploadCalls)
      if (call.ops.length > 1)
        expect(JSON.stringify(call.ops).length).toBeLessThanOrEqual(1_000_000)
    expect(engine.status().pending).toBe(0)
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

  it('lets a rejected op be discarded with an audit line', async () => {
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

// 16 -------------------------------------------------------------------------------------------------------------

/**
 * A stopped engine stops talking to the service.
 *
 * `stop()` clears the timers and closes the database, but a pull loop already inside `for(;;)` held
 * the store it was handed and kept crawling to the last page. A cold read set is hundreds of pages
 * (265 for a salesperson on the pilot data), so an engine replaced a second after it started — a
 * token refresh, a distributor switch, the provider's own effect re-running — did the WHOLE crawl a
 * second time in parallel: 530 `sync/pull` calls measured on one sign-in of the sales app. Twice the
 * data on a phone that pays for it (UX-00 §8.3 budgets 10 MB a day), rows landing in a store nothing
 * reads, and a signed-out app still calling the service.
 */
describe('16. a stopped engine stops pulling', () => {
  it('leaves the loop at the next page instead of crawling the whole read set', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    // Every page says there is another one; only `stop()` can end this.
    server.queuePull({
      changes: [{ table: 'retailers', rows: [{ id: 'r1', name: 'Alan Stores' }], deleted: [] }],
      cursor: 'c1',
      hasMore: true,
    })

    const base = server.transport()
    let pages = 0
    const stops: Promise<void>[] = []
    const engine = new SyncEngine({
      transport: {
        ...base,
        pull: async (input) => {
          pages += 1
          // A real page costs a round trip; without a yield the loop runs to its 1000-page guard
          // inside one microtask batch and `stop()` never gets a turn.
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (pages === 3) stops.push(engine.stop())
          return base.pull(input)
        },
      },
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      now,
    })

    await engine.start()
    await Promise.all(stops)
    const settled = pages
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(settled).toBeLessThan(10)
    expect(pages).toBe(settled)
  })
})

// 6b -------------------------------------------------------------------------------------------------------------

/**
 * DOS-178 — MONEY A PERSON HAS ENTERED IS NEVER OFFERED FOR DELETION (never-list #13, founder answer A of
 * 2026-09-14).
 *
 * A crew takes cash at a door with no signal; the office settles that trip before the phone finds one; the
 * receipt comes back refused `trip_settled`, correctly. Until this, the tray's only two buttons were "Send it
 * again" (which replays the stored refusal, S-73) and "Throw it away" — and the second one deleted the outbox
 * row, which on a settled trip is the ONLY record anywhere that the shop paid.
 *
 * The rule is by TABLE, never by code, so it cannot drift as codes are added: a refused op on `receipts`,
 * `allocations` or `collections` is kept whatever the reason. `handOver` is the way out — the crew hands the
 * money and the slip to the cashier, and the op stops asking for attention without ever leaving the phone.
 */
describe('6b. a refused payment is kept and handed to the cashier', () => {
  it('DOS-178 discard refuses a rejected op on a money table and keeps its row, outbox entry and error; handOver marks it kept and takes it out of the attention count', async () => {
    const store = createMemoryStore()
    const server = new FakeServer([...TABLES, RECEIPTS], 'delivery')
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({
      table: 'receipts',
      id: 'rc1',
      op: 'PUT',
      data: { retailer_id: 'r1', mode: 'cash', amount_paise: 250000, client_receipt_no: '41' },
    })
    server.rejections.set(opId, {
      code: 'trip_settled',
      messageEn: 'Trip TRIP-0031 is settled; money is collected while the trip is out',
    })
    await engine.flush()
    expect(engine.status().rejected).toBe(1)

    // 1. Throwing it away is refused, and nothing it holds is touched.
    await expect(engine.discard(opId)).rejects.toBeInstanceOf(KeptMoneyError)
    expect((await engine.outbox()).find((op) => op.opId === opId)?.status).toBe('rejected')
    expect(await engine.getRow('receipts', 'rc1')).not.toBeNull()
    const tray = await engine.needsAttention()
    expect(tray).toHaveLength(1)
    expect(tray[0]?.kept).toBe(true)
    expect(tray[0]?.error.handedOverAt).toBeNull()
    expect(tray[0]?.op?.data).toMatchObject({ amount_paise: 250000 })

    // 2. Handing it to the cashier keeps every one of those and stops the phone asking.
    clock += 60_000
    await engine.handOver(opId)
    expect(engine.status().rejected).toBe(0)
    const kept = (await engine.outbox()).find((op) => op.opId === opId)
    expect(kept?.status).toBe('kept')
    expect(kept?.data).toMatchObject({ amount_paise: 250000 })
    const row = await engine.getRow<{ _pending: string | null }>('receipts', 'rc1')
    expect(row?._pending).toBe('kept')
    const after = await engine.needsAttention()
    expect(after).toHaveLength(1)
    expect(after[0]?.kept).toBe(true)
    expect(after[0]?.error.handedOverAt).toBe('2026-09-06T06:01:00.000Z')

    // 3. And it is never sent again behind the crew's back: `claim` takes queued ops only.
    server.uploadCalls.length = 0
    await engine.flush()
    expect(server.uploadCalls).toEqual([])
  })

  it('DOS-178 a refusal on a table that is not money keeps today’s "Throw it away"', async () => {
    const store = createMemoryStore()
    const server = new FakeServer([...TABLES, RECEIPTS], 'delivery')
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.rejections.set(opId, { code: 'retailer_required', messageEn: 'The order has no shop' })
    await engine.flush()

    const tray = await engine.needsAttention()
    expect(tray[0]?.kept).toBe(false)
    await engine.discard(opId)
    expect(await engine.needsAttention()).toEqual([])
  })

  it('DOS-178 signing out with no queue still keeps the file while money waits for the cashier', async () => {
    const store = createMemoryStore()
    const server = new FakeServer([...TABLES, RECEIPTS], 'delivery')
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({
      table: 'receipts',
      id: 'rc1',
      op: 'PUT',
      data: { mode: 'cash', amount_paise: 250000 },
    })
    server.rejections.set(opId, { code: 'trip_settled', messageEn: 'Trip is settled' })
    await engine.flush()
    await engine.handOver(opId)

    // Nothing is queued and nothing needs attention, yet the phone still carries the shop's money.
    const result = await engine.end({ keepQueue: false })
    expect(result.kept).toBe(true)
    const left = await store.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${OUTBOX_TABLE} WHERE status = 'kept'`,
    )
    expect(Number(left[0]?.n ?? 0)).toBe(1)
  })
})

// 6c -------------------------------------------------------------------------------------------------------------

/**
 * DOS-053 — ONE refused count, and it is the tray.
 *
 * The strip's badge, the rail's badge and X4's "Refused" chip all read `status().rejected`; the tray itself
 * draws `needsAttention()`. The two were counted from different tables — the outbox's own `status = 'rejected'`
 * against `_sync_errors` — and they disagree the moment a rejection has no outbox row behind it: a refusal the
 * server still holds, pulled back by `pullErrors` after a reinstall or (on the web fallback) a reload, is a tray
 * item this device can act on and was counted nowhere. The warehouse gate saw the two sides of exactly that:
 * "Refused 0" over a tray holding two, and a rail badge of 1 over the same two.
 *
 * So the count is the tray: `_sync_errors` minus the rows a person has already dealt with — thrown away, or
 * (DOS-178) handed to the cashier, which is the one row the tray still lists and nobody owes work on.
 */
describe('6c. the refused count and the tray are the same number', () => {
  const SERVER_ERROR = {
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
  }

  it('DOS-053 a rejection pulled from the server counts in status().rejected, like the tray it draws', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    server.serverErrors = [SERVER_ERROR]
    const engine = engineOn(store, server)
    await engine.start()

    const tray = await engine.needsAttention()
    expect(tray).toHaveLength(1)
    expect(tray[0]?.op).toBeNull()
    expect(engine.status().rejected).toBe(tray.length)
    await engine.stop()
  })

  it('DOS-053 the count the strip is handed after the pull says so too, without waiting for the next write', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const seen: number[] = []
    engine.onStatus((status) => {
      seen.push(status.rejected)
    })
    server.serverErrors = [SERVER_ERROR]
    await engine.sync('again')

    expect(seen.at(-1)).toBe(1)
    expect(connectionStateFrom(engine.status()).needsAttention).toBe(1)
    await engine.stop()
  })

  it('DOS-053 a refusal this device raised itself and one pulled from the server are counted once each', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    server.serverErrors = [SERVER_ERROR]
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.rejections.set(opId, { code: 'retailer_required', messageEn: 'The order has no shop' })
    await engine.flush()

    expect(await engine.needsAttention()).toHaveLength(2)
    expect(engine.status().rejected).toBe(2)

    // Thrown away is dealt with: it leaves both the tray and the count, and the pull never brings it back.
    await engine.discard(opId)
    await engine.sync('again')
    expect(await engine.needsAttention()).toHaveLength(1)
    expect(engine.status().rejected).toBe(1)
    await engine.stop()
  })
})

// 6d -------------------------------------------------------------------------------------------------------------

/**
 * DOS-046 — "Try it again" is a NEW operation, and the rejection it replaces stays as history.
 *
 * ADR 0007 makes every outcome durable: `sync_ops` remembers what the server answered for an opId, and a replay
 * gets that answer back rather than a second run. A REFUSAL is such an outcome — `sync.service.ts` answers a
 * replayed refused op `replayed: 1, rejected: [the stored one]` — so an outbox row re-queued under its own opId
 * can only ever be told the same thing again. The warehouse gate proved it: the wave that refused the pick was
 * `picking` again, and "Try it again" still came back "Picklist PICK-0224 is picked; it is no longer being
 * picked", for ever. Only "Throw it away" and re-picking worked, and the tray never said so.
 *
 * The user pressing the button later, against a server that has moved on, IS a new intent. So a retry mints a
 * fresh opId (= idempotencyKey) on the same row, data and baseUpdatedAt, keeps its place in the queue, and the
 * old refusal is kept on the device marked with what it was sent again as — never deleted, because the server
 * still lists it unresolved and the errors pull would bring it straight back beside the retry.
 *
 * AUTOMATIC re-sends are untouched (describe 7): a batch that never left, an op `sending` when the app was
 * killed, a lost response and an `upgradeRequired` re-queue all keep their opId, which is what makes losing the
 * answer safe.
 */
describe('6d. a user’s retry is a new operation', () => {
  it('DOS-046 the fake server answers a replayed rejection as replayed AND rejected, like sync.service.ts', async () => {
    const server = new FakeServer(TABLES)
    const transport = server.transport()
    const op = {
      opId: 'op-1',
      table: 'sales_orders',
      id: 'o1',
      op: 'PUT' as const,
      data: {},
      idempotencyKey: 'op-1',
      clientTime: '2026-09-06T06:00:00.000Z',
    }
    server.rejections.set('op-1', { code: 'picklist_closed', messageEn: 'The wave is not open' })

    const first = await transport.upload({ deviceId: 'device-1', protocol: 1, ops: [op] })
    expect(first.rejected.map((one) => one.code)).toEqual(['picklist_closed'])
    expect(first.replayed).toBe(0)

    // The cause is gone on the server — and it changes nothing for THIS opId, which already has an outcome.
    server.rejections.delete('op-1')
    const again = await transport.upload({ deviceId: 'device-1', protocol: 1, ops: [op] })
    expect(again.replayed).toBe(1)
    expect(again.accepted).toBe(0)
    expect(again.rejected.map((one) => one.code)).toEqual(['picklist_closed'])
  })

  it('DOS-046 Try it again sends the intent under a NEW opId and is accepted once the cause is gone', async () => {
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
    server.rejections.set(opId, {
      code: 'picklist_closed',
      messageEn: 'Picklist PICK-0224 is picked; it is no longer being picked',
    })
    await engine.flush()
    expect(engine.status().rejected).toBe(1)
    const before = (await engine.outbox()).find((row) => row.opId === opId)

    // The wave is being picked again: the reason the office gave is gone.
    server.rejections.delete(opId)
    server.uploadCalls.length = 0
    const next = await engine.retry(opId)
    await engine.flush()

    expect(next).not.toBeNull()
    expect(next).not.toBe(opId)
    expect(server.uploadCalls[0]?.ops[0]?.opId).toBe(next)
    expect(server.applied.get(next ?? '')).toBe(1)
    // The old opId is never sent again: its outcome is the server's, for ever.
    expect(server.uploadCalls.flatMap((call) => call.ops.map((one) => one.opId))).not.toContain(
      opId,
    )

    const after = (await engine.outbox()).find((row) => row.opId === next)
    expect(after?.status).toBe('acked')
    expect(after?.idempotencyKey).toBe(next)
    // Same intent, same place in the queue: an order still goes before its lines.
    expect(after?.seq).toBe(before?.seq)
    expect(after?.createdAt).toBe(before?.createdAt)
    expect(after?.data).toEqual({ retailer_id: 'r1' })
    expect(await engine.outbox()).toHaveLength(1)

    const row = await engine.getRow<{ _pending: string | null }>('sales_orders', 'o1')
    expect(row?._pending).toBeNull()
    expect(engine.status().rejected).toBe(0)
    expect(await engine.needsAttention()).toEqual([])
    await engine.stop()
  })

  it('DOS-046 the old rejection never comes back from the errors pull, even while the retry waits to go', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    /*
     * A phone that can READ and not WRITE — the dead spot that lasts exactly as long as one POST. The queue goes
     * out before the handshake and the pull on every path the engine schedules (DOS-183), so this is how the
     * errors pull is made to run while the retry is still queued, which is the race the finding's tray is in.
     */
    const base = server.transport()
    let sendable = true
    const engine = new SyncEngine({
      transport: {
        ...base,
        upload: async (input) => {
          if (!sendable) throw new TypeError('Failed to fetch')
          return base.upload(input)
        },
      },
      deviceId: 'device-1',
      storeFactory: fixedStoreFactory(store),
      pullIntervalMs: 0,
      now,
    })
    await engine.start()

    const opId = await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.rejections.set(opId, { code: 'picklist_closed', messageEn: 'The wave is not open' })
    await engine.flush()
    expect(engine.status().rejected).toBe(1)

    // The wave is open again and the picker presses the button, but nothing can be sent yet.
    sendable = false
    server.rejections.delete(opId)
    const next = await engine.retry(opId)
    // The server still holds the refusal for the OLD opId, unresolved, and the tray pull will list it.
    server.serverErrors = [
      {
        id: 'e1',
        opId,
        table: 'sales_orders',
        rowId: 'o1',
        code: 'picklist_closed',
        messageEn: 'The wave is not open',
        messageHi: 'वेव खुली नहीं है',
        deviceId: 'device-1',
        createdAt: '2026-09-06T06:00:00.000Z',
        resolved: false,
        resolvedAt: null,
      },
    ]
    await engine.sync('again')

    expect(await engine.needsAttention()).toEqual([])
    expect(engine.status().rejected).toBe(0)
    const kept = await store.query<{ retried_as: string | null }>(
      `SELECT retried_as FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`,
      [opId],
    )
    expect(kept[0]?.retried_as).toBe(next)
    expect((await engine.outbox())[0]?.status).toBe('queued')

    // The signal comes back: the retry goes out and is accepted, and the old rejection stays gone.
    sendable = true
    await engine.flush()
    expect(server.applied.get(next ?? '')).toBe(1)
    expect(await engine.needsAttention()).toEqual([])
    await engine.stop()
  })

  it('DOS-046 a retry refused again is ONE tray item, and the chain stays readable', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    server.queuePull({ changes: [] })
    const engine = engineOn(store, server)
    await engine.start()

    const opId = await engine.enqueue({ table: 'sales_orders', id: 'o1', op: 'PUT', data: {} })
    server.rejections.set(opId, { code: 'picklist_closed', messageEn: 'The wave is not open' })
    await engine.flush()

    const next = await engine.retry(opId)
    if (next !== null) {
      server.rejections.set(next, { code: 'picklist_closed', messageEn: 'The wave is not open' })
    }
    await engine.flush()

    const tray = await engine.needsAttention()
    expect(tray).toHaveLength(1)
    expect(tray[0]?.error.opId).toBe(next)
    expect(tray[0]?.op?.opId).toBe(next)
    expect(engine.status().rejected).toBe(1)
    const old = await store.query<{ retried_as: string | null }>(
      `SELECT retried_as FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`,
      [opId],
    )
    expect(old[0]?.retried_as).toBe(next)
    await engine.stop()
  })

  it('DOS-046 a retry of a rejection this install no longer holds returns null and changes nothing', async () => {
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
    server.uploadCalls.length = 0

    expect(await engine.retry('op-from-yesterday')).toBeNull()
    expect(server.uploadCalls).toEqual([])
    expect(await engine.needsAttention()).toHaveLength(1)
    const untouched = await store.query<{ retried_as: string | null }>(
      `SELECT retried_as FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`,
      ['op-from-yesterday'],
    )
    expect(untouched[0]?.retried_as).toBeNull()
    await engine.stop()
  })

  /*
   * The MEMORY engine cannot tell a missing column from a NULL one — `select` answers `row[name] ?? null` and
   * `update` writes whatever key it is given (`sql.ts`), because it is a map with SQL over it. Real SQLite, which
   * is what a phone and an OPFS browser run, answers "no such column" and would take the tray down on a file
   * written by the build before this one. So the upgrade is asserted where it is actually decided: the column is
   * in the CREATE for a new file, and in the ALTER list for one that already exists (DOS-178 set that pattern
   * with `handed_over_at`; the ALTER is idempotent by failure, which is why it runs best effort).
   */
  it('DOS-046 retried_as is created on a new device file and added to one that already exists', () => {
    const errors = SYSTEM_TABLE_STATEMENTS.find((statement) =>
      statement.includes(`CREATE TABLE IF NOT EXISTS ${SYNC_ERRORS_TABLE}`),
    )
    expect(errors).toMatch(/retried_as TEXT/)
    expect(SYSTEM_TABLE_ADDITIONS).toContain(
      `ALTER TABLE ${SYNC_ERRORS_TABLE} ADD COLUMN retried_as TEXT`,
    )
  })
})
