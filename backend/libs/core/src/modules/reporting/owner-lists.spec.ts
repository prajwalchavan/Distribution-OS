import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
import { bootstrapTenant, createDb, createPool, memberships, tenants, users } from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { BillingModule } from '../billing/index.js'
import { FilesModule } from '../files/index.js'
import { IntegrationsModule } from '../integrations/index.js'
import { InventoryModule } from '../inventory/index.js'
import { NotificationsModule } from '../notifications/index.js'
import { OrdersModule } from '../orders/index.js'
import { ProcurementModule } from '../procurement/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { RetailersModule } from '../retailers/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { WarehouseModule } from '../warehouse/index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Page {
  items: { id: string }[]
  nextCursor: string | null
}

/**
 * UX-O-8 and DOS-260, from the owner UX review of the business simulation (2026-09-27).
 *
 * UX-O-8: six registers the owner reads — credit notes, supplier bills, goods receipts, purchase orders,
 * exports and messages — still ordered on `desc(id)`. Ids are minted by the client (and the seed's are
 * hand-made hashes), so id order is not age: today's CN/9003–9007 were rows 56–60 of 60. The DOS-009
 * ruling (docs/22 §8, 2026-09-21) is one sentence: newest first on the column the list's own window
 * filters on — the document's stamped date for a dated register, server time for a queue — with the id
 * only breaking a tie. Each list is fed a row whose id sorts ABOVE the others but which is older, and a
 * cursor walk at `limit=1` must return every row once, newest first.
 *
 * DOS-260: the owner's "Shop by shop" rows were gross with no way to see what a shop holds on account;
 * each row now carries its own `unallocatedCreditPaise`, and the header's total is their sum.
 */
describeDb('owner registers read newest first and name money on account (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const shopA = uuidv7()
  const shopB = uuidv7()
  const shopC = uuidv7()
  const invoiceId = uuidv7()
  const supplierId = uuidv7()
  let godown = ''
  let app: NestFastifyApplication

  const today = businessDate().date
  const yesterday = businessDate(new Date(Date.now() - 86_400_000)).date
  const lastWeek = businessDate(new Date(Date.now() - 7 * 86_400_000)).date
  /** An id that sorts above every real UUIDv7 — the shape of the seed's and a sync client's ids. */
  const highId = (tag: string): string => `ffffffff-ffff-7fff-bfff-${tag.padStart(4, '0')}${run}`

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `uxo8-${run}`, legalName: 'Owner lists test', stateCode: '27' })
    await db.insert(users).values({ id: ownerId, phone: `+91917${run}1`, name: 'Owner' })
    await db.insert(memberships).values({ id: uuidv7(), tenantId, userId: ownerId, role: 'owner' })
    await bootstrapTenant(db, tenantId)
    const godownRow = await db.execute(
      sql`select id from locations where tenant_id = ${tenantId} and kind = 'warehouse' limit 1`,
    )
    godown = (godownRow.rows[0] as { id: string } | undefined)?.id ?? ''
    await db.execute(sql`
      insert into retailers (id, tenant_id, code, name, phone, state_code)
      values (${shopA}, ${tenantId}, ${`U8A-${run}`}, 'Patel Provision Mart', ${`+91917${run}5`}, '27'),
             (${shopB}, ${tenantId}, ${`U8B-${run}`}, 'Balaji Stores', ${`+91917${run}6`}, '27'),
             (${shopC}, ${tenantId}, ${`U8C-${run}`}, 'Ekta Kirana', ${`+91917${run}7`}, '27')`)
    await db.execute(sql`
      insert into invoices (id, tenant_id, fy, invoice_date, retailer_id, buyer_name, place_of_supply_state)
      values (${invoiceId}, ${tenantId}, '2026-27', ${lastWeek}, ${shopA}, 'Patel Provision Mart', '27')`)
    await db.execute(
      sql`insert into suppliers (id, tenant_id, name) values (${supplierId}, ${tenantId}, ${`Brand ${run}`})`,
    )
    app = await bootTestApp([
      BillingModule,
      WarehouseModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      ProcurementModule,
      TenantCatalogModule,
      IntegrationsModule,
      FilesModule,
      NotificationsModule,
      RetailersModule,
    ])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  /** Every row of the list, in the order `limit=1` pages hand them back. */
  const walk = async (path: string): Promise<string[]> => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let pages = 0; pages < 50; pages += 1) {
      const got = await call<Page>(app, owner, 'GET', path, { limit: 1, cursor })
      expect(got.status, JSON.stringify(got.body)).toBe(200)
      seen.push(...got.body.items.map((item) => item.id))
      if (got.body.nextCursor === null) return seen
      cursor = got.body.nextCursor
    }
    throw new Error(`${path} never ended its cursor walk`)
  }

  it('UX-O-8: credit notes read newest first by note date, the id only a tie-break, and the cursor walks each once', async () => {
    const older = highId('c1')
    const first = uuidv7()
    const last = uuidv7()
    await db.execute(sql`
      insert into credit_notes (id, tenant_id, fy, note_date, invoice_id, retailer_id, reason)
      values (${older}, ${tenantId}, '2026-27', ${yesterday}, ${invoiceId}, ${shopA}, 'short_delivery'),
             (${first}, ${tenantId}, '2026-27', ${today}, ${invoiceId}, ${shopA}, 'short_delivery'),
             (${last}, ${tenantId}, '2026-27', ${today}, ${invoiceId}, ${shopA}, 'return_saleable')`)
    expect(await walk('/credit-notes')).toEqual([last, first, older])
    // the window still filters on note_date, in the same order
    const window = await call<Page>(app, owner, 'GET', '/credit-notes', { from: today, to: today })
    expect(window.body.items.map((item) => item.id)).toEqual([last, first])
  })

  it('UX-O-8: supplier bills read newest first by their own invoice date', async () => {
    const older = highId('a1')
    const newer = uuidv7()
    await db.execute(sql`
      insert into supplier_invoices (id, tenant_id, supplier_id, source, invoice_no, invoice_date)
      values (${older}, ${tenantId}, ${supplierId}, 'manual', ${`OLD-${run}`}, ${lastWeek}),
             (${newer}, ${tenantId}, ${supplierId}, 'manual', ${`NEW-${run}`}, ${today})`)
    expect(await walk('/procurement/supplier-invoices')).toEqual([newer, older])
  })

  it('UX-O-8: goods receipts and purchase orders read newest first by server time', async () => {
    const bill = uuidv7()
    await db.execute(sql`
      insert into supplier_invoices (id, tenant_id, supplier_id, source, invoice_no, invoice_date)
      values (${bill}, ${tenantId}, ${supplierId}, 'manual', ${`GRN-${run}`}, ${today})`)
    const olderGrn = highId('b1')
    const newerGrn = uuidv7()
    await db.execute(sql`
      insert into grns (id, tenant_id, supplier_invoice_id, location_id, created_at)
      values (${olderGrn}, ${tenantId}, ${bill}, ${godown}, now() - interval '3 days'),
             (${newerGrn}, ${tenantId}, ${bill}, ${godown}, now())`)
    expect(await walk('/procurement/grns')).toEqual([newerGrn, olderGrn])

    const olderPo = highId('d1')
    const newerPo = uuidv7()
    await db.execute(sql`
      insert into purchase_orders (id, tenant_id, supplier_id, created_at)
      values (${olderPo}, ${tenantId}, ${supplierId}, now() - interval '3 days'),
             (${newerPo}, ${tenantId}, ${supplierId}, now())`)
    expect(await walk('/procurement/purchase-orders')).toEqual([newerPo, olderPo])
  })

  it('UX-O-8: exports and messages read newest first by server time', async () => {
    const olderJob = highId('e1')
    const newerJob = uuidv7()
    await db.execute(sql`
      insert into export_jobs (id, tenant_id, kind, requested_by, created_at)
      values (${olderJob}, ${tenantId}, 'tally_sales', ${ownerId}, now() - interval '3 days'),
             (${newerJob}, ${tenantId}, 'tally_sales', ${ownerId}, now())`)
    expect(await walk('/integrations/exports')).toEqual([newerJob, olderJob])

    const olderMsg = highId('f1')
    const newerMsg = uuidv7()
    await db.execute(sql`
      insert into messages (id, tenant_id, channel, "to", payload, idempotency_key, created_at)
      values (${olderMsg}, ${tenantId}, 'whatsapp', '+919999900001', '{}'::jsonb, ${`uxo8-old-${run}`}, now() - interval '3 days'),
             (${newerMsg}, ${tenantId}, 'whatsapp', '+919999900002', '{}'::jsonb, ${`uxo8-new-${run}`}, now())`)
    expect(await walk('/notifications/messages')).toEqual([newerMsg, olderMsg])
  })

  it('DOS-260: each shop row carries the money it holds on account, and the header is their sum', async () => {
    await db.execute(sql`
      insert into retailer_outstanding_summary
        (tenant_id, retailer_id, as_of, outstanding_paise, overdue_paise, unallocated_credit_paise, open_bills)
      values (${tenantId}, ${shopA}, ${today}, 107100, 0, 107100, 1),
             (${tenantId}, ${shopB}, ${today}, 72080400, 70000000, 1127600, 12),
             (${tenantId}, ${shopC}, ${today}, 0, 0, 0, 0)`)
    const got = await call<{
      items: { retailerId: string; outstandingPaise: number; unallocatedCreditPaise: number }[]
      totals: { unallocatedCreditPaise: number }
    }>(app, owner, 'GET', '/receivables/outstanding', { limit: 50 })
    expect(got.status, JSON.stringify(got.body)).toBe(200)
    const row = (id: string) => got.body.items.find((item) => item.retailerId === id)
    expect(row(shopA)).toMatchObject({ outstandingPaise: 107100, unallocatedCreditPaise: 107100 })
    expect(row(shopB)).toMatchObject({ outstandingPaise: 72080400, unallocatedCreditPaise: 1127600 })
    expect(row(shopC)).toMatchObject({ outstandingPaise: 0, unallocatedCreditPaise: 0 })
    expect(got.body.totals.unallocatedCreditPaise).toBe(107100 + 1127600)
    // "shops that owe" is the existing `minOutstandingPaise` filter: a ₹0 shop drops out, nothing else moves
    const owing = await call<{ items: { retailerId: string }[] }>(
      app,
      owner,
      'GET',
      '/receivables/outstanding',
      { limit: 50, minOutstandingPaise: 1 },
    )
    expect(owing.body.items.map((item) => item.retailerId).sort()).toEqual([shopA, shopB].sort())
  })
})
