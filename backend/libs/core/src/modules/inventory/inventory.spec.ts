import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  AdjustStockInput,
  PostCycleCountInput,
  TransferStockInput,
  UpsertLocationInput,
  UpsertLotInput,
} from '@dos/contracts'
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
import { CycleCountsService } from './cycle-counts.service.js'
import { InventoryModule, InventoryService } from './index.js'
import { StockService } from './stock.service.js'

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
  /** DOS-054 works on its own variants, so no FEFO expectation above it moves. */
  const shelfVariantId = uuidv7()
  const shelfGuardVariantId = uuidv7()
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
    await db.insert(productVariants).values([
      {
        id: variantId,
        productId,
        name: 'Makhana 12 g',
        netQty: 12,
        netUnit: 'g',
        defaultCaseSize: 90,
        hsnCode: '2008',
        mrpPaise: 1000,
      },
      {
        id: shelfVariantId,
        productId,
        name: 'Makhana 24 g',
        netQty: 24,
        netUnit: 'g',
        defaultCaseSize: 45,
        hsnCode: '2008',
        mrpPaise: 2000,
      },
      {
        id: shelfGuardVariantId,
        productId,
        name: 'Makhana 36 g',
        netQty: 36,
        netUnit: 'g',
        defaultCaseSize: 30,
        hsnCode: '2008',
        mrpPaise: 3000,
      },
    ])
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
    const res = await call<{
      message: string
      data?: { lotId?: string; locationId?: string }
    }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `neg-${run}`,
      lotId: lotLate,
      locationId: godown,
      qtyDelta: -100,
      reason: 'damage',
    })
    expect(res.status).toBe(400)
    // The lot and the place the refusal is about (DOS-048 moved them out of the sentence into `data`).
    expect(res.body.data?.lotId).toBe(lotLate)
    expect(res.body.data?.locationId).toBe(godown)
    const balances = await call<{ items: Balance[] }>(app, owner, 'GET', '/inventory/balances', {
      lotId: lotLate,
      locationId: godown,
    })
    expect(balances.body.items[0]?.onHand).toBe(15)
  })

  it('DOS-048: the refusal names the item, its batch and the place in words, never a UUID, and keeps the ids in data', async () => {
    const res = await call<{
      message: string
      data?: { lotId?: string; locationId?: string; qtyDelta?: number }
    }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `neg-words-${run}`,
      lotId: lotLate,
      locationId: godown,
      qtyDelta: -100,
      reason: 'damage',
    })
    expect(res.status).toBe(400)
    // What the man at the bench reads: how many are really there, of what, in which batch, where.
    expect(res.body.message).toContain('15 pc')
    expect(res.body.message).toContain('Makhana 12 g')
    expect(res.body.message).toContain('L2')
    expect(res.body.message).toContain('Godown')
    // ...and never an id he cannot act on.
    expect(res.body.message).not.toContain(lotLate)
    expect(res.body.message).not.toContain(godown)
    expect(res.body.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)
    // The ids stay where a screen, a log or a support desk can still use them.
    expect(res.body.data).toMatchObject({ lotId: lotLate, locationId: godown, qtyDelta: -100 })
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

  it('runs a cycle count: open snapshots the expectation, the counter is told neither figure, post writes the differences once', async () => {
    // docs/23 §8.18 — STOCK_KEEPERS open and count, the owner or a manager posts; the accountant reads.
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const accountant: Actor = { tenantId, actorId: ownerId, role: 'accountant' }
    const before = (
      await db.execute(
        sql`select on_hand from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotLate} and location_id = ${godown}`,
      )
    ).rows[0] as { on_hand: number }
    const id = uuidv7()
    const opened = await call<{
      item: {
        status: string
        lineCount: number
        lines: { lotId: string; expectedPcs: number; countedPcs: number | null }[]
      }
    }>(app, store, 'POST', '/inventory/cycle-counts', {
      idempotencyKey: `cc-open-${run}`,
      id,
      locationId: godown,
      lotIds: [lotLate],
      note: 'weekly',
    })
    expect(opened.status).toBe(200)
    expect(opened.body.item.status).toBe('open')
    // QA DOS-045: the godown reads no target; the desk reads the open-time snapshot.
    expect(opened.body.item.lines).toEqual([
      expect.objectContaining({ lotId: lotLate, expectedPcs: null, countedPcs: null }),
    ])
    const deskOpen = await call<{ item: { lines: { expectedPcs: number | null }[] } }>(
      app,
      owner,
      'GET',
      `/inventory/cycle-counts/${id}`,
    )
    expect(deskOpen.body.item.lines[0]?.expectedPcs).toBe(Number(before.on_hand))
    // posting before counting is refused; the rep may not open a count at all
    expect(
      (
        await call(app, owner, 'POST', `/inventory/cycle-counts/${id}/post`, {
          idempotencyKey: `cc-post-early-${run}`,
          id,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await call(app, rep, 'POST', '/inventory/cycle-counts', {
          idempotencyKey: `cc-rep-${run}`,
          id: uuidv7(),
          locationId: godown,
        })
      ).status,
    ).toBe(403)
    const counted = await call<{
      item: { status: string; lines: { variancePcs: number | null }[] }
    }>(app, store, 'POST', `/inventory/cycle-counts/${id}/count`, {
      idempotencyKey: `cc-count-${run}`,
      id,
      lines: [{ lotId: lotLate, countedPcs: Number(before.on_hand) - 2 }],
    })
    expect(counted.status).toBe(200)
    expect(counted.body.item.status).toBe('counted')
    expect(counted.body.item.lines[0]?.variancePcs).toBeNull()
    const deskCounted = await call<{ item: { lines: { variancePcs: number | null }[] } }>(
      app,
      owner,
      'GET',
      `/inventory/cycle-counts/${id}`,
    )
    expect(deskCounted.body.item.lines[0]?.variancePcs).toBe(-2)
    // the godown may not post the difference into the books; the desk does, once
    expect(
      (
        await call(app, store, 'POST', `/inventory/cycle-counts/${id}/post`, {
          idempotencyKey: `cc-post-store-${run}`,
          id,
        })
      ).status,
    ).toBe(403)
    const posted = await call<{
      item: { status: string; postedBy: string | null }
      entries: { reason: string; qtyDelta: number }[]
    }>(app, owner, 'POST', `/inventory/cycle-counts/${id}/post`, {
      idempotencyKey: `cc-post-${run}`,
      id,
    })
    expect(posted.status).toBe(200)
    expect(posted.body.item.status).toBe('posted')
    expect(posted.body.item.postedBy).toBe(ownerId)
    expect(posted.body.entries).toEqual([
      expect.objectContaining({ reason: 'cycle_count', qtyDelta: -2 }),
    ])
    const after = (
      await db.execute(
        sql`select on_hand from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotLate} and location_id = ${godown}`,
      )
    ).rows[0] as { on_hand: number }
    expect(Number(after.on_hand)).toBe(Number(before.on_hand) - 2)
    const replay = await call<{ entries: unknown[] }>(
      app,
      owner,
      'POST',
      `/inventory/cycle-counts/${id}/post`,
      {
        idempotencyKey: `cc-post-${run}`,
        id,
      },
    )
    expect(replay.body.entries).toHaveLength(1) // the stored reply, not a second posting
    const ledger = await db.execute(
      sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and ref_type = 'cycle_count' and ref_id = ${id}`,
    )
    expect((ledger.rows[0] as { n: number }).n).toBe(1)
    // reads: the accountant lists and opens it; the rep sees nothing
    const list = await call<{ items: { id: string; status: string; lineCount: number }[] }>(
      app,
      accountant,
      'GET',
      '/inventory/cycle-counts',
      {
        locationId: godown,
        status: 'posted',
      },
    )
    expect(list.body.items.find((c) => c.id === id)).toMatchObject({
      status: 'posted',
      lineCount: 1,
    })
    expect((await call(app, accountant, 'GET', `/inventory/cycle-counts/${id}`)).status).toBe(200)
    expect((await call(app, rep, 'GET', `/inventory/cycle-counts/${id}`)).status).toBe(403)
  })

  it('filters balances to lots expiring before a date, or inside the near-expiry window', async () => {
    // L1 expires 2027-03-01, L2 on 2027-06-01
    const soon = await call<{ items: { lotId: string }[] }>(
      app,
      owner,
      'GET',
      '/inventory/balances',
      {
        expiringBefore: '2027-04-30',
      },
    )
    expect(soon.status).toBe(200)
    expect(soon.body.items.map((b) => b.lotId)).toContain(lotEarly)
    expect(soon.body.items.map((b) => b.lotId)).not.toContain(lotLate)
    const near = await call<{ items: { lotId: string }[] }>(
      app,
      owner,
      'GET',
      '/inventory/balances',
      { nearExpiryOnly: true },
    )
    expect(near.status).toBe(200)
  })

  it('DOS-044: a warehouse login cannot add stock by an adjustment or post opening stock (403 stock_add_desk_only, no ledger row, balance unchanged, replay refused) and still takes damaged stock off; a manager still adds', async () => {
    // docs/22 §8 (2026-09-13, QA DOS-044): only the owner or a manager puts pieces INTO the books by hand.
    // Its own lot, so the FEFO, sale and cycle-count expectations on lotLate/lotEarly stay untouched.
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const desk: Actor = { tenantId, actorId: ownerId, role: 'manager' }
    const lotId = uuidv7()
    const lot = await call<{ item: { id: string }; created: boolean }>(
      app,
      owner,
      'POST',
      '/inventory/lots',
      {
        idempotencyKey: `lot-dos044-${run}`,
        id: lotId,
        variantId,
        batchNo: `DOS044-${run}`,
        mrpPaise: 1000,
      },
    )
    expect(lot.status).toBe(200)
    expect(lot.body.item.id).toBe(lotId)
    const onHand = async (): Promise<number> => {
      const rows = (
        await db.execute(
          sql`select on_hand from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${godown}`,
        )
      ).rows as { on_hand: number }[]
      return Number(rows[0]?.on_hand)
    }
    const idempotencyRows = async (key: string): Promise<number> => {
      const rows = (
        await db.execute(
          sql`select count(*)::int as n from idempotency_keys where tenant_id = ${tenantId} and key = ${key}`,
        )
      ).rows as { n: number }[]
      return Number(rows[0]?.n)
    }
    const opened = await call<{ entry: Entry; balance: Balance }>(
      app,
      owner,
      'POST',
      '/inventory/adjustments',
      {
        idempotencyKey: `dos044-open-${run}`,
        lotId,
        locationId: godown,
        qtyDelta: 10,
        reason: 'opening',
      },
    )
    expect(opened.status).toBe(200)
    expect(opened.body.balance.onHand).toBe(10)

    type Refusal = { message: string; data?: { code?: string } }
    const probes = [
      { idempotencyKey: `dos044-huge-opening-${run}`, qtyDelta: 100000, reason: 'opening' },
      { idempotencyKey: `dos044-add-adjustment-${run}`, qtyDelta: 5, reason: 'adjustment' },
      { idempotencyKey: `dos044-add-cycle-${run}`, qtyDelta: 5, reason: 'cycle_count' },
      { idempotencyKey: `dos044-minus-opening-${run}`, qtyDelta: -1, reason: 'opening' },
    ] as const
    const send = (probe: (typeof probes)[number]) =>
      call<Refusal>(app, store, 'POST', '/inventory/adjustments', {
        ...probe,
        lotId,
        locationId: godown,
        note: 'DOS-044 probe',
      })
    for (const probe of probes) {
      const res = await send(probe)
      const label = `warehouse ${probe.reason} ${String(probe.qtyDelta)}`
      expect(res.status, label).toBe(403)
      expect(res.body.data?.code, label).toBe('stock_add_desk_only')
      expect(res.body.message, label).toMatch(/owner or a manager/)
      expect(res.body.message, label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    }
    // a replayed key is refused the same way: nothing was stored under it
    const huge = probes[0]
    const replay = await send(huge)
    expect(replay.status).toBe(403)
    expect(replay.body.data?.code).toBe('stock_add_desk_only')
    const written = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockLedger)
      .where(
        and(
          eq(stockLedger.tenantId, tenantId),
          inArray(
            stockLedger.idempotencyKey,
            probes.map((p) => p.idempotencyKey),
          ),
        ),
      )
    expect(Number(written[0]?.n)).toBe(0)
    // the refusal comes before idempotent(): no idempotency row either, so the ordering is pinned
    expect(await idempotencyRows(huge.idempotencyKey)).toBe(0)
    expect(await onHand()).toBe(10)

    // the godown still takes damaged stock off
    const damageKey = `dos044-damage-${run}`
    const damaged = await call<{ entry: Entry; balance: Balance }>(
      app,
      store,
      'POST',
      '/inventory/adjustments',
      { idempotencyKey: damageKey, lotId, locationId: godown, qtyDelta: -2, reason: 'damage' },
    )
    expect(damaged.status).toBe(200)
    expect(damaged.body.entry).toMatchObject({ reason: 'damage', qtyDelta: -2 })
    expect(damaged.body.balance.onHand).toBe(8)
    // the same query does see an accepted call's key, so the zero above is not vacuous
    expect(await idempotencyRows(damageKey)).toBe(1)

    // the desk still adds
    const added = await call<{ entry: Entry; balance: Balance }>(
      app,
      desk,
      'POST',
      '/inventory/adjustments',
      {
        idempotencyKey: `dos044-desk-add-${run}`,
        lotId,
        locationId: godown,
        qtyDelta: 5,
        reason: 'adjustment',
      },
    )
    expect(added.status).toBe(200)
    expect(added.body.balance.onHand).toBe(13)
    expect(await onHand()).toBe(13)
  })

  it('DOS-037 refuses the accountant a stock adjustment, a transfer, a lot, a location and a cycle-count post, at the gate and in the service, and the ledger does not move', async () => {
    // docs/23 §2 M16 (QA DOS-037): the accountant reads stock and writes none of it. The godown keeps its
    // stock writes and the owner or a manager posts a count. Its own lot, like DOS-044's.
    const accountant: Actor = { tenantId, actorId: ownerId, role: 'accountant' }
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const desk: Actor = { tenantId, actorId: ownerId, role: 'manager' }
    const accountantCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'accountant' }
    const lotId = uuidv7()
    const ledgerRows = async (): Promise<number> => {
      const rows = (
        await db.execute(
          sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId}`,
        )
      ).rows as { n: number }[]
      return Number(rows[0]?.n)
    }
    const lotMade = await call(app, owner, 'POST', '/inventory/lots', {
      idempotencyKey: `lot-dos037-${run}`,
      id: lotId,
      variantId,
      batchNo: `DOS037-${run}`,
      mrpPaise: 1000,
    })
    expect(lotMade.status).toBe(200)
    const stocked = await call(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `dos037-open-${run}`,
      lotId,
      locationId: godown,
      qtyDelta: 10,
      reason: 'opening',
    })
    expect(stocked.status).toBe(200)
    // a count the godown opened and counted one short, waiting for the desk to post it
    const countId = uuidv7()
    const opened = await call(app, store, 'POST', '/inventory/cycle-counts', {
      idempotencyKey: `dos037-cc-open-${run}`,
      id: countId,
      locationId: godown,
      lotIds: [lotId],
    })
    expect(opened.status).toBe(200)
    const counted = await call(app, store, 'POST', `/inventory/cycle-counts/${countId}/count`, {
      idempotencyKey: `dos037-cc-count-${run}`,
      id: countId,
      lines: [{ lotId, countedPcs: 9 }],
    })
    expect(counted.status).toBe(200)

    const before = await ledgerRows()
    const adjustment = {
      lotId,
      locationId: godown,
      qtyDelta: -1,
      reason: 'damage',
      note: 'DOS-037 probe',
    }
    const transfer = {
      lotId,
      fromLocationId: godown,
      toLocationId: transit,
      qtyPcs: 1,
      note: 'DOS-037 probe',
    }
    const lot = { id: uuidv7(), variantId, batchNo: `DOS037-B-${run}`, mrpPaise: 1000 }
    const location = { id: uuidv7(), kind: 'warehouse', name: `DOS-037 godown ${run}` }
    const refused: [string, Record<string, unknown>][] = [
      ['/inventory/adjustments', { idempotencyKey: `dos037-adjust-${run}`, ...adjustment }],
      ['/inventory/transfers', { idempotencyKey: `dos037-transfer-${run}`, ...transfer }],
      ['/inventory/lots', { idempotencyKey: `dos037-lot-${run}`, ...lot }],
      ['/inventory/locations', { idempotencyKey: `dos037-location-${run}`, ...location }],
      [
        `/inventory/cycle-counts/${countId}/post`,
        { idempotencyKey: `dos037-cc-post-${run}`, id: countId },
      ],
    ]
    for (const [path, body] of refused) {
      const res = await call<{ message: string }>(app, accountant, 'POST', path, body)
      expect(res.status, `POST ${path}`).toBe(403)
      expect(res.body.message, `POST ${path}`).toContain('the accountant role may not call')
    }
    expect(await ledgerRows()).toBe(before)

    // The handlers refuse her on their own: over HTTP the gate answers first, so call them directly.
    const stock = app.get(StockService)
    const counts = app.get(CycleCountsService)
    const inService: [string, () => Promise<unknown>][] = [
      [
        'stock.adjust',
        () =>
          stock.adjust(
            AdjustStockInput.parse({ idempotencyKey: `dos037-svc-adjust-${run}`, ...adjustment }),
          ),
      ],
      [
        'stock.transfer',
        () =>
          stock.transfer(
            TransferStockInput.parse({ idempotencyKey: `dos037-svc-transfer-${run}`, ...transfer }),
          ),
      ],
      [
        'lots.upsert',
        () =>
          stock.upsertLot(
            UpsertLotInput.parse({ idempotencyKey: `dos037-svc-lot-${run}`, ...lot }),
          ),
      ],
      [
        'locations.upsert',
        () =>
          stock.upsertLocation(
            UpsertLocationInput.parse({
              idempotencyKey: `dos037-svc-location-${run}`,
              ...location,
            }),
          ),
      ],
      [
        'cycleCounts.post',
        () =>
          counts.post(
            PostCycleCountInput.parse({ idempotencyKey: `dos037-svc-cc-post-${run}`, id: countId }),
          ),
      ],
    ]
    for (const [name, invoke] of inService) {
      await expect(tenantStorage.run(accountantCtx, invoke), name).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }
    expect(await ledgerRows()).toBe(before)

    // She still reads the stock, the ledger and the count.
    for (const path of [
      '/inventory/balances',
      '/inventory/ledger',
      `/inventory/cycle-counts/${countId}`,
    ]) {
      expect((await call(app, accountant, 'GET', path, {})).status, `GET ${path}`).toBe(200)
    }
    // Controls: a manager posts the count; the godown still takes a damaged piece off and moves one.
    const posted = await call<{ entries: Entry[] }>(
      app,
      desk,
      'POST',
      `/inventory/cycle-counts/${countId}/post`,
      { idempotencyKey: `dos037-desk-post-${run}`, id: countId },
    )
    expect(posted.status).toBe(200)
    expect(posted.body.entries).toEqual([
      expect.objectContaining({ reason: 'cycle_count', qtyDelta: -1 }),
    ])
    const damaged = await call<{ balance: Balance }>(app, store, 'POST', '/inventory/adjustments', {
      idempotencyKey: `dos037-store-damage-${run}`,
      ...adjustment,
      note: 'DOS-037 control',
    })
    expect(damaged.status).toBe(200)
    expect(damaged.body.balance.onHand).toBe(8)
    const moved = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `dos037-store-transfer-${run}`,
      ...transfer,
      note: 'DOS-037 control',
    })
    expect(moved.status).toBe(200)
    expect(await ledgerRows()).toBe(before + 4)
  })

  it('DOS-140: sellable offers the godown only — never the damaged bin, goods in transit or a shop — and answers a vehicle just when that vehicle is asked for', async () => {
    type Sellable = { lotId: string; locationId: string; available: number }
    const vanId = uuidv7()
    const shopFloorId = uuidv7()
    for (const [id, kind, name] of [
      [vanId, 'vehicle', `Van ${run}`],
      [shopFloorId, 'customer', `Shop floor ${run}`],
    ] as const) {
      const made = await call(app, owner, 'POST', '/inventory/locations', {
        idempotencyKey: `loc-${id}`,
        id,
        kind,
        name,
      })
      expect(made.status).toBe(200)
    }
    const bin = (
      await db
        .select()
        .from(locations)
        .where(sql`${locations.tenantId} = ${tenantId} and ${locations.kind} = 'damaged'`)
    )[0]?.id
    expect(bin).toBeTruthy()

    // One lot, spread over every kind of place stock can stand.
    const lotId = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/inventory/lots', {
          idempotencyKey: `lot-140-${run}`,
          id: lotId,
          variantId,
          batchNo: `D140-${run}`,
          mrpPaise: 1000,
          expiryDate: '2028-01-01',
        })
      ).status,
    ).toBe(200)
    for (const [locationId, qty] of [
      [godown, 9],
      [bin ?? '', 7],
      [transit, 5],
      [vanId, 3],
      [shopFloorId, 2],
    ] as const) {
      const posted = await call(app, owner, 'POST', '/inventory/adjustments', {
        idempotencyKey: `open-140-${run}-${locationId}`,
        lotId,
        locationId,
        qtyDelta: qty,
        reason: 'opening',
      })
      expect(posted.status, JSON.stringify(posted.body)).toBe(200)
    }

    // What a rep or a shop may be offered: the godown, and nothing that cannot be sold from it.
    const offered = await call<{ items: Sellable[] }>(app, rep, 'GET', '/inventory/sellable', {
      variantId,
      limit: 500,
    })
    expect(offered.status).toBe(200)
    const places = offered.body.items.map((row) => row.locationId)
    expect(places).toContain(godown)
    expect(places).not.toContain(bin)
    expect(places).not.toContain(transit)
    expect(places).not.toContain(vanId)
    expect(places).not.toContain(shopFloorId)
    expect(offered.body.items.find((row) => row.lotId === lotId)?.available).toBe(9)

    // The van sale still reads its own vehicle (D6 asks for exactly one location).
    const onTheVan = await call<{ items: Sellable[] }>(app, owner, 'GET', '/inventory/sellable', {
      variantId,
      locationId: vanId,
    })
    expect(onTheVan.status).toBe(200)
    expect(onTheVan.body.items.map((row) => [row.lotId, row.available])).toEqual([[lotId, 3]])

    // Asking for the bin by name does not make damaged goods sellable.
    const fromBin = await call<{ items: Sellable[] }>(app, owner, 'GET', '/inventory/sellable', {
      variantId,
      locationId: bin ?? '',
    })
    expect(fromBin.status).toBe(200)
    expect(fromBin.body.items).toEqual([])

    // The pieces are still on the books where they stand: this is a filter on what may be SOLD.
    const balances = await call<{ items: Balance[] }>(app, owner, 'GET', '/inventory/balances', {
      lotId,
    })
    expect(Object.fromEntries(balances.body.items.map((b) => [b.locationId, b.onHand]))).toEqual({
      [godown]: 9,
      [bin ?? '']: 7,
      [transit]: 5,
      [vanId]: 3,
      [shopFloorId]: 2,
    })
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-045 — the count is measured against the stock at COUNT time, and the counter is never told the figure

  /** A lot of its own with `pcs` pieces in the godown, so no other expectation in this file moves. */
  const freshLot = async (label: string, pcs: number): Promise<string> => {
    const lotId = uuidv7()
    const lot = await call(app, owner, 'POST', '/inventory/lots', {
      idempotencyKey: `lot-${label}-${run}`,
      id: lotId,
      variantId,
      batchNo: `${label}-${run}`.toUpperCase(),
      mrpPaise: 1000,
    })
    expect(lot.status).toBe(200)
    const opened = await call(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `open-${label}-${run}`,
      lotId,
      locationId: godown,
      qtyDelta: pcs,
      reason: 'opening',
    })
    expect(opened.status).toBe(200)
    return lotId
  }

  type CountLine = {
    lotId: string
    expectedPcs: number | null
    countedPcs: number | null
    variancePcs: number | null
  }
  type CountBody = { item: { status: string; lines: CountLine[] } }

  it('DOS-045: expected is the on-hand at count time — open a count on a lot holding 9, post a -2 adjustment on that lot, count 9: the line answers expectedPcs 7 and variancePcs +2, and post writes ONE +2 cycle_count ledger row', async () => {
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const lotId = await freshLot('dos045a', 9)
    const id = uuidv7()
    const opened = await call<CountBody>(app, store, 'POST', '/inventory/cycle-counts', {
      idempotencyKey: `dos045a-open-${run}`,
      id,
      locationId: godown,
      lotIds: [lotId],
    })
    expect(opened.status).toBe(200)
    // the desk's view at open: what the ledger said before anyone walked the rack
    const atOpen = await call<CountBody>(app, owner, 'GET', `/inventory/cycle-counts/${id}`)
    expect(atOpen.body.item.lines[0]?.expectedPcs).toBe(9)

    // two pieces are written off while the counter is walking the rack
    const damaged = await call(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `dos045a-damage-${run}`,
      lotId,
      locationId: godown,
      qtyDelta: -2,
      reason: 'adjustment',
      note: 'crushed',
    })
    expect(damaged.status).toBe(200)

    const counted = await call<CountBody>(
      app,
      store,
      'POST',
      `/inventory/cycle-counts/${id}/count`,
      {
        idempotencyKey: `dos045a-count-${run}`,
        id,
        lines: [{ lotId, countedPcs: 9 }],
      },
    )
    expect(counted.status).toBe(200)
    expect(counted.body.item.status).toBe('counted')

    const atCount = await call<CountBody>(app, owner, 'GET', `/inventory/cycle-counts/${id}`)
    expect(atCount.body.item.lines[0]?.expectedPcs).toBe(7)
    expect(atCount.body.item.lines[0]?.variancePcs).toBe(2)

    const posted = await call<{ entries: { reason: string; qtyDelta: number }[] }>(
      app,
      owner,
      'POST',
      `/inventory/cycle-counts/${id}/post`,
      { idempotencyKey: `dos045a-post-${run}`, id },
    )
    expect(posted.status).toBe(200)
    expect(posted.body.entries).toEqual([
      expect.objectContaining({ reason: 'cycle_count', qtyDelta: 2 }),
    ])
    const rows = (
      await db.execute(
        sql`select count(*)::int as n, coalesce(sum(qty_delta), 0)::int as total from stock_ledger
             where tenant_id = ${tenantId} and ref_type = 'cycle_count' and ref_id = ${id}`,
      )
    ).rows[0] as { n: number; total: number }
    expect(Number(rows.n)).toBe(1)
    expect(Number(rows.total)).toBe(2)
    const after = (
      await db.execute(
        sql`select on_hand from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${godown}`,
      )
    ).rows[0] as { on_hand: number }
    expect(Number(after.on_hand)).toBe(9)
  })

  it("DOS-045: a warehouse token's open, count and get replies carry expectedPcs null and variancePcs null on every line, while the owner's carry the figures", async () => {
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const lotId = await freshLot('dos045b', 12)
    const id = uuidv7()
    const opened = await call<CountBody>(app, store, 'POST', '/inventory/cycle-counts', {
      idempotencyKey: `dos045b-open-${run}`,
      id,
      locationId: godown,
      lotIds: [lotId],
    })
    expect(opened.status).toBe(200)
    expect(opened.body.item.lines).toEqual([
      expect.objectContaining({ lotId, expectedPcs: null, variancePcs: null, countedPcs: null }),
    ])
    const counted = await call<CountBody>(
      app,
      store,
      'POST',
      `/inventory/cycle-counts/${id}/count`,
      {
        idempotencyKey: `dos045b-count-${run}`,
        id,
        lines: [{ lotId, countedPcs: 10 }],
      },
    )
    expect(counted.status).toBe(200)
    expect(counted.body.item.lines).toEqual([
      expect.objectContaining({ lotId, expectedPcs: null, countedPcs: 10, variancePcs: null }),
    ])
    const blindGet = await call<CountBody>(app, store, 'GET', `/inventory/cycle-counts/${id}`)
    expect(blindGet.body.item.lines[0]?.expectedPcs).toBeNull()
    expect(blindGet.body.item.lines[0]?.variancePcs).toBeNull()
    // the delivery crew counts van stock the same way: never the target
    const crew: Actor = { tenantId, actorId: ownerId, role: 'delivery' }
    const crewGet = await call<CountBody>(app, crew, 'GET', `/inventory/cycle-counts/${id}`)
    expect(crewGet.body.item.lines[0]?.expectedPcs).toBeNull()
    // the desk sees both figures
    const deskGet = await call<CountBody>(app, owner, 'GET', `/inventory/cycle-counts/${id}`)
    expect(deskGet.body.item.lines[0]?.expectedPcs).toBe(12)
    expect(deskGet.body.item.lines[0]?.variancePcs).toBe(-2)
  })

  it('DOS-045 guard: a line counted in an earlier call keeps its count-time expected when a later call counts another line', async () => {
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const first = await freshLot('dos045c1', 8)
    const second = await freshLot('dos045c2', 4)
    const id = uuidv7()
    expect(
      (
        await call(app, store, 'POST', '/inventory/cycle-counts', {
          idempotencyKey: `dos045c-open-${run}`,
          id,
          locationId: godown,
          lotIds: [first, second],
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, store, 'POST', `/inventory/cycle-counts/${id}/count`, {
          idempotencyKey: `dos045c-count1-${run}`,
          id,
          lines: [{ lotId: first, countedPcs: 8 }],
        })
      ).status,
    ).toBe(200)
    // the first lot moves AFTER it was counted; its line must keep the 8 it was measured against
    expect(
      (
        await call(app, owner, 'POST', '/inventory/adjustments', {
          idempotencyKey: `dos045c-move-${run}`,
          lotId: first,
          locationId: godown,
          qtyDelta: -3,
          reason: 'adjustment',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, store, 'POST', `/inventory/cycle-counts/${id}/count`, {
          idempotencyKey: `dos045c-count2-${run}`,
          id,
          lines: [{ lotId: second, countedPcs: 4 }],
        })
      ).status,
    ).toBe(200)
    const detail = await call<CountBody>(app, owner, 'GET', `/inventory/cycle-counts/${id}`)
    const byLot = new Map(detail.body.item.lines.map((l) => [l.lotId, l]))
    expect(byLot.get(first)?.expectedPcs).toBe(8)
    expect(byLot.get(first)?.variancePcs).toBe(0)
    expect(byLot.get(second)?.expectedPcs).toBe(4)
    expect(byLot.get(second)?.variancePcs).toBe(0)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-054 — a batch under the distributor's minimum shelf life goes LAST, and taking it warns

  /** A lot of its own expiring in `days`, with `pcs` pieces in the godown. */
  const datedLot = async (
    label: string,
    days: number | null,
    pcs: number,
    variant: string = shelfVariantId,
  ): Promise<string> => {
    const lotId = uuidv7()
    const expiryDate =
      days === null
        ? undefined
        : new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    expect(
      (
        await call(app, owner, 'POST', '/inventory/lots', {
          idempotencyKey: `lot-${label}-${run}`,
          id: lotId,
          variantId: variant,
          batchNo: `${label}-${run}`.toUpperCase(),
          mrpPaise: 1000,
          ...(expiryDate === undefined ? {} : { expiryDate }),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, owner, 'POST', '/inventory/adjustments', {
          idempotencyKey: `open-${label}-${run}`,
          lotId,
          locationId: godown,
          qtyDelta: pcs,
          reason: 'opening',
        })
      ).status,
    ).toBe(200)
    return lotId
  }

  const setShelfLife = async (days: number | null): Promise<void> => {
    if (days === null) {
      await db.execute(
        sql`delete from tenant_settings where tenant_id = ${tenantId} and key = 'inventory.min_shelf_life_days'`,
      )
      return
    }
    await db.execute(
      sql`insert into tenant_settings (tenant_id, key, value) values (${tenantId}, 'inventory.min_shelf_life_days', ${String(days)}::jsonb)
          on conflict (tenant_id, key) do update set value = excluded.value`,
    )
  }

  it('DOS-054: with inventory.min_shelf_life_days = 30, reserve on a variant holding a 16-day lot and a 90-day lot takes the 90-day lot first; with the setting 0 it takes the 16-day lot first (plain FEFO); when only the 16-day lot can cover the line it is taken and the line is fully reserved', async () => {
    const shortDated = await datedLot('dos054-short', 16, 10)
    const compliant = await datedLot('dos054-long', 90, 10)

    await setShelfLife(30)
    const underRule = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: shelfVariantId,
        locationId: godown,
        qtyPcs: 4,
      }),
    )
    expect(underRule.map((r) => [r.lotId, r.qty])).toEqual([[compliant, 4]])

    // the rule changes ORDER, never availability: the line is still covered in full, short-dated last
    const spanning = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: shelfVariantId,
        locationId: godown,
        qtyPcs: 8,
      }),
    )
    expect(spanning.map((r) => [r.lotId, r.qty])).toEqual([
      [compliant, 6],
      [shortDated, 2],
    ])

    // switched off, it is plain FEFO again: the 16-day batch comes first
    await setShelfLife(0)
    const plainFefo = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: shelfVariantId,
        locationId: godown,
        qtyPcs: 3,
      }),
    )
    expect(plainFefo.map((r) => [r.lotId, r.qty])).toEqual([[shortDated, 3]])
    await setShelfLife(30)
  })

  it('DOS-054: an absent setting row reads as 30; a lot with no expiry sorts after dated compliant lots and before short-dated ones', async () => {
    // bootstrapTenant seeds the row, so a distributor never reads "absent" by accident. A tenant of
    // its own: this file's own tenant has had the row written by the test above.
    const freshTenant = uuidv7()
    await db
      .insert(tenants)
      .values({ id: freshTenant, slug: `inv-054-${run}`, legalName: 'Shelf life', stateCode: '27' })
    await bootstrapTenant(db, freshTenant)
    const seeded = (
      await db.execute(
        sql`select value from tenant_settings where tenant_id = ${freshTenant} and key = 'inventory.min_shelf_life_days'`,
      )
    ).rows as { value: unknown }[]
    expect(seeded).toHaveLength(1)
    expect(Number(seeded[0]?.value)).toBe(30)

    const shortDated = await datedLot('dos054g-short', 16, 5, shelfGuardVariantId)
    const undated = await datedLot('dos054g-none', null, 5, shelfGuardVariantId)
    const compliant = await datedLot('dos054g-long', 120, 5, shelfGuardVariantId)
    await setShelfLife(null) // absent reads as the 30-day default
    const held = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: shelfGuardVariantId,
        locationId: godown,
        qtyPcs: 12,
      }),
    )
    expect(held.map((r) => [r.lotId, r.qty])).toEqual([
      [compliant, 5],
      [undated, 5],
      [shortDated, 2],
    ])

    // DOS-054 blocker: an owner who CLEARS the field on Settings -> Business saves `""`, not a
    // number. A blank is not "an integer >= 0", so it must read as the 30-day default the screen
    // keeps showing — never as 0, which is the documented "rule off" value.
    await db.execute(
      sql`insert into tenant_settings (tenant_id, key, value) values (${tenantId}, 'inventory.min_shelf_life_days', '""'::jsonb)
          on conflict (tenant_id, key) do update set value = excluded.value`,
    )
    expect(await asOwner((tx) => inventory.minShelfLifeDays(tx))).toBe(30)
    // and the rule is still ON: a fresh 120-day lot is taken before the 16-day remainder
    const afterBlank = await datedLot('dos054g-blank', 120, 5, shelfGuardVariantId)
    const blankHeld = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: shelfGuardVariantId,
        locationId: godown,
        qtyPcs: 4,
      }),
    )
    expect(blankHeld.map((r) => [r.lotId, r.qty])).toEqual([[afterBlank, 4]])
    await setShelfLife(30)
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
