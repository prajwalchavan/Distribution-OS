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
import { ALL_ROLES, isAllowed, permissionFor, type ProcedurePath } from '@dos/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BillingModule } from '../billing/index.js'
import { CatalogModule } from '../catalog/index.js'
import { DeliveryModule } from '../delivery/index.js'
import { DocintModule } from '../docint/index.js'
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
    this.registry.register(
      'visits',
      async (tx, op) => {
        const note = op.data?.note
        await tx.execute(
          sql`update visits set note = ${typeof note === 'string' ? note : ''} where id = ${op.id}`,
        )
      },
      { standsFor: ['retailers.visits.record'] },
    )
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
  const bookkeeperId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  /** The money desk: holds the crew's tables on its device and may send a receipt, never a stop (DOS-166). */
  const bookkeeper: Actor = { tenantId, actorId: bookkeeperId, role: 'accountant' }

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
      { id: bookkeeperId, phone: `+91801${run}7`, name: 'Bookkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: bookkeeperId, role: 'accountant' },
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
        // Real credit policy, so "the shop's own device never holds it" has something to fail on (S-177).
        creditLimitPaise: 5_000_000,
        creditLimitBills: 3,
        creditDays: 7,
        creditMode: 'strict',
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
      // Registers no pull, only the two capture uploads: booted so the DOS-166 pin sees every
      // upload table the product registers, not only the ones with a read set.
      DocintModule,
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
  /** The query keys that name the tables a pull reads: `tables[0]`, `tables[1]`, … */
  const tablesOf = (...names: string[]): Record<string, string> =>
    Object.fromEntries(names.map((name, i) => [`tables[${i}]`, name]))

  /**
   * Every page of ONE pass (DOS-080): the query as given, then the same query carrying the cursor the
   * LAST response gave, while `hasMore` — rule 3 of docs/07, which is what the device's loop does.
   */
  const pagesOf = async (actor: Actor, query: Record<string, string> = {}): Promise<Pull[]> => {
    const pages: Pull[] = []
    let since = query.since
    for (;;) {
      if (pages.length >= 200)
        throw new Error(`sync.pull did not finish within 200 pages: ${JSON.stringify(query)}`)
      const res = await pullOf(actor, { ...query, ...(since === undefined ? {} : { since }) })
      expect(res.status, `page ${pages.length + 1}`).toBe(200)
      pages.push(res.body)
      if (!res.body.hasMore) return pages
      since = res.body.cursor
    }
  }

  /**
   * What a device HOLDS after one whole pass, in the shape of a single pull: every page (limit 500
   * unless the query names one) merged per table the way the device applies them — rows upserted by
   * the table's manifest key, a later copy replacing an earlier one, and deleted ids as a set in
   * arrival order. A page is the `limit` earliest changes of the read set, so what one page holds says
   * nothing about a fixture; what the pass holds does.
   */
  const drainOf = async (actor: Actor, query: Record<string, string> = {}) => {
    const keys = new Map((await manifestOf(actor)).body.tables.map((t) => [t.table, t.primaryKey]))
    const pages = await pagesOf(actor, { limit: '500', ...query })
    const merged = new Map<
      string,
      { rows: Map<string, Record<string, unknown>>; deleted: Set<string> }
    >()
    for (const page of pages)
      for (const change of page.changes) {
        const into = merged.get(change.table) ?? { rows: new Map(), deleted: new Set<string>() }
        merged.set(change.table, into)
        const key = keys.get(change.table) ?? ['id']
        for (const row of change.rows) into.rows.set(key.map((k) => String(row[k])).join(':'), row)
        for (const id of change.deleted) into.deleted.add(id)
      }
    const last = pages[pages.length - 1]
    const body: Pull = {
      changes: [...merged].map(([table, { rows, deleted }]) => ({
        table,
        rows: [...rows.values()],
        deleted: [...deleted],
      })),
      cursor: last?.cursor ?? '',
      hasMore: false,
      asOf: last?.asOf ?? '',
    }
    // Every page answered 200: `pagesOf` asserts it page by page.
    return { status: 200, body }
  }

  /**
   * A cursor at the database clock NOW, to the microsecond, in the `{v:1,t}` form `sync.service.ts`
   * issues — so a delta starts exactly after a fixture, without the 5 s overlap a drained cursor has.
   */
  const markCursor = async (): Promise<string> => {
    const row = (
      await db.execute(
        sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t`,
      )
    ).rows[0] as { t: string }
    return Buffer.from(JSON.stringify({ v: 1, t: row.t })).toString('base64url')
  }

  /** The ids a pass delivered as rows (optionally of one table), in delivery order, repeats kept. */
  const rowIdsOf = (pages: Pull[], table?: string): string[] =>
    pages.flatMap((page) =>
      page.changes
        .filter((change) => table === undefined || change.table === table)
        .flatMap((change) => change.rows.map((row) => String(row.id))),
    )
  /** The ids a pass delivered as deleted, in delivery order, repeats kept. */
  const deletedOf = (pages: Pull[]): string[] =>
    pages.flatMap((page) => page.changes.flatMap((change) => change.deleted))

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
    const shopPull = await drainOf(
      shop,
      tablesOf('retailer_links', 'price_lists', 'price_list_items'),
    )
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
    const deskPull = await drainOf(owner, tablesOf('price_lists', 'retailer_links'))
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
    const pull = await drainOf(shop)
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

    // DOS-166: `writable` also asks whether THIS role may make the change the table stands for, so the
    // phone never queues what the upload will refuse. The crew keeps every door it uses at a shop...
    const crewTables = (await manifestOf(crew)).body.tables
    expect(crewTables.filter((t) => t.writable).map((t) => t.table)).toEqual(
      expect.arrayContaining(['receipts', 'trip_stops', 'deliveries']),
    )
    // ...and the money desk holds the crew's stops on its device but may only send a receipt back.
    const deskBooks = (await manifestOf(bookkeeper)).body.tables
    expect([
      deskBooks.find((t) => t.table === 'receipts')?.writable,
      deskBooks.find((t) => t.table === 'trip_stops')?.writable,
    ]).toEqual([true, false])
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
    const snapshot = await drainOf(actor)
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

  it("DOS-072: the crew's copy of a shop carries credit_mode and none of the credit terms, while the rep still prices against the limit", async () => {
    const CREW_MUST_NOT_HOLD = ['credit_limit_paise', 'credit_limit_bills', 'credit_days', 'tier']

    // The crew needs to know whether the shop pays at the door, not what it is allowed to owe
    // (docs/23 §5.3). The manifest and the rows are one `omit`, so both halves are checked.
    const manifest = await manifestOf(crew)
    const columns =
      manifest.body.tables.find((t) => t.table === 'retailers')?.columns.map((c) => c.name) ?? []
    expect(columns).toContain('credit_mode')
    for (const key of CREW_MUST_NOT_HOLD) expect(columns, key).not.toContain(key)

    const crewPull = await drainOf(crew, tablesOf('retailers'))
    const crewRows = crewPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(crewRows.length).toBeGreaterThan(0)
    for (const row of crewRows) {
      expect(Object.keys(row)).toContain('credit_mode')
      for (const key of CREW_MUST_NOT_HOLD) expect(Object.keys(row), key).not.toContain(key)
      // Who and where is untouched: a driver still has the name, the phone and the door.
      expect(Object.keys(row)).toEqual(expect.arrayContaining(['name', 'phone', 'address']))
    }

    // The rep quotes and warns against the limit offline, so its copy keeps the block.
    const repPull = await drainOf(rep, tablesOf('retailers'))
    const repRows = repPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(repRows.length).toBeGreaterThan(0)
    for (const key of CREW_MUST_NOT_HOLD) expect(Object.keys(repRows[0] ?? {}), key).toContain(key)
  })

  it("S-177: the shop's own copy of its shop card carries no credit policy, while the desk's and the rep's do", async () => {
    /*
     * A SHOP IS NEVER TOLD WHAT IT MAY OWE (docs/22 §8, DOS-100: the shop's screen shows the overdue
     * amount with a Pay button "and never a credit limit or credit-available figure", ADR 0006). The
     * oRPC door already gives the retailer role the PUBLIC shop record; `sync.pull` is `select *`, so
     * without this the same shopkeeper could read his own limit, his bill count, his days and his
     * mode straight off the sync door — and off his phone, once the retailer app gains the offline
     * client. What the shop IS owed an answer on — what it owes today — comes from
     * `retailer_outstanding_summary`, which is untouched. Same shape as DOS-072 for the crew.
     */
    const SHOP_MUST_NOT_HOLD = [
      'credit_limit_paise',
      'credit_limit_bills',
      'credit_days',
      'credit_mode',
    ]
    const columns =
      (await manifestOf(shop)).body.tables.find((t) => t.table === 'retailers')?.columns.map(
        (c) => c.name,
      ) ?? []
    expect(columns.length).toBeGreaterThan(0)
    for (const key of SHOP_MUST_NOT_HOLD) expect(columns, key).not.toContain(key)
    // The shop still holds the row: who it is, where it is and what it pays on (payment terms).
    expect(columns).toEqual(expect.arrayContaining(['id', 'name', 'phone', 'payment_terms']))

    const shopRows = (await drainOf(shop, tablesOf('retailers'))).body.changes.find(
      (c) => c.table === 'retailers',
    )?.rows
    expect(shopRows?.map((r) => r.id)).toEqual([shopId])
    for (const row of shopRows ?? [])
      for (const key of SHOP_MUST_NOT_HOLD) expect(Object.keys(row), key).not.toContain(key)

    // The desk sets the limit and the rep quotes against it: both keep every column.
    for (const actor of [owner, rep]) {
      const rows = (await drainOf(actor, tablesOf('retailers'))).body.changes.find(
        (c) => c.table === 'retailers',
      )?.rows
      const own = rows?.find((r) => r.id === shopId)
      expect(own, 'the desk and the rep read the shop').toBeDefined()
      for (const key of SHOP_MUST_NOT_HOLD) expect(Object.keys(own ?? {}), key).toContain(key)
      expect(own?.credit_limit_paise).toBe(5_000_000)
    }
  })

  it('gives the shop its own bill and the desk both shops, and the rep only its own beat', async () => {
    const shopPull = await drainOf(shop, tablesOf('retailers', 'invoices'))
    const shopRetailers = shopPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(shopRetailers.map((r) => r.id)).toEqual([shopId])
    const shopInvoices = shopPull.body.changes.find((c) => c.table === 'invoices')?.rows ?? []
    expect(shopInvoices.map((r) => r.id)).toContain(invoiceId)

    const repPull = await drainOf(rep, tablesOf('retailers'))
    const repRetailers = repPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(repRetailers.map((r) => r.id)).toContain(shopId)
    expect(repRetailers.map((r) => r.id)).not.toContain(offBeatShopId)

    const deskPull = await drainOf(owner, tablesOf('retailers'))
    const deskRetailers = deskPull.body.changes.find((c) => c.table === 'retailers')?.rows ?? []
    expect(deskRetailers.map((r) => r.id)).toEqual(expect.arrayContaining([shopId, offBeatShopId]))
  })

  it('sends a delta after a change, and a tombstone after a delete', async () => {
    const held = tablesOf('locations', 'stock_balances')
    const first = await drainOf(store, { ...held, limit: '500' })
    await new Promise((r) => setTimeout(r, 20))

    // one change per shape: a tenant table keyed by id, a composite-key table, a global table
    await db.execute(sql`update locations set name = ${`Godown ${run} B`} where id = ${locationId}`)
    await db.execute(
      sql`update stock_balances set on_hand = 130 where tenant_id = ${tenantId} and lot_id = ${lotId}`,
    )
    const delta = await drainOf(store, { ...held, since: first.body.cursor })
    const changed = (table: string) => delta.body.changes.find((c) => c.table === table)?.rows ?? []
    expect(changed('locations').map((r) => r.id)).toContain(locationId)
    expect(changed('stock_balances').map((r) => r.on_hand)).toContain(130)

    // A row the godown deletes must be forgotten, and a deleted row has no `updated_at` left to find
    // it by — the tombstone is the only way it ever leaves the phone.
    const doomed = uuidv7()
    await db
      .insert(locations)
      .values({ id: doomed, tenantId, name: `Temp ${run}`, kind: 'warehouse' })
    const before = await drainOf(store, held)
    await db.execute(sql`delete from locations where id = ${doomed}`)
    const after = await drainOf(store, { ...held, since: before.body.cursor })
    expect(after.body.changes.find((c) => c.table === 'locations')?.deleted).toContain(doomed)

    // ...and the composite key travels as the tombstone writes it: `lot_id:location_id`.
    await db.execute(
      sql`delete from stock_balances where tenant_id = ${tenantId} and lot_id = ${lotId}`,
    )
    const gone = await drainOf(store, { ...held, since: before.body.cursor })
    expect(gone.body.changes.find((c) => c.table === 'stock_balances')?.deleted).toContain(
      `${lotId}:${locationId}`,
    )
  })

  it('does not report a row that merely moved to another reader as deleted for the one that still holds it', async () => {
    const before = await drainOf(owner, tablesOf('retailers'))
    await new Promise((r) => setTimeout(r, 20))
    // The shop leaves the rep's beat: `dos_sync_soft_hide` files a `beat_changed` tombstone, because
    // the rep's device must forget it. The DESK still holds the shop, so the same tombstone must not
    // make the desk drop it — the pull subtracts the ids the caller can still see.
    await db.execute(sql`update retailers set beat_id = ${spareBeatId} where id = ${offBeatShopId}`)
    const desk = await drainOf(owner, { ...tablesOf('retailers'), since: before.body.cursor })
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

  it('DOS-166: refuses a salesperson receipt through the upload as role_not_allowed and writes nothing', async () => {
    // THE PROBE, AS A SPEC (QA/evidence/batch2/sync-role-probe 02 and 03). `POST /receipts` refuses a
    // salesperson, so the offline door must refuse the same person the same money: the crew's batch above,
    // sent from a rep's phone, is a durable 2xx rejection that draws no number and posts nothing. The
    // warehouse token is the second half — it used to pass every role check and die on the journal policy
    // as a 500 that rolled the batch back and left no sync_ops row.
    type Upload = {
      accepted: number
      replayed: number
      rejected: { opId: string; table: string; code: string }[]
    }
    const books = async () =>
      (
        await db.execute(sql`
          select (select count(*) from receipts where tenant_id = ${tenantId})::int as receipts,
                 (select count(*) from journal_entries where tenant_id = ${tenantId})::int as entries,
                 (select count(*) from journal_lines where tenant_id = ${tenantId})::int as lines,
                 (select count(*) from allocations where tenant_id = ${tenantId})::int as allocations,
                 (select count(*) from outbox_events
                   where tenant_id = ${tenantId} and event_type = 'ReceiptRecorded')::int as recorded`)
      ).rows[0]
    const before = await books()

    for (const [who, actor] of [
      ['rep', rep],
      ['store', store],
    ] as const) {
      const device = `device-cov-${who}-${run}`
      const opId = `receipt-${who}-${run}`
      const batch = {
        protocol: 1,
        deviceId: device,
        ops: [
          {
            opId,
            op: 'PUT',
            table: 'receipts',
            id: uuidv7(),
            data: {
              retailer_id: shopId,
              amount_paise: 25_000,
              mode: 'cash',
              client_receipt_no: `CR-${who}-${run}`,
              device_id: device,
            },
          },
        ],
      }
      const res = await call<Upload>(app, actor, 'POST', '/sync/upload', batch)
      expect(res.status, who).toBe(200) // never 4xx, and never a 500 that wedges the queue
      expect(res.body.accepted, who).toBe(0)
      expect(
        res.body.rejected.map((r) => [r.opId, r.table, r.code]),
        who,
      ).toEqual([[opId, 'receipts', 'role_not_allowed']])

      // The tray row names the person whose phone sent it, and the outcome is durable.
      const tray = (
        await db.execute(sql`
          select user_id, table_name, code from sync_errors
           where tenant_id = ${tenantId} and device_id = ${device} and op_id = ${opId}`)
      ).rows
      expect(tray, who).toEqual([
        { user_id: actor.actorId, table_name: 'receipts', code: 'role_not_allowed' },
      ])
      const stored = (
        await db.execute(sql`
          select outcome from sync_ops
           where tenant_id = ${tenantId} and device_id = ${device} and op_id = ${opId}`)
      ).rows as { outcome: { ok: boolean; rejection?: { code: string } } }[]
      expect(stored, who).toHaveLength(1)
      expect(stored[0]?.outcome.ok, who).toBe(false)
      expect(stored[0]?.outcome.rejection?.code, who).toBe('role_not_allowed')

      // No receipt, no journal entry or line, no allocation, no ReceiptRecorded event.
      expect(await books(), who).toEqual(before)

      // The retried batch replays the stored refusal; it does not ask again.
      const again = await call<Upload>(app, actor, 'POST', '/sync/upload', batch)
      expect(again.status, who).toBe(200)
      expect(again.body.replayed, who).toBe(1)
      expect(again.body.accepted, who).toBe(0)
      expect(
        again.body.rejected.map((r) => r.code),
        who,
      ).toEqual(['role_not_allowed'])
      expect(await books(), who).toEqual(before)
    }
  })

  it('DOS-166: every upload table stands for a declared procedure and is never wider than it', () => {
    // The upload door is the online door by another route, so each synced table names the procedure(s) it
    // stands for and the matrix answers for both. A thirteenth registration without a mapping does not
    // compile, one naming an undeclared procedure cannot boot, and one missing from this pin fails here.
    const registry = app.get(SyncRegistry)
    const pinned: { table: string; standsFor: ProcedurePath[] }[] = [
      { table: 'receipts', standsFor: ['receivables.receipts.create'] },
      { table: 'allocations', standsFor: ['receivables.allocations.create'] },
      { table: 'sales_orders', standsFor: ['orders.create'] },
      { table: 'sales_order_lines', standsFor: ['orders.setLines'] },
      {
        table: 'trip_stops',
        standsFor: ['delivery.stops.start', 'delivery.stops.arrive', 'delivery.stops.fail'],
      },
      { table: 'deliveries', standsFor: ['delivery.deliveries.record'] },
      { table: 'pod_evidence', standsFor: ['delivery.deliveries.addPod'] },
      { table: 'collections', standsFor: ['delivery.collections.record'] },
      { table: 'trip_expenses', standsFor: ['delivery.expenses.record'] },
      { table: 'pick_lines', standsFor: ['warehouse.picklists.pick'] },
      { table: 'documents', standsFor: ['docint.documents.create'] },
      { table: 'document_pages', standsFor: ['docint.documents.addPage'] },
      // This spec's own stand-in for the visit screen (FakeVisitWriter above).
      { table: 'visits', standsFor: ['retailers.visits.record'] },
    ]
    const byTable = (a: { table: string }, b: { table: string }) => a.table.localeCompare(b.table)
    expect([...registry.uploadTables()].sort(byTable)).toEqual([...pinned].sort(byTable))

    for (const { table, standsFor } of registry.uploadTables()) {
      for (const role of ALL_ROLES)
        expect(registry.mayUploadTable(table, role), `${role} sending ${table}`).toBe(
          standsFor.every((p) => isAllowed(permissionFor(p), role)),
        )
      // The worker is trusted; an actor that is no member of the tenant fails closed.
      expect(registry.mayUploadTable(table, 'system'), table).toBe(true)
      expect(registry.mayUploadTable(table, 'curator'), table).toBe(false)
    }
    // The cells the probe found open, named outright.
    expect(registry.mayUploadTable('receipts', 'salesperson')).toBe(false)
    expect(registry.mayUploadTable('receipts', 'warehouse')).toBe(false)
    expect(registry.mayUploadTable('trip_expenses', 'salesperson')).toBe(false)
    expect(registry.mayUploadTable('receipts', 'delivery')).toBe(true)
    // A table nobody registered is nobody's.
    expect(registry.mayUploadTable('price_lists', 'owner')).toBe(false)

    // Fail closed at registration: an undeclared procedure, or none at all, stops the service booting.
    const noop = async () => {}
    expect(() =>
      new SyncRegistry().register('x_table', noop, {
        standsFor: ['nope.never' as ProcedurePath],
      }),
    ).toThrow(/nope\.never/)
    expect(() => new SyncRegistry().register('x_table', noop, { standsFor: [] })).toThrow(/x_table/)
  })

  // DOS-080: a page is the `limit` EARLIEST changes across the whole read set, ties completed, and the
  // cursor is the last instant the page delivered. These four come last: their beats and locations
  // would otherwise land in the fixtures the tests above count.

  it('DOS-080 fills the page limit across tables: a snapshot of a 60-beat burst takes at most ceil((rows+tombstones)/limit)+1 calls and delivers every row exactly once', async () => {
    // One INSERT per row, so each row carries its own clock_timestamp(). The locations land after the
    // beats, so `stock_lots` is read after `locations` has overflowed the page: the `untilText` path.
    for (let i = 0; i < 60; i += 1)
      await db
        .insert(beats)
        .values({ id: uuidv7(), tenantId, name: `Burst ${run} ${i}`, visitDays: [] })
    await new Promise((r) => setTimeout(r, 20))
    for (let i = 0; i < 12; i += 1)
      await db
        .insert(locations)
        .values({ id: uuidv7(), tenantId, name: `Burst godown ${run} ${i}`, kind: 'warehouse' })

    const ids = (
      (
        await db.execute(sql`
          select id from beats where tenant_id = ${tenantId}
          union all select id from locations where tenant_id = ${tenantId}
          union all select id from stock_lots where tenant_id = ${tenantId}`)
      ).rows as { id: string }[]
    ).map((r) => r.id)
    const { n: tombstones } = (
      await db.execute(sql`
        select count(*)::int as n from sync_tombstones
         where tenant_id = ${tenantId} and table_name in ('beats', 'locations', 'stock_lots')`)
    ).rows[0] as { n: number }

    const pages = await pagesOf(owner, {
      ...tablesOf('beats', 'locations', 'stock_lots'),
      limit: '10',
    })
    expect(pages.length).toBeLessThanOrEqual(Math.ceil((ids.length + tombstones) / 10) + 1)
    for (const [i, page] of pages.entries())
      if (page.hasMore)
        expect(
          page.changes.reduce((n, c) => n + c.rows.length + c.deleted.length, 0),
          `page ${i + 1} of ${pages.length}`,
        ).toBeGreaterThanOrEqual(10)
    // Every row of the three tables exactly once — nothing missing, nothing sent twice.
    expect(rowIdsOf(pages).sort()).toEqual([...ids].sort())
    const deleted = deletedOf(pages)
    expect(new Set(deleted).size).toBe(deleted.length)
  })

  it('DOS-080 a delta whose updates and tombstones overflow the page delivers each of them exactly once across the pages', async () => {
    const burst: string[] = []
    for (let i = 0; i < 30; i += 1) {
      const id = uuidv7()
      burst.push(id)
      await db
        .insert(beats)
        .values({ id, tenantId, name: `Interleaved ${run} ${i}`, visitDays: [] })
    }
    const since = await markCursor()
    // delete beat[2i], then rename beat[2i+1]: a tombstone and an update, turn and turn about
    const gone: string[] = []
    const renamed = new Map<string, string>()
    for (const [i, id] of burst.entries()) {
      if (i % 2 === 0) {
        await db.execute(sql`delete from beats where id = ${id}`)
        gone.push(id)
      } else {
        const name = `Interleaved ${run} ${i} renamed`
        await db.execute(sql`update beats set name = ${name} where id = ${id}`)
        renamed.set(id, name)
      }
    }

    const pages = await pagesOf(owner, { ...tablesOf('beats'), limit: '10', since })
    const deleted = deletedOf(pages)
    expect([...deleted].sort()).toEqual([...gone].sort())
    const rows = pages.flatMap((p) => p.changes.flatMap((c) => c.rows))
    expect(rows.map((r) => `${String(r.id)}=${String(r.name)}`).sort()).toEqual(
      [...renamed].map(([id, name]) => `${id}=${name}`).sort(),
    )
    expect(rows.filter((r) => deleted.includes(String(r.id)))).toEqual([])
  })

  it("DOS-080 a first table that fills the page exactly does not hide a later table's changes", async () => {
    const places: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const id = uuidv7()
      places.push(id)
      await db
        .insert(locations)
        .values({ id, tenantId, name: `Exact ${run} ${i}`, kind: 'warehouse' })
    }
    const since = await markCursor()
    for (const [i, id] of places.entries())
      await db.execute(sql`update locations set name = ${`Exact ${run} ${i} B`} where id = ${id}`)
    await new Promise((r) => setTimeout(r, 20))
    const later: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const id = uuidv7()
      later.push(id)
      await db.insert(beats).values({ id, tenantId, name: `Later ${run} ${i}`, visitDays: [] })
    }

    // `locations` answers exactly ten rows (it reads eleven and gets ten): the page is full without
    // the table being full, so the beats after it must still come — on this page or the next.
    const pages = await pagesOf(owner, { ...tablesOf('locations', 'beats'), limit: '10', since })
    expect(rowIdsOf(pages, 'locations').sort()).toEqual([...places].sort())
    expect(rowIdsOf(pages, 'beats').sort()).toEqual([...later].sort())
    expect(pages[pages.length - 1]?.hasMore).toBe(false)
  })

  it("DOS-080 a tombstone page thinned by the still-visible filter does not let the cursor pass that table's unread tombstones", async () => {
    const places = Array.from({ length: 11 }, (_, i) => ({
      id: uuidv7(),
      name: `Thinned ${run} L${i + 1}`,
    }))
    for (const place of places)
      await db.insert(locations).values({ ...place, tenantId, kind: 'warehouse' })
    const since = await markCursor()
    // L1..L10 one statement each, then L11; then L1..L10 come back with the same ids and names. Their
    // tombstones stay (the tombstone writer upserts, and nothing clears one on insert), so the first
    // eleven tombstones after the cursor are ten rows that are alive and one that is gone.
    for (const place of places) await db.execute(sql`delete from locations where id = ${place.id}`)
    await new Promise((r) => setTimeout(r, 20))
    const back = places.slice(0, 10)
    for (const place of back)
      await db.insert(locations).values({ ...place, tenantId, kind: 'warehouse' })
    const lastId = places[10]?.id ?? ''

    const pages = await pagesOf(owner, { ...tablesOf('locations'), limit: '10', since })
    const deleted = deletedOf(pages)
    expect(deleted.filter((id) => id === lastId)).toEqual([lastId])
    expect(rowIdsOf(pages, 'locations').sort()).toEqual(back.map((p) => p.id).sort())
    expect(deleted.filter((id) => back.some((p) => p.id === id))).toEqual([])
  })
})
