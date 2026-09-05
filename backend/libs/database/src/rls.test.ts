import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, withTenant, type Db } from './client.js'
import {
  accounts,
  allocations,
  authEvents,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  authSessions,
  invoices,
  journalEntries,
  journalLines,
  memberships,
  receipts,
  retailerIdentities,
  retailerLinks,
  retailerOutstandingSummary,
  retailers,
  salesOrders,
  stockBalances,
  stockLedger,
  stockLots,
  tenantProductCosts,
  tenantSettings,
  tenants,
  users,
  manufacturers,
  products,
  productVariants,
  locations,
  writeOffs,
} from './schema/index.js'
import { bootstrapTenant, TENANT_SETTING_KEYS } from './tenant-bootstrap.js'

/**
 * Database guarantees from the ADRs, run against a migrated Postgres (DATABASE_URL). CI provides one;
 * locally: DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos pnpm --filter @dos/db test
 */
const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** Drizzle wraps Postgres errors ("Failed query: ..."); the trigger/constraint message is on `cause`. */
async function rejectsWith(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    const err = e as { message?: string; cause?: { message?: string } }
    return pattern.test(err.cause?.message ?? err.message ?? '')
  })
}

describeDb('row level security and ledger guarantees', () => {
  const pool = createPool(url ?? '')
  const db: Db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantA = uuidv7()
  const tenantB = uuidv7()
  const owner = uuidv7()
  const rep = uuidv7()
  const storeKeeper = uuidv7()
  const driver = uuidv7()
  const shopUser = uuidv7()
  const otherShopUser = uuidv7()
  const variant = uuidv7()
  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const identityA = uuidv7()
  const identityOther = uuidv7()
  const balanceLot = uuidv7()
  const ownerSession = uuidv7()
  const storeKeeperSession = uuidv7()
  const invoiceA = uuidv7()
  const invoiceB = uuidv7()
  const invoiceLineA = uuidv7()
  const invoiceLineB = uuidv7()
  const creditNoteA = uuidv7()
  let godownA = ''

  beforeAll(async () => {
    // Fixture setup runs as the connection owner (no RLS) on purpose.
    await db.insert(tenants).values([
      { id: tenantA, slug: `a-${run}`, legalName: 'Tenant A', stateCode: '27' },
      { id: tenantB, slug: `b-${run}`, legalName: 'Tenant B', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: owner, phone: `+91900${run}1`, name: 'Owner' },
      { id: rep, phone: `+91900${run}2`, name: 'Rep' },
      { id: shopUser, phone: `+91900${run}3`, name: 'Shop' },
      { id: otherShopUser, phone: `+91900${run}4`, name: 'Other shop' },
      { id: storeKeeper, phone: `+91900${run}5`, name: 'Store keeper' },
      { id: driver, phone: `+91900${run}6`, name: 'Driver' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId: tenantA, userId: owner, role: 'owner' },
      { id: uuidv7(), tenantId: tenantA, userId: rep, role: 'salesperson' },
      { id: uuidv7(), tenantId: tenantA, userId: shopUser, role: 'retailer' },
      { id: uuidv7(), tenantId: tenantA, userId: otherShopUser, role: 'retailer' },
      { id: uuidv7(), tenantId: tenantA, userId: storeKeeper, role: 'warehouse' },
      { id: uuidv7(), tenantId: tenantA, userId: driver, role: 'delivery' },
    ])
    const inThirtyDays = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    await db.insert(authSessions).values([
      {
        id: ownerSession,
        userId: owner,
        tenantId: tenantA,
        role: 'owner',
        deviceId: `dev-owner-${run}`,
        refreshTokenHash: `hash-owner-${run}`,
        refreshExpiresAt: inThirtyDays,
      },
      {
        id: storeKeeperSession,
        userId: storeKeeper,
        tenantId: tenantA,
        role: 'warehouse',
        deviceId: `dev-store-${run}`,
        refreshTokenHash: `hash-store-${run}`,
        refreshExpiresAt: inThirtyDays,
      },
    ])
    await bootstrapTenant(db, tenantA)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Cola' })
    await db.insert(productVariants).values({
      id: variant,
      productId,
      name: 'Cola 750ml',
      netQty: 750,
      netUnit: 'ml',
      defaultCaseSize: 24,
      hsnCode: '2202',
    })
    await db.insert(retailerIdentities).values([
      { id: identityA, phone: `+91900${run}3`, userId: shopUser, shopName: 'Shop A' },
      { id: identityOther, phone: `+91900${run}4`, userId: otherShopUser, shopName: 'Other shop' },
    ])
    await db.insert(retailers).values([
      {
        id: retailerA,
        tenantId: tenantA,
        identityId: identityA,
        code: `R${run}`,
        name: 'Shop A',
        phone: `+91900${run}3`,
        stateCode: '27',
      },
      {
        id: retailerB,
        tenantId: tenantA,
        identityId: identityOther,
        code: `S${run}`,
        name: 'Other shop',
        phone: `+91900${run}4`,
        stateCode: '27',
      },
    ])
    await db.insert(retailerLinks).values([
      {
        id: uuidv7(),
        tenantId: tenantA,
        identityId: identityA,
        retailerId: retailerA,
        userId: shopUser,
        linkedBy: 'rep_onboarding',
      },
      {
        id: uuidv7(),
        tenantId: tenantA,
        identityId: identityOther,
        retailerId: retailerB,
        userId: otherShopUser,
        linkedBy: 'rep_onboarding',
      },
    ])
    // Receivables fixtures: one issued bill per shop, a receipt allocated against each, a write-off, and
    // the outstanding rollup row the owner tile and the shop's "my dues" screen both read.
    await db.insert(invoices).values([
      {
        id: invoiceA,
        tenantId: tenantA,
        invoiceNo: `T${run}/1`,
        fy: '2026-27',
        invoiceDate: '2026-09-01',
        retailerId: retailerA,
        state: 'issued',
        buyerName: 'Shop A',
        placeOfSupplyState: '27',
        totalPaise: 118_000,
      },
      {
        id: invoiceB,
        tenantId: tenantA,
        invoiceNo: `T${run}/2`,
        fy: '2026-27',
        invoiceDate: '2026-09-01',
        retailerId: retailerB,
        state: 'issued',
        buyerName: 'Other shop',
        placeOfSupplyState: '27',
        totalPaise: 250_000,
      },
    ])
    // Billing fixtures: one line per bill and one credit note on shop A's, so the retailer-scoped read
    // policies on all four billing tables have something to hide from the OTHER shop.
    await db.insert(invoiceLines).values([
      {
        id: invoiceLineA,
        tenantId: tenantA,
        invoiceId: invoiceA,
        lineNo: 1,
        variantId: variant,
        description: 'Wafers 45 g',
        hsnCode: '19059040',
        qtyPcs: 24,
        ratePaise: 4_000,
        taxablePaise: 96_000,
        gstBps: 1_200,
        lineTotalPaise: 107_520,
      },
      {
        id: invoiceLineB,
        tenantId: tenantA,
        invoiceId: invoiceB,
        lineNo: 1,
        variantId: variant,
        description: 'Wafers 45 g',
        hsnCode: '19059040',
        qtyPcs: 50,
        ratePaise: 4_000,
        taxablePaise: 200_000,
        gstBps: 1_200,
        lineTotalPaise: 224_000,
      },
    ])
    await db.insert(creditNotes).values({
      id: creditNoteA,
      tenantId: tenantA,
      creditNoteNo: `CN-${run}-1`,
      fy: '2026-27',
      noteDate: '2026-09-02',
      invoiceId: invoiceA,
      retailerId: retailerA,
      reason: 'short_delivery',
      state: 'issued',
      taxablePaise: 4_000,
      cgstPaise: 240,
      sgstPaise: 240,
      totalPaise: 4_500,
    })
    await db.insert(creditNoteLines).values({
      id: uuidv7(),
      tenantId: tenantA,
      creditNoteId: creditNoteA,
      invoiceLineId: invoiceLineA,
      qtyPcs: 1,
      ratePaise: 4_000,
      taxablePaise: 4_000,
      gstBps: 1_200,
      taxPaise: 480,
      lineTotalPaise: 4_480,
    })
    const receiptA = uuidv7()
    const receiptB = uuidv7()
    await db.insert(receipts).values([
      {
        id: receiptA,
        tenantId: tenantA,
        receiptNo: `RCPT-${run}-1`,
        retailerId: retailerA,
        mode: 'cash',
        amountPaise: 50_000,
        receivedAt: new Date(),
        receivedBy: owner,
        idempotencyKey: `rcpt-a-${run}`,
      },
      {
        id: receiptB,
        tenantId: tenantA,
        receiptNo: `RCPT-${run}-2`,
        retailerId: retailerB,
        mode: 'upi',
        amountPaise: 90_000,
        receivedAt: new Date(),
        receivedBy: owner,
        idempotencyKey: `rcpt-b-${run}`,
      },
    ])
    const writeOffA = uuidv7()
    await db.insert(writeOffs).values({
      id: writeOffA,
      tenantId: tenantA,
      invoiceId: invoiceA,
      retailerId: retailerA,
      amountPaise: 1_000,
      reason: 'bad_debt',
      approvedBy: owner,
      idempotencyKey: `wo-a-${run}`,
    })
    await db.insert(allocations).values([
      {
        id: uuidv7(),
        tenantId: tenantA,
        invoiceId: invoiceA,
        receiptId: receiptA,
        amountPaise: 50_000,
      },
      {
        id: uuidv7(),
        tenantId: tenantA,
        invoiceId: invoiceB,
        receiptId: receiptB,
        amountPaise: 90_000,
      },
      {
        id: uuidv7(),
        tenantId: tenantA,
        invoiceId: invoiceA,
        writeOffId: writeOffA,
        amountPaise: 1_000,
      },
    ])
    await db.insert(retailerOutstandingSummary).values([
      {
        tenantId: tenantA,
        retailerId: retailerA,
        outstandingPaise: 67_000,
        openBills: 1,
        asOf: '2026-09-04',
      },
      {
        tenantId: tenantA,
        retailerId: retailerB,
        outstandingPaise: 160_000,
        openBills: 1,
        asOf: '2026-09-04',
      },
    ])
    await db.insert(tenantProductCosts).values({
      id: uuidv7(),
      tenantId: tenantA,
      variantId: variant,
      purchaseRatePaise: 3000,
      landedCostPaise: 3100,
    })
    await db.insert(salesOrders).values({
      id: uuidv7(),
      tenantId: tenantA,
      retailerId: retailerA,
      source: 'salesperson',
      createdBy: rep,
      paymentTerms: 'POST_FULFILLMENT',
    })
    const [g] = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantA} AND ${locations.kind} = 'warehouse'`)
    godownA = g?.id ?? ''
    await db.insert(stockLots).values({
      id: balanceLot,
      tenantId: tenantA,
      variantId: variant,
      batchNo: 'BAL',
      mrpPaise: 4000,
    })
    await db
      .insert(stockBalances)
      .values({ tenantId: tenantA, lotId: balanceLot, locationId: godownA, onHand: 120 })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('never shows purchase cost to a salesperson, but does to the owner', async () => {
    const asRep = await withTenant(
      db,
      { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' },
      (tx) => tx.select().from(tenantProductCosts),
    )
    expect(asRep).toHaveLength(0)
    const asOwner = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(tenantProductCosts),
    )
    expect(asOwner).toHaveLength(1)
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' }, (tx) =>
        tx.insert(tenantProductCosts).values({
          id: uuidv7(),
          tenantId: tenantA,
          variantId: variant,
          purchaseRatePaise: 1,
          landedCostPaise: 1,
        }),
      ),
    ).rejects.toThrow()
  })

  it('lets the warehouse role read stock but never purchase cost', async () => {
    const ctx = { tenantId: tenantA, actorId: storeKeeper, actorRole: 'warehouse' } as const
    const balances = await withTenant(db, ctx, (tx) =>
      tx
        .select()
        .from(stockBalances)
        .where(sql`${stockBalances.lotId} = ${balanceLot}`),
    )
    expect(balances).toHaveLength(1)
    expect(balances[0]?.onHand).toBe(120)
    const costs = await withTenant(db, ctx, (tx) => tx.select().from(tenantProductCosts))
    expect(costs).toHaveLength(0)
    await expect(
      withTenant(db, ctx, (tx) =>
        tx.insert(tenantProductCosts).values({
          id: uuidv7(),
          tenantId: tenantA,
          variantId: variant,
          purchaseRatePaise: 1,
          landedCostPaise: 1,
        }),
      ),
    ).rejects.toThrow()
  })

  it('shows a user only its own auth sessions', async () => {
    const mine = await withTenant(
      db,
      { tenantId: tenantA, actorId: storeKeeper, actorRole: 'warehouse' },
      (tx) => tx.select().from(authSessions),
    )
    expect(mine.map((s) => s.id)).toEqual([storeKeeperSession])
    const repSees = await withTenant(
      db,
      { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' },
      (tx) => tx.select().from(authSessions),
    )
    expect(repSees).toHaveLength(0)
  })

  it('keeps the auth event trail append-only', async () => {
    const event = uuidv7()
    await withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, (tx) =>
      tx.insert(authEvents).values({
        id: event,
        userId: owner,
        usernameAttempted: `owner.${run}`,
        tenantId: tenantA,
        kind: 'login_ok',
      }),
    )
    // Mutating runs on the owner connection (BYPASSRLS): the trigger, not a policy, is the guarantee.
    await rejectsWith(
      db
        .update(authEvents)
        .set({ kind: 'login_failed' })
        .where(sql`${authEvents.id} = ${event}`),
      /append-only/,
    )
    await rejectsWith(db.delete(authEvents).where(sql`${authEvents.id} = ${event}`), /append-only/)
    const seen = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'owner' },
      (tx) =>
        tx
          .select()
          .from(authEvents)
          .where(sql`${authEvents.id} = ${event}`),
    )
    expect(seen).toHaveLength(1)
    const hidden = await withTenant(
      db,
      { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' },
      (tx) =>
        tx
          .select()
          .from(authEvents)
          .where(sql`${authEvents.id} = ${event}`),
    )
    expect(hidden).toHaveLength(0)
  })

  it('isolates tenants: tenant B sees none of tenant A rows and cannot insert into A', async () => {
    const seen = await withTenant(
      db,
      { tenantId: tenantB, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(retailers),
    )
    expect(seen).toHaveLength(0)
    await expect(
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, (tx) =>
        tx.insert(retailers).values({
          id: uuidv7(),
          tenantId: tenantA,
          code: 'X',
          name: 'X',
          phone: '+919999999999',
          stateCode: '27',
        }),
      ),
    ).rejects.toThrow()
  })

  it('shows a retailer only its own orders and lets it see its distributor link', async () => {
    const own = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(salesOrders),
    )
    expect(own).toHaveLength(1)
    const other = await withTenant(
      db,
      { tenantId: tenantA, actorId: otherShopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(salesOrders),
    )
    expect(other).toHaveLength(0)
    const links = await withTenant(
      db,
      { tenantId: '', actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(retailerLinks),
    )
    expect(links).toHaveLength(1)
    // the retailer role may not edit its own credit limit
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' }, (tx) =>
        tx
          .update(retailers)
          .set({ creditLimitPaise: 10_000_000 })
          .where(sql`${retailers.id} = ${retailerA}`),
      ),
    ).resolves.toBeDefined()
    const [r] = await db
      .select()
      .from(retailers)
      .where(sql`${retailers.id} = ${retailerA}`)
    expect(r?.creditLimitPaise).toBe(0)
  })

  it('keeps the stock ledger append-only', async () => {
    const lot = uuidv7()
    const row = uuidv7()
    await withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, async (tx) => {
      await tx
        .insert(stockLots)
        .values({ id: lot, tenantId: tenantA, variantId: variant, batchNo: 'B1', mrpPaise: 4000 })
      await tx.insert(stockLedger).values({
        id: row,
        tenantId: tenantA,
        lotId: lot,
        locationId: godownA,
        qtyDelta: 24,
        reason: 'opening',
        actorId: owner,
        idempotencyKey: `open-${row}`,
      })
    })
    await rejectsWith(
      withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, (tx) =>
        tx
          .update(stockLedger)
          .set({ qtyDelta: 99 })
          .where(sql`${stockLedger.id} = ${row}`),
      ),
      /append-only/,
    )
    await rejectsWith(
      withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, (tx) =>
        tx.delete(stockLedger).where(sql`${stockLedger.id} = ${row}`),
      ),
      /append-only/,
    )
    // replaying the same idempotency key is rejected by the unique index
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, (tx) =>
        tx.insert(stockLedger).values({
          id: uuidv7(),
          tenantId: tenantA,
          lotId: lot,
          locationId: godownA,
          qtyDelta: 1,
          reason: 'adjustment',
          actorId: owner,
          idempotencyKey: `open-${row}`,
        }),
      ),
    ).rejects.toThrow()
  })

  it('rejects an unbalanced journal entry at commit and accepts a balanced one', async () => {
    const [ar] = await db
      .select()
      .from(accounts)
      .where(sql`${accounts.tenantId} = ${tenantA} AND ${accounts.code} = 'AR'`)
    const [sales] = await db
      .select()
      .from(accounts)
      .where(sql`${accounts.tenantId} = ${tenantA} AND ${accounts.code} = 'SALES'`)
    if (!ar || !sales) throw new Error('chart of accounts not seeded')
    const post = (lines: number[]) =>
      withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'owner' }, async (tx) => {
        const entry = uuidv7()
        await tx.insert(journalEntries).values({
          id: entry,
          tenantId: tenantA,
          entryDate: '2026-09-04',
          refType: 'test',
          refId: entry,
          idempotencyKey: entry,
        })
        await tx.insert(journalLines).values(
          lines.map((amt, i) => ({
            id: uuidv7(),
            tenantId: tenantA,
            entryId: entry,
            accountId: i === 0 ? ar.id : sales.id,
            amountPaise: amt,
          })),
        )
      })
    await rejectsWith(post([118_000, -100_000]), /does not balance/)
    await expect(post([118_000, -118_000])).resolves.toBeUndefined()
  })

  /**
   * Posts one entry with the given line amounts as `role`. The field roles may INSERT into the book and may
   * not SELECT it (migration 0006), which is exactly the condition under which the balance trigger of
   * migration 0003 read zero rows, concluded "0 = balanced" and let bad money commit. See
   * 0007_receivables_guarantees.sql and docs/plans/00-coordination.md §5.2.
   */
  async function postAs(
    role: 'owner' | 'salesperson' | 'delivery',
    actorId: string,
    lines: number[],
  ): Promise<void> {
    const [ar] = await db
      .select()
      .from(accounts)
      .where(sql`${accounts.tenantId} = ${tenantA} AND ${accounts.code} = 'AR'`)
    const [cashVan] = await db
      .select()
      .from(accounts)
      .where(sql`${accounts.tenantId} = ${tenantA} AND ${accounts.code} = 'CASH_VAN'`)
    if (!ar || !cashVan) throw new Error('chart of accounts not seeded')
    await withTenant(db, { tenantId: tenantA, actorId, actorRole: role }, async (tx) => {
      const entry = uuidv7()
      await tx.insert(journalEntries).values({
        id: entry,
        tenantId: tenantA,
        entryDate: '2026-09-04',
        refType: 'receipt',
        refId: entry,
        idempotencyKey: entry,
      })
      await tx.insert(journalLines).values(
        lines.map((amt, i) => ({
          id: uuidv7(),
          tenantId: tenantA,
          entryId: entry,
          accountId: i === 0 ? cashVan.id : ar.id,
          amountPaise: amt,
          partyType: 'retailer',
          partyId: retailerA,
        })),
      )
    })
  }

  it('still balances the book for a delivery actor who may post but not read it', async () => {
    // THE REGRESSION THIS EXISTS FOR: without SECURITY DEFINER on dos_journal_entry_balanced(), the
    // deferred trigger runs under the delivery actor's own policies, sees zero lines, reads the sum as 0
    // and lets an unbalanced doorstep receipt COMMIT. This case fails on 0006 alone and passes on 0007.
    await rejectsWith(postAs('delivery', driver, [50_000, -40_000]), /does not balance/)
    await expect(postAs('delivery', driver, [50_000, -50_000])).resolves.toBeUndefined()
    // ...and the actor that just posted it still cannot read a single line of the book back.
    const seen = await withTenant(
      db,
      { tenantId: tenantA, actorId: driver, actorRole: 'delivery' },
      (tx) => tx.select().from(journalLines),
    )
    expect(seen).toHaveLength(0)
  })

  it('still balances the book for a salesperson who may post but not read it', async () => {
    await rejectsWith(postAs('salesperson', rep, [30_000, -20_000]), /does not balance/)
    await expect(postAs('salesperson', rep, [30_000, -30_000])).resolves.toBeUndefined()
  })

  it('keeps the journal and the chart of accounts invisible to a salesperson', async () => {
    const ctx = { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' } as const
    // The book carries PURCHASES, STOCK and every GRN posting: reading it would leak purchase cost.
    expect(await withTenant(db, ctx, (tx) => tx.select().from(journalLines))).toHaveLength(0)
    expect(await withTenant(db, ctx, (tx) => tx.select().from(journalEntries))).toHaveLength(0)
    // The chart itself carries no amounts and posting needs the code -> id lookup, so it stays readable.
    const chart = await withTenant(db, ctx, (tx) => tx.select().from(accounts))
    expect(chart.length).toBeGreaterThan(0)
    // ...but a rep may not add or rename an account.
    await expect(
      withTenant(db, ctx, (tx) =>
        tx.insert(accounts).values({
          id: uuidv7(),
          tenantId: tenantA,
          code: `X${run}`,
          name: 'Sneaky',
          kind: 'asset',
        }),
      ),
    ).rejects.toThrow()
  })

  it('hides the chart of accounts from a retailer and the book from everyone but the back office', async () => {
    const asShop = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(accounts),
    )
    expect(asShop).toHaveLength(0)
    const asAccountant = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'accountant' },
      (tx) => tx.select().from(journalLines),
    )
    expect(asAccountant.length).toBeGreaterThan(0)
  })

  it('lets a delivery actor record a receipt and read it back, but not another tenant’s', async () => {
    const ctx = { tenantId: tenantA, actorId: driver, actorRole: 'delivery' } as const
    const doorstep = uuidv7()
    await withTenant(db, ctx, (tx) =>
      tx.insert(receipts).values({
        id: doorstep,
        tenantId: tenantA,
        receiptNo: `RCPT-${run}-D`,
        retailerId: retailerA,
        mode: 'cash',
        amountPaise: 25_000,
        receivedAt: new Date(),
        receivedBy: driver,
        idempotencyKey: `rcpt-door-${run}`,
      }),
    )
    const mine = await withTenant(db, ctx, (tx) =>
      tx
        .select()
        .from(receipts)
        .where(sql`${receipts.id} = ${doorstep}`),
    )
    expect(mine).toHaveLength(1)
    const fromTenantB = await withTenant(
      db,
      { tenantId: tenantB, actorId: driver, actorRole: 'delivery' },
      (tx) => tx.select().from(receipts),
    )
    expect(fromTenantB).toHaveLength(0)
  })

  it('keeps write-offs to the back office', async () => {
    const backOffice = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(writeOffs),
    )
    expect(backOffice).toHaveLength(1)
    for (const role of ['salesperson', 'delivery', 'warehouse', 'retailer'] as const) {
      const actorId = role === 'retailer' ? shopUser : role === 'delivery' ? driver : rep
      const seen = await withTenant(db, { tenantId: tenantA, actorId, actorRole: role }, (tx) =>
        tx.select().from(writeOffs),
      )
      expect(seen, `${role} must not read write_offs`).toHaveLength(0)
    }
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' }, (tx) =>
        tx.insert(writeOffs).values({
          id: uuidv7(),
          tenantId: tenantA,
          invoiceId: invoiceA,
          retailerId: retailerA,
          amountPaise: 500,
          reason: 'bad_debt',
          approvedBy: rep,
          idempotencyKey: `wo-rep-${run}`,
        }),
      ),
    ).rejects.toThrow()
  })

  it('shows the outstanding rollup to staff and to the linked shop for its own row only', async () => {
    const staff = await withTenant(
      db,
      { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' },
      (tx) => tx.select().from(retailerOutstandingSummary),
    )
    expect(staff.map((r) => r.retailerId).sort()).toEqual([retailerA, retailerB].sort())
    const shop = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(retailerOutstandingSummary),
    )
    expect(shop.map((r) => r.retailerId)).toEqual([retailerA])
    // The shop may look; it may never rewrite what it owes.
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' }, (tx) =>
        tx
          .update(retailerOutstandingSummary)
          .set({ outstandingPaise: 0 })
          .where(sql`${retailerOutstandingSummary.retailerId} = ${retailerA}`),
      ),
    ).resolves.toBeDefined()
    const [after] = await db
      .select()
      .from(retailerOutstandingSummary)
      .where(sql`${retailerOutstandingSummary.retailerId} = ${retailerA}`)
    expect(after?.outstandingPaise).toBe(67_000)
  })

  it('scopes allocations to the shop’s own bills', async () => {
    const staff = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'accountant' },
      (tx) => tx.select().from(allocations),
    )
    expect(staff.length).toBeGreaterThanOrEqual(3)
    const shop = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(allocations),
    )
    expect(shop.every((a) => a.invoiceId === invoiceA)).toBe(true)
    expect(shop.length).toBe(2)
  })

  /**
   * Migration 0009 (docs/plans/00-coordination.md §5.1). Until it landed, `tenant_settings` had one
   * policy — owner/system, FOR ALL — so under FORCE RLS every other role read the table as EMPTY and
   * silently treated every setting as unconfigured: no UPI QR on the bill, no distributor name on the
   * document, a zero e-way-bill threshold. Staff now read it; a shopkeeper never does; and a key named
   * `secret.%` stays owner-only so a credential added later cannot leak through this widening.
   */
  /**
   * A tax invoice carries no purchase cost, which is why every role including the shopkeeper may READ
   * one — and why the guarantee that a shop sees only ITS OWN bills has to be row-level security rather
   * than a WHERE clause in the handler. It is also the whole of a shop's write access to billing: none.
   */
  it('shows a retailer only its own bills, its lines and its credit notes, and lets it write none', async () => {
    const asShop = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' }, fn)

    const bills = await asShop((tx) => tx.select().from(invoices))
    expect(bills.map((i) => i.id)).toEqual([invoiceA])
    const lines = await asShop((tx) => tx.select().from(invoiceLines))
    expect(lines.map((l) => l.id)).toEqual([invoiceLineA])
    const notes = await asShop((tx) => tx.select().from(creditNotes))
    expect(notes.map((c) => c.id)).toEqual([creditNoteA])
    expect(await asShop((tx) => tx.select().from(creditNoteLines))).toHaveLength(1)

    // The OTHER shop is a retailer login in the SAME tenant, linked to a different shop: it sees its own
    // bill and its own line, and none of shop A's — including the credit note, which is on A's bill.
    const otherShop = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantA, actorId: otherShopUser, actorRole: 'retailer' }, fn)
    expect((await otherShop((tx) => tx.select().from(invoices))).map((i) => i.id)).toEqual([
      invoiceB,
    ])
    expect((await otherShop((tx) => tx.select().from(invoiceLines))).map((l) => l.id)).toEqual([
      invoiceLineB,
    ])
    expect(await otherShop((tx) => tx.select().from(creditNotes))).toHaveLength(0)
    expect(await otherShop((tx) => tx.select().from(creditNoteLines))).toHaveLength(0)

    // a shop writes NOTHING here: `staffWritePolicy` refuses the insert outright…
    await expect(
      asShop((tx) =>
        tx.insert(invoices).values({
          id: uuidv7(),
          tenantId: tenantA,
          fy: '2026-27',
          invoiceDate: '2026-09-03',
          retailerId: retailerA,
          buyerName: 'Shop A',
          placeOfSupplyState: '27',
          totalPaise: 1,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asShop((tx) =>
        tx.insert(creditNotes).values({
          id: uuidv7(),
          tenantId: tenantA,
          fy: '2026-27',
          noteDate: '2026-09-03',
          invoiceId: invoiceA,
          retailerId: retailerA,
          reason: 'other',
          totalPaise: 1,
        }),
      ),
    ).rejects.toThrow()
    // …and an UPDATE matches no row, so the amounts on its own bill are unchanged
    await asShop((tx) =>
      tx
        .update(invoices)
        .set({ totalPaise: 1 })
        .where(sql`${invoices.id} = ${invoiceA}`),
    )
    const [unchanged] = await db
      .select()
      .from(invoices)
      .where(sql`${invoices.id} = ${invoiceA}`)
    expect(unchanged?.totalPaise).toBe(118_000)
  })

  it('lets staff read tenant settings, hides secrets, and shows a retailer nothing', async () => {
    await db
      .insert(tenantSettings)
      .values([
        { tenantId: tenantA, key: TENANT_SETTING_KEYS.upiVpa, value: 'tarsun@okhdfcbank' },
        { tenantId: tenantA, key: 'secret.msg91_key', value: 'not-for-staff' },
      ])
      .onConflictDoNothing()

    // bootstrapTenant seeds the white-label defaults every document renderer reads.
    const branding = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(tenantSettings),
    )
    expect(branding.find((r) => r.key === TENANT_SETTING_KEYS.brandingDisplayName)?.value).toBe(
      'Tenant A',
    )
    expect(branding.some((r) => r.key === TENANT_SETTING_KEYS.brandingInvoiceFooter)).toBe(true)
    // the owner is the only role that sees the secret
    expect(branding.some((r) => r.key === 'secret.msg91_key')).toBe(true)

    for (const [actorId, role] of [
      [owner, 'manager'],
      [owner, 'accountant'],
      [rep, 'salesperson'],
      [storeKeeper, 'warehouse'],
      [driver, 'delivery'],
    ] as const) {
      const seen = await withTenant(db, { tenantId: tenantA, actorId, actorRole: role }, (tx) =>
        tx.select().from(tenantSettings),
      )
      expect(seen.find((r) => r.key === TENANT_SETTING_KEYS.upiVpa)?.value).toBe(
        'tarsun@okhdfcbank',
      )
      expect(seen.find((r) => r.key === TENANT_SETTING_KEYS.brandingDisplayName)?.value).toBe(
        'Tenant A',
      )
      expect(seen.some((r) => r.key.startsWith('secret.'))).toBe(false)
    }

    // A shopkeeper is a guest in the distributor's tenant: the configuration is not theirs to read.
    const shop = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(tenantSettings),
    )
    expect(shop).toHaveLength(0)

    // Read only: the widened policy is FOR SELECT, so writes stay owner-only.
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: rep, actorRole: 'salesperson' }, (tx) =>
        tx.insert(tenantSettings).values({ tenantId: tenantA, key: `rogue-${run}`, value: 'nope' }),
      ),
    ).rejects.toThrow()
    // ...and tenant B cannot see tenant A's settings at all.
    const other = await withTenant(
      db,
      { tenantId: tenantB, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(tenantSettings),
    )
    expect(other.every((r) => r.tenantId === tenantB)).toBe(true)
  })
})
