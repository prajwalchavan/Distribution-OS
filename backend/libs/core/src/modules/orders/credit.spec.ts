import { eq, inArray } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import {
  approvals,
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  invoiceLines,
  invoices,
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
  salesOrders,
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
import { BillingModule } from '../billing/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { ReceivablesModule, ReceivablesService } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { OrdersModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/**
 * THE CREDIT DESK (QA phase 7 · lane "credit", architect rulings of 2026-09-28, docs/22 §8):
 *
 *  - DOS-313 (ruling 4) the check counts what is PROMISED: open bills + confirmed orders not billed yet −
 *    money on account, and two orders placed one after the other — or at the same moment — do not both
 *    pass a limit they break together;
 *  - DOS-312 (ruling 3, the counting half) a shop whose money on account covers its late bills is not
 *    held for credit, not overdue and not on the overdue register;
 *  - DOS-314 (ruling 5) "stop" means stop: an order on credit is refused where it is placed and a hold
 *    cannot be approved by the manager or the owner;
 *  - DOS-225 a pay-on-delivery shop's order is not held for credit, and its bill says pay on delivery;
 *    it is held when credit is stopped;
 *  - DOS-315 (ruling 6) a deactivated shop takes no new order from any door, and its open orders can
 *    still be cancelled.
 */

interface Detail {
  id: string
  orderNo: string | null
  state: string
  paymentTerms: string
  totalPaise: number
  approvalFlags: string[]
  creditNotice: {
    creditMode: string
    reasons: string[]
    unbilledOrdersPaise?: number
    exposurePaise?: number
    creditStopped?: boolean
    payOnDelivery?: boolean
  } | null
}
interface Verdict {
  breached: boolean
  reasons: string[]
  outstandingPaise: number
  unbilledOrdersPaise: number
  unbilledOrders: number
  unallocatedCreditPaise: number
  exposurePaise: number
  headroomPaise: number
  overdueDays: number
  openBills: number
  oldestDueDate: string | null
  creditStopped: boolean
  payOnDelivery: boolean
}
interface Refusal {
  message: string
  data?: { code?: string }
}

describeDb('credit desk: who may order on credit (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const hsn = `7${run}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shopkeeper: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const variantId = uuidv7()
  /** One piece is ₹100 + 12 % GST = ₹112, so five pieces are ₹560 exactly. */
  const PIECE = 11_200
  const shop = {
    strict: uuidv7(), // DOS-313: ₹1,000 limit, two ₹560 orders one after the other
    race: uuidv7(), // DOS-313: ₹1,000 limit, two ₹560 orders at the same moment
    billed: uuidv7(), // DOS-313: an order with its bill counts once, as the bill
    bills: uuidv7(), // DOS-313: one bill allowed, the confirmed order is the bill to come
    stop: uuidv7(), // DOS-314: credit stopped, pays after delivery
    held: uuidv7(), // DOS-314: a hold that was waiting when the owner stopped credit
    pod: uuidv7(), // DOS-225: pays on delivery, strict, no limit at all
    podStop: uuidv7(), // DOS-225: pays on delivery with credit stopped
    inCredit: uuidv7(), // DOS-312: ₹5,000 on account beside a ₹867 bill 20 days late
    inactive: uuidv7(), // DOS-315: deactivated by the owner
  }
  let app: NestFastifyApplication
  let receivables: ReceivablesService
  let godown = ''

  const day = (offset: number): string => {
    const at = new Date(`${businessDate().date}T12:00:00.000Z`)
    at.setUTCDate(at.getUTCDate() + offset)
    return at.toISOString().slice(0, 10)
  }

  const sourceOf = (who: Actor): string =>
    who.role === 'retailer' ? 'retailer_app' : who.role === 'salesperson' ? 'salesperson' : 'phone'

  /** Draft and submit `pieces` of the one item as `who`; the submit reply (or its refusal) comes back. */
  async function place(
    who: Actor,
    retailerId: string,
    pieces = 5,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; submitted: { status: number; body: { item: Detail } & Refusal } }> {
    const id = uuidv7()
    const drafted = await call<{ item: Detail }>(app, who, 'POST', '/orders', {
      idempotencyKey: `draft-${id}`,
      id,
      retailerId,
      source: sourceOf(who),
      lines: [{ id: uuidv7(), variantId, enteredQty: pieces, enteredUnit: 'piece' }],
      ...extra,
    })
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)
    const submitted = await call<{ item: Detail } & Refusal>(
      app,
      who,
      'POST',
      `/orders/${id}/submit`,
      { idempotencyKey: `submit-${id}` },
    )
    return { id, submitted }
  }

  const verdict = async (retailerId: string, orderTotalPaise: number): Promise<Verdict> => {
    const res = await call<Verdict>(app, owner, 'GET', '/receivables/credit-check', {
      retailerId,
      orderTotalPaise,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body
  }

  const pendingApprovals = async (orderId: string) =>
    db.select().from(approvals).where(eq(approvals.orderId, orderId))

  /** A bill the way billing hands it over, plus the AR entry receivables posts for it. */
  async function seedBill(input: {
    retailerId: string
    totalPaise: number
    dueOffsetDays: number
    orderId?: string
  }): Promise<string> {
    const id = uuidv7()
    const dueDate = day(input.dueOffsetDays)
    const invoiceDate = day(input.dueOffsetDays - 7)
    await db.insert(invoices).values({
      id,
      tenantId,
      invoiceNo: `INV/C${run}/${id.slice(-4)}`,
      seriesCode: 'INV',
      fy: financialYear(),
      invoiceDate,
      retailerId: input.retailerId,
      orderId: input.orderId ?? null,
      state: 'issued',
      buyerName: `Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: input.totalPaise,
      taxablePaise: input.totalPaise,
      totalPaise: input.totalPaise,
      dueDate,
    })
    await db.insert(invoiceLines).values({
      id: uuidv7(),
      tenantId,
      invoiceId: id,
      lineNo: 1,
      variantId,
      description: 'Credit desk item',
      hsnCode: hsn,
      qtyPcs: 1,
      ratePaise: input.totalPaise,
      taxablePaise: input.totalPaise,
      gstBps: 0,
      lineTotalPaise: input.totalPaise,
    })
    await asOwner((tx) =>
      receivables.postInvoiceIssued(tx, {
        id,
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
    return id
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `crd-${run}`, legalName: 'Credit desk test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91906${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91906${run}2`, name: 'Manager' },
      { id: repId, phone: `+91906${run}3`, name: 'Rep' },
      { id: shopUserId, phone: `+91906${run}4`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker crd ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Glucose', category: 'biscuits' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Glucose 100 g',
      netQty: 100,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 15_000,
    })
    await db.insert(tenantProducts).values({ id: uuidv7(), tenantId, variantId })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, effectiveFrom: '2020-04-01' })
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 10_000 })

    const row = (
      id: string,
      n: number,
      terms: Partial<typeof retailers.$inferInsert>,
    ): typeof retailers.$inferInsert => ({
      id,
      tenantId,
      code: `C${String(n)}-${run}`,
      name: `Credit Shop ${String(n)} ${run}`,
      phone: `+91907${run}${String(n)}`,
      stateCode: '27',
      tier: 'C',
      ...terms,
    })
    await db.insert(retailers).values([
      row(shop.strict, 1, { creditMode: 'strict', creditLimitPaise: 100_000 }),
      row(shop.race, 2, { creditMode: 'strict', creditLimitPaise: 100_000 }),
      row(shop.billed, 3, { creditMode: 'strict', creditLimitPaise: 100_000 }),
      row(shop.bills, 4, {
        creditMode: 'strict',
        creditLimitPaise: 100_000_000,
        creditLimitBills: 1,
      }),
      row(shop.stop, 5, { creditMode: 'stop', creditLimitPaise: 100_000_000 }),
      row(shop.held, 6, { creditMode: 'strict', creditLimitPaise: 1_000 }),
      row(shop.pod, 7, { creditMode: 'strict', creditLimitPaise: 0, paymentTerms: 'ON' }),
      row(shop.podStop, 8, { creditMode: 'stop', creditLimitPaise: 0, paymentTerms: 'ON' }),
      row(shop.inCredit, 9, { creditMode: 'strict', creditLimitPaise: 50_000, creditDays: 7 }),
      row(shop.inactive, 10, { creditMode: 'indicate', creditLimitPaise: 100_000_000 }),
    ])
    // The deactivated shop has its own login, so the shop's own app is a door too.
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91907${run}10`,
      userId: shopUserId,
      shopName: `Credit Shop 10 ${run}`,
    })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: shop.inactive,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })

    godown =
      (await db.select().from(locations).where(eq(locations.tenantId, tenantId))).find(
        (l) => l.kind === 'warehouse',
      )?.id ?? ''
    app = await bootTestApp([
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      BillingModule,
      SyncModule,
    ])
    receivables = app.get(ReceivablesService)
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `CRD-${run}`,
        mrpPaise: 15_000,
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-crd-${run}`,
        },
      ])
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await db.delete(hsnRates).where(inArray(hsnRates.hsnCode, [hsn]))
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-313 — what is promised counts

  it('DOS-313: a confirmed order not billed yet counts against the limit, so the second ₹560 order on a ₹1,000 strict limit is held', async () => {
    const first = await place(rep, shop.strict)
    expect(first.submitted.status).toBe(200)
    expect(first.submitted.body.item.totalPaise).toBe(5 * PIECE)
    expect(first.submitted.body.item.state).toBe('confirmed')

    // The rep's pre-check and the desk now read the same figure: the confirmed order is exposure.
    const before = await verdict(shop.strict, 5 * PIECE)
    expect(before.unbilledOrdersPaise).toBe(5 * PIECE)
    expect(before.unbilledOrders).toBe(1)
    expect(before.exposurePaise).toBe(5 * PIECE)
    expect(before.headroomPaise).toBe(100_000 - 2 * 5 * PIECE)
    expect(before.breached).toBe(true)
    expect(before.reasons).toEqual(['limit_exceeded'])

    const second = await place(rep, shop.strict)
    expect(second.submitted.status).toBe(200)
    expect(second.submitted.body.item.state).toBe('submitted')
    expect(second.submitted.body.item.approvalFlags).toEqual(['credit_limit'])
    expect(second.submitted.body.item.creditNotice?.unbilledOrdersPaise).toBe(5 * PIECE)

    // A cancelled order is not promised any more: cancelling the first frees its value.
    const cancelled = await call(app, rep, 'POST', `/orders/${first.id}/cancel`, {
      idempotencyKey: `cancel-${first.id}`,
      reason: 'shop changed its mind',
    })
    expect(cancelled.status).toBe(200)
    const after = await verdict(shop.strict, 0)
    expect(after.unbilledOrdersPaise).toBe(0)
  })

  it('DOS-313: two orders submitted at the same moment do not both pass — the shop lock makes the second count the first', async () => {
    const drafts: string[] = []
    for (let i = 0; i < 2; i++) {
      const id = uuidv7()
      const drafted = await call(app, rep, 'POST', '/orders', {
        idempotencyKey: `race-draft-${id}`,
        id,
        retailerId: shop.race,
        source: 'salesperson',
        lines: [{ id: uuidv7(), variantId, enteredQty: 5, enteredUnit: 'piece' }],
      })
      expect(drafted.status).toBe(200)
      drafts.push(id)
    }
    const replies = await Promise.all(
      drafts.map((id) =>
        call<{ item: Detail }>(app, rep, 'POST', `/orders/${id}/submit`, {
          idempotencyKey: `race-submit-${id}`,
        }),
      ),
    )
    for (const reply of replies) expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    const states = replies.map((r) => r.body.item.state).sort()
    expect(states, 'together they are ₹1,120 on a ₹1,000 strict limit').toEqual([
      'confirmed',
      'submitted',
    ])
  })

  it('DOS-313: an order that carries its bill counts once, as the bill, and a bill-count limit counts the confirmed order as the bill to come', async () => {
    const placed = await place(rep, shop.billed)
    expect(placed.submitted.body.item.state).toBe('confirmed')
    // The godown packs and bills it: the order is packed and its bill is open.
    await db.update(salesOrders).set({ state: 'packed' }).where(eq(salesOrders.id, placed.id))
    await seedBill({
      retailerId: shop.billed,
      totalPaise: 5 * PIECE,
      dueOffsetDays: 5,
      orderId: placed.id,
    })
    const billed = await verdict(shop.billed, 0)
    expect(billed.outstandingPaise).toBe(5 * PIECE)
    expect(billed.unbilledOrdersPaise, 'never twice: once as the order and once as its bill').toBe(
      0,
    )
    expect(billed.exposurePaise).toBe(5 * PIECE)

    // One bill allowed: the first confirmed order has no bill yet, but it is the bill to come.
    const first = await place(rep, shop.bills)
    expect(first.submitted.body.item.state).toBe('confirmed')
    const second = await place(rep, shop.bills)
    expect(second.submitted.body.item.state).toBe('submitted')
    expect(second.submitted.body.item.creditNotice?.reasons).toEqual(['bill_count_exceeded'])
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-312 — money on account is counted

  it('DOS-312: a shop whose money on account covers its late bill is not held, not overdue and not on the overdue register', async () => {
    await seedBill({ retailerId: shop.inCredit, totalPaise: 86_700, dueOffsetDays: -20 })
    const paid = await call(app, owner, 'POST', '/receipts', {
      idempotencyKey: `advance-${run}`,
      id: uuidv7(),
      retailerId: shop.inCredit,
      mode: 'cash',
      amountPaise: 500_000,
      strategy: 'none',
    })
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)

    const check = await verdict(shop.inCredit, 5 * PIECE)
    expect(check.overdueDays, 'the late bill is paid by the money on account').toBe(0)
    expect(check.oldestDueDate).toBeNull()
    expect(check.exposurePaise).toBe(86_700 - 500_000)
    expect(check.headroomPaise).toBe(50_000 - (86_700 - 500_000) - 5 * PIECE)
    expect(check.breached).toBe(false)
    expect(check.reasons).toEqual([])

    const dues = await call<{
      netDuesPaise: number
      netOverduePaise: number
      unallocatedCreditPaise: number
      outstandingPaise: number
    }>(app, owner, 'GET', `/receivables/outstanding/${shop.inCredit}`)
    expect(dues.status).toBe(200)
    expect(dues.body.netDuesPaise).toBe(0)
    expect(dues.body.netOverduePaise).toBe(0)
    // gross and on account stay as they are, the net is added beside them
    expect(dues.body.outstandingPaise - dues.body.unallocatedCreditPaise).toBe(86_700 - 500_000)

    const register = await call<{
      items: { retailerId: string }[]
      totals: { netOverduePaise: number; netDuesPaise: number }
    }>(app, owner, 'GET', '/receivables/outstanding', { overdueOnly: true, q: `C9-${run}` })
    expect(register.status).toBe(200)
    expect(register.body.items.map((r) => r.retailerId)).not.toContain(shop.inCredit)
    expect(register.body.totals.netOverduePaise).toBe(0)
    const all = await call<{
      items: { retailerId: string; overduePaise: number; netOverduePaise: number }[]
    }>(app, owner, 'GET', '/receivables/outstanding', { q: `C9-${run}` })
    const row = all.body.items.find((r) => r.retailerId === shop.inCredit)
    expect(row?.overduePaise, 'the gross figure is still what the bill says').toBe(86_700)
    expect(row?.netOverduePaise).toBe(0)

    const order = await place(rep, shop.inCredit)
    expect(order.submitted.body.item.state).toBe('confirmed')
    expect(order.submitted.body.item.approvalFlags).toEqual([])
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-314 — stop means stop

  it('DOS-314: credit stopped refuses an order on credit where it is placed, with the owner named, from the rep and the desk alike', async () => {
    for (const who of [rep, manager, owner]) {
      const refused = await place(who, shop.stop)
      expect(refused.submitted.status, JSON.stringify(refused.submitted.body)).toBe(409)
      expect(refused.submitted.body.data?.code).toBe('credit_stopped')
      expect(refused.submitted.body.message).toBe(
        `The owner has stopped credit for Credit Shop 5 ${run}: no order on credit can be placed for this shop. Only changing the shop’s credit mode lifts it — ask the owner.`,
      )
      const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, refused.id))
      expect(row?.state, 'the refusal rolled back, the order is still the draft it was').toBe(
        'draft',
      )
    }
    const check = await verdict(shop.stop, 100)
    expect(check.creditStopped).toBe(true)
    expect(check.breached).toBe(true)
  })

  it('DOS-314: a hold that was waiting when the owner stopped credit is approved by nobody — not the manager, not the owner — and rejecting it still works', async () => {
    const held = await place(rep, shop.held)
    expect(held.submitted.body.item.state).toBe('submitted')
    const [gate] = await pendingApprovals(held.id)
    expect(gate?.kind).toBe('credit_limit')
    await db.update(retailers).set({ creditMode: 'stop' }).where(eq(retailers.id, shop.held))

    for (const who of [manager, owner]) {
      const refused = await call<Refusal>(app, who, 'POST', `/approvals/${gate?.id ?? ''}/decide`, {
        idempotencyKey: `approve-${who.role}-${held.id}`,
        decision: 'approve',
      })
      expect(refused.status, JSON.stringify(refused.body)).toBe(409)
      expect(refused.body.data?.code).toBe('credit_stopped')
      expect(refused.body.message).toContain(
        `The owner has stopped credit for Credit Shop 6 ${run}`,
      )
      expect(refused.body.message).toContain('by the manager or by the owner')
      expect(refused.body.message).toContain('Reject it, or change the shop’s credit mode first.')
    }
    const [stillPending] = await pendingApprovals(held.id)
    expect(stillPending?.status).toBe('pending')

    const rejected = await call<{ order: Detail }>(
      app,
      manager,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `reject-${held.id}`, decision: 'reject', note: 'credit stopped' },
    )
    expect(rejected.status).toBe(200)
    expect(rejected.body.order.state).toBe('cancelled')

    // Changing the mode is what lifts it: back on strict, the shop orders (and is held) again.
    await db.update(retailers).set({ creditMode: 'strict' }).where(eq(retailers.id, shop.held))
    const again = await place(rep, shop.held)
    expect(again.submitted.status).toBe(200)
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-225 — pay on delivery

  it('DOS-225: a pay-on-delivery shop’s order is confirmed like a cash order and its bill says pay on delivery', async () => {
    const placed = await place(rep, shop.pod, 50)
    expect(placed.submitted.status).toBe(200)
    expect(placed.submitted.body.item.paymentTerms).toBe('ON')
    expect(placed.submitted.body.item.state).toBe('confirmed')
    expect(placed.submitted.body.item.approvalFlags).toEqual([])
    expect(placed.submitted.body.item.creditNotice).toBeNull()
    const check = await verdict(shop.pod, 50 * PIECE)
    expect(check.payOnDelivery).toBe(true)
    expect(check.breached).toBe(false)

    // An order marked "on delivery" for a shop on credit is still checked as credit: the shop decides.
    const sneaky = await place(rep, shop.strict, 50, { paymentTerms: 'ON' })
    expect(sneaky.submitted.body.item.state).toBe('submitted')
    expect(sneaky.submitted.body.item.approvalFlags).toContain('credit_limit')

    await db.update(salesOrders).set({ state: 'packed' }).where(eq(salesOrders.id, placed.id))
    const billId = await seedBill({
      retailerId: shop.pod,
      totalPaise: 50 * PIECE,
      dueOffsetDays: 0,
      orderId: placed.id,
    })
    const bill = await call<{ item: { paymentTerms?: string } }>(
      app,
      owner,
      'GET',
      `/invoices/${billId}`,
    )
    expect(bill.status, JSON.stringify(bill.body)).toBe(200)
    expect(bill.body.item.paymentTerms).toBe('ON')
  })

  it('DOS-225: a pay-on-delivery shop with credit stopped is held for the desk, and the desk may release it (no credit is given)', async () => {
    const placed = await place(rep, shop.podStop)
    expect(placed.submitted.status).toBe(200)
    expect(placed.submitted.body.item.state).toBe('submitted')
    expect(placed.submitted.body.item.approvalFlags).toEqual(['credit_limit'])
    expect(placed.submitted.body.item.creditNotice).toMatchObject({
      creditStopped: true,
      payOnDelivery: true,
    })
    const [gate] = await pendingApprovals(placed.id)
    const released = await call<{ order: Detail }>(
      app,
      manager,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `release-${placed.id}`, decision: 'approve' },
    )
    expect(released.status, JSON.stringify(released.body)).toBe(200)
    expect(released.body.order.state).toBe('confirmed')
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-315 — a deactivated shop

  it('DOS-315: a deactivated shop takes no new order from the rep, the desk, the shop’s own app, "order again" or a device upload; its open order can still be cancelled', async () => {
    // Before the owner deactivates it: one confirmed order and one draft.
    const open = await place(rep, shop.inactive)
    expect(open.submitted.body.item.state).toBe('confirmed')
    const draftId = uuidv7()
    const drafted = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `inactive-draft-${draftId}`,
      id: draftId,
      retailerId: shop.inactive,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(drafted.status).toBe(200)
    await db.update(retailers).set({ active: false }).where(eq(retailers.id, shop.inactive))
    const words = `Credit Shop 10 ${run} is deactivated and takes no new order. Its open orders can still be billed, delivered or cancelled; ask the owner to reactivate the shop to order again.`

    for (const who of [rep, owner, shopkeeper]) {
      const refused = await call<Refusal>(app, who, 'POST', '/orders', {
        idempotencyKey: `inactive-${who.role}-${run}`,
        id: uuidv7(),
        retailerId: shop.inactive,
        source: sourceOf(who),
        lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'piece' }],
      })
      expect(refused.status, `${who.role}: ${JSON.stringify(refused.body)}`).toBe(409)
      expect(refused.body.data?.code).toBe('shop_inactive')
      expect(refused.body.message).toBe(words)
    }
    const repeat = await call<Refusal>(app, rep, 'POST', '/orders/repeat-last', {
      idempotencyKey: `inactive-repeat-${run}`,
      id: uuidv7(),
      retailerId: shop.inactive,
      source: 'salesperson',
    })
    expect(repeat.status).toBe(409)
    expect(repeat.body.data?.code).toBe('shop_inactive')

    const submitOld = await call<Refusal>(app, rep, 'POST', `/orders/${draftId}/submit`, {
      idempotencyKey: `inactive-submit-${draftId}`,
    })
    expect(submitOld.status).toBe(409)
    expect(submitOld.body.data?.code).toBe('shop_inactive')

    const upload = await call<{
      accepted: number
      rejected: { code: string; messageEn: string }[]
    }>(app, rep, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `crd-device-${run}`,
      ops: [
        {
          opId: `op-${run}`,
          op: 'PUT',
          table: 'sales_orders',
          id: uuidv7(),
          data: { retailer_id: shop.inactive, source: 'salesperson', state: 'draft' },
        },
      ],
    })
    expect(upload.status, 'the upload door never answers 4xx').toBe(200)
    expect(upload.body.accepted).toBe(0)
    expect(upload.body.rejected[0]?.code).toBe('shop_inactive')
    expect(upload.body.rejected[0]?.messageEn).toBe(words)

    const cancelled = await call<{ item: Detail }>(
      app,
      owner,
      'POST',
      `/orders/${open.id}/cancel`,
      {
        idempotencyKey: `inactive-cancel-${run}`,
        reason: 'shop closed down',
      },
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.item.state).toBe('cancelled')
  })
})
