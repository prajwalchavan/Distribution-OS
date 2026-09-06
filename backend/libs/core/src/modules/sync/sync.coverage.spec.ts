import { Injectable, Module, type OnModuleInit } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  beatAssignments,
  beats,
  bootstrapTenant,
  createDb,
  createPool,
  FORBIDDEN_PULL_COLUMN_PATTERNS,
  brands,
  invoices,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  retailerIdentities,
  retailerLinks,
  productVariants,
  products,
  retailers,
  stockBalances,
  stockLots,
  SYNC_PULL_TABLE_NAMES,
  syncPullTablesFor,
  tenants,
  users,
  visits,
  type ActorRole,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BillingModule } from '../billing/index.js'
import { CatalogModule } from '../catalog/index.js'
import { DeliveryModule } from '../delivery/index.js'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { PricingModule } from '../pricing/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { RetailersModule } from '../retailers/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { SyncModule, SyncRegistry } from './index.js'

/**
 * A stand-in for the module that will one day own the visit screen's write path: it applies the note
 * a device sends. It exists so the LAST-WRITE-WINS VETO can be proved on a real table — the veto runs
 * in `SyncService.upload` before any handler, so a handler that would happily overwrite is exactly
 * what a test of it needs.
 */
@Injectable()
class FakeVisitWriter implements OnModuleInit {
  constructor(private readonly registry: SyncRegistry) {}
  onModuleInit(): void {
    this.registry.register('visits', async (tx, op) => {
      const note = op.data?.note
      await tx.execute(
        sql`update visits set note = ${typeof note === 'string' ? note : ''} where id = ${op.id}`,
      )
    })
  }
}
@Module({ providers: [FakeVisitWriter] })
class FakeVisitModule {}

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Manifest {
  protocol: number
  schemaVersion: string
  changed: boolean
  role: string
  tables: {
    table: string
    primaryKey: string[]
    columns: { name: string; type: string; nullable: boolean }[]
    writable: boolean
  }[]
  asOf: string
}
interface Pull {
  changes: { table: string; rows: Record<string, unknown>[]; deleted: string[] }[]
  cursor: string
  hasMore: boolean
  asOf: string
}

/**
 * THE READ SET, END TO END (founder 2026-09-05, docs/22 §8: our own delta sync, no PowerSync).
 *
 * `sync-tables.ts` in `@dos/db` is the database's promise — these 37 tables carry `updated_at`, an
 * index on it and a tombstone trigger, and these roles hold them. This spec is the other half of that
 * promise: with every module that owns one of those tables booted, the SERVER really answers rows for
 * each of them, and it answers them to exactly the roles the database named. The two lists are
 * compared directly, per role, so a table added to one and forgotten in the other fails here rather
 * than on a phone in a shop with no signal.
 */
describeDb('sync coverage: every module registers its read set (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()

  const ownerId = uuidv7()
  const repId = uuidv7()
  const crewId = uuidv7()
  const storeId = uuidv7()
  const shopUserId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }

  const beatId = uuidv7()
  const spareBeatId = uuidv7()
  const shopId = uuidv7()
  const offBeatShopId = uuidv7()
  const lotId = uuidv7()
  const locationId = uuidv7()
  const invoiceId = uuidv7()
  const visitId = uuidv7()
  const variantId = uuidv7()
  const defaultListId = uuidv7()
  const ownTierListId = uuidv7()
  const otherTierListId = uuidv7()
  const otherShopLinkId = uuidv7()

  const deviceId = `device-cov-${run}`
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `cov-${run}`, legalName: 'Coverage test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91801${run}1`, name: 'Owner' },
      { id: repId, phone: `+91801${run}2`, name: 'Rep' },
      { id: crewId, phone: `+91801${run}3`, name: 'Crew' },
      { id: storeId, phone: `+91801${run}4`, name: 'Store' },
      { id: shopUserId, phone: `+91801${run}5`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)

    await db.insert(beats).values([
      { id: beatId, tenantId, name: `Beat ${run}`, visitDays: [] },
      { id: spareBeatId, tenantId, name: `Beat ${run} spare`, visitDays: [] },
    ])
    await db.insert(beatAssignments).values({
      id: uuidv7(),
      tenantId,
      beatId,
      userId: repId,
      validFrom: '2020-01-01',
    })
    await db.insert(retailers).values([
      {
        id: shopId,
        tenantId,
        code: `C1-${run}`,
        name: `Shop ${run}`,
        phone: `+91802${run}1`,
        stateCode: '27',
        beatId,
        // Two shops on two tiers, so "the shop holds its own slab" is a claim with something to fail on.
        tier: 'A',
      },
      {
        id: offBeatShopId,
        tenantId,
        code: `C2-${run}`,
        name: `Off-beat shop ${run}`,
        phone: `+91802${run}2`,
        stateCode: '27',
        beatId: spareBeatId,
        tier: 'B',
      },
    ])
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91801${run}5`,
      userId: shopUserId,
      shopName: `Shop ${run}`,
    })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: shopId,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
    // ANOTHER customer of the same distributor, with its own person behind it. The shopkeeper above
    // must never pull this row: `retailer_links_read` is `tenant_id = … OR user_id = …`, so RLS says
    // yes to it and only the module's own predicate says no.
    const otherIdentityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: otherIdentityId,
      phone: `+91801${run}6`,
      shopName: `Off-beat shop ${run}`,
    })
    await db.insert(retailerLinks).values({
      id: otherShopLinkId,
      tenantId,
      identityId: otherIdentityId,
      retailerId: offBeatShopId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
    await db.insert(invoices).values({
      id: invoiceId,
      tenantId,
      invoiceNo: `INV/COV/${run}`,
      seriesCode: 'INV',
      fy: '2026-27',
      invoiceDate: '2026-09-01',
      retailerId: shopId,
      state: 'issued',
      buyerName: `Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: 100_000,
      taxablePaise: 100_000,
      totalPaise: 100_000,
    })
    await db
      .insert(locations)
      .values({ id: locationId, tenantId, name: `Godown ${run}`, kind: 'warehouse' })
    const manufacturerId = uuidv7()
    const brandId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: `Brand ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, brandId, name: `Product ${run}` })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: `Variant ${run}`,
      netQty: 100,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: '21069099',
      mrpPaise: 2000,
    })
    await db.insert(stockLots).values({
      id: lotId,
      tenantId,
      variantId,
      batchNo: `B-${run}`,
      mrpPaise: 2000,
      caseSize: 12,
    })
    await db.insert(stockBalances).values({ tenantId, lotId, locationId, onHand: 120, reserved: 0 })
    // Three rate cards: the default one everybody prices from, the tier the shop is on, and the tier
    // of the shop down the road — which is the one that must not reach this shop's phone.
    await db.insert(priceLists).values([
      { id: defaultListId, tenantId, name: `Default ${run}`, isDefault: true },
      { id: ownTierListId, tenantId, name: `Tier A ${run}`, tier: 'A' },
      { id: otherTierListId, tenantId, name: `Tier B ${run}`, tier: 'B' },
    ])
    await db.insert(priceListItems).values([
      { id: uuidv7(), tenantId, priceListId: defaultListId, variantId, ratePaise: 1800 },
      { id: uuidv7(), tenantId, priceListId: ownTierListId, variantId, ratePaise: 1700 },
      { id: uuidv7(), tenantId, priceListId: otherTierListId, variantId, ratePaise: 1500 },
    ])
    await db.insert(visits).values({
      id: visitId,
      tenantId,
      retailerId: shopId,
      userId: repId,
      beatId,
      startedAt: new Date(),
      outcome: 'ordered',
    })

    app = await bootTestApp([
      SyncModule,
      CatalogModule,
      TenantCatalogModule,
      RetailersModule,
      PricingModule,
      InventoryModule,
      OrdersModule,
      ReceivablesModule,
      BillingModule,
      WarehouseModule,
      DeliveryModule,
      FakeVisitModule,
    ])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const manifestOf = (actor: Actor) => call<Manifest>(app, actor, 'GET', '/sync/manifest')
  const pullOf = (actor: Actor, query: Record<string, string> = {}) =>
    call<Pull>(app, actor, 'GET', '/sync/pull', { deviceId, ...query })

  it('registers a pull for all 37 tables the database publishes, and for nothing else', async () => {
    const desk = await manifestOf(owner)
    expect(desk.status).toBe(200)
    expect(desk.body.tables.map((t) => t.table).sort()).toEqual([...SYNC_PULL_TABLE_NAMES].sort())
  })

  it.each<[string, Actor]>([
    ['salesperson', rep],
    ['delivery', crew],
    ['warehouse', store],
    ['retailer', shop],
  ])('serves %s exactly the tables sync-tables.ts gives that role', async (role, actor) => {
    const manifest = await manifestOf(actor)
    expect(manifest.status).toBe(200)
    expect(manifest.body.role).toBe(role)
    const expected = syncPullTablesFor(role as ActorRole).map((t) => t.table)
    expect(manifest.body.tables.map((t) => t.table).sort()).toEqual([...expected].sort())

    // ...and a full snapshot answers for every one of them: a manifest table `pull` never fills is a
    // local table on a phone that stays empty for ever.
    const snapshot = await pullOf(actor)
    expect(snapshot.status).toBe(200)
    expect(snapshot.body.changes.map((c) => c.table).sort()).toEqual([...expected].sort())

    // The composite-key tables publish the key they really have, not an `id` they do not.
    const balances = manifest.body.tables.find((t) => t.table === 'stock_balances')
    if (balances) expect(balances.primaryKey).toEqual(['lot_id', 'location_id'])
    const outstanding = manifest.body.tables.find((t) => t.table === 'retailer_outstanding_summary')
    if (outstanding) expect(outstanding.primaryKey).toEqual(['retailer_id'])
  })

  it('gives a shop only the rows linked to its own shop: not another customer, not another tier', async () => {
    // NEVER-LIST 9. Opening the READ half of the protocol to the shopkeeper widened two tables whose
    // RLS was written for staff, and a pull with no predicate walks straight past the permission
    // matrix that used to be the only gate:
    //
    //  - `retailer_links_read` is `tenant_id = … OR user_id = …` (the OR is the switch-distributor
    //    screen), so every link in the distributorship satisfies its first half for a signed-in shop;
    //  - `price_lists` / `price_list_items` are `tenantReadPolicy` because the engine runs on the
    //    rep's phone, while `pricing.priceLists.list` is STAFF — so an unfiltered pull is a
    //    shopkeeper reading every tier's rate card, which is what the shop down the road pays.
    const shopPull = await pullOf(shop)
    const links = shopPull.body.changes.find((c) => c.table === 'retailer_links')?.rows ?? []
    expect(links.length).toBeGreaterThan(0)
    expect([...new Set(links.map((r) => r.retailer_id))]).toEqual([shopId])
    expect(links.map((r) => r.id)).not.toContain(otherShopLinkId)

    const lists = shopPull.body.changes.find((c) => c.table === 'price_lists')?.rows ?? []
    const listIds = lists.map((r) => r.id).sort()
    expect(listIds).toEqual([defaultListId, ownTierListId].sort())
    const items = shopPull.body.changes.find((c) => c.table === 'price_list_items')?.rows ?? []
    expect(items.length).toBe(2)
    expect(items.map((r) => r.price_list_id)).not.toContain(otherTierListId)
    // The rate of the other tier is the thing being protected, so assert on the number itself.
    expect(items.map((r) => r.rate_paise).sort()).toEqual([1700, 1800])
    expect(items.every((r) => typeof r.rate_paise === 'number')).toBe(true)

    // The desk still holds the whole distributorship: the fix is a predicate for the shop, not a
    // narrowing of everyone's read set.
    const deskPull = await pullOf(owner)
    const deskLists = deskPull.body.changes.find((c) => c.table === 'price_lists')?.rows ?? []
    expect(deskLists.map((r) => r.id)).toContain(otherTierListId)
    const deskLinks = deskPull.body.changes.find((c) => c.table === 'retailer_links')?.rows ?? []
    expect(deskLinks.map((r) => r.id)).toContain(otherShopLinkId)
  })

  it('sends every value in the shape its own manifest declared (paise are numbers, not strings)', async () => {
    // The manifest is a CREATE TABLE instruction, so a column published as `integer` that arrives as
    // `"9300"` is a bug on the device, not a curiosity: paise are `bigint` in Postgres and
    // node-postgres will not narrow a 64-bit integer on its own, so every money column of every table
    // came back as a string while its manifest said integer. An offline total then concatenates, and
    // `'9300' > '10000'` is true. Every column of every row one snapshot carries is compared against
    // the schema the same actor was handed — one pull, because the mapping is one code path.
    const manifest = await manifestOf(shop)
    const declared = new Map(
      manifest.body.tables.map((t) => [t.table, new Map(t.columns.map((c) => [c.name, c.type]))]),
    )
    const pull = await pullOf(shop)
    for (const change of pull.body.changes)
      for (const row of change.rows)
        for (const [key, value] of Object.entries(row)) {
          if (value === null) continue
          const type = declared.get(change.table)?.get(key)
          const where = `${change.table}.${key} = ${JSON.stringify(value)}`
          if (type === 'integer' || type === 'number') expect(typeof value, where).toBe('number')
          if (type === 'boolean') expect(typeof value, where).toBe('boolean')
          if (type === 'string') expect(typeof value, where).toBe('string')
        }
    // And the case the whole rule exists for, named outright.
    const bill = pull.body.changes.find((c) => c.table === 'invoices')
    expect(bill?.rows[0]?.total_paise).toBe(100_000)
  })

  it('never offers a shop a write queue, while the desk keeps its writable tables', async () => {
    // The shop holds the READ half alone: `manifest` and `pull` are ANY_MEMBER, `upload` and
    // `errors.list` stay STAFF (docs/07 §0). So `writable` has to answer "may THIS role send this
    // table back", not merely "does a handler exist" — a table advertised writable to a shopkeeper
    // would have the app build a queue whose every flush is a 403, and a 4xx to the uploader wedges a
    // device queue for good (docs/07 §7.3 rule 5). `receipts` is the sharpest case of all: only the
    // delivery crew collects money (docs/17 §D4).
    const shopManifest = await manifestOf(shop)
    expect(shopManifest.status).toBe(200)
    expect(shopManifest.body.tables.map((t) => t.table)).toContain('receipts')
    expect(shopManifest.body.tables.filter((t) => t.writable).map((t) => t.table)).toEqual([])
    const refused = await call(app, shop, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [],
    })
    expect(refused.status).toBe(403)

    // ...and the flag did not simply die: the desk, which MAY upload, still gets it, so a phone that
    // can queue writes still learns which tables it may queue.
    const desk = await manifestOf(owner)
    const writable = desk.body.tables.filter((t) => t.writable).map((t) => t.table)
    expect(writable).toContain('receipts')
    expect(writable).toContain('sales_orders')
    // A download-only table is download-only for everybody (prices, schemes, catalog: no handler).
    expect(writable).not.toContain('price_lists')
    expect(
      (await call(app, owner, 'POST', '/sync/upload', { protocol: 1, deviceId, ops: [] })).status,
    ).toBe(200)
  })

  it.each<[string, Actor]>([
    ['salesperson', rep],
    ['delivery', crew],
    ['warehouse', store],
    ['retailer', shop],
  ])('never sends a cost, margin or landed-cost column to a %s device', async (_role, actor) => {
    const forbidden = (name: string) => FORBIDDEN_PULL_COLUMN_PATTERNS.some((p) => p.test(name))
    // The manifest is the exhaustive check: it names every column of every table this role holds,
    // derived from the same Drizzle table the rows come out of (never-list 1, docs/22 §9).
    const manifest = await manifestOf(actor)
    for (const table of manifest.body.tables)
      for (const column of table.columns)
        expect(forbidden(column.name), `${table.table}.${column.name}`).toBe(false)
    // ...and the rows themselves, for the tables that have any in this fixture.
    const snapshot = await pullOf(actor)
    for (const change of snapshot.body.changes)
      for (const row of change.rows)
        for (const key of Object.keys(row))
          expect(forbidden(key), `${change.table}.${key}`).toBe(false)
  })

  it('pulls the global catalog, which has no tenant_id at all', async () => {
    const snapshot = await pullOf(store)
    for (const table of ['products', 'product_variants', 'manufacturers', 'brands'])
      expect(snapshot.body.changes.some((c) => c.table === table)).toBe(true)
  })

  it('gives the shop its own bill and the desk both shops, and the rep only its own beat', async () => {
    const shopPull = await pullOf(shop)
    const shopRetailers = shopPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(shopRetailers.map((r) => r.id)).toEqual([shopId])
    const shopInvoices = shopPull.body.changes.find((c) => c.table === 'invoices')?.rows ?? []
    expect(shopInvoices.map((r) => r.id)).toContain(invoiceId)

    const repPull = await pullOf(rep)
    const repRetailers = repPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(repRetailers.map((r) => r.id)).toContain(shopId)
    expect(repRetailers.map((r) => r.id)).not.toContain(offBeatShopId)

    const deskPull = await pullOf(owner)
    const deskRetailers = deskPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(deskRetailers.map((r) => r.id)).toEqual(expect.arrayContaining([shopId, offBeatShopId]))
  })

  it('sends a delta after a change, and a tombstone after a delete', async () => {
    const first = await pullOf(store, { limit: '500' })
    await new Promise((r) => setTimeout(r, 20))

    // one change per shape: a tenant table keyed by id, a composite-key table, a global table
    await db.execute(sql`update locations set name = ${`Godown ${run} B`} where id = ${locationId}`)
    await db.execute(
      sql`update stock_balances set on_hand = 130 where tenant_id = ${tenantId} and lot_id = ${lotId}`,
    )
    const delta = await pullOf(store, { since: first.body.cursor })
    const changed = (table: string) => delta.body.changes.find((c) => c.table === table)?.rows ?? []
    expect(changed('locations').map((r) => r.id)).toContain(locationId)
    expect(changed('stock_balances').map((r) => r.on_hand)).toContain(130)

    // A row the godown deletes must be forgotten, and a deleted row has no `updated_at` left to find
    // it by — the tombstone is the only way it ever leaves the phone.
    const doomed = uuidv7()
    await db
      .insert(locations)
      .values({ id: doomed, tenantId, name: `Temp ${run}`, kind: 'warehouse' })
    const before = await pullOf(store)
    await db.execute(sql`delete from locations where id = ${doomed}`)
    const after = await pullOf(store, { since: before.body.cursor })
    expect(after.body.changes.find((c) => c.table === 'locations')?.deleted).toContain(doomed)

    // ...and the composite key travels as the tombstone writes it: `lot_id:location_id`.
    await db.execute(
      sql`delete from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotId}`,
    )
    const gone = await pullOf(store, { since: before.body.cursor })
    expect(gone.body.changes.find((c) => c.table === 'stock_balances')?.deleted).toContain(
      `${lotId}:${locationId}`,
    )
  })

  it('does not report a row that merely moved to another reader as deleted for the one that still holds it', async () => {
    const before = await pullOf(owner)
    await new Promise((r) => setTimeout(r, 20))
    // The shop leaves the rep's beat: `dos_sync_soft_hide` files a `beat_changed` tombstone, because
    // the rep's device must forget it. The DESK still holds the shop, so the same tombstone must not
    // make the desk drop it — the pull subtracts the ids the caller can still see.
    await db.execute(sql`update retailers set beat_id = ${spareBeatId} where id = ${offBeatShopId}`)
    const desk = await pullOf(owner, { since: before.body.cursor })
    expect(desk.body.changes.find((c) => c.table === 'retailers')?.deleted ?? []).not.toContain(
      offBeatShopId,
    )
  })

  it('advances the cursor when a page is full, so a device that fell behind can finish', async () => {
    // Two tables, one row of budget: the pull must both report `hasMore` and move the cursor, or the
    // device asks the same question for ever and never reaches the end of its read set.
    const page = await pullOf(store, { limit: '2' })
    expect(page.status).toBe(200)
    expect(page.body.hasMore).toBe(true)
    const next = await pullOf(store, { since: page.body.cursor, limit: '2' })
    expect(next.body.cursor).not.toBe(page.body.cursor)
    // ...and it keeps moving: ten pages of two rows must reach ten different cursors, which is the
    // whole difference between a device that finishes its first sync and one that never does.
    const seen = new Set([page.body.cursor, next.body.cursor])
    let cursor = next.body.cursor
    for (let i = 0; i < 8; i += 1) {
      const step = await pullOf(store, { since: cursor, limit: '2' })
      cursor = step.body.cursor
      seen.add(cursor)
      if (!step.body.hasMore) break
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  it('refuses an edit whose base is older than the server row, and files it in the tray (LWW veto)', async () => {
    const noteBefore = `note-${run}`
    await db.execute(sql`update visits set note = ${noteBefore} where id = ${visitId}`)
    const current = (
      await db.execute(
        sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
              from visits where id = ${visitId}`,
      )
    ).rows[0] as { at: string }

    // The rep's phone edited a copy it pulled BEFORE the desk touched the row.
    const stale = await call<{ accepted: number; rejected: { code: string }[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId,
        ops: [
          {
            opId: `veto-stale-${run}`,
            op: 'PATCH',
            table: 'visits',
            id: visitId,
            data: { note: 'from the phone' },
            baseUpdatedAt: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
    )
    expect(stale.status).toBe(200) // never 4xx: the queue is not wedged
    expect(stale.body.accepted).toBe(0)
    expect(stale.body.rejected.map((r) => r.code)).toEqual(['stale'])
    const kept = (await db.execute(sql`select note from visits where id = ${visitId}`)).rows[0] as {
      note: string
    }
    expect(kept.note).toBe(noteBefore) // the handler never ran

    const tray = await call<{ items: { code: string; rowId: string }[] }>(
      app,
      rep,
      'GET',
      '/sync/errors',
      { deviceId },
    )
    expect(tray.body.items.some((i) => i.code === 'stale' && i.rowId === visitId)).toBe(true)

    // The same edit, sent with the base the row really carries, goes through.
    const fresh = await call<{ accepted: number; rejected: unknown[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId,
        ops: [
          {
            opId: `veto-fresh-${run}`,
            op: 'PATCH',
            table: 'visits',
            id: visitId,
            data: { note: 'from the phone' },
            baseUpdatedAt: current.at,
          },
        ],
      },
    )
    expect(fresh.body.accepted).toBe(1)
    expect(fresh.body.rejected).toEqual([])
    const applied = (await db.execute(sql`select note from visits where id = ${visitId}`))
      .rows[0] as { note: string }
    expect(applied.note).toBe('from the phone')
  })

  it('replays an upload batch twice and leaves the money ledger exactly as it was', async () => {
    const batch = {
      protocol: 1,
      deviceId,
      ops: [
        {
          opId: `receipt-${run}`,
          op: 'PUT',
          table: 'receipts',
          id: uuidv7(),
          data: {
            retailer_id: shopId,
            amount_paise: 25_000,
            mode: 'cash',
            client_receipt_no: `CR-${run}`,
            device_id: deviceId,
          },
        },
      ],
    }
    const ledger = async () => {
      const rows = (
        await db.execute(sql`
          select (select count(*) from receipts where tenant_id = ${tenantId})::int as receipts,
                 (select count(*) from journal_lines where tenant_id = ${tenantId})::int as lines,
                 (select coalesce(sum(amount_paise), 0) from journal_lines
                   where tenant_id = ${tenantId})::bigint::text as total`)
      ).rows[0] as { receipts: number; lines: number; total: string }
      return rows
    }

    const first = await call<{ accepted: number; replayed: number }>(
      app,
      crew,
      'POST',
      '/sync/upload',
      batch,
    )
    expect(first.status).toBe(200)
    expect(first.body.accepted).toBe(1)
    const after = await ledger()
    expect(after.receipts).toBe(1)
    expect(after.lines).toBeGreaterThan(0)
    // Every entry balances, which is what `total` being zero says.
    expect(after.total).toBe('0')

    const again = await call<{ accepted: number; replayed: number }>(
      app,
      crew,
      'POST',
      '/sync/upload',
      batch,
    )
    expect(again.status).toBe(200)
    expect(again.body.replayed).toBe(1)
    expect(await ledger()).toEqual(after)
  })
})
