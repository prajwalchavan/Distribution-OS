/**
 * QA batch 1 regression probe — THROWAWAY, never committed.
 *
 * Question: when a rep's order is held on a rate request (bargain) plus another gate and the owner approves the
 * bargain, does the confirmed order line carry the approved rate? The SAME file runs at c5c6e03 (before batch 1)
 * and at 7f2e198 (main with batch 1). One scenario per decision path, each on its own order, plus two controls.
 *
 * The assertions state the product expectation (docs/22 §4: the server re-prices, so an approved rate is charged);
 * every scenario also prints a `PROBE <id> {json}` line with what actually happened, whatever the assertions say.
 */
import { asc, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { paise, percentOf, uuidv7 } from '@dos/domain'
import {
  approvals,
  bargainRequests,
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  reservations,
  retailers,
  salesOrderLines,
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
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { SyncModule } from '../sync/index.js'
import { OrdersModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const LIST = 5_117 // ₹51.17 a piece: SO-0897's Campa Cola 2 L list rate
const ASK = 4_554 // ₹45.54: the rate the rep asked and the owner approved on SO-0897
const CASE = 24
const GST_BPS = 1_200
const APPROVED_LINE_TOTAL = ASK * CASE + percentOf(paise(ASK * CASE), GST_BPS)
const LIST_LINE_TOTAL = LIST * CASE + percentOf(paise(LIST * CASE), GST_BPS)

type Placed = {
  orderId: string
  bargainId: string
  lineId: string
  rateAtCreate: number
  stateAtSubmit: string
  flagsAtSubmit: string[]
}
type Step = Record<string, unknown>

describeDb('bargain rate probe (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const hsn = `7${Date.now().toString().slice(-6)}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7()
  const strictShop = uuidv7() // credit mode strict, ₹10 limit: every order here also raises credit_limit
  const indicateShop = uuidv7() // credit mode indicate: the bargain is the only gate
  const variant = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))
  let app: NestFastifyApplication
  const results: Record<string, unknown>[] = []

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `bgp-${run}`, legalName: 'Bargain probe', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91907${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91907${run}2`, name: 'Manager' },
      { id: repId, phone: `+91907${run}3`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker bgp ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Campa', category: 'beverages' })
    await db.insert(productVariants).values({
      id: variant,
      productId,
      name: 'Campa Cola 2 L',
      netQty: 2,
      netUnit: 'l',
      defaultCaseSize: CASE,
      hsnCode: hsn,
      mrpPaise: 6_500,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId: variant, caseSizeOverride: CASE })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: GST_BPS, effectiveFrom: '2020-04-01' })
    await db.insert(retailers).values([
      {
        id: strictShop,
        tenantId,
        code: `BS-${run}`,
        name: `Strict shop ${run}`,
        phone: `+91908${run}1`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'strict',
        creditLimitPaise: 1_000,
      },
      {
        id: indicateShop,
        tenantId,
        code: `BI-${run}`,
        name: `Indicate shop ${run}`,
        phone: `+91908${run}2`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'indicate',
        creditLimitPaise: 0,
      },
    ])
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId: variant, ratePaise: LIST })

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    const godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    app = await bootTestApp([OrdersModule, InventoryModule, SyncModule])
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId: variant,
        batchNo: 'OPENING',
        mrpPaise: 6_500,
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `bgp-open-${run}`,
        },
      ])
    })
  })

  afterAll(async () => {
    console.log(`PROBE_SUMMARY ${JSON.stringify(results)}`)
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the actors' calls, exactly as the apps make them

  /** The sales app's order (DOS-005 network trace): ask a rate naming the order, create the order, submit it. */
  async function placeOrder(
    tag: string,
    retailerId: string,
    hooks: {
      afterAsk?: (bargainId: string) => Promise<Step>
      afterCreate?: (bargainId: string) => Promise<Step>
    } = {},
  ): Promise<{ placed: Placed; steps: Step[] }> {
    const steps: Step[] = []
    const orderId = uuidv7()
    const bargainId = uuidv7()
    const lineId = uuidv7()
    const asked = await call<{ item: { status: string } }>(app, rep, 'POST', '/pricing/bargains', {
      idempotencyKey: `bgp-ask-${tag}-${run}`,
      id: bargainId,
      retailerId,
      variantId: variant,
      askedRatePaise: ASK,
      qtyPcs: CASE,
      orderId,
    })
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')
    steps.push({ path: 'rep pricing.bargains.request', status: asked.status, bargain: asked.body.item.status })
    if (hooks.afterAsk) steps.push(await hooks.afterAsk(bargainId))
    const created = await call<{ item: { lines: { ratePaise: number }[] } }>(
      app,
      rep,
      'POST',
      '/orders',
      {
        idempotencyKey: `bgp-create-${tag}-${run}`,
        id: orderId,
        retailerId,
        source: 'salesperson',
        pricingDateMode: 'order',
        lines: [{ id: lineId, variantId: variant, enteredQty: 1, enteredUnit: 'case' }],
      },
    )
    expect(created.status).toBe(200)
    const rateAtCreate = created.body.item.lines[0]?.ratePaise ?? -1
    steps.push({ path: 'rep orders.create', status: created.status, ratePaise: rateAtCreate })
    if (hooks.afterCreate) steps.push(await hooks.afterCreate(bargainId))
    const submitted = await call<{ item: { state: string; approvalFlags: string[] } }>(
      app,
      rep,
      'POST',
      `/orders/${orderId}/submit`,
      { idempotencyKey: `bgp-submit-${tag}-${run}` },
    )
    expect(submitted.status).toBe(200)
    steps.push({
      path: 'rep orders.submit',
      status: submitted.status,
      state: submitted.body.item.state,
      flags: submitted.body.item.approvalFlags,
    })
    return {
      placed: {
        orderId,
        bargainId,
        lineId,
        rateAtCreate,
        stateAtSubmit: submitted.body.item.state,
        flagsAtSubmit: [...submitted.body.item.approvalFlags].sort(),
      },
      steps,
    }
  }

  async function pendingGate(orderId: string, kind: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.orderId, orderId))
      .orderBy(asc(approvals.id))
    return rows.find((r) => r.kind === kind && r.status === 'pending')?.id ?? null
  }

  /** Owner Approvals tab: approve one gate of the order. */
  async function approveGate(tag: string, orderId: string, kind: string): Promise<Step> {
    const id = await pendingGate(orderId, kind)
    if (!id) return { path: `owner orders.approvals.decide(${kind})`, skipped: 'no pending gate' }
    const res = await call<{ item: { status: string }; order: { state: string } | null }>(
      app,
      owner,
      'POST',
      `/approvals/${id}/decide`,
      {
        idempotencyKey: `bgp-gate-${kind}-${tag}-${run}`,
        decision: 'approve',
        note: `probe ${tag}: approve ${kind}`,
      },
    )
    return {
      path: `owner orders.approvals.decide(${kind})`,
      status: res.status,
      orderStateAfter: res.body.order?.state ?? null,
    }
  }

  /** Owner Rate requests tab: approve the bargain request itself (asked rate). */
  async function approveRateRequest(tag: string, bargainId: string): Promise<Step> {
    const res = await call<{ item?: { status: string; approvedRatePaise: number | null } }>(
      app,
      owner,
      'POST',
      `/pricing/bargains/${bargainId}/decide`,
      {
        idempotencyKey: `bgp-rate-${tag}-${run}`,
        id: bargainId,
        decision: 'approve',
        note: `probe ${tag}: rate ok`,
      },
    )
    return {
      path: 'owner pricing.bargains.decide',
      status: res.status,
      bargainStatusAfter: res.body.item?.status ?? null,
      approvedRatePaise: res.body.item?.approvedRatePaise ?? null,
    }
  }

  /** Manager's one-click Confirm on the order. */
  async function managerConfirm(tag: string, orderId: string): Promise<Step> {
    const res = await call<{
      item?: { state: string }
      message?: string
      data?: { code?: string }
    }>(app, manager, 'POST', `/orders/${orderId}/confirm`, {
      idempotencyKey: `bgp-confirm-${tag}-${run}`,
    })
    return {
      path: 'manager orders.confirm',
      status: res.status,
      orderStateAfter: res.body.item?.state ?? null,
      code: res.body.data?.code ?? null,
      message: res.status === 200 ? null : (res.body.message ?? null),
    }
  }

  async function snapshot(placed: Placed) {
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, placed.orderId))
    const [line] = await db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, placed.lineId))
    const gates = await db
      .select()
      .from(approvals)
      .where(eq(approvals.orderId, placed.orderId))
      .orderBy(asc(approvals.kind))
    const [bargain] = await db
      .select()
      .from(bargainRequests)
      .where(eq(bargainRequests.id, placed.bargainId))
    const held = await db
      .select()
      .from(reservations)
      .where(eq(reservations.orderLineId, placed.lineId))
    return {
      order: {
        state: order?.state,
        subtotalPaise: order?.subtotalPaise,
        discountPaise: order?.discountPaise,
        taxPaise: order?.taxPaise,
        totalPaise: order?.totalPaise,
      },
      line: {
        listRatePaise: line?.listRatePaise,
        ratePaise: line?.ratePaise,
        discountPaise: line?.discountPaise,
        taxPaise: line?.taxPaise,
        lineTotalPaise: line?.lineTotalPaise,
        appliedRules: line?.appliedRules ?? [],
        priceLocked: line?.priceLocked,
      },
      gates: gates.map((g) => `${g.kind}:${g.entityType}:${g.status}`),
      bargain: {
        status: bargain?.status,
        askedRatePaise: bargain?.askedRatePaise,
        approvedRatePaise: bargain?.approvedRatePaise,
      },
      reservedPcs: held.filter((r) => r.state === 'pending').reduce((n, r) => n + r.qty, 0),
    }
  }
  type Snap = Awaited<ReturnType<typeof snapshot>>

  function record(id: string, title: string, placed: Placed, steps: Step[], snap: Snap): void {
    const chargedAt =
      snap.line.ratePaise === ASK ? 'APPROVED' : snap.line.ratePaise === LIST ? 'LIST' : 'OTHER'
    const row = {
      id,
      title,
      chargedAt,
      rateAtCreate: placed.rateAtCreate,
      flagsAtSubmit: placed.flagsAtSubmit,
      steps,
      ...snap,
    }
    results.push(row)
    console.log(`PROBE ${id} ${JSON.stringify(row)}`)
  }

  /** The product expectation: the order confirmed and its line charged at the approved rate, with the bargain rule. */
  function expectApprovedRateCharged(snap: Snap): void {
    expect.soft(snap.order.state, 'order state').toBe('confirmed')
    expect.soft(snap.bargain.status, 'bargain_requests.status').toBe('approved')
    expect.soft(snap.bargain.approvedRatePaise, 'bargain_requests.approved_rate_paise').toBe(ASK)
    expect.soft(snap.line.ratePaise, 'sales_order_lines.rate_paise').toBe(ASK)
    expect
      .soft(snap.line.lineTotalPaise, 'sales_order_lines.line_total_paise')
      .toBe(APPROVED_LINE_TOTAL)
    expect
      .soft(
        snap.line.appliedRules.some((r) => r.kind === 'bargain'),
        'applied_rules carries a bargain rule',
      )
      .toBe(true)
    expect.soft(snap.reservedPcs, 'pieces reserved at confirm').toBe(CASE)
  }

  it('prints the two candidate outcomes', () => {
    console.log(
      `PROBE_EXPECT approved: rate ${ASK} line_total ${APPROVED_LINE_TOTAL} | list: rate ${LIST} line_total ${LIST_LINE_TOTAL}`,
    )
  })

  // ---------------------------------------------------------------------------------------------------------------
  // decision paths — the rep's order is held on a bargain + credit_limit (strict shop) unless stated

  it('S1 Approvals tab: bargain gate approved first, then the credit gate (the SO-0897 walk)', async () => {
    const { placed, steps } = await placeOrder('s1', strictShop)
    steps.push(await approveGate('s1', placed.orderId, 'bargain'))
    steps.push(await approveGate('s1', placed.orderId, 'credit_limit'))
    const snap = await snapshot(placed)
    record('S1', 'approvals: bargain gate, then credit gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['bargain', 'credit_limit'])
    expectApprovedRateCharged(snap)
  })

  it('S2 Approvals tab: credit gate approved first, the bargain gate last (its decision confirms)', async () => {
    const { placed, steps } = await placeOrder('s2', strictShop)
    steps.push(await approveGate('s2', placed.orderId, 'credit_limit'))
    steps.push(await approveGate('s2', placed.orderId, 'bargain'))
    const snap = await snapshot(placed)
    record('S2', 'approvals: credit gate, then bargain gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['bargain', 'credit_limit'])
    expectApprovedRateCharged(snap)
  })

  it('S3 Rate requests tab approves the request, then the Approvals tab clears the gates', async () => {
    const { placed, steps } = await placeOrder('s3', strictShop)
    steps.push(await approveRateRequest('s3', placed.bargainId))
    steps.push(await approveGate('s3', placed.orderId, 'bargain'))
    steps.push(await approveGate('s3', placed.orderId, 'credit_limit'))
    const snap = await snapshot(placed)
    record('S3', 'rate requests approve, then approvals: bargain gate, credit gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['bargain', 'credit_limit'])
    expectApprovedRateCharged(snap)
  })

  it("S4 Rate requests tab approves the request, then the manager's direct orders.confirm", async () => {
    const { placed, steps } = await placeOrder('s4', strictShop)
    steps.push(await approveRateRequest('s4', placed.bargainId))
    const confirm = await managerConfirm('s4', placed.orderId)
    steps.push(confirm)
    const snap = await snapshot(placed)
    record('S4', 'rate requests approve, then manager orders.confirm', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['bargain', 'credit_limit'])
    if (confirm.status === 409) {
      // path closed at this commit (DOS-020): nothing may have moved
      expect.soft(confirm.code, 'refusal code').toBe('approval_required')
      expect.soft(snap.order.state, 'order state after a refused confirm').toBe('submitted')
      expect.soft(snap.reservedPcs, 'nothing reserved').toBe(0)
      return
    }
    expectApprovedRateCharged(snap)
  })

  it('S5 bargain is the ONLY gate (indicate shop): approving it on the Approvals tab confirms the order', async () => {
    const { placed, steps } = await placeOrder('s5', indicateShop)
    steps.push(await approveGate('s5', placed.orderId, 'bargain'))
    const snap = await snapshot(placed)
    record('S5', 'single bargain gate, approvals: bargain gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['bargain'])
    expectApprovedRateCharged(snap)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // controls: the approval lands before the order's lines are, or before submit

  it('C1 control: the request is approved BEFORE the rep creates the order, then the credit gate', async () => {
    const { placed, steps } = await placeOrder('c1', strictShop, {
      afterAsk: (bargainId) => approveRateRequest('c1', bargainId),
    })
    steps.push(await approveGate('c1', placed.orderId, 'credit_limit'))
    const snap = await snapshot(placed)
    record('C1', 'rate approved before create, then approvals: credit gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['credit_limit'])
    expectApprovedRateCharged(snap)
  })

  it('C2 control: the request is approved AFTER create but BEFORE submit, then the credit gate', async () => {
    const { placed, steps } = await placeOrder('c2', strictShop, {
      afterCreate: (bargainId) => approveRateRequest('c2', bargainId),
    })
    steps.push(await approveGate('c2', placed.orderId, 'credit_limit'))
    const snap = await snapshot(placed)
    record('C2', 'rate approved between create and submit, then approvals: credit gate', placed, steps, snap)
    expect.soft(placed.flagsAtSubmit, 'gates at submit').toEqual(['credit_limit'])
    expectApprovedRateCharged(snap)
  })
})
