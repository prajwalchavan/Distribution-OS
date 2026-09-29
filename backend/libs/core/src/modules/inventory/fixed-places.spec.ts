/**
 * THE GODOWN, THE DOCK AND THE BIN ARE FIXED PLACES (architect ruling 5 on vans and trips, 2026-09-28) — and a
 * carton binned by mistake is the OWNER's correction (stock ruling 2, restated there). The second blind check of
 * the bin lane found:
 *
 *   MAJOR  the godown login switched the damaged / expiry bin off (`inventory.locations.upsert`, `active: false`,
 *          200); a damage write-off at the godown then wrote the pieces off there and reached no bin, and every
 *          goods receipt answered 500 "tenant has no damaged location (bootstrap)";
 *   minor  the correction of a carton binned by mistake (−N at the bin, +N at the godown) was open to a manager.
 *
 * Every door is here: the godown login, a manager and the owner, the same request a second time; the write-off
 * and the goods receipt that depend on the bin; and a distributor that has no bin at all, which is answered in
 * words, never with a 500. The database half (the trigger, the correction of 0075) is in `rls.test.ts`.
 *
 * The third blind check found the door the second left open (BLOCKER): a place CREATED with a client-chosen id
 * older than the dock's became "the first active place of its kind" — the dock every service reads — and every
 * bill packed onto the real dock could then not be loaded, cancelled or moved; the fixed-place rule made the
 * intruder permanent. No place takes the seat of the godown, the dock or the bin now: not by a new id, not by
 * being switched on, not by a new kind. Its minors in this lane are here too: another distributor's place id is a
 * sentence, not a 500; a switched-off place takes no goods; the owner's correction out of the bin carries its
 * reason.
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
  stockBalances,
  suppliers,
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
import { ProcurementModule } from '../procurement/index.js'
import { damagedBinPlace, dockLocationId, InventoryModule, reservableLocationId } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Refusal = { message: string; data?: { code?: string } }
type Place = { id: string; kind: string; name: string; active: boolean }
type Moved = {
  entry: { reason: string; qtyDelta: number; locationId: string }
  movedToBin?: { locationName: string; entry: { qtyDelta: number; locationId: string } }
}

/** Today in IST plus `n` days, as an ISO day. */
function day(n: number): string {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + n)).toISOString().slice(0, 10)
}

describeDb('inventory: the fixed places and the owner’s correction (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)

  // Distributor A: bootstrapped as every distributor is.
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const storeId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }

  // Distributor B: its bin is gone (never set up) — the state a switched-off bin used to leave.
  const tenantB = uuidv7()
  const ownerBId = uuidv7()
  const storeBId = uuidv7()
  const ownerB: Actor = { tenantId: tenantB, actorId: ownerBId, role: 'owner' }
  const storeB: Actor = { tenantId: tenantB, actorId: storeBId, role: 'warehouse' }
  const supplierB = uuidv7()

  const variantId = uuidv7()
  const item = 'Rajwadi Soda Water 750 ml'
  let godown = ''
  let bin = ''
  let dock = ''
  let godownB = ''
  let dockB = ''
  let app: NestFastifyApplication
  let billNo = 0

  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))
  /** The three places every service reads, as the services find them. */
  const fixedAsServicesSeeThem = () =>
    asOwner(async (tx) => ({
      godown: await reservableLocationId(tx),
      dock: await dockLocationId(tx),
      bin: (await damagedBinPlace(tx)).id,
    }))
  /** An id that sorts before every id the bootstrap minted today: what a crafted request or a device set years back sends. */
  const early = (n: number) => `00000000-0000-7000-8${n.toString(16)}00-0000${run}`

  const onHandAt = async (lotId: string, locationId: string): Promise<number> => {
    const [row] = await db
      .select({ onHand: stockBalances.onHand })
      .from(stockBalances)
      .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, locationId)))
    return row?.onHand ?? 0
  }
  const ledgerCount = async (tenant: string): Promise<number> => {
    const rows = (
      await db.execute(sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenant}`)
    ).rows as { n: number }[]
    return rows[0]?.n ?? 0
  }
  const placeRow = async (id: string) =>
    (
      await db
        .select({ kind: locations.kind, active: locations.active, name: locations.name })
        .from(locations)
        .where(eq(locations.id, id))
    )[0]
  const upsert = (actor: Actor, key: string, body: Record<string, unknown>) =>
    call<Refusal & { item: Place }>(app, actor, 'POST', '/inventory/locations', {
      idempotencyKey: `${key}-${run}`,
      ...body,
    })
  const newLot = async (actor: Actor, batchNo: string): Promise<string> => {
    const id = uuidv7()
    const res = await call(app, actor, 'POST', '/inventory/lots', {
      idempotencyKey: `lot-${id}`,
      id,
      variantId,
      batchNo: `${batchNo}-${run}`,
      mrpPaise: 2000,
      expiryDate: day(200),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return id
  }
  const adjust = (actor: Actor, body: Record<string, unknown>) =>
    call<Refusal & Moved>(app, actor, 'POST', '/inventory/adjustments', {
      idempotencyKey: uuidv7(),
      ...body,
    })

  const fixedWords = (name: string, place: string, job: string) =>
    `${name} is the ${place}: ${job}, so it is a fixed place — it stays switched on and stays the ${place}. You can rename it; for another place, add a new location.`
  const noBin =
    "Nothing was saved: this distributor has no damaged / expiry bin, and damaged and expired pieces go there and nowhere else. The damaged / expiry bin is one of the places every distributor is set up with; ask support to set this distributor's places up again, then try once more."

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `fixed-${run}`, legalName: 'Fixed Places Traders', stateCode: '27' },
      { id: tenantB, slug: `nobin-${run}`, legalName: 'No Bin Traders', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91908${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91908${run}2`, name: 'Manager' },
      { id: storeId, phone: `+91908${run}3`, name: 'Godown' },
      { id: ownerBId, phone: `+91908${run}4`, name: 'Owner B' },
      { id: storeBId, phone: `+91908${run}5`, name: 'Godown B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId: tenantB, userId: ownerBId, role: 'owner' },
      { id: uuidv7(), tenantId: tenantB, userId: storeBId, role: 'warehouse' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, tenantB)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker fixed ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Soda', category: 'beverages' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: item,
      netQty: 750,
      netUnit: 'ml',
      defaultCaseSize: 24,
      hsnCode: '2202',
      mrpPaise: 2000,
    })
    await db.insert(suppliers).values({ id: supplierB, tenantId: tenantB, name: `Rajwadi ${run}` })
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} in (${tenantId}, ${tenantB})`)
    const of = (tenant: string, kind: string) =>
      locs.find((l) => l.tenantId === tenant && l.kind === kind)?.id ?? ''
    godown = of(tenantId, 'warehouse')
    bin = of(tenantId, 'damaged')
    dock = of(tenantId, 'in_transit')
    godownB = of(tenantB, 'warehouse')
    dockB = of(tenantB, 'in_transit')
    // Distributor B's bin never held a piece, so the row can go: no switch or update can take it off any more.
    await db.delete(locations).where(eq(locations.id, of(tenantB, 'damaged')))
    app = await bootTestApp([InventoryModule, ProcurementModule])
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('vans and trips ruling 5: the godown, the dock and the damaged / expiry bin stay switched on and keep their kind — for the godown login, a manager and the owner, and a second time — and the godown’s damage write-off still reaches the bin', async () => {
    const lot = await newLot(owner, 'R5-A')
    const open = await adjust(owner, {
      lotId: lot,
      locationId: godown,
      qtyDelta: 50,
      reason: 'opening',
    })
    expect(open.status, JSON.stringify(open.body)).toBe(200)
    const rows = await ledgerCount(tenantId)

    const fixed = [
      {
        id: bin,
        kind: 'damaged',
        name: 'Damaged / expiry bin',
        words: fixedWords(
          'Damaged / expiry bin',
          'damaged / expiry bin',
          'damaged and expired pieces go there and nowhere else',
        ),
      },
      {
        id: godown,
        kind: 'warehouse',
        name: 'Godown',
        words: fixedWords(
          'Godown',
          'godown',
          'orders are held and packed there and goods are received into it',
        ),
      },
      {
        id: dock,
        kind: 'in_transit',
        name: 'In transit',
        words: fixedWords('In transit', 'dock', 'packed goods wait there for their van'),
      },
    ]
    for (const actor of [store, manager, owner])
      for (const place of fixed) {
        const body = { id: place.id, kind: place.kind, name: place.name, active: false }
        for (const attempt of ['first', 'again']) {
          const res = await upsert(actor, `off-${actor.role}-${place.kind}`, body)
          expect(res.status, `${actor.role} ${place.kind} ${attempt}`).toBe(409)
          expect(res.body.data?.code).toBe('location_fixed')
          expect(res.body.message).toBe(place.words)
        }
      }

    // nor a new kind: the godown saved as a van, the dock as a godown
    const godownToVan = await upsert(owner, 'godown-van', {
      id: godown,
      kind: 'vehicle',
      name: 'Godown',
    })
    expect(godownToVan.status).toBe(409)
    expect(godownToVan.body.data?.code).toBe('location_fixed')
    expect(godownToVan.body.message).toBe(fixed[1]?.words)
    const dockToGodown = await upsert(manager, 'dock-godown', {
      id: dock,
      kind: 'warehouse',
      name: 'In transit',
    })
    expect(dockToGodown.status).toBe(409)
    expect(dockToGodown.body.message).toBe(fixed[2]?.words)

    for (const place of fixed)
      expect(await placeRow(place.id)).toMatchObject({ kind: place.kind, active: true })
    expect(await ledgerCount(tenantId)).toBe(rows)

    // a new name still goes, and the place stays what it is
    const renamed = await upsert(store, 'rename-bin', {
      id: bin,
      kind: 'damaged',
      name: `Claim bin ${run}`,
    })
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect(renamed.body.item).toMatchObject({ name: `Claim bin ${run}`, active: true })
    const back = await upsert(store, 'rename-bin-back', {
      id: bin,
      kind: 'damaged',
      name: 'Damaged / expiry bin',
    })
    expect(back.status).toBe(200)

    // damaged in the godown still means moved to the bin (ruling 6): the bin was never switched off
    const damaged = await adjust(store, {
      lotId: lot,
      locationId: godown,
      qtyDelta: -2,
      reason: 'damage',
      note: 'carton crushed',
    })
    expect(damaged.status, JSON.stringify(damaged.body)).toBe(200)
    expect(damaged.body.movedToBin).toMatchObject({
      locationName: 'Damaged / expiry bin',
      entry: { qtyDelta: 2, locationId: bin },
    })
    expect(await onHandAt(lot, bin)).toBe(2)
  })

  it('vans and trips ruling 5: a place the owner added is switched off only when it holds nothing — a second godown with stock is refused in words, empty it goes off and comes back; a van goes off', async () => {
    const annex = uuidv7()
    const made = await upsert(owner, 'annex', {
      id: annex,
      kind: 'warehouse',
      name: `Annex ${run}`,
    })
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    const lot = await newLot(owner, 'R5-B')
    const open = await adjust(owner, {
      lotId: lot,
      locationId: annex,
      qtyDelta: 5,
      reason: 'opening',
    })
    expect(open.status, JSON.stringify(open.body)).toBe(200)

    const off = await upsert(store, 'annex-off', {
      id: annex,
      kind: 'warehouse',
      name: `Annex ${run}`,
      active: false,
    })
    expect(off.status).toBe(409)
    expect(off.body.data?.code).toBe('location_holds_stock')
    expect(off.body.message).toBe(
      `Annex ${run} holds 5 pc, so it stays switched on: a place that is switched off drops out of every list while its pieces are still on the books. Move them out first, then switch it off.`,
    )
    const rekind = await upsert(owner, 'annex-van', {
      id: annex,
      kind: 'vehicle',
      name: `Annex ${run}`,
    })
    expect(rekind.status).toBe(409)
    expect(rekind.body.data?.code).toBe('location_holds_stock')
    expect(rekind.body.message).toBe(
      `Annex ${run} holds 5 pc, so it stays a godown: a new kind would change what those pieces may be sold as. Move them out first, or add a new location.`,
    )
    expect(await placeRow(annex)).toMatchObject({ kind: 'warehouse', active: true })

    const moved = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `annex-empty-${run}`,
      lotId: lot,
      fromLocationId: annex,
      toLocationId: godown,
      qtyPcs: 5,
    })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    const offNow = await upsert(store, 'annex-off-empty', {
      id: annex,
      kind: 'warehouse',
      name: `Annex ${run}`,
      active: false,
    })
    expect(offNow.status, JSON.stringify(offNow.body)).toBe(200)
    expect(offNow.body.item.active).toBe(false)
    const onAgain = await upsert(manager, 'annex-on', {
      id: annex,
      kind: 'warehouse',
      name: `Annex ${run}`,
    })
    expect(onAgain.status, JSON.stringify(onAgain.body)).toBe(200)
    expect(onAgain.body.item.active).toBe(true)

    const van = uuidv7()
    expect(
      (await upsert(owner, 'van', { id: van, kind: 'vehicle', name: `Van ${run}` })).status,
    ).toBe(200)
    const vanOff = await upsert(owner, 'van-off', {
      id: van,
      kind: 'vehicle',
      name: `Van ${run}`,
      active: false,
    })
    expect(vanOff.status, JSON.stringify(vanOff.body)).toBe(200)
    // the godown is still the godown: the annex never displaced it
    expect(await placeRow(godown)).toMatchObject({ kind: 'warehouse', active: true })
  })

  it('stock ruling 2 / vans and trips ruling 5: a carton binned by mistake is the owner’s correction — a manager’s plain correction, hand count or opening out of the bin is refused, a manager’s write-off from the bin still goes', async () => {
    const lot = await newLot(owner, 'R2-C')
    const open = await adjust(owner, {
      lotId: lot,
      locationId: godown,
      qtyDelta: 30,
      reason: 'opening',
    })
    expect(open.status).toBe(200)
    const binned = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `into-bin-${run}`,
      lotId: lot,
      fromLocationId: godown,
      toLocationId: bin,
      qtyPcs: 12,
      note: 'looked crushed',
    })
    expect(binned.status, JSON.stringify(binned.body)).toBe(200)
    const rows = await ledgerCount(tenantId)

    for (const reason of ['adjustment', 'cycle_count', 'opening'] as const) {
      const refused = await adjust(manager, {
        lotId: lot,
        locationId: bin,
        qtyDelta: -10,
        reason,
        note: 'binned by mistake',
      })
      expect(refused.status, reason).toBe(403)
      expect(refused.body.data?.code).toBe('bin_correction_owner_only')
      expect(refused.body.message).toBe(
        "Only the owner takes pieces out of Damaged / expiry bin without writing them off: a carton put in the bin by mistake is the owner's correction, with a reason. A manager writes damaged or expired pieces off from the bin as a damage or expiry write-off.",
      )
    }
    expect(await ledgerCount(tenantId)).toBe(rows)
    expect(await onHandAt(lot, bin)).toBe(12)

    // the desk's write-off from the bin is still the manager's (ruling 6)
    for (const reason of ['damage', 'expiry_writeoff'] as const) {
      const wo = await adjust(manager, { lotId: lot, locationId: bin, qtyDelta: -1, reason })
      expect(wo.status, JSON.stringify(wo.body)).toBe(200)
      expect(wo.body.movedToBin).toBeUndefined()
    }
    expect(await onHandAt(lot, bin)).toBe(10)

    // "with a reason" (ruling 2): the owner's correction out of the bin with no written reason is refused, twice
    const rowsBefore = await ledgerCount(tenantId)
    for (const note of [undefined, '   ']) {
      const bare = await adjust(owner, {
        lotId: lot,
        locationId: bin,
        qtyDelta: -10,
        reason: 'adjustment',
        ...(note === undefined ? {} : { note }),
      })
      expect(bare.status, JSON.stringify(bare.body)).toBe(400)
      expect(bare.body.data?.code).toBe('bin_correction_needs_note')
      expect(bare.body.message).toBe(
        'Write why these pieces leave Damaged / expiry bin without a write-off — for example "binned by mistake, carton is sound" — and save again: the owner\'s correction out of the bin always carries its reason.',
      )
    }
    expect(await ledgerCount(tenantId)).toBe(rowsBefore)
    expect(await onHandAt(lot, bin)).toBe(10)

    // the owner's correction: out of the bin, back onto the godown's books, who and why on both rows
    const out = await adjust(owner, {
      lotId: lot,
      locationId: bin,
      qtyDelta: -10,
      reason: 'adjustment',
      note: 'binned by mistake, carton is sound',
    })
    const inn = await adjust(owner, {
      lotId: lot,
      locationId: godown,
      qtyDelta: 10,
      reason: 'adjustment',
      note: 'binned by mistake, carton is sound',
    })
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(inn.status, JSON.stringify(inn.body)).toBe(200)
    expect(await onHandAt(lot, bin)).toBe(0)
    expect(await onHandAt(lot, godown)).toBe(28)
  })

  it('vans and trips ruling 5 (third blind check, BLOCKER): no place takes the seat of the godown, the dock or the bin — a new place whose id comes before theirs is refused for the godown login, a manager and the owner, a second time too; an older place is not switched on or re-kinded into one; the goods on the dock stay the dock’s', async () => {
    // goods standing on the dock, the way a packed bill leaves them
    const lot = await newLot(owner, 'R5-E')
    expect(
      (await adjust(owner, { lotId: lot, locationId: godown, qtyDelta: 20, reason: 'opening' }))
        .status,
    ).toBe(200)
    const staged = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `to-dock-${run}`,
      lotId: lot,
      fromLocationId: godown,
      toLocationId: dock,
      qtyPcs: 6,
    })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    const before = await fixedAsServicesSeeThem()
    expect(before).toEqual({ godown, dock, bin })
    const rows = await ledgerCount(tenantId)

    const seats = [
      {
        kind: 'in_transit',
        words:
          "Nothing was saved: a new dock with this id would take the place of In transit, the distributor's dock — packed goods wait there for their van — because its id comes before In transit's. Add the place again with a new id: one made today always comes after it.",
      },
      {
        kind: 'warehouse',
        words:
          "Nothing was saved: a new godown with this id would take the place of Godown, the distributor's godown — orders are held and packed there and goods are received into it — because its id comes before Godown's. Add the place again with a new id: one made today always comes after it.",
      },
      {
        kind: 'damaged',
        words:
          "Nothing was saved: a new damaged / expiry bin with this id would take the place of Damaged / expiry bin, the distributor's damaged / expiry bin — damaged and expired pieces go there and nowhere else — because its id comes before Damaged / expiry bin's. Add the place again with a new id: one made today always comes after it.",
      },
    ]
    for (const [a, actor] of [store, manager, owner].entries())
      for (const [s, seat] of seats.entries()) {
        const id = early(a * 3 + s)
        for (const attempt of ['first', 'again']) {
          const res = await upsert(actor, `early-${actor.role}-${seat.kind}`, {
            id,
            kind: seat.kind,
            name: `Early ${seat.kind} ${actor.role} ${run}`,
          })
          expect(
            res.status,
            `${actor.role} ${seat.kind} ${attempt} ${JSON.stringify(res.body)}`,
          ).toBe(409)
          expect(res.body.data?.code).toBe('location_before_fixed')
          expect(res.body.message).toBe(seat.words)
        }
        expect(await placeRow(id)).toBeUndefined()
      }

    // switched off it may be saved (it holds no seat), but it is never switched on …
    const offEarly = early(10)
    const madeOff = await upsert(owner, 'early-off', {
      id: offEarly,
      kind: 'in_transit',
      name: `Early dock ${run}`,
      active: false,
    })
    expect(madeOff.status, JSON.stringify(madeOff.body)).toBe(200)
    for (const actor of [store, owner]) {
      const on = await upsert(actor, `early-on-${actor.role}`, {
        id: offEarly,
        kind: 'in_transit',
        name: `Early dock ${run}`,
      })
      expect(on.status, JSON.stringify(on.body)).toBe(409)
      expect(on.body.data?.code).toBe('location_before_fixed')
      expect(on.body.message).toBe(
        `Early dock ${run} cannot be switched on as a dock: it was made before In transit, the distributor's dock, and would take its place — packed goods wait there for their van. Leave it switched off and move any pieces out of it with a stock transfer; for another dock, add a new location.`,
      )
    }
    expect(await placeRow(offEarly)).toMatchObject({ kind: 'in_transit', active: false })
    // … and an older place of another kind does not become one
    const earlyVan = early(11)
    expect(
      (
        await upsert(owner, 'early-van', {
          id: earlyVan,
          kind: 'vehicle',
          name: `Early van ${run}`,
        })
      ).status,
    ).toBe(200)
    const vanToGodown = await upsert(manager, 'early-van-godown', {
      id: earlyVan,
      kind: 'warehouse',
      name: `Early van ${run}`,
    })
    expect(vanToGodown.status, JSON.stringify(vanToGodown.body)).toBe(409)
    expect(vanToGodown.body.data?.code).toBe('location_before_fixed')
    expect(vanToGodown.body.message).toBe(
      `Early van ${run} cannot become a godown: it was made before Godown, the distributor's godown, and would take its place — orders are held and packed there and goods are received into it. For another godown, add a new location.`,
    )
    expect(await placeRow(earlyVan)).toMatchObject({ kind: 'vehicle', active: true })

    // a place added today still goes, and takes no seat
    const later = uuidv7()
    expect(
      (await upsert(store, 'later-dock', { id: later, kind: 'in_transit', name: `Dock 2 ${run}` }))
        .status,
    ).toBe(200)

    // every service still reads the same three, and the dock still holds its goods
    expect(await fixedAsServicesSeeThem()).toEqual(before)
    expect(await onHandAt(lot, dock)).toBe(6)
    expect(await ledgerCount(tenantId)).toBe(rows)
  })

  it('third blind check, minor: another distributor’s godown or dock named by id is a sentence, not a 500, and the other distributor’s place is untouched', async () => {
    // another distributor's godown or dock, named by id: refused in words, the other distributor untouched
    for (const [actor, id] of [
      [owner, godownB],
      [store, dockB],
    ] as const) {
      const res = await upsert(actor, `taken-${actor.role}`, {
        id,
        kind: 'warehouse',
        name: `Taken ${actor.role} ${run}`,
      })
      expect(res.status, JSON.stringify(res.body)).toBe(409)
      expect(res.body.data?.code).toBe('location_id_taken')
      expect(res.body.message).toBe(
        'Nothing was saved: this location id already belongs to a place you cannot see. Add the place again from the app; a new place gets its own id.',
      )
    }
    expect(await placeRow(godownB)).toMatchObject({
      kind: 'warehouse',
      name: 'Godown',
      active: true,
    })
    expect(await placeRow(dockB)).toMatchObject({
      kind: 'in_transit',
      name: 'In transit',
      active: true,
    })
  })

  it('third blind check, minor: a switched-off place takes no goods — not by a hand transfer into an empty annex or van, not by an adjustment — and the pieces of a place left switched off still come out', async () => {
    // a switched-off place takes nothing: an empty annex and an empty van, by hand
    const lot = await newLot(owner, 'OFF')
    expect(
      (await adjust(owner, { lotId: lot, locationId: godown, qtyDelta: 20, reason: 'opening' }))
        .status,
    ).toBe(200)
    const annex = uuidv7()
    const van = uuidv7()
    expect(
      (await upsert(owner, 'off-annex', { id: annex, kind: 'warehouse', name: `Annex off ${run}` }))
        .status,
    ).toBe(200)
    expect(
      (await upsert(owner, 'off-van', { id: van, kind: 'vehicle', name: `Van off ${run}` })).status,
    ).toBe(200)
    for (const [id, name] of [
      [annex, `Annex off ${run}`],
      [van, `Van off ${run}`],
    ] as const) {
      const off = await upsert(owner, `switch-off-${name}`, {
        id,
        kind: id === annex ? 'warehouse' : 'vehicle',
        name,
        active: false,
      })
      expect(off.status, JSON.stringify(off.body)).toBe(200)
    }
    const rows = await ledgerCount(tenantId)
    for (const [actor, id, name] of [
      [store, annex, `Annex off ${run}`],
      [manager, van, `Van off ${run}`],
    ] as const) {
      const moved = await call<Refusal>(app, actor, 'POST', '/inventory/transfers', {
        idempotencyKey: `into-off-${id}`,
        lotId: lot,
        fromLocationId: godown,
        toLocationId: id,
        qtyPcs: 5,
      })
      expect(moved.status, JSON.stringify(moved.body)).toBe(409)
      expect(moved.body.data?.code).toBe('location_switched_off')
      expect(moved.body.message).toBe(
        `Nothing was saved: ${name} is switched off, so no pieces go into it. Switch it back on first, or put them in another place.`,
      )
    }
    const added = await adjust(owner, {
      lotId: lot,
      locationId: annex,
      qtyDelta: 3,
      reason: 'adjustment',
      note: 'found',
    })
    expect(added.status).toBe(409)
    expect(added.body.data?.code).toBe('location_switched_off')
    expect(await ledgerCount(tenantId)).toBe(rows)
    expect(await onHandAt(lot, godown)).toBe(20)

    // a place left switched off holding pieces (before the rule): its pieces still come out, into the godown
    const old = uuidv7()
    expect(
      (await upsert(owner, 'old-godown', { id: old, kind: 'warehouse', name: `Old godown ${run}` }))
        .status,
    ).toBe(200)
    const moveIn = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `into-old-${run}`,
      lotId: lot,
      fromLocationId: godown,
      toLocationId: old,
      qtyPcs: 4,
    })
    expect(moveIn.status, JSON.stringify(moveIn.body)).toBe(200)
    await db.update(locations).set({ active: false }).where(eq(locations.id, old))
    const out = await call(app, store, 'POST', '/inventory/transfers', {
      idempotencyKey: `out-of-old-${run}`,
      lotId: lot,
      fromLocationId: old,
      toLocationId: godown,
      qtyPcs: 4,
    })
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(await onHandAt(lot, old)).toBe(0)
    expect(await onHandAt(lot, godown)).toBe(20)

    // and a switched-off place is not counted (the fourth blind check, minor): a count opened there could never be
    // posted or cancelled, so it is refused when it is opened, in words, and nothing is saved
    const countId = uuidv7()
    const counted = await call<Refusal>(app, store, 'POST', '/inventory/cycle-counts', {
      idempotencyKey: `count-off-${run}`,
      id: countId,
      locationId: annex,
      lotIds: [lot],
    })
    expect(counted.status, JSON.stringify(counted.body)).toBe(409)
    expect(counted.body.data?.code).toBe('location_switched_off')
    expect(counted.body.message).toBe(
      `Nothing was saved: Annex off ${run} is switched off, so it is not counted. Switch it back on first, then count it; pieces a switched-off place still holds come out with a stock transfer.`,
    )
    const saved = await db.execute(
      sql`select count(*)::int as n from cycle_counts where id = ${countId}`,
    )
    expect((saved.rows[0] as { n: number }).n).toBe(0)
  })

  it('a distributor without its bin gets a sentence, never a 500: the godown’s damage write-off and a receipt with damaged pieces are refused with nothing written, and a receipt with nothing for the bin posts', async () => {
    const lot = await newLot(ownerB, 'NB')
    const open = await adjust(ownerB, {
      lotId: lot,
      locationId: godownB,
      qtyDelta: 20,
      reason: 'opening',
    })
    expect(open.status, JSON.stringify(open.body)).toBe(200)
    const rows = await ledgerCount(tenantB)

    const writeOff = await adjust(storeB, {
      lotId: lot,
      locationId: godownB,
      qtyDelta: -2,
      reason: 'damage',
    })
    expect(writeOff.status).toBe(409)
    expect(writeOff.body.data?.code).toBe('place_missing')
    expect(writeOff.body.message).toBe(noBin)
    expect(await ledgerCount(tenantB)).toBe(rows)
    expect(await onHandAt(lot, godownB)).toBe(20)

    /** An approved supplier bill of one line, opened at the godown and counted by the godown login. */
    const receipt = async (damagedPcs: number): Promise<string> => {
      billNo += 1
      const billId = uuidv7()
      const taxable = 1000 * 24
      const tax = (taxable * 1200) / 10000
      const bill = await call<{ item: { status: string } }>(
        app,
        ownerB,
        'POST',
        '/procurement/supplier-invoices',
        {
          idempotencyKey: `bill-${String(billNo)}-${run}`,
          id: billId,
          supplierId: supplierB,
          source: 'manual',
          invoiceNo: `RW/${run}/${String(billNo)}`,
          invoiceDate: day(0),
          subtotalPaise: taxable,
          discountPaise: 0,
          cgstPaise: tax / 2,
          sgstPaise: tax / 2,
          igstPaise: 0,
          cessPaise: 0,
          freightPaise: 0,
          roundOffPaise: 0,
          totalPaise: taxable + tax,
          lines: [
            {
              id: uuidv7(),
              lineNo: 1,
              description: item,
              variantId,
              hsnCode: '2202',
              batchNo: `RW-${String(billNo)}-${run}`,
              expiryDate: day(150),
              mrpPaise: 2000,
              printedQty: 24,
              printedUnit: 'pcs',
              qtyPcs: 24,
              freeQtyPcs: 0,
              ratePaise: 1000,
              gstBps: 1200,
              taxablePaise: taxable,
              taxPaise: tax,
              lineTotalPaise: taxable + tax,
            },
          ],
        },
      )
      expect(bill.status, JSON.stringify(bill.body)).toBe(200)
      const grnId = uuidv7()
      const opened = await call(app, ownerB, 'POST', '/procurement/grns', {
        idempotencyKey: `open-${grnId}`,
        id: grnId,
        supplierInvoiceId: billId,
        locationId: godownB,
      })
      expect(opened.status, JSON.stringify(opened.body)).toBe(200)
      const [line] = (await db.execute(sql`select id from grn_lines where grn_id = ${grnId}`))
        .rows as { id: string }[]
      const counted = await call(app, storeB, 'POST', `/procurement/grns/${grnId}/count`, {
        idempotencyKey: `count-${grnId}`,
        lines: [
          { grnLineId: line?.id ?? '', countedQtyPcs: 24 - damagedPcs, damagedQtyPcs: damagedPcs },
        ],
      })
      expect(counted.status, JSON.stringify(counted.body)).toBe(200)
      return grnId
    }
    const grnStatus = async (id: string) =>
      (
        (await db.execute(sql`select status from grns where id = ${id}`)).rows as {
          status: string
        }[]
      )[0]?.status

    const withDamage = await receipt(2)
    const refused = await call<Refusal>(
      app,
      ownerB,
      'POST',
      `/procurement/grns/${withDamage}/post`,
      {
        idempotencyKey: `post-${withDamage}`,
      },
    )
    expect(refused.status).toBe(409)
    expect(refused.body.data?.code).toBe('place_missing')
    expect(refused.body.message).toBe(noBin)
    expect(await grnStatus(withDamage)).toBe('reconciled')
    expect(await ledgerCount(tenantB)).toBe(rows)

    const clean = await receipt(0)
    const posted = await call<{ item: { status: string } }>(
      app,
      ownerB,
      'POST',
      `/procurement/grns/${clean}/post`,
      { idempotencyKey: `post-${clean}` },
    )
    expect(posted.status, JSON.stringify(posted.body)).toBe(200)
    expect(posted.body.item.status).toBe('posted')
    expect(await ledgerCount(tenantB)).toBe(rows + 1)
  })
})
