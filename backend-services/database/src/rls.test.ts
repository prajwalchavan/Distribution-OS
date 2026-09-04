import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, withTenant, type Db } from './client.js'
import {
  accounts,
  journalEntries,
  journalLines,
  memberships,
  retailerIdentities,
  retailerLinks,
  retailers,
  salesOrders,
  stockLedger,
  stockLots,
  tenantProductCosts,
  tenants,
  users,
  manufacturers,
  products,
  productVariants,
  locations,
} from './schema/index.js'
import { bootstrapTenant } from './tenant-bootstrap.js'

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
  const shopUser = uuidv7()
  const otherShopUser = uuidv7()
  const variant = uuidv7()
  const retailerA = uuidv7()
  const identityA = uuidv7()
  const identityOther = uuidv7()
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
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId: tenantA, userId: owner, role: 'owner' },
      { id: uuidv7(), tenantId: tenantA, userId: rep, role: 'salesperson' },
      { id: uuidv7(), tenantId: tenantA, userId: shopUser, role: 'retailer' },
      { id: uuidv7(), tenantId: tenantA, userId: otherShopUser, role: 'retailer' },
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
    await db.insert(retailers).values({
      id: retailerA,
      tenantId: tenantA,
      identityId: identityA,
      code: `R${run}`,
      name: 'Shop A',
      phone: `+91900${run}3`,
      stateCode: '27',
    })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId: tenantA,
      identityId: identityA,
      retailerId: retailerA,
      userId: shopUser,
      linkedBy: 'rep_onboarding',
    })
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
})
