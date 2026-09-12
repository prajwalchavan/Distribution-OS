import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import {
  beatAssignments,
  beats,
  bootstrapTenant,
  createDb,
  createPool,
  creditNotes,
  invoices,
  journalEntries,
  journalLines,
  memberships,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  users,
  withTenant,
  type ActorRole,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { SyncModule } from '../sync/index.js'
import { ReceivablesModule, ReceivablesService } from './index.js'

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
  const d = new Date(at + offset * 86_400_000)
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

type Receipt = {
  id: string
  receiptNo: string | null
  amountPaise: number
  allocatedPaise: number
  unallocatedPaise: number
  cashDiscountPaise: number
  status: string
  mode: string
  tripId: string | null
}
type Settled = { id: string; invoiceNo: string | null; state: string; openPaise: number }
type Outstanding = {
  retailerId: string
  outstandingPaise: number
  overduePaise: number
  unallocatedCreditPaise: number
  openBills: number
  buckets: Record<string, number>
}
type ReceiptReply = {
  item: Receipt
  allocations: { id: string; invoiceId: string; amountPaise: number }[]
  invoices: Settled[]
  cashDiscountPaise: number
  unallocatedPaise: number
  outstanding: Outstanding
}
type LedgerReply = {
  openingPaise: number
  closingPaise: number
  items: {
    kind: string
    refId: string
    debitPaise: number
    creditPaise: number
    balancePaise: number
  }[]
  nextCursor: string | null
}
type OpenBillReply = { id: string; invoiceNo: string | null; totalPaise: number; openPaise: number }
/** `receivables.payments.initiate`'s reply, as far as the payment-intent tests read it. */
type PaymentIntentReply = {
  retailerId: string
  amountPaise: number
  upiQrPayload: string | null
  upiIntentUrl: string | null
  payeeVpa: string | null
  payeeName: string | null
  paymentRef: string
  bills: OpenBillReply[]
}

describeDb('receivables (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const fy = financialYear()

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const crewId = uuidv7()
  const storeId = uuidv7()
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const shopA: Actor = { tenantId, actorId: shopUserA, role: 'retailer' }
  const shopB: Actor = { tenantId, actorId: shopUserB, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  // A..I, one shop per story so no test depends on another's leftovers
  const shop = {
    a: uuidv7(), // three bills: FIFO, reversal, the ledger and the credit verdict
    b: uuidv7(), // one bill: the cross-shop refusals and the retailer's own view
    c: uuidv7(), // six bills across the six ageing buckets
    d: uuidv7(), // cash discount realised inside the window
    e: uuidv7(), // the same offer, one day too late
    f: uuidv7(), // the delivery crew at the shop door (CASH_VAN)
    g: uuidv7(), // no bills at all: an over-payment sits on account
    h: uuidv7(), // a cheque that bounces
    i: uuidv7(), // a bad debt the owner writes off
  }
  const otherRetailer = uuidv7()

  const inv = {
    a1: uuidv7(),
    a2: uuidv7(),
    a3: uuidv7(),
    b1: uuidv7(),
    c: [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()],
    d1: uuidv7(),
    e1: uuidv7(),
    f1: uuidv7(),
    h1: uuidv7(),
    i1: uuidv7(),
  }

  let app: NestFastifyApplication
  let receivables: ReceivablesService
  let invoiceCount = 0

  const ctxFor = (role: ActorRole, actorId: string, tid = tenantId): TenantContext => ({
    tenantId: tid,
    actorId,
    actorRole: role,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) => as(ctxFor('owner', ownerId), fn)

  /** A bill the way billing will hand it over, plus the AR entry receivables posts for it. */
  async function seedInvoice(input: {
    id: string
    retailerId: string
    totalPaise: number
    dueOffsetDays: number
  }): Promise<void> {
    invoiceCount += 1
    const invoiceNo = `INV/${run}/${String(invoiceCount).padStart(3, '0')}`
    const dueDate = day(input.dueOffsetDays)
    const invoiceDate = day(input.dueOffsetDays - 15)
    await db.insert(invoices).values({
      id: input.id,
      tenantId,
      invoiceNo,
      seriesCode: 'INV',
      fy,
      invoiceDate,
      retailerId: input.retailerId,
      state: 'issued',
      buyerName: `Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: input.totalPaise,
      taxablePaise: input.totalPaise,
      totalPaise: input.totalPaise,
      dueDate,
      // the issue-time snapshot exactly as billing writes it: the full URI, the bill's ORIGINAL total and
      // its invoice number. A payment intent must never reuse it (DOS-094).
      upiQrPayload: `upi://pay?pa=tarsun%40upi&pn=Tarsun%20Enterprises&am=${(input.totalPaise / 100).toFixed(2)}&tr=${invoiceNo.replace(/\//g, '-')}&cu=INR`,
    })
    await asOwner((tx) =>
      receivables.postInvoiceIssued(tx, {
        id: input.id,
        retailerId: input.retailerId,
        invoiceDate,
        subtotalPaise: input.totalPaise,
        discountPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
        roundOffPaise: 0,
        totalPaise: input.totalPaise,
        dueDate,
      }),
    )
  }

  /** The AR balance the books hold for one shop: the number the rollup must agree with. */
  async function arBalance(retailerId: string): Promise<number> {
    const result = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as ar
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'AR'
         and jl.party_type = 'retailer' and jl.party_id = ${retailerId}`)
    return Number((result.rows[0] as { ar: string }).ar)
  }

  async function invoiceState(id: string): Promise<string> {
    const result = await db.execute(sql`select state::text as state from invoices where id = ${id}`)
    return (result.rows[0] as { state: string }).state
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `rcv-${run}`, legalName: 'Receivables test', stateCode: '27' },
      { id: otherTenantId, slug: `rcv-o-${run}`, legalName: 'Other distributor', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91914${run}1`, name: 'Owner' },
      { id: accountantId, phone: `+91914${run}2`, name: 'Accountant' },
      { id: repId, phone: `+91914${run}3`, name: 'Rep' },
      { id: crewId, phone: `+91914${run}4`, name: 'Crew' },
      { id: storeId, phone: `+91914${run}5`, name: 'Store' },
      { id: shopUserA, phone: `+91914${run}6`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91914${run}7`, name: 'Shopkeeper B' },
      { id: otherOwnerId, phone: `+91914${run}8`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: shopUserB, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)
    // The distributor's own UPI id, the one a shop's payment intent pays into. Only the VPA: the display
    // name stays the one bootstrapTenant seeds from the legal name, which the receipt seller block expects.
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.upiVpa, value: 'tarsun@upi' })
      .onConflictDoNothing()

    const shopRow = (id: string, n: number, extra: Record<string, unknown> = {}) => ({
      id,
      tenantId,
      code: `S${String(n)}-${run}`,
      name: `Shop ${String(n)} ${run}`,
      phone: `+9192${run}${String(n)}`,
      stateCode: '27',
      tier: 'C' as const,
      creditDays: 15,
      ...extra,
    })
    await db.insert(retailers).values([
      // `stop` mode with a ₹500 limit: three open bills of ₹600 put it over, so the verdict breaches
      shopRow(shop.a, 1, { creditMode: 'stop', creditLimitPaise: 50_000, creditLimitBills: 0 }),
      shopRow(shop.b, 2, { creditMode: 'indicate', creditLimitPaise: 0 }),
      // a limit no bill total can reach, so only the bill COUNT can breach it
      shopRow(shop.c, 3, {
        creditMode: 'strict',
        creditLimitPaise: 100_000_000,
        creditLimitBills: 2,
      }),
      shopRow(shop.d, 4),
      shopRow(shop.e, 5),
      shopRow(shop.f, 6),
      shopRow(shop.g, 7),
      shopRow(shop.h, 8),
      shopRow(shop.i, 9),
    ])
    await db.insert(retailers).values({
      id: otherRetailer,
      tenantId: otherTenantId,
      code: `X-${run}`,
      name: `Other shop ${run}`,
      phone: `+9193${run}0`,
      stateCode: '27',
    })

    const identityA = uuidv7()
    const identityB = uuidv7()
    await db.insert(retailerIdentities).values([
      { id: identityA, phone: `+91914${run}6`, userId: shopUserA, shopName: `Shop 1 ${run}` },
      { id: identityB, phone: `+91914${run}7`, userId: shopUserB, shopName: `Shop 2 ${run}` },
    ])
    await db.insert(retailerLinks).values([
      {
        id: uuidv7(),
        tenantId,
        identityId: identityA,
        retailerId: shop.a,
        userId: shopUserA,
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
      {
        id: uuidv7(),
        tenantId,
        identityId: identityB,
        retailerId: shop.b,
        userId: shopUserB,
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
    ])

    app = await bootTestApp([ReceivablesModule, SyncModule])
    receivables = app.get(ReceivablesService)

    await seedInvoice({ id: inv.a1, retailerId: shop.a, totalPaise: 10_000, dueOffsetDays: -25 })
    await seedInvoice({ id: inv.a2, retailerId: shop.a, totalPaise: 20_000, dueOffsetDays: -10 })
    await seedInvoice({ id: inv.a3, retailerId: shop.a, totalPaise: 30_000, dueOffsetDays: 5 })
    await seedInvoice({ id: inv.b1, retailerId: shop.b, totalPaise: 15_000, dueOffsetDays: -3 })
    // 3, 12, 25, 45, 75 and 100 days past due: one bill for each ageing bucket
    const ageing = [-3, -12, -25, -45, -75, -100]
    for (const [i, offset] of ageing.entries()) {
      await seedInvoice({
        id: inv.c[i] ?? uuidv7(),
        retailerId: shop.c,
        totalPaise: 1_000 * (i + 1),
        dueOffsetDays: offset,
      })
    }
    await seedInvoice({ id: inv.d1, retailerId: shop.d, totalPaise: 10_000, dueOffsetDays: 5 })
    await seedInvoice({ id: inv.e1, retailerId: shop.e, totalPaise: 10_000, dueOffsetDays: 5 })
    await seedInvoice({ id: inv.f1, retailerId: shop.f, totalPaise: 5_000, dueOffsetDays: 2 })
    await seedInvoice({ id: inv.h1, retailerId: shop.h, totalPaise: 12_000, dueOffsetDays: 4 })
    await seedInvoice({ id: inv.i1, retailerId: shop.i, totalPaise: 4_000, dueOffsetDays: -60 })

    // "2% if you pay by ..." — one offer still open today, one that closed yesterday
    await asOwner((tx) =>
      receivables.openCashDiscountCondition(tx, {
        id: uuidv7(),
        invoiceId: inv.d1,
        discountBps: 200,
        payBy: day(0),
      }),
    )
    await asOwner((tx) =>
      receivables.openCashDiscountCondition(tx, {
        id: uuidv7(),
        invoiceId: inv.e1,
        discountBps: 200,
        payBy: day(-1),
      }),
    )
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------
  // posting and allocation

  it('posts an invoice and a receipt that both balance to zero', async () => {
    const before = await arBalance(shop.f)
    expect(before).toBe(5_000)
    const res = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-f-${run}`,
      id: uuidv7(),
      retailerId: shop.f,
      mode: 'upi',
      amountPaise: 2_000,
      reference: `UTR${run}`,
    })
    expect(res.status).toBe(200)
    expect(res.body.invoices[0]).toMatchObject({ state: 'partially_paid', openPaise: 3_000 })
    expect(await arBalance(shop.f)).toBe(3_000)
    const unbalanced = await db.execute(sql`
      select count(*)::int as n from (
        select entry_id from journal_lines where tenant_id = ${tenantId}
         group by entry_id having sum(amount_paise) <> 0) bad`)
    expect((unbalanced.rows[0] as { n: number }).n).toBe(0)
  })

  it('allocates FIFO to the oldest due bill first and leaves nothing on account', async () => {
    const res = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-a-${run}`,
      id: uuidv7(),
      retailerId: shop.a,
      mode: 'cash',
      amountPaise: 20_000,
    })
    expect(res.status).toBe(200)
    expect(res.body.unallocatedPaise).toBe(0)
    expect(res.body.allocations).toHaveLength(2)
    expect(await invoiceState(inv.a1)).toBe('paid')
    expect(await invoiceState(inv.a2)).toBe('partially_paid')
    expect(await invoiceState(inv.a3)).toBe('issued')
    // ₹600 of bills, ₹200 paid: the shop owes ₹400 and the books agree
    expect(res.body.outstanding.outstandingPaise).toBe(40_000)
    expect(await arBalance(shop.a)).toBe(40_000)
  })

  it('replays a receipt idempotently and refuses the same key with a different payload', async () => {
    const id = uuidv7()
    const payload = {
      idempotencyKey: `rcpt-replay-${run}`,
      id,
      retailerId: shop.a,
      mode: 'cash',
      amountPaise: 1_000,
    }
    const first = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', payload)
    expect(first.status).toBe(200)
    const replay = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', payload)
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(id)
    const changed = await call(app, accountant, 'POST', '/receipts', {
      ...payload,
      amountPaise: 2_000,
    })
    expect(changed.status).toBe(409)
    const rows = await db.execute(
      sql`select count(*)::int as n from receipts where tenant_id = ${tenantId} and id = ${id}`,
    )
    expect((rows.rows[0] as { n: number }).n).toBe(1)
    const entries = await db.execute(sql`
      select count(*)::int as n from journal_entries
       where tenant_id = ${tenantId} and ref_type = 'receipt' and ref_id = ${id}`)
    expect((entries.rows[0] as { n: number }).n).toBe(1)
  })

  it('leaves an over-payment on account instead of spreading it', async () => {
    const res = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-g-${run}`,
      id: uuidv7(),
      retailerId: shop.g,
      mode: 'cash',
      amountPaise: 7_000,
    })
    expect(res.status).toBe(200)
    expect(res.body.allocations).toHaveLength(0)
    expect(res.body.unallocatedPaise).toBe(7_000)
    expect(res.body.outstanding).toMatchObject({
      outstandingPaise: 0,
      unallocatedCreditPaise: 7_000,
    })
  })

  it('realises the cash discount inside the window and lets it lapse outside', async () => {
    const inside = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-d-${run}`,
      id: uuidv7(),
      retailerId: shop.d,
      mode: 'cash',
      amountPaise: 9_800,
    })
    expect(inside.status).toBe(200)
    expect(inside.body.cashDiscountPaise).toBe(200)
    expect(await invoiceState(inv.d1)).toBe('paid')
    expect(await arBalance(shop.d)).toBe(0)
    const realised = await db.execute(sql`
      select status::text as status, realised_paise from cash_discount_conditions
       where tenant_id = ${tenantId} and invoice_id = ${inv.d1}`)
    expect(realised.rows[0]).toMatchObject({ status: 'realised', realised_paise: '200' })

    const outside = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-e-${run}`,
      id: uuidv7(),
      retailerId: shop.e,
      mode: 'cash',
      amountPaise: 9_800,
    })
    expect(outside.status).toBe(200)
    expect(outside.body.cashDiscountPaise).toBe(0)
    expect(await invoiceState(inv.e1)).toBe('partially_paid')
    expect(await arBalance(shop.e)).toBe(200)
  })

  it('refuses to allocate more than a bill owes, and never across shops', async () => {
    const onAccount = uuidv7()
    const receipt = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-onacct-${run}`,
      id: onAccount,
      retailerId: shop.b,
      mode: 'upi',
      amountPaise: 40_000,
      strategy: 'none',
    })
    expect(receipt.status).toBe(200)
    expect(receipt.body.unallocatedPaise).toBe(40_000)

    const tooMuch = await call(app, accountant, 'POST', '/allocations', {
      idempotencyKey: `alloc-over-${run}`,
      id: uuidv7(),
      sourceType: 'receipt',
      sourceId: onAccount,
      lines: [{ id: uuidv7(), invoiceId: inv.b1, amountPaise: 20_000 }],
    })
    expect(tooMuch.status).toBe(409)

    const otherShop = await call(app, accountant, 'POST', '/allocations', {
      idempotencyKey: `alloc-cross-${run}`,
      id: uuidv7(),
      sourceType: 'receipt',
      sourceId: onAccount,
      lines: [{ id: uuidv7(), invoiceId: inv.a3, amountPaise: 1_000 }],
    })
    expect(otherShop.status).toBe(409)

    const count = await db.execute(sql`
      select count(*)::int as n from allocations
       where tenant_id = ${tenantId} and receipt_id = ${onAccount}`)
    expect((count.rows[0] as { n: number }).n).toBe(0)

    const good = await call<{ items: unknown[]; sourceUnallocatedPaise: number }>(
      app,
      accountant,
      'POST',
      '/allocations',
      {
        idempotencyKey: `alloc-ok-${run}`,
        id: uuidv7(),
        sourceType: 'receipt',
        sourceId: onAccount,
        lines: [{ id: uuidv7(), invoiceId: inv.b1, amountPaise: 15_000 }],
      },
    )
    expect(good.status).toBe(200)
    expect(good.body.sourceUnallocatedPaise).toBe(25_000)
    expect(await invoiceState(inv.b1)).toBe('paid')
  })

  // -------------------------------------------------------------------------------------------------------------
  // the field: a delivery actor may post but never read the book

  it('lets a delivery actor take money at the door into CASH_VAN and never read the journal', async () => {
    const tripId = uuidv7()
    const res = await call<ReceiptReply>(app, crew, 'POST', '/receipts', {
      idempotencyKey: `rcpt-crew-${run}`,
      id: uuidv7(),
      retailerId: shop.f,
      mode: 'cash',
      amountPaise: 3_000,
      tripId,
      deviceId: `crew-phone-${run}`,
      clientReceiptNo: 'R-0001',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.tripId).toBe(tripId)
    expect(await invoiceState(inv.f1)).toBe('paid')
    expect(await arBalance(shop.f)).toBe(0)
    const vanCash = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as van from journal_lines jl
        join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'CASH_VAN'`)
    expect(Number((vanCash.rows[0] as { van: string }).van)).toBe(3_000)

    // RLS, not the guard, is the guarantee: the crew's own transaction sees nothing in the book
    const seen = await as(ctxFor('delivery', crewId), (tx) => tx.select().from(journalEntries))
    expect(seen).toHaveLength(0)
    const lines = await as(ctxFor('delivery', crewId), (tx) => tx.select().from(journalLines))
    expect(lines).toHaveLength(0)
    expect((await call(app, crew, 'GET', '/receivables/journal', { limit: 5 })).status).toBe(403)
  })

  it('dedupes an offline receipt by device and paper receipt number', async () => {
    const deviceId = `crew-phone-${run}`
    const ops = [
      {
        opId: `op-a-${run}`,
        op: 'PUT',
        table: 'receipts',
        id: uuidv7(),
        data: {
          retailer_id: shop.b,
          mode: 'cash',
          amount_paise: 500,
          device_id: deviceId,
          client_receipt_no: 'R-0009',
        },
      },
      {
        opId: `op-b-${run}`,
        op: 'PUT',
        table: 'receipts',
        id: uuidv7(),
        data: {
          retailer_id: shop.b,
          mode: 'cash',
          amount_paise: 500,
          device_id: deviceId,
          client_receipt_no: 'R-0009',
        },
      },
    ]
    const res = await call<{ accepted: number; rejected: unknown[] }>(
      app,
      crew,
      'POST',
      '/sync/upload',
      { protocol: 1, deviceId, ops },
    )
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(2)
    const rows = await db.execute(sql`
      select count(*)::int as n from receipts
       where tenant_id = ${tenantId} and device_id = ${deviceId} and client_receipt_no = 'R-0009'`)
    expect((rows.rows[0] as { n: number }).n).toBe(1)
  })

  it('rejects an edit of a receipt from a device with 2xx and a sync error', async () => {
    const deviceId = `crew-phone-${run}`
    const res = await call<{ rejected: { code: string }[] }>(app, crew, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [
        {
          opId: `op-patch-${run}`,
          op: 'PATCH',
          table: 'receipts',
          id: uuidv7(),
          data: { amount_paise: 1 },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.rejected[0]?.code).toBe('receipt_immutable')
  })

  // -------------------------------------------------------------------------------------------------------------
  // undoing money

  it('reverses a receipt without mutating it and restores the outstanding', async () => {
    const receiptId = uuidv7()
    const created = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-rev-${run}`,
      id: receiptId,
      retailerId: shop.a,
      mode: 'cash',
      amountPaise: 5_000,
    })
    expect(created.status).toBe(200)
    const arAfterPayment = await arBalance(shop.a)

    const res = await call<{
      item: Receipt
      original: Receipt
      outstanding: Outstanding
    }>(app, accountant, 'POST', `/receipts/${receiptId}/reverse`, {
      idempotencyKey: `rev-${run}`,
      id: receiptId,
      reversalId: uuidv7(),
      reason: 'keyed twice',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.amountPaise).toBe(-5_000)
    expect(res.body.original).toMatchObject({
      id: receiptId,
      amountPaise: 5_000,
      status: 'cancelled',
    })
    expect(await arBalance(shop.a)).toBe(arAfterPayment + 5_000)
    expect(res.body.outstanding.outstandingPaise).toBe(arAfterPayment + 5_000)
    // journal_lines is append-only: even the owner's own transaction cannot edit a posted line
    await expect(
      asOwner((tx) =>
        tx.execute(sql`update journal_lines set amount_paise = 1 where tenant_id = ${tenantId}`),
      ),
    ).rejects.toThrow()
  })

  it('bounces a cheque, restores the outstanding exactly and books the bank charge', async () => {
    const receiptId = uuidv7()
    await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `rcpt-h-${run}`,
      id: receiptId,
      retailerId: shop.h,
      mode: 'cheque',
      amountPaise: 12_000,
      reference: '004411',
      bankName: 'HDFC',
    })
    expect(await invoiceState(inv.h1)).toBe('paid')

    const res = await call<{ original: Receipt; outstanding: Outstanding }>(
      app,
      accountant,
      'POST',
      `/receipts/${receiptId}/bounce`,
      {
        idempotencyKey: `bounce-${run}`,
        id: receiptId,
        reversalId: uuidv7(),
        bouncedAt: new Date().toISOString(),
        reason: 'insufficient funds',
        bankChargesPaise: 35_000,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.original.status).toBe('bounced')
    expect(res.body.outstanding.outstandingPaise).toBe(12_000)
    expect(await arBalance(shop.h)).toBe(12_000)
    expect(await invoiceState(inv.h1)).toBe('issued')
    const charges = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as charges from journal_lines jl
        join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'BANK_CHARGES'`)
    expect(Number((charges.rows[0] as { charges: string }).charges)).toBe(35_000)
  })

  it('writes off a bad debt as the owner (the money desk may; the crew and the rep may not)', async () => {
    // docs/22 2026-09-05: write-offs are the accountant's (MONEY_DESK); a collector at the door is not.
    const refused = await call(app, crew, 'POST', '/receivables/write-offs', {
      idempotencyKey: `wo-refused-${run}`,
      id: uuidv7(),
      invoiceId: inv.i1,
      amountPaise: 4_000,
      reason: 'bad_debt',
    })
    expect(refused.status).toBe(403)
    expect(
      (
        await call(app, accountant, 'POST', '/receivables/write-offs', {
          idempotencyKey: `wo-acct-${run}`,
          id: uuidv7(),
          invoiceId: uuidv7(),
          amountPaise: 1,
          reason: 'bad_debt',
        })
      ).status,
    ).toBe(404) // allowed through the matrix; the made-up invoice is simply not there

    const res = await call<{ item: { amountPaise: number }; invoice: Settled }>(
      app,
      owner,
      'POST',
      '/receivables/write-offs',
      {
        idempotencyKey: `wo-${run}`,
        id: uuidv7(),
        invoiceId: inv.i1,
        amountPaise: 4_000,
        reason: 'bad_debt',
        note: 'shop closed',
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.invoice).toMatchObject({ state: 'written_off', openPaise: 0 })
    expect(await arBalance(shop.i)).toBe(0)
    const bad = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as bad from journal_lines jl
        join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'BAD_DEBTS'`)
    expect(Number((bad.rows[0] as { bad: string }).bad)).toBe(4_000)
  })

  it('refuses a second write-off under an id that already exists with 409, not a 500', async () => {
    // Two desks pressing the same documented example (same client id, different idempotency keys)
    // used to hit the primary key and answer "Internal server error". The id is the client's, so the
    // second one is a conflict, and the books must not move.
    const id = uuidv7()
    const first = await call(app, owner, 'POST', '/receivables/write-offs', {
      idempotencyKey: `wo-dup-a-${run}`,
      id,
      invoiceId: inv.h1,
      amountPaise: 1_000,
      reason: 'bad_debt',
    })
    expect(first.status).toBe(200)
    const before = await arBalance(shop.h)
    const second = await call<{ message: string }>(
      app,
      accountant,
      'POST',
      '/receivables/write-offs',
      {
        idempotencyKey: `wo-dup-b-${run}`,
        id,
        invoiceId: inv.h1,
        amountPaise: 1_000,
        reason: 'bad_debt',
      },
    )
    expect(second.status).toBe(409)
    expect(second.body.message).toContain('already exists')
    expect(await arBalance(shop.h)).toBe(before)
  })

  // -------------------------------------------------------------------------------------------------------------
  // ageing, the rollup and the ledger

  it('rebuilds ageing into the right buckets and keeps the legacy 60+ roll-up honest', async () => {
    const res = await call<{ asOf: string; retailers: number }>(
      app,
      owner,
      'POST',
      '/receivables/ageing/rebuild',
      { idempotencyKey: `ageing-${run}`, id: uuidv7() },
    )
    expect(res.status).toBe(200)
    expect(res.body.retailers).toBe(9)

    const dues = await call<Outstanding & { bills: { bucket: string }[] }>(
      app,
      owner,
      'GET',
      `/receivables/outstanding/${shop.c}`,
      { includeBills: true },
    )
    expect(dues.status).toBe(200)
    // bills of ₹10, ₹20, ₹30, ₹40, ₹50 and ₹60 due 3, 12, 25, 45, 75 and 100 days ago
    expect(dues.body.buckets).toEqual({
      b0_7: 1_000,
      b8_15: 2_000,
      b16_30: 3_000,
      b31_60: 4_000,
      b61_90: 5_000,
      b90plus: 6_000,
    })
    expect(dues.body.overduePaise).toBe(21_000)
    expect(dues.body.openBills).toBe(6)

    const snapshot = await db.execute(sql`
      select bucket_60_plus_paise, bucket_61_90_paise, bucket_90_plus_paise, overdue_paise
        from ageing_snapshots
       where tenant_id = ${tenantId} and retailer_id = ${shop.c} and as_of = ${day(0)}::date`)
    const row = snapshot.rows[0] as Record<string, string>
    expect(Number(row.bucket_60_plus_paise)).toBe(
      Number(row.bucket_61_90_paise) + Number(row.bucket_90_plus_paise),
    )
    expect(Number(row.overdue_paise)).toBe(21_000)
  })

  it('keeps the rollup equal to the books for every shop', async () => {
    for (const retailerId of Object.values(shop)) {
      const summary = await db.execute(sql`
        select outstanding_paise, unallocated_credit_paise from retailer_outstanding_summary
         where tenant_id = ${tenantId} and retailer_id = ${retailerId}`)
      const s = summary.rows[0] as { outstanding_paise: string; unallocated_credit_paise: string }
      const net = Number(s.outstanding_paise) - Number(s.unallocated_credit_paise)
      expect(net).toBe(await arBalance(retailerId))
    }
  })

  it('serves the same closing balance to the desk and to the shop', async () => {
    const desk = await call<LedgerReply>(app, accountant, 'GET', `/receivables/ledger/${shop.a}`, {
      from: day(-200),
      to: day(0),
      limit: 100,
    })
    const shopside = await call<LedgerReply>(app, shopA, 'GET', `/receivables/ledger/${shop.a}`, {
      from: day(-200),
      to: day(0),
      limit: 100,
    })
    expect(desk.status).toBe(200)
    expect(shopside.status).toBe(200)
    expect(shopside.body.closingPaise).toBe(desk.body.closingPaise)
    expect(desk.body.closingPaise).toBe(await arBalance(shop.a))
    expect(desk.body.items.length).toBeGreaterThan(0)
    expect(shopside.body.items.length).toBe(desk.body.items.length)
  })

  /*
   * The retailer statement now follows `nextCursor` to the end of its window and prints the closing
   * balance only when it has (DOS-095). That is safe only if the page chain is exact: page 2 carries the
   * running balance on from page 1, no entry is skipped or repeated at a page boundary, and the last
   * balance on the last page is the window's closing balance.
   */
  it("DOS-095: the shop's statement pages chain: following nextCursor lists every entry and the last balance equals closingPaise", async () => {
    const period = { from: day(-200), to: day(0) }
    const whole = await call<LedgerReply>(app, shopA, 'GET', `/receivables/ledger/${shop.a}`, {
      ...period,
      limit: 200,
    })
    expect(whole.status).toBe(200)
    expect(whole.body.nextCursor).toBeNull()

    const paged: LedgerReply['items'] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: { status: number; body: LedgerReply } = await call<LedgerReply>(
        app,
        shopA,
        'GET',
        `/receivables/ledger/${shop.a}`,
        { ...period, limit: 2, ...(cursor === null ? {} : { cursor }) },
      )
      expect(page.status).toBe(200)
      expect(page.body.items.length).toBeLessThanOrEqual(2)
      expect(page.body.openingPaise).toBe(whole.body.openingPaise)
      expect(page.body.closingPaise).toBe(whole.body.closingPaise)
      paged.push(...page.body.items)
      cursor = page.body.nextCursor
      pages += 1
    } while (cursor !== null && pages <= whole.body.items.length)

    expect(cursor).toBeNull()
    expect(pages).toBeGreaterThan(1)
    expect(paged.map((row) => row.refId)).toEqual(whole.body.items.map((row) => row.refId))
    expect(paged.map((row) => row.balancePaise)).toEqual(
      whole.body.items.map((row) => row.balancePaise),
    )
    expect(paged.at(-1)?.balancePaise).toBe(whole.body.closingPaise)
  })

  it('gives the accountant a trial balance that nets to zero', async () => {
    const res = await call<{
      items: { code: string; balancePaise: number }[]
      totals: { debitPaise: number; creditPaise: number }
    }>(app, accountant, 'GET', '/receivables/accounts', { withBalances: true })
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThan(0)
    expect(res.body.totals.debitPaise + res.body.totals.creditPaise).toBe(0)
    const journal = await call<{ items: { lines: { amountPaise: number }[] }[] }>(
      app,
      accountant,
      'GET',
      '/receivables/journal',
      { limit: 20 },
    )
    expect(journal.status).toBe(200)
    expect(journal.body.items.length).toBeGreaterThan(0)
    for (const entry of journal.body.items) {
      expect(entry.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)
    }
  })

  it('posts the same journal key only once', async () => {
    const key = `manual:${run}`
    const first = await asOwner((tx) =>
      receivables.postEntry(tx, {
        entryDate: day(0),
        refType: 'adjustment',
        refId: `adj-${run}`,
        idempotencyKey: key,
        lines: [
          { accountCode: 'CASH', amountPaise: 1_000 },
          { accountCode: 'ROUND_OFF', amountPaise: -1_000 },
        ],
      }),
    )
    const second = await asOwner((tx) =>
      receivables.postEntry(tx, {
        entryDate: day(0),
        refType: 'adjustment',
        refId: `adj-${run}`,
        idempotencyKey: key,
        lines: [
          { accountCode: 'CASH', amountPaise: 1_000 },
          { accountCode: 'ROUND_OFF', amountPaise: -1_000 },
        ],
      }),
    )
    expect(second.entryId).toBe(first.entryId)
    const rows = await db.execute(sql`
      select count(*)::int as n from journal_entries
       where tenant_id = ${tenantId} and idempotency_key = ${key}`)
    expect((rows.rows[0] as { n: number }).n).toBe(1)
  })

  /**
   * The three service methods billing (step 2), delivery (step 4) and integrations (step 6) import but
   * this module's own procedures never call. They ship complete at step 1 by coordination §3.1, so they
   * are proved here rather than left to be discovered broken by the module that first needs them.
   */
  it('carries an opening balance in, credits a note against a bill and reverses an entry', async () => {
    const openingInvoice = uuidv7()
    await db.insert(invoices).values({
      id: openingInvoice,
      tenantId,
      invoiceNo: `OPEN/${run}`,
      seriesCode: 'OPEN',
      fy,
      invoiceDate: day(-70),
      retailerId: shop.g,
      source: 'import',
      state: 'issued',
      buyerName: `Shop 7 ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: 3_000,
      taxablePaise: 3_000,
      totalPaise: 3_000,
      dueDate: day(-55),
    })
    const opening = await asOwner((tx) =>
      receivables.postOpeningBalance(tx, {
        retailerId: shop.g,
        invoiceId: openingInvoice,
        amountPaise: 3_000,
        asOfDate: day(-70),
        importJobId: `import-${run}`,
      }),
    )
    // ₹70 already sat on account, so the books show ₹30 of bill against ₹70 of credit
    expect(await arBalance(shop.g)).toBe(3_000 - 7_000)

    const noteId = uuidv7()
    await db.insert(creditNotes).values({
      id: noteId,
      tenantId,
      creditNoteNo: `CN/${run}`,
      seriesCode: 'CN',
      fy,
      noteDate: day(0),
      invoiceId: openingInvoice,
      retailerId: shop.g,
      reason: 'rate_difference',
      state: 'issued',
      taxablePaise: 1_000,
      totalPaise: 1_000,
    })
    await asOwner((tx) =>
      receivables.postCreditNoteIssued(tx, {
        id: noteId,
        invoiceId: openingInvoice,
        retailerId: shop.g,
        noteDate: day(0),
        taxablePaise: 1_000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
        roundOffPaise: 0,
        totalPaise: 1_000,
      }),
    )
    expect(await invoiceState(openingInvoice)).toBe('partially_paid')
    expect(await arBalance(shop.g)).toBe(3_000 - 7_000 - 1_000)

    const mirror = await asOwner((tx) =>
      receivables.reverseEntry(tx, opening.entryId, `reverse-opening-${run}`, 'wrong import file'),
    )
    expect(mirror.entryId).not.toBe(opening.entryId)
    const stamped = await db.execute(sql`
      select reversed_by_entry_id from journal_entries where id = ${opening.entryId}`)
    expect((stamped.rows[0] as { reversed_by_entry_id: string }).reversed_by_entry_id).toBe(
      mirror.entryId,
    )
    expect(await arBalance(shop.g)).toBe(-7_000 - 1_000)
    const balanced = await db.execute(sql`
      select count(*)::int as n from (
        select entry_id from journal_lines where tenant_id = ${tenantId}
         group by entry_id having sum(amount_paise) <> 0) bad`)
    expect((balanced.rows[0] as { n: number }).n).toBe(0)
  })

  // -------------------------------------------------------------------------------------------------------------
  // credit

  it('breaches a stop-mode shop over its limit and never a shop on indicate', async () => {
    const stopMode = await call<{ breached: boolean; reasons: string[] }>(
      app,
      owner,
      'GET',
      '/receivables/credit-check',
      // ₹390 still open against a ₹500 limit: another ₹1,000 order puts the shop over
      { retailerId: shop.a, orderTotalPaise: 100_000 },
    )
    expect(stopMode.status).toBe(200)
    expect(stopMode.body.breached).toBe(true)
    expect(stopMode.body.reasons).toContain('limit_exceeded')

    const indicate = await call<{ breached: boolean }>(
      app,
      owner,
      'GET',
      '/receivables/credit-check',
      { retailerId: shop.b, orderTotalPaise: 100_000 },
    )
    expect(indicate.body.breached).toBe(false)

    const tooManyBills = await call<{ breached: boolean; reasons: string[] }>(
      app,
      owner,
      'GET',
      '/receivables/credit-check',
      { retailerId: shop.c, orderTotalPaise: 0 },
    )
    expect(tooManyBills.body.breached).toBe(true)
    // its rupee limit is out of reach, so only the bill count and the 100-day-old bill breach
    expect(tooManyBills.body.reasons).toEqual(['bill_count_exceeded', 'overdue_days_exceeded'])
  })

  // -------------------------------------------------------------------------------------------------------------
  // roles and row level security

  it('refuses every receipt procedure to a salesperson', async () => {
    expect(
      (
        await call(app, rep, 'POST', '/receipts', {
          idempotencyKey: `rep-${run}`,
          id: uuidv7(),
          retailerId: shop.a,
          mode: 'cash',
          amountPaise: 100,
        })
      ).status,
    ).toBe(403)
    expect((await call(app, rep, 'GET', '/receipts', { limit: 5 })).status).toBe(403)
    expect((await call(app, rep, 'GET', `/receipts/${inv.a1}`)).status).toBe(403)
    expect((await call(app, rep, 'GET', '/receivables/outstanding', { limit: 5 })).status).toBe(403)
    // and the database refuses too: the journal is invisible to a rep even inside a transaction
    const seen = await as(ctxFor('salesperson', repId), (tx) => tx.select().from(journalLines))
    expect(seen).toHaveLength(0)
  })

  it('shows a salesperson the dues, the statement and the credit check of the shops on its beats only', async () => {
    // docs/23 §8.1: "never collects" is not "never sees" — but only for the shops it serves.
    const beatId = uuidv7()
    await db.insert(beats).values({ id: beatId, tenantId, name: `Beat ${run}`, visitDays: [] })
    await db.update(retailers).set({ beatId }).where(eq(retailers.id, shop.a))
    // nobody assigned yet: even a shop on a beat is off limits
    expect((await call(app, rep, 'GET', `/receivables/outstanding/${shop.a}`)).status).toBe(403)
    await db.insert(beatAssignments).values({
      id: uuidv7(),
      tenantId,
      beatId,
      userId: repId,
      validFrom: day(-1),
    })
    const dues = await call<Outstanding>(app, rep, 'GET', `/receivables/outstanding/${shop.a}`)
    expect(dues.status).toBe(200)
    expect(dues.body.outstandingPaise).toBeGreaterThanOrEqual(0)
    expect((await call(app, rep, 'GET', `/receivables/ledger/${shop.a}`)).status).toBe(200)
    expect(
      (
        await call(app, rep, 'GET', '/receivables/credit-check', {
          retailerId: shop.a,
          orderTotalPaise: 100,
        })
      ).status,
    ).toBe(200)
    // shop b is on no beat of this rep
    expect((await call(app, rep, 'GET', `/receivables/outstanding/${shop.b}`)).status).toBe(403)
    expect((await call(app, rep, 'GET', `/receivables/ledger/${shop.b}`)).status).toBe(403)
    expect(
      (
        await call(app, rep, 'GET', '/receivables/credit-check', {
          retailerId: shop.b,
          orderTotalPaise: 100,
        })
      ).status,
    ).toBe(403)
    // the crew reads one shop at the door, never the tenant register (docs/23 §5.3)
    expect((await call(app, crew, 'GET', `/receivables/outstanding/${shop.b}`)).status).toBe(200)
    expect((await call(app, crew, 'GET', '/receivables/outstanding', { limit: 5 })).status).toBe(
      403,
    )
  })

  it('sums the ageing buckets over every row of the register, and serves the history from the snapshots', async () => {
    const register = await call<{
      items: unknown[]
      totals: { retailers: number; buckets: Record<string, number>; outstandingPaise: number }
    }>(app, owner, 'GET', '/receivables/outstanding', { limit: 2 })
    expect(register.status).toBe(200)
    expect(register.body.items).toHaveLength(2)
    expect(register.body.totals.retailers).toBeGreaterThan(2)
    const b = register.body.totals.buckets
    expect(Object.values(b).reduce((n, v) => n + v, 0)).toBeGreaterThan(0)
    // shop c alone: exactly its six buckets
    const c = await call<{ totals: { buckets: Record<string, number> } }>(
      app,
      owner,
      'GET',
      '/receivables/outstanding',
      {
        limit: 5,
        q: `Shop 3 ${run}`,
      },
    )
    expect(c.body.totals.buckets).toEqual({
      b0_7: 1_000,
      b8_15: 2_000,
      b16_30: 3_000,
      b31_60: 4_000,
      b61_90: 5_000,
      b90plus: 6_000,
    })

    const history = await call<{
      grain: string
      points: { asOf: string; outstandingPaise: number; buckets: Record<string, number> }[]
    }>(app, accountant, 'GET', '/receivables/ageing/history', {
      from: day(-7),
      to: day(0),
      grain: 'day',
      retailerId: shop.c,
    })
    expect(history.status).toBe(200)
    expect(history.body.grain).toBe('day')
    expect(history.body.points.length).toBeGreaterThanOrEqual(1)
    const today = history.body.points.find((p) => p.asOf === day(0))
    expect(today?.buckets.b90plus).toBe(6_000)
    expect(today?.outstandingPaise).toBe(21_000)
    const weekly = await call<{ points: unknown[] }>(
      app,
      owner,
      'GET',
      '/receivables/ageing/history',
      {
        from: day(-60),
        to: day(0),
        grain: 'week',
      },
    )
    expect(weekly.status).toBe(200)
    expect(weekly.body.points.length).toBeGreaterThanOrEqual(1)
    const tooWide = await call<{ data?: { code?: string } }>(
      app,
      owner,
      'GET',
      '/receivables/ageing/history',
      {
        from: day(-200),
        to: day(0),
        grain: 'day',
      },
    )
    expect(tooWide.status).toBe(400)
    expect(tooWide.body.data?.code).toBe('window_too_wide')
    expect(
      (await call(app, crew, 'GET', '/receivables/ageing/history', { from: day(-7), to: day(0) }))
        .status,
    ).toBe(403)
  })

  it('carries the distributor seller block on a receipt and queues its document for the renderer', async () => {
    const list = await call<{ items: { id: string }[] }>(app, owner, 'GET', '/receipts', {
      retailerId: shop.a,
      limit: 1,
    })
    const receiptId = list.body.items[0]?.id ?? ''
    expect(receiptId).not.toBe('')
    const got = await call<{
      seller: { displayName: string; legalName: string }
      item: { pdfObjectKey: string | null }
    }>(app, shopA, 'GET', `/receipts/${receiptId}`)
    expect(got.status).toBe(200)
    expect(got.body.seller.displayName).toBe(got.body.seller.legalName)
    expect(got.body.item.pdfObjectKey).toBeNull()
    const doc = await call<{ status: string; url: string | null; objectKey: string | null }>(
      app,
      shopA,
      'GET',
      `/receipts/${receiptId}/document`,
      { format: 'thermal80' },
    )
    expect(doc.status).toBe(200)
    expect(doc.body).toMatchObject({ status: 'queued', url: null })
    // one durable render request, and pressing again does not queue a second
    await call(app, owner, 'GET', `/receipts/${receiptId}/document`, { format: 'thermal80' })
    const queued = await db.execute(sql`
      select count(*)::int as n from outbox_events
       where tenant_id = ${tenantId} and event_type = 'DocumentRenderRequested'
         and aggregate_id = ${`receipt:${receiptId}:thermal80:original`} and published_at is null`)
    expect((queued.rows[0] as { n: number }).n).toBe(1)
    expect((await call(app, rep, 'GET', `/receipts/${receiptId}/document`)).status).toBe(403)
  })

  it('DOS-057: recording a receipt queues its A5 original for the PDF renderer in the same transaction, and a replay after that request was published queues nothing more', async () => {
    const id = uuidv7()
    const payload = {
      idempotencyKey: `rcpt-paper-${run}`,
      id,
      retailerId: shop.g,
      mode: 'cash',
      amountPaise: 1_500,
    }
    type RenderRow = {
      id: string
      aggregate_type: string
      payload: Record<string, unknown>
      same_transaction: boolean
    }
    const renderRequests = async (): Promise<RenderRow[]> =>
      (
        await db.execute(sql`
          select o.id, o.aggregate_type, o.payload, o.created_at = r.created_at as same_transaction
            from outbox_events o
            join receipts r on r.tenant_id = o.tenant_id and r.id = ${id}
           where o.tenant_id = ${tenantId} and o.event_type = 'DocumentRenderRequested'
             and o.aggregate_id = ${`receipt:${id}:a5:original`}`)
      ).rows as RenderRow[]

    const first = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', payload)
    expect(first.status).toBe(200)
    const queued = await renderRequests()
    expect(queued).toHaveLength(1)
    expect(queued[0]?.aggregate_type).toBe('document')
    expect(queued[0]?.payload).toMatchObject({
      tenantId,
      kind: 'receipt',
      id,
      format: 'a5',
      copy: 'original',
      requestedBy: accountantId,
    })
    // `now()` is the transaction's start: the request and the receipt were written together.
    expect(queued[0]?.same_transaction).toBe(true)

    // The worker has taken it (published), so the unpublished-row dedupe can no longer hide a re-queue.
    await db.execute(
      sql`update outbox_events set published_at = now() where id = ${queued[0]?.id ?? ''}`,
    )
    const replay = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', payload)
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(id)
    // The same receipt id under a new key reaches recordReceipt's own replay return.
    const sameId = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
      ...payload,
      idempotencyKey: `rcpt-paper-again-${run}`,
    })
    expect(sameId.status).toBe(200)
    expect(sameId.body.item.id).toBe(id)
    expect(await renderRequests()).toHaveLength(1)
  })

  it('refuses every receivables procedure to the warehouse role', async () => {
    expect((await call(app, store, 'GET', '/receipts', { limit: 5 })).status).toBe(403)
    expect((await call(app, store, 'GET', '/receivables/outstanding', { limit: 5 })).status).toBe(
      403,
    )
    expect((await call(app, store, 'GET', '/receivables/accounts')).status).toBe(403)
    expect(
      (await call(app, store, 'GET', '/receivables/credit-check', { retailerId: shop.a })).status,
    ).toBe(403)
  })

  it('shows a shop only its own money and refuses it every money mutation', async () => {
    const mine = await call<{ items: { retailerId: string }[] }>(app, shopA, 'GET', '/receipts', {
      limit: 50,
    })
    expect(mine.status).toBe(200)
    expect(mine.body.items.every((r) => r.retailerId === shop.a)).toBe(true)
    expect(mine.body.items.length).toBeGreaterThan(0)

    expect((await call(app, shopA, 'GET', `/receivables/outstanding/${shop.b}`)).status).toBe(404)
    expect((await call(app, shopA, 'GET', '/receivables/outstanding', { limit: 5 })).status).toBe(
      403,
    )
    expect(
      (
        await call(app, shopA, 'POST', '/receipts', {
          idempotencyKey: `shop-${run}`,
          id: uuidv7(),
          retailerId: shop.a,
          mode: 'cash',
          amountPaise: 100,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, shopA, 'POST', '/allocations', {
          idempotencyKey: `shop-alloc-${run}`,
          id: uuidv7(),
          sourceType: 'receipt',
          sourceId: uuidv7(),
          lines: [{ id: uuidv7(), invoiceId: inv.a3, amountPaise: 1 }],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, shopA, 'POST', '/receivables/write-offs', {
          idempotencyKey: `shop-wo-${run}`,
          id: uuidv7(),
          invoiceId: inv.a3,
          amountPaise: 1,
          reason: 'other',
        })
      ).status,
    ).toBe(403)

    // RLS, not the guard: a shop's own transaction sees only allocations hanging off its own bills
    const seen = await as(ctxFor('retailer', shopUserA), (tx) =>
      tx.execute(sql`select invoice_id from allocations`),
    )
    const ids = (seen.rows as { invoice_id: string }[]).map((r) => r.invoice_id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => [inv.a1, inv.a2, inv.a3].includes(id))).toBe(true)
  })

  it('lets a shop start an online payment for itself and for nobody else', async () => {
    const res = await call<{
      retailerId: string
      amountPaise: number
      paymentRef: string
      payeeVpa: string | null
      bills: { id: string }[]
    }>(app, shopA, 'POST', '/receivables/payments/initiate', {
      idempotencyKey: `pay-${run}`,
      id: uuidv7(),
    })
    expect(res.status).toBe(200)
    // the shop is taken from the actor's own link: shop B's user gets shop B, never shop A
    expect(res.body.retailerId).toBe(shop.a)
    expect(res.body.payeeVpa).toBe('tarsun@upi')
    expect(res.body.bills.every((b) => [inv.a1, inv.a2, inv.a3].includes(b.id))).toBe(true)

    const other = await call<{ retailerId: string }>(
      app,
      shopB,
      'POST',
      '/receivables/payments/initiate',
      { idempotencyKey: `pay-b-${run}`, id: uuidv7(), amountPaise: 100 },
    )
    expect(other.status).toBe(200)
    expect(other.body.retailerId).toBe(shop.b)

    // and it credits nothing: a shop can never write its own receipt
    const rows = await db.execute(sql`
      select count(*)::int as n from receipts where tenant_id = ${tenantId} and received_by = ${shopUserA}`)
    expect((rows.rows[0] as { n: number }).n).toBe(0)
    // the desk cannot call it either
    expect(
      (
        await call(app, accountant, 'POST', '/receivables/payments/initiate', {
          idempotencyKey: `pay-desk-${run}`,
          id: uuidv7(),
        })
      ).status,
    ).toBe(403)
  })

  it("DOS-094: payments.initiate puts the amount the shop chose and its own PAY reference in a single upi://pay? intent paid to the distributor's configured UPI id", async () => {
    const res = await call<PaymentIntentReply>(
      app,
      shopA,
      'POST',
      '/receivables/payments/initiate',
      { idempotencyKey: `pay-094-all-${run}`, id: uuidv7() },
    )
    expect(res.status).toBe(200)
    const { amountPaise, paymentRef, bills } = res.body
    const url = res.body.upiIntentUrl ?? ''

    // one intent, one scheme prefix: the deep link and the QR payload are the same full URI
    expect(url).not.toBe('')
    expect(res.body.upiQrPayload).toBe(url)
    expect(url.split('upi://pay?')).toHaveLength(2)
    // paid into the distributor's configured UPI id under its display name, not the bill snapshot's `pn`
    expect(url.startsWith('upi://pay?pa=tarsun%40upi&pn=Receivables%20test&am=')).toBe(true)
    expect(res.body.payeeVpa).toBe('tarsun@upi')
    expect(res.body.payeeName).toBe('Receivables test')

    // "pay everything" across several bills asks for what is open on all of them, not one bill's total
    expect(bills.length).toBeGreaterThan(1)
    expect(amountPaise).toBe(bills.reduce((sum, bill) => sum + bill.openPaise, 0))
    expect(url).toContain(`&am=${(amountPaise / 100).toFixed(2)}&`)

    // the reference the shop quotes rides in `tr` and in the note, never a bill's invoice number
    expect(paymentRef).toMatch(/^PAY-[0-9a-f]{12}$/)
    expect(url).toContain(`&tr=${paymentRef}&tn=${paymentRef}&cu=INR`)
    expect(url).not.toContain('tr=INV')

    // and it still credits nothing
    const rows = await db.execute(sql`
      select count(*)::int as n from receipts where tenant_id = ${tenantId} and received_by = ${shopUserA}`)
    expect((rows.rows[0] as { n: number }).n).toBe(0)
  })

  it("DOS-094: one part-paid bill asks for what is left of it under the PAY reference, not the bill's original total or its invoice number", async () => {
    // the shop's own dues, the list the Pay screen ticks bills from
    const dues = await call<{ bills: OpenBillReply[] }>(
      app,
      shopA,
      'GET',
      `/receivables/outstanding/${shop.a}`,
      { includeBills: true },
    )
    expect(dues.status).toBe(200)
    // precondition: the FIFO receipt left inv.a2 part-paid, the INV/0433 shape from the finding
    const bill = dues.body.bills.find((b) => b.id === inv.a2)
    expect(bill).toBeDefined()
    const { totalPaise, openPaise } = bill ?? { totalPaise: 0, openPaise: 0 }
    expect(openPaise).toBeGreaterThan(0)
    expect(openPaise).toBeLessThan(totalPaise)

    const res = await call<PaymentIntentReply>(
      app,
      shopA,
      'POST',
      '/receivables/payments/initiate',
      {
        idempotencyKey: `pay-094-one-${run}`,
        id: uuidv7(),
        invoiceIds: [inv.a2],
        amountPaise: openPaise,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.bills.map((b) => b.id)).toEqual([inv.a2])
    expect(res.body.amountPaise).toBe(openPaise)
    const url = res.body.upiIntentUrl ?? ''
    expect(url.split('upi://pay?')).toHaveLength(2)
    expect(url).toContain(`&am=${(openPaise / 100).toFixed(2)}&`)
    expect(url).not.toContain(`am=${(totalPaise / 100).toFixed(2)}`)
    expect(res.body.paymentRef).toMatch(/^PAY-[0-9a-f]{12}$/)
    expect(url).toContain(`&tr=${res.body.paymentRef}&`)
    expect(url).not.toContain('tr=INV')
  })

  // -------------------------------------------------------------------------------------------------------------
  // banking the day

  /*
   * The manager app's Day-end and Receipts screens offer "Bank this batch", "Bank it" and "Mark bounced" from
   * `receiptMayBeDeposited` / `receiptMayBounce` in @dos/domain (DOS-034). This pins the server half those buttons
   * rely on. OFFICE receipts only: where a trip's cash is credited when it is banked is a separate, open
   * accounting question and is deliberately not asserted here.
   */
  it('DOS-034 (guard): the desk banks an office cash + cheque batch (DR BANK, CR CASH and CHEQUES), a batch holding a UPI receipt is refused whole with nothing deposited, and a banked cheque bounces against BANK', async () => {
    const shopJ = uuidv7()
    const billJ = uuidv7()
    await db.insert(retailers).values({
      id: shopJ,
      tenantId,
      code: `S10-${run}`,
      name: `Shop 10 ${run}`,
      phone: `+9192${run}10`,
      stateCode: '27',
      tier: 'C',
      creditDays: 15,
    })
    await seedInvoice({ id: billJ, retailerId: shopJ, totalPaise: 30_000, dueOffsetDays: 5 })

    /** Money taken at the office desk: no trip, so cash lands in CASH and a cheque in CHEQUES. */
    const take = async (
      mode: 'cash' | 'cheque' | 'upi',
      amountPaise: number,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const id = uuidv7()
      const res = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', {
        idempotencyKey: `rcpt-034-${id}`,
        id,
        retailerId: shopJ,
        mode,
        amountPaise,
        ...extra,
      })
      expect(res.status).toBe(200)
      expect(res.body.item.tripId).toBeNull()
      return id
    }
    const cashId = await take('cash', 10_000)
    const chequeId = await take('cheque', 12_000, {
      reference: '034411',
      bankName: 'Bank of Maharashtra',
    })
    const strayCashId = await take('cash', 5_000)
    const upiId = await take('upi', 3_000, { reference: `UTR034${run}` })
    expect(await invoiceState(billJ)).toBe('paid')
    expect(await arBalance(shopJ)).toBe(0)

    const statusOf = async (id: string): Promise<string> => {
      const res = await call<{ item: Receipt }>(app, accountant, 'GET', `/receipts/${id}`)
      expect(res.status).toBe(200)
      return res.body.item.status
    }
    /** Account code -> net amount of the journal entry a ref posted, or `{}` when nothing was posted. */
    const entryOf = async (refType: string, refId: string): Promise<Record<string, number>> => {
      const result = await db.execute(sql`
        select a.code, sum(jl.amount_paise)::bigint as amount
          from journal_entries je
          join journal_lines jl on jl.entry_id = je.id and jl.tenant_id = je.tenant_id
          join accounts a on a.id = jl.account_id
         where je.tenant_id = ${tenantId} and je.ref_type = ${refType} and je.ref_id = ${refId}
         group by a.code`)
      return Object.fromEntries(
        (result.rows as { code: string; amount: string }[]).map((row) => [
          row.code,
          Number(row.amount),
        ]),
      )
    }

    // 1. a batch holding a UPI receipt is refused WHOLE: the cash beside it stays in hand, nothing is posted
    const refusedBatch = uuidv7()
    const refused = await call<{ message: string }>(app, accountant, 'POST', '/receipts/deposit', {
      idempotencyKey: `dep-034-refused-${run}`,
      id: refusedBatch,
      receiptIds: [strayCashId, upiId],
      depositedAt: new Date().toISOString(),
      depositRef: `DEP-034-X-${run}`,
    })
    expect(refused.status).toBe(409)
    expect(refused.body.message).toContain('only cash and cheques are banked')
    expect(await statusOf(strayCashId)).toBe('collected')
    expect(await statusOf(upiId)).toBe('collected')
    expect(await entryOf('deposit', refusedBatch)).toEqual({})

    // 2. office cash and a cheque banked together: DR BANK, CR CASH and CHEQUES, and the entry nets to zero
    const batch = uuidv7()
    const banked = await call<{ updated: number; journalEntryId: string; totalPaise: number }>(
      app,
      accountant,
      'POST',
      '/receipts/deposit',
      {
        idempotencyKey: `dep-034-${run}`,
        id: batch,
        receiptIds: [cashId, chequeId],
        depositedAt: new Date().toISOString(),
        depositRef: `DEP-034-${run}`,
      },
    )
    expect(banked.status).toBe(200)
    expect(banked.body).toMatchObject({ updated: 2, totalPaise: 22_000 })
    expect(await statusOf(cashId)).toBe('deposited')
    expect(await statusOf(chequeId)).toBe('deposited')
    const deposit = await entryOf('deposit', batch)
    expect(deposit).toEqual({ BANK: 22_000, CASH: -10_000, CHEQUES: -12_000 })
    expect(Object.values(deposit).reduce((sum, amount) => sum + amount, 0)).toBe(0)
    // banking moves money between the distributor's own accounts: the shop's balance does not move
    expect(await arBalance(shopJ)).toBe(0)

    // 3. the bank returns the banked cheque: the reversal credits BANK, where the money went, not CHEQUES
    const reversalId = uuidv7()
    const bounced = await call<{ item: Receipt; original: Receipt; outstanding: Outstanding }>(
      app,
      accountant,
      'POST',
      `/receipts/${chequeId}/bounce`,
      {
        idempotencyKey: `bounce-034-${run}`,
        id: chequeId,
        reversalId,
        bouncedAt: new Date().toISOString(),
        reason: 'insufficient funds',
      },
    )
    expect(bounced.status).toBe(200)
    expect(bounced.body.original).toMatchObject({ id: chequeId, status: 'bounced' })
    expect(bounced.body.item.amountPaise).toBe(-12_000)
    expect(await entryOf('receipt_reversal', reversalId)).toEqual({ BANK: -12_000, AR: 12_000 })
    // the shop owes exactly the cheque again
    expect(bounced.body.outstanding.outstandingPaise).toBe(12_000)
    expect(await arBalance(shopJ)).toBe(12_000)
    expect(await invoiceState(billJ)).toBe('partially_paid')
  })

  it('isolates tenants', async () => {
    const list = await call<{ items: unknown[] }>(app, stranger, 'GET', '/receipts', { limit: 50 })
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(0)
    expect((await call(app, stranger, 'GET', `/receivables/outstanding/${shop.a}`)).status).toBe(
      404,
    )
    const seen = await as(ctxFor('owner', otherOwnerId, otherTenantId), (tx) =>
      tx.select().from(journalEntries),
    )
    expect(seen).toHaveLength(0)
  })

  it('answers 401 without a token', async () => {
    expect((await call(app, null, 'GET', '/receipts', { limit: 5 })).status).toBe(401)
    expect(
      (
        await call(app, null, 'POST', '/receipts', {
          idempotencyKey: `anon-${run}`,
          id: uuidv7(),
          retailerId: shop.a,
          mode: 'cash',
          amountPaise: 100,
        })
      ).status,
    ).toBe(401)
  })
})
