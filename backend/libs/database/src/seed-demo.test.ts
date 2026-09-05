import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, type Db } from './client.js'
import { memberships, salesOrders, tenants, users } from './schema/index.js'
import { seedDemo, seedExtraTenants } from './seed-demo.js'
import { bootstrapTenant } from './tenant-bootstrap.js'

/**
 * `pnpm db:seed` is re-run after every `pnpm smoke --destructive`, on the founder's database and on
 * a fresh one in CI, so it must be a no-op the second time EVERYWHERE — not only on a database that
 * already holds every row. That distinction is real: the pending van-sale order (`SO-9003`) is only
 * written when the van carries stock, and the van is loaded by `seedWarehouse`, so while the order
 * lived inside `seedBilling` (which runs before it) the first seed of an empty database skipped it
 * and the second seed added it. This spec creates its own empty database, migrates it, seeds it twice
 * and compares every table, so the seed order can never regress that way again.
 *
 * Needs the `CREATE DATABASE` privilege on `DATABASE_URL`'s role: `dos` has it locally (CLAUDE.md)
 * and is the superuser in CI's Postgres service.
 */
const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** The same server and credentials, another database. */
function withDatabase(base: string, name: string): string {
  const u = new URL(base)
  u.pathname = `/${name}`
  return u.toString()
}

/** Row count of every table in `public`, keyed by table name. */
async function rowCounts(db: Db): Promise<Record<string, number>> {
  const tables = (
    await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
  ).rows as { tablename: string }[]
  const out: Record<string, number> = {}
  for (const { tablename } of tables) {
    const [row] = (
      await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(tablename)}`)
    ).rows as { n: number }[]
    out[tablename] = row?.n ?? 0
  }
  return out
}

describeDb('demo seed on an empty database', () => {
  const run = uuidv7().slice(-8)
  const dbName = `dos_seedtest_${run}`
  const adminPool = createPool(withDatabase(url ?? '', 'postgres'), 1)
  let pool: ReturnType<typeof createPool> | undefined
  let db: Db
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  // seedDemo never verifies the hash; the shape only has to be a string the column accepts.
  const passwordHash = '$argon2id$v=19$m=65536,t=3,p=4$seed-demo-test$not-a-real-hash'

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE ${dbName}`)
    pool = createPool(withDatabase(url ?? '', dbName), 3)
    db = createDb(pool)
    const here = dirname(fileURLToPath(import.meta.url))
    await migrate(db, { migrationsFolder: resolve(here, '../migrations') })
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `seedtest-${run}`, legalName: 'Seed Test', stateCode: '27' })
    await db.insert(users).values({
      id: ownerId,
      phone: `+9190000${run}`,
      name: 'Seed Test Owner',
      username: `seedtest.${run}`,
      passwordHash,
      passwordChangedAt: new Date(),
    })
    await db.insert(memberships).values({ id: uuidv7(), tenantId, userId: ownerId, role: 'owner' })
    await bootstrapTenant(db, tenantId)
  }, 60_000)

  afterAll(async () => {
    await pool?.end()
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`)
    await adminPool.end()
  })

  it('writes the whole demo the first time and nothing the second time', async () => {
    await seedDemo(db, tenantId, { passwordHash, printSignIn: false })
    const first = await rowCounts(db)
    expect(first['claims']).toBe(7)
    expect(first['claim_lines']).toBeGreaterThan(20)

    // The regression this spec exists for: the pending van-sale order is part of the FIRST seed.
    const pending = await db
      .select({ orderNo: salesOrders.orderNo, state: salesOrders.state })
      .from(salesOrders)
      .where(eq(salesOrders.orderNo, 'SO-9003'))
    expect(pending).toEqual([{ orderNo: 'SO-9003', state: 'confirmed' }])

    // The claims seed reads the bootstrap godown, not whichever `warehouse` row a docs example or a
    // smoke probe added later, and names the shop on every sheet row the way the live sheet does.
    const expiry = (
      await db.execute(sql`
        SELECT loc.name, sl.qty_delta AS delta
          FROM stock_ledger sl JOIN locations loc ON loc.id = sl.location_id
         WHERE sl.tenant_id = ${tenantId} AND sl.reason = 'expiry_writeoff'
         ORDER BY loc.name, sl.lot_id`)
    ).rows as { name: string; delta: number }[]
    expect(expiry.map((r) => `${r.name}:${r.delta}`)).toEqual([
      'Damaged / expiry bin:12',
      'Damaged / expiry bin:12',
      'Godown:-12',
      'Godown:-12',
    ])
    const sheetRows = (
      await db.execute(sql`
        SELECT c.claim_no AS claim_no, s.payload->'rows'->0->>'retailerName' AS shop
          FROM claim_statements s JOIN claims c ON c.id = s.claim_id
         WHERE s.tenant_id = ${tenantId} ORDER BY c.claim_no`)
    ).rows as { claim_no: string; shop: string | null }[]
    expect(sheetRows.map((r) => r.claim_no)).toEqual(['CLM-0001', 'CLM-0002'])
    expect(sheetRows.every((r) => typeof r.shop === 'string' && r.shop.length > 0)).toBe(true)

    await seedDemo(db, tenantId, { passwordHash, printSignIn: false })
    const second = await rowCounts(db)
    const drift = Object.keys({ ...first, ...second })
      .filter((table) => first[table] !== second[table])
      .map((table) => `${table}: ${first[table] ?? 0} -> ${second[table] ?? 0}`)
    expect(drift).toEqual([])
  }, 60_000)

  /**
   * The founder's requirement (docs/22 §8, 2026-09-04): three distributors, staff under each, and
   * shops linked to more than one of them. What makes it a real test rather than three copies of the
   * same data is that the shops are SHARED — one `retailer_identities` row with a `retailers` row and
   * a `retailer_links` row per tenant — and that each distributor's books still balance on their own.
   */
  it('seeds three distributors that share shops and stay isolated', async () => {
    await seedExtraTenants(db, { passwordHash, printSignIn: false })
    const before = await rowCounts(db)

    const tenantRows = (
      await db.execute(sql`SELECT id, slug, legal_name FROM tenants ORDER BY slug`)
    ).rows as { id: string; slug: string; legal_name: string }[]
    const pilotSlug = `seedtest-${run}`
    expect(tenantRows.map((t) => t.slug).sort()).toEqual(
      ['kalyan-agencies', 'sai-distributors', pilotSlug].sort(),
    )

    // Each distributor has its own team and its own month of trade.
    for (const t of tenantRows) {
      const [counts] = (
        await db.execute(sql`
          SELECT (SELECT count(*) FROM memberships m WHERE m.tenant_id = ${t.id}) AS staff,
                 (SELECT count(*) FROM retailers r WHERE r.tenant_id = ${t.id}) AS shops,
                 (SELECT count(*) FROM sales_orders o WHERE o.tenant_id = ${t.id}) AS orders,
                 (SELECT count(*) FROM invoices i WHERE i.tenant_id = ${t.id}) AS invoices,
                 (SELECT count(*) FROM receipts x WHERE x.tenant_id = ${t.id}) AS receipts,
                 (SELECT count(*) FROM trips x WHERE x.tenant_id = ${t.id}) AS trips,
                 (SELECT count(*) FROM deliveries x WHERE x.tenant_id = ${t.id}) AS deliveries`)
      ).rows as Record<string, string | number>[]
      const n = (k: string) => Number(counts?.[k] ?? 0)
      expect({ slug: t.slug, ok: n('staff') >= 12 }).toEqual({ slug: t.slug, ok: true })
      expect({ slug: t.slug, ok: n('shops') >= 10 }).toEqual({ slug: t.slug, ok: true })
      for (const key of ['orders', 'invoices', 'receipts', 'trips', 'deliveries']) {
        expect({ slug: t.slug, key, ok: n(key) > 0 }).toEqual({ slug: t.slug, key, ok: true })
      }
    }

    // Ten shops are the same shop on two distributors' books; five of those on all three.
    const shared = (
      await db.execute(sql`
        SELECT ri.shop_name AS shop, count(DISTINCT rl.tenant_id)::int AS distributors
          FROM retailer_identities ri JOIN retailer_links rl ON rl.identity_id = ri.id
         GROUP BY ri.id, ri.shop_name HAVING count(DISTINCT rl.tenant_id) > 1
         ORDER BY 2 DESC, 1`)
    ).rows as { shop: string; distributors: number }[]
    expect(shared.length).toBe(10)
    expect(shared.filter((r) => r.distributors === 3).length).toBe(5)

    // One shopkeeper, three distributors: what the retailer app's switch-distributor flow needs.
    const memberships = (
      await db.execute(sql`
        SELECT u.username, count(*)::int AS n FROM users u JOIN memberships m ON m.user_id = u.id
         WHERE u.username IN ('ramesh.gupta', 'fatima.shaikh') GROUP BY u.username ORDER BY u.username`)
    ).rows as { username: string; n: number }[]
    expect(memberships).toEqual([
      { username: 'fatima.shaikh', n: 2 },
      { username: 'ramesh.gupta', n: 3 },
    ])

    // Every distributor's own invoice series, white-label name and books.
    for (const t of tenantRows) {
      const [series] = (
        await db.execute(sql`
          SELECT prefix FROM numbering_series
           WHERE tenant_id = ${t.id} AND series_code = 'INV'`)
      ).rows as { prefix: string }[]
      const expected =
        t.slug === 'sai-distributors' ? 'SAI/' : t.slug === 'kalyan-agencies' ? 'KA/' : 'INV/'
      expect({ slug: t.slug, prefix: series?.prefix }).toEqual({ slug: t.slug, prefix: expected })

      // The seeded history carries that same series, not the pilot's. (Bills carried in from the
      // previous software keep their own `OPEN/` numbers; that is the point of an opening balance.)
      const [ownSeries] = (
        await db.execute(sql`
          SELECT count(*)::int AS n,
                 count(*) FILTER (WHERE invoice_no LIKE ${expected + '%'})::int AS matching
            FROM invoices WHERE tenant_id = ${t.id} AND series_code = 'INV'`)
      ).rows as { n: number; matching: number }[]
      expect({ slug: t.slug, ...ownSeries }).toEqual({
        slug: t.slug,
        n: ownSeries?.n ?? 0,
        matching: ownSeries?.n ?? 0,
      })
      expect({ slug: t.slug, any: (ownSeries?.n ?? 0) > 0 }).toEqual({ slug: t.slug, any: true })

      const [display] = (
        await db.execute(sql`
          SELECT value #>> '{}' AS name FROM tenant_settings
           WHERE tenant_id = ${t.id} AND key = 'branding.display_name'`)
      ).rows as { name: string }[]
      expect({ slug: t.slug, named: (display?.name ?? '').length > 0 }).toEqual({
        slug: t.slug,
        named: true,
      })

      // The two assertions the seed itself makes, checked per tenant from outside it.
      const unbalanced = await db.execute(sql`
        SELECT entry_id FROM journal_lines WHERE tenant_id = ${t.id}
         GROUP BY entry_id HAVING sum(amount_paise) <> 0`)
      expect({ slug: t.slug, unbalanced: unbalanced.rows.length }).toEqual({
        slug: t.slug,
        unbalanced: 0,
      })
      const [tie] = (
        await db.execute(sql`
          SELECT (SELECT coalesce(sum(jl.amount_paise), 0) FROM journal_lines jl
                    JOIN accounts a ON a.id = jl.account_id
                   WHERE jl.tenant_id = ${t.id} AND a.code = 'AR') AS ar,
                 (SELECT coalesce(sum(outstanding_paise - unallocated_credit_paise), 0)
                    FROM retailer_outstanding_summary WHERE tenant_id = ${t.id}) AS rollup`)
      ).rows as { ar: string | number; rollup: string | number }[]
      expect({ slug: t.slug, tied: Number(tie?.ar ?? 0) === Number(tie?.rollup ?? 0) }).toEqual({
        slug: t.slug,
        tied: true,
      })
    }

    // No tenant's rows leaked into another: every tenant-scoped row of a shared shop belongs to the
    // distributor whose retailer row it points at.
    const [leak] = (
      await db.execute(sql`
        SELECT count(*)::int AS n FROM invoices i JOIN retailers r ON r.id = i.retailer_id
         WHERE r.tenant_id <> i.tenant_id`)
    ).rows as { n: number }[]
    expect(leak?.n).toBe(0)

    // Still idempotent with three distributors in the database.
    await seedExtraTenants(db, { passwordHash, printSignIn: false })
    const after = await rowCounts(db)
    const drift = Object.keys({ ...before, ...after })
      .filter((table) => before[table] !== after[table])
      .map((table) => `${table}: ${before[table] ?? 0} -> ${after[table] ?? 0}`)
    expect(drift).toEqual([])
  }, 120_000)
})
