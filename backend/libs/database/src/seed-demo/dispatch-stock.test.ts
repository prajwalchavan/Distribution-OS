import { afterAll, describe, expect, it } from 'vitest'
import { createDb, createPool } from '../client.js'
import { cancelFootprintFaults } from '../stock-footprints.js'
import { demoTenants, dispatchStockFaults } from './dispatch-stock.js'

/**
 * The dock model, proven on the SEEDED database `DATABASE_URL` points at (QA DOS-195, ruling S3): for
 * every demo distributor `pnpm db:seed` wrote, (a) no undelivered bill on a trip out of the godown needs
 * more of a lot than its van holds — the verifier's query, which found 69 of 103 pairs short under the
 * old seed; (b) no packed or dispatched order has pieces standing in no location; (c) no balance is
 * negative. `dispatchStockFaults` is the one list of sentences both this spec and `seed-demo.test.ts`
 * (a throwaway database seeded twice, in CI) assert empty.
 *
 * Skipped, not passed, on a database that holds no demo distributor: this spec reads what the seed
 * wrote and proves nothing on an empty one.
 */
const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('DOS-195 the seeded dock model (DATABASE_URL)', () => {
  const pool = createPool(url ?? '', 2)
  const db = createDb(pool)

  afterAll(async () => {
    await pool.end()
  })

  it('every demo distributor: undelivered bills stand on their van or the dock, delivered bills on neither, nothing negative', async (ctx) => {
    const tenants = await demoTenants(db)
    if (tenants.length === 0)
      ctx.skip('no demo distributor on this database: run pnpm db:seed first')
    for (const tenant of tenants) {
      const faults = await dispatchStockFaults(db, tenant.id)
      expect({ slug: tenant.slug, faults }).toEqual({ slug: tenant.slug, faults: [] })
    }
  }, 120_000)

  /**
   * QA DOS-257: no cancelled bill leaves stock behind that it never took out — the seed's three
   * cancelled bills (INV/9002, SAI/9002, KA/9002) put back exactly their own `sale` rows. On a database
   * the business simulation ran on, this is the release check `pnpm check:stock-cancels` prints: a
   * pre-DOS-251 phantom stays a failure here until a write-off on that batch takes it off.
   */
  it('every demo distributor: each cancelled bill nets to zero stock, or its extra pieces have been written off', async (ctx) => {
    const tenants = await demoTenants(db)
    if (tenants.length === 0)
      ctx.skip('no demo distributor on this database: run pnpm db:seed first')
    for (const tenant of tenants) {
      const faults = await cancelFootprintFaults(db, tenant.id)
      expect({ slug: tenant.slug, faults }).toEqual({ slug: tenant.slug, faults: [] })
    }
  }, 120_000)
})
