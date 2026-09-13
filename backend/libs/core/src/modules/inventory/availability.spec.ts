/**
 * The order screens' stock hint (DOS-074 rep S3/S11, DOS-097 shop R7): one available-to-promise total per item
 * at the godown orders reserve from.
 *
 * The screens used to read `stock.sellable` once — one row per lot per location, 500 rows at most — and add up
 * whatever came back. On the pilot data that left 9 in-stock items off page 1 ("Stock not known") and got 122
 * others wrong, and paging to the end would still have been wrong: the view spans every location kind, while an
 * order reserves from exactly one (`reservableLocationId`, the first active warehouse by id).
 *
 * This spec runs in its OWN tenant so the 505-lot item cannot disturb the FEFO and cycle-count state
 * `inventory.spec.ts` builds.
 */
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
import {
  InventoryModule,
  InventoryService,
  reservableLocationId,
  type LedgerEntryInput,
} from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type AvailabilityRow = { variantId: string; available: number }
type AvailabilityPage = { items: AvailabilityRow[]; nextCursor: string | null }
type SellableRow = { variantId: string; locationId: string; available: number }
type SellablePage = { items: SellableRow[]; nextCursor: string | null }

/** More lots than one 500-row `stock.sellable` page can hold, all of one item, all at the godown. */
const BULK_LOTS = 505
const BULK_PCS_PER_LOT = 2

describeDb('inventory stock.availability (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const bareTenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const bareOwnerId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const bareOwner: Actor = { tenantId: bareTenantId, actorId: bareOwnerId, role: 'owner' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }

  /** 505 lots at the godown: the item whose lots run past the 500th sellable row. */
  const bulk = uuidv7()
  /** Stock at the godown, on a van, in the damaged bin, in transit and in a second warehouse; part of it promised. */
  const mixed = uuidv7()
  /** 7 pieces at the godown: under one case, the shop's "Only 7 pc left". */
  const few = uuidv7()
  /** Godown stock fully promised to a confirmed order: nothing left to promise. */
  const promised = uuidv7()
  /** Stock everywhere except the godown. */
  const elsewhere = uuidv7()
  /** Never stocked. */
  const never = uuidv7()

  let godown = ''
  let damaged = ''
  let transit = ''
  let van = ''
  let secondGodown = ''
  let app: NestFastifyApplication
  let inventory: InventoryService

  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  /** Every page of `stock.availability` for `actor`, following `nextCursor` to the end. */
  async function readAvailability(
    actor: Actor,
    query: Record<string, unknown>,
  ): Promise<{ pages: AvailabilityPage[]; items: AvailabilityRow[] }> {
    const pages: AvailabilityPage[] = []
    let cursor: string | undefined
    for (let i = 0; i < 50; i += 1) {
      const res = await call<AvailabilityPage>(app, actor, 'GET', '/inventory/availability', {
        ...query,
        ...(cursor === undefined ? {} : { cursor }),
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      pages.push(res.body)
      if (res.body.nextCursor === null) break
      cursor = res.body.nextCursor
    }
    return { pages, items: pages.flatMap((p) => p.items) }
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `avail-${run}`, legalName: 'Availability test', stateCode: '27' },
      { id: bareTenantId, slug: `avail-bare-${run}`, legalName: 'No godown yet', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91926${run}1`, name: 'Owner' },
      { id: repId, phone: `+91926${run}2`, name: 'Rep' },
      { id: shopUserId, phone: `+91926${run}3`, name: 'Shopkeeper' },
      { id: bareOwnerId, phone: `+91926${run}4`, name: 'Bare owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: bareTenantId, userId: bareOwnerId, role: 'owner' },
    ])
    // Godown, damaged bin, in transit. The bare tenant is deliberately NOT bootstrapped: no warehouse at all.
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker avail ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Campa' })
    await db.insert(productVariants).values(
      (
        [
          [bulk, 'Campa Cola 750 ml'],
          [mixed, 'Campa Orange 1 L'],
          [few, 'Godavari Cheese Slices 200 g'],
          [promised, 'Campa Cola 200 ml'],
          [elsewhere, 'Sunbake Marie Light 75 g'],
          [never, 'Godavari Dairy Whitener 500 g'],
        ] as const
      ).map(([id, name]) => ({
        id,
        productId,
        name,
        netQty: 750,
        netUnit: 'ml' as const,
        defaultCaseSize: 24,
        hsnCode: '2202',
        mrpPaise: 4000,
      })),
    )
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    damaged = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    transit = locs.find((l) => l.kind === 'in_transit')?.id ?? ''
    expect([godown, damaged, transit].every((id) => id !== '')).toBe(true)

    app = await bootTestApp([InventoryModule])
    inventory = app.get(InventoryService)

    // A van and a SECOND active warehouse, through the real endpoint. The second warehouse's UUIDv7 id is
    // higher than the bootstrap Godown's, so the Godown stays the one orders reserve from.
    for (const [kind, name] of [
      ['vehicle', 'Van MH05'],
      ['warehouse', 'Second godown'],
    ] as const) {
      const id = uuidv7()
      const res = await call<{ item: { id: string } }>(app, owner, 'POST', '/inventory/locations', {
        idempotencyKey: `loc-${id}`,
        id,
        kind,
        name,
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      if (kind === 'vehicle') van = res.body.item.id
      else secondGodown = res.body.item.id
    }
    expect(secondGodown > godown).toBe(true)

    // The stock, in process: one ledger post through the real path instead of ~1,000 HTTP calls.
    await asOwner(async (tx) => {
      const lotOf = async (variantId: string, batchNo: string) =>
        (await inventory.findOrCreateLot(tx, { variantId, batchNo, mrpPaise: 4000 })).lot.id
      const entries: LedgerEntryInput[] = []
      const open = (lotId: string, locationId: string, qtyDelta: number, tag: string) => {
        entries.push({
          lotId,
          locationId,
          qtyDelta,
          reason: 'opening',
          refType: 'adjustment',
          idempotencyKey: `avail-${run}-${tag}`,
        })
      }
      for (let i = 0; i < BULK_LOTS; i += 1)
        open(
          await lotOf(bulk, `B${String(i).padStart(3, '0')}`),
          godown,
          BULK_PCS_PER_LOT,
          `bulk-${i}`,
        )
      const m1 = await lotOf(mixed, 'M1')
      const m2 = await lotOf(mixed, 'M2')
      open(m1, godown, 30, 'm1-godown')
      open(m2, godown, 20, 'm2-godown')
      open(m1, van, 7, 'm1-van')
      open(m1, damaged, 5, 'm1-damaged')
      open(m2, transit, 3, 'm2-transit')
      open(m2, secondGodown, 11, 'm2-second')
      open(await lotOf(few, 'F1'), godown, 7, 'f1-godown')
      open(await lotOf(promised, 'P1'), godown, 10, 'p1-godown')
      const e1 = await lotOf(elsewhere, 'E1')
      open(e1, damaged, 4, 'e1-damaged')
      open(e1, secondGodown, 9, 'e1-second')
      open(e1, van, 6, 'e1-van')
      const posted = await inventory.post(tx, entries)
      expect(posted.entries).toHaveLength(entries.length)
      // Confirmed orders hold stock at the godown: 12 of Campa Orange, all 10 of Campa Cola 200 ml.
      await inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: mixed,
        locationId: godown,
        qtyPcs: 12,
      })
      await inventory.reserve(tx, {
        orderLineId: uuidv7(),
        variantId: promised,
        locationId: godown,
        qtyPcs: 10,
      })
    })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it("DOS-074: stock.availability returns one godown total per item even when the item's lots run past the 500th sellable row", async () => {
    // The defect's precondition: one 500-row page of the per-lot read cannot hold this item.
    const page = await call<SellablePage>(app, rep, 'GET', '/inventory/sellable', { limit: 500 })
    expect(page.status).toBe(200)
    expect(page.body.items).toHaveLength(500)
    expect(page.body.nextCursor).not.toBeNull()
    const firstPageBulk = page.body.items
      .filter((row) => row.variantId === bulk)
      .reduce((sum, row) => sum + row.available, 0)
    expect(firstPageBulk).toBeLessThan(BULK_LOTS * BULK_PCS_PER_LOT)

    // The read the rep's screens use: one row per item, the whole godown total, on one page.
    const res = await call<AvailabilityPage>(app, rep, 'GET', '/inventory/availability', {
      limit: 500,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.nextCursor).toBeNull()
    const bulkRows = res.body.items.filter((row) => row.variantId === bulk)
    expect(bulkRows).toEqual([{ variantId: bulk, available: BULK_LOTS * BULK_PCS_PER_LOT }])
    expect(new Set(res.body.items.map((row) => row.variantId)).size).toBe(res.body.items.length)

    // Filtered to the item, the same single total.
    const one = await call<AvailabilityPage>(app, rep, 'GET', '/inventory/availability', {
      variantId: bulk,
    })
    expect(one.status).toBe(200)
    expect(one.body).toEqual({
      items: [{ variantId: bulk, available: BULK_LOTS * BULK_PCS_PER_LOT }],
      nextCursor: null,
    })
  })

  it('DOS-074: stock.availability counts only the godown orders reserve from (not a vehicle, the damaged bin, in-transit or a second warehouse) and nets reservations', async () => {
    // Summing the per-lot read over every location overstates the item: 38 at the godown + 7 on the van
    // + 5 damaged + 3 in transit + 11 in the second warehouse = 64.
    const everywhere = await call<SellablePage>(app, rep, 'GET', '/inventory/sellable', {
      variantId: mixed,
      limit: 500,
    })
    expect(everywhere.status).toBe(200)
    expect(everywhere.body.items.reduce((sum, row) => sum + row.available, 0)).toBe(64)
    expect(new Set(everywhere.body.items.map((row) => row.locationId))).toEqual(
      new Set([godown, van, damaged, transit, secondGodown]),
    )

    // At the godown: 30 + 20 on hand, 12 promised to a confirmed order.
    const res = await call<AvailabilityPage>(app, rep, 'GET', '/inventory/availability', {
      variantId: mixed,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toEqual({ items: [{ variantId: mixed, available: 38 }], nextCursor: null })

    // Stock only outside the godown, or all of it promised: no godown total at all.
    for (const variantId of [elsewhere, promised, never]) {
      const none = await call<AvailabilityPage>(app, rep, 'GET', '/inventory/availability', {
        variantId,
      })
      expect(none.status).toBe(200)
      expect(none.body).toEqual({ items: [], nextCursor: null })
    }
  })

  it('DOS-097: a retailer gets variantId and available only, one row per in-stock item, paged by item, with items that have no godown stock left out', async () => {
    const { pages, items } = await readAvailability(shop, { limit: 2 })

    // Exactly the three items with something left to promise at the godown, each once, in variant order.
    const expected = [
      { variantId: bulk, available: BULK_LOTS * BULK_PCS_PER_LOT },
      { variantId: mixed, available: 38 },
      { variantId: few, available: 7 },
    ].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))
    expect(items).toEqual(expected)
    for (const row of items) expect(Object.keys(row).sort()).toEqual(['available', 'variantId'])

    // Paged by item: 2 + 1, the cursor is the last variant of its page, the last page says nothing follows.
    expect(pages.map((p) => p.items.length)).toEqual([2, 1])
    expect(pages[0]?.nextCursor).toBe(pages[0]?.items[1]?.variantId)
    expect(pages[1]?.nextCursor).toBeNull()

    // The shop and the rep read the same numbers.
    const repRead = await readAvailability(rep, { limit: 500 })
    expect(repRead.items).toEqual(items)
  })

  it('DOS-074: the godown is reservableLocationId, the one rule orders and packing share; a distributor with no active warehouse gets no hint rather than an error', async () => {
    // The first active warehouse by id, even with a second active warehouse holding stock.
    expect(await asOwner((tx) => reservableLocationId(tx))).toBe(godown)

    const bare = await call<AvailabilityPage>(app, bareOwner, 'GET', '/inventory/availability', {})
    expect(bare.status, JSON.stringify(bare.body)).toBe(200)
    expect(bare.body).toEqual({ items: [], nextCursor: null })
  })
})
