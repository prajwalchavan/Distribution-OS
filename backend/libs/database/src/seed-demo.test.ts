import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, type Db } from './client.js'
import { memberships, salesOrders, tenants, users } from './schema/index.js'
import { seedDemo, seedExtraTenants, seedPlatformConsole } from './seed-demo.js'
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

/**
 * The AI demo data every distributor gets (module 12, docs/22 §8 2026-09-05), asserted from outside
 * the seed: a draft in EVERY status the enum has — including one CONFIRMED into a real order of that
 * same distributor, with the person who confirmed it named, which is the human-in-the-loop rule
 * migration 0032 enforces — a reorder list with SKUs genuinely short of the contract's default 21-day
 * cover, and one unapplied route plan for every trip that can still be planned.
 */
async function expectAiDemo(db: Db, tenantId: string, slug: string): Promise<void> {
  const drafts = (
    await db.execute(sql`
      SELECT status::text AS status, count(*)::int AS n FROM ai_order_drafts
       WHERE tenant_id = ${tenantId} GROUP BY 1 ORDER BY 1`)
  ).rows as { status: string; n: number }[]
  expect({ slug, statuses: drafts.map((r) => r.status).sort() }).toEqual({
    slug,
    statuses: ['confirmed', 'expired', 'needs_review', 'parsed', 'rejected'],
  })

  // The confirmed draft is joined to an order of this very distributor and names its reviewer.
  const [confirmed] = (
    await db.execute(sql`
      SELECT d.reviewed_by IS NOT NULL AND d.reviewed_at IS NOT NULL AS reviewed,
             o.id IS NOT NULL AS order_exists,
             jsonb_array_length(d.parsed_lines)::int AS lines
        FROM ai_order_drafts d
        LEFT JOIN sales_orders o ON o.id = d.created_order_id AND o.tenant_id = d.tenant_id
       WHERE d.tenant_id = ${tenantId} AND d.status = 'confirmed' LIMIT 1`)
  ).rows as { reviewed: boolean; order_exists: boolean; lines: number }[]
  expect({ slug, ...confirmed }).toEqual({
    slug,
    reviewed: true,
    order_exists: true,
    lines: confirmed?.lines ?? 0,
  })
  expect({ slug, hasLines: (confirmed?.lines ?? 0) > 0 }).toEqual({ slug, hasLines: true })

  // One `needs_review` draft carries an ambiguous line WITH candidates — otherwise the review screen
  // has a button nothing ever reaches.
  const [ambiguous] = (
    await db.execute(sql`
      SELECT count(*)::int AS n FROM ai_order_drafts d, jsonb_array_elements(d.parsed_lines) AS line
       WHERE d.tenant_id = ${tenantId} AND d.status = 'needs_review'
         AND line->>'variantId' IS NULL AND jsonb_array_length(line->'candidates') > 0`)
  ).rows as { n: number }[]
  expect({ slug, ambiguousLines: (ambiguous?.n ?? 0) > 0 }).toEqual({ slug, ambiguousLines: true })

  // The buyer's working list: rows, and a few of them genuinely short of cover.
  const [forecasts] = (
    await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE days_cover IS NOT NULL AND days_cover < 21)::int AS below
        FROM ai_forecasts WHERE tenant_id = ${tenantId}`)
  ).rows as { n: number; below: number }[]
  expect({ slug, any: (forecasts?.n ?? 0) > 0, below: (forecasts?.below ?? 0) >= 3 }).toEqual({
    slug,
    any: true,
    below: true,
  })

  // Every trip that can still be planned — an open state AND a stop left to sequence, which is
  // exactly what `ai.routing.plan` accepts — has one plan, and none of them has been applied.
  const [plans] = (
    await db.execute(sql`
      SELECT count(*)::int AS plannable,
             count(p.id)::int AS plans,
             count(p.applied_at)::int AS applied
        FROM trips t
        LEFT JOIN route_plans p ON p.trip_id = t.id AND p.tenant_id = t.tenant_id
       WHERE t.tenant_id = ${tenantId} AND t.state IN ('planned', 'loading', 'active')
         AND EXISTS (
           SELECT 1 FROM trip_stops s WHERE s.trip_id = t.id
            AND s.state NOT IN ('delivered', 'partial', 'failed', 'skipped'))`)
  ).rows as { plannable: number; plans: number; applied: number }[]
  expect({ slug, ...plans }).toEqual({
    slug,
    plannable: plans?.plannable ?? 0,
    plans: plans?.plannable ?? 0,
    applied: 0,
  })
  expect({ slug, planned: (plans?.plannable ?? 0) > 0 }).toEqual({ slug, planned: true })
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
    // `tarsun` on purpose, in this spec's OWN throwaway database: it is the slug `pnpm db:seed`
    // writes, the one `seedPlatformConsole` recognises as the paying pilot, and the spec exists to
    // model that command rather than a near neighbour of it.
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: 'tarsun', legalName: 'Seed Test', stateCode: '27' })
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
    // the whole scheme book is claimed brand by brand and month by month, plus the damage, expiry,
    // shortage and brand-DMS claims: a dozen or more, never fewer
    expect(first['claims']).toBeGreaterThanOrEqual(12)
    expect(first['claim_lines']).toBeGreaterThan(200)

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
    // two sheets: one on the first settled scheme claim, one on the first still-submitted claim —
    // both numbered claims (a draft has no sheet), both naming the shop on their first row
    expect(sheetRows).toHaveLength(2)
    expect(sheetRows.every((r) => /^CLM-\d{4}$/.test(r.claim_no))).toBe(true)
    expect(sheetRows.every((r) => typeof r.shop === 'string' && r.shop.length > 0)).toBe(true)

    await expectAiDemo(db, tenantId, 'pilot')

    // The owner's half of platform support access: a pending request the owner app can answer, filed
    // by a Distribution OS staff account that holds NO membership anywhere.
    const [support] = (
      await db.execute(sql`
        SELECT count(*)::int AS pending,
               count(*) FILTER (WHERE pa.disabled_at IS NULL)::int AS from_active_admin,
               count(m.id)::int AS requester_memberships
          FROM support_grants g
          JOIN platform_admins pa ON pa.user_id = g.admin_user_id
          LEFT JOIN memberships m ON m.user_id = g.admin_user_id
         WHERE g.tenant_id = ${tenantId} AND g.approved_at IS NULL AND g.revoked_at IS NULL`)
    ).rows as { pending: number; from_active_admin: number; requester_memberships: number }[]
    expect(support).toEqual({ pending: 1, from_active_admin: 1, requester_memberships: 0 })

    await seedDemo(db, tenantId, { passwordHash, printSignIn: false })
    const second = await rowCounts(db)
    const drift = Object.keys({ ...first, ...second })
      .filter((table) => first[table] !== second[table])
      .map((table) => `${table}: ${first[table] ?? 0} -> ${second[table] ?? 0}`)
    expect(drift).toEqual([])
  }, 60_000)

  /**
   * CLAUDE.md's contract for `pnpm smoke --destructive` is one line: "idempotent, re-run after
   * `pnpm smoke --destructive`". The destructive pass presses `admin.tenants.suspend` (423 to every
   * sign-in of the whole distributorship), `admin.users.disable` (one identity out of every
   * distributor) and `tenancy.staff.setStatus` — and NOT ONE of the seed's `onConflictDoNothing()`
   * inserts undoes any of them, because every row already exists. On 2026-09-06 that left the pilot
   * tenant suspended and all seven demo sign-ins answering 423 until the column was set by hand.
   * `restoreDemoAccess` is the line's implementation; this is the test that keeps it honest.
   */
  it('re-activates a distributorship, a membership and an identity that a destructive run locked', async () => {
    const before = await rowCounts(db)
    await db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId))
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, ownerId))
    await db
      .update(memberships)
      .set({ status: 'disabled' })
      .where(eq(memberships.tenantId, tenantId))

    await seedDemo(db, tenantId, { passwordHash, printSignIn: false })

    const [tenant] = await db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    expect(tenant?.status).toBe('active')
    const [owner] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, ownerId))
    expect(owner?.status).toBe('active')
    const stillDisabled = (
      await db.execute(sql`
        SELECT count(*)::int AS n FROM memberships
         WHERE tenant_id = ${tenantId} AND status <> 'active'`)
    ).rows as { n: number }[]
    expect(stillDisabled[0]?.n).toBe(0)
    // ...and putting the demo back on its feet is still a seed: it adds nothing.
    expect(await rowCounts(db)).toEqual(before)
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
    const pilotSlug = 'tarsun'
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

      // The assistive surfaces are v1 for EVERY distributor, not a pilot-only extra (docs/22 §8,
      // 2026-09-05), and so is the support request its owner has to answer.
      await expectAiDemo(db, t.id, t.slug)
      const [pending] = (
        await db.execute(sql`
          SELECT count(*)::int AS n FROM support_grants
           WHERE tenant_id = ${t.id} AND approved_at IS NULL AND revoked_at IS NULL`)
      ).rows as { n: number }[]
      expect({ slug: t.slug, pendingSupport: pending?.n ?? 0 }).toEqual({
        slug: t.slug,
        pendingSupport: 1,
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

  /**
   * DOS-001. The owner's and the manager's Today read "Money owed, by age" from ONE row,
   * `owner_summary.detail`, through `reporting.dashboard.owner`, and `pnpm db:seed` writes that row
   * last of all for every distributor (`seedReportingClose`). Until the worker's next rollup rewrites
   * it, the seed's keys are the dashboard's keys: a near miss (`ageingB90Plus`) reads as a missing key,
   * so the home page said 90+ = 0.00 while Money -> Outstanding showed the real debt. This database is
   * the spec's own, so no worker can rewrite the row between the seed and the query below.
   */
  it('DOS-001: the seeded owner_summary.detail carries every ageing bucket under the keys the owner dashboard reads (ageingB90plus included), equal to retailer_outstanding_summary, for all three distributors', async () => {
    // So it also runs alone under `-t DOS-001`: both are idempotent, in `pnpm db:seed`'s order.
    await seedDemo(db, tenantId, { passwordHash, printSignIn: false })
    await seedExtraTenants(db, { passwordHash, printSignIn: false })

    // The keys `ReportingService.dashboardOwner()` reads through `fromDetail(...)`
    // (libs/core/src/modules/reporting/reporting.service.ts), each ageing key beside the live bucket
    // it must equal. Spelled out here rather than imported, so a drift fails as an assertion.
    const rungs = [
      ['ageingB0_7', 'b0_7'],
      ['ageingB8_15', 'b8_15'],
      ['ageingB16_30', 'b16_30'],
      ['ageingB31_60', 'b31_60'],
      ['ageingB61_90', 'b61_90'],
      ['ageingB90plus', 'b90plus'],
    ] as const
    const ageingKeys: string[] = rungs.map(([key]) => key)
    const readerKeys = [...ageingKeys, 'cashInTransitPaise']

    const rows = (
      await db.execute(sql`
        SELECT t.slug, s.detail,
               coalesce(sum(r.bucket_0_7_paise), 0)::bigint AS b0_7,
               coalesce(sum(r.bucket_8_15_paise), 0)::bigint AS b8_15,
               coalesce(sum(r.bucket_16_30_paise), 0)::bigint AS b16_30,
               coalesce(sum(r.bucket_31_60_paise), 0)::bigint AS b31_60,
               coalesce(sum(r.bucket_61_90_paise), 0)::bigint AS b61_90,
               coalesce(sum(r.bucket_90_plus_paise), 0)::bigint AS b90plus
          FROM tenants t
          JOIN owner_summary s ON s.tenant_id = t.id
          LEFT JOIN retailer_outstanding_summary r ON r.tenant_id = t.id
         WHERE t.slug IN ('tarsun', 'sai-distributors', 'kalyan-agencies')
         GROUP BY t.slug, s.detail
         ORDER BY t.slug`)
    ).rows as { slug: string; detail: Record<string, unknown> | null; [bucket: string]: unknown }[]
    expect(rows.map((r) => r.slug)).toEqual(['kalyan-agencies', 'sai-distributors', 'tarsun'])

    for (const row of rows) {
      const { slug } = row
      const keys = Object.keys(row.detail ?? {})
      // every key the dashboard reads is there...
      expect(keys, slug).toEqual(expect.arrayContaining(readerKeys))
      // ...and no other spelling of an ageing bucket sits beside them
      const strayAgeingKeys = keys.filter((k) => /^ageing/i.test(k) && !ageingKeys.includes(k))
      expect({ slug, strayAgeingKeys }).toEqual({ slug, strayAgeingKeys: [] })
      // each rung carries the tenant's live ageing money, as the number the dashboard accepts
      const seeded = Object.fromEntries(rungs.map(([key]) => [key, row.detail?.[key] ?? null]))
      const live = Object.fromEntries(rungs.map(([key, bucket]) => [key, Number(row[bucket])]))
      expect({ slug, ...seeded }).toEqual({ slug, ...live })
    }
    // the 90+ comparison is not 0 = 0: the demo carries debt older than ninety days
    expect(rows.some((r) => Number(r['b90plus']) > 0)).toBe(true)
  }, 180_000)

  /**
   * Module 13's console data, the last thing `pnpm db:seed` writes: the `dos.admin` account every
   * `/auth/platform/login` in the docs and in `pnpm smoke` uses, a subscription for every
   * distributor, and support windows in all three states an owner and a console can see — one live
   * and approved, one lapsed, one still waiting for an answer.
   */
  it('seeds the platform console: one administrator, a subscription per distributor, grants in every state', async () => {
    await seedPlatformConsole(db, passwordHash)
    const before = await rowCounts(db)

    // A console account is NOT a membership role: it belongs to no distributor at all, which is why
    // it signs in at `/auth/platform/login` and is refused by all six role services.
    const [admin] = (
      await db.execute(sql`
        SELECT pa.role::text AS role,
               pa.disabled_at IS NULL AS active,
               (SELECT count(*)::int FROM memberships m WHERE m.user_id = u.id) AS memberships
          FROM users u JOIN platform_admins pa ON pa.user_id = u.id
         WHERE u.username = 'dos.admin'`)
    ).rows as { role: string; active: boolean; memberships: number }[]
    expect(admin).toEqual({ role: 'super', active: true, memberships: 0 })

    // One subscription per distributor: the pilot pays, the other two are inside their free window.
    const subs = (
      await db.execute(sql`
        SELECT t.slug AS slug, s.plan::text AS plan, s.status::text AS status,
               s.price_paise_month::int AS price
          FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id ORDER BY t.slug`)
    ).rows as { slug: string; plan: string; status: string; price: number }[]
    expect(subs.map((s) => s.slug)).toEqual(['kalyan-agencies', 'sai-distributors', 'tarsun'])
    expect(subs.find((s) => s.slug === 'tarsun')).toEqual({
      slug: 'tarsun',
      plan: 'pro',
      status: 'active',
      price: 499_900,
    })
    expect(subs.filter((s) => s.status === 'trial').length).toBe(2)
    // Our price to a distributor is money, and it is OUR money: never a paise of their trade.
    expect(subs.every((s) => s.price > 0)).toBe(true)

    // The three states, all against the pilot, all approved by the pilot's OWN owner — the database
    // refuses any other approver, and refuses the requester approving their own ask.
    const [pilot] = (await db.execute(sql`SELECT id FROM tenants WHERE slug = 'tarsun'`)).rows as {
      id: string
    }[]
    const [grants] = (
      await db.execute(sql`
        SELECT count(*) FILTER (
                 WHERE g.approved_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at > now()
               )::int AS live,
               count(*) FILTER (WHERE g.approved_at IS NOT NULL AND g.expires_at <= now())::int AS lapsed,
               count(*) FILTER (WHERE g.approved_at IS NULL AND g.revoked_at IS NULL)::int AS pending,
               count(*) FILTER (
                 WHERE g.approved_by IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM memberships m
                    WHERE m.user_id = g.approved_by AND m.tenant_id = g.tenant_id
                      AND m.role = 'owner' AND m.status = 'active')
               )::int AS approved_by_a_stranger
          FROM support_grants g WHERE g.tenant_id = ${pilot?.id ?? ''}`)
    ).rows as { live: number; lapsed: number; pending: number; approved_by_a_stranger: number }[]
    expect(grants).toEqual({ live: 1, lapsed: 1, pending: 1, approved_by_a_stranger: 0 })

    // …and the console seed adds nothing the second time either.
    await seedPlatformConsole(db, passwordHash)
    const after = await rowCounts(db)
    const drift = Object.keys({ ...before, ...after })
      .filter((table) => before[table] !== after[table])
      .map((table) => `${table}: ${before[table] ?? 0} -> ${after[table] ?? 0}`)
    expect(drift).toEqual([])
  }, 60_000)
})
