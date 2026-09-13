import { sql } from 'drizzle-orm'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  createDb,
  createPool,
  retailerOutstandingSummary,
  retailers,
  tenants,
  withTenant,
  type TenantContext,
} from '@dos/db'
import { afterAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { ageingNeedsRebuild, rebuildTenantAgeing } from './ageing-rebuild.js'
import { rebuildAgeingPage } from './outstanding.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** IST day offsets, the only way a date is built anywhere in this module. */
function day(offset: number): string {
  const iso = businessDate().date
  const at = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  )
  return new Date(at + offset * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The worker's half of the ageing rebuild (DOS-117): plain functions, no Nest app, no request context.
 * Each test creates its own distributors by direct insert and calls the functions the nightly job calls.
 */
describeDb('receivables ageing rebuild for the worker (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  let shopSeq = 0

  afterAll(async () => {
    await pool.end()
  })

  async function tenant(label: string): Promise<string> {
    const id = uuidv7()
    await db
      .insert(tenants)
      .values({ id, slug: `agr-${label}-${run}`, legalName: `Ageing ${label}`, stateCode: '27' })
    return id
  }

  async function shops(tenantId: string, count: number): Promise<string[]> {
    const rows = Array.from({ length: count }, () => {
      shopSeq += 1
      const n = String(shopSeq).padStart(4, '0')
      return {
        id: uuidv7(),
        tenantId,
        code: `AGR-${run}-${n}`,
        name: `Shop ${n}`,
        phone: `+919800${n}`,
        stateCode: '27',
      }
    })
    await db.insert(retailers).values(rows)
    return rows.map((r) => r.id)
  }

  /** How many rows of `table` the tenant holds per `as_of`. */
  async function datesOf(
    table: 'retailer_outstanding_summary' | 'ageing_snapshots',
    tenantId: string,
  ): Promise<Record<string, number>> {
    const result = await db.execute(sql`
      select as_of::text as as_of, count(*)::int as n
        from ${sql.identifier(table)} where tenant_id = ${tenantId} group by 1 order by 1`)
    return Object.fromEntries(result.rows.map((r) => [String(r.as_of), Number(r.n)]))
  }

  it('DOS-117: rebuildTenantAgeing walks a tenant of more than one page (501 shops) and dates every summary row and snapshot to the new business date as the system actor', async () => {
    const t = await tenant('page')
    await shops(t, 501)

    // No request context around the call: the function enters the tenant's system actor itself.
    const result = await rebuildTenantAgeing(db, t, day(1))

    expect(result).toEqual({ asOf: day(1), retailers: 501, outstandingPaise: 0, overduePaise: 0 })
    expect(await datesOf('retailer_outstanding_summary', t)).toEqual({ [day(1)]: 501 })
    expect(await datesOf('ageing_snapshots', t)).toEqual({ [day(1)]: 501 })
  })

  it('DOS-117: ageingNeedsRebuild is true while any dues row is dated before the day or the day has no snapshot (a one-shop owner rebuild does not clear it), false after the tenant-wide rebuild, and a shop added later with no posting does not re-trigger it', async () => {
    const t = await tenant('crit')
    const [first] = await shops(t, 3)
    if (!first) throw new Error('no shop')
    await rebuildTenantAgeing(db, t, day(0))
    expect(await ageingNeedsRebuild(db, t, day(0))).toBe(false)

    // A shop opened after the day's rebuild, with no posting yet, has no dues row to re-date.
    await shops(t, 1)
    expect(await ageingNeedsRebuild(db, t, day(0))).toBe(false)

    // The next business date: every dues row is a day old.
    expect(await ageingNeedsRebuild(db, t, day(1))).toBe(true)

    // The owner's one-shop rebuild writes that shop's row and a snapshot for the day, and leaves the
    // other shops' rows dated the day before.
    const ctx: TenantContext = { tenantId: t, actorId: 'system', actorRole: 'system' }
    await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, (tx) => rebuildAgeingPage(tx, day(1), [first])),
    )
    expect(await ageingNeedsRebuild(db, t, day(1))).toBe(true)

    await rebuildTenantAgeing(db, t, day(1))
    expect(await ageingNeedsRebuild(db, t, day(1))).toBe(false)

    // Dues rows already dated the day (a posting after midnight), and no snapshot for it.
    const posted = await tenant('posted')
    const postedShops = await shops(posted, 2)
    await db
      .insert(retailerOutstandingSummary)
      .values(postedShops.map((retailerId) => ({ tenantId: posted, retailerId, asOf: day(1) })))
    expect(await ageingNeedsRebuild(db, posted, day(1))).toBe(true)

    // Shops but no dues rows at all: nothing to re-date.
    const fresh = await tenant('fresh')
    await shops(fresh, 2)
    expect(await ageingNeedsRebuild(db, fresh, day(1))).toBe(false)
  })
})
