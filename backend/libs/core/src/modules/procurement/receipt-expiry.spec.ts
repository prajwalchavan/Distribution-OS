/**
 * Receipts and expiry — QA phase 10 (`QA/findings/17-inventory-states.md`) under the architect's stock rulings
 * of 2026-09-28 (docs/22 §8):
 *
 *   DOS-356  a second receipt of an item with no batch number joined the first lot and KEPT ITS EXPIRY: 144 pieces
 *            that expire in October were booked as expiring in January. A receipt now joins a lot only when item,
 *            batch, MRP and expiry are all the same (ruling 5).
 *   DOS-357  a batch that arrived already expired went into the godown as sellable stock without a word, and was
 *            billed a day later. Its good pieces now go into the damaged / expiry bin; the purchase is unchanged;
 *            the gate and the desk read "expired on arrival" before they confirm, and after (ruling 4).
 *
 * Its OWN tenant: the procurement spec's counts of rows and findings stay what they were.
 */
import { and, eq, sql } from 'drizzle-orm'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  locations,
  manufacturers,
  memberships,
  products,
  productVariants,
  stockBalances,
  suppliers,
  tenantProductCosts,
  tenants,
  users,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { InventoryModule } from '../inventory/index.js'
import { ProcurementModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type GrnLine = {
  id: string
  variantId: string
  lotId: string | null
  batchNo: string | null
  expiryDate: string | null
  countedQtyPcs: number | null
  expiredOnArrival?: boolean
  expiredOnArrivalPcs?: number
}
type Grn = {
  id: string
  status: string
  lines: GrnLine[]
  discrepancies: { kind: string; qtyPcs: number; grnLineId: string; note: string | null }[]
}
type BillLine = {
  variantId: string
  batchNo: string | null
  expiryDate: string | null
  qtyPcs: number
}

/** Today in IST plus `n` days, as an ISO day. */
function day(n: number): string {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + n)).toISOString().slice(0, 10)
}

describeDb('procurement: receipts and expiry (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const storeId = uuidv7()
  const supplierId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  /** Annapurna Garam Masala 50 g — the DOS-356 item, received with no batch number. */
  const masala = uuidv7()
  /** Sunbake Choco Chip Cookies — the DOS-357 item, one batch already expired. */
  const cookies = uuidv7()
  /** Neelam Tooth Brush — the in-date line beside it. */
  const brush = uuidv7()
  let godown = ''
  let bin = ''
  let app: NestFastifyApplication
  let billNo = 0

  /** An approved supplier bill (every line matched), ₹10 a piece at 12 % GST, MRP ₹45. */
  const bill = async (lines: BillLine[]): Promise<{ id: string; totalPaise: number }> => {
    billNo += 1
    const id = uuidv7()
    const body = lines.map((l, i) => {
      const taxable = 1000 * l.qtyPcs
      const tax = (taxable * 1200) / 10000
      return {
        id: uuidv7(),
        lineNo: i + 1,
        description: `Line ${String(i + 1)}`,
        variantId: l.variantId,
        hsnCode: '0910',
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
        mrpPaise: 4500,
        printedQty: l.qtyPcs,
        printedUnit: 'pcs',
        qtyPcs: l.qtyPcs,
        freeQtyPcs: 0,
        ratePaise: 1000,
        gstBps: 1200,
        taxablePaise: taxable,
        taxPaise: tax,
        lineTotalPaise: taxable + tax,
      }
    })
    const subtotal = body.reduce((n, l) => n + l.taxablePaise, 0)
    const tax = body.reduce((n, l) => n + l.taxPaise, 0)
    const res = await call<{ item: { status: string } }>(
      app,
      owner,
      'POST',
      '/procurement/supplier-invoices',
      {
        idempotencyKey: `bill-${String(billNo)}-${run}`,
        id,
        supplierId,
        source: 'manual',
        invoiceNo: `AK/${run}/${String(billNo)}`,
        invoiceDate: day(0),
        subtotalPaise: subtotal,
        discountPaise: 0,
        cgstPaise: tax / 2,
        sgstPaise: tax / 2,
        igstPaise: 0,
        cessPaise: 0,
        freightPaise: 0,
        roundOffPaise: 0,
        totalPaise: subtotal + tax,
        lines: body,
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.item.status).toBe('approved')
    return { id, totalPaise: subtotal + tax }
  }

  /** Open (owner), count every line in full (the godown's blind count), and return the GRN before posting. */
  const openAndCount = async (
    supplierInvoiceId: string,
  ): Promise<{ id: string; opened: Grn; counted: Grn }> => {
    const id = uuidv7()
    const opened = await call<{ item: Grn }>(app, owner, 'POST', '/procurement/grns', {
      idempotencyKey: `open-${id}`,
      id,
      supplierInvoiceId,
      locationId: godown,
    })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    const pieces = (
      await db.execute(sql`select id, expected_qty_pcs from grn_lines where grn_id = ${id}`)
    ).rows as { id: string; expected_qty_pcs: number }[]
    const counted = await call<{ item: Grn }>(app, store, 'POST', `/procurement/grns/${id}/count`, {
      idempotencyKey: `count-${id}`,
      lines: pieces.map((p) => ({ grnLineId: p.id, countedQtyPcs: p.expected_qty_pcs })),
    })
    expect(counted.status, JSON.stringify(counted.body)).toBe(200)
    return { id, opened: opened.body.item, counted: counted.body.item }
  }

  const post = async (id: string): Promise<Grn> => {
    const res = await call<{ item: Grn }>(app, owner, 'POST', `/procurement/grns/${id}/post`, {
      idempotencyKey: `post-${id}`,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.item.status).toBe('posted')
    return res.body.item
  }

  const receive = async (lines: BillLine[]): Promise<Grn> => {
    const { id: billId } = await bill(lines)
    const { id } = await openAndCount(billId)
    return post(id)
  }

  const lotsOf = async (variantId: string) =>
    (
      await db.execute(
        sql`select l.id, l.batch_no, l.expiry_date::text as expiry_date,
                   coalesce((select sum(b.on_hand) from stock_balances b where b.lot_id = l.id), 0)::int as on_hand
              from stock_lots l where l.tenant_id = ${tenantId} and l.variant_id = ${variantId}
             order by l.expiry_date nulls last, l.batch_no`,
      )
    ).rows as { id: string; batch_no: string; expiry_date: string | null; on_hand: number }[]

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `rcv-${run}`, legalName: 'Receipts test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91905${run}1`, name: 'Owner' },
      { id: storeId, phone: `+91905${run}2`, name: 'Godown' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker rcv ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Groceries' })
    await db.insert(productVariants).values(
      [
        [masala, 'Annapurna Garam Masala 50 g'],
        [cookies, 'Sunbake Choco Chip Cookies 120 g'],
        [brush, 'Neelam Tooth Brush 2+1'],
      ].map(([id, name]) => ({
        id: id ?? '',
        productId,
        name: name ?? '',
        netQty: 50,
        netUnit: 'g' as const,
        defaultCaseSize: 72,
        hsnCode: '0910',
        mrpPaise: 4500,
      })),
    )
    await db
      .insert(suppliers)
      .values({ id: supplierId, tenantId, name: `Annapurna Agencies ${run}` })
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    bin = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    app = await bootTestApp([ProcurementModule, InventoryModule])
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('DOS-356: a second receipt of a no-batch item with another expiry makes its own lot; the same expiry joins; each lot shows its own date', async () => {
    const first = await receive([
      { variantId: masala, batchNo: null, expiryDate: day(100), qtyPcs: 144 },
    ])
    const second = await receive([
      { variantId: masala, batchNo: null, expiryDate: day(20), qtyPcs: 144 },
    ])
    const firstLot = first.lines[0]?.lotId
    const secondLot = second.lines[0]?.lotId
    expect(firstLot).toBeTruthy()
    expect(secondLot).toBeTruthy()
    expect(secondLot).not.toBe(firstLot)
    // a third receipt with the FIRST expiry joins the first lot
    const third = await receive([
      { variantId: masala, batchNo: null, expiryDate: day(100), qtyPcs: 144 },
    ])
    expect(third.lines[0]?.lotId).toBe(firstLot)
    // a repeated batch number with another expiry is another lot too
    await receive([{ variantId: masala, batchNo: `R1-${run}`, expiryDate: day(50), qtyPcs: 72 }])
    await receive([{ variantId: masala, batchNo: `R1-${run}`, expiryDate: day(60), qtyPcs: 72 }])

    expect((await lotsOf(masala)).map((l) => [l.batch_no, l.expiry_date, l.on_hand])).toEqual([
      ['', day(20), 144],
      [`R1-${run}`, day(50), 72],
      [`R1-${run}`, day(60), 72],
      ['', day(100), 288],
    ])
    // the stock screen (and the expiring list, which reads the same rows) shows each batch's own date
    const books = await call<{
      items: { lotId: string; expiryDate: string | null; onHand: number }[]
    }>(app, store, 'GET', '/inventory/balances', { variantId: masala, nonZero: true })
    expect(books.status).toBe(200)
    expect(
      Object.fromEntries(books.body.items.map((b) => [b.lotId, [b.expiryDate, b.onHand]])),
    ).toMatchObject({
      [firstLot ?? '']: [day(100), 288],
      [secondLot ?? '']: [day(20), 144],
    })
    const soon = await call<{ items: { lotId: string }[] }>(
      app,
      store,
      'GET',
      '/inventory/balances',
      {
        variantId: masala,
        expiringBefore: day(30),
      },
    )
    expect(soon.body.items.map((b) => b.lotId)).toEqual([secondLot])
  })

  it('DOS-357: a batch that arrives already expired is flagged at the count, goes into the expiry bin at posting — never the godown — and the bill is owed and costed as printed', async () => {
    const { id: billId, totalPaise } = await bill([
      { variantId: cookies, batchNo: `EXP-${run}`, expiryDate: day(-5), qtyPcs: 48 },
      { variantId: brush, batchNo: `G1-${run}`, expiryDate: day(300), qtyPcs: 96 },
    ])
    const { id, opened, counted } = await openAndCount(billId)
    const lineOf = (grn: Grn, variantId: string) => grn.lines.find((l) => l.variantId === variantId)

    // before anyone confirms: the gate and the desk read it on the line
    expect(lineOf(opened, cookies)).toMatchObject({
      expiredOnArrival: true,
      expiredOnArrivalPcs: 0,
    })
    expect(lineOf(opened, brush)).toMatchObject({ expiredOnArrival: false, expiredOnArrivalPcs: 0 })
    expect(lineOf(counted, cookies)).toMatchObject({
      expiredOnArrival: true,
      expiredOnArrivalPcs: 48,
    })
    expect(lineOf(counted, brush)).toMatchObject({
      expiredOnArrival: false,
      expiredOnArrivalPcs: 0,
    })

    const posted = await post(id)
    const expiredLine = lineOf(posted, cookies)
    expect(expiredLine).toMatchObject({ expiredOnArrival: true, expiredOnArrivalPcs: 48 })
    expect(lineOf(posted, brush)).toMatchObject({ expiredOnArrival: false, expiredOnArrivalPcs: 0 })
    // the posted receipt says it in words, as a gate finding the supplier claim reads
    const finding = posted.discrepancies.find((d) => d.grnLineId === expiredLine?.id)
    expect(finding).toMatchObject({ kind: 'damaged', qtyPcs: 48 })
    expect(finding?.note).toMatch(/^Expired on arrival: 48 pc of batch EXP-/)

    // the stock: the bin holds the 48, the godown none of them; the in-date line went to the godown
    const expiredLot = expiredLine?.lotId ?? ''
    const brushLot = lineOf(posted, brush)?.lotId ?? ''
    const at = async (lotId: string, locationId: string) =>
      (
        await db
          .select({ onHand: stockBalances.onHand })
          .from(stockBalances)
          .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, locationId)))
      )[0]?.onHand ?? null
    expect(await at(expiredLot, bin)).toBe(48)
    expect(await at(expiredLot, godown)).toBeNull()
    expect(await at(brushLot, godown)).toBe(96)
    const rows = (
      await db.execute(
        sql`select l.reason::text as reason, loc.kind::text as kind, l.qty_delta::int as qty, l.note
              from stock_ledger l join locations loc on loc.id = l.location_id
             where l.tenant_id = ${tenantId} and l.lot_id = ${expiredLot}`,
      )
    ).rows
    expect(rows).toEqual([{ reason: 'grn', kind: 'damaged', qty: 48, note: 'expired on arrival' }])

    // nobody is offered the expired batch
    const offered = await call<{ items: { lotId: string }[] }>(
      app,
      owner,
      'GET',
      '/inventory/sellable',
      {
        variantId: cookies,
      },
    )
    expect(offered.body.items).toEqual([])

    // the purchase is unchanged: the whole bill is owed, and the lot is costed like any other
    const ap = (
      await db.execute(
        sql`select jl.amount_paise::bigint::int as amount
              from journal_lines jl join accounts a on a.id = jl.account_id
              join journal_entries je on je.id = jl.entry_id
             where je.tenant_id = ${tenantId} and je.ref_id = ${billId} and a.code = 'AP'`,
      )
    ).rows as { amount: number }[]
    expect(ap).toEqual([{ amount: -totalPaise }])
    const cost = await db
      .select({ lotId: tenantProductCosts.lotId })
      .from(tenantProductCosts)
      .where(
        and(eq(tenantProductCosts.tenantId, tenantId), eq(tenantProductCosts.lotId, expiredLot)),
      )
    expect(cost).toHaveLength(1)

    // the gate reads the same receipt the same way (the finding is a `damaged` one, which a blind count sees)
    const atGate = await call<{ item: Grn }>(app, store, 'GET', `/procurement/grns/${id}`)
    expect(lineOf(atGate.body.item, cookies)).toMatchObject({
      expiredOnArrival: true,
      expiredOnArrivalPcs: 48,
    })
    expect(atGate.body.item.discrepancies.map((d) => [d.kind, d.qtyPcs])).toEqual([['damaged', 48]])
  })
})
