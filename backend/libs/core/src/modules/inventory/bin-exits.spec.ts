/**
 * NOTHING LEAVES THE DAMAGED BIN FOR SALE — ON EVERY PATH (architect ruling 2 of 2026-09-28, QA DOS-352). The
 * lane's first build closed the hand transfer only (`bin-and-expiry.spec.ts`); the blind check then put bin
 * pieces back into sale three other ways, and each is pinned here:
 *
 *   V8 / V10  an order named the bin as the place it is packed from (the owner, a rep, a device upload); the
 *             wave picked twelve damaged pieces there and the pack billed them to a shop;
 *   V9        the godown login re-saved the bin as a godown in one call, and 161 damaged pieces were sellable;
 *   V7        a load sheet took the bin as its source and put the pieces on a van as van stock.
 *
 * The ledger itself (`InventoryService.post`) now refuses a sale, a pack, a load or any move out of a damaged
 * place into a place that is not one — so every mover inherits the rule — while a write-off, a count and bin to
 * bin still go. An order may name only a godown or a van-sale vehicle, and a place keeps its kind while the bin
 * is the bin or while it holds stock. Its OWN tenant, so no other spec's expectation moves.
 */
import { and, eq, sql } from 'drizzle-orm'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  locations,
  manufacturers,
  memberships,
  packConfirmations,
  priceListItems,
  priceLists,
  products,
  productVariants,
  reservations,
  retailerIdentities,
  retailerLinks,
  retailers,
  salesOrders,
  stockBalances,
  stockLedger,
  tenantProducts,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { BillingModule } from '../billing/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { InventoryModule, InventoryService } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Refusal = { message: string; data?: { code?: string } }
type Uploaded = { accepted: number; rejected: { opId: string; code: string; message?: string }[] }

/** Today in IST plus `n` days, as an ISO day. */
function day(n: number): string {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + n)).toISOString().slice(0, 10)
}

describeDb('inventory: nothing leaves the damaged bin for sale, on any path (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  // global and unique on (code, date): the run's own heading, deleted in afterAll
  const hsn = `7${run}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }

  const shop = uuidv7()
  const variantId = uuidv7()
  const item = 'Rajwadi Soda Water 750 ml'
  let godown = ''
  let bin = ''
  let dock = ''
  let van = ''
  let goodLot = ''
  let binLot = ''
  let binBatch = ''
  let app: NestFastifyApplication
  let inventory: InventoryService

  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const onHandAt = async (lotId: string, locationId: string): Promise<number> => {
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
    return row?.onHand ?? 0
  }
  const ledgerCount = async (): Promise<number> => {
    const rows = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId}`,
      )
    ).rows as { n: number }[]
    return rows[0]?.n ?? 0
  }
  const orderRow = async (id: string) =>
    (
      await db
        .select({
          state: salesOrders.state,
          fulfilFromLocationId: salesOrders.fulfilFromLocationId,
        })
        .from(salesOrders)
        .where(eq(salesOrders.id, id))
    )[0]
  const draftOrder = (actor: Actor, tag: string, fulfilFromLocationId?: string) => {
    const id = uuidv7()
    return {
      id,
      res: call<Refusal>(app, actor, 'POST', '/orders', {
        idempotencyKey: `order-${tag}-${run}`,
        id,
        retailerId: shop,
        source: actor.role === 'salesperson' ? 'salesperson' : 'phone',
        ...(fulfilFromLocationId === undefined ? {} : { fulfilFromLocationId }),
        lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
      }),
    }
  }

  const binWords = `Pieces in Damaged / expiry bin never go back for sale`
  const exits =
    'They leave the bin only by a write-off or a return to the brand. If a carton went into the bin by mistake, the owner corrects it with a stock adjustment and a reason.'
  const notFromBin =
    'An order is packed from a godown, not from Damaged / expiry bin: pieces in the damaged / expiry bin never go back for sale. Place the order without a location and it is packed from the godown.'

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `binx-${run}`, legalName: 'Bin Exit Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91905${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91905${run}2`, name: 'Manager' },
      { id: packerId, phone: `+91905${run}3`, name: 'Godown' },
      { id: repId, phone: `+91905${run}4`, name: 'Rep' },
      { id: shopUserId, phone: `+91905${run}5`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Bin Exit Traders' })
      .onConflictDoNothing()

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker binx ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Soda', category: 'beverages' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: item,
      netQty: 750,
      netUnit: 'ml',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 2000,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91906${run}1`,
      userId: shopUserId,
      shopName: `Bin Exit Shop ${run}`,
    })
    await db.insert(retailers).values({
      id: shop,
      tenantId,
      identityId,
      code: `BX-${run}`,
      name: `Bin Exit Shop ${run}`,
      phone: `+91906${run}1`,
      stateCode: '27',
      gstRegType: 'regular',
      gstin: '27AAXPT9021Q1ZQ',
      creditDays: 15,
    })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: shop,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 1500 })

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    bin = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    dock = locs.find((l) => l.kind === 'in_transit')?.id ?? ''

    app = await bootTestApp([
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      SyncModule,
    ])
    inventory = app.get(InventoryService)
    binBatch = `P10-C1-${run}`
    await asOwner(async (tx) => {
      van = (await inventory.ensureVehicleLocation(tx, { vehicleId: uuidv7(), name: `Van ${run}` }))
        .id
      const good = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `GOOD-${run}`,
        mrpPaise: 2000,
        expiryDate: day(300),
      })
      const damaged = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: binBatch,
        mrpPaise: 2000,
        expiryDate: day(150),
      })
      goodLot = good.lot.id
      binLot = damaged.lot.id
      await inventory.post(tx, [
        {
          lotId: goodLot,
          locationId: godown,
          qtyDelta: 500,
          reason: 'opening',
          idempotencyKey: `binx-open-good-${run}`,
        },
        {
          lotId: binLot,
          locationId: godown,
          qtyDelta: 100,
          reason: 'opening',
          idempotencyKey: `binx-open-bin-${run}`,
        },
      ])
    })
    // damaged in the godown: 40 pieces into the bin by the godown login (ruling 6 keeps this door)
    const binned = await call(app, packer, 'POST', '/inventory/transfers', {
      idempotencyKey: `binx-into-bin-${run}`,
      lotId: binLot,
      fromLocationId: godown,
      toLocationId: bin,
      qtyPcs: 40,
      note: 'cartons crushed',
    })
    expect(binned.status, JSON.stringify(binned.body)).toBe(200)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await db.delete(hsnRates).where(eq(hsnRates.hsnCode, hsn))
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // V10 / V8 — an order never names the bin as the place it is packed from

  it('DOS-352 (V10): an order cannot name the damaged bin, the dock, a van or a place that is not the distributor’s as where it is packed from — not the rep, not the owner — and nothing is drafted', async () => {
    // The architect ruling of 2026-09-28 (the last stock row, "an order is never served from a van") answers one of
    // this distributor's places that no order is served from with 409, the conflict it is; an id that is not one of
    // its places stays a 400.
    const byRep = draftOrder(rep, 'rep-bin', bin)
    const refusedRep = await byRep.res
    expect(refusedRep.status).toBe(409)
    expect(refusedRep.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(refusedRep.body.message).toBe(notFromBin)

    const byOwner = draftOrder(owner, 'owner-bin', bin)
    const refusedOwner = await byOwner.res
    expect(refusedOwner.status).toBe(409)
    expect(refusedOwner.body.message).toBe(notFromBin)

    const fromDock = draftOrder(owner, 'owner-dock', dock)
    const refusedDock = await fromDock.res
    expect(refusedDock.status).toBe(409)
    expect(refusedDock.body.message).toBe(
      'An order is packed from a godown, not from In transit: the pieces standing there are already packed for other bills. Place the order without a location and it is packed from the godown.',
    )
    // ...and a van: only the van sale's own door serves an order from a van (the same ruling)
    const fromVan = draftOrder(owner, 'owner-van', van)
    const refusedVan = await fromVan.res
    expect(refusedVan.status).toBe(409)
    expect(refusedVan.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(refusedVan.body.message).toBe(
      `An order is packed from a godown, not from Van ${run}: a van carries its own trip’s bills and van stock, and sells from it only through a van sale on that trip. Place the order without a location and it is packed from the godown.`,
    )
    const stranger = uuidv7()
    const fromNowhere = draftOrder(owner, 'owner-nowhere', stranger)
    const refusedNowhere = await fromNowhere.res
    expect(refusedNowhere.status).toBe(400)
    expect(refusedNowhere.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(refusedNowhere.body.message).toMatch(new RegExp(`not from location ${stranger}`))

    for (const id of [byRep.id, byOwner.id, fromDock.id, fromVan.id, fromNowhere.id])
      expect(await orderRow(id)).toBeUndefined()

    // a godown is the place an order is packed from
    const fromGodown = draftOrder(owner, 'owner-godown', godown)
    expect((await fromGodown.res).status).toBe(200)
    expect((await orderRow(fromGodown.id))?.fulfilFromLocationId).toBe(godown)
  })

  it('DOS-352 (V10): a device upload cannot draft an order packed from the bin, nor re-head a draft onto it — a sync rejection in words, and nothing changes', async () => {
    const opId = `binx-so-${run}`
    const id = uuidv7()
    const uploaded = await call<Uploaded>(app, rep, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `binx-device-${run}`,
      ops: [
        {
          opId,
          op: 'PUT',
          table: 'sales_orders',
          id,
          data: { retailer_id: shop, state: 'draft', fulfil_from_location_id: bin },
        },
      ],
    })
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.accepted).toBe(0)
    expect(uploaded.body.rejected.map((r) => [r.opId, r.code])).toEqual([
      [opId, 'fulfil_location_not_sellable'],
    ])
    expect(await orderRow(id)).toBeUndefined()

    // the rep's own draft, placed without a place, is not re-headed onto the bin either
    const draft = draftOrder(rep, 'rep-draft')
    expect((await draft.res).status).toBe(200)
    const reheadId = `binx-rehead-${run}`
    const rehead = await call<Uploaded>(app, rep, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `binx-device-${run}`,
      ops: [
        {
          opId: reheadId,
          op: 'PUT',
          table: 'sales_orders',
          id: draft.id,
          data: { retailer_id: shop, state: 'draft', fulfil_from_location_id: bin },
        },
      ],
    })
    expect(rehead.status).toBe(200)
    expect(rehead.body.rejected.map((r) => [r.opId, r.code])).toEqual([
      [reheadId, 'fulfil_location_not_sellable'],
    ])
    expect(await orderRow(draft.id)).toEqual({ state: 'draft', fulfilFromLocationId: null })
  })

  it('DOS-352 (V8): an order already stored with the bin as its place (drafted before the fix) is not submitted or confirmed — refused in words, nothing held', async () => {
    const legacy = draftOrder(rep, 'legacy-bin')
    expect((await legacy.res).status).toBe(200)
    await db
      .update(salesOrders)
      .set({ fulfilFromLocationId: bin })
      .where(eq(salesOrders.id, legacy.id))
    const submitted = await call<Refusal>(app, rep, 'POST', `/orders/${legacy.id}/submit`, {
      idempotencyKey: `submit-legacy-${run}`,
    })
    expect(submitted.status).toBe(409)
    expect(submitted.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(submitted.body.message).toBe(
      'This order is set to be packed from Damaged / expiry bin: pieces in the damaged / expiry bin never go back for sale. Cancel it and place it again without a location; it is then packed from the godown.',
    )
    expect((await orderRow(legacy.id))?.state).toBe('draft')
    const held = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.tenantId, tenantId), eq(reservations.locationId, bin)))
    expect(held).toEqual([])
  })

  it('DOS-352 (V8): an order pointed at the bin is never waved, picked, packed or billed — the wave and the desk’s pack are refused in words, the pieces stay in the bin and no bill is made', async () => {
    // an order confirmed from the godown, then pointed at the bin the way a pre-fix row (or any path the order
    // checks miss) points it: the wave, the pick and the pack all take their place from the order
    const placed = draftOrder(rep, 'pack-bin')
    expect((await placed.res).status).toBe(200)
    const submitted = await call<{ item: { state: string; orderNo: string } }>(
      app,
      rep,
      'POST',
      `/orders/${placed.id}/submit`,
      { idempotencyKey: `submit-pack-bin-${run}` },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    const orderNo = submitted.body.item.orderNo
    await db
      .update(salesOrders)
      .set({ fulfilFromLocationId: bin })
      .where(eq(salesOrders.id, placed.id))
    const notServed = (at: 'picked' | 'packed') =>
      `${orderNo} is set to be served from Damaged / expiry bin, so it is not ${at}: pieces in the damaged / expiry bin never go back for sale. An order is served from a godown: cancel it and place it again without a location; it is then picked and packed from the godown.`

    const binBefore = await onHandAt(binLot, bin)
    const rowsBefore = await ledgerCount()
    // The wave is refused when it is made (the merged stock-states lane's vans and trips ruling 6 refused a wave at the
    // bin; the architect ruling of 2026-09-28, the last stock row, refuses first the order that is not served from a
    // godown). It answered 200 before the merge; the ruling is the refusal.
    const waved = await call<Refusal>(app, packer, 'POST', '/warehouse/picklists', {
      idempotencyKey: `wave-bin-${run}`,
      id: uuidv7(),
      orderIds: [placed.id],
    })
    expect(waved.status, JSON.stringify(waved.body)).toBe(409)
    expect(waved.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(waved.body.message).toBe(notServed('picked'))
    expect(await onHandAt(binLot, bin)).toBe(binBefore)
    expect(await ledgerCount()).toBe(rowsBefore)

    // the desk's pack without a wave takes its place from the order too, and is refused the same way
    const packed = await call<Refusal>(app, packer, 'POST', `/warehouse/orders/${placed.id}/pack`, {
      idempotencyKey: `pack-bin-${run}`,
      id: uuidv7(),
      packages: 1,
    })
    expect(packed.status, JSON.stringify(packed.body)).toBe(409)
    expect(packed.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(packed.body.message).toBe(notServed('packed'))
    expect(await onHandAt(binLot, bin)).toBe(binBefore)
    expect(await onHandAt(binLot, dock)).toBe(0)
    expect(await ledgerCount()).toBe(rowsBefore)
    const packs = await db
      .select({ id: packConfirmations.id })
      .from(packConfirmations)
      .where(eq(packConfirmations.orderId, placed.id))
    expect(packs).toEqual([])
  })

  // ---------------------------------------------------------------------------------------------------------------
  // V7 — a load sheet sourced from the bin

  it('DOS-352 (V7): a load sheet sourced from the bin never puts its pieces on a van — the ledger refuses the load-out in words and nothing moves', async () => {
    const inBin = await onHandAt(binLot, bin)
    const rows = await ledgerCount()
    const sheetId = uuidv7()
    const created = await call<Refusal>(app, manager, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet-bin-${run}`,
      id: sheetId,
      fromLocationId: bin,
      toLocationId: van,
      vanStock: [{ lotId: binLot, qtyPcs: 5 }],
    })
    // whichever door refuses it — the sheet (the fulfilment lane's) or its load-out (the ledger) — the pieces stay
    if (created.status === 200) {
      const confirmed = await call<Refusal>(
        app,
        manager,
        'POST',
        `/warehouse/load-sheets/${sheetId}/confirm`,
        {
          idempotencyKey: `sheet-bin-confirm-${run}`,
          countedPackages: 0,
          challanId: uuidv7(),
          countedVanStock: [{ lotId: binLot, qtyPcs: 5 }],
        },
      )
      expect(confirmed.status).toBe(409)
      expect(confirmed.body.data?.code).toBe('damaged_not_for_sale')
      expect(confirmed.body.message).toBe(
        `${binWords}, so 5 pc of ${item} (batch ${binBatch}) cannot be moved to Van ${run}. ${exits}`,
      )
    } else {
      expect(created.status).toBeGreaterThanOrEqual(400)
      expect(created.status).toBeLessThan(500)
    }
    expect(await onHandAt(binLot, bin)).toBe(inBin)
    expect(await onHandAt(binLot, van)).toBe(0)
    expect(await ledgerCount()).toBe(rows)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the ledger, whoever calls it

  it('DOS-352: the ledger itself lets nothing out of the bin for sale — a sale row, a pick onto the dock, a load onto a van — while a write-off, a count and bin to bin still go', async () => {
    const rows = await ledgerCount()
    const inBin = await onHandAt(binLot, bin)
    const refused = async (fn: (tx: Db) => Promise<unknown>) => {
      const err = await asOwner(fn).then(
        () => null,
        (e: unknown) => e as { status?: number; message?: string; data?: { code?: string } },
      )
      expect(err, 'the ledger took pieces out of the bin for sale').not.toBeNull()
      expect(err?.data?.code).toBe('damaged_not_for_sale')
      return err?.message ?? ''
    }
    // a sale straight out of the bin (the shape `postReservationAsSale` posts)
    expect(
      await refused((tx) =>
        inventory.post(tx, [
          {
            lotId: binLot,
            locationId: bin,
            qtyDelta: -2,
            reason: 'sale',
            refType: 'invoice',
            refId: uuidv7(),
            idempotencyKey: `binx-sale-${run}`,
          },
        ]),
      ),
    ).toBe(`${binWords}, so 2 pc of ${item} (batch ${binBatch}) cannot be sold from it. ${exits}`)
    // the pack's own call
    expect(
      await refused((tx) =>
        inventory.postPick(tx, {
          orderLineId: uuidv7(),
          locationId: bin,
          picks: [{ lotId: binLot, qtyPcs: 3 }],
          refType: 'pack',
          refId: uuidv7(),
          idempotencyKey: `binx-pick-${run}`,
        }),
      ),
    ).toMatch(/cannot be moved to In transit\./)
    // the load-out's shape: out of the bin, onto a van
    expect(
      await refused((tx) =>
        inventory.post(tx, [
          {
            lotId: binLot,
            locationId: bin,
            qtyDelta: -4,
            reason: 'transfer_out',
            refType: 'load_sheet',
            refId: uuidv7(),
            idempotencyKey: `binx-load-${run}:out`,
          },
          {
            lotId: binLot,
            locationId: van,
            qtyDelta: 4,
            reason: 'transfer_in',
            refType: 'load_sheet',
            refId: uuidv7(),
            idempotencyKey: `binx-load-${run}:in`,
          },
        ]),
      ),
    ).toMatch(new RegExp(`cannot be moved to Van ${run}\\.`))
    // the bin's own exits by a correcting pair in ONE call are not a way round it either
    expect(
      await refused((tx) =>
        inventory.post(tx, [
          {
            lotId: binLot,
            locationId: bin,
            qtyDelta: -1,
            reason: 'transfer_out',
            idempotencyKey: `binx-pair-${run}:out`,
          },
          {
            lotId: binLot,
            locationId: godown,
            qtyDelta: 1,
            reason: 'transfer_in',
            idempotencyKey: `binx-pair-${run}:in`,
          },
        ]),
      ),
    ).toMatch(/cannot be moved to Godown\./)
    expect(await ledgerCount()).toBe(rows)
    expect(await onHandAt(binLot, bin)).toBe(inBin)

    // what still goes: bin to bin, a count at the bin, the desk's write-off
    const claimShelf = uuidv7()
    await db
      .insert(locations)
      .values({ id: claimShelf, tenantId, kind: 'damaged', name: `Claim shelf ${run}` })
    await asOwner((tx) =>
      inventory.post(tx, [
        {
          lotId: binLot,
          locationId: bin,
          qtyDelta: -2,
          reason: 'transfer_out',
          refType: 'transfer',
          idempotencyKey: `binx-bin2-${run}:out`,
        },
        {
          lotId: binLot,
          locationId: claimShelf,
          qtyDelta: 2,
          reason: 'transfer_in',
          refType: 'transfer',
          idempotencyKey: `binx-bin2-${run}:in`,
        },
        {
          lotId: binLot,
          locationId: bin,
          qtyDelta: -1,
          reason: 'cycle_count',
          refType: 'cycle_count',
          idempotencyKey: `binx-count-${run}`,
        },
        {
          lotId: binLot,
          locationId: bin,
          qtyDelta: -1,
          reason: 'expiry_writeoff',
          refType: 'adjustment',
          idempotencyKey: `binx-wo-${run}`,
        },
      ]),
    )
    expect(await onHandAt(binLot, bin)).toBe(inBin - 4)
    expect(await onHandAt(binLot, claimShelf)).toBe(2)
    const written = await db
      .select({ reason: stockLedger.reason })
      .from(stockLedger)
      .where(and(eq(stockLedger.tenantId, tenantId), eq(stockLedger.lotId, binLot)))
    expect(written.length).toBeGreaterThanOrEqual(4)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // V9 — the bin keeps its kind

  it('DOS-352 (V9): the damaged bin keeps its kind — no login re-saves it as a godown, no place becomes a bin by a new kind, a place holding stock keeps its kind; a new name still goes', async () => {
    const rows = await ledgerCount()
    for (const actor of [packer, owner]) {
      const res = await call<Refusal>(app, actor, 'POST', '/inventory/locations', {
        idempotencyKey: `rekind-bin-${actor.role}-${run}`,
        id: bin,
        kind: 'warehouse',
        name: 'Damaged / expiry bin',
      })
      expect(res.status, actor.role).toBe(409)
      expect(res.body.data?.code).toBe('location_kind_fixed')
      expect(res.body.message).toBe(
        'Damaged / expiry bin is the damaged / expiry bin and stays one: pieces in it never go back for sale, so it cannot be saved as a godown. They leave the bin only by a write-off or a return to the brand. For a new godown, add a new location.',
      )
    }
    const [still] = await db
      .select({ kind: locations.kind })
      .from(locations)
      .where(eq(locations.id, bin))
    expect(still?.kind).toBe('damaged')
    const offered = await call<{ items: unknown[] }>(app, rep, 'GET', '/inventory/sellable', {
      locationId: bin,
    })
    expect(offered.status).toBe(200)
    expect(offered.body.items).toEqual([])

    // a godown does not become a bin by a new kind (its pieces would leave sale with no ledger row)
    const toBin = await call<Refusal>(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `rekind-godown-bin-${run}`,
      id: godown,
      kind: 'damaged',
      name: 'Godown',
    })
    expect(toBin.status).toBe(409)
    expect(toBin.body.data?.code).toBe('location_kind_fixed')
    expect(toBin.body.message).toBe(
      'Godown is a godown and cannot become a damaged / expiry bin: damaged and expired pieces are moved into the bin with a damage or expiry write-off. For another bin, add a new location.',
    )
    // the godown keeps its kind: it is a fixed place (vans and trips ruling 5; a second godown holding stock
    // keeps its kind by `location_holds_stock`, pinned in fixed-places.spec.ts)
    const toVan = await call<Refusal>(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `rekind-godown-van-${run}`,
      id: godown,
      kind: 'vehicle',
      name: 'Godown',
    })
    expect(toVan.status).toBe(409)
    expect(toVan.body.data?.code).toBe('location_fixed')
    expect(toVan.body.message).toBe(
      'Godown is the godown: orders are held and packed there and goods are received into it, so it is a fixed place — it stays switched on and stays the godown. You can rename it; for another place, add a new location.',
    )
    const [godownRow] = await db
      .select({ kind: locations.kind })
      .from(locations)
      .where(eq(locations.id, godown))
    expect(godownRow?.kind).toBe('warehouse')
    expect(await ledgerCount()).toBe(rows)

    // what still goes: an empty place changes kind, and the bin changes its name
    const annex = uuidv7()
    const made = await call(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `annex-${run}`,
      id: annex,
      kind: 'warehouse',
      name: `Annex ${run}`,
    })
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    const remade = await call(app, owner, 'POST', '/inventory/locations', {
      idempotencyKey: `annex-van-${run}`,
      id: annex,
      kind: 'vehicle',
      name: `Annex ${run}`,
    })
    expect(remade.status, JSON.stringify(remade.body)).toBe(200)
    const renamed = await call<{ item: { kind: string; name: string } }>(
      app,
      packer,
      'POST',
      '/inventory/locations',
      {
        idempotencyKey: `rename-bin-${run}`,
        id: bin,
        kind: 'damaged',
        name: `Claim bin ${run}`,
      },
    )
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect(renamed.body.item).toMatchObject({ kind: 'damaged', name: `Claim bin ${run}` })
  })
})
