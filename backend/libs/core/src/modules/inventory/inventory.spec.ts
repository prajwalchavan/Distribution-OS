import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  locations,
  manufacturers,
  memberships,
  products,
  productVariants,
  reservations,
  stockLedger,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { InventoryModule, InventoryService } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Balance = { lotId: string; locationId: string; onHand: number; reserved: number }
type Entry = { id: string; reason: string; qtyDelta: number; lotId: string }

describeDb('inventory (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const variantId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const lotLate = uuidv7() // expires later
  const lotEarly = uuidv7() // expires earlier -> FEFO picks it first
  let godown = ''
  let transit = ''
  let app: NestFastifyApplication
  let inventory: InventoryService

  /** Run a core-service call the way a module would: inside tenant context and one withTenant transaction. */
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `inv-${run}`, legalName: 'Inventory test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91902${run}1`, name: 'Owner' },
      { id: repId, phone: `+91902${run}2`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker inv ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Makhana' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Makhana 12 g',
      netQty: 12,
      netUnit: 'g',
      defaultCaseSize: 90,
      hsnCode: '2008',
      mrpPaise: 1000,
    })
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    transit = locs.find((l) => l.kind === 'in_transit')?.id ?? ''
    app = await bootTestApp([InventoryModule])
    inventory = app.get(InventoryService)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('creates lots and posts opening stock; replay of the same key is a no-op', async () => {
    for (const [id, batchNo, expiryDate] of [
      [lotLate, 'L2', '2027-06-01'],
      [lotEarly, 'L1', '2027-03-01'],
    ] as const) {
      const lot = await call<{ item: { id: string }; created: boolean }>(
        app,
        owner,
        'POST',
        '/inventory/lots',
        { idempotencyKey: `lot-${id}`, id, variantId, batchNo, mrpPaise: 1000, expiryDate },
      )
      expect(lot.status).toBe(200)
      expect(lot.body.created).toBe(true)
      expect(lot.body.item.id).toBe(id)
    }
    const open = {
      idempotencyKey: `open-${lotLate}`,
      lotId: lotLate,
      locationId: godown,
      qtyDelta: 20,
      reason: 'opening',
    }
    const first = await call<{ entry: Entry; balance: Balance }>(
      app,
      owner,
      'POST',
      '/inventory/adjustments',
      open,
    )
    expect(first.status).toBe(200)
    expect(first.body.entry.reason).toBe('opening')
    expect(first.body.balance.onHand).toBe(20)
    const again = await call<{ entry: Entry; balance: Balance }>(
      app,
      owner,
      'POST',
      '/inventory/adjustments',
      open,
    )
    expect(again.body).toEqual(first.body)
    const other = await call<{ balance: Balance }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `open-${lotEarly}`,
      lotId: lotEarly,
      locationId: godown,
      qtyDelta: 20,
      reason: 'opening',
    })
    expect(other.body.balance.onHand).toBe(20)
    const rows = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and reason = 'opening'`,
      )
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(2)
  })

  it('answers 409, never 500, when a client id already names a different lot', async () => {
    const reused = await call<{ message: string }>(app, owner, 'POST', '/inventory/lots', {
      idempotencyKey: `lot-clash-${run}`,
      id: lotEarly, // already taken by (variantId, 'L1', 1000)
      variantId,
      batchNo: 'L9',
      mrpPaise: 5000,
      expiryDate: '2028-01-01',
    })
    expect(reused.status).toBe(409)
    expect(reused.body.message).toContain('already in use')
    // the clash rolled back cleanly: no half-written lot, and the original is untouched
    const lots = (
      await db.execute(
        sql`select batch_no, mrp_paise::int as mrp_paise from stock_lots
            where tenant_id = ${tenantId} and id = ${lotEarly}`,
      )
    ).rows as { batch_no: string; mrp_paise: number }[]
    expect(lots).toEqual([{ batch_no: 'L1', mrp_paise: 1000 }])
  })

  it('returns the existing lot when the same batch is upserted under a fresh id', async () => {
    const again = await call<{ item: { id: string }; created: boolean }>(
      app,
      owner,
      'POST',
      '/inventory/lots',
      {
        idempotencyKey: `lot-same-${run}`,
        id: uuidv7(),
        variantId,
        batchNo: 'L1',
        mrpPaise: 1000,
        expiryDate: '2027-03-01',
      },
    )
    expect(again.status).toBe(200)
    expect(again.body.created).toBe(false)
    expect(again.body.item.id).toBe(lotEarly)
  })

  it('moves pieces between locations as a transfer_out/transfer_in pair', async () => {
    const res = await call<{ from: Balance; to: Balance; out: Entry; in: Entry }>(
      app,
      owner,
      'POST',
      '/inventory/transfers',
      {
        idempotencyKey: `xfer-${run}`,
        lotId: lotLate,
        fromLocationId: godown,
        toLocationId: transit,
        qtyPcs: 5,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.from.onHand).toBe(15)
    expect(res.body.to.onHand).toBe(5)
    expect(res.body.out.qtyDelta).toBe(-5)
    expect(res.body.in.qtyDelta).toBe(5)
    const balances = await call<{ items: Balance[] }>(app, owner, 'GET', '/inventory/balances', {
      lotId: lotLate,
    })
    expect(balances.status).toBe(200)
    expect(balances.body.items.map((b) => [b.locationId, b.onHand])).toEqual(
      expect.arrayContaining([
        [godown, 15],
        [transit, 5],
      ]),
    )
  })

  it('refuses to take stock below zero with a clear error', async () => {
    const res = await call<{ message: string }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `neg-${run}`,
      lotId: lotLate,
      locationId: godown,
      qtyDelta: -100,
      reason: 'damage',
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toContain(lotLate)
    expect(res.body.message).toContain(godown)
    const balances = await call<{ items: Balance[] }>(app, owner, 'GET', '/inventory/balances', {
      lotId: lotLate,
      locationId: godown,
    })
    expect(balances.body.items[0]?.onHand).toBe(15)
  })

  const orderLineId = uuidv7()

  it('reserves FEFO: the earlier-expiry lot first, then the next one', async () => {
    const held = await asOwner((tx) =>
      inventory.reserve(tx, { orderLineId, variantId, locationId: godown, qtyPcs: 25 }),
    )
    expect(held.map((r) => [r.lotId, r.qty])).toEqual([
      [lotEarly, 20],
      [lotLate, 5],
    ])
    // second call for the same line is idempotent
    const again = await asOwner((tx) =>
      inventory.reserve(tx, { orderLineId, variantId, locationId: godown, qtyPcs: 25 }),
    )
    expect(again.map((r) => r.id)).toEqual(held.map((r) => r.id))
    // ATP drops: the early lot is fully promised and disappears from the sellable view
    const sellable = await call<{ items: { lotId: string; available: number }[] }>(
      app,
      rep,
      'GET',
      '/inventory/sellable',
      { variantId, locationId: godown },
    )
    expect(sellable.status).toBe(200)
    expect(sellable.body.items.map((i) => [i.lotId, i.available])).toEqual([[lotLate, 10]])
    // asking for more than the location holds fails without holding anything
    await expect(
      asOwner((tx) =>
        inventory.reserve(tx, {
          orderLineId: uuidv7(),
          variantId,
          locationId: godown,
          qtyPcs: 11,
        }),
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('posts the reservation as sale rows and releases the hold', async () => {
    const result = await asOwner((tx) =>
      inventory.postReservationAsSale(tx, orderLineId, 'order_line', orderLineId, `pick-${run}`),
    )
    expect(result.entries.map((e) => [e.lotId, e.qtyDelta, e.reason])).toEqual([
      [lotEarly, -20, 'sale'],
      [lotLate, -5, 'sale'],
    ])
    const balances = await call<{ items: Balance[] }>(app, owner, 'GET', '/inventory/balances', {
      locationId: godown,
    })
    const byLot = Object.fromEntries(balances.body.items.map((b) => [b.lotId, b]))
    expect(byLot[lotEarly]).toMatchObject({ onHand: 0, reserved: 0 })
    expect(byLot[lotLate]).toMatchObject({ onHand: 10, reserved: 0 })
    const rows = await db
      .select()
      .from(reservations)
      .where(sql`${reservations.orderLineId} = ${orderLineId}`)
    expect(rows.every((r) => r.state === 'posted')).toBe(true)
    // replaying the same pick key writes nothing new
    const replay = await asOwner((tx) =>
      inventory.postReservationAsSale(tx, orderLineId, 'order_line', orderLineId, `pick-${run}`),
    )
    expect(replay.entries).toHaveLength(0)
    const ledger = await call<{ items: Entry[] }>(app, owner, 'GET', '/inventory/ledger', {
      locationId: godown,
    })
    expect(ledger.status).toBe(200)
    expect(ledger.body.items.filter((e) => e.reason === 'sale')).toHaveLength(2)
  })

  it('shows a rep sellable stock only, never balances, adjustments or the ledger', async () => {
    const sellable = await call<{ items: Record<string, unknown>[] }>(
      app,
      rep,
      'GET',
      '/inventory/sellable',
      { q: 'makhana' },
    )
    expect(sellable.status).toBe(200)
    expect(sellable.body.items.length).toBeGreaterThan(0)
    for (const row of sellable.body.items)
      for (const key of Object.keys(row))
        expect(key.toLowerCase()).not.toMatch(/cost|purchase|margin|ptd|on_?hand|reserved/)
    expect((await call(app, rep, 'GET', '/inventory/balances', {})).status).toBe(403)
    expect((await call(app, rep, 'GET', '/inventory/ledger', {})).status).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/inventory/adjustments', {
          idempotencyKey: `rep-adj-${run}`,
          lotId: lotLate,
          locationId: godown,
          qtyDelta: 1,
          reason: 'adjustment',
        })
      ).status,
    ).toBe(403)
  })

  it('keeps the ledger append-only even for the owner', async () => {
    await expect(
      withTenant(db, ownerCtx, (tx) =>
        tx
          .update(stockLedger)
          .set({ qtyDelta: 999 })
          .where(sql`${stockLedger.tenantId} = ${tenantId}`),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as { message?: string; cause?: { message?: string } }
      return /append-only/.test(err.cause?.message ?? err.message ?? '')
    })
  })

  it('refuses requests without tenant context', async () => {
    expect((await call(app, null, 'GET', '/inventory/sellable', {})).status).toBe(401)
  })
})
