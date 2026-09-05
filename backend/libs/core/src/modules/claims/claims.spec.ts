import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClaimDetail, ClaimLine } from '@dos/contracts'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  auditLog,
  bootstrapTenant,
  brands,
  claimLines,
  claimSettlements,
  claims,
  createDb,
  createPool,
  exportJobs,
  grnLines,
  grns,
  inboundDiscrepancies,
  invoiceLines,
  invoices,
  journalEntries,
  locations,
  manufacturers,
  memberships,
  numberingSeries,
  outboxEvents,
  productVariants,
  products,
  retailers,
  returnPolicies,
  schemes,
  stockLedger,
  stockLots,
  supplierInvoices,
  suppliers,
  tenantBrands,
  tenantProductCosts,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { pgCode, tenantStorage } from '../../platform/index.js'
import { createObjectStorage } from '../../platform/object-storage.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { ClaimsModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Detail = { item: ClaimDetail }
type Build = Detail & { added: number; skipped: number; outOfWindow: number; truncated: boolean }

/** `YYYY-MM-DD` plus `days`. */
const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

describeDb('claims (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const storeId = uuidv7()
  const crewId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const supplierId = uuidv7()
  const brandX = uuidv7() // the claim brand (dos)
  const brandY = uuidv7() // takes no damage returns
  const brandZ = uuidv7() // settles inside its own DMS
  const vx1 = uuidv7()
  const vx2 = uuidv7()
  const vz1 = uuidv7()
  const retailerId = uuidv7()
  const lotX1 = uuidv7()
  const PTD_X1 = 1450
  const PTD_X2 = 980
  const sch = {
    free: uuidv7(),
    pct: uuidv7(),
    distributor: uuidv7(),
    cash: uuidv7(),
    dms: uuidv7(),
  }
  const inv = {
    a: uuidv7(),
    b: uuidv7(),
    old: uuidv7(),
    cancelled: uuidv7(),
    july: uuidv7(),
    z: uuidv7(),
  }
  const line = {
    a1: uuidv7(),
    a2: uuidv7(),
    b1: uuidv7(),
    old1: uuidv7(),
    c1: uuidv7(),
    july1: uuidv7(),
    z1: uuidv7(),
  }
  const damageLedgerId = uuidv7()
  const discrepancyShort = uuidv7()
  const discrepancyDamaged = uuidv7()
  let godown = ''
  let damagedBin = ''
  let app: NestFastifyApplication

  const claim1 = uuidv7() // scheme X, August: the happy path, settled in two parts
  const claimR = uuidv7() // scheme X, July: rejected, its source freed
  const claimW = uuidv7() // scheme X, June–August: a stale June line rejected as out of window, re-runnable
  const claimZ = uuidv7() // brand Z (brand_dms): numbered, never journalled
  const claimD = uuidv7() // damage X: valuation at PTD, partly settled, written off
  const claimS = uuidv7() // shortage: submitted 45 days ago for the ageing bucket
  const claimDraft = uuidv7() // an 'other' draft with a manual line: notSubmitted, adjust, remove, cancel

  const ctxFor = (
    role: TenantContext['actorRole'],
    actorId: string,
    tid = tenantId,
  ): TenantContext => ({
    tenantId: tid,
    actorId,
    actorRole: role,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  async function journalFor(refType: string, refId: string) {
    const entries = await db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          eq(journalEntries.refType, refType),
          eq(journalEntries.refId, refId),
        ),
      )
    const out = []
    for (const e of entries) {
      const rows = await db.execute(sql`
        select a.code, jl.amount_paise, jl.party_type, jl.party_id
          from journal_lines jl join accounts a on a.id = jl.account_id
         where jl.entry_id = ${e.id}`)
      out.push({
        entry: e,
        lines: rows.rows.map((r) => ({
          code: String(r.code),
          amountPaise: Number(r.amount_paise),
          partyType: (r.party_type as string | null) ?? null,
          partyId: (r.party_id as string | null) ?? null,
        })),
      })
    }
    return out
  }

  const claimNext = async (): Promise<number> => {
    const [row] = await db
      .select({ nextNo: numberingSeries.nextNo })
      .from(numberingSeries)
      .where(and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.seriesCode, 'CLAIM')))
    return row?.nextNo ?? 0
  }

  async function seedInvoice(
    id: string,
    invoiceDate: string,
    state: 'issued' | 'cancelled',
    lines: { id: string; variantId: string; qtyPcs: number; rules: unknown[] }[],
  ): Promise<void> {
    await db.insert(invoices).values({
      id,
      tenantId,
      invoiceNo: `INV/${run}/${id.slice(-4)}`,
      seriesCode: 'INV',
      fy: '2026-27',
      invoiceDate,
      retailerId,
      state,
      buyerName: `Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: 10_000,
      taxablePaise: 10_000,
      totalPaise: 10_000,
    })
    await db.insert(invoiceLines).values(
      lines.map((l, i) => ({
        id: l.id,
        tenantId,
        invoiceId: id,
        lineNo: i + 1,
        variantId: l.variantId,
        description: 'line',
        hsnCode: '2202',
        qtyPcs: l.qtyPcs,
        ratePaise: 1000,
        taxablePaise: 1000 * l.qtyPcs,
        gstBps: 1200,
        lineTotalPaise: 1120 * l.qtyPcs,
        appliedRules: l.rules as never,
      })),
    )
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `clm-${run}`, legalName: 'Claims test', stateCode: '27' },
      { id: otherTenantId, slug: `clm-o-${run}`, legalName: 'Other distributor', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91917${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91917${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91917${run}3`, name: 'Accountant' },
      { id: repId, phone: `+91917${run}4`, name: 'Rep' },
      { id: storeId, phone: `+91917${run}5`, name: 'Store' },
      { id: crewId, phone: `+91917${run}6`, name: 'Crew' },
      { id: shopUserId, phone: `+91917${run}7`, name: 'Shop' },
      { id: otherOwnerId, phone: `+91917${run}8`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)
    const manufacturerId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker claims ${run}` })
    await db.insert(brands).values([
      { id: brandX, manufacturerId, name: `Brand X ${run}` },
      { id: brandY, manufacturerId, name: `Brand Y ${run}` },
      { id: brandZ, manufacturerId, name: `Brand Z ${run}` },
    ])
    const px = uuidv7()
    const pz = uuidv7()
    await db.insert(products).values([
      { id: px, manufacturerId, brandId: brandX, name: 'Cola' },
      { id: pz, manufacturerId, brandId: brandZ, name: 'Chips' },
    ])
    await db.insert(productVariants).values([
      {
        id: vx1,
        productId: px,
        name: 'Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: '2202',
      },
      {
        id: vx2,
        productId: px,
        name: 'Cola 250 ml',
        netQty: 250,
        netUnit: 'ml',
        defaultCaseSize: 30,
        hsnCode: '2202',
      },
      {
        id: vz1,
        productId: pz,
        name: 'Chips 70 g',
        netQty: 70,
        netUnit: 'g',
        defaultCaseSize: 120,
        hsnCode: '2005',
      },
    ])
    await db.insert(suppliers).values({ id: supplierId, tenantId, name: `Depot ${run}` })
    await db.insert(tenantBrands).values([
      { id: uuidv7(), tenantId, brandId: brandX },
      { id: uuidv7(), tenantId, brandId: brandY },
      {
        id: uuidv7(),
        tenantId,
        brandId: brandZ,
        claimChannel: 'brand_dms',
        fulfilmentMode: 'brand_dms',
      },
    ])
    await db.insert(returnPolicies).values([
      {
        id: uuidv7(),
        tenantId,
        brandId: brandX,
        damageClaimable: true,
        expiryClaimable: true,
        claimWindowDays: 60,
        settlementDays: 21,
        claimSupplierId: supplierId,
        claimSheetFormat: 'generic_xlsx',
      },
      {
        id: uuidv7(),
        tenantId,
        brandId: brandY,
        damageClaimable: false,
        claimSupplierId: supplierId,
      },
      {
        id: uuidv7(),
        tenantId,
        brandId: brandZ,
        damageClaimable: true,
        claimSupplierId: supplierId,
        settlementDays: 15,
      },
    ])
    await db.insert(tenantProductCosts).values([
      {
        id: uuidv7(),
        tenantId,
        variantId: vx1,
        purchaseRatePaise: 1400,
        landedCostPaise: 1500,
        ptdPaise: PTD_X1,
      },
      {
        id: uuidv7(),
        tenantId,
        variantId: vx2,
        purchaseRatePaise: 950,
        landedCostPaise: 1000,
        ptdPaise: PTD_X2,
      },
      {
        id: uuidv7(),
        tenantId,
        variantId: vz1,
        purchaseRatePaise: 800,
        landedCostPaise: 820,
        ptdPaise: 810,
      },
    ])
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      code: `R${run}`,
      name: `Shop ${run}`,
      phone: `+91918${run}0`,
      stateCode: '27',
    })
    const scheme = (
      id: string,
      brandId: string | null,
      rewardKind: 'free_qty' | 'line_pct' | 'order_pct' | 'cash_discount_pct',
      opts: {
        fundingSource?: 'company' | 'distributor'
        claimable?: boolean
        claimChannel?: 'dos' | 'brand_dms'
        claimWindowDays?: number | null
      },
    ) => ({
      id,
      tenantId,
      name: `${rewardKind} ${run}`,
      brandId,
      scope: { all: true },
      triggerKind: 'qty' as const,
      triggerMin: 1,
      triggerUnit: 'pcs',
      rewardKind,
      rewardValue: 1,
      validFrom: '2026-06-01',
      validTo: '2026-12-31',
      fundingSource: opts.fundingSource ?? 'company',
      claimable: opts.claimable ?? true,
      claimChannel: opts.claimChannel ?? 'dos',
      claimWindowDays: opts.claimWindowDays ?? null,
      sourceRef: `Circular ${run}`,
    })
    await db.insert(schemes).values([
      scheme(sch.free, brandX, 'free_qty', {}),
      scheme(sch.pct, brandX, 'line_pct', {}),
      scheme(sch.distributor, brandX, 'order_pct', {
        fundingSource: 'distributor',
        claimable: false,
      }),
      scheme(sch.cash, brandX, 'cash_discount_pct', {}),
      scheme(sch.dms, null, 'line_pct', { claimChannel: 'brand_dms' }),
    ])
    const rule = (ruleId: string, extra: Record<string, unknown>) => ({
      ruleId,
      version: 1,
      kind: 'scheme',
      ...extra,
    })
    await seedInvoice(inv.a, '2026-08-10', 'issued', [
      {
        id: line.a1,
        variantId: vx1,
        qtyPcs: 24,
        rules: [
          rule(sch.free, { rewardKind: 'free_qty', freeQty: 2, freeVariantId: vx1 }),
          rule(sch.distributor, { rewardKind: 'order_pct', amountPaise: 500 }),
          rule(sch.cash, { rewardKind: 'cash_discount_pct', amountPaise: 300 }),
          rule(sch.dms, { rewardKind: 'line_pct', amountPaise: 250 }),
        ],
      },
      {
        id: line.a2,
        variantId: vx2,
        qtyPcs: 12,
        rules: [rule(sch.pct, { rewardKind: 'line_pct', amountPaise: 1200 })],
      },
    ])
    await seedInvoice(inv.b, '2026-08-20', 'issued', [
      {
        id: line.b1,
        variantId: vx1,
        qtyPcs: 12,
        rules: [rule(sch.pct, { rewardKind: 'line_pct', amountPaise: 600 })],
      },
    ])
    // Older than the 60-day window measured from the period's end (31 Aug): a visible loss, never dropped.
    await seedInvoice(inv.old, '2026-06-01', 'issued', [
      {
        id: line.old1,
        variantId: vx1,
        qtyPcs: 12,
        rules: [rule(sch.pct, { rewardKind: 'line_pct', amountPaise: 700 })],
      },
    ])
    await seedInvoice(inv.cancelled, '2026-08-15', 'cancelled', [
      {
        id: line.c1,
        variantId: vx1,
        qtyPcs: 12,
        rules: [rule(sch.pct, { rewardKind: 'line_pct', amountPaise: 900 })],
      },
    ])
    await seedInvoice(inv.july, '2026-07-05', 'issued', [
      {
        id: line.july1,
        variantId: vx2,
        qtyPcs: 12,
        rules: [rule(sch.pct, { rewardKind: 'line_pct', amountPaise: 800 })],
      },
    ])
    await seedInvoice(inv.z, '2026-08-12', 'issued', [
      {
        id: line.z1,
        variantId: vz1,
        qtyPcs: 120,
        rules: [rule(sch.dms, { rewardKind: 'line_pct', amountPaise: 400 })],
      },
    ])
    const locs = await db.select().from(locations).where(eq(locations.tenantId, tenantId))
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    damagedBin = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    await db.insert(stockLots).values({
      id: lotX1,
      tenantId,
      variantId: vx1,
      batchNo: `B1-${run}`,
      mrpPaise: 2000,
      expiryDate: '2027-03-31',
      caseSize: 24,
    })
    await db.insert(stockLedger).values([
      {
        id: damageLedgerId,
        tenantId,
        occurredAt: new Date('2026-08-20T09:30:00+05:30'),
        lotId: lotX1,
        locationId: damagedBin,
        qtyDelta: 6,
        reason: 'damage',
        refType: 'manual',
        refId: lotX1,
        actorId: managerId,
        idempotencyKey: `damage-in:${run}`,
        note: 'wet carton',
      },
      {
        id: uuidv7(),
        tenantId,
        occurredAt: new Date('2026-08-20T09:30:00+05:30'),
        lotId: lotX1,
        locationId: godown,
        qtyDelta: -6,
        reason: 'damage',
        refType: 'manual',
        refId: lotX1,
        actorId: managerId,
        idempotencyKey: `damage-out:${run}`,
      },
    ])
    const supplierInvoiceId = uuidv7()
    const grnId = uuidv7()
    const grnLineId = uuidv7()
    await db.insert(supplierInvoices).values({
      id: supplierInvoiceId,
      tenantId,
      supplierId,
      source: 'manual',
      status: 'received',
      invoiceNo: `DEP/${run}`,
      invoiceDate: '2026-08-18',
      subtotalPaise: 48_000,
      totalPaise: 48_000,
    })
    await db.insert(grns).values({
      id: grnId,
      tenantId,
      grnNo: `GRN-${run}`,
      supplierInvoiceId,
      locationId: godown,
      status: 'posted',
    })
    await db.insert(grnLines).values({
      id: grnLineId,
      tenantId,
      grnId,
      variantId: vx1,
      lotId: lotX1,
      expectedQtyPcs: 48,
      countedQtyPcs: 36,
    })
    await db.insert(inboundDiscrepancies).values([
      {
        id: discrepancyShort,
        tenantId,
        grnId,
        grnLineId,
        kind: 'short',
        qtyPcs: 12,
        amountPaise: 12 * PTD_X1,
        status: 'open',
        note: 'one case short',
      },
      {
        id: discrepancyDamaged,
        tenantId,
        grnId,
        grnLineId,
        kind: 'damaged',
        qtyPcs: 3,
        amountPaise: 3 * PTD_X1,
        status: 'open',
        note: 'crushed',
      },
    ])
    app = await bootTestApp([ClaimsModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------
  // the scheme claim: open → build → submit
  // -------------------------------------------------------------------------------------------------------

  it('opens a draft, builds the right lines from applied_rules (two schemes), submits with a number and an accrual', async () => {
    const opened = await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-1-${run}`,
      id: claim1,
      supplierId,
      brandId: brandX,
      kind: 'scheme',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      note: 'August schemes',
    })
    expect(opened.status).toBe(200)
    expect(opened.body.item.status).toBe('draft')
    expect(opened.body.item.claimNo).toBeNull()
    expect(opened.body.item.claimChannel).toBe('dos')
    expect(opened.body.item.policy?.settlementDays).toBe(21)

    const built = await call<Build>(app, manager, 'POST', `/claims/${claim1}/build`, {
      idempotencyKey: `build-1-${run}`,
      id: claim1,
    })
    expect(built.status).toBe(200)
    // free goods (a1 × sch.free) and the two pct lines (a2, b1); the cancelled bill and June are outside
    expect(built.body.added).toBe(3)
    expect(built.body.outOfWindow).toBe(0)
    expect(built.body.skipped).toBe(0)
    expect(built.body.truncated).toBe(false)
    const lines = built.body.item.lines
    const bySource = new Map(lines.map((l) => [l.sourceId, l]))
    const free = bySource.get(`${line.a1}:${sch.free}`)
    expect(free?.basis).toBe('ptd')
    expect(free?.qtyPcs).toBe(2)
    expect(free?.ratePaise).toBe(PTD_X1)
    expect(free?.amountPaise).toBe(2 * PTD_X1)
    expect(free?.caseSize).toBe(24)
    expect(free?.detail.rewardKind).toBe('free_qty')
    expect(free?.detail.invoiceNo).toMatch(/^INV\//)
    expect(bySource.get(`${line.a2}:${sch.pct}`)?.amountPaise).toBe(1200)
    expect(bySource.get(`${line.a2}:${sch.pct}`)?.basis).toBe('scheme_amount')
    expect(bySource.get(`${line.b1}:${sch.pct}`)?.amountPaise).toBe(600)
    // distributor-funded, cash-discount and brand-DMS-channel rules never become lines; a cancelled bill contributes nothing
    expect(bySource.has(`${line.a1}:${sch.distributor}`)).toBe(false)
    expect(bySource.has(`${line.a1}:${sch.cash}`)).toBe(false)
    expect(bySource.has(`${line.a1}:${sch.dms}`)).toBe(false)
    expect(bySource.has(`${line.c1}:${sch.pct}`)).toBe(false)
    expect(built.body.item.claimedPaise).toBe(2 * PTD_X1 + 1200 + 600)

    const before = await claimNext()
    const submitted = await call<Detail & { statement: unknown; exportJobId: string | null }>(
      app,
      manager,
      'POST',
      `/claims/${claim1}/submit`,
      { idempotencyKey: `submit-1-${run}`, id: claim1, submittedOn: '2026-09-01' },
    )
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.status).toBe('submitted')
    expect(submitted.body.item.claimNo).toMatch(/^CLM-\d{4}$/)
    expect(submitted.body.item.dueDate).toBe('2026-09-22')
    expect(submitted.body.item.accruedAt).not.toBeNull()
    expect(submitted.body.item.lines.filter((l) => l.status === 'claimed')).toHaveLength(3)
    expect(await claimNext()).toBe(before + 1)

    const [entry] = await journalFor('claim', claim1)
    expect(entry).toBeDefined()
    expect(entry?.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)
    const debit = entry?.lines.find((l) => l.code === 'SCHEME_RECEIVABLE')
    expect(debit?.amountPaise).toBe(2 * PTD_X1 + 1200 + 600)
    expect(debit?.partyType).toBe('supplier')
    expect(debit?.partyId).toBe(supplierId)
    expect(entry?.lines.find((l) => l.code === 'SCHEME_EXPENSE')?.amountPaise).toBe(
      -(2 * PTD_X1 + 1200 + 600),
    )
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.aggregateId, claim1), eq(outboxEvents.eventType, 'ClaimSubmitted')),
      )
    expect(event).toBeDefined()
  })

  it('replays a submit with the same key, refuses the same key with a changed body, and allocates exactly one number', async () => {
    const before = await claimNext()
    const again = await call<Detail>(app, manager, 'POST', `/claims/${claim1}/submit`, {
      idempotencyKey: `submit-1-${run}`,
      id: claim1,
      submittedOn: '2026-09-01',
    })
    expect(again.status).toBe(200)
    expect(again.body.item.claimNo).toMatch(/^CLM-/)
    expect(await claimNext()).toBe(before)
    const changed = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claim1}/submit`,
      {
        idempotencyKey: `submit-1-${run}`,
        id: claim1,
        submittedOn: '2026-09-02',
      },
    )
    expect(changed.status).toBe(409)
    // a submitted claim cannot be submitted again, and a draft cannot be acknowledged
    const twice = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claim1}/submit`,
      {
        idempotencyKey: `submit-1b-${run}`,
        id: claim1,
      },
    )
    expect(twice.status).toBe(409)
    expect(twice.body.message).toMatch(/is submitted/)
  })

  it('is re-runnable, and records a source older than the claim window as a rejected line, never a silent drop', async () => {
    await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-w-${run}`,
      id: claimW,
      supplierId,
      brandId: brandX,
      kind: 'scheme',
      periodFrom: '2026-06-01',
      periodTo: '2026-08-31',
    })
    const first = await call<Build>(app, manager, 'POST', `/claims/${claimW}/build`, {
      idempotencyKey: `build-wa-${run}`,
      id: claimW,
    })
    expect(first.status).toBe(200)
    // claim1 holds the August sources; July's line is free; June is 91 days before the period's end (window 60)
    expect(first.body.added).toBe(2)
    expect(first.body.outOfWindow).toBe(1)
    expect(first.body.skipped).toBe(3)
    const stale = first.body.item.lines.find((l) => l.sourceId === `${line.old1}:${sch.pct}`)
    expect(stale?.status).toBe('rejected')
    expect(stale?.detail.reason).toBe('out_of_window')
    expect(first.body.item.claimedPaise).toBe(800)
    const second = await call<Build>(app, manager, 'POST', `/claims/${claimW}/build`, {
      idempotencyKey: `build-wb-${run}`,
      id: claimW,
    })
    expect(second.body.added).toBe(0)
    expect(second.body.skipped).toBe(first.body.added + first.body.skipped)
    expect(second.body.item.claimedPaise).toBe(800)
  })

  it('claims a source once: a rejected claim frees it and the accrual is reversed, never deleted', async () => {
    // the wide draft is discarded (its July line is free again); claimR then takes July's line
    const cancelW = await call<Detail>(app, manager, 'POST', `/claims/${claimW}/cancel`, {
      idempotencyKey: `cancel-w-${run}`,
      id: claimW,
      reason: 'raised on the wrong window',
    })
    expect(cancelW.status).toBe(200)
    expect(cancelW.body.item.status).toBe('cancelled')
    expect(cancelW.body.item.lines).toHaveLength(0)

    await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-r-${run}`,
      id: claimR,
      supplierId,
      brandId: brandX,
      kind: 'scheme',
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
    })
    const builtR = await call<Build>(app, manager, 'POST', `/claims/${claimR}/build`, {
      idempotencyKey: `build-r-${run}`,
      id: claimR,
    })
    expect(builtR.body.added).toBe(1)
    const submittedR = await call<Detail>(app, manager, 'POST', `/claims/${claimR}/submit`, {
      idempotencyKey: `submit-r-${run}`,
      id: claimR,
    })
    expect(submittedR.status).toBe(200)

    // the cancelled window is free again: the same (supplier, brand, kind, period) can be re-opened
    const reopened = await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-w2-${run}`,
      id: uuidv7(),
      supplierId,
      brandId: brandX,
      kind: 'scheme',
      periodFrom: '2026-06-01',
      periodTo: '2026-08-31',
    })
    expect(reopened.status).toBe(200)
    const r2b = reopened.body.item.id
    const skipped = await call<Build>(app, manager, 'POST', `/claims/${r2b}/build`, {
      idempotencyKey: `build-w2a-${run}`,
      id: r2b,
    })
    expect(skipped.body.added).toBe(1) // only the stale June line, rejected; July is claimR's now
    expect(skipped.body.outOfWindow).toBe(1)
    expect(skipped.body.skipped).toBe(4)

    const [accrual] = await journalFor('claim', claimR)
    expect(accrual?.entry.reversedByEntryId).toBeNull()
    const rejected = await call<Detail>(app, manager, 'POST', `/claims/${claimR}/reject`, {
      idempotencyKey: `reject-r-${run}`,
      id: claimR,
      reason: 'brand says the July circular did not cover this outlet',
    })
    expect(rejected.status).toBe(200)
    expect(rejected.body.item.status).toBe('rejected')
    expect(rejected.body.item.claimNo).toMatch(/^CLM-/)
    expect(rejected.body.item.lines.every((l) => l.status === 'rejected')).toBe(true)
    expect(rejected.body.item.lines[0]?.detail.reason).toBe('claim_rejected')
    const [after] = await journalFor('claim', claimR)
    expect(after?.entry.reversedByEntryId).not.toBeNull()
    const [reversal] = await journalFor('claim_reversal', claimR)
    expect(reversal?.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)
    expect(reversal?.lines.find((l) => l.code === 'SCHEME_RECEIVABLE')?.amountPaise).toBe(-800)
    const count = await db.execute(
      sql`select count(*)::int as n from journal_entries where tenant_id = ${tenantId} and ref_id = ${claimR}`,
    )
    expect(Number((count.rows[0] as { n: number }).n)).toBe(2)

    const picked = await call<Build>(app, manager, 'POST', `/claims/${r2b}/build`, {
      idempotencyKey: `build-w2b-${run}`,
      id: r2b,
    })
    expect(picked.body.added).toBe(1)
    expect(
      picked.body.item.lines.find((l) => l.sourceId === `${line.july1}:${sch.pct}`)?.status,
    ).toBe('open')
    await call<Detail>(app, manager, 'POST', `/claims/${r2b}/cancel`, {
      idempotencyKey: `cancel-w2-${run}`,
      id: r2b,
      reason: 'test cleanup',
    })
  })

  it('a brand-DMS claim is numbered and exported as a record but never journalled', async () => {
    const opened = await call<Detail>(app, owner, 'POST', '/claims', {
      idempotencyKey: `open-z-${run}`,
      id: claimZ,
      supplierId,
      brandId: brandZ,
      kind: 'scheme',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    })
    expect(opened.body.item.claimChannel).toBe('brand_dms')
    const built = await call<Build>(app, owner, 'POST', `/claims/${claimZ}/build`, {
      idempotencyKey: `build-z-${run}`,
      id: claimZ,
    })
    expect(built.body.added).toBe(1)
    expect(built.body.item.lines[0]?.amountPaise).toBe(400)
    const submitted = await call<Detail>(app, owner, 'POST', `/claims/${claimZ}/submit`, {
      idempotencyKey: `submit-z-${run}`,
      id: claimZ,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.claimNo).toMatch(/^CLM-/)
    expect(submitted.body.item.submittedAt).not.toBeNull()
    expect(submitted.body.item.accruedAt).toBeNull()
    expect(await journalFor('claim', claimZ)).toHaveLength(0)
  })

  // -------------------------------------------------------------------------------------------------------
  // money: settlements, over-settlement, write-off
  // -------------------------------------------------------------------------------------------------------

  it('settles in part then in full, allocating to lines with no paisa lost, each entry balancing', async () => {
    const ack = await call<Detail>(app, accountant, 'POST', `/claims/${claim1}/acknowledge`, {
      idempotencyKey: `ack-1-${run}`,
      id: claim1,
      externalRef: `RCP/CN/${run}`,
    })
    expect(ack.status).toBe(200)
    expect(ack.body.item.status).toBe('acknowledged')
    const total = 2 * PTD_X1 + 1200 + 600
    const partAmount = 1000
    const s1 = uuidv7()
    const part = await call<Detail & { settlement: { journalEntryId: string | null } }>(
      app,
      accountant,
      'POST',
      `/claims/${claim1}/settlements`,
      {
        idempotencyKey: `settle-1a-${run}`,
        id: claim1,
        settlementId: s1,
        settledOn: '2026-09-03',
        amountPaise: partAmount,
        mode: 'credit_note',
        externalRef: `RCP/CN/${run}/1`,
      },
    )
    expect(part.status).toBe(200)
    expect(part.body.item.status).toBe('partially_settled')
    expect(part.body.item.settledPaise).toBe(partAmount)
    expect(part.body.item.outstandingPaise).toBe(total - partAmount)
    const live = part.body.item.lines.filter((l) => l.status !== 'rejected')
    expect(live.reduce((s, l) => s + l.settledPaise, 0)).toBe(partAmount)
    expect(live.every((l) => l.settledPaise <= l.amountPaise)).toBe(true)
    expect(part.body.settlement.journalEntryId).not.toBeNull()
    const [e1] = await journalFor('claim_settlement', s1)
    expect(e1?.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)
    expect(e1?.lines.find((l) => l.code === 'AP')?.amountPaise).toBe(partAmount)
    expect(e1?.lines.find((l) => l.code === 'SCHEME_RECEIVABLE')?.amountPaise).toBe(-partAmount)

    const over = await call<{ message: string }>(
      app,
      accountant,
      'POST',
      `/claims/${claim1}/settlements`,
      {
        idempotencyKey: `settle-1x-${run}`,
        id: claim1,
        settlementId: uuidv7(),
        settledOn: '2026-09-03',
        amountPaise: total - partAmount + 1,
        mode: 'bank_receipt',
      },
    )
    expect(over.status).toBe(409)
    expect(over.body.message).toMatch(/exceeds/)
    const rows = await db
      .select()
      .from(claimSettlements)
      .where(eq(claimSettlements.claimId, claim1))
    expect(rows).toHaveLength(1)

    const s2 = uuidv7()
    const full = await call<Detail>(app, accountant, 'POST', `/claims/${claim1}/settlements`, {
      idempotencyKey: `settle-1b-${run}`,
      id: claim1,
      settlementId: s2,
      settledOn: '2026-09-04',
      amountPaise: total - partAmount,
      mode: 'cheque',
      externalRef: `CHQ ${run}`,
    })
    expect(full.status).toBe(200)
    expect(full.body.item.status).toBe('settled')
    expect(full.body.item.settledAt).not.toBeNull()
    expect(full.body.item.outstandingPaise).toBe(0)
    expect(
      full.body.item.lines
        .filter((l) => l.status !== 'rejected')
        .every((l) => l.status === 'settled'),
    ).toBe(true)
    const [e2] = await journalFor('claim_settlement', s2)
    expect(e2?.lines.find((l) => l.code === 'CHEQUES')?.amountPaise).toBe(total - partAmount)
    expect(e2?.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)

    // a settled claim can neither be written off nor rejected
    const wo = await call<{ message: string }>(app, owner, 'POST', `/claims/${claim1}/write-off`, {
      idempotencyKey: `wo-1-${run}`,
      id: claim1,
      reason: 'x',
    })
    expect(wo.status).toBe(409)
  })

  it('values a damage claim at the policy basis (PTD from tenant_product_costs, the lot’s own case size) and refuses a brand that takes no returns', async () => {
    const refused = await call<{ message: string }>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-y-${run}`,
      id: uuidv7(),
      supplierId,
      brandId: brandY,
      kind: 'damage',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    })
    expect(refused.status).toBe(409)
    expect(refused.body.message).toContain(`Brand Y ${run}`)

    await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-d-${run}`,
      id: claimD,
      supplierId,
      brandId: brandX,
      kind: 'damage',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    })
    const built = await call<Build>(app, manager, 'POST', `/claims/${claimD}/build`, {
      idempotencyKey: `build-d-${run}`,
      id: claimD,
    })
    expect(built.status).toBe(200)
    expect(built.body.added).toBe(1)
    const dl = built.body.item.lines[0]
    expect(dl?.sourceType).toBe('stock_ledger')
    expect(dl?.sourceId).toBe(damageLedgerId)
    expect(dl?.basis).toBe('ptd')
    expect(dl?.ratePaise).toBe(PTD_X1)
    expect(dl?.qtyPcs).toBe(6)
    expect(dl?.amountPaise).toBe(6 * PTD_X1)
    expect(dl?.caseSize).toBe(24)
    expect(dl?.batchNo).toBe(`B1-${run}`)
    expect(dl?.lotId).toBe(lotX1)
    expect(dl?.detail.ledgerRef).toBe(`damage-in:${run}`)
  })

  it('writes off the unrecovered remainder to BAD_DEBTS (owner or accountant, never the manager)', async () => {
    const submitted = await call<Detail>(app, manager, 'POST', `/claims/${claimD}/submit`, {
      idempotencyKey: `submit-d-${run}`,
      id: claimD,
    })
    expect(submitted.status).toBe(200)
    const [accrual] = await journalFor('claim', claimD)
    expect(accrual?.lines.find((l) => l.code === 'CLAIMS_RECEIVABLE')?.amountPaise).toBe(6 * PTD_X1)
    expect(accrual?.lines.find((l) => l.code === 'DAMAGES')?.amountPaise).toBe(-6 * PTD_X1)

    const part = await call<Detail>(app, accountant, 'POST', `/claims/${claimD}/settlements`, {
      idempotencyKey: `settle-d-${run}`,
      id: claimD,
      settlementId: uuidv7(),
      settledOn: '2026-09-04',
      amountPaise: 2000,
      mode: 'bank_receipt',
      externalRef: `UTR${run}`,
    })
    expect(part.status).toBe(200)
    expect(part.body.item.status).toBe('partially_settled')

    const byManager = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claimD}/write-off`,
      {
        idempotencyKey: `wo-d-m-${run}`,
        id: claimD,
        reason: 'brand will not pay',
      },
    )
    expect(byManager.status).toBe(403)
    const rejectAfterMoney = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claimD}/reject`,
      {
        idempotencyKey: `rej-d-${run}`,
        id: claimD,
        reason: 'x',
      },
    )
    expect(rejectAfterMoney.status).toBe(409)

    const written = await call<Detail>(app, accountant, 'POST', `/claims/${claimD}/write-off`, {
      idempotencyKey: `wo-d-${run}`,
      id: claimD,
      reason: 'brand declined the wet cartons',
    })
    expect(written.status).toBe(200)
    expect(written.body.item.status).toBe('written_off')
    expect(written.body.item.writtenOffPaise).toBe(6 * PTD_X1 - 2000)
    expect(written.body.item.settledPaise + written.body.item.writtenOffPaise).toBe(
      written.body.item.claimedPaise,
    )
    expect(written.body.item.outstandingPaise).toBe(0)
    expect(
      written.body.item.lines.every((l) => l.status === 'written_off' || l.status === 'settled'),
    ).toBe(true)
    const [wo] = await journalFor('claim_write_off', claimD)
    expect(wo?.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0)
    expect(wo?.lines.find((l) => l.code === 'BAD_DEBTS')?.amountPaise).toBe(6 * PTD_X1 - 2000)
    expect(wo?.lines.find((l) => l.code === 'CLAIMS_RECEIVABLE')?.amountPaise).toBe(
      -(6 * PTD_X1 - 2000),
    )
  })

  // -------------------------------------------------------------------------------------------------------
  // shortage from the gate count, the desk's line review, evidence, the sheet
  // -------------------------------------------------------------------------------------------------------

  it('builds a shortage claim from open gate-count findings and marks them claimed at submit', async () => {
    await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-s-${run}`,
      id: claimS,
      supplierId,
      kind: 'shortage',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    })
    const built = await call<Build>(app, manager, 'POST', `/claims/${claimS}/build`, {
      idempotencyKey: `build-s-${run}`,
      id: claimS,
    })
    expect(built.body.added).toBe(2)
    const short = built.body.item.lines.find((l) => l.sourceId === discrepancyShort)
    expect(short?.basis).toBe('invoice_rate')
    expect(short?.amountPaise).toBe(12 * PTD_X1)
    expect(short?.detail.invoiceNo).toBe(`DEP/${run}`)
    const submitted = await call<Detail>(app, manager, 'POST', `/claims/${claimS}/submit`, {
      idempotencyKey: `submit-s-${run}`,
      id: claimS,
      submittedOn: plusDays(businessDate().date, -45),
    })
    expect(submitted.status).toBe(200)
    const findings = await db
      .select({ id: inboundDiscrepancies.id, status: inboundDiscrepancies.status })
      .from(inboundDiscrepancies)
      .where(sql`${inboundDiscrepancies.id} in (${discrepancyShort}, ${discrepancyDamaged})`)
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.status === 'claimed')).toBe(true)
  })

  it('lets the desk add, adjust (recording who and why) and remove lines on a draft only', async () => {
    await call<Detail>(app, manager, 'POST', '/claims', {
      idempotencyKey: `open-o-${run}`,
      id: claimDraft,
      supplierId,
      kind: 'other',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    })
    const l1 = uuidv7()
    const added = await call<Detail & { line: ClaimLine }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/lines`,
      {
        idempotencyKey: `add-o-${run}`,
        id: claimDraft,
        lineId: l1,
        amountPaise: 5000,
        note: 'rate difference letter',
      },
    )
    expect(added.status).toBe(200)
    expect(added.body.line.sourceType).toBe('manual')
    expect(added.body.item.claimedPaise).toBe(5000)

    const adjusted = await call<Detail & { line: ClaimLine }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/lines/${l1}/adjust`,
      {
        idempotencyKey: `adj-o-${run}`,
        id: claimDraft,
        lineId: l1,
        amountPaise: 4200,
        reason: 'letter says 42',
      },
    )
    expect(adjusted.status).toBe(200)
    expect(adjusted.body.line.amountPaise).toBe(4200)
    expect(adjusted.body.item.claimedPaise).toBe(4200)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          eq(auditLog.action, 'claims.line.adjust'),
          eq(auditLog.entityId, claimDraft),
        ),
      )
    expect(audit?.actorId).toBe(managerId)
    expect((audit?.after as { reason: string }).reason).toBe('letter says 42')
    expect((audit?.before as { amountPaise: number }).amountPaise).toBe(5000)

    const excluded = await call<Detail & { line: ClaimLine }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/lines/${l1}/adjust`,
      { idempotencyKey: `adj-o2-${run}`, id: claimDraft, lineId: l1, exclude: true },
    )
    expect(excluded.body.line.status).toBe('rejected')
    expect(excluded.body.line.detail.reason).toBe('excluded')
    expect(excluded.body.item.claimedPaise).toBe(0)
    const back = await call<Detail & { line: ClaimLine }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/lines/${l1}/adjust`,
      { idempotencyKey: `adj-o3-${run}`, id: claimDraft, lineId: l1, exclude: false },
    )
    expect(back.body.line.status).toBe('open')
    expect(back.body.item.claimedPaise).toBe(4200)

    // nothing to submit once the only line is gone; a submitted claim's lines are frozen
    const l2 = uuidv7()
    await call<Detail>(app, manager, 'POST', `/claims/${claimDraft}/lines`, {
      idempotencyKey: `add-o2-${run}`,
      id: claimDraft,
      lineId: l2,
      amountPaise: 100,
    })
    const removed = await call<Detail>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/lines/${l2}/remove`,
      {
        idempotencyKey: `rm-o-${run}`,
        id: claimDraft,
        lineId: l2,
        reason: 'duplicate',
      },
    )
    expect(removed.status).toBe(200)
    expect(removed.body.item.lines).toHaveLength(1)
    const frozen = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claim1}/lines`,
      {
        idempotencyKey: `add-1-${run}`,
        id: claim1,
        lineId: uuidv7(),
        amountPaise: 100,
      },
    )
    expect(frozen.status).toBe(409)
  })

  it('attaches evidence only from this claim’s own upload folder, and snapshots a claim sheet on the export queue', async () => {
    const wrongFolder = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/evidence`,
      {
        idempotencyKey: `ev-bad-${run}`,
        id: claimDraft,
        evidenceId: uuidv7(),
        objectKey: `tenant/${tenantId}/claims/${claim1}/photo.jpg`,
        kind: 'damage_photo',
      },
    )
    expect(wrongFolder.status).toBe(400)
    const otherTenant = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/evidence`,
      {
        idempotencyKey: `ev-bad2-${run}`,
        id: claimDraft,
        evidenceId: uuidv7(),
        objectKey: `tenant/${otherTenantId}/claims/${claimDraft}/photo.jpg`,
      },
    )
    expect(otherTenant.status).toBe(400)
    const ok = await call<Detail & { evidence: { objectKey: string } }>(
      app,
      manager,
      'POST',
      `/claims/${claimDraft}/evidence`,
      {
        idempotencyKey: `ev-ok-${run}`,
        id: claimDraft,
        evidenceId: uuidv7(),
        objectKey: `tenant/${tenantId}/claims/${claimDraft}/photo.jpg`,
        kind: 'damage_photo',
        caption: 'the carton',
      },
    )
    expect(ok.status).toBe(200)
    expect(ok.body.item.evidence).toHaveLength(1)
    expect(ok.body.evidence.objectKey).toContain(`/claims/${claimDraft}/`)

    const statementId = uuidv7()
    const sheet = await call<{
      item: {
        id: string
        ready: boolean
        objectKey: string | null
        rowCount: number | null
        exportJobId: string
      }
      exportJobId: string
    }>(app, manager, 'POST', `/claims/${claimDraft}/statements`, {
      idempotencyKey: `stmt-o-${run}`,
      id: claimDraft,
      statementId,
    })
    expect(sheet.status).toBe(200)
    expect(sheet.body.item.id).toBe(statementId)
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, sheet.body.exportJobId))
    expect(job?.kind).toBe('claim_sheet')
    expect((job?.params as { statementId: string }).statementId).toBe(statementId)
    // outside production the sheet is rendered right after the commit through the one registry
    expect(job?.status).toBe('succeeded')
    expect(sheet.body.item.ready).toBe(true)
    expect(sheet.body.item.rowCount).toBe(1)
    expect(sheet.body.item.objectKey).toMatch(/\/exports\/.*claim-sheet\.xlsx$/)
    const bytes = await createObjectStorage().get(sheet.body.item.objectKey ?? '')
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    const listed = await call<{ items: { id: string; ready: boolean }[] }>(
      app,
      accountant,
      'GET',
      `/claims/${claimDraft}/statements`,
    )
    expect(listed.body.items[0]?.id).toBe(statementId)
    expect(listed.body.items[0]?.ready).toBe(true)
  })

  // -------------------------------------------------------------------------------------------------------
  // the owner's views
  // -------------------------------------------------------------------------------------------------------

  it('ages claims receivable by supplier: 45 days old in 31–60, drafts as not submitted, brand-DMS apart from the totals', async () => {
    const res = await call<{
      totals: {
        outstandingPaise: number
        notSubmittedPaise: number
        buckets: Record<string, number>
        openClaims: number
      }
      groups: {
        key: string
        claimChannel: string
        outstandingPaise: number
        buckets: Record<string, number>
        oldestClaimNo: string | null
      }[]
    }>(app, accountant, 'GET', '/claims/ageing', { supplierId })
    expect(res.status).toBe(200)
    const dos = res.body.groups.find((g) => g.key === supplierId && g.claimChannel === 'dos')
    const dms = res.body.groups.find((g) => g.key === supplierId && g.claimChannel === 'brand_dms')
    expect(dos?.buckets.b31_60).toBe(15 * PTD_X1) // the shortage claim (12 short + 3 damaged), 45 days old
    expect(dos?.outstandingPaise).toBe(15 * PTD_X1) // claim1 settled, claimR rejected, claimD written off
    expect(res.body.totals.outstandingPaise).toBe(15 * PTD_X1)
    expect(res.body.totals.buckets.b31_60).toBe(15 * PTD_X1)
    expect(res.body.totals.notSubmittedPaise).toBe(4200)
    expect(dms?.outstandingPaise).toBe(400)
    expect(res.body.totals.openClaims).toBe(1)
  })

  it('answers the register with recovery per brand and suggests which claims a payment settles', async () => {
    const register = await call<{
      totals: {
        claims: number
        claimedPaise: number
        settledPaise: number
        writtenOffPaise: number
        recoveryBps: number
      }
      rows: {
        key: string
        name: string
        claims: number
        settledPaise: number
        recoveryBps: number
      }[]
    }>(app, owner, 'GET', '/claims/register', {
      from: '2026-07-01',
      to: '2026-08-31',
      groupBy: 'brand',
      supplierId,
    })
    expect(register.status).toBe(200)
    const x = register.body.rows.find((r) => r.key === brandX)
    expect(x?.name).toBe(`Brand X ${run}`)
    expect(x?.claims).toBe(3) // claim1, claimR, claimD (cancelled ones excluded)
    expect(register.body.totals.recoveryBps).toBeGreaterThan(0)
    expect(register.body.totals.recoveryBps).toBeLessThanOrEqual(10_000)
    const tooWide = await call<{ message: string }>(app, owner, 'GET', '/claims/register', {
      from: '2025-01-01',
      to: '2026-08-31',
    })
    expect(tooWide.status).toBe(400)

    const reconcile = await call<{
      consideredClaims: number
      candidates: { claimIds: string[]; exact: boolean; differencePaise: number }[]
    }>(app, accountant, 'GET', '/claims/reconcile', {
      supplierId,
      amountPaise: 15 * PTD_X1,
      tolerancePaise: 0,
    })
    expect(reconcile.status).toBe(200)
    expect(reconcile.body.candidates[0]?.claimIds).toEqual([claimS])
    expect(reconcile.body.candidates[0]?.exact).toBe(true)

    const periods = await call<{
      items: {
        brandId: string
        kind: string
        periodFrom: string
        periodTo: string
        existingClaimId: string | null
      }[]
    }>(app, owner, 'GET', '/claims/periods', { brandId: brandX, periods: 3 })
    expect(periods.status).toBe(200)
    expect(periods.body.items.length).toBeGreaterThan(0)
    const aug = periods.body.items.find((p) => p.kind === 'scheme' && p.periodFrom === '2026-08-01')
    expect(aug?.existingClaimId).toBe(claim1)
  })

  it('lets only the owner set a brand’s policy, audited', async () => {
    const byManager = await call<{ message: string }>(app, manager, 'POST', '/claims/policies', {
      idempotencyKey: `pol-m-${run}`,
      id: uuidv7(),
      brandId: brandY,
      damageClaimable: true,
    })
    expect(byManager.status).toBe(403)
    const byOwner = await call<{
      item: {
        brandId: string
        damageClaimable: boolean
        settlementDays: number | null
        claimSupplierName: string | null
      }
    }>(app, owner, 'POST', '/claims/policies', {
      idempotencyKey: `pol-o-${run}`,
      id: uuidv7(),
      brandId: brandY,
      claimSupplierId: supplierId,
      damageClaimable: true,
      settlementDays: 45,
    })
    expect(byOwner.status).toBe(200)
    expect(byOwner.body.item.damageClaimable).toBe(true)
    expect(byOwner.body.item.settlementDays).toBe(45)
    expect(byOwner.body.item.claimSupplierName).toBe(`Depot ${run}`)
    const listed = await call<{ items: { brandId: string; id: string | null }[] }>(
      app,
      accountant,
      'GET',
      '/claims/policies',
      { brandId: brandY },
    )
    expect(listed.body.items).toHaveLength(1)
    expect(listed.body.items[0]?.brandId).toBe(brandY)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'claims.policy.upsert')))
    expect(audit?.actorId).toBe(ownerId)
  })

  // -------------------------------------------------------------------------------------------------------
  // who sees nothing: the field, the shop, another distributor, nobody
  // -------------------------------------------------------------------------------------------------------

  it('a salesperson gets 403 at the API and zero rows under RLS', async () => {
    const res = await call<{ message: string }>(app, rep, 'GET', '/claims')
    expect(res.status).toBe(403)
    const rows = await as(ctxFor('salesperson', repId), (tx) => tx.select().from(claims))
    expect(rows).toHaveLength(0)
    const lines = await as(ctxFor('salesperson', repId), (tx) => tx.select().from(claimLines))
    expect(lines).toHaveLength(0)
  })

  it('the warehouse never reads a claim line (purchase cost)', async () => {
    const res = await call<{ message: string }>(app, store, 'GET', '/claims/ageing')
    expect(res.status).toBe(403)
    const lines = await as(ctxFor('warehouse', storeId), (tx) => tx.select().from(claimLines))
    expect(lines).toHaveLength(0)
  })

  it('the delivery crew can neither record a settlement nor insert one under RLS', async () => {
    const res = await call<{ message: string }>(
      app,
      crew,
      'POST',
      `/claims/${claim1}/settlements`,
      {
        idempotencyKey: `settle-crew-${run}`,
        id: claim1,
        settlementId: uuidv7(),
        settledOn: '2026-09-04',
        amountPaise: 1,
        mode: 'bank_receipt',
      },
    )
    expect(res.status).toBe(403)
    const refused = await as(ctxFor('delivery', crewId), (tx) =>
      tx
        .insert(claimSettlements)
        .values({
          id: uuidv7(),
          tenantId,
          claimId: claim1,
          settledOn: '2026-09-04',
          amountPaise: 1,
          mode: 'bank_receipt',
        })
        .then(() => null)
        .catch((error: unknown) => error),
    )
    // 42501: the policy refused the row (Drizzle wraps the driver error, the SQLSTATE sits on `cause`)
    expect(pgCode(refused)).toBe('42501')
  })

  it('a shop sees nothing: 403 and zero rows', async () => {
    const res = await call<{ message: string }>(app, shop, 'GET', `/claims/${claim1}`)
    expect(res.status).toBe(403)
    const rows = await as(ctxFor('retailer', shopUserId), (tx) => tx.select().from(claims))
    expect(rows).toHaveLength(0)
  })

  it('another distributor cannot see the claim: 404 at the API, zero rows under RLS', async () => {
    const res = await call<{ message: string }>(app, stranger, 'GET', `/claims/${claim1}`)
    expect(res.status).toBe(404)
    const rows = await as(ctxFor('owner', otherOwnerId, otherTenantId), (tx) =>
      tx.select().from(claims),
    )
    expect(rows.some((r) => r.tenantId === tenantId)).toBe(false)
  })

  it('answers 401 without a token', async () => {
    const res = await call<{ message: string }>(app, null, 'GET', '/claims')
    expect(res.status).toBe(401)
  })
})
