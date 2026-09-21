/**
 * docs/31 §4 — ONE INSTALL, so signing out is a device-wide thing (architect's amendment on DOS-167).
 *
 * With six apps, signing out of the delivery app could only ever reach the delivery store: the sales
 * app was a different install with its own storage. With one app it is one install, and the owner who
 * drives on Tuesday afternoons has both a `dos-sales` file and a `dos-delivery` file under the same
 * person and the same distributor. A sign-out that swept only the running engine's prefix would leave
 * the other one on a van phone he hands over at the end of the shift.
 *
 * What does NOT change is the file name: `storeNameFor` still keys on person + distributor and
 * deliberately ignores the role, and the three prefixes already named a role rather than a codebase
 * (`identity.test.ts` pins both). What changes is only how many of them a leave flow enumerates.
 *
 * The sibling rule is unchanged and is the point: a file with nothing unsent is deleted, a file still
 * holding work is KEPT and reported. Nobody's work is thrown away to tidy a device.
 */
import { describe, expect, it } from 'vitest'

import { FIELD_STORE_PREFIXES, SyncEngine, storeNameFor, type SyncEngineOptions } from './engine.js'
import { OUTBOX_TABLE } from './schema.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, tableManifest } from './test-support.js'
import type { StoreFactory, SyncIdentity, SyncStore } from './types.js'

const ORDERS = tableManifest(
  'sales_orders',
  [column('id'), column('retailer_id'), column('state'), column('updated_at')],
  { writable: true },
)
const TABLES = [ORDERS]

const SUNIL = '01924f9a-0000-7000-8000-0000000000b1'
const TARSUN = '01924f9a-0000-7000-8000-0000000000aa'
const SAI = '01924f9a-0000-7000-8000-0000000000ab'

/** One person, one distributor — the elected role is deliberately NOT part of the file name. */
const AT_TARSUN: SyncIdentity = { userId: SUNIL, tenantId: TARSUN, role: 'delivery' }
const AT_SAI: SyncIdentity = { userId: SUNIL, tenantId: SAI, role: 'delivery' }

const now = (): number => Date.parse('2026-09-21T06:00:00.000Z')

function phone(): { factory: StoreFactory; files: Map<string, SyncStore> } {
  const files = new Map<string, SyncStore>()
  const factory: StoreFactory = async (name) => {
    const held = files.get(name) ?? createMemoryStore()
    files.set(name, held)
    return held
  }
  return { factory, files }
}

describe('docs/31 §4 the three field prefixes of one install', () => {
  it('names the three field stores and never the harness one', () => {
    expect([...FIELD_STORE_PREFIXES].sort()).toEqual(['dos-delivery', 'dos-sales', 'dos-warehouse'])
    expect(FIELD_STORE_PREFIXES).not.toContain('dos-harness')
  })

  it('gives one person at one distributor a separate file per elected role', () => {
    const names = FIELD_STORE_PREFIXES.map((prefix) => storeNameFor(prefix, AT_TARSUN))
    expect(new Set(names).size).toBe(3)
  })
})

describe('docs/31 §4 a sign-out sweeps every role this device could have opened', () => {
  it('deletes the empty sales file a sign-out from the DELIVERY group would once have left behind', async () => {
    const { factory, files } = phone()
    const server = new FakeServer(TABLES)
    const options = (prefix: string, identity: SyncIdentity): SyncEngineOptions => ({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: factory,
      databaseName: storeNameFor(prefix, identity),
      identity,
      pullIntervalMs: 0,
      now,
    })

    // The morning: this person elected `salesperson` and everything reached the office.
    const morning = new SyncEngine(options('dos-sales', AT_TARSUN))
    await morning.start()
    await morning.stop()
    // The afternoon: the same person elected `delivery`, and one delivery is still waiting.
    const afternoon = new SyncEngine(options('dos-delivery', AT_TARSUN))
    await afternoon.start()
    server.offline = true
    await afternoon.enqueue({ table: 'sales_orders', id: 'o-late', op: 'PUT', data: {} })
    await afternoon.flush()
    await afternoon.stop()
    server.offline = false

    const swept = await SyncEngine.sweepDeviceStores(factory, FIELD_STORE_PREFIXES, [AT_TARSUN])

    // The morning's file is gone; the afternoon's is kept because it still holds a delivery.
    expect(swept.destroyed).toBe(2) // sales (emptied) and warehouse (never used, opened and dropped)
    expect(swept.kept).toEqual([{ identity: AT_TARSUN, pending: 1 }])

    const sales = files.get(storeNameFor('dos-sales', AT_TARSUN))
    await expect(sales?.query('SELECT * FROM _sync_state')).rejects.toThrow(/no such table/)
    const delivery = files.get(storeNameFor('dos-delivery', AT_TARSUN))
    expect(await delivery?.query(`SELECT row_id, status FROM ${OUTBOX_TABLE}`)).toEqual([
      { row_id: 'o-late', status: 'queued' },
    ])
  })

  it('reaches the person s OTHER distributors under every prefix, not only the current one', async () => {
    const { factory, files } = phone()
    const server = new FakeServer(TABLES)
    const sales = new SyncEngine({
      transport: server.transport(),
      deviceId: 'device-1',
      storeFactory: factory,
      databaseName: storeNameFor('dos-sales', AT_SAI),
      identity: AT_SAI,
      pullIntervalMs: 0,
      now,
    })
    await sales.start()
    await sales.stop()

    const swept = await SyncEngine.sweepDeviceStores(factory, FIELD_STORE_PREFIXES, [
      AT_TARSUN,
      AT_SAI,
    ])

    expect(swept.kept).toEqual([])
    const file = files.get(storeNameFor('dos-sales', AT_SAI))
    await expect(file?.query('SELECT * FROM _sync_state')).rejects.toThrow(/no such table/)
  })

  it('never deletes a file it could not count, whichever prefix it is under', async () => {
    const files = new Map<string, SyncStore>()
    const deletions: string[] = []
    const factory: StoreFactory = async (name) => {
      if (name === storeNameFor('dos-warehouse', AT_TARSUN)) {
        return {
          query: () => Promise.reject(new Error('disk image is malformed')),
          run: () => Promise.reject(new Error('disk image is malformed')),
          transaction: () => Promise.reject(new Error('disk image is malformed')),
          close: () => Promise.resolve(),
          destroy: () => {
            deletions.push(name)
            return Promise.resolve()
          },
        } as unknown as SyncStore
      }
      const held = files.get(name) ?? createMemoryStore()
      files.set(name, held)
      return held
    }
    const logged: string[] = []

    const swept = await SyncEngine.sweepDeviceStores(
      factory,
      FIELD_STORE_PREFIXES,
      [AT_TARSUN],
      (line) => logged.push(line),
    )

    expect(deletions).toEqual([])
    expect(logged.some((line) => line.includes('sweep skipped a store'))).toBe(true)
    // The two it could count are still deleted: one bad file never stops the rest of the sweep.
    expect(swept.destroyed).toBe(2)
  })
})
