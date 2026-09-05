import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StatementDetail, TargetDetail, TargetSummary } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  achievements,
  bootstrapTenant,
  brands,
  computedPayouts,
  createDb,
  createPool,
  manufacturers,
  memberships,
  outboxEvents,
  productVariants,
  products,
  receipts,
  retailers,
  salesOrderLines,
  salesOrders,
  targets,
  tenants,
  users,
  visits,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { IncentivesModule, recomputeAchievement, sweepAchievements } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type TargetItem = { item: TargetDetail }
type StatementItem = { item: StatementDetail }

/**
 * Incentives (docs/plans/incentives.md §5). Fixtures are inserted with `@dos/db` directly rather than
 * through the orders / retailers / receivables APIs, because what is under test is the ACHIEVEMENT
 * ARITHMETIC over those rows — every number below is hand-computed from the fixture, so a wrong
 * aggregate cannot hide behind a wrong fixture.
 *
 * THE WINDOW. The period is a fixed calendar month in the past, and every source row carries an
 * explicit instant inside or outside it, so the spec is stable whatever day it runs on. Orders are
 * dated by `confirmed_at` (what "booked" means, see `orders/sales-aggregate.ts`).
 */
describeDb('incentives (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repAId = uuidv7()
  const repBId = uuidv7()
  const crewId = uuidv7()
  const storeId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const repA: Actor = { tenantId, actorId: repAId, role: 'salesperson' }
  const repB: Actor = { tenantId, actorId: repBId, role: 'salesperson' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const brandX = uuidv7()
  const brandY = uuidv7()
  const variantX = uuidv7()
  const variantY = uuidv7()
  const retailer1 = uuidv7()
  const retailer2 = uuidv7()

  /** The period every target in this spec covers, and the day the sources sit in. */
  const FROM = '2026-05-01'
  const TO = '2026-05-31'
  const INSIDE = new Date('2026-05-14T09:00:00.000+05:30')
  const BEFORE = new Date('2026-04-28T09:00:00.000+05:30')

  /** Hand-computed from the fixture below (see `seedOrder` calls). */
  const REP_A_VALUE = 300_000 + 200_000 + 100_000 // brand X + brand X + brand Y, all confirmed
  const REP_A_BRAND_X_VALUE = 300_000 + 200_000
  const REP_A_PIECES = 30 + 20 + 10
  const REP_A_LINES = 3
  const REP_A_OUTLETS = 2
  const REP_A_VISITS = 2 // two completed calls; a third is still open and one is out of the window
  const CREW_COLLECTED = 40_000 + 25_000 // collected + deposited; a bounced one and repA's do not count

  let app: NestFastifyApplication

  const ctxFor = (
    role: TenantContext['actorRole'],
    actorId: string,
    tid = tenantId,
  ): TenantContext => ({ tenantId: tid, actorId, actorRole: role })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  /** Three slabs, the demo table: 0.5% at 80% of target, 1% at par, 1.5% past 120%. */
  const valueSlabs = [
    { fromPct: 8_000, toPct: 10_000, payoutBps: 50 },
    { fromPct: 10_000, toPct: 12_000, payoutBps: 100 },
    { fromPct: 12_000, toPct: null, payoutBps: 150 },
  ]
  const flatSlabs = [
    { fromPct: 5_000, toPct: 10_000, flatPaise: 50_000 },
    { fromPct: 10_000, toPct: null, flatPaise: 200_000 },
  ]

  const key = (name: string) => `inc-${run}-${name}`

  /**
   * Windows for the tests that only care WHETHER a target may be created. The arithmetic tests own
   * May, and two targets of the same (user, brand, metric) may not share an overlapping period — so
   * a rule test that reused May would refuse itself and look like a broken aggregate.
   */
  const NOVEMBER = { periodFrom: '2026-11-01', periodTo: '2026-11-30' }
  const SEPTEMBER = { periodFrom: '2026-09-01', periodTo: '2026-09-30' }

  async function seedOrder(input: {
    id: string
    salespersonId: string | null
    createdBy: string
    retailerId: string
    state: 'confirmed' | 'draft' | 'cancelled'
    at: Date
    lines: { variantId: string; qtyPcs: number; totalPaise: number }[]
  }): Promise<void> {
    await db.insert(salesOrders).values({
      id: input.id,
      tenantId,
      retailerId: input.retailerId,
      state: input.state,
      source: input.salespersonId ? 'salesperson' : 'van_sale',
      createdBy: input.createdBy,
      salespersonId: input.salespersonId,
      paymentTerms: 'POST_FULFILLMENT',
      confirmedAt: input.state === 'confirmed' ? input.at : null,
      createdAt: input.at,
      updatedAt: input.at,
    })
    await db.insert(salesOrderLines).values(
      input.lines.map((l, i) => ({
        id: uuidv7(),
        tenantId,
        orderId: input.id,
        lineNo: i + 1,
        variantId: l.variantId,
        enteredQty: l.qtyPcs,
        qtyPcs: l.qtyPcs,
        listRatePaise: 1_000,
        ratePaise: 1_000,
        gstBps: 1_200,
        lineTotalPaise: l.totalPaise,
      })),
    )
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `inc-${run}`, legalName: 'Incentives test', stateCode: '27' },
      { id: otherTenantId, slug: `inc-o-${run}`, legalName: 'Other distributor', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91916${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91916${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91916${run}3`, name: 'Accountant' },
      { id: repAId, phone: `+91916${run}4`, name: 'Rep A' },
      { id: repBId, phone: `+91916${run}5`, name: 'Rep B' },
      { id: crewId, phone: `+91916${run}6`, name: 'Crew' },
      { id: storeId, phone: `+91916${run}7`, name: 'Store' },
      { id: shopUserId, phone: `+91916${run}8`, name: 'Shop' },
      { id: otherOwnerId, phone: `+91916${run}9`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repAId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: repBId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)

    const manufacturerId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker inc ${run}` })
    await db.insert(brands).values([
      { id: brandX, manufacturerId, name: `Brand X ${run}` },
      { id: brandY, manufacturerId, name: `Brand Y ${run}` },
    ])
    const px = uuidv7()
    const py = uuidv7()
    await db.insert(products).values([
      { id: px, manufacturerId, brandId: brandX, name: 'Cola' },
      { id: py, manufacturerId, brandId: brandY, name: 'Chips' },
    ])
    await db.insert(productVariants).values([
      {
        id: variantX,
        productId: px,
        name: 'Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: '2202',
      },
      {
        id: variantY,
        productId: py,
        name: 'Chips 70 g',
        netQty: 70,
        netUnit: 'g',
        defaultCaseSize: 120,
        hsnCode: '2005',
      },
    ])
    await db.insert(retailers).values([
      {
        id: retailer1,
        tenantId,
        code: `S1-${run}`,
        name: `Shop one ${run}`,
        phone: `+91915${run}1`,
        stateCode: '27',
      },
      {
        id: retailer2,
        tenantId,
        code: `S2-${run}`,
        name: `Shop two ${run}`,
        phone: `+91915${run}2`,
        stateCode: '27',
      },
    ])

    // --- the order book rep A is measured on ---------------------------------------------------
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer1,
      state: 'confirmed',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 30, totalPaise: 300_000 }],
    })
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer2,
      state: 'confirmed',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 20, totalPaise: 200_000 }],
    })
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer1,
      state: 'confirmed',
      at: INSIDE,
      lines: [{ variantId: variantY, qtyPcs: 10, totalPaise: 100_000 }],
    })
    // Excluded, each for its own reason: never confirmed, cancelled, and outside the window.
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer1,
      state: 'draft',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 999, totalPaise: 9_999_999 }],
    })
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer1,
      state: 'cancelled',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 888, totalPaise: 8_888_888 }],
    })
    await seedOrder({
      id: uuidv7(),
      salespersonId: repAId,
      createdBy: repAId,
      retailerId: retailer1,
      state: 'confirmed',
      at: BEFORE,
      lines: [{ variantId: variantX, qtyPcs: 777, totalPaise: 7_777_777 }],
    })
    // Rep B's own book, so "only my rows" is a real assertion and not an empty set.
    await seedOrder({
      id: uuidv7(),
      salespersonId: repBId,
      createdBy: repBId,
      retailerId: retailer2,
      state: 'confirmed',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 5, totalPaise: 50_000 }],
    })
    // A van sale: no salesperson on the order at all, so the crew member who keyed it is credited.
    await seedOrder({
      id: uuidv7(),
      salespersonId: null,
      createdBy: crewId,
      retailerId: retailer1,
      state: 'confirmed',
      at: INSIDE,
      lines: [{ variantId: variantX, qtyPcs: 8, totalPaise: 80_000 }],
    })

    // --- visits: two completed inside the window, one still open, one before it ------------------
    await db.insert(visits).values([
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        userId: repAId,
        startedAt: INSIDE,
        endedAt: INSIDE,
        outcome: 'ordered',
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer2,
        userId: repAId,
        startedAt: INSIDE,
        endedAt: INSIDE,
        outcome: 'no_order',
      },
      // Still open: the rep checked in and never checked out — not a call made.
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        userId: repAId,
        startedAt: INSIDE,
        endedAt: null,
        outcome: null,
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        userId: repAId,
        startedAt: BEFORE,
        endedAt: BEFORE,
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        userId: repBId,
        startedAt: INSIDE,
        endedAt: INSIDE,
      },
    ])

    // --- receipts: only the crew's own, only collected/deposited, only inside the window ---------
    await db.insert(receipts).values([
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        mode: 'cash',
        amountPaise: 40_000,
        receivedAt: INSIDE,
        receivedBy: crewId,
        status: 'collected',
        idempotencyKey: key('rc1'),
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer2,
        mode: 'upi',
        amountPaise: 25_000,
        receivedAt: INSIDE,
        receivedBy: crewId,
        status: 'deposited',
        idempotencyKey: key('rc2'),
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        mode: 'cheque',
        amountPaise: 99_000,
        receivedAt: INSIDE,
        receivedBy: crewId,
        status: 'bounced',
        idempotencyKey: key('rc3'),
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        mode: 'cash',
        amountPaise: 77_000,
        receivedAt: BEFORE,
        receivedBy: crewId,
        status: 'collected',
        idempotencyKey: key('rc4'),
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: retailer1,
        mode: 'cash',
        amountPaise: 66_000,
        receivedAt: INSIDE,
        receivedBy: ownerId,
        status: 'collected',
        idempotencyKey: key('rc5'),
      },
    ])

    app = await bootTestApp([IncentivesModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const upsertBody = (over: Record<string, unknown> = {}) => ({
    idempotencyKey: key(typeof over.id === 'string' ? over.id : 'x'),
    id: uuidv7(),
    userId: repAId,
    metric: 'value',
    periodFrom: FROM,
    periodTo: TO,
    targetValue: 1_000_000,
    payoutRule: valueSlabs,
    ...over,
  })

  // =============================================================================================
  // assigning a target
  // =============================================================================================

  it('creates a target and refuses a user who is not an active field member', async () => {
    const id = uuidv7()
    const created = await call<TargetItem>(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id, metric: 'pieces', targetValue: 100, payoutRule: flatSlabs, ...NOVEMBER }),
      name: 'Pieces, November',
    })
    expect(created.status).toBe(200)
    expect(created.body.item.id).toBe(id)
    expect(created.body.item.userName).toBe('Rep A')
    expect(created.body.item.createdBy).toBe(ownerId)
    expect(created.body.item.achievement).toBeNull()

    for (const [who, userId] of [
      ['the owner', ownerId],
      ['a warehouse hand', storeId],
      ['a shopkeeper', shopUserId],
    ] as const) {
      const res = await call<{ message?: string }>(app, owner, 'POST', '/incentives/targets', {
        ...upsertBody({
          id: uuidv7(),
          userId,
          metric: 'pieces',
          targetValue: 10,
          payoutRule: flatSlabs,
        }),
      })
      expect(res.status, who).toBe(400)
    }
    // A stranger's user id is not a member of THIS tenant either.
    const outsider = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        userId: otherOwnerId,
        metric: 'pieces',
        targetValue: 10,
        payoutRule: flatSlabs,
      }),
    })
    expect(outsider.status).toBe(400)
  })

  it('refuses a beat metric for a crew member, and payoutBps off a money metric', async () => {
    for (const metric of ['visits', 'outlets'] as const) {
      const res = await call(app, owner, 'POST', '/incentives/targets', {
        ...upsertBody({
          id: uuidv7(),
          userId: crewId,
          metric,
          targetValue: 20,
          payoutRule: flatSlabs,
        }),
      })
      expect(res.status, metric).toBe(400)
    }
    // The crew CAN hold a value target (van sales) — the refusal is about the beat, not the role.
    const ok = await call<TargetItem>(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        userId: crewId,
        metric: 'value',
        targetValue: 100_000,
        ...NOVEMBER,
      }),
    })
    expect(ok.status).toBe(200)
    // `payoutBps` is a share of the target's paise: the schema refuses it on a count metric.
    const bad = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id: uuidv7(), metric: 'lines', targetValue: 10, payoutRule: valueSlabs }),
    })
    expect(bad.status).toBe(400)
  })

  it('refuses an overlapping (user, brand, metric) target and allows a different scope', async () => {
    const first = await call<TargetItem>(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        metric: 'outlets',
        targetValue: 5,
        payoutRule: flatSlabs,
        ...SEPTEMBER,
      }),
    })
    expect(first.status).toBe(200)
    const clash = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        metric: 'outlets',
        targetValue: 6,
        payoutRule: flatSlabs,
        periodFrom: '2026-09-15',
        periodTo: '2026-10-15',
      }),
    })
    expect(clash.status).toBe(409)
    // Same metric, different brand: a different target, not a competing one.
    const scoped = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        metric: 'outlets',
        targetValue: 6,
        payoutRule: flatSlabs,
        brandId: brandX,
        ...SEPTEMBER,
      }),
    })
    expect(scoped.status).toBe(200)
    // Same everything, a period that does not intersect: allowed.
    const later = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: uuidv7(),
        metric: 'outlets',
        targetValue: 7,
        payoutRule: flatSlabs,
        periodFrom: '2026-12-01',
        periodTo: '2026-12-31',
      }),
    })
    expect(later.status).toBe(200)
  })

  it('bulk-assigns a team in one transaction, and one bad row aborts the whole batch', async () => {
    const good = [uuidv7(), uuidv7()]
    const ok = await call<{ items: TargetDetail[] }>(
      app,
      owner,
      'POST',
      '/incentives/targets/bulk',
      {
        idempotencyKey: key('bulk-ok'),
        assignments: [
          { id: good[0] as string, userId: repAId },
          { id: good[1] as string, userId: repBId },
        ],
        metric: 'value',
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        targetValue: 1_000_000,
        name: 'June, the whole team',
        payoutRule: valueSlabs,
      },
    )
    expect(ok.status).toBe(200)
    expect(ok.body.items.map((i) => i.userId).sort()).toEqual([repAId, repBId].sort())

    const doomed = [uuidv7(), uuidv7(), uuidv7()]
    const bad = await call(app, owner, 'POST', '/incentives/targets/bulk', {
      idempotencyKey: key('bulk-bad'),
      assignments: [
        { id: doomed[0] as string, userId: repAId },
        { id: doomed[1] as string, userId: shopUserId }, // a shopkeeper: not a field member
        { id: doomed[2] as string, userId: repBId },
      ],
      metric: 'value',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      targetValue: 1_000_000,
      payoutRule: valueSlabs,
    })
    expect(bad.status).toBe(400)
    const written = await as(ctxFor('owner', ownerId), (tx) =>
      tx
        .select({ id: targets.id })
        .from(targets)
        .where(sql`${targets.id} in ${doomed}`),
    )
    expect(written).toHaveLength(0)
  })

  // =============================================================================================
  // achievement
  // =============================================================================================

  it('computes value, pieces, lines, outlets and a brand scope from the order book', async () => {
    const wide = uuidv7()
    const scoped = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/incentives/targets', {
          ...upsertBody({ id: wide, targetValue: REP_A_VALUE, name: 'All brands' }),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, owner, 'POST', '/incentives/targets', {
          ...upsertBody({
            id: scoped,
            targetValue: REP_A_BRAND_X_VALUE,
            brandId: brandX,
            name: 'Brand X',
          }),
        })
      ).status,
    ).toBe(200)
    const wideFigures = await recomputeAchievement(db, { tenantId, targetId: wide })
    const scopedFigures = await recomputeAchievement(db, { tenantId, targetId: scoped })

    expect(wideFigures).toMatchObject({
      achievedValue: REP_A_VALUE,
      achievedPieces: REP_A_PIECES,
      achievedPct: 10_000,
    })
    // The brand scope excludes brand Y's line from value AND from pieces.
    expect(scopedFigures).toMatchObject({
      achievedValue: REP_A_BRAND_X_VALUE,
      achievedPieces: 50,
      achievedPct: 10_000,
    })

    const pieces = uuidv7()
    const lines = uuidv7()
    const outlets = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: pieces,
        metric: 'pieces',
        targetValue: REP_A_PIECES,
        payoutRule: flatSlabs,
      }),
    })
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: lines,
        metric: 'lines',
        targetValue: REP_A_LINES,
        payoutRule: flatSlabs,
      }),
    })
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: outlets,
        metric: 'outlets',
        targetValue: REP_A_OUTLETS,
        payoutRule: flatSlabs,
      }),
    })
    expect((await recomputeAchievement(db, { tenantId, targetId: pieces }))?.achievedValue).toBe(
      REP_A_PIECES,
    )
    expect((await recomputeAchievement(db, { tenantId, targetId: lines }))?.achievedValue).toBe(
      REP_A_LINES,
    )
    expect((await recomputeAchievement(db, { tenantId, targetId: outlets }))?.achievedValue).toBe(
      REP_A_OUTLETS,
    )
  })

  it('counts only COMPLETED visits, and only the receipts that user actually took', async () => {
    const visitsTarget = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: visitsTarget,
        metric: 'visits',
        targetValue: REP_A_VISITS,
        payoutRule: flatSlabs,
      }),
    })
    const v = await recomputeAchievement(db, { tenantId, targetId: visitsTarget })
    // Two completed calls: the still-open one and the one before the window do not count, and rep B's
    // call is not rep A's.
    expect(v?.achievedValue).toBe(REP_A_VISITS)

    const collections = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: collections,
        userId: crewId,
        metric: 'collections',
        targetValue: CREW_COLLECTED,
        payoutRule: flatSlabs,
      }),
    })
    const c = await recomputeAchievement(db, { tenantId, targetId: collections })
    // The bounced cheque was never money, the April one is outside the window, and the owner's
    // office receipt belongs to the owner.
    expect(c?.achievedValue).toBe(CREW_COLLECTED)
  })

  it('credits a van sale to the crew member who keyed it (the order names no rep)', async () => {
    const vanTarget = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id: vanTarget, userId: crewId, metric: 'value', targetValue: 80_000 }),
    })
    const figures = await recomputeAchievement(db, { tenantId, targetId: vanTarget })
    expect(figures).toMatchObject({ achievedValue: 80_000, achievedPieces: 8, achievedPct: 10_000 })
  })

  it('refresh queues a recompute and writes no achievement itself', async () => {
    const id = uuidv7()
    const created = await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id, userId: repBId, metric: 'lines', targetValue: 1, payoutRule: flatSlabs }),
    })
    expect(created.status).toBe(200)
    const before = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, id)),
    )
    expect(before).toHaveLength(0)

    const queued = await call<{ status: string }>(
      app,
      owner,
      'POST',
      `/incentives/targets/${id}/refresh`,
      { idempotencyKey: key(`refresh-${id}`), id },
    )
    expect(queued.status).toBe(200)
    expect(queued.body.status).toBe('queued')

    // Still nothing: the request records the ASK, the worker does the work as the system actor.
    const after = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, id)),
    )
    expect(after).toHaveLength(0)
    const events = await db
      .select({ eventType: outboxEvents.eventType })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.aggregateId, id)))
    expect(events.map((e) => e.eventType)).toContain('IncentiveAchievementRecomputeRequested')

    // What the worker then does, once, is what fills it in.
    await recomputeAchievement(db, { tenantId, targetId: id })
    const filled = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, id)),
    )
    expect(filled).toHaveLength(1)
    expect(filled[0]?.achievedValue).toBe(1) // rep B booked exactly one line in the window
  })

  it('the sweep recomputes every OPEN target and leaves closed periods alone', async () => {
    const openTarget = uuidv7()
    const today = new Date().toISOString().slice(0, 10)
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: openTarget,
        userId: repBId,
        metric: 'lines',
        targetValue: 4,
        payoutRule: flatSlabs,
        periodFrom: today,
        periodTo: today,
      }),
    })
    const result = await sweepAchievements(db, { today })
    expect(result.targets).toBeGreaterThan(0)
    const written = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, openTarget)),
    )
    expect(written).toHaveLength(1)
    // Idempotent by upsert: a second pass reproduces the row, never a second one.
    await sweepAchievements(db, { today })
    const again = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, openTarget)),
    )
    expect(again).toHaveLength(1)
  })

  // =============================================================================================
  // progress
  // =============================================================================================

  it('progress.mine returns only the caller own targets, never another rep', async () => {
    const mine = await call<{ items: TargetDetail[] }>(app, repA, 'GET', '/incentives/progress', {
      activeOnly: false,
      limit: 200,
    })
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(0)
    expect(mine.body.items.every((t) => t.userId === repAId)).toBe(true)

    const theirs = await call<{ items: TargetDetail[] }>(app, repB, 'GET', '/incentives/progress', {
      activeOnly: false,
      limit: 200,
    })
    expect(theirs.body.items.every((t) => t.userId === repBId)).toBe(true)

    // The list is scoped the same way even when the rep asks for someone else by id.
    const list = await call<{ items: TargetSummary[] }>(app, repA, 'GET', '/incentives/targets', {
      userId: repBId,
      activeOnly: false,
      limit: 200,
    })
    expect(list.body.items).toHaveLength(0)
  })

  it('progress.team ranks one metric by achievement and excludes every other', async () => {
    const window = { periodFrom: '2026-03-01', periodTo: '2026-03-31' }
    const high = uuidv7()
    const low = uuidv7()
    const otherMetric = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id: high, userId: repAId, targetValue: 500_000, ...window }),
    })
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({ id: low, userId: repBId, targetValue: 5_000_000, ...window }),
    })
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: otherMetric,
        userId: crewId,
        metric: 'pieces',
        targetValue: 10,
        payoutRule: flatSlabs,
        ...window,
      }),
    })
    // Achievements written by hand: the March window holds no orders, so the ranking is about the
    // cache, not about re-deriving the numbers.
    await as(ctxFor('system', 'system'), async (tx) => {
      await tx.insert(achievements).values([
        { id: uuidv7(), tenantId, targetId: high, achievedValue: 400_000, achievedPct: 8_000 },
        { id: uuidv7(), tenantId, targetId: low, achievedValue: 500_000, achievedPct: 1_000 },
      ])
    })
    const team = await call<{ items: { userId: string; rank: number; achievedPct: number }[] }>(
      app,
      manager,
      'GET',
      '/incentives/progress/team',
      { metric: 'value', ...window, limit: 50 },
    )
    expect(team.status).toBe(200)
    const rows = team.body.items.filter((r) => [repAId, repBId, crewId].includes(r.userId))
    expect(rows.map((r) => r.userId)).toEqual([repAId, repBId])
    expect(rows[0]?.rank).toBe(1)
    expect(rows[0]?.achievedPct).toBe(8_000)
    expect(rows[1]?.achievedPct).toBe(1_000)
    // `pieces` is a different question: the crew's target is not zero-filled into this leaderboard.
    expect(team.body.items.some((r) => r.userId === crewId)).toBe(false)
  })

  it('whatIf pays the right slab at each boundary and writes nothing', async () => {
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(achievements)
      .where(eq(achievements.tenantId, tenantId))
    const beforePayouts = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(computedPayouts)
      .where(eq(computedPayouts.tenantId, tenantId))

    const at = async (achievedValue: number) =>
      (
        await call<{ achievedPct: number; payoutPaise: number; matchedSlab: unknown }>(
          app,
          owner,
          'POST',
          '/incentives/targets/what-if',
          { metric: 'value', targetValue: 1_000_000, payoutRule: valueSlabs, achievedValue },
        )
      ).body
    expect(await at(799_900)).toMatchObject({
      achievedPct: 7_999,
      payoutPaise: 0,
      matchedSlab: null,
    })
    expect(await at(800_000)).toMatchObject({ achievedPct: 8_000, payoutPaise: 5_000 })
    expect(await at(1_000_000)).toMatchObject({ achievedPct: 10_000, payoutPaise: 10_000 })
    expect(await at(1_200_000)).toMatchObject({ achievedPct: 12_000, payoutPaise: 15_000 })
    // No extrapolation above the top slab: 300% pays exactly what 120% pays.
    expect(await at(3_000_000)).toMatchObject({ achievedPct: 30_000, payoutPaise: 15_000 })

    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(achievements)
      .where(eq(achievements.tenantId, tenantId))
    const afterPayouts = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(computedPayouts)
      .where(eq(computedPayouts.tenantId, tenantId))
    expect(after[0]?.n).toBe(before[0]?.n)
    expect(afterPayouts[0]?.n).toBe(beforePayouts[0]?.n)
  })

  // =============================================================================================
  // statements
  // =============================================================================================

  it('sums every target of the period into one statement, and is idempotent per period', async () => {
    const from = '2026-02-01'
    const to = '2026-02-28'
    const a = uuidv7()
    const b = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: a,
        userId: repBId,
        targetValue: 1_000_000,
        periodFrom: from,
        periodTo: to,
        name: 'Value',
      }),
    })
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: b,
        userId: repBId,
        metric: 'lines',
        targetValue: 100,
        payoutRule: flatSlabs,
        periodFrom: from,
        periodTo: to,
        name: 'Lines',
      }),
    })
    await as(ctxFor('system', 'system'), async (tx) => {
      await tx.insert(achievements).values([
        // 100% of a ₹10,000 target on the 1% slab = ₹100.
        { id: uuidv7(), tenantId, targetId: a, achievedValue: 1_000_000, achievedPct: 10_000 },
        // 60% of 100 lines: the 50–100% flat slab = ₹500.
        { id: uuidv7(), tenantId, targetId: b, achievedValue: 60, achievedPct: 6_000 },
      ])
    })
    const statementId = uuidv7()
    const first = await call<StatementItem>(
      app,
      manager,
      'POST',
      '/incentives/statements/compute',
      {
        idempotencyKey: key('compute-1'),
        id: statementId,
        userId: repBId,
        periodFrom: from,
        periodTo: to,
      },
    )
    expect(first.status).toBe(200)
    expect(first.body.item.amountPaise).toBe(10_000 + 50_000)
    expect(first.body.item.breakdown).toHaveLength(2)
    expect(first.body.item.breakdown.map((r) => r.payoutPaise).sort((x, y) => x - y)).toEqual([
      10_000, 50_000,
    ])
    expect(first.body.item.approvedBy).toBeNull()

    // ONE row per (user, period): a second compute under a different key updates it in place.
    const second = await call<StatementItem>(
      app,
      accountant,
      'POST',
      '/incentives/statements/compute',
      {
        idempotencyKey: key('compute-2'),
        id: uuidv7(),
        userId: repBId,
        periodFrom: from,
        periodTo: to,
      },
    )
    expect(second.status).toBe(200)
    expect(second.body.item.id).toBe(statementId)
    expect(second.body.item.amountPaise).toBe(60_000)
    const rows = await as(ctxFor('owner', ownerId), (tx) =>
      tx
        .select({ id: computedPayouts.id })
        .from(computedPayouts)
        .where(
          and(
            eq(computedPayouts.tenantId, tenantId),
            eq(computedPayouts.userId, repBId),
            eq(computedPayouts.periodFrom, from),
          ),
        ),
    )
    expect(rows).toHaveLength(1)

    // A replay of the SAME key returns the stored response and writes nothing new.
    const replay = await call<StatementItem>(
      app,
      manager,
      'POST',
      '/incentives/statements/compute',
      {
        idempotencyKey: key('compute-1'),
        id: statementId,
        userId: repBId,
        periodFrom: from,
        periodTo: to,
      },
    )
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(statementId)

    // A rep with no target in that exact period is a 400, not an empty ₹0 statement.
    const none = await call(app, manager, 'POST', '/incentives/statements/compute', {
      idempotencyKey: key('compute-none'),
      id: uuidv7(),
      userId: crewId,
      periodFrom: from,
      periodTo: to,
    })
    expect(none.status).toBe(400)
  })

  it('an approved statement is immutable until the owner reopens it', async () => {
    const from = '2026-01-01'
    const to = '2026-01-31'
    const target = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: target,
        userId: repAId,
        targetValue: 1_000_000,
        periodFrom: from,
        periodTo: to,
      }),
    })
    await as(ctxFor('system', 'system'), (tx) =>
      tx.insert(achievements).values({
        id: uuidv7(),
        tenantId,
        targetId: target,
        achievedValue: 1_000_000,
        achievedPct: 10_000,
      }),
    )
    const statementId = uuidv7()
    const computed = await call<StatementItem>(
      app,
      owner,
      'POST',
      '/incentives/statements/compute',
      {
        idempotencyKey: key('imm-compute'),
        id: statementId,
        userId: repAId,
        periodFrom: from,
        periodTo: to,
      },
    )
    expect(computed.status).toBe(200)
    expect(computed.body.item.amountPaise).toBe(10_000)

    const approved = await call<StatementItem>(
      app,
      owner,
      'POST',
      `/incentives/statements/${statementId}/approve`,
      { idempotencyKey: key('imm-approve'), id: statementId },
    )
    expect(approved.status).toBe(200)
    expect(approved.body.item.approvedBy).toBe(ownerId)
    expect(approved.body.item.approvedAt).not.toBeNull()

    const again = await call(app, owner, 'POST', `/incentives/statements/${statementId}/approve`, {
      idempotencyKey: key('imm-approve-2'),
      id: statementId,
    })
    expect(again.status).toBe(409)

    // The number is frozen: recomputing an approved statement is refused, not silently applied.
    await as(ctxFor('system', 'system'), (tx) =>
      tx
        .update(achievements)
        .set({ achievedValue: 3_000_000, achievedPct: 30_000 })
        .where(eq(achievements.targetId, target)),
    )
    const blocked = await call(app, owner, 'POST', '/incentives/statements/compute', {
      idempotencyKey: key('imm-recompute'),
      id: uuidv7(),
      userId: repAId,
      periodFrom: from,
      periodTo: to,
    })
    expect(blocked.status).toBe(409)

    const reopened = await call<StatementItem>(
      app,
      owner,
      'POST',
      `/incentives/statements/${statementId}/reopen`,
      { idempotencyKey: key('imm-reopen'), id: statementId, reason: 'Slab was wrong' },
    )
    expect(reopened.status).toBe(200)
    expect(reopened.body.item.approvedBy).toBeNull()

    const recomputed = await call<StatementItem>(
      app,
      owner,
      'POST',
      '/incentives/statements/compute',
      {
        idempotencyKey: key('imm-recompute-2'),
        id: uuidv7(),
        userId: repAId,
        periodFrom: from,
        periodTo: to,
      },
    )
    expect(recomputed.status).toBe(200)
    expect(recomputed.body.item.amountPaise).toBe(15_000) // 300%: the top slab, not extrapolated
  })

  it('a rep reads its own statement, including before it is approved, and no other rep', async () => {
    const mine = await call<{ items: { userId: string }[] }>(
      app,
      repB,
      'GET',
      '/incentives/statements',
      { limit: 50 },
    )
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(0)
    expect(mine.body.items.every((s) => s.userId === repBId)).toBe(true)

    const others = await call<{ items: unknown[] }>(app, repB, 'GET', '/incentives/statements', {
      userId: repAId,
      limit: 50,
    })
    expect(others.body.items).toHaveLength(0)
  })

  // =============================================================================================
  // removing
  // =============================================================================================

  it('removes a target, refuses once a statement covers its period, and clears the cache row', async () => {
    const from = '2026-04-01'
    const to = '2026-04-30'
    const target = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: target,
        userId: repAId,
        targetValue: 1_000_000,
        periodFrom: from,
        periodTo: to,
      }),
    })
    await recomputeAchievement(db, { tenantId, targetId: target })
    const cached = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, target)),
    )
    expect(cached).toHaveLength(1)

    // Before any statement: the delete goes through and takes the worker's cache row with it.
    const removed = await call<{ removed: boolean }>(
      app,
      owner,
      'POST',
      `/incentives/targets/${target}/remove`,
      { idempotencyKey: key('rm-1'), id: target, reason: 'Wrong rep' },
    )
    expect(removed.status).toBe(200)
    expect(removed.body.removed).toBe(true)
    const gone = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, target)),
    )
    expect(gone).toHaveLength(0)

    // Now the same period, with a statement standing against it.
    const covered = uuidv7()
    await call(app, owner, 'POST', '/incentives/targets', {
      ...upsertBody({
        id: covered,
        userId: repAId,
        targetValue: 1_000_000,
        periodFrom: from,
        periodTo: to,
      }),
    })
    await call(app, owner, 'POST', '/incentives/statements/compute', {
      idempotencyKey: key('rm-compute'),
      id: uuidv7(),
      userId: repAId,
      periodFrom: from,
      periodTo: to,
    })
    const refused = await call(app, owner, 'POST', `/incentives/targets/${covered}/remove`, {
      idempotencyKey: key('rm-2'),
      id: covered,
      reason: 'Changed my mind',
    })
    expect(refused.status).toBe(409)
    const still = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select({ id: targets.id }).from(targets).where(eq(targets.id, covered)),
    )
    expect(still).toHaveLength(1)
  })

  /**
   * The cache row is dropped BEFORE the delete (the foreign key bypasses row security and the row is
   * `system`-write-only, so the owner's own transaction cannot clear it). When the delete then does
   * not happen, that derived row must come back: the hourly sweep only revisits OPEN periods, so a
   * closed one would sit at 0 until somebody pressed refresh — and `statements.compute` reads the
   * cache, so the rep would be paid short with nothing on screen saying why.
   */
  it('puts the achievement cache back when the delete is refused after it was cleared', async () => {
    // July: no other case in this spec uses it, and two targets of the same (user, brand, metric)
    // may not share a period — a reused month would refuse itself before this case began.
    const from = '2026-07-01'
    const to = '2026-07-31'
    const first = uuidv7()
    const second = uuidv7()
    for (const [id, metric] of [
      [first, 'value'],
      [second, 'pieces'],
    ] as const) {
      const made = await call<{ message?: string }>(app, owner, 'POST', '/incentives/targets', {
        ...upsertBody({
          id,
          userId: repAId,
          metric,
          targetValue: 1_000_000,
          periodFrom: from,
          periodTo: to,
          payoutRule: [{ fromPct: 5_000, flatPaise: 50_000 }],
        }),
      })
      expect(made.status, JSON.stringify(made.body)).toBe(200)
      await recomputeAchievement(db, { tenantId, targetId: id })
    }
    const cached = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, second)),
    )
    expect(cached).toHaveLength(1)

    // The key succeeds on the first target…
    const reused = key('rm-reused')
    expect(
      (
        await call(app, owner, 'POST', `/incentives/targets/${first}/remove`, {
          idempotencyKey: reused,
          id: first,
          reason: 'Wrong metric',
        })
      ).status,
    ).toBe(200)
    // …and the same key on the SECOND target is a different payload: 409, nothing deleted.
    expect(
      (
        await call(app, owner, 'POST', `/incentives/targets/${second}/remove`, {
          idempotencyKey: reused,
          id: second,
          reason: 'Wrong metric',
        })
      ).status,
    ).toBe(409)
    const survived = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select({ id: targets.id }).from(targets).where(eq(targets.id, second)),
    )
    expect(survived, 'the second target is still there').toHaveLength(1)
    const restored = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(achievements).where(eq(achievements.targetId, second)),
    )
    expect(restored, 'its cached figure came back').toHaveLength(1)
    expect(restored[0]?.achievedValue).toBe(cached[0]?.achievedValue)
  })

  // =============================================================================================
  // roles and isolation — the guard AND the database
  // =============================================================================================

  it('refuses every write to a rep and a crew member, at the API and at the database', async () => {
    const [anyTarget] = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(targets).where(eq(targets.tenantId, tenantId)).limit(1),
    )
    const [anyStatement] = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(computedPayouts).where(eq(computedPayouts.tenantId, tenantId)).limit(1),
    )
    expect(anyTarget).toBeDefined()
    expect(anyStatement).toBeDefined()

    for (const who of [repA, crew] as const) {
      expect(
        (await call(app, who, 'POST', '/incentives/targets', { ...upsertBody({ id: uuidv7() }) }))
          .status,
      ).toBe(403)
      expect(
        (
          await call(app, who, 'POST', '/incentives/targets/bulk', {
            idempotencyKey: key(`bulk-${who.role}`),
            assignments: [{ id: uuidv7(), userId: repAId }],
            metric: 'value',
            periodFrom: FROM,
            periodTo: TO,
            targetValue: 1_000,
            payoutRule: valueSlabs,
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await call(app, who, 'POST', `/incentives/targets/${anyTarget?.id ?? ''}/remove`, {
            idempotencyKey: key(`rm-${who.role}`),
            id: anyTarget?.id,
            reason: 'no',
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await call(app, who, 'POST', `/incentives/statements/${anyStatement?.id ?? ''}/approve`, {
            idempotencyKey: key(`ap-${who.role}`),
            id: anyStatement?.id,
          })
        ).status,
      ).toBe(403)
      expect(
        (await call(app, who, 'GET', '/incentives/progress/team', { metric: 'value', limit: 5 }))
          .status,
      ).toBe(403)
    }

    // The database is the guarantee, not the guard: a rep sees none of another rep's rows, and its
    // own INSERT into `targets` is refused by the write policy.
    const seen = await as(ctxFor('salesperson', repAId), (tx) =>
      tx.select({ id: targets.id, userId: targets.userId }).from(targets),
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((t) => t.userId === repAId)).toBe(true)
    await expect(
      as(ctxFor('salesperson', repAId), (tx) =>
        tx.insert(targets).values({
          id: uuidv7(),
          tenantId,
          userId: repAId,
          metric: 'value',
          periodFrom: FROM,
          periodTo: TO,
          targetValue: 1,
          payoutRule: [],
        }),
      ),
    ).rejects.toThrow()
    // And nobody raises their own payout.
    await expect(
      as(ctxFor('salesperson', repAId), (tx) =>
        tx
          .update(computedPayouts)
          .set({ amountPaise: 99_999_999 })
          .where(eq(computedPayouts.userId, repAId)),
      ),
    ).resolves.toBeDefined()
    const untouched = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(computedPayouts).where(eq(computedPayouts.userId, repAId)),
    )
    expect(untouched.every((r) => r.amountPaise !== 99_999_999)).toBe(true)
  })

  it('a manager and an accountant may run the numbers but never assign or approve', async () => {
    const [anyTarget] = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(targets).where(eq(targets.tenantId, tenantId)).limit(1),
    )
    const [anyStatement] = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(computedPayouts).where(eq(computedPayouts.tenantId, tenantId)).limit(1),
    )
    for (const who of [manager, accountant] as const) {
      expect(
        (await call(app, who, 'POST', '/incentives/targets', { ...upsertBody({ id: uuidv7() }) }))
          .status,
      ).toBe(403)
      expect(
        (
          await call(app, who, 'POST', `/incentives/statements/${anyStatement?.id ?? ''}/approve`, {
            idempotencyKey: key(`ap2-${who.role}`),
            id: anyStatement?.id,
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await call(app, who, 'POST', `/incentives/statements/${anyStatement?.id ?? ''}/reopen`, {
            idempotencyKey: key(`re2-${who.role}`),
            id: anyStatement?.id,
            reason: 'no',
          })
        ).status,
      ).toBe(403)
      // Allowed: read the team, refresh a figure, run a what-if.
      expect(
        (await call(app, who, 'GET', '/incentives/progress/team', { metric: 'value', limit: 5 }))
          .status,
      ).toBe(200)
      expect(
        (
          await call(app, who, 'POST', `/incentives/targets/${anyTarget?.id ?? ''}/refresh`, {
            idempotencyKey: key(`rf-${who.role}`),
            id: anyTarget?.id,
          })
        ).status,
      ).toBe(200)
      // `progress.mine` is for the field only: a desk role holds no target.
      expect((await call(app, who, 'GET', '/incentives/progress', { limit: 5 })).status).toBe(403)
    }
  })

  it('a warehouse hand and a shopkeeper reach nothing at all', async () => {
    for (const who of [store, shop] as const) {
      expect((await call(app, who, 'GET', '/incentives/targets', { limit: 5 })).status).toBe(403)
      expect((await call(app, who, 'GET', '/incentives/statements', { limit: 5 })).status).toBe(403)
      expect((await call(app, who, 'GET', '/incentives/progress', { limit: 5 })).status).toBe(403)
    }
    const seen = await as(ctxFor('warehouse', storeId), (tx) => tx.select().from(targets))
    expect(seen).toHaveLength(0)
    const shopSees = await as(ctxFor('retailer', shopUserId), (tx) =>
      tx.select().from(computedPayouts),
    )
    expect(shopSees).toHaveLength(0)
  })

  it('another distributor sees none of it', async () => {
    const [anyTarget] = await as(ctxFor('owner', ownerId), (tx) =>
      tx.select().from(targets).where(eq(targets.tenantId, tenantId)).limit(1),
    )
    const get = await call(app, stranger, 'GET', `/incentives/targets/${anyTarget?.id ?? ''}`, {})
    expect(get.status).toBe(404)
    const list = await call<{ items: unknown[] }>(app, stranger, 'GET', '/incentives/targets', {
      activeOnly: false,
      limit: 200,
    })
    expect(list.body.items).toHaveLength(0)
    const team = await call<{ items: unknown[] }>(
      app,
      stranger,
      'GET',
      '/incentives/progress/team',
      {
        metric: 'value',
        limit: 50,
      },
    )
    expect(team.body.items).toHaveLength(0)
    const rows = await as(ctxFor('owner', otherOwnerId, otherTenantId), (tx) =>
      tx.select().from(targets),
    )
    expect(rows).toHaveLength(0)
  })

  it('answers 401 without a token', async () => {
    const res = await call(app, null, 'GET', '/incentives/targets', { limit: 5 })
    expect(res.status).toBe(401)
  })
})
