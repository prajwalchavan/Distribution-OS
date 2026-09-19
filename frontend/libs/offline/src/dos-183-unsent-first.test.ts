/**
 * DOS-183 — unsent work goes FIRST (founder answer A, 2026-09-14; docs/27 §13 test 17).
 *
 * DOS-167 kept the queue on the device for that person; this file proves the clause that still failed on a real
 * browser: the queue is SENT before anything is pulled, on every path the engine schedules for itself — the start
 * over a file that kept its read set, the reconnect, and the poll tick. Measured red on main: run B uploaded at
 * +60 753 ms (the poll), run C made no call at all for 49.5 s after a genuine `online` event.
 *
 * The clock here is the TRANSPORT'S CALL ORDER, never wall-clock and never the poll interval: `recording()` writes
 * down which call answered, and every assertion below reads that list. `FakeServer.applied` is the second half of
 * the guarantee — an op that goes first must still go exactly once.
 */
import { describe, expect, it, vi } from 'vitest'

import { SyncEngine, type SyncEngineOptions } from './engine.js'
import { OUTBOX_TABLE } from './schema.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, recording, tableManifest } from './test-support.js'
import type { SqlValue, SyncIdentity, SyncStore, SyncTransport } from './types.js'

const RETAILERS = tableManifest('retailers', [column('id'), column('name'), column('updated_at')])

const ORDERS = tableManifest(
  'sales_orders',
  [column('id'), column('retailer_id'), column('state'), column('updated_at')],
  { writable: true },
)

const TABLES = [RETAILERS, ORDERS]

/** One rep of one distributor: the same person signing in again on the same device. */
const RAHUL: SyncIdentity = { userId: 'rahul', tenantId: 'tarsun', role: 'salesperson' }

const CHAVAN = { id: 'r-chavan', name: 'Chavan Kirana Stores' }

const now = (): number => Date.parse('2026-09-14T12:00:00.000Z')

function engineOn(
  store: SyncStore,
  transport: SyncTransport,
  extra: Partial<SyncEngineOptions> = {},
): SyncEngine {
  return new SyncEngine({
    transport,
    deviceId: 'device-1',
    storeFactory: fixedStoreFactory(store),
    pullIntervalMs: 0,
    identity: RAHUL,
    now,
    ...extra,
  })
}

async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('DOS-183 the queue goes before the handshake and the pull', () => {
  it('DOS-183 a start over a file that still holds its read set sends the queue before the handshake and the pull', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    const order: string[] = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })

    // Rahul's phone: a snapshot pulled to cursor c1, then an order taken in a dead spot.
    const before = engineOn(store, recording(server, order))
    await before.start()
    server.offline = true
    const opId = await before.enqueue({
      table: 'sales_orders',
      id: 'o-queued',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id, state: 'draft' },
    })
    await before.flush()
    expect(before.status().pending).toBe(1)
    /*
     * NOT `end()`: a forced sign-out from another tab, a crash, a closed window. The manifest and the cursor stay in
     * the file, so the next start is "not stale" and `applyManifest`'s own flush guard never fires — the shape the
     * browser run measured.
     */
    await before.stop()
    server.offline = false

    server.pulls = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c2',
    })
    const mark = order.length
    const pullsBefore = server.pullCalls.length

    const back = engineOn(store, recording(server, order))
    await back.start()

    expect(order.slice(mark)).toEqual(['upload', 'manifest', 'pull'])
    expect(server.uploadCalls.at(-1)?.ops.map((op) => op.opId)).toEqual([opId])
    // The read set was KEPT, so this is a delta from where the file stood.
    expect(server.pullCalls[pullsBefore]?.since).toBe('c1')
    expect(back.status().pending).toBe(0)
    expect(server.applied.get(opId)).toBe(1)
    await back.stop()
  })

  it('DOS-183 the poll drains the queue before it pulls', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    const order: string[] = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })

    const engine = engineOn(store, recording(server, order), { pullIntervalMs: 30 })
    await engine.start()

    /*
     * A row put straight into the outbox, the way a crash leaves one: `enqueue` would have kicked its own flush, and
     * what is under test here is the TICK. From this mark the next three calls belong to the poll alone.
     */
    await store.exec(
      `INSERT INTO ${OUTBOX_TABLE}
         (op_id, tbl, row_id, op, data, base_updated_at, idempotency_key, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'queued', 0, ?)`,
      [
        'op-crash',
        'sales_orders',
        'o-crash',
        'PUT',
        JSON.stringify({ retailer_id: CHAVAN.id, state: 'draft' }),
        'op-crash',
        '2026-09-14T11:00:00.000Z',
      ] satisfies SqlValue[],
    )
    const mark = order.length
    await tick(16)
    await engine.stop()

    expect(order.slice(mark, mark + 3)).toEqual(['upload', 'manifest', 'pull'])
    expect(server.applied.get('op-crash')).toBe(1)
  })

  it('DOS-183 a page that booted with no network drains the moment the radio is reported back', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    const order: string[] = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })

    // Yesterday, in signal: the manifest and a snapshot are in the file.
    const yesterday = engineOn(store, recording(server, order))
    await yesterday.start()
    await yesterday.stop()

    // This morning the page boots in a dead spot: it opens its file, and its handshake fails.
    server.offline = true
    /*
     * `navigator.onLine` is already true inside the browser's own `online` handler — that is exactly what made the
     * engine believe it had nothing to do. The hint says what the PLATFORM saw; the engine must decide on what IT knew.
     */
    const engine = engineOn(store, recording(server, order), { networkHint: () => true })
    await engine.start()
    expect(engine.status().ready).toBe(true)
    expect(engine.status().online).toBe(false)
    const opId = await engine.enqueue({
      table: 'sales_orders',
      id: 'o-booted-offline',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id, state: 'draft' },
    })
    await engine.flush()
    expect(engine.status().pending).toBe(1)

    server.offline = false
    const mark = order.length
    /*
     * The ONLY thing that happens from here is the hint. No screen calls `flush()` on an `online` event, and calling
     * one here would prove nothing: the engine itself has to act on the news.
     */
    engine.setNetworkHint(true)
    await tick(8)

    expect(order.slice(mark, mark + 3)).toEqual(['upload', 'manifest', 'pull'])
    expect(
      server.uploadCalls.filter((call) => call.ops.some((op) => op.opId === opId)),
    ).toHaveLength(1)
    expect(server.applied.get(opId)).toBe(1)
    expect(engine.status().online).toBe(true)
    expect(engine.status().pending).toBe(0)
    await engine.stop()
  })

  /**
   * A GUARD, not a red: today's `setNetworkHint` already fires here (a `false` hint was given first, so `was` is
   * false), and this passes before the fix as well as after. It is written down because R2 clears the retry timer
   * that the failed upload armed, and the thing to be sure of is that one op is still sent exactly once.
   */
  it('DOS-183 a reconnect and a retry never send an op twice', async () => {
    vi.useFakeTimers()
    try {
      const store = createMemoryStore()
      const server = new FakeServer(TABLES)
      const order: string[] = []
      server.queuePull({
        changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
        cursor: 'c1',
      })
      const engine = engineOn(store, recording(server, order))
      await engine.start()

      // A dead spot: the failed upload arms the retry timer.
      server.offline = true
      engine.setNetworkHint(false)
      const opId = await engine.enqueue({
        table: 'sales_orders',
        id: 'o-twice',
        op: 'PUT',
        data: { retailer_id: CHAVAN.id, state: 'draft' },
      })
      await engine.flush()
      expect(engine.status().pending).toBe(1)

      // The radio comes back; the retry timer would have fired for the same op.
      server.offline = false
      engine.setNetworkHint(true)
      await vi.advanceTimersByTimeAsync(5_000)
      await engine.flush()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(server.applied.get(opId)).toBe(1)
      expect(
        server.uploadCalls.filter((call) => call.ops.some((op) => op.opId === opId)),
      ).toHaveLength(1)
      expect(engine.status().pending).toBe(0)
      await engine.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('DOS-183 a flush that throws neither blocks the pull nor kills the chain', async () => {
    const store = createMemoryStore()
    const server = new FakeServer(TABLES)
    const order: string[] = []
    server.queuePull({
      changes: [{ table: 'retailers', rows: [CHAVAN], deleted: [] }],
      cursor: 'c1',
    })

    const first = engineOn(store, recording(server, order))
    await first.start()
    server.offline = true
    const opId = await first.enqueue({
      table: 'sales_orders',
      id: 'o-store-error',
      op: 'PUT',
      data: { retailer_id: CHAVAN.id, state: 'draft' },
    })
    await first.flush()
    await first.stop()
    server.offline = false

    // The device store throws ONCE, on the claim the flush makes — a disk that blinked, not a network failure.
    let thrown = false
    const flaky: SyncStore = {
      persistent: store.persistent,
      kind: store.kind,
      exec: (sql, params) => store.exec(sql, params),
      transaction: (fn) => store.transaction(fn),
      close: () => store.close(),
      query: async <T>(sql: string, params?: readonly SqlValue[]): Promise<T[]> => {
        if (!thrown && sql.includes(OUTBOX_TABLE) && sql.includes("status = 'queued'")) {
          thrown = true
          throw new Error('device store unavailable')
        }
        return store.query<T>(sql, params)
      },
    }

    const logged: string[] = []
    const mark = order.length
    const engine = engineOn(flaky, recording(server, order), {
      onLog: (message) => logged.push(message),
    })
    // The start resolves — a store error on the queue is never a device that will not sign in.
    await expect(engine.start()).resolves.toBeUndefined()
    expect(order.slice(mark)).toEqual(['manifest', 'pull'])
    // The strip is told WHICH step failed, and the pull that followed it still cleared `lastError`.
    expect(
      logged.filter((line) => /^flush\(start\): device store unavailable$/.test(line)),
    ).toHaveLength(1)

    // ...and the chain is alive: the very next flush sends the op that was waiting.
    const uploadsBefore = server.uploadCalls.length
    await engine.flush()
    expect(server.uploadCalls.length).toBe(uploadsBefore + 1)
    expect(server.applied.get(opId)).toBe(1)
    expect(engine.status().pending).toBe(0)
    await engine.stop()
  })
})
