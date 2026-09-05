import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, type Db } from './client.js'
import { memberships, salesOrders, tenants, users } from './schema/index.js'
import { seedDemo } from './seed-demo.js'
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
})
