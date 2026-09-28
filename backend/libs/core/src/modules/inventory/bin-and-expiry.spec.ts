/**
 * The damaged / expiry bin and what counts as available — QA phase 10 (`QA/findings/17-inventory-states.md`)
 * under the architect's stock rulings of 2026-09-28 (docs/22 §8):
 *
 *   DOS-350 (P0)  the bin never goes below zero: a hand transfer of 70 out of a bin that held 20 put 50 pieces
 *                 that never existed into the godown, sellable (ruling 1);
 *   DOS-352       nothing leaves the bin for sale — its exits are a write-off and a return to the brand, and a
 *                 carton binned by mistake is corrected by the owner's adjustment with a reason (ruling 2);
 *   ruling 6      damaged in the godown means moved to the bin; the write-off is the desk's, from the bin;
 *   DOS-261 /     an expired batch (expiry before today's IST business date) is not available and never held;
 *   DOS-351       a short-dated one still is (ruling 3). The stock screens still show every expired piece.
 *
 * Its OWN tenant, so no FEFO or cycle-count expectation of `inventory.spec.ts` moves.
 */
import { and, eq, sql } from 'drizzle-orm'
import { businessDate, uuidv7 } from '@dos/domain'
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
  stockBalances,
  stockBelowZero,
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
type Entry = {
  id: string
  reason: string
  qtyDelta: number
  locationId: string
  actorId: string
  note: string | null
}
type Refusal = { message: string; data?: { code?: string } }

/** Today in IST plus `n` days, as an ISO day — the business date the view and the services judge by. */
function day(n: number): string {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + n)).toISOString().slice(0, 10)
}

describeDb('inventory: the damaged bin and what is available (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const storeId = uuidv7()
  const repId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }

  /** Bin traffic. */
  const binVariant = uuidv7()
  /** Expiry: an in-date, a short-dated and an expired batch of one item at the godown. */
  const expVariant = uuidv7()
  /** An order line whose hold was taken while its batch was still in date. */
  const heldVariant = uuidv7()
  const binLot = uuidv7()
  const inDate = uuidv7()
  const shortDated = uuidv7()
  const expired = uuidv7()
  const heldExpired = uuidv7()
  const heldInDate = uuidv7()

  let godown = ''
  let bin = ''
  let dock = ''
  let van = ''
  let app: NestFastifyApplication
  let inventory: InventoryService

  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const onHandAt = async (lotId: string, locationId: string): Promise<number | null> => {
    const [row] = await db
      .select({ onHand: stockBalances.onHand })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.lotId, lotId),
          eq(stockBalances.locationId, locationId),
        ),
      )
    return row?.onHand ?? null
  }
  const ledgerRows = async (lotId: string): Promise<number> =>
    (
      await db
        .select({ id: stockLedger.id })
        .from(stockLedger)
        .where(and(eq(stockLedger.tenantId, tenantId), eq(stockLedger.lotId, lotId)))
    ).length

  const lot = async (id: string, variantId: string, batchNo: string, expiryDate: string | null) => {
    const res = await call(app, owner, 'POST', '/inventory/lots', {
      idempotencyKey: `lot-${id}`,
      id,
      variantId,
      batchNo,
      mrpPaise: 1000,
      ...(expiryDate === null ? {} : { expiryDate }),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  }
  const open = async (lotId: string, locationId: string, qty: number) => {
    const res = await call(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `open-${lotId}-${locationId}`,
      lotId,
      locationId,
      qtyDelta: qty,
      reason: 'opening',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  }
  const transfer = (actor: Actor, lotId: string, from: string, to: string, qtyPcs: number) =>
    call<Refusal>(app, actor, 'POST', '/inventory/transfers', {
      idempotencyKey: uuidv7(),
      lotId,
      fromLocationId: from,
      toLocationId: to,
      qtyPcs,
      note: 'bin spec',
    })

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug: `bin-${run}`,
        legalName: 'Bin and expiry test',
        stateCode: '27',
      })
    await db.insert(users).values([
      { id: ownerId, phone: `+91904${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91904${run}2`, name: 'Manager' },
      { id: storeId, phone: `+91904${run}3`, name: 'Godown' },
      { id: repId, phone: `+91904${run}4`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker bin ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Farsan' })
    await db.insert(productVariants).values(
      [
        [binVariant, 'Konkan Farsan Mix 400 g'],
        [expVariant, 'Sunbake Choco Chip Cookies 120 g'],
        [heldVariant, 'Godavari Dairy Whitener 500 g'],
      ].map(([id, name]) => ({
        id: id ?? '',
        productId,
        name: name ?? '',
        netQty: 400,
        netUnit: 'g' as const,
        defaultCaseSize: 20,
        hsnCode: '2106',
        mrpPaise: 1000,
      })),
    )
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    bin = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    dock = locs.find((l) => l.kind === 'in_transit')?.id ?? ''
    app = await bootTestApp([InventoryModule])
    inventory = app.get(InventoryService)
    van = (
      await asOwner((tx) =>
        inventory.ensureVehicleLocation(tx, { vehicleId: uuidv7(), name: `Van ${run}` }),
      )
    ).id

    await lot(binLot, binVariant, `P10-A1-${run}`, day(180))
    await lot(inDate, expVariant, `G1-${run}`, day(120))
    await lot(shortDated, expVariant, `SHORT-${run}`, day(10))
    await lot(expired, expVariant, `EXP-${run}`, day(-5))
    await lot(heldExpired, heldVariant, `HELD-EXP-${run}`, day(-1))
    await lot(heldInDate, heldVariant, `HELD-OK-${run}`, day(200))
    await open(binLot, godown, 400)
    await open(inDate, godown, 50)
    await open(shortDated, godown, 10)
    await open(expired, godown, 30)
    await open(heldExpired, godown, 8)
    await open(heldInDate, godown, 40)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-350 — the bin never goes below zero

  it('DOS-350: a new distributor gets its damaged / expiry bin with no "may go below zero", and no place can be saved with it', async () => {
    const [row] = await db
      .select({ negativeAllowed: locations.negativeAllowed })
      .from(locations)
      .where(eq(locations.id, bin))
    expect(row?.negativeAllowed).toBe(false)

    const refused = await call<Refusal>(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `loc-neg-${run}`,
      id: uuidv7(),
      kind: 'damaged',
      name: `Second bin ${run}`,
      negativeAllowed: true,
    })
    expect(refused.status).toBe(400)
    expect(refused.body.data?.code).toBe('location_never_negative')
    expect(refused.body.message).toMatch(/No stock location may go below zero/)
    const none = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.name, `Second bin ${run}`)))
    expect(none).toEqual([])
  })

  it('DOS-350: the bin refuses to go below zero the way the godown does — a move out of it, the desk write-off beyond it — and nothing is written', async () => {
    // "damaged in the godown": 20 pieces moved into the bin by the godown login (ruling 6 keeps this)
    const inBin = await transfer(store, binLot, godown, bin, 20)
    expect(inBin.status, JSON.stringify(inBin.body)).toBe(200)
    expect(await onHandAt(binLot, bin)).toBe(20)

    // a second bin (bin to bin is not a sale, so only the below-zero rule can stop it)
    const bin2 = uuidv7()
    const made = await call(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `loc-bin2-${run}`,
      id: bin2,
      kind: 'damaged',
      name: `Claim shelf ${run}`,
    })
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    const rows = await ledgerRows(binLot)

    // the QA replay: 70 out of a bin that holds 20
    const over = await transfer(store, binLot, bin, bin2, 70)
    expect(over.status).toBe(400)
    expect(over.body.message).toBe(
      `Only 20 pc of Konkan Farsan Mix 400 g (batch P10-A1-${run}) are in Damaged / expiry bin; 70 pc cannot go out.`,
    )
    // the desk's write-off beyond what the bin holds (the QA replay was −100 against 12)
    const writeOff = await call<Refusal>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `wo-over-${run}`,
      lotId: binLot,
      locationId: bin,
      qtyDelta: -100,
      reason: 'damage',
      note: 'bin cleared',
    })
    expect(writeOff.status).toBe(400)
    expect(writeOff.body.message).toBe(
      `Only 20 pc of Konkan Farsan Mix 400 g (batch P10-A1-${run}) are in Damaged / expiry bin; 100 pc cannot go out.`,
    )
    expect(await onHandAt(binLot, bin)).toBe(20)
    expect(await onHandAt(binLot, godown)).toBe(380)
    expect(await ledgerRows(binLot)).toBe(rows)

    // exactly what is there does go out
    const all = await transfer(owner, binLot, bin, bin2, 20)
    expect(all.status, JSON.stringify(all.body)).toBe(200)
    expect(await onHandAt(binLot, bin)).toBe(0)
    expect(await onHandAt(binLot, bin2)).toBe(20)
    // every bin balance row carries no below-zero flag
    const flags = await db
      .select({ flag: stockBalances.negativeAllowed })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.lotId, binLot)))
    expect(flags.every((f) => !f.flag)).toBe(true)
  })

  it('DOS-350: a balance that was already below zero keeps its flag, is named by the release check, refuses any further move down in words and climbs back with a count', async () => {
    // What migration 0075 leaves behind on a database whose bin had gone below zero: a place that no longer
    // allows a negative, and a balance row that is below zero with its old flag. Built the way it came about:
    // the place allowed it when the pieces went out, and has been corrected since.
    const place = uuidv7()
    const lotId = uuidv7()
    await lot(lotId, binVariant, `LEGACY-${run}`, day(90))
    await db.insert(locations).values({
      id: place,
      tenantId,
      kind: 'customer',
      name: `Old consignment ${run}`,
      negativeAllowed: true,
    })
    await db
      .insert(stockBalances)
      .values({ tenantId, lotId, locationId: place, onHand: -50, negativeAllowed: true })
    await db.update(locations).set({ negativeAllowed: false }).where(eq(locations.id, place))

    const named = (await stockBelowZero(db, tenantId)).filter((b) => b.lotId === lotId)
    expect(named).toEqual([
      expect.objectContaining({
        locationId: place,
        locationName: `Old consignment ${run}`,
        onHandPcs: -50,
        batchNo: `LEGACY-${run}`,
        variantName: 'Konkan Farsan Mix 400 g',
        balanceFlag: true,
        locationAllows: false,
      }),
    ])

    const further = await call<Refusal>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `legacy-down-${run}`,
      lotId,
      locationId: place,
      qtyDelta: -1,
      reason: 'adjustment',
    })
    expect(further.status).toBe(400)
    expect(further.body.message).toMatch(
      new RegExp(
        `^The books show -50 pc of Konkan Farsan Mix 400 g \\(batch LEGACY-${run}\\) in Old consignment ${run}, below zero; nothing can go out of it until a count`,
      ),
    )
    // the database refuses it too, whoever writes: the trigger names the CHECK the API already maps
    await expect(
      db
        .update(stockBalances)
        .set({ onHand: -60 })
        .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, place))),
    ).rejects.toSatisfy((e: unknown) =>
      /no place goes below zero/.test((e as { cause?: { message?: string } }).cause?.message ?? ''),
    )

    // the owner's count: +50 brings it to zero, and the flag goes for good
    const counted = await call<{ balance: Balance }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `legacy-count-${run}`,
      lotId,
      locationId: place,
      qtyDelta: 50,
      reason: 'cycle_count',
      note: 'counted: nothing there',
    })
    expect(counted.status, JSON.stringify(counted.body)).toBe(200)
    expect(counted.body.balance.onHand).toBe(0)
    const [after] = await db
      .select({ flag: stockBalances.negativeAllowed })
      .from(stockBalances)
      .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, place)))
    expect(after?.flag).toBe(false)
    expect((await stockBelowZero(db, tenantId)).filter((b) => b.lotId === lotId)).toEqual([])
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-352 — nothing leaves the bin for sale; ruling 6 — damaged in the godown means moved to the bin

  it('DOS-352: pieces in the bin cannot be moved to the godown, a van or the dock — by the godown login or the owner — and nothing is written', async () => {
    const back = await transfer(store, binLot, godown, bin, 10)
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    const rows = await ledgerRows(binLot)
    for (const actor of [store, owner, manager]) {
      for (const [to, name] of [
        [godown, 'Godown'],
        [van, `Van ${run}`],
        [dock, 'In transit'],
      ] as const) {
        const res = await transfer(actor, binLot, bin, to, 5)
        expect(res.status, `${actor.role} → ${name}`).toBe(409)
        expect(res.body.data?.code).toBe('damaged_not_for_sale')
        expect(res.body.message).toBe(
          `Pieces in Damaged / expiry bin never go back for sale, so they cannot be moved to ${name}. They leave the bin only by a write-off or a return to the brand. If a carton went into the bin by mistake, the owner corrects it with a stock adjustment and a reason.`,
        )
      }
    }
    expect(await ledgerRows(binLot)).toBe(rows)
    expect(await onHandAt(binLot, bin)).toBe(10)
    // and the rep is offered nothing more than before
    const offered = await call<{ items: { variantId: string; available: number }[] }>(
      app,
      rep,
      'GET',
      '/inventory/availability',
      { variantId: binVariant },
    )
    expect(offered.body.items).toEqual([{ variantId: binVariant, available: 370 }])
  })

  it('ruling 6: a damaged or expired write-off at the godown moves the pieces into the bin; the godown cannot write off from the bin; the owner corrects a carton binned by mistake with who and why on the books', async () => {
    // damaged in the godown: −3 there, +3 in the bin, one call, reason kept on both rows
    const damaged = await call<{
      entry: Entry
      balance: Balance
      movedToBin?: { locationName: string; entry: Entry; balance: Balance }
    }>(app, store, 'POST', '/inventory/adjustments', {
      idempotencyKey: `dmg-${run}`,
      lotId: binLot,
      locationId: godown,
      qtyDelta: -3,
      reason: 'damage',
      note: 'carton crushed',
    })
    expect(damaged.status, JSON.stringify(damaged.body)).toBe(200)
    expect(damaged.body.entry).toMatchObject({ reason: 'damage', qtyDelta: -3, locationId: godown })
    expect(damaged.body.balance.onHand).toBe(367)
    expect(damaged.body.movedToBin).toMatchObject({
      locationName: 'Damaged / expiry bin',
      entry: { reason: 'damage', qtyDelta: 3, locationId: bin, note: 'carton crushed' },
      balance: { onHand: 13 },
    })
    // a replay moves nothing twice
    const again = await call(app, store, 'POST', '/inventory/adjustments', {
      idempotencyKey: `dmg-${run}`,
      lotId: binLot,
      locationId: godown,
      qtyDelta: -3,
      reason: 'damage',
      note: 'carton crushed',
    })
    expect(again.status).toBe(200)
    expect(await onHandAt(binLot, bin)).toBe(13)
    expect(await onHandAt(binLot, godown)).toBe(367)

    // a count found short at the godown is still a plain correction there
    const counted = await call<{ movedToBin?: unknown }>(
      app,
      store,
      'POST',
      '/inventory/adjustments',
      {
        idempotencyKey: `short-${run}`,
        lotId: binLot,
        locationId: godown,
        qtyDelta: -2,
        reason: 'cycle_count',
      },
    )
    expect(counted.status).toBe(200)
    expect(counted.body.movedToBin).toBeUndefined()
    expect(await onHandAt(binLot, bin)).toBe(13)

    // the write-off from the bin is the desk's
    const byGodown = await call<Refusal>(app, store, 'POST', '/inventory/adjustments', {
      idempotencyKey: `bin-wo-store-${run}`,
      lotId: binLot,
      locationId: bin,
      qtyDelta: -3,
      reason: 'damage',
    })
    expect(byGodown.status).toBe(403)
    expect(byGodown.body.data?.code).toBe('bin_writeoff_desk_only')
    expect(byGodown.body.message).toMatch(
      /^Pieces leave Damaged \/ expiry bin only by the desk's write-off/,
    )
    const byManager = await call<{ entry: Entry; movedToBin?: unknown }>(
      app,
      manager,
      'POST',
      '/inventory/adjustments',
      {
        idempotencyKey: `bin-wo-mgr-${run}`,
        lotId: binLot,
        locationId: bin,
        qtyDelta: -3,
        reason: 'damage',
        note: 'scrapped',
      },
    )
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(200)
    expect(byManager.body.movedToBin).toBeUndefined()
    expect(await onHandAt(binLot, bin)).toBe(10)

    // a carton put in the bin by mistake: the owner takes it out of the bin and back onto the godown's
    // books by adjustment, with a reason — both rows name who did it and why
    const out = await call<{ entry: Entry }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `fix-out-${run}`,
      lotId: binLot,
      locationId: bin,
      qtyDelta: -10,
      reason: 'adjustment',
      note: 'binned by mistake, carton is sound',
    })
    const inn = await call<{ entry: Entry }>(app, owner, 'POST', '/inventory/adjustments', {
      idempotencyKey: `fix-in-${run}`,
      lotId: binLot,
      locationId: godown,
      qtyDelta: 10,
      reason: 'adjustment',
      note: 'binned by mistake, carton is sound',
    })
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(inn.status, JSON.stringify(inn.body)).toBe(200)
    for (const res of [out, inn])
      expect(res.body.entry).toMatchObject({
        actorId: ownerId,
        reason: 'adjustment',
        note: 'binned by mistake, carton is sound',
      })
    expect(await onHandAt(binLot, bin)).toBe(0)
    expect(await onHandAt(binLot, godown)).toBe(375)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-261 / DOS-351 — expired goods are never available and never held

  it('DOS-261: an expired batch is not sellable and not available to promise; a short-dated one still is; the stock screen still shows the expired one', async () => {
    const sellable = await call<{ items: { lotId: string; available: number }[] }>(
      app,
      rep,
      'GET',
      '/inventory/sellable',
      { variantId: expVariant },
    )
    expect(sellable.status).toBe(200)
    expect(
      Object.fromEntries(sellable.body.items.map((row) => [row.lotId, row.available])),
    ).toEqual({ [inDate]: 50, [shortDated]: 10 })
    // even named by its place, the expired lot is not offered
    const atGodown = await call<{ items: { lotId: string }[] }>(
      app,
      owner,
      'GET',
      '/inventory/sellable',
      { variantId: expVariant, locationId: godown },
    )
    expect(atGodown.body.items.map((r) => r.lotId)).not.toContain(expired)

    const availability = await call<{ items: { variantId: string; available: number }[] }>(
      app,
      rep,
      'GET',
      '/inventory/availability',
      { variantId: expVariant },
    )
    expect(availability.body.items).toEqual([{ variantId: expVariant, available: 60 }])

    // the owner's and the godown's stock screens keep it, with its date, to be written off
    const books = await call<{ items: (Balance & { expiryDate: string | null })[] }>(
      app,
      store,
      'GET',
      '/inventory/balances',
      { variantId: expVariant, nonZero: true },
    )
    expect(books.status).toBe(200)
    expect(
      Object.fromEntries(books.body.items.map((b) => [b.lotId, [b.onHand, b.expiryDate]])),
    ).toEqual({
      [inDate]: [50, day(120)],
      [shortDated]: [10, day(10)],
      [expired]: [30, day(-5)],
    })
  })

  it('DOS-261 / DOS-351: an order line is never held on an expired batch — in-date first, the short-dated batch when it must, and a line nothing else covers is refused naming the expired pieces', async () => {
    const lineA = uuidv7()
    const held = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: lineA,
        variantId: expVariant,
        locationId: godown,
        qtyPcs: 55,
      }),
    )
    expect(Object.fromEntries(held.map((r) => [r.lotId, r.qty]))).toEqual({
      [inDate]: 50,
      [shortDated]: 5,
    })
    const lineB = uuidv7()
    await expect(
      asOwner((tx) =>
        inventory.reserve(tx, {
          orderLineId: lineB,
          variantId: expVariant,
          locationId: godown,
          qtyPcs: 10,
        }),
      ),
    ).rejects.toMatchObject({
      message:
        'Only 5 pc of Sunbake Choco Chip Cookies 120 g can be sold from Godown; 5 pc short. 30 pc there are past their expiry date and are never sold.',
    })
    // nothing was held for B, and the expired lot holds nothing at all
    const holds = await db
      .select({ lotId: reservations.lotId, qty: reservations.qty })
      .from(reservations)
      .where(and(eq(reservations.tenantId, tenantId), eq(reservations.orderLineId, lineB)))
    expect(holds).toEqual([])
    const [exp] = await db
      .select({ reserved: stockBalances.reserved })
      .from(stockBalances)
      .where(and(eq(stockBalances.lotId, expired), eq(stockBalances.locationId, godown)))
    expect(exp?.reserved).toBe(0)
    await asOwner((tx) => inventory.releaseReservation(tx, lineA))
  })

  it('DOS-261: a hold taken while its batch was in date is left whole when the batch expires — still counted, never offered again — and once released the line is held on in-date stock only', async () => {
    // What the old code left on a database (and what any hold becomes the day its batch expires): a pending
    // hold on the batch, its pieces counted in `reserved`.
    const line = uuidv7()
    await db.insert(reservations).values({
      id: uuidv7(),
      tenantId,
      orderLineId: line,
      variantId: heldVariant,
      lotId: heldExpired,
      locationId: godown,
      qty: 8,
      state: 'pending',
    })
    await db
      .update(stockBalances)
      .set({ reserved: sql`${stockBalances.reserved} + 8` })
      .where(and(eq(stockBalances.lotId, heldExpired), eq(stockBalances.locationId, godown)))

    // the hold is intact: the balance still counts it, and asking again returns it rather than re-holding
    const [bal] = await db
      .select({ onHand: stockBalances.onHand, reserved: stockBalances.reserved })
      .from(stockBalances)
      .where(and(eq(stockBalances.lotId, heldExpired), eq(stockBalances.locationId, godown)))
    expect(bal).toEqual({ onHand: 8, reserved: 8 })
    const same = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: line,
        variantId: heldVariant,
        locationId: godown,
        qtyPcs: 8,
      }),
    )
    expect(same.map((r) => [r.lotId, r.qty, r.state])).toEqual([[heldExpired, 8, 'pending']])
    // the batch is offered to nobody
    const offered = await call<{ items: { lotId: string }[] }>(
      app,
      rep,
      'GET',
      '/inventory/sellable',
      {
        variantId: heldVariant,
      },
    )
    expect(offered.body.items.map((r) => r.lotId)).toEqual([heldInDate])

    // released (the desk's `reservations.release`), the line is held again on the in-date batch
    expect(await asOwner((tx) => inventory.releaseReservation(tx, line))).toBe(1)
    const again = await asOwner((tx) =>
      inventory.reserve(tx, {
        orderLineId: line,
        variantId: heldVariant,
        locationId: godown,
        qtyPcs: 8,
      }),
    )
    expect(again.map((r) => [r.lotId, r.qty])).toEqual([[heldInDate, 8]])
    const [released] = await db
      .select({ reserved: stockBalances.reserved })
      .from(stockBalances)
      .where(and(eq(stockBalances.lotId, heldExpired), eq(stockBalances.locationId, godown)))
    expect(released?.reserved).toBe(0)
    await asOwner((tx) => inventory.releaseReservation(tx, line))
  })

  it('DOS-261: an expired batch on a van is not sold from it either', async () => {
    const onVan = await transfer(owner, inDate, godown, van, 6)
    expect(onVan.status, JSON.stringify(onVan.body)).toBe(200)
    const expiredOnVan = await transfer(owner, expired, godown, van, 4)
    expect(expiredOnVan.status, JSON.stringify(expiredOnVan.body)).toBe(200)
    const offered = await call<{ items: { lotId: string; available: number }[] }>(
      app,
      owner,
      'GET',
      '/inventory/sellable',
      { variantId: expVariant, locationId: van },
    )
    expect(offered.body.items.map((r) => [r.lotId, r.available])).toEqual([[inDate, 6]])
    await expect(
      asOwner((tx) =>
        inventory.reserve(tx, {
          orderLineId: uuidv7(),
          variantId: expVariant,
          locationId: van,
          qtyPcs: 8,
        }),
      ),
    ).rejects.toMatchObject({
      message: `Only 6 pc of Sunbake Choco Chip Cookies 120 g can be sold from Van ${run}; 2 pc short. 4 pc there are past their expiry date and are never sold.`,
    })
  })
})
