import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  featureFlags,
  hsnRates,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenantProducts,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { loadOut } from '../../testing/load-out.js'
import { BillingModule } from '../billing/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** A 1×1 PNG: the photo of the signed bill a phone with no signal carries inside its delivery op (DOS-056). */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** The one sentence every door answers for cash or a cheque that reaches the office after its trip settled (DOS-169 (l)). */
const TRIP_SETTLED =
  'this trip has already settled; hand this money to the cashier and record it at the office, not on the trip'

interface Cockpit {
  tripState: string
  cashCollectedPaise: number
  upiCollectedPaise: number
  chequeCollectedPaise: number
  expensesPaise: number
  expectedCashPaise: number
  collectionsCount: number
  stopsDelivered: number
  expectedVanStock: { lotId: string; expectedPcs: number }[]
  settlement: { expectedCashPaise: number; handedOverCashPaise: number } | null
}
interface SettleReply {
  tripState?: string
  item?: { hasVariance: boolean; cashVariancePaise: number; chequeCollectedPaise: number }
  message?: string
  data?: { code?: string; approvalId?: string; cashVariancePaise?: number }
}
interface UploadReply {
  accepted: number
  replayed: number
  rejected: { opId: string; code: string; messageEn: string }[]
}
interface TripReply {
  item: {
    state: string
    expectedCashPaise: number
    settlement: { chequeCollectedPaise: number } | null
  }
}
interface Bill {
  orderId: string
  invoiceId: string
  totalPaise: number
  lineId: string
  qtyPcs: number
}

/**
 * Day-end counts every trip payment however it reached the office (QA DOS-169, DOS-170). The settlement sums the
 * trip's own receipts per mode — the doorstep collection, the phone's offline `receipts` op, the van sale, the desk —
 * net of reversals, never `collections` rows; a settled trip keeps the figures it settled with; an undo after the
 * settlement takes the money from the office; and a receipt racing the count is either counted or refused, never
 * left in the van's account behind a closed trip. Every money trip but one is the DOS-112 shape (no stops, van
 * sales on, receipts on account); the one with a bill is loaded out on a confirmed load sheet before it departs, so
 * these specs survive DOS-172's depart gate (design Step 5, amendment (k)).
 */
describeDb('delivery — day-end counts every trip payment (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `6${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }

  /** The shop with a bill delivered at the door: on credit, so the doorstep carries its photo. */
  const billedShopId = uuidv7()
  /** The shop that pays on account: it has no bill, so the receipts of the other trips land unallocated. */
  const accountShopId = uuidv7()
  const variantId = uuidv7()
  const shopLat = 19.2437
  const shopLng = 73.1355
  const deviceId = `sm-phone-${run}`

  let app: NestFastifyApplication
  let chequeNo = 560_000

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `sm-${run}`, legalName: 'Day End Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91976${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91976${run}2`, name: 'Manager desk' },
      { id: accountantId, phone: `+91976${run}3`, name: 'Accountant desk' },
      { id: packerId, phone: `+91976${run}4`, name: 'Packer' },
      { id: repId, phone: `+91976${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91976${run}6`, name: 'Driver' },
      { id: shopUserId, phone: `+91976${run}7`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker sm ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Namkeen 50 g',
      netQty: 50,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 1000,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91977${run}1`,
      userId: shopUserId,
      shopName: `Day End Shop ${run}`,
    })
    await db.insert(retailers).values([
      {
        id: billedShopId,
        tenantId,
        identityId,
        code: `SM-B-${run}`,
        name: `Day End Shop ${run}`,
        ownerName: 'Shop owner',
        phone: `+91977${run}1`,
        stateCode: '27',
        gstRegType: 'regular',
        gstin: '27AAXPT9021Q1ZQ',
        creditDays: 15,
        lat: shopLat,
        lng: shopLng,
      },
      {
        id: accountShopId,
        tenantId,
        code: `SM-A-${run}`,
        name: `On Account Shop ${run}`,
        phone: `+91977${run}2`,
        stateCode: '27',
        tier: 'C',
        creditDays: 15,
      },
    ])
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: billedShopId,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 1000 })

    app = await bootTestApp([
      DeliveryModule,
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      FilesModule,
      SyncModule,
    ])

    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `sm-consent-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status).toBe(200)

    const godown =
      (
        await db
          .select()
          .from(locations)
          .where(sql`${locations.tenantId} = ${tenantId}`)
      ).find((l) => l.kind === 'warehouse')?.id ?? ''
    const inventory = app.get(InventoryService)
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, async (tx: Db) => {
        const lot = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `SM-${run}`,
          mrpPaise: 1000,
          expiryDate: '2028-01-31',
        })
        await inventory.post(tx, [
          {
            lotId: lot.lot.id,
            locationId: godown,
            qtyDelta: 1_000,
            reason: 'opening',
            idempotencyKey: `sm-open-${run}`,
          },
        ])
      }),
    )
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // helpers: trips, the phone, the desk and the books

  const tripDate = (daysAhead: number): string =>
    new Date(Date.parse(businessDate().date) + daysAhead * 86_400_000).toISOString().slice(0, 10)

  const vehicle = async (
    label: string,
    plate: string,
  ): Promise<{ id: string; locationId: string }> => {
    const id = uuidv7()
    const res = await call<{ item: { id: string; locationId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/vehicles',
      {
        idempotencyKey: `${label}-vehicle-${run}`,
        id,
        regNo: `MH-04-${plate}-${run.slice(-4)}`,
        name: `Tempo ${plate}`,
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item
  }

  const move = async (label: string, actor: Actor, tripId: string, step: string): Promise<void> => {
    const moved = await call(app, actor, 'POST', `/delivery/trips/${tripId}/${step}`, {
      idempotencyKey: `${label}-${step}-${run}`,
    })
    expect(moved.status, `${step} → ${JSON.stringify(moved.body)}`).toBe(200)
  }

  /**
   * A trip with no stops and van sales on, planned → loading → active (the DOS-112 `closingTrip` shape). Each trip
   * has a vehicle and a date of its own, so the one-open-trip-per-driver-per-date rule never meets another test's.
   */
  const onTheRoad = async (
    label: string,
    daysAhead: number,
    plate: string,
    openingCashPaise: number,
  ): Promise<string> => {
    const van = await vehicle(label, plate)
    const tripId = uuidv7()
    const planned = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `${label}-trip-${run}`,
      id: tripId,
      tripDate: tripDate(daysAhead),
      vehicleId: van.id,
      driverId,
      vanSalesEnabled: true,
      openingCashPaise,
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    await move(label, driver, tripId, 'start-loading')
    await move(label, driver, tripId, 'depart')
    return tripId
  }

  /** An order confirmed through the real aggregate and packed by the godown, so a real bill exists. */
  const billedOrder = async (tag: string): Promise<Bill> => {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `sm-order-${tag}-${run}`,
      id: orderId,
      retailerId: billedShopId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `sm-submit-${tag}-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    const packed = await call<{ invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `sm-pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const bill = await call<{ item: { lines: { id: string }[]; totalPaise: number } }>(
      app,
      manager,
      'GET',
      `/invoices/${invoiceId}`,
    )
    expect(bill.status).toBe(200)
    return {
      orderId,
      invoiceId,
      totalPaise: bill.body.item.totalPaise,
      lineId: bill.body.item.lines[0]?.id ?? '',
      qtyPcs: 12,
    }
  }

  /**
   * A trip carrying one bill, loaded out the way DOS-172 Rule C wants before it departs (design Step 5): the godown
   * starts loading, the manager builds the load sheet for the trip with the bill's order and confirms it (a manager's
   * confirm is its own approval), then the crew departs. The sheet itself goes through the shared `loadOut` helper,
   * the one load-out every spec uses (Fable's merge ruling of 2026-09-19: one helper, not two).
   */
  const loadedOutTrip = async (
    label: string,
    daysAhead: number,
    plate: string,
    openingCashPaise: number,
    stopId: string,
    bill: Bill,
  ): Promise<string> => {
    const van = await vehicle(label, plate)
    const tripId = uuidv7()
    const planned = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `${label}-trip-${run}`,
      id: tripId,
      tripDate: tripDate(daysAhead),
      vehicleId: van.id,
      driverId,
      openingCashPaise,
      stops: [{ id: stopId, sequence: 1, retailerId: billedShopId, invoiceIds: [bill.invoiceId] }],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    await move(label, packer, tripId, 'start-loading')
    const counted = await loadOut(
      app,
      { godown: manager },
      { tripId, orderIds: [bill.orderId], tag: `${label}-${run}` },
    )
    expect(counted.status).toBe('confirmed')
    expect(counted.dispatched).toEqual([bill.orderId])
    await move(label, driver, tripId, 'depart')
    return tripId
  }

  /** The driver's online doorstep collection (collect.tsx with a signal): a receipt and its `collections` row. */
  const collect = async (label: string, tripId: string, amountPaise: number): Promise<string> => {
    const receiptId = uuidv7()
    const res = await call(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `${label}-collect-${receiptId}`,
      id: uuidv7(),
      receiptId,
      tripId,
      retailerId: accountShopId,
      mode: 'cash',
      amountPaise,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return receiptId
  }

  /** The `receipts` op a doorstep payment queues with no signal (queue.ts useQueueReceipt), as the engine sends it. */
  const receiptOp = (
    tripId: string,
    mode: 'cash' | 'upi' | 'cheque',
    amountPaise: number,
    book: string,
    retailerId: string = accountShopId,
  ) => {
    const at = new Date().toISOString()
    chequeNo += 1
    return {
      opId: uuidv7(),
      op: 'PUT',
      table: 'receipts',
      id: uuidv7(),
      data: {
        retailer_id: retailerId,
        trip_id: tripId,
        mode,
        amount_paise: amountPaise,
        received_at: at,
        received_by: driverId,
        device_id: deviceId,
        status: 'collected',
        client_receipt_no: `${book}-${run}`,
        ...(mode === 'upi' ? { reference: `UTR${book}${run}` } : {}),
        ...(mode === 'cheque'
          ? {
              reference: String(chequeNo),
              bank_name: 'Bank of Maharashtra',
              cheque_date: businessDate().date,
            }
          : {}),
      },
      clientTime: at,
    }
  }

  const upload = (ops: unknown[]) =>
    call<UploadReply>(app, driver, 'POST', '/sync/upload', { protocol: 1, deviceId, ops })

  /** One offline receipt that reaches the office while its trip is still open; it lands. Returns the receipt id. */
  const offlineReceipt = async (
    tripId: string,
    mode: 'cash' | 'upi' | 'cheque',
    amountPaise: number,
    book: string,
  ): Promise<string> => {
    const op = receiptOp(tripId, mode, amountPaise, book)
    const res = await upload([op])
    expect(res.status).toBe(200)
    expect(res.body, JSON.stringify(res.body)).toMatchObject({ accepted: 1, rejected: [] })
    return op.id
  }

  const preview = async (tripId: string): Promise<Cockpit> => {
    const res = await call<Cockpit>(app, accountant, 'GET', `/delivery/trips/${tripId}/settlement`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body
  }

  const figuresOf = (c: Cockpit) => ({
    cash: c.cashCollectedPaise,
    upi: c.upiCollectedPaise,
    cheque: c.chequeCollectedPaise,
    expected: c.expectedCashPaise,
    count: c.collectionsCount,
  })

  const tripDetail = async (tripId: string, actor: Actor = manager): Promise<TripReply['item']> => {
    const res = await call<TripReply>(app, actor, 'GET', `/delivery/trips/${tripId}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item
  }

  const settle = (
    actor: Actor,
    tripId: string,
    settlementId: string,
    handedOverCashPaise: number,
    extra: Record<string, unknown> = {},
  ) =>
    call<SettleReply>(app, actor, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `sm-settle-${settlementId}`,
      id: settlementId,
      tripId,
      handedOverCashPaise,
      ...extra,
    })

  const reverse = async (receiptId: string, reversalId: string): Promise<void> => {
    const res = await call(app, accountant, 'POST', `/receipts/${receiptId}/reverse`, {
      idempotencyKey: `sm-reverse-${reversalId}`,
      id: receiptId,
      reversalId,
      reason: 'entered against the wrong shop',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  }

  /** Net per account over the named journal entries; accounts that net to zero are left out. */
  const entryNet = async (
    refs: readonly (readonly [refType: string, refId: string])[],
  ): Promise<Record<string, number>> => {
    const which = sql.join(
      refs.map(([refType, refId]) => sql`(e.ref_type = ${refType} and e.ref_id = ${refId})`),
      sql` or `,
    )
    const rows = (
      await db.execute(sql`
        select a.code, sum(l.amount_paise)::bigint as amount
          from journal_lines l
          join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
          join accounts a on a.id = l.account_id
         where e.tenant_id = ${tenantId} and (${which})
         group by a.code`)
    ).rows as { code: string; amount: string }[]
    return Object.fromEntries(
      rows.map((r) => [r.code, Number(r.amount)] as const).filter(([, amount]) => amount !== 0),
    )
  }

  /**
   * Net per account over everything the trip's money posted: every receipt carrying the trip and the mirror of any
   * of them that was undone, and the trip's settlement. CASH_VAN over this is zero once the trip has handed over.
   */
  const tripNet = async (tripId: string): Promise<Record<string, number>> => {
    const rows = (
      await db.execute(sql`
        with trip_receipts as (
          select r.id from receipts r
           where r.tenant_id = ${tenantId}
             and (r.trip_id = ${tripId}
                  or r.reverses_receipt_id in (select o.id from receipts o
                                                where o.tenant_id = ${tenantId} and o.trip_id = ${tripId})))
        select a.code, sum(l.amount_paise)::bigint as amount
          from journal_lines l
          join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
          join accounts a on a.id = l.account_id
         where e.tenant_id = ${tenantId}
           and ((e.ref_type in ('receipt', 'receipt_reversal') and e.ref_id in (select id from trip_receipts))
                or (e.ref_type = 'trip_settlement' and e.ref_id in (select s.id from trip_settlements s
                                                                    where s.tenant_id = ${tenantId} and s.trip_id = ${tripId})))
         group by a.code`)
    ).rows as { code: string; amount: string }[]
    return Object.fromEntries(
      rows.map((r) => [r.code, Number(r.amount)] as const).filter(([, amount]) => amount !== 0),
    )
  }

  /** The desk's trial balance (`GET /receivables/accounts`) for one account. */
  const accountBalance = async (code: string): Promise<number> => {
    const res = await call<{ items: { code: string; balancePaise: number }[] }>(
      app,
      accountant,
      'GET',
      '/receivables/accounts',
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.items.find((a) => a.code === code)?.balancePaise ?? 0
  }

  const approvalsOf = async (tripId: string): Promise<{ id: string; status: string }[]> =>
    (
      await db.execute(sql`
        select id, status::text as status from approvals
         where tenant_id = ${tenantId} and kind = 'trip_settlement' and entity_id = ${tripId}
         order by id`)
    ).rows as { id: string; status: string }[]

  const rowsOf = async (table: 'receipts' | 'collections', tripId: string): Promise<number> => {
    const [row] = (
      await db.execute(
        sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${tenantId} and trip_id = ${tripId}`,
      )
    ).rows as { n: number }[]
    return row?.n ?? 0
  }

  const receiptExists = async (id: string): Promise<boolean> =>
    (await db.execute(sql`select 1 from receipts where tenant_id = ${tenantId} and id = ${id}`))
      .rows.length > 0

  /** Backends of THIS database waiting on a heavyweight lock right now (autocommit: a fresh snapshot per read). */
  const lockWaiters = async (): Promise<number> => {
    const res = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )
    return res.rows[0]?.n ?? 0
  }

  const until = async (what: string, ready: () => Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 15_000
    while (!(await ready())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  /** A third connection runs `statement` inside a transaction and holds what it locked until the returned function commits (safe to call twice). */
  const hold = async (
    statement: string,
    params: unknown[],
  ): Promise<{ rowCount: number; release: () => Promise<void> }> => {
    const client = await pool.connect()
    let open = true
    await client.query('begin')
    const res = await client.query(statement, params)
    return {
      rowCount: res.rowCount ?? 0,
      release: async () => {
        if (!open) return
        open = false
        try {
          await client.query('commit')
        } finally {
          client.release()
        }
      },
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-169: the count

  it('DOS-169 settlement counts a doorstep receipt uploaded offline exactly like an online collection — cash, UPI and cheque', async () => {
    const floatPaise = 50_000
    const onlineCashPaise = 20_000
    const offlineCashPaise = 30_000
    const upiPaise = 15_000
    const chequePaise = 12_000
    const tripId = await onTheRoad('sm-t5', 1, 'MA', floatPaise)
    await collect('sm-t5', tripId, onlineCashPaise)
    await offlineReceipt(tripId, 'cash', offlineCashPaise, 'T5C')
    await offlineReceipt(tripId, 'upi', upiPaise, 'T5U')
    await offlineReceipt(tripId, 'cheque', chequePaise, 'T5Q')
    expect(await rowsOf('collections', tripId)).toBe(1)
    await move('sm-t5', driver, tripId, 'return')

    const cash = onlineCashPaise + offlineCashPaise
    expect(figuresOf(await preview(tripId))).toEqual({
      cash,
      upi: upiPaise,
      cheque: chequePaise,
      expected: floatPaise + cash,
      count: 4,
    })
    // the trip's own screen tells the desk and the crew the same figure
    expect((await tripDetail(tripId)).expectedCashPaise).toBe(floatPaise + cash)
    expect((await tripDetail(tripId, driver)).expectedCashPaise).toBe(floatPaise + cash)
    // the godown reads the trip but never the money taken on it (the `collections` rule): the float, as always
    expect((await tripDetail(tripId, packer)).expectedCashPaise).toBe(floatPaise)

    const settlementId = uuidv7()
    const settled = await settle(accountant, tripId, settlementId, floatPaise + cash)
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(settled.body.tripState).toBe('settled')
    expect(settled.body.item?.hasVariance).toBe(false)
    expect(settled.body.item?.cashVariancePaise).toBe(0)
    expect(settled.body.item?.chequeCollectedPaise).toBe(chequePaise)
    expect(await approvalsOf(tripId)).toEqual([])
    // Cr CASH_VAN is exactly what the four receipts debited to it, and nothing is cash over or short
    expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
      CASH: cash,
      CASH_VAN: -cash,
    })
    expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
    const closed = await tripDetail(tripId)
    expect(closed.expectedCashPaise).toBe(floatPaise + cash)
    expect(closed.settlement?.chequeCollectedPaise).toBe(chequePaise)
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-175: the upload door refuses a trip this distributor does not hold, and stays 2xx doing it

  it('DOS-175 an uploaded receipts op naming an unknown trip is a 2xx rejection trip_not_found and writes nothing', async () => {
    const ghostTripId = uuidv7()
    const op = receiptOp(ghostTripId, 'cash', 6_000, 'T175')
    const res = await upload([op])
    // ADR 0007: the upload door never answers 4xx — a refusal is a recorded rejection with its own money code
    expect(res.status).toBe(200)
    expect(res.body.accepted, JSON.stringify(res.body)).toBe(0)
    expect(res.body.rejected.map((r) => [r.opId, r.code])).toEqual([[op.opId, 'trip_not_found']])
    expect(await receiptExists(op.id)).toBe(false)
    const errors = (
      await db.execute(
        sql`select code from sync_errors where tenant_id = ${tenantId} and op_id = ${op.opId}`,
      )
    ).rows as { code: string }[]
    expect(errors.map((e) => e.code)).toEqual(['trip_not_found'])
  }, 60_000)

  it('DOS-169 fully offline doorstep (stop PATCHes, delivery with inline proof, receipt) in one batch settles with a CASH_VAN line', async () => {
    const floatPaise = 30_000
    const bill = await billedOrder('t5b')
    const stopId = uuidv7()
    const tripId = await loadedOutTrip('sm-t5b', 2, 'MB', floatPaise, stopId, bill)
    const [planned] = (
      await db.execute(sql`
        select id from deliveries
         where tenant_id = ${tenantId} and stop_id = ${stopId} and invoice_id = ${bill.invoiceId}`)
    ).rows as { id: string }[]
    expect(planned).toBeDefined()

    // the order the delivery app queues a doorstep with no signal: the stop moves, the delivery with its photo
    // inline, then the cash (S-76 skeptic's batch)
    const at = new Date().toISOString()
    const receipt = receiptOp(tripId, 'cash', bill.totalPaise, 'T5B', billedShopId)
    const batch = [
      {
        opId: uuidv7(),
        op: 'PATCH',
        table: 'trip_stops',
        id: stopId,
        data: { state: 'started', occurred_at: at, device_id: deviceId },
        clientTime: at,
      },
      {
        opId: uuidv7(),
        op: 'PATCH',
        table: 'trip_stops',
        id: stopId,
        data: {
          state: 'arrived',
          occurred_at: at,
          device_id: deviceId,
          lat: shopLat,
          lng: shopLng,
        },
        clientTime: at,
      },
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'deliveries',
        id: planned?.id ?? uuidv7(),
        data: {
          trip_id: tripId,
          stop_id: stopId,
          invoice_id: bill.invoiceId,
          delivered_at: at,
          device_id: deviceId,
          receiver_name: 'Shop owner',
          lines: [
            {
              id: uuidv7(),
              invoice_line_id: bill.lineId,
              delivered_qty_pcs: bill.qtyPcs,
              returned_qty_pcs: 0,
              returned_saleable: true,
            },
          ],
          pod: [
            {
              id: uuidv7(),
              kind: 'photo',
              inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
              captured_at: at,
            },
          ],
        },
        clientTime: at,
      },
      receipt,
    ]
    const sent = await upload(batch)
    expect(sent.status).toBe(200)
    expect(sent.body, JSON.stringify(sent.body)).toMatchObject({ accepted: 4, rejected: [] })
    // the doorstep wrote a receipt carrying the trip and no `collections` row
    expect(await rowsOf('receipts', tripId)).toBe(1)
    expect(await rowsOf('collections', tripId)).toBe(0)
    await move('sm-t5b', driver, tripId, 'return')

    const cockpit = await preview(tripId)
    const settlementId = uuidv7()
    // The owner closes it, the way the probe did. With the doorstep counted there is no variance, so
    // `acceptVariance` changes nothing and the trip settles green; before DOS-169 it booked the shop's cash as cash
    // over and left it in the van's account.
    const settled = await settle(owner, tripId, settlementId, floatPaise + bill.totalPaise, {
      acceptVariance: true,
      counted: cockpit.expectedVanStock.map((l) => ({ lotId: l.lotId, countedPcs: l.expectedPcs })),
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
      CASH: bill.totalPaise,
      CASH_VAN: -bill.totalPaise,
    })
    expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
    expect(settled.body.tripState).toBe('settled')
    expect(settled.body.item?.hasVariance).toBe(false)
    expect(figuresOf(cockpit)).toEqual({
      cash: bill.totalPaise,
      upi: 0,
      cheque: 0,
      expected: floatPaise + bill.totalPaise,
      count: 1,
    })
    expect(cockpit.stopsDelivered).toBe(1)
  }, 120_000)

  it('DOS-169 a crew that keeps offline cash is short at settlement', async () => {
    const floatPaise = 40_000
    const keptPaise = 30_000
    const tripId = await onTheRoad('sm-t6', 3, 'MC', floatPaise)
    await offlineReceipt(tripId, 'cash', keptPaise, 'T6C')
    await move('sm-t6', driver, tripId, 'return')

    // the crew hands over the float alone
    const refused = await settle(accountant, tripId, uuidv7(), floatPaise)
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data?.code).toBe('settlement_needs_owner')
    expect(refused.body.data?.cashVariancePaise).toBe(-keptPaise)
    const approvalId = refused.body.data?.approvalId
    expect(approvalId).toBeTruthy()
    const retried = await settle(manager, tripId, uuidv7(), floatPaise)
    expect(retried.status, JSON.stringify(retried.body)).toBe(409)
    expect(retried.body.data?.code).toBe('settlement_needs_owner')
    expect(retried.body.data?.approvalId).toBe(approvalId)
    expect(await approvalsOf(tripId)).toEqual([{ id: approvalId, status: 'pending' }])

    // the owner books the shortage: the van's account gives up the cash the crew took, CASH_SHORT carries it
    const settlementId = uuidv7()
    const accepted = await settle(owner, tripId, settlementId, floatPaise, {
      acceptVariance: true,
      note: 'the crew kept the cash',
    })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.tripState).toBe('settled_with_variance')
    expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
      CASH_SHORT: keptPaise,
      CASH_VAN: -keptPaise,
    })
    expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
    expect(await approvalsOf(tripId)).toEqual([{ id: approvalId, status: 'approved' }])
  }, 120_000)

  it('DOS-169 a trip cash receipt reversed before settlement is neither counted nor credited twice', async () => {
    const floatPaise = 40_000
    const cashPaise = 30_000
    const tripId = await onTheRoad('sm-t7', 4, 'MD', floatPaise)
    const receiptId = await collect('sm-t7', tripId, cashPaise)
    await move('sm-t7', driver, tripId, 'return')
    const reversalId = uuidv7()
    await reverse(receiptId, reversalId)
    // the trip has not handed over yet, so the undo takes the cash back out of the van's account
    expect(await entryNet([['receipt_reversal', reversalId]])).toEqual({
      AR: cashPaise,
      CASH_VAN: -cashPaise,
    })

    expect(figuresOf(await preview(tripId))).toEqual({
      cash: 0,
      upi: 0,
      cheque: 0,
      expected: floatPaise,
      count: 0,
    })
    expect((await tripDetail(tripId)).expectedCashPaise).toBe(floatPaise)
    const settlementId = uuidv7()
    const settled = await settle(accountant, tripId, settlementId, floatPaise)
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(settled.body.tripState).toBe('settled')
    expect(settled.body.item?.hasVariance).toBe(false)
    // only the float came back, so the settlement posts nothing, least of all a second CASH_VAN credit
    expect(await entryNet([['trip_settlement', settlementId]])).toEqual({})
    expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
  }, 120_000)

  it('DOS-169 the cockpit of a settled trip keeps its settled figures after a later reversal', async () => {
    const floatPaise = 40_000
    const cashPaise = 30_000
    const tripId = await onTheRoad('sm-t8', 5, 'ME', floatPaise)
    const receiptId = await offlineReceipt(tripId, 'cash', cashPaise, 'T8C')
    await move('sm-t8', driver, tripId, 'return')
    const settled = await settle(accountant, tripId, uuidv7(), floatPaise + cashPaise)
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(settled.body.tripState).toBe('settled')
    expect(figuresOf(await preview(tripId))).toEqual({
      cash: cashPaise,
      upi: 0,
      cheque: 0,
      expected: floatPaise + cashPaise,
      count: 1,
    })

    await reverse(receiptId, uuidv7())
    const later = await preview(tripId)
    // cash, UPI, expenses and expected cash are what the trip settled with; nothing recounts a closed trip
    expect(later.cashCollectedPaise).toBe(cashPaise)
    expect(later.upiCollectedPaise).toBe(0)
    expect(later.expensesPaise).toBe(0)
    expect(later.expectedCashPaise).toBe(floatPaise + cashPaise)
    expect(later.settlement).toMatchObject({
      expectedCashPaise: floatPaise + cashPaise,
      handedOverCashPaise: floatPaise + cashPaise,
    })
    // the cheque figure and the count stay live: the undone receipt and its mirror drop out
    expect(later.chequeCollectedPaise).toBe(0)
    expect(later.collectionsCount).toBe(0)
    expect((await tripDetail(tripId)).expectedCashPaise).toBe(floatPaise + cashPaise)
  }, 120_000)

  /*
   * THE STATE RIDES WITH THE FIGURES (DOS-169 (m)).
   *
   * D8 branches the hand-over on `figures.tripState` and on nothing else — the phone's own trip row is
   * local-first and still reads `closing` for a pull after the desk settles, and branching on it added the
   * phone's held cash on top of a hand-over the office had already closed. That fix is only as true as this
   * field: `settlementPreview` has to answer with the trip's LIVE state, not the state it was asked about and
   * not the state frozen into the settlement row. Nothing pinned it — every other assertion in this file reads
   * the SETTLE reply's `tripState`, which is a different code path (`settle` returns `next.state`, the cockpit
   * returns `trip.state`) — so the device could have branched on a field the server quietly stopped moving and
   * every gate would still be green.
   */
  it('DOS-169 the settlement preview answers with the trip live state, the one D8 branches the hand-over on', async () => {
    const floatPaise = 40_000
    const cashPaise = 30_000
    const tripId = await onTheRoad('sm-t8s', 12, 'MM', floatPaise)
    expect((await preview(tripId)).tripState).toBe('active')

    await offlineReceipt(tripId, 'cash', cashPaise, 'T8SC')
    await move('sm-t8s', driver, tripId, 'return')
    // the window the blocker lived in: the van is back, the office has not settled, D8 must still add held cash
    expect((await preview(tripId)).tripState).toBe('closing')

    const settled = await settle(accountant, tripId, uuidv7(), floatPaise + cashPaise)
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(settled.body.tripState).toBe('settled')
    // the preview flips in the same breath, so a phone still showing `closing` reads `settled` off the figures
    const after = await preview(tripId)
    expect(after.tripState).toBe('settled')
    expect(after.expectedCashPaise).toBe(floatPaise + cashPaise)
  }, 120_000)

  it('DOS-169 the settlement preview says settled_with_variance too, so D8 adds nothing to a short close', async () => {
    const floatPaise = 40_000
    const keptPaise = 30_000
    const tripId = await onTheRoad('sm-t8v', 13, 'MN', floatPaise)
    await offlineReceipt(tripId, 'cash', keptPaise, 'T8VC')
    await move('sm-t8v', driver, tripId, 'return')

    const refused = await settle(accountant, tripId, uuidv7(), floatPaise)
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data?.code).toBe('settlement_needs_owner')
    const accepted = await settle(owner, tripId, uuidv7(), floatPaise, {
      acceptVariance: true,
      note: 'the crew kept the cash',
    })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.tripState).toBe('settled_with_variance')
    // `dayEndCash` treats both closed states alike; the preview has to name this one as plainly as the other
    expect((await preview(tripId)).tripState).toBe('settled_with_variance')
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-170: an undo after the settlement

  it('DOS-170 reversing a trip cash receipt after its trip settled credits CASH, not CASH_VAN', async () => {
    const floatPaise = 40_000
    const cashPaise = 30_000

    // settled: the settlement moved the cash to the office, so the undo takes it from there
    {
      // the desk's trial balance, whatever other crews still hold: this trip's cash leaves CASH_VAN where it was
      const vanOnTheBooks = await accountBalance('CASH_VAN')
      const tripId = await onTheRoad('sm-t9s', 6, 'MF', floatPaise)
      const receiptId = await collect('sm-t9s', tripId, cashPaise)
      await move('sm-t9s', driver, tripId, 'return')
      const settled = await settle(accountant, tripId, uuidv7(), floatPaise + cashPaise)
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect(settled.body.tripState).toBe('settled')
      const reversalId = uuidv7()
      await reverse(receiptId, reversalId)
      expect(await entryNet([['receipt_reversal', reversalId]])).toEqual({
        AR: cashPaise,
        CASH: -cashPaise,
      })
      expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
      expect(await accountBalance('CASH_VAN')).toBe(vanOnTheBooks)
    }

    // settled_with_variance: the owner accepted a short hand-over, and the cash is just as much the office's
    {
      const vanOnTheBooks = await accountBalance('CASH_VAN')
      const tripId = await onTheRoad('sm-t9v', 7, 'MG', floatPaise)
      const receiptId = await collect('sm-t9v', tripId, cashPaise)
      await move('sm-t9v', driver, tripId, 'return')
      const settled = await settle(owner, tripId, uuidv7(), floatPaise, {
        acceptVariance: true,
        note: 'short at the count',
      })
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect(settled.body.tripState).toBe('settled_with_variance')
      const reversalId = uuidv7()
      await reverse(receiptId, reversalId)
      expect(await entryNet([['receipt_reversal', reversalId]])).toEqual({
        AR: cashPaise,
        CASH: -cashPaise,
      })
      expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
      expect(await accountBalance('CASH_VAN')).toBe(vanOnTheBooks)
    }

    // still on the road: the cash is with the crew, so the undo takes it out of the van's account
    {
      const tripId = await onTheRoad('sm-t9a', 8, 'MH', floatPaise)
      const receiptId = await collect('sm-t9a', tripId, cashPaise)
      const reversalId = uuidv7()
      await reverse(receiptId, reversalId)
      expect(await entryNet([['receipt_reversal', reversalId]])).toEqual({
        AR: cashPaise,
        CASH_VAN: -cashPaise,
      })
    }

    // banked after the settlement: the undo takes the money out of the bank
    {
      const tripId = await onTheRoad('sm-t9d', 9, 'MJ', floatPaise)
      const receiptId = await collect('sm-t9d', tripId, cashPaise)
      await move('sm-t9d', driver, tripId, 'return')
      const settled = await settle(accountant, tripId, uuidv7(), floatPaise + cashPaise)
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      const batch = uuidv7()
      const banked = await call(app, accountant, 'POST', '/receipts/deposit', {
        idempotencyKey: `sm-t9d-deposit-${batch}`,
        id: batch,
        receiptIds: [receiptId],
        depositedAt: new Date().toISOString(),
        depositRef: `DEP-T9-${run}`,
      })
      expect(banked.status, JSON.stringify(banked.body)).toBe(200)
      expect(await entryNet([['deposit', batch]])).toEqual({ BANK: cashPaise, CASH: -cashPaise })
      const reversalId = uuidv7()
      await reverse(receiptId, reversalId)
      expect(await entryNet([['receipt_reversal', reversalId]])).toEqual({
        AR: cashPaise,
        BANK: -cashPaise,
      })
    }
  }, 180_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-169: a receipt racing the count

  it('DOS-169 a late receipt cannot slip between the count and the close', async () => {
    const floatPaise = 40_000
    const cashPaise = 30_000

    // Round 1, the interleaving that loses money: the phone's receipt has already taken the trip's money lock and
    // passed its "trip settled?" check when the owner settles, and a third connection holds it at its receipt
    // number, so it has not committed. The settlement must wait for it and count it; it must never close the trip
    // without it and let it land in the van's account afterwards.
    {
      // this distributor's receipt series row exists, so there is a row to hold the receipt at
      const deskId = uuidv7()
      const desk = await call(app, accountant, 'POST', '/receipts', {
        idempotencyKey: `sm-t11-desk-${deskId}`,
        id: deskId,
        retailerId: accountShopId,
        mode: 'cash',
        amountPaise: 1_000,
      })
      expect(desk.status, JSON.stringify(desk.body)).toBe(200)

      const tripId = await onTheRoad('sm-t11a', 10, 'MK', floatPaise)
      await move('sm-t11a', driver, tripId, 'return')
      const op = receiptOp(tripId, 'cash', cashPaise, 'T11A')
      const settlementId = uuidv7()
      const gate = await hold(
        `select 1 from numbering_series where tenant_id = $1 and series_code = 'RCPT' for update`,
        [tenantId],
      )
      expect(gate.rowCount).toBeGreaterThan(0)
      let uploaded: Awaited<ReturnType<typeof upload>>
      let settled: Awaited<ReturnType<typeof settle>>
      try {
        const uploading = upload([op])
        await until('the receipt to wait for its number', async () => (await lockWaiters()) >= 1)
        let finished = 0
        const settling = settle(owner, tripId, settlementId, floatPaise + cashPaise, {
          acceptVariance: true,
        }).finally(() => {
          finished += 1
        })
        await until(
          'the settlement to queue behind the receipt, or to finish without it',
          async () => (await lockWaiters()) + finished >= 2,
        )
        await gate.release()
        ;[uploaded, settled] = await Promise.all([uploading, settling])
      } finally {
        await gate.release()
      }
      expect(uploaded.status).toBe(200)
      expect(uploaded.body, JSON.stringify(uploaded.body)).toMatchObject({
        accepted: 1,
        rejected: [],
      })
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      // the van's account ends at zero: the receipt's debit is the settlement's credit
      expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
      expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
        CASH: cashPaise,
        CASH_VAN: -cashPaise,
      })
      expect(settled.body.tripState).toBe('settled')
      const cockpit = await preview(tripId)
      expect(cockpit.cashCollectedPaise).toBe(cashPaise)
      expect(cockpit.expectedCashPaise).toBe(floatPaise + cashPaise)
    }

    // Round 2, the design's gate: a third connection holds the trip's money lock itself
    // (`trip-money:<tenant>:<trip>`, amendment (b)) while the settlement and a `receipts` PUT both queue on it.
    // Whichever is let in first, the receipt is counted or refused `trip_settled`; it never lands after the count.
    {
      const tripId = await onTheRoad('sm-t11b', 11, 'ML', floatPaise)
      await move('sm-t11b', driver, tripId, 'return')
      const op = receiptOp(tripId, 'cash', cashPaise, 'T11B')
      const settlementId = uuidv7()
      const gate = await hold('select pg_advisory_xact_lock(hashtext($1))', [
        `trip-money:${tenantId}:${tripId}`,
      ])
      let uploaded: Awaited<ReturnType<typeof upload>>
      let settled: Awaited<ReturnType<typeof settle>>
      try {
        const settling = settle(owner, tripId, settlementId, floatPaise + cashPaise, {
          acceptVariance: true,
        })
        const uploading = upload([op])
        await until(
          'the settlement and the receipt to queue on the trip money lock',
          async () => (await lockWaiters()) >= 2,
        )
        await gate.release()
        ;[settled, uploaded] = await Promise.all([settling, uploading])
      } finally {
        await gate.release()
      }
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect(uploaded.status).toBe(200)
      if (uploaded.body.accepted === 1) {
        // the receipt went first, and the settlement counted it
        expect(uploaded.body.rejected).toEqual([])
        expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
          CASH: cashPaise,
          CASH_VAN: -cashPaise,
        })
        expect(settled.body.tripState).toBe('settled')
        expect((await preview(tripId)).cashCollectedPaise).toBe(cashPaise)
      } else {
        // the settlement went first; the receipt then found the trip settled, was refused and wrote nothing
        expect(uploaded.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
          [op.opId, 'trip_settled', TRIP_SETTLED],
        ])
        expect(await receiptExists(op.id)).toBe(false)
        expect(await entryNet([['trip_settlement', settlementId]])).toEqual({
          CASH: cashPaise,
          CASH_SHORT: -cashPaise,
        })
        expect(settled.body.tripState).toBe('settled_with_variance')
      }
      expect((await tripNet(tripId)).CASH_VAN ?? 0).toBe(0)
    }
  }, 120_000)
})
