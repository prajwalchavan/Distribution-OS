import { sql } from 'drizzle-orm'
import { withSystem, type Db } from '@dos/db'
import { businessDate } from '@dos/domain'

/**
 * HOW BIG IS EACH DISTRIBUTOR, AND HOW BUSY IS THE PLATFORM — counts, and nothing but counts.
 *
 * These queries are the one part of module 13 that reaches across tenants, and they run under
 * `withSystem()` (BYPASSRLS) because there is no other way to answer "how many shops does this
 * distributor have" for a console that holds no membership anywhere. That is a real widening, so it is
 * confined to this file, and the file has one rule that every query below obeys:
 *
 *   **Nothing here returns a row of a distributor's trade. Every SELECT is a COUNT, a MAX(timestamp)
 *   or a SUM of file sizes, grouped by tenant. No name, no amount, no cost, no margin, no shop, no
 *   order, no invoice line ever leaves these functions.**
 *
 * That is what the founder's own decision allows (docs/22 §2 row 7: the console does onboarding, plans
 * and support grants) and what the never-list forbids (§9 items 1 and 9: nobody reads another tenant's
 * rows, and purchase cost is never readable outside the back office). "This distributorship has 36
 * shops and took 210 orders last month" is a size signal the platform needs to run itself; "this
 * distributorship billed ₹14 lakh" is a distributor's own business and is not answerable from here.
 * The only path to that is an owner-approved support grant, and it is audited (`support-access.ts`).
 *
 * Plain exported functions rather than an `@Injectable`, in the shape coordination §3.9 asks for, so a
 * later worker rollup can import them without Nest DI.
 */

export interface TenantSize {
  staffCount: number
  retailerCount: number
  orders30d: number
  invoices30d: number
  storageBytes: number
  lastActivityAt: Date | null
}

const EMPTY: TenantSize = {
  staffCount: 0,
  retailerCount: 0,
  orders30d: 0,
  invoices30d: 0,
  storageBytes: 0,
  lastActivityAt: null,
}

/**
 * One pass for a page of tenants, not one query per tenant: the console's list shows fifty rows and a
 * per-row round trip would be fifty times the work for a screen nobody scrolls (docs/20 rule 2,
 * bounded work per request).
 */
export async function tenantSizes(
  db: Db,
  tenantIds: readonly string[],
): Promise<ReadonlyMap<string, TenantSize>> {
  const out = new Map<string, TenantSize>()
  if (tenantIds.length === 0) return out
  for (const id of tenantIds) out.set(id, { ...EMPTY })
  const ids = sql.join(
    tenantIds.map((id) => sql`${id}`),
    sql`, `,
  )
  await withSystem(db, async (tx) => {
    const rows = await tx.execute<{
      tenant_id: string
      staff_count: string
      retailer_count: string
      orders_30d: string
      invoices_30d: string
      storage_bytes: string
      last_activity_at: Date | string | null
    }>(sql`
      with t as (select unnest(array[${ids}]::text[]) as tenant_id)
      select t.tenant_id,
        (select count(*) from memberships m
           where m.tenant_id = t.tenant_id and m.status = 'active' and m.role <> 'retailer') as staff_count,
        (select count(*) from retailers r where r.tenant_id = t.tenant_id) as retailer_count,
        (select count(*) from sales_orders o
           where o.tenant_id = t.tenant_id and o.created_at > now() - interval '30 days') as orders_30d,
        (select count(*) from invoices i
           where i.tenant_id = t.tenant_id and i.created_at > now() - interval '30 days') as invoices_30d,
        (select coalesce(sum(f.bytes), 0) from file_objects f
           where f.tenant_id = t.tenant_id and f.status = 'uploaded') as storage_bytes,
        (select max(o.created_at) from sales_orders o where o.tenant_id = t.tenant_id) as last_activity_at
      from t
    `)
    for (const row of rows.rows) {
      out.set(row.tenant_id, {
        staffCount: Number(row.staff_count),
        retailerCount: Number(row.retailer_count),
        orders30d: Number(row.orders_30d),
        invoices30d: Number(row.invoices_30d),
        storageBytes: Number(row.storage_bytes),
        // `tx.execute` hands back what the driver parsed, and an aggregate over a timestamptz can
        // arrive as a string rather than a Date depending on the type parser; normalised once, here.
        lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
      })
    }
  })
  return out
}

export interface PlatformCounts {
  activeUsers7d: number
  storageBytes: number
  storageObjects: number
  orders: { day: string; value: number }[]
  invoices: { day: string; value: number }[]
}

/**
 * The platform's own dashboard series, in IST days so a chart drawn from it lines up with every other
 * date in the product (`businessDate()`, never `toISOString().slice(0,10)`). Days with no activity are
 * filled with zero here rather than in the browser, so the console's chart has no gaps to reason about.
 */
export async function platformCounts(db: Db, days: number): Promise<PlatformCounts> {
  return withSystem(db, async (tx) => {
    const [users] = (
      await tx.execute<{ n: string }>(sql`
        select count(distinct user_id) as n from auth_events
        where kind = 'login_ok' and user_id is not null and created_at > now() - interval '7 days'
      `)
    ).rows
    const [storage] = (
      await tx.execute<{ bytes: string; objects: string }>(sql`
        select coalesce(sum(bytes), 0) as bytes, count(*) as objects
        from file_objects where status = 'uploaded'
      `)
    ).rows
    const orders = await dailySeries(tx, 'sales_orders', days)
    const invoices = await dailySeries(tx, 'invoices', days)
    return {
      activeUsers7d: Number(users?.n ?? 0),
      storageBytes: Number(storage?.bytes ?? 0),
      storageObjects: Number(storage?.objects ?? 0),
      orders,
      invoices,
    }
  })
}

/**
 * `days` is an integer the contract already caps at 92, and it is interpolated into an interval
 * literal rather than bound as a parameter because Postgres will not take a parameter inside
 * `interval '$1 days'`. It is a number by the time it reaches here (Zod parsed it), and
 * `Number.isInteger` below is the belt to that braces — never a string from the query.
 */
async function dailySeries(
  tx: Db,
  table: 'sales_orders' | 'invoices',
  days: number,
): Promise<{ day: string; value: number }[]> {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('days out of range')
  const source = table === 'sales_orders' ? sql`sales_orders` : sql`invoices`
  const rows = await tx.execute<{ day: string; n: string }>(sql`
    select to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*) as n
    from ${source}
    where created_at > now() - (${String(days)} || ' days')::interval
    group by 1
  `)
  const byDay = new Map(rows.rows.map((r) => [r.day, Number(r.n)]))
  const out: { day: string; value: number }[] = []
  const today = Date.now()
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = businessDate(today - i * 86_400_000).date
    out.push({ day, value: byDay.get(day) ?? 0 })
  }
  return out
}
