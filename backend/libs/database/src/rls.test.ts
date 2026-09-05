import { eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, withTenant, type Db } from './client.js'
import {
  accounts,
  achievements,
  aiForecasts,
  aiOrderDrafts,
  allocations,
  approvals,
  auditLog,
  authEvents,
  bargainRequests,
  beatAssignments,
  beats,
  brands,
  broadcasts,
  claimEvidence,
  claimLines,
  claims,
  claimSettlements,
  claimStatements,
  collections,
  computedPayouts,
  correctionsLog,
  creditNoteLines,
  creditNotes,
  dailyOwnerStats,
  dailyRepStats,
  dailyRetailerStats,
  dailyTenantStats,
  deliveries,
  deliveryChallans,
  deliveryLines,
  documentPages,
  documents,
  engineDisagreements,
  exportJobs,
  extractionChecks,
  extractions,
  featureFlags,
  fileObjects,
  grns,
  importJobs,
  importProfiles,
  importRows,
  inboundMessages,
  invoiceLines,
  authSessions,
  idempotencyKeys,
  invoices,
  journalEntries,
  journalLines,
  loadSheets,
  memberships,
  messages,
  numberingSeries,
  ownerSummary,
  packConfirmations,
  pickLines,
  picklists,
  platformAdmins,
  platformAudit,
  podEvidence,
  priceLists,
  priceListItems,
  pushTokens,
  receipts,
  retailerBehaviour,
  retailerIdentities,
  retailerLinks,
  retailerOutstandingSummary,
  retailerPriceOverrides,
  retailers,
  returnPolicies,
  routePlans,
  reviewSessions,
  salesOrderLines,
  salesOrders,
  skuMatchCandidates,
  stockBalances,
  stockLedger,
  stockLots,
  subscriptions,
  supplierAliases,
  supplierInvoices,
  suppliers,
  supportGrants,
  syncErrors,
  tallyMappings,
  tallySyncLedger,
  targets,
  tenantProductCosts,
  tenantSettings,
  tenants,
  tripExpenses,
  tripPoints,
  trips,
  tripSettlements,
  tripStops,
  users,
  vehiclePositions,
  vehicles,
  whatsappWindows,
  manufacturers,
  products,
  productVariants,
  locations,
  syncTombstones,
  visits,
  writeOffs,
} from './schema/index.js'
import {
  FORBIDDEN_PULL_COLUMN_PATTERNS,
  SYNC_PULL_TABLES,
  syncPullTablesFor,
} from './sync-tables.js'
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
  const orderA = uuidv7()
  const orderLineA = uuidv7()
  const picklistA = uuidv7()
  const pickLineA = uuidv7()
  const packA = uuidv7()
  const loadSheetA = uuidv7()
  const challanA = uuidv7()
  /** Migration 0012/0013 fixtures: the rep's beat, a price list, a draft sheet awaiting the manager, a bargain, an approval. */
  const manager = uuidv7()
  const beatA = uuidv7()
  const priceListA = uuidv7()
  const loadSheetDraft = uuidv7()
  const bargainA = uuidv7()
  const approvalA = uuidv7()
  const supplierA = uuidv7()
  const grnA = uuidv7()
  const supplierInvoiceA = uuidv7()
  let godownA = ''
  /**
   * Migration 0014/0015 fixtures: two crews on two vans. `driver` is crew on trip A (active, shop A's
   * bill on it) and on a settled trip; `otherDriver` is crew on trip B (active, shop B's bill on it);
   * `tripClosing` is back from the road with no settlement yet, for the money desk to close.
   */
  const otherDriver = uuidv7()
  const vehicleA = uuidv7()
  const vehicleB = uuidv7()
  const vanA = uuidv7()
  const vanB = uuidv7()
  const tripA = uuidv7()
  const tripB = uuidv7()
  const tripSettled = uuidv7()
  const tripClosing = uuidv7()
  const stopA = uuidv7()
  const stopB = uuidv7()
  const deliveryA = uuidv7()
  const deliveryB = uuidv7()
  const deliveryLineA = uuidv7()
  const deliveryLineB = uuidv7()
  const podA = uuidv7()
  const podB = uuidv7()
  const collectionA = uuidv7()
  const collectionB = uuidv7()
  const expenseA = uuidv7()
  const settlementA = uuidv7()
  const pointA = uuidv7()
  /**
   * Migration 0016/0017 fixtures (docint): a supplier bill photographed at the gate, with its page, its
   * extraction (printed purchase rates), a check, a match candidate, an open review by the manager, a
   * correction and an engine disagreement; beside it a proof of delivery the crew captured and a claim
   * sheet the rep captured — the two field kinds — and a supplier alias.
   */
  const docSupplier = uuidv7()
  const docPod = uuidv7()
  const docClaim = uuidv7()
  const pageSupplier = uuidv7()
  const pagePod = uuidv7()
  const extractionA = uuidv7()
  const checkA = uuidv7()
  const candidateA = uuidv7()
  const reviewA = uuidv7()
  const correctionA = uuidv7()
  const disagreementA = uuidv7()
  const aliasA = uuidv7()
  /**
   * Migration 0018/0019 fixtures (integrations): the generic importer's saved column mapping (a named
   * profile), a party-master import parsed and paused at `staged` on that profile, one of its rows waiting
   * for a reviewer, a finished Tally export and the sync-ledger row it pushed, a Tally stock-item mapping;
   * beside them a profile of tenant B, so the job↔profile guard has a foreign row to refuse.
   */
  const profileA = uuidv7()
  const profileB = uuidv7()
  const importJobA = uuidv7()
  const importRowA = uuidv7()
  const exportJobA = uuidv7()
  const tallyMappingA = uuidv7()
  const tallySyncA = uuidv7()
  /**
   * Migration 0021/0022 fixtures (claims): the brand's claim policy (owner-set, back-office read), a
   * scheme claim on the depot that the brand has part-paid — its line carries a PURCHASE COST rate, the
   * reason the whole module is back office — with a photo, a generated sheet and the settlement; beside
   * it tenant B's own claim on its own supplier, so isolation has a foreign row to hide.
   */
  const brandA = uuidv7()
  const policyA = uuidv7()
  const claimA = uuidv7()
  const claimLineA = uuidv7()
  const claimEvidenceA = uuidv7()
  const claimStatementA = uuidv7()
  const claimSettlementA = uuidv7()
  const supplierB = uuidv7()
  const claimB = uuidv7()
  /**
   * Migration 0024/0025 fixtures (notifications): shop A's bill went out on WhatsApp and it has an
   * unread in-app notice; shop B's bill went out too; the rep has a push "needs approval" notice with
   * no shop on it; the rep and the driver each registered a device; shop A texted an order and opened
   * a 24-hour window; the owner announced a scheme to beat A. Beside them tenant B's own beat, so the
   * broadcast↔beat guard has a foreign row to refuse.
   */
  const messageA = uuidv7()
  const messageB = uuidv7()
  const noticeA = uuidv7()
  const staffNotice = uuidv7()
  const tokenRep = uuidv7()
  const tokenDriver = uuidv7()
  const inboundA = uuidv7()
  const broadcastA = uuidv7()
  const beatB = uuidv7()
  /**
   * Migration 0027/0028 fixtures (reporting): one day of the distributorship (`daily_tenant_stats`, with
   * its beat and payment-mode mixes), the rep's and the owner's field day (`daily_rep_stats`), both shops'
   * day rows (`daily_retailer_stats`) and habits (`retailer_behaviour`), the owner's home-screen row and
   * the cost-bearing day (`owner_summary`, `daily_owner_stats`); beside them tenant B's own shop, so the
   * shop↔tenant guard has a foreign row to refuse.
   */
  const statsDay = '2026-09-01'
  const retailerOfB = uuidv7()

  /**
   * Migration 0029/0030 fixtures (incentives): the rep holds two simultaneous targets on different
   * metrics (one of them the newly added `visits`) and the two delivery members hold one each, so
   * "its own and never another rep's" has a second rep to be wrong about; an achievement row for one
   * target of each; last month's statements, one of them already approved. `outsider` is a real user
   * of ANOTHER distributorship, so the member guard has a stranger to refuse.
   */
  const incentiveFrom = '2026-09-01'
  const incentiveTo = '2026-09-30'
  const closedFrom = '2026-08-01'
  const closedTo = '2026-08-31'
  const targetRepValue = uuidv7()
  const targetRepVisits = uuidv7()
  const targetDriver = uuidv7()
  const targetOtherDriver = uuidv7()
  const achievementRep = uuidv7()
  const achievementDriver = uuidv7()
  const payoutRep = uuidv7()
  const payoutDriver = uuidv7()
  const payoutOtherDriver = uuidv7()
  const outsider = uuidv7()

  /**
   * Migrations 0031/0032 fixtures (ai — the founder's v1 AI decision, docs/22 §8 2026-09-05). Four
   * drafts, so every branch of the read policy has a row that must be shown and a row that must be
   * refused: shop A texted on WhatsApp (its shop is on the rep's beat), the rep recorded a voice order
   * for the same shop, the desk typed one for shop B (which is on NO beat), and one arrived from a
   * number nobody has matched to a shop yet. One forecast on the godown, and one route plan per van, so
   * "the crew of THIS trip" has another crew's plan to be wrong about. `godownB` is a location of the
   * other distributorship, so the forecast tenant guard has a foreign row to refuse.
   */
  const draftShopA = uuidv7()
  const draftRepVoice = uuidv7()
  const draftShopB = uuidv7()
  const draftUnmatched = uuidv7()
  const forecastA = uuidv7()
  const routePlanA = uuidv7()
  const routePlanB = uuidv7()
  const godownB = uuidv7()

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
      { id: manager, phone: `+91900${run}7`, name: 'Manager' },
      { id: otherDriver, phone: `+91900${run}8`, name: 'Other driver' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId: tenantA, userId: owner, role: 'owner' },
      { id: uuidv7(), tenantId: tenantA, userId: manager, role: 'manager' },
      { id: uuidv7(), tenantId: tenantA, userId: rep, role: 'salesperson' },
      { id: uuidv7(), tenantId: tenantA, userId: shopUser, role: 'retailer' },
      { id: uuidv7(), tenantId: tenantA, userId: otherShopUser, role: 'retailer' },
      { id: uuidv7(), tenantId: tenantA, userId: storeKeeper, role: 'warehouse' },
      { id: uuidv7(), tenantId: tenantA, userId: driver, role: 'delivery' },
      { id: uuidv7(), tenantId: tenantA, userId: otherDriver, role: 'delivery' },
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
    // The rep's beat: shop A is on it and the rep is assigned to it (0012: beats and assignments are
    // staff-readable, onboarder-written; the rep's "which beat is mine today" reads beat_assignments).
    await db
      .insert(beats)
      .values({ id: beatA, tenantId: tenantA, name: `Beat ${run}`, area: 'Kalyan W' })
    await db.insert(beatAssignments).values({
      id: uuidv7(),
      tenantId: tenantA,
      beatId: beatA,
      userId: rep,
      validFrom: '2026-09-01',
    })
    await db.insert(retailers).values([
      {
        id: retailerA,
        tenantId: tenantA,
        identityId: identityA,
        code: `R${run}`,
        name: 'Shop A',
        phone: `+91900${run}3`,
        stateCode: '27',
        beatId: beatA,
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
      id: orderA,
      tenantId: tenantA,
      retailerId: retailerA,
      state: 'confirmed',
      source: 'salesperson',
      createdBy: rep,
      paymentTerms: 'POST_FULFILLMENT',
    })
    await db.insert(salesOrderLines).values({
      id: orderLineA,
      tenantId: tenantA,
      orderId: orderA,
      lineNo: 1,
      variantId: variant,
      enteredQty: 24,
      qtyPcs: 24,
      listRatePaise: 4_000,
      ratePaise: 4_000,
      gstBps: 1_200,
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
    // Warehouse paperwork (migration 0010): one of each of the five tables the godown owns, so the
    // read/write split between a store keeper, the desk, the crew on the road and the shopkeeper has
    // something real to hide and to show.
    await db.insert(picklists).values({
      id: picklistA,
      tenantId: tenantA,
      picklistNo: `PICK-${run}`,
      locationId: godownA,
      status: 'picking',
      orderIds: [orderA],
      assignedTo: storeKeeper,
    })
    await db.insert(pickLines).values({
      id: pickLineA,
      tenantId: tenantA,
      picklistId: picklistA,
      orderId: orderA,
      orderLineId: orderLineA,
      variantId: variant,
      lineNo: 1,
      lotId: balanceLot,
      suggestedLotId: balanceLot,
      requestedQtyPcs: 24,
      caseSize: 24,
    })
    await db.insert(packConfirmations).values({
      id: packA,
      tenantId: tenantA,
      orderId: orderA,
      picklistId: picklistA,
      packages: 2,
      packedBy: storeKeeper,
    })
    await db.insert(loadSheets).values({
      id: loadSheetA,
      tenantId: tenantA,
      fromLocationId: godownA,
      toLocationId: godownA,
      status: 'confirmed',
      orderIds: [orderA],
      expectedPackages: 2,
      countedPackages: 2,
      loadValuePaise: 118_000,
      // 0013: a confirmed sheet always carries the manager's approval, even one inserted by a seed.
      approvedBy: manager,
      approvedAt: new Date(),
      confirmedBy: manager,
      confirmedAt: new Date(),
    })
    // Migration 0013: a draft sheet the warehouse has built and counted, waiting for the manager's approval.
    await db.insert(loadSheets).values({
      id: loadSheetDraft,
      tenantId: tenantA,
      fromLocationId: godownA,
      toLocationId: godownA,
      status: 'draft',
      orderIds: [orderA],
      expectedPackages: 2,
    })
    // Migration 0012: a price list any member reads and only the price setters write; a bargain and an
    // approval so the read scoping and the "who decides" checks have rows to hide and refuse.
    await db.insert(priceLists).values({
      id: priceListA,
      tenantId: tenantA,
      name: `Tier C ${run}`,
      tier: 'C',
      isDefault: true,
    })
    await db.insert(priceListItems).values({
      id: uuidv7(),
      tenantId: tenantA,
      priceListId: priceListA,
      variantId: variant,
      ratePaise: 4_000,
    })
    await db.insert(retailerPriceOverrides).values({
      id: uuidv7(),
      tenantId: tenantA,
      retailerId: retailerB,
      variantId: variant,
      ratePaise: 3_900,
      validFrom: '2026-09-01',
      approvedBy: owner,
    })
    await db.insert(bargainRequests).values({
      id: bargainA,
      tenantId: tenantA,
      retailerId: retailerB,
      variantId: variant,
      requestedBy: rep,
      listRatePaise: 4_000,
      askedRatePaise: 3_800,
      status: 'requested',
    })
    await db.insert(approvals).values({
      id: approvalA,
      tenantId: tenantA,
      kind: 'credit_limit',
      orderId: orderA,
      entityType: 'sales_order',
      entityId: orderA,
      requestedBy: rep,
      status: 'pending',
      payload: { orderNo: 'SO-1', totalPaise: 118_000 },
    })
    await db.insert(suppliers).values({ id: supplierA, tenantId: tenantA, name: `Depot ${run}` })
    await db.insert(supplierInvoices).values({
      id: supplierInvoiceA,
      tenantId: tenantA,
      supplierId: supplierA,
      source: 'manual',
      invoiceNo: `SUP-${run}`,
      invoiceDate: '2026-09-01',
      totalPaise: 100_000,
    })
    await db.insert(grns).values({
      id: grnA,
      tenantId: tenantA,
      supplierInvoiceId: supplierInvoiceA,
      locationId: godownA,
      status: 'counting',
    })
    await db.insert(deliveryChallans).values({
      id: challanA,
      tenantId: tenantA,
      seriesCode: 'DC',
      challanNo: `DC-${run}`,
      fy: '2026-27',
      challanDate: '2026-09-04',
      loadSheetId: loadSheetA,
      fromLocationId: godownA,
      toLocationId: godownA,
      vehicleNo: 'MH-05-AB-1234',
      lines: [
        {
          variantId: variant,
          lotId: balanceLot,
          qtyPcs: 24,
          taxableValuePaise: 96_000,
          gstBps: 1_200,
        },
      ],
      valuePaise: 118_000,
    })
    // Delivery (migration 0014/0015): two vans, two crews, a bill of each shop on the road, and the
    // money, the proof, the breadcrumbs and the live map that hang off a trip — so every role has a
    // row it must be shown and a row it must be refused.
    await db.insert(locations).values([
      { id: vanA, tenantId: tenantA, kind: 'vehicle', name: `Van A ${run}`, vehicleId: vehicleA },
      { id: vanB, tenantId: tenantA, kind: 'vehicle', name: `Van B ${run}`, vehicleId: vehicleB },
    ])
    await db.insert(vehicles).values([
      { id: vehicleA, tenantId: tenantA, regNo: `MH-05-RA-${run.slice(-4)}`, locationId: vanA },
      { id: vehicleB, tenantId: tenantA, regNo: `MH-05-RB-${run.slice(-4)}`, locationId: vanB },
    ])
    await db.insert(trips).values([
      {
        id: tripA,
        tenantId: tenantA,
        tripNo: `TRIP-A-${run}`,
        tripDate: '2026-09-04',
        vehicleId: vehicleA,
        driverId: driver,
        state: 'active',
        plannedStops: 1,
        openingCashPaise: 500_000,
        startedAt: new Date(),
      },
      {
        id: tripB,
        tenantId: tenantA,
        tripNo: `TRIP-B-${run}`,
        tripDate: '2026-09-04',
        vehicleId: vehicleB,
        driverId: otherDriver,
        state: 'active',
        plannedStops: 1,
        startedAt: new Date(),
      },
      {
        id: tripSettled,
        tenantId: tenantA,
        tripNo: `TRIP-S-${run}`,
        tripDate: '2026-09-03',
        vehicleId: vehicleA,
        driverId: driver,
        state: 'settled',
      },
      {
        id: tripClosing,
        tenantId: tenantA,
        tripNo: `TRIP-C-${run}`,
        tripDate: '2026-09-03',
        vehicleId: vehicleB,
        driverId: otherDriver,
        state: 'closing',
      },
    ])
    await db.insert(tripStops).values([
      { id: stopA, tenantId: tenantA, tripId: tripA, sequence: 1, retailerId: retailerA },
      { id: stopB, tenantId: tenantA, tripId: tripB, sequence: 1, retailerId: retailerB },
    ])
    await db.insert(deliveries).values([
      {
        id: deliveryA,
        tenantId: tenantA,
        tripId: tripA,
        stopId: stopA,
        retailerId: retailerA,
        orderId: orderA,
        invoiceId: invoiceA,
        outcome: 'delivered',
        deliveredBy: driver,
        deliveredAt: new Date(),
        deviceId: `phone-a-${run}`,
        idempotencyKey: `dlv-a-${run}`,
      },
      {
        id: deliveryB,
        tenantId: tenantA,
        tripId: tripB,
        stopId: stopB,
        retailerId: retailerB,
        invoiceId: invoiceB,
        outcome: 'partial',
        deliveredBy: otherDriver,
        deliveredAt: new Date(),
        idempotencyKey: `dlv-b-${run}`,
      },
    ])
    await db.insert(deliveryLines).values([
      {
        id: deliveryLineA,
        tenantId: tenantA,
        deliveryId: deliveryA,
        invoiceLineId: invoiceLineA,
        deliveredQtyPcs: 24,
      },
      {
        id: deliveryLineB,
        tenantId: tenantA,
        deliveryId: deliveryB,
        invoiceLineId: invoiceLineB,
        deliveredQtyPcs: 48,
        returnedQtyPcs: 2,
      },
    ])
    await db.insert(podEvidence).values([
      {
        id: podA,
        tenantId: tenantA,
        deliveryId: deliveryA,
        kind: 'photo',
        objectKey: `pod/a-${run}`,
      },
      { id: podB, tenantId: tenantA, deliveryId: deliveryB, kind: 'signature' },
    ])
    await db.insert(collections).values([
      {
        id: collectionA,
        tenantId: tenantA,
        tripId: tripA,
        stopId: stopA,
        retailerId: retailerA,
        receiptId: uuidv7(),
        mode: 'cash',
        amountPaise: 118_000,
        collectedBy: driver,
      },
      {
        id: collectionB,
        tenantId: tenantA,
        tripId: tripB,
        stopId: stopB,
        retailerId: retailerB,
        receiptId: uuidv7(),
        mode: 'upi',
        amountPaise: 90_000,
        collectedBy: otherDriver,
      },
    ])
    await db.insert(tripExpenses).values({
      id: expenseA,
      tenantId: tenantA,
      tripId: tripA,
      kind: 'diesel',
      amountPaise: 30_000,
      recordedBy: driver,
    })
    await db.insert(tripSettlements).values({
      id: settlementA,
      tenantId: tenantA,
      tripId: tripSettled,
      expectedCashPaise: 200_000,
      handedOverCashPaise: 200_000,
      cashVariancePaise: 0,
      settledBy: owner,
    })
    await db.insert(tripPoints).values({
      id: pointA,
      tenantId: tenantA,
      tripId: tripA,
      userId: driver,
      deviceId: `phone-a-${run}`,
      recordedAt: new Date(),
      lat: 19.24,
      lng: 73.13,
    })
    await db.insert(vehiclePositions).values({
      tenantId: tenantA,
      vehicleId: vehicleA,
      tripId: tripA,
      lat: 19.24,
      lng: 73.13,
      recordedAt: new Date(),
    })
    await db.insert(documents).values([
      {
        id: docSupplier,
        tenantId: tenantA,
        kind: 'supplier_invoice',
        status: 'needs_review',
        uploadedBy: storeKeeper,
        supplierId: supplierA,
        expectedPages: 1,
        promptProfile: 'tally',
        qrStatus: 'verified',
        irn: `irn-${run}`,
        irnVerified: true,
        contentHash: `hash-${run}`,
      },
      { id: docPod, tenantId: tenantA, kind: 'pod', uploadedBy: driver },
      { id: docClaim, tenantId: tenantA, kind: 'claim_sheet', uploadedBy: rep },
    ])
    await db.insert(documentPages).values([
      {
        id: pageSupplier,
        tenantId: tenantA,
        documentId: docSupplier,
        pageNo: 1,
        objectKey: `tenant/${tenantA}/docs/${docSupplier}/page-1.jpg`,
        mimeType: 'image/jpeg',
        sha256: `sha-${run}-1`,
        printedPageLabel: '1 of 1',
        qrDetected: true,
      },
      {
        id: pagePod,
        tenantId: tenantA,
        documentId: docPod,
        pageNo: 1,
        objectKey: `tenant/${tenantA}/docs/${docPod}/page-1.jpg`,
        mimeType: 'image/jpeg',
        sha256: `sha-${run}-2`,
      },
    ])
    await db.insert(extractions).values({
      id: extractionA,
      tenantId: tenantA,
      documentId: docSupplier,
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      promptVersion: 'v1',
      result: { header: { invoiceNo: `SUP-${run}` }, lines: [{ lineNo: 1, ratePaise: 13_543 }] },
      confidence: 0.97,
      costPaise: 240,
      latencyMs: 8_000,
      invoiceNo: `SUP-${run}`,
      invoiceDate: '2026-09-01',
      supplierGstin: '27AAACR5055K1Z7',
      buyerGstin: '27AAAAT0000A1Z5',
      totalPaise: 100_000,
      lineCount: 1,
    })
    await db.insert(extractionChecks).values({
      id: checkA,
      tenantId: tenantA,
      extractionId: extractionA,
      check: 'line_arithmetic',
      passed: false,
      severity: 'error',
      lineNo: 1,
    })
    await db.insert(skuMatchCandidates).values({
      id: candidateA,
      tenantId: tenantA,
      extractionId: extractionA,
      lineNo: 1,
      variantId: variant,
      score: 0.72,
      reason: 'trgm',
      features: { trgm: 0.72 },
    })
    await db.insert(reviewSessions).values({
      id: reviewA,
      tenantId: tenantA,
      documentId: docSupplier,
      reviewerId: manager,
      baseExtractionId: extractionA,
      status: 'open',
      lockedUntil: new Date(Date.now() + 5 * 60_000),
      editsCount: 1,
    })
    await db.insert(correctionsLog).values({
      id: correctionA,
      tenantId: tenantA,
      reviewSessionId: reviewA,
      path: 'lines[0].qtyPcs',
      before: 12,
      after: 24,
    })
    await db.insert(engineDisagreements).values({
      id: disagreementA,
      tenantId: tenantA,
      documentId: docSupplier,
      path: 'lines[0].ratePaise',
      values: { llm_vision: 13_543, llm_vision_secondary: 13_453 },
    })
    await db.insert(supplierAliases).values({
      id: aliasA,
      tenantId: tenantA,
      supplierId: supplierA,
      alias: `DEPOT ${run}`,
      normalized: `depot${run}`,
      hits: 3,
    })
    // Integrations fixtures (0018/0019): the wizard's saved profile, a job paused on it, a row under
    // review, a Tally export with its sync-ledger row, and a stock-item mapping. Tenant B keeps a
    // profile of its own so the guard can refuse a cross-tenant pin.
    await db.insert(importProfiles).values([
      {
        id: profileA,
        tenantId: tenantA,
        name: `TradeEzee party master ${run}`,
        kind: 'tradeezee_party',
        target: 'retailers',
        mapping: { 'Party Name': 'name', Mobile: 'phone', GSTIN: 'gstin' },
        transforms: { phone: { digitsOnly: true } },
        sourceColumns: ['Party Name', 'Mobile', 'GSTIN'],
        createdBy: manager,
      },
      {
        id: profileB,
        tenantId: tenantB,
        name: `Marg party list ${run}`,
        kind: 'marg',
        target: 'retailers',
        mapping: { NAME: 'name', PHONE: 'phone' },
        createdBy: owner,
      },
    ])
    await db.insert(importJobs).values({
      id: importJobA,
      tenantId: tenantA,
      kind: 'tradeezee_party',
      target: 'retailers',
      sourceObjectKey: `tenant/${tenantA}/import/${importJobA}/party-master.csv`,
      sourceFileName: 'party-master.csv',
      profileId: profileA,
      mapping: { 'Party Name': 'name', Mobile: 'phone', GSTIN: 'gstin' },
      sourceColumns: ['Party Name', 'Mobile', 'GSTIN'],
      status: 'staged',
      requestedBy: manager,
      totalRows: 1,
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
    })
    await db.insert(importRows).values({
      id: importRowA,
      tenantId: tenantA,
      importJobId: importJobA,
      rowNo: 1,
      raw: { 'Party Name': 'Shop A', Mobile: `900${run}3`, GSTIN: '' },
      normalized: { name: 'Shop A', phone: `+91900${run}3` },
      status: 'needs_review',
      error: 'Two shops share this phone; pick one.',
    })
    await db.insert(exportJobs).values({
      id: exportJobA,
      tenantId: tenantA,
      kind: 'tally_xml',
      params: { from: '2026-09-01', to: '2026-09-07', voucherTypes: ['sales'] },
      status: 'succeeded',
      requestedBy: owner,
      objectKey: `tenant/${tenantA}/exports/${exportJobA}/tally.xml`,
      rowCount: 1,
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
    })
    await db.insert(tallySyncLedger).values({
      id: tallySyncA,
      tenantId: tenantA,
      docType: 'invoice',
      docId: invoiceA,
      tallyGuid: `guid-${run}`,
      exportJobId: exportJobA,
      contentHash: `hash-${run}`,
    })
    await db.insert(tallyMappings).values({
      id: tallyMappingA,
      tenantId: tenantA,
      entityType: 'stock_item',
      entityId: variant,
      tallyName: 'Cola 750ml',
      tallyParent: 'Beverages',
    })
    // Claims fixtures (0021/0022): the brand's claim policy, a scheme claim the brand has part-paid,
    // its priced line, a damage photo, a rendered sheet, the settlement; and tenant B's own claim.
    await db.insert(brands).values({ id: brandA, manufacturerId, name: `Cola brand ${run}` })
    await db.insert(returnPolicies).values({
      id: policyA,
      tenantId: tenantA,
      brandId: brandA,
      damageClaimable: true,
      claimWindowDays: 45,
      claimSheetFormat: 'generic_xlsx',
      claimPeriodKind: 'monthly',
      claimCutoffDay: 1,
      settlementDays: 30,
      damageValueBasis: 'ptd',
      expiryValueBasis: 'landed_cost',
      claimSupplierId: supplierA,
    })
    await db.insert(claims).values({
      id: claimA,
      tenantId: tenantA,
      claimNo: `CLM-${run}`,
      supplierId: supplierA,
      brandId: brandA,
      kind: 'scheme',
      status: 'partially_settled',
      claimChannel: 'dos',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      claimedPaise: 100_000,
      settledPaise: 40_000,
      submittedAt: new Date('2026-09-02T04:30:00Z'),
      submittedBy: manager,
      dueDate: '2026-10-02',
      accruedAt: new Date('2026-09-02T04:30:00Z'),
      createdBy: manager,
    })
    await db.insert(claimLines).values({
      id: claimLineA,
      tenantId: tenantA,
      claimId: claimA,
      lineNo: 1,
      status: 'claimed',
      sourceType: 'invoice',
      sourceId: invoiceLineA,
      retailerId: retailerA,
      variantId: variant,
      caseSize: 24,
      qtyPcs: 24,
      mrpPaise: 4_000,
      ratePaise: 3_000, // purchase cost: the leak vector
      basis: 'ptd',
      amountPaise: 100_000,
      settledPaise: 40_000,
      detail: { invoiceNo: `T${run}/1`, rewardKind: 'free_qty' },
    })
    await db.insert(claimEvidence).values({
      id: claimEvidenceA,
      tenantId: tenantA,
      claimId: claimA,
      kind: 'damage_photo',
      objectKey: `tenant/${tenantA}/claims/${claimA}/damage-1.jpg`,
      uploadedBy: manager,
    })
    await db.insert(claimStatements).values({
      id: claimStatementA,
      tenantId: tenantA,
      claimId: claimA,
      format: 'generic_xlsx',
      objectKey: null,
      exportJobId: exportJobA,
      generatedAt: null,
      payload: { claimNo: `CLM-${run}`, rows: [] },
    })
    await db.insert(claimSettlements).values({
      id: claimSettlementA,
      tenantId: tenantA,
      claimId: claimA,
      settledOn: '2026-09-04',
      amountPaise: 40_000,
      mode: 'credit_note',
      externalRef: `CN/${run}`,
      recordedBy: owner,
    })
    await db.insert(suppliers).values({ id: supplierB, tenantId: tenantB, name: `Depot B ${run}` })
    await db.insert(claims).values({
      id: claimB,
      tenantId: tenantB,
      supplierId: supplierB,
      kind: 'shortage',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      claimedPaise: 5_000,
    })
    // Notifications fixtures (0024/0025): two shops' bill notifications, shop A's unread in-app
    // notice, the rep's staff-only push notice, two device tokens, an inbound text, a window, a
    // broadcast to beat A; and tenant B's beat.
    await db.insert(messages).values([
      {
        id: messageA,
        tenantId: tenantA,
        channel: 'whatsapp',
        templateKey: 'invoice_issued',
        to: `+91900${run}3`,
        recipientRetailerId: retailerA,
        payload: { invoiceNo: `T${run}/1`, totalPaise: 118_000 },
        status: 'sent',
        providerMessageId: `wamid.${run}.a`,
        costPaise: 14,
        refType: 'invoice',
        refId: invoiceA,
        sentAt: new Date(),
        idempotencyKey: `InvoiceIssued:${invoiceA}`,
      },
      {
        id: messageB,
        tenantId: tenantA,
        channel: 'whatsapp',
        templateKey: 'invoice_issued',
        to: `+91900${run}4`,
        recipientRetailerId: retailerB,
        payload: { invoiceNo: `T${run}/2`, totalPaise: 250_000 },
        status: 'delivered',
        providerMessageId: `wamid.${run}.b`,
        costPaise: 14,
        refType: 'invoice',
        refId: invoiceB,
        sentAt: new Date(),
        deliveredAt: new Date(),
        idempotencyKey: `InvoiceIssued:${invoiceB}`,
      },
      {
        id: noticeA,
        tenantId: tenantA,
        channel: 'in_app',
        templateKey: 'pod_delivered',
        to: shopUser,
        recipientUserId: shopUser,
        recipientRetailerId: retailerA,
        payload: { invoiceNo: `T${run}/1`, outcome: 'delivered' },
        status: 'delivered',
        refType: 'delivery',
        refId: deliveryA,
        sentAt: new Date(),
        deliveredAt: new Date(),
        idempotencyKey: `DeliveryRecorded:${deliveryA}:shop`,
      },
      {
        id: staffNotice,
        tenantId: tenantA,
        channel: 'push',
        templateKey: 'order_needs_approval',
        to: `ExponentPushToken[rep-${run}]`,
        recipientUserId: rep,
        payload: { orderNo: `SO-${run}`, approvalFlags: ['bargain'] },
        status: 'queued',
        refType: 'order',
        refId: orderA,
        idempotencyKey: `OrderSubmitted:${orderA}:${rep}`,
      },
    ])
    await db.insert(pushTokens).values([
      {
        id: tokenRep,
        tenantId: tenantA,
        userId: rep,
        deviceId: `dev-rep-${run}`,
        token: `ExponentPushToken[rep-${run}]`,
        platform: 'android',
      },
      {
        id: tokenDriver,
        tenantId: tenantA,
        userId: driver,
        deviceId: `dev-driver-${run}`,
        token: `ExponentPushToken[driver-${run}]`,
        platform: 'android',
      },
    ])
    await db.insert(inboundMessages).values({
      id: inboundA,
      tenantId: tenantA,
      channel: 'whatsapp',
      from: `+91900${run}3`,
      retailerId: retailerA,
      body: 'bhai 2 case cola kal',
      providerMessageId: `wamid.${run}.in`,
    })
    await db.insert(whatsappWindows).values({
      tenantId: tenantA,
      phone: `+91900${run}3`,
      openedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    await db.insert(broadcasts).values({
      id: broadcastA,
      tenantId: tenantA,
      beatId: beatA,
      channel: 'whatsapp',
      templateKey: 'scheme_announcement',
      variables: { schemeName: 'Diwali 10+1' },
      createdBy: owner,
      totalRecipients: 1,
      queuedCount: 1,
    })
    await db.insert(beats).values({ id: beatB, tenantId: tenantB, name: `Beat B ${run}` })
    // Reporting fixtures (0027/0028): the rollup rows the owner's graphs read, written the way the
    // worker writes them — by the owner connection, outside RLS.
    await db.insert(dailyTenantStats).values({
      tenantId: tenantA,
      day: statsDay,
      ordersCount: 2,
      invoicedPaise: 368_000,
      collectedPaise: 118_000,
      outstandingPaise: 250_000,
      overduePaise: 0,
      deliveredStops: 1,
      partialStops: 1,
      onTimeStops: 2,
      podStops: 2,
      orderedPcs: 74,
      pickedPcs: 74,
      activeRetailers: 2,
      byBrand: { [brandA]: { invoicedPaise: 368_000, invoiceCount: 2 } },
      byBeat: { [beatA]: { invoicedPaise: 118_000, invoiceCount: 1 } },
      byPaymentMode: { cash: 118_000 },
    })
    await db.insert(dailyRepStats).values([
      {
        tenantId: tenantA,
        userId: rep,
        day: statsDay,
        visits: 4,
        productiveVisits: 2,
        ordersCount: 2,
        orderValuePaise: 368_000,
        linesSold: 2,
      },
      { tenantId: tenantA, userId: owner, day: statsDay, visits: 1, productiveVisits: 0 },
    ])
    await db.insert(dailyRetailerStats).values([
      {
        tenantId: tenantA,
        retailerId: retailerA,
        day: statsDay,
        ordersCount: 1,
        invoicedPaise: 118_000,
        collectedPaise: 118_000,
        linesSold: 1,
      },
      {
        tenantId: tenantA,
        retailerId: retailerB,
        day: statsDay,
        ordersCount: 1,
        invoicedPaise: 250_000,
        linesSold: 1,
      },
    ])
    await db.insert(retailerBehaviour).values([
      { tenantId: tenantA, retailerId: retailerA, ordersLast30: 1, valueLast30Paise: 118_000 },
      {
        tenantId: tenantA,
        retailerId: retailerB,
        ordersLast30: 1,
        valueLast30Paise: 250_000,
        lapsedRisk: 30,
      },
    ])
    await db.insert(ownerSummary).values({
      tenantId: tenantA,
      todayInvoicedPaise: 368_000,
      mtdSalesPaise: 368_000,
      mtdGrossMarginPaise: 28_000,
      stockValuePaise: 1_200_000,
    })
    await db.insert(dailyOwnerStats).values({
      tenantId: tenantA,
      day: statsDay,
      netSalesPaise: 296_000,
      cogsPaise: 268_000,
      grossMarginPaise: 28_000,
      stockValuePaise: 1_200_000,
      nearExpiryValuePaise: 36_000,
      schemeSpendCompanyPaise: 4_000,
      byBrand: { [brandA]: { cogsPaise: 268_000, grossMarginPaise: 28_000 } },
    })
    await db.insert(retailers).values({
      id: retailerOfB,
      tenantId: tenantB,
      code: `B${run}`,
      name: 'Shop of tenant B',
      phone: `+91900${run}9`,
      stateCode: '27',
    })

    // incentives (0029/0030)
    await db.insert(users).values({ id: outsider, phone: `+91901${run}1`, name: 'Rep of tenant B' })
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: tenantB, userId: outsider, role: 'salesperson' })
    await db.insert(targets).values([
      {
        id: targetRepValue,
        tenantId: tenantA,
        userId: rep,
        metric: 'value',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 50_000_000,
        payoutRule: [
          { fromPct: 9_000, toPct: 10_000, payoutBps: 200 },
          { fromPct: 10_000, payoutBps: 400 },
        ],
        name: 'This Month — Value (All Brands)',
        createdBy: owner,
      },
      {
        id: targetRepVisits,
        tenantId: tenantA,
        userId: rep,
        metric: 'visits',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 240,
        payoutRule: [{ fromPct: 10_000, flatPaise: 100_000 }],
        name: 'This Month — Beat Calls',
        createdBy: owner,
      },
      {
        id: targetDriver,
        tenantId: tenantA,
        userId: driver,
        metric: 'collections',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 2_500_000,
        payoutRule: [{ fromPct: 10_000, flatPaise: 150_000 }],
        name: 'This Month — Collections',
        createdBy: owner,
      },
      {
        id: targetOtherDriver,
        tenantId: tenantA,
        userId: otherDriver,
        metric: 'collections',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 1_500_000,
        payoutRule: [{ fromPct: 10_000, flatPaise: 90_000 }],
        name: 'This Month — Collections (second van)',
        createdBy: owner,
      },
    ])
    await db.insert(achievements).values([
      {
        id: achievementRep,
        tenantId: tenantA,
        targetId: targetRepValue,
        achievedValue: 32_000_000,
        achievedPieces: 3_120,
        achievedPct: 6_400,
      },
      {
        id: achievementDriver,
        tenantId: tenantA,
        targetId: targetDriver,
        achievedValue: 1_180_000,
        achievedPieces: 0,
        achievedPct: 4_720,
      },
    ])
    await db.insert(computedPayouts).values([
      {
        id: payoutRep,
        tenantId: tenantA,
        userId: rep,
        periodFrom: closedFrom,
        periodTo: closedTo,
        amountPaise: 1_000_000,
        breakdown: [{ targetId: targetRepValue, metric: 'value', payoutPaise: 1_000_000 }],
      },
      {
        id: payoutDriver,
        tenantId: tenantA,
        userId: driver,
        periodFrom: closedFrom,
        periodTo: closedTo,
        amountPaise: 400_000,
        breakdown: [{ targetId: targetDriver, metric: 'collections', payoutPaise: 400_000 }],
        approvedBy: owner,
        approvedAt: new Date(),
      },
      {
        id: payoutOtherDriver,
        tenantId: tenantA,
        userId: otherDriver,
        periodFrom: closedFrom,
        periodTo: closedTo,
        amountPaise: 250_000,
        breakdown: [{ targetId: targetOtherDriver, metric: 'collections', payoutPaise: 250_000 }],
      },
    ])

    // ai (0031/0032)
    await db.insert(locations).values({
      id: godownB,
      tenantId: tenantB,
      kind: 'warehouse',
      name: `Godown B ${run}`,
    })
    await db.insert(aiOrderDrafts).values([
      {
        id: draftShopA,
        tenantId: tenantA,
        source: 'whatsapp',
        retailerId: retailerA,
        inboundMessageId: inboundA,
        rawText: 'bhai 2 case cola kal',
        parsedLines: [
          {
            text: '2 case cola',
            variantId: variant,
            qtyPcs: 48,
            cases: 2,
            unit: 'case',
            confidenceBps: 9_100,
            candidates: [{ variantId: variant, label: 'Cola 250ml', scoreBps: 9_100 }],
          },
        ],
        matchConfidenceBps: 9_100,
        status: 'needs_review',
        provider: 'stub',
        model: 'deterministic',
        idempotencyKey: `ai-draft-a-${run}`,
      },
      {
        id: draftRepVoice,
        tenantId: tenantA,
        source: 'voice',
        retailerId: retailerA,
        audioObjectKey: `tenant/${tenantA}/audio/${run}.m4a`,
        transcript: 'do case cola aur ek dozen chips',
        parsedLines: [],
        matchConfidenceBps: 7_400,
        status: 'parsed',
        createdBy: rep,
        provider: 'stub',
        model: 'deterministic',
        idempotencyKey: `ai-draft-voice-${run}`,
      },
      {
        id: draftShopB,
        tenantId: tenantA,
        source: 'text',
        retailerId: retailerB,
        rawText: '1 case chips',
        parsedLines: [],
        matchConfidenceBps: 8_000,
        status: 'parsed',
        createdBy: manager,
        idempotencyKey: `ai-draft-b-${run}`,
      },
      {
        id: draftUnmatched,
        tenantId: tenantA,
        source: 'whatsapp',
        rawText: '3 case cola bhejo',
        parsedLines: [],
        matchConfidenceBps: 2_000,
        status: 'needs_review',
        idempotencyKey: `ai-draft-unmatched-${run}`,
      },
    ])
    await db.insert(aiForecasts).values({
      id: forecastA,
      tenantId: tenantA,
      variantId: variant,
      locationId: godownA,
      horizonDays: 7,
      expectedQtyPcs: 96,
      reorderQtyPcs: 48,
      onHandPcs: 120,
      daysCover: 9,
      method: 'moving_average_28',
      confidenceBps: 6_500,
    })
    await db.insert(routePlans).values([
      {
        id: routePlanA,
        tenantId: tenantA,
        tripId: tripA,
        method: 'nearest_neighbour_2opt',
        sequence: [{ stopId: stopA, seq: 1, etaAt: null, distanceM: 1_800 }],
        totalDistanceM: 1_800,
        totalDurationS: 600,
      },
      {
        id: routePlanB,
        tenantId: tenantA,
        tripId: tripB,
        method: 'nearest_neighbour_2opt',
        sequence: [{ stopId: stopB, seq: 1, etaAt: null, distanceM: 2_400 }],
        totalDistanceM: 2_400,
        totalDurationS: 900,
      },
    ])
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
    // tenant B's own shop (the reporting guard fixture) and nothing of tenant A's
    expect(seen.map((r) => r.id)).toEqual([retailerOfB])
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
    // the retailer role may not edit its own credit limit. Since 0013 the shop's UPDATE reaches its own
    // row (`retailers_retailer_update`, for `retailers.updateOwn`) and the trigger refuses the column.
    await rejectsWith(
      withTenant(db, { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' }, (tx) =>
        tx
          .update(retailers)
          .set({ creditLimitPaise: 10_000_000 })
          .where(sql`${retailers.id} = ${retailerA}`),
      ),
      /never its code, tier, beat, credit terms/,
    )
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

  // ---------------------------------------------------------------------------------------------------
  // Warehouse fulfilment paperwork (migration 0010, coordination §5.3). Five tables that used to carry the
  // wide `*_tenant` policy — one predicate, FOR ALL, satisfied by ANY member of the tenant including a
  // shopkeeper. They now carry `staffReadPolicy` (everyone but the retailer reads) plus
  // `roleWritePolicies(STOCK_KEEPER_ROLES)` (owner, manager, warehouse, system write).

  const asRole =
    (actorId: string, role: 'owner' | 'salesperson' | 'delivery' | 'retailer' | 'warehouse') =>
    <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantA, actorId, actorRole: role }, fn)

  it('lets a warehouse actor read and write all five fulfilment tables', async () => {
    const asStoreKeeper = asRole(storeKeeper, 'warehouse')
    expect((await asStoreKeeper((tx) => tx.select().from(picklists))).map((p) => p.id)).toEqual([
      picklistA,
    ])
    expect(await asStoreKeeper((tx) => tx.select().from(pickLines))).toHaveLength(1)
    expect(await asStoreKeeper((tx) => tx.select().from(packConfirmations))).toHaveLength(1)
    expect((await asStoreKeeper((tx) => tx.select().from(loadSheets))).map((s) => s.id)).toContain(
      loadSheetA,
    )
    expect(await asStoreKeeper((tx) => tx.select().from(deliveryChallans))).toHaveLength(1)

    // …and writes: the picker records what came off the rack, and raises the next wave.
    await asStoreKeeper((tx) =>
      tx
        .update(pickLines)
        .set({ pickedQtyPcs: 24, pickedBy: storeKeeper, pickedAt: new Date() })
        .where(sql`${pickLines.id} = ${pickLineA}`),
    )
    const [picked] = await db
      .select()
      .from(pickLines)
      .where(sql`${pickLines.id} = ${pickLineA}`)
    expect(picked?.pickedQtyPcs).toBe(24)
    const second = uuidv7()
    await asStoreKeeper((tx) =>
      tx.insert(picklists).values({
        id: second,
        tenantId: tenantA,
        picklistNo: `PICK-${run}-2`,
        locationId: godownA,
      }),
    )
    expect(await asStoreKeeper((tx) => tx.select().from(picklists))).toHaveLength(2)
  })

  it('lets a salesperson read a picklist but never write one', async () => {
    // The rep answers "where is my shop's order" from the picklist status, so the read is deliberate…
    const asRep = asRole(rep, 'salesperson')
    const sheets = await asRep((tx) => tx.select().from(picklists))
    expect(sheets.some((p) => p.id === picklistA)).toBe(true)
    expect(sheets.find((p) => p.id === picklistA)?.status).toBe('picking')

    // …and every write on all five is refused: the godown's paperwork is the godown's.
    await expect(
      asRep((tx) =>
        tx.insert(picklists).values({
          id: uuidv7(),
          tenantId: tenantA,
          picklistNo: `PICK-rep-${run}`,
          locationId: godownA,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx.insert(pickLines).values({
          id: uuidv7(),
          tenantId: tenantA,
          picklistId: picklistA,
          orderId: orderA,
          orderLineId: orderLineA,
          variantId: variant,
          requestedQtyPcs: 1,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx
          .insert(packConfirmations)
          .values({ id: uuidv7(), tenantId: tenantA, orderId: orderA, packages: 1 }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx.insert(loadSheets).values({
          id: uuidv7(),
          tenantId: tenantA,
          fromLocationId: godownA,
          toLocationId: godownA,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx.insert(deliveryChallans).values({
          id: uuidv7(),
          tenantId: tenantA,
          fy: '2026-27',
          challanDate: '2026-09-04',
          fromLocationId: godownA,
          toLocationId: godownA,
          lines: [],
          valuePaise: 1,
        }),
      ),
    ).rejects.toThrow()
    // An UPDATE is not an error, it simply matches no row — so the picked quantity is unchanged.
    await asRep((tx) =>
      tx
        .update(pickLines)
        .set({ pickedQtyPcs: 0 })
        .where(sql`${pickLines.id} = ${pickLineA}`),
    )
    const [untouched] = await db
      .select()
      .from(pickLines)
      .where(sql`${pickLines.id} = ${pickLineA}`)
    expect(untouched?.pickedQtyPcs).toBe(24)
  })

  it('shows a shopkeeper none of the godown paperwork', async () => {
    // A picklist names every other shop in the same wave, and a load sheet names every drop on the van.
    const asShop = asRole(shopUser, 'retailer')
    expect(await asShop((tx) => tx.select().from(picklists))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(pickLines))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(packConfirmations))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(loadSheets))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(deliveryChallans))).toHaveLength(0)
  })

  it('lets the delivery crew read the load sheet and challan it drives with, and write neither', async () => {
    const asCrew = asRole(driver, 'delivery')
    expect((await asCrew((tx) => tx.select().from(loadSheets))).map((s) => s.id)).toContain(
      loadSheetA,
    )
    const challans = await asCrew((tx) => tx.select().from(deliveryChallans))
    expect(challans.map((c) => c.id)).toEqual([challanA])
    expect(challans[0]?.vehicleNo).toBe('MH-05-AB-1234')
    await expect(
      asCrew((tx) =>
        tx.insert(picklists).values({
          id: uuidv7(),
          tenantId: tenantA,
          picklistNo: `PICK-crew-${run}`,
          locationId: godownA,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asCrew((tx) =>
        tx.insert(loadSheets).values({
          id: uuidv7(),
          tenantId: tenantA,
          fromLocationId: godownA,
          toLocationId: godownA,
        }),
      ),
    ).rejects.toThrow()
  })

  it('lets staff read tenant settings, hides secrets, and shows a retailer only the branding', async () => {
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

    // A shopkeeper is a guest in the distributor's tenant: the configuration is not theirs to read —
    // except the white-label name and logo its own app chrome shows (migration 0013, docs/22 §7): the
    // `branding.%` keys and nothing else. Never the UPI id, never a threshold, never a secret.
    const shop = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(tenantSettings),
    )
    expect(shop.length).toBeGreaterThan(0)
    expect(shop.every((r) => r.key.startsWith('branding.'))).toBe(true)
    expect(shop.find((r) => r.key === TENANT_SETTING_KEYS.brandingDisplayName)?.value).toBe(
      'Tenant A',
    )
    expect(shop.some((r) => r.key === TENANT_SETTING_KEYS.upiVpa)).toBe(false)
    expect(shop.some((r) => r.key === TENANT_SETTING_KEYS.ewbIntraStateThreshold)).toBe(false)
    expect(shop.some((r) => r.key.startsWith('secret.'))).toBe(false)
    // ...and a `secret.branding.*`-shaped key, should one ever exist, stays hidden by the second guard.
    await db
      .insert(tenantSettings)
      .values({ tenantId: tenantA, key: 'secret.branding_token', value: 'no' })
      .onConflictDoNothing()
    const again = await withTenant(
      db,
      { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' },
      (tx) => tx.select().from(tenantSettings),
    )
    expect(again.some((r) => r.key.startsWith('secret.'))).toBe(false)
    // read only: a shop writes no setting, not even a branding one
    await expect(
      withTenant(db, { tenantId: tenantA, actorId: shopUser, actorRole: 'retailer' }, (tx) =>
        tx
          .insert(tenantSettings)
          .values({ tenantId: tenantA, key: 'branding.display_name_x', value: 'nope' }),
      ),
    ).rejects.toThrow()

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

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0012/0013 (docs/23 §8 database side + founder decisions of 2026-09-05, docs/22 §8).
  // Thirty-two tables lose their wide `*_tenant` FOR ALL policy — one predicate, reads and writes,
  // satisfied by any member including the shopkeeper — and gain a read policy plus a role-scoped write
  // set. Three triggers carry the column-level rules RLS cannot: the manager's load-out approval, the
  // numbering series lock, and who may touch a retailer's credit terms. One refusal per role per table.

  const actorFor = (
    role:
      'owner' | 'manager' | 'accountant' | 'salesperson' | 'warehouse' | 'delivery' | 'retailer',
  ) =>
    role === 'retailer'
      ? shopUser
      : role === 'manager'
        ? manager
        : role === 'delivery'
          ? driver
          : role === 'warehouse'
            ? storeKeeper
            : role === 'salesperson'
              ? rep
              : owner
  const as =
    (
      role:
        'owner' | 'manager' | 'accountant' | 'salesperson' | 'warehouse' | 'delivery' | 'retailer',
      actorId: string = actorFor(role),
    ) =>
    <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantA, actorId, actorRole: role }, fn)

  it('lets every member read the price list and only the owner or manager write it: the accountant sets no price', async () => {
    for (const role of [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'delivery',
      'retailer',
    ] as const) {
      const lists = await as(role)((tx) => tx.select().from(priceLists))
      expect(
        lists.some((l) => l.id === priceListA),
        `${role} reads the price list`,
      ).toBe(true)
    }
    const insertList = (
      role: 'accountant' | 'salesperson' | 'warehouse' | 'delivery' | 'retailer',
    ) =>
      as(role)((tx) =>
        tx.insert(priceLists).values({ id: uuidv7(), tenantId: tenantA, name: `${role}-${run}` }),
      )
    for (const role of [
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      await expect(insertList(role), `${role} must not create a price list`).rejects.toThrow()
      await expect(
        as(role)((tx) =>
          tx.insert(priceListItems).values({
            id: uuidv7(),
            tenantId: tenantA,
            priceListId: priceListA,
            variantId: variant,
            ratePaise: 1,
          }),
        ),
        `${role} must not add a price list row`,
      ).rejects.toThrow()
    }
    // an UPDATE by the accountant matches no row, so the rate is unchanged
    await as('accountant')((tx) =>
      tx
        .update(priceListItems)
        .set({ ratePaise: 1 })
        .where(sql`${priceListItems.priceListId} = ${priceListA}`),
    )
    const [item] = await db
      .select()
      .from(priceListItems)
      .where(sql`${priceListItems.priceListId} = ${priceListA}`)
    expect(item?.ratePaise).toBe(4_000)
    // the manager may
    const managerList = uuidv7()
    await as('manager')((tx) =>
      tx.insert(priceLists).values({ id: managerList, tenantId: tenantA, name: `Manager ${run}` }),
    )
    expect(
      await as('manager')((tx) =>
        tx
          .select()
          .from(priceLists)
          .where(sql`${priceLists.id} = ${managerList}`),
      ),
    ).toHaveLength(1)
  })

  it('shows a shop only its own negotiated rate and its own bargains, and lets only the owner or manager decide', async () => {
    // shop A has no override; shop B's rate is invisible to A and visible to B
    expect(await as('retailer')((tx) => tx.select().from(retailerPriceOverrides))).toHaveLength(0)
    expect(
      await as('retailer', otherShopUser)((tx) => tx.select().from(retailerPriceOverrides)),
    ).toHaveLength(1)
    expect(await as('salesperson')((tx) => tx.select().from(retailerPriceOverrides))).toHaveLength(
      1,
    )
    // the bargain was asked for shop B: A never sees it, B and staff do
    expect(await as('retailer')((tx) => tx.select().from(bargainRequests))).toHaveLength(0)
    expect(
      (await as('retailer', otherShopUser)((tx) => tx.select().from(bargainRequests))).map(
        (b) => b.id,
      ),
    ).toEqual([bargainA])
    expect(
      (await as('accountant')((tx) => tx.select().from(bargainRequests))).some(
        (b) => b.id === bargainA,
      ),
    ).toBe(true)
    // asking: a rep files `requested`; a shop files `requested` for itself and never for another shop;
    // nobody but an owner/manager files one already `approved`
    await as('salesperson')((tx) =>
      tx.insert(bargainRequests).values({
        id: uuidv7(),
        tenantId: tenantA,
        retailerId: retailerA,
        variantId: variant,
        requestedBy: rep,
        listRatePaise: 4_000,
        askedRatePaise: 3_900,
        status: 'requested',
      }),
    )
    await as('retailer')((tx) =>
      tx.insert(bargainRequests).values({
        id: uuidv7(),
        tenantId: tenantA,
        retailerId: retailerA,
        variantId: variant,
        requestedBy: shopUser,
        listRatePaise: 4_000,
        askedRatePaise: 3_900,
        status: 'requested',
      }),
    )
    await expect(
      as('retailer')((tx) =>
        tx.insert(bargainRequests).values({
          id: uuidv7(),
          tenantId: tenantA,
          retailerId: retailerB,
          variantId: variant,
          requestedBy: shopUser,
          listRatePaise: 4_000,
          askedRatePaise: 3_900,
          status: 'requested',
        }),
      ),
    ).rejects.toThrow()
    for (const role of ['accountant', 'salesperson', 'retailer'] as const) {
      await expect(
        as(role)((tx) =>
          tx.insert(bargainRequests).values({
            id: uuidv7(),
            tenantId: tenantA,
            retailerId: retailerA,
            variantId: variant,
            requestedBy: actorFor(role),
            listRatePaise: 4_000,
            askedRatePaise: 3_000,
            approvedRatePaise: 3_000,
            status: 'approved',
          }),
        ),
        `${role} must not file an approved bargain`,
      ).rejects.toThrow()
    }
    // deciding: the accountant's UPDATE matches no row; the manager's does
    await as('accountant')((tx) =>
      tx
        .update(bargainRequests)
        .set({ status: 'approved', approvedRatePaise: 3_800 })
        .where(sql`${bargainRequests.id} = ${bargainA}`),
    )
    let [b] = await db
      .select()
      .from(bargainRequests)
      .where(sql`${bargainRequests.id} = ${bargainA}`)
    expect(b?.status).toBe('requested')
    await as('manager')((tx) =>
      tx
        .update(bargainRequests)
        .set({ status: 'approved', approvedRatePaise: 3_800, decidedBy: manager })
        .where(sql`${bargainRequests.id} = ${bargainA}`),
    )
    ;[b] = await db
      .select()
      .from(bargainRequests)
      .where(sql`${bargainRequests.id} = ${bargainA}`)
    expect(b?.status).toBe('approved')
  })

  it('keeps the approvals queue to staff and the decision to the owner or manager', async () => {
    expect(await as('retailer')((tx) => tx.select().from(approvals))).toHaveLength(0)
    expect(
      (await as('accountant')((tx) => tx.select().from(approvals))).some((a) => a.id === approvalA),
    ).toBe(true)
    // the accountant reads the queue and may not approve: the row is reachable, the new row is refused
    await rejectsWith(
      as('accountant')((tx) =>
        tx
          .update(approvals)
          .set({ status: 'approved', decidedBy: owner, decidedAt: new Date() })
          .where(sql`${approvals.id} = ${approvalA}`),
      ),
      /row-level security/,
    )
    // a rep may write exactly one thing: `expired`, which is what cancelling its own order does
    await rejectsWith(
      as('salesperson')((tx) =>
        tx
          .update(approvals)
          .set({ status: 'rejected' })
          .where(sql`${approvals.id} = ${approvalA}`),
      ),
      /row-level security/,
    )
    await as('salesperson')((tx) =>
      tx
        .update(approvals)
        .set({ status: 'expired', decisionNote: 'order cancelled' })
        .where(sql`${approvals.id} = ${approvalA}`),
    )
    let [a] = await db
      .select()
      .from(approvals)
      .where(sql`${approvals.id} = ${approvalA}`)
    expect(a?.status).toBe('expired')
    await as('manager')((tx) =>
      tx
        .update(approvals)
        .set({ status: 'approved', decidedBy: manager, decidedAt: new Date() })
        .where(sql`${approvals.id} = ${approvalA}`),
    )
    ;[a] = await db
      .select()
      .from(approvals)
      .where(sql`${approvals.id} = ${approvalA}`)
    expect(a?.status).toBe('approved')
    expect(a?.decidedBy).toBe(manager)
  })

  it('lets a salesperson read the outstanding rollup of the shops on its own beat, and learn which beat is its own', async () => {
    // the rollup for the shops on the rep's beat (retailerA is on beatA; the rep is assigned to beatA)
    const rows = await as('salesperson')((tx) =>
      tx
        .select({
          retailerId: retailerOutstandingSummary.retailerId,
          outstandingPaise: retailerOutstandingSummary.outstandingPaise,
        })
        .from(retailerOutstandingSummary)
        .innerJoin(retailers, sql`${retailers.id} = ${retailerOutstandingSummary.retailerId}`)
        .innerJoin(
          beatAssignments,
          sql`${beatAssignments.beatId} = ${retailers.beatId} AND ${beatAssignments.userId} = ${rep}`,
        ),
    )
    expect(rows.map((r) => r.retailerId)).toEqual([retailerA])
    expect(rows[0]?.outstandingPaise).toBe(67_000)
    // today's beat: the assignment is readable by the rep (docs/23 §8.14 `beats.assignments.list`)…
    const mine = await as('salesperson')((tx) =>
      tx
        .select()
        .from(beatAssignments)
        .where(sql`${beatAssignments.userId} = ${rep}`),
    )
    expect(mine.map((m) => m.beatId)).toEqual([beatA])
    expect(await as('salesperson')((tx) => tx.select().from(beats))).toHaveLength(1)
    // …invisible to the shop, and drawn only by the onboarders: a rep can neither create a beat nor assign himself
    expect(await as('retailer')((tx) => tx.select().from(beats))).toHaveLength(0)
    expect(await as('retailer')((tx) => tx.select().from(beatAssignments))).toHaveLength(0)
    for (const role of [
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      await expect(
        as(role)((tx) =>
          tx.insert(beats).values({ id: uuidv7(), tenantId: tenantA, name: `${role} beat ${run}` }),
        ),
        `${role} must not create a beat`,
      ).rejects.toThrow()
      await expect(
        as(role)((tx) =>
          tx.insert(beatAssignments).values({
            id: uuidv7(),
            tenantId: tenantA,
            beatId: beatA,
            userId: actorFor(role),
            validFrom: '2026-09-05',
          }),
        ),
        `${role} must not assign a beat`,
      ).rejects.toThrow()
    }
    await as('manager')((tx) =>
      tx.insert(beats).values({ id: uuidv7(), tenantId: tenantA, name: `Manager beat ${run}` }),
    )
  })

  it('requires the manager’s approval on a load sheet before the warehouse may confirm it', async () => {
    // the warehouse cannot confirm an unapproved draft…
    await rejectsWith(
      as('warehouse')((tx) =>
        tx
          .update(loadSheets)
          .set({ status: 'confirmed', confirmedBy: storeKeeper, confirmedAt: new Date() })
          .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
      ),
      /no manager approval/,
    )
    // …nor write the approval itself: the trigger refuses the floor, and the accountant and the crew
    // never reach the row (`roleWritePolicies(STOCK_KEEPER_ROLES)` matches nothing for them)
    await rejectsWith(
      as('warehouse')((tx) =>
        tx
          .update(loadSheets)
          .set({ approvedBy: storeKeeper, approvedAt: new Date() })
          .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
      ),
      /only an owner or manager approves/,
    )
    for (const role of ['accountant', 'delivery'] as const) {
      await as(role)((tx) =>
        tx
          .update(loadSheets)
          .set({ approvedBy: actorFor(role), approvedAt: new Date() })
          .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
      )
      const [untouched] = await db
        .select()
        .from(loadSheets)
        .where(sql`${loadSheets.id} = ${loadSheetDraft}`)
      expect(untouched?.approvedBy, `${role} must not approve a load-out`).toBeNull()
    }
    // a manager signs with their own id, not someone else's
    await rejectsWith(
      as('manager')((tx) =>
        tx
          .update(loadSheets)
          .set({ approvedBy: owner, approvedAt: new Date() })
          .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
      ),
      /signed by the actor who gives it/,
    )
    // the manager approves from the manager app, then the warehouse counts it out
    await as('manager')((tx) =>
      tx
        .update(loadSheets)
        .set({ approvedBy: manager, approvedAt: new Date() })
        .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
    )
    await as('warehouse')((tx) =>
      tx
        .update(loadSheets)
        .set({
          status: 'confirmed',
          countedPackages: 2,
          confirmedBy: storeKeeper,
          confirmedAt: new Date(),
        })
        .where(sql`${loadSheets.id} = ${loadSheetDraft}`),
    )
    const [confirmed] = await db
      .select()
      .from(loadSheets)
      .where(sql`${loadSheets.id} = ${loadSheetDraft}`)
    expect(confirmed?.status).toBe('confirmed')
    expect(confirmed?.approvedBy).toBe(manager)
    expect(confirmed?.confirmedBy).toBe(storeKeeper)
    // a manager confirming directly is its own approval: the trigger signs the row from the actor
    const direct = uuidv7()
    await db.insert(loadSheets).values({
      id: direct,
      tenantId: tenantA,
      fromLocationId: godownA,
      toLocationId: godownA,
      orderIds: [],
    })
    await as('manager')((tx) =>
      tx
        .update(loadSheets)
        .set({ status: 'confirmed', confirmedBy: manager, confirmedAt: new Date() })
        .where(sql`${loadSheets.id} = ${direct}`),
    )
    const [signed] = await db
      .select()
      .from(loadSheets)
      .where(sql`${loadSheets.id} = ${direct}`)
    expect(signed?.approvedBy).toBe(manager)
    expect(signed?.approvedAt).not.toBeNull()
  })

  it('lets the owner configure a numbering series until the first issue, and never rewinds a counter', async () => {
    const fresh = { tenantId: tenantA, seriesCode: `TST${run}`, fy: '2026-27' }
    await db.insert(numberingSeries).values({ ...fresh, prefix: 'T/' })
    const where = sql`${numberingSeries.tenantId} = ${tenantA} AND ${numberingSeries.seriesCode} = ${fresh.seriesCode} AND ${numberingSeries.fy} = ${fresh.fy}`
    // fresh: the owner sets the prefix and the starting number (docs/17 §D1); the manager may not
    await as('owner')((tx) =>
      tx.update(numberingSeries).set({ prefix: 'GL/', startingNo: 1687 }).where(where),
    )
    await rejectsWith(
      as('manager')((tx) => tx.update(numberingSeries).set({ prefix: 'MG/' }).where(where)),
      /only the owner configures/,
    )
    // any member issues a document: the counter moves forward as a rep, exactly as nextDocumentNumber() does
    await as('salesperson')((tx) =>
      tx
        .update(numberingSeries)
        .set({
          nextNo: sql`GREATEST(${numberingSeries.nextNo}, ${numberingSeries.startingNo}) + 1`,
        })
        .where(where),
    )
    let [row] = await db.select().from(numberingSeries).where(where)
    expect(row?.nextNo).toBe(1688)
    // issued: the configuration is locked even for the owner, and the counter never goes back
    await rejectsWith(
      as('owner')((tx) => tx.update(numberingSeries).set({ prefix: 'NEW/' }).where(where)),
      /has issued documents/,
    )
    await rejectsWith(
      as('owner')((tx) => tx.update(numberingSeries).set({ nextNo: 5 }).where(where)),
      /never moves backwards/,
    )
    ;[row] = await db.select().from(numberingSeries).where(where)
    expect(row?.prefix).toBe('GL/')
    expect(row?.nextNo).toBe(1688)
    // the migrating/owner connection (no actor role) may heal a counter — a DBA on a dev database, or the
    // retailers spec simulating codes the series never counted; the document unique indexes still refuse
    // a reissued number
    await db.update(numberingSeries).set({ nextNo: 1000 }).where(where)
    ;[row] = await db.select().from(numberingSeries).where(where)
    expect(row?.nextNo).toBe(1000)
  })

  it('lets a shop edit its own shop card and nobody but the owner or manager set credit terms', async () => {
    // the shop edits its owner name on its own row and cannot touch the other shop's row
    await as('retailer')((tx) =>
      tx
        .update(retailers)
        .set({ ownerName: 'Sunita' })
        .where(sql`${retailers.id} = ${retailerA}`),
    )
    await as('retailer')((tx) =>
      tx
        .update(retailers)
        .set({ ownerName: 'Hacked' })
        .where(sql`${retailers.id} = ${retailerB}`),
    )
    const [a] = await db
      .select()
      .from(retailers)
      .where(sql`${retailers.id} = ${retailerA}`)
    const [b] = await db
      .select()
      .from(retailers)
      .where(sql`${retailers.id} = ${retailerB}`)
    expect(a?.ownerName).toBe('Sunita')
    expect(b?.ownerName).toBeNull()
    // its tier, beat and phone are frozen for the shop
    await rejectsWith(
      as('retailer')((tx) =>
        tx
          .update(retailers)
          .set({ tier: 'A' })
          .where(sql`${retailers.id} = ${retailerA}`),
      ),
      /never its code, tier, beat, credit terms/,
    )
    await rejectsWith(
      as('retailer')((tx) =>
        tx
          .update(retailers)
          .set({ beatId: null })
          .where(sql`${retailers.id} = ${retailerA}`),
      ),
      /never its code, tier, beat, credit terms/,
    )
    // the accountant is a money desk: reads the shop, sets no credit limit (docs/22 §8, 2026-09-05)
    await rejectsWith(
      as('accountant')((tx) =>
        tx
          .update(retailers)
          .set({ creditLimitPaise: 5_000_000, creditDays: 15, creditMode: 'strict' })
          .where(sql`${retailers.id} = ${retailerA}`),
      ),
      /set by the owner or the manager/,
    )
    // a rep onboards a shop with the defaults and cannot smuggle a limit in
    await rejectsWith(
      as('salesperson')((tx) =>
        tx.insert(retailers).values({
          id: uuidv7(),
          tenantId: tenantA,
          code: `N${run}`,
          name: 'New shop',
          phone: `+91900${run}8`,
          stateCode: '27',
          creditLimitPaise: 1,
        }),
      ),
      /default tier and no credit/,
    )
    await as('salesperson')((tx) =>
      tx.insert(retailers).values({
        id: uuidv7(),
        tenantId: tenantA,
        code: `N${run}`,
        name: 'New shop',
        phone: `+91900${run}8`,
        stateCode: '27',
      }),
    )
    // the manager sets credit, and it is audited under the manager's own name only
    await as('manager')((tx) =>
      tx
        .update(retailers)
        .set({ tier: 'B', creditLimitPaise: 2_500_000, creditDays: 7 })
        .where(sql`${retailers.id} = ${retailerA}`),
    )
    const [credited] = await db
      .select()
      .from(retailers)
      .where(sql`${retailers.id} = ${retailerA}`)
    expect(credited?.creditLimitPaise).toBe(2_500_000)
  })

  it('shows the audit trail to the back office only, and every actor writes it under its own name', async () => {
    const entry = (actorId: string, actorRole: string) => ({
      id: uuidv7(),
      tenantId: tenantA,
      actorId,
      actorRole,
      action: 'test.audit',
      entityType: 'retailer',
      entityId: retailerA,
    })
    await as('salesperson')((tx) => tx.insert(auditLog).values(entry(rep, 'salesperson')))
    await as('retailer')((tx) => tx.insert(auditLog).values(entry(shopUser, 'retailer')))
    await expect(
      as('salesperson')((tx) => tx.insert(auditLog).values(entry(owner, 'owner'))),
      'a rep cannot write an audit row in the owner’s name',
    ).rejects.toThrow()
    const seen = await as('accountant')((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(sql`${auditLog.entityId} = ${retailerA} AND ${auditLog.action} = 'test.audit'`),
    )
    expect(seen.map((r) => r.actorRole).sort()).toEqual(['retailer', 'salesperson'])
    for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(auditLog)),
        `${role} must not read the audit trail`,
      ).toHaveLength(0)
    }
  })

  it('lets every member read the feature flags and only the owner flip one', async () => {
    for (const role of [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      const flags = await as(role)((tx) => tx.select().from(featureFlags))
      expect(
        flags.some((f) => f.flag === 'van_sales'),
        `${role} reads the flags`,
      ).toBe(true)
    }
    for (const role of [
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      await as(role)((tx) =>
        tx
          .update(featureFlags)
          .set({ enabled: true })
          .where(sql`${featureFlags.tenantId} = ${tenantA} AND ${featureFlags.flag} = 'van_sales'`),
      )
      const [flag] = await db
        .select()
        .from(featureFlags)
        .where(sql`${featureFlags.tenantId} = ${tenantA} AND ${featureFlags.flag} = 'van_sales'`)
      expect(flag?.enabled, `${role} must not enable van sales`).toBe(false)
      await expect(
        as(role)((tx) =>
          tx
            .insert(featureFlags)
            .values({ tenantId: tenantA, flag: `${role}_${run}`, enabled: true }),
        ),
        `${role} must not add a flag`,
      ).rejects.toThrow()
    }
    await as('owner')((tx) =>
      tx
        .update(featureFlags)
        .set({ enabled: true })
        .where(sql`${featureFlags.tenantId} = ${tenantA} AND ${featureFlags.flag} = 'van_sales'`),
    )
    const [on] = await db
      .select()
      .from(featureFlags)
      .where(sql`${featureFlags.tenantId} = ${tenantA} AND ${featureFlags.flag} = 'van_sales'`)
    expect(on?.enabled).toBe(true)
  })

  it('lets only the owner edit the tenant and only the onboarders add a membership', async () => {
    for (const role of [
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      await as(role)((tx) =>
        tx
          .update(tenants)
          .set({ legalName: 'Hijacked' })
          .where(sql`${tenants.id} = ${tenantA}`),
      )
      const [t] = await db
        .select()
        .from(tenants)
        .where(sql`${tenants.id} = ${tenantA}`)
      expect(t?.legalName, `${role} must not rename the tenant`).toBe('Tenant A')
      expect(
        await as(role)((tx) => tx.select().from(tenants)),
        `${role} reads its own tenant`,
      ).toHaveLength(1)
    }
    await as('owner')((tx) =>
      tx
        .update(tenants)
        .set({ gstin: '27AAAAA0000A1Z5' })
        .where(sql`${tenants.id} = ${tenantA}`),
    )
    const [t] = await db
      .select()
      .from(tenants)
      .where(sql`${tenants.id} = ${tenantA}`)
    expect(t?.gstin).toBe('27AAAAA0000A1Z5')
    // memberships: readable by every member, written by the onboarders — a shop cannot make itself the owner
    expect((await as('retailer')((tx) => tx.select().from(memberships))).length).toBeGreaterThan(0)
    for (const role of [
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const) {
      await expect(
        as(role)((tx) =>
          tx
            .insert(memberships)
            .values({ id: uuidv7(), tenantId: tenantA, userId: actorFor(role), role: 'owner' }),
        ),
        `${role} must not add a membership`,
      ).rejects.toThrow()
    }
  })

  it('lets a shop read sellable stock and never write the stock ledger, the balances or a reservation', async () => {
    expect(await as('retailer')((tx) => tx.select().from(stockBalances))).toHaveLength(1)
    expect(await as('retailer')((tx) => tx.select().from(stockLots))).not.toHaveLength(0)
    await expect(
      as('retailer')((tx) =>
        tx.insert(stockLedger).values({
          id: uuidv7(),
          tenantId: tenantA,
          lotId: balanceLot,
          locationId: godownA,
          qtyDelta: 1000,
          reason: 'adjustment',
          actorId: shopUser,
          idempotencyKey: `shop-${run}`,
        }),
      ),
    ).rejects.toThrow()
    await as('retailer')((tx) =>
      tx
        .update(stockBalances)
        .set({ onHand: 9_999 })
        .where(sql`${stockBalances.lotId} = ${balanceLot}`),
    )
    const [bal] = await db
      .select()
      .from(stockBalances)
      .where(sql`${stockBalances.lotId} = ${balanceLot}`)
    expect(bal?.onHand).toBe(120)
    await expect(
      as('retailer')((tx) =>
        tx
          .insert(locations)
          .values({ id: uuidv7(), tenantId: tenantA, kind: 'vehicle', name: `Shop van ${run}` }),
      ),
    ).rejects.toThrow()
  })

  it('keeps the receiving paperwork (GRNs) to staff and the shop out of it', async () => {
    expect(await as('retailer')((tx) => tx.select().from(grns))).toHaveLength(0)
    expect((await as('warehouse')((tx) => tx.select().from(grns))).map((g) => g.id)).toEqual([grnA])
    expect((await as('salesperson')((tx) => tx.select().from(grns))).map((g) => g.id)).toEqual([
      grnA,
    ])
    for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
      await expect(
        as(role)((tx) =>
          tx.insert(grns).values({
            id: uuidv7(),
            tenantId: tenantA,
            supplierInvoiceId: supplierInvoiceA,
            locationId: godownA,
          }),
        ),
        `${role} must not open a GRN`,
      ).rejects.toThrow()
    }
    // the priced supplier invoice stays back office: the floor counts pieces and never sees the rate
    expect(await as('warehouse')((tx) => tx.select().from(supplierInvoices))).toHaveLength(0)
    expect(await as('accountant')((tx) => tx.select().from(supplierInvoices))).toHaveLength(1)
  })

  it('shows a sync rejection to the person whose device sent it and to the desk, nobody else', async () => {
    const mine = uuidv7()
    await as('salesperson')((tx) =>
      tx.insert(syncErrors).values({
        id: mine,
        tenantId: tenantA,
        userId: rep,
        deviceId: `dev-${run}`,
        opId: `op-${run}`,
        tableName: 'visits',
        rowId: uuidv7(),
        code: 'credit_stop',
        messageHi: 'x',
        messageEn: 'credit stop',
      }),
    )
    // a device cannot file a rejection under someone else's name
    await expect(
      as('salesperson')((tx) =>
        tx.insert(syncErrors).values({
          id: uuidv7(),
          tenantId: tenantA,
          userId: driver,
          deviceId: `dev-${run}`,
          opId: `op2-${run}`,
          tableName: 'visits',
          rowId: uuidv7(),
          code: 'x',
          messageHi: 'x',
          messageEn: 'x',
        }),
      ),
    ).rejects.toThrow()
    expect(
      (await as('salesperson')((tx) => tx.select().from(syncErrors))).map((e) => e.id),
    ).toEqual([mine])
    expect(await as('delivery')((tx) => tx.select().from(syncErrors))).toHaveLength(0)
    expect(await as('retailer')((tx) => tx.select().from(syncErrors))).toHaveLength(0)
    expect(
      (await as('manager')((tx) => tx.select().from(syncErrors))).some((e) => e.id === mine),
    ).toBe(true)
  })

  it('keeps the file registry to staff', async () => {
    const logo = uuidv7()
    await as('owner')((tx) =>
      tx.insert(fileObjects).values({
        id: logo,
        tenantId: tenantA,
        domain: 'logo',
        entityId: tenantA,
        objectKey: `tenant/${tenantA}/logo/${tenantA}/logo-${run}.png`,
        mimeType: 'image/png',
        bytes: 12_345,
        uploadedBy: owner,
      }),
    )
    expect((await as('delivery')((tx) => tx.select().from(fileObjects))).map((f) => f.id)).toEqual([
      logo,
    ])
    expect(await as('retailer')((tx) => tx.select().from(fileObjects))).toHaveLength(0)
    await expect(
      as('retailer')((tx) =>
        tx.insert(fileObjects).values({
          id: uuidv7(),
          tenantId: tenantA,
          domain: 'pod',
          entityId: orderA,
          objectKey: `tenant/${tenantA}/pod/${orderA}/x-${run}.jpg`,
          mimeType: 'image/jpeg',
          bytes: 1,
          uploadedBy: shopUser,
        }),
      ),
    ).rejects.toThrow()
    const other = await withTenant(
      db,
      { tenantId: tenantB, actorId: owner, actorRole: 'owner' },
      (tx) => tx.select().from(fileObjects),
    )
    expect(other).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0014/0015 (delivery): the eleven last-mile tables lose their wide `*_tenant` FOR ALL
  // policy. The desk reads all; the godown plans; the crew reads and writes ONLY the trip it is on; the
  // shop sees the delivery status of its own bills; the rep sees the stop status of its shops and
  // nothing else. Two triggers carry what a policy cannot: a delivery is always about the stop's shop,
  // and a red settlement carries the owner's approval. One refusal per role per table.

  it('shows a rep the stop status of its shops and nothing else of the delivery module', async () => {
    const asRep = as('salesperson')
    expect((await asRep((tx) => tx.select().from(tripStops))).map((s) => s.id)).toEqual(
      expect.arrayContaining([stopA, stopB]),
    )
    expect(await asRep((tx) => tx.select().from(trips))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(vehicles))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(deliveries))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(deliveryLines))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(podEvidence))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(collections))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(tripExpenses))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(tripSettlements))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(tripPoints))).toHaveLength(0)
    expect(await asRep((tx) => tx.select().from(vehiclePositions))).toHaveLength(0)
    // a rep never collects (docs/17 §D4) and never rides the van: no stop write, no cash row, no GPS
    await expect(
      asRep((tx) =>
        tx.insert(tripStops).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          sequence: 9,
          retailerId: retailerA,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx.insert(collections).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          retailerId: retailerA,
          receiptId: uuidv7(),
          mode: 'cash',
          amountPaise: 1,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asRep((tx) =>
        tx.insert(tripPoints).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          userId: rep,
          deviceId: `phone-rep-${run}`,
          recordedAt: new Date(),
          lat: 19.2,
          lng: 73.1,
        }),
      ),
    ).rejects.toThrow()
  })

  it('shows a shop the delivery of its own bill, its lines and its proof, and no trip, cash or coordinate', async () => {
    const asShop = as('retailer')
    expect((await asShop((tx) => tx.select().from(deliveries))).map((d) => d.id)).toEqual([
      deliveryA,
    ])
    expect((await asShop((tx) => tx.select().from(deliveryLines))).map((l) => l.id)).toEqual([
      deliveryLineA,
    ])
    expect((await asShop((tx) => tx.select().from(podEvidence))).map((p) => p.id)).toEqual([podA])
    expect((await asShop((tx) => tx.select().from(tripStops))).map((s) => s.id)).toEqual([stopA])
    // the other shop's delivery, through the other shop's token, is the mirror image
    const asOtherShop = as('retailer', otherShopUser)
    expect((await asOtherShop((tx) => tx.select().from(deliveries))).map((d) => d.id)).toEqual([
      deliveryB,
    ])
    expect((await asOtherShop((tx) => tx.select().from(podEvidence))).map((p) => p.id)).toEqual([
      podB,
    ])
    for (const table of [
      trips,
      vehicles,
      collections,
      tripExpenses,
      tripSettlements,
      tripPoints,
      vehiclePositions,
    ]) {
      expect(await asShop((tx) => tx.select().from(table))).toHaveLength(0)
    }
    await expect(
      asShop((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          stopId: stopA,
          retailerId: retailerA,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-shop-${run}`,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asShop((tx) =>
        tx
          .insert(podEvidence)
          .values({ id: uuidv7(), tenantId: tenantA, deliveryId: deliveryA, kind: 'otp' }),
      ),
    ).rejects.toThrow()
    await expect(
      asShop((tx) =>
        tx
          .update(deliveries)
          .set({ outcome: 'delivered' })
          .where(sql`${deliveries.id} = ${deliveryB}`),
      ),
    ).resolves.toMatchObject({ rowCount: 0 })
  })

  it('lets the crew read and write its own trip and nothing of another crew’s', async () => {
    const asCrew = as('delivery')
    const mine = (await asCrew((tx) => tx.select().from(trips))).map((t) => t.id)
    expect(mine).toEqual(expect.arrayContaining([tripA, tripSettled]))
    expect(mine).not.toContain(tripB)
    const stops = (await asCrew((tx) => tx.select().from(tripStops))).map((s) => s.id)
    expect(stops).toContain(stopA)
    expect(stops).not.toContain(stopB)
    expect((await asCrew((tx) => tx.select().from(deliveries))).map((d) => d.id)).toEqual([
      deliveryA,
    ])
    expect((await asCrew((tx) => tx.select().from(deliveryLines))).map((l) => l.id)).toEqual([
      deliveryLineA,
    ])
    expect((await asCrew((tx) => tx.select().from(collections))).map((c) => c.id)).toEqual([
      collectionA,
    ])
    expect((await asCrew((tx) => tx.select().from(tripExpenses))).map((e) => e.id)).toEqual([
      expenseA,
    ])
    expect((await asCrew((tx) => tx.select().from(tripSettlements))).map((s) => s.id)).toEqual([
      settlementA,
    ])
    expect((await asCrew((tx) => tx.select().from(vehicles))).map((v) => v.id)).toEqual(
      expect.arrayContaining([vehicleA, vehicleB]),
    )
    // raw GPS is never read back by the crew (DPDP: owner/manager, audited)
    expect(await asCrew((tx) => tx.select().from(tripPoints))).toHaveLength(0)

    // writes on its own trip: an expense, a doorstep record, breadcrumbs under its own user id
    await asCrew((tx) =>
      tx.insert(tripExpenses).values({
        id: uuidv7(),
        tenantId: tenantA,
        tripId: tripA,
        kind: 'toll',
        amountPaise: 5_000,
        recordedBy: driver,
      }),
    )
    await asCrew((tx) =>
      tx.insert(podEvidence).values({
        id: uuidv7(),
        tenantId: tenantA,
        deliveryId: deliveryA,
        kind: 'geo',
        lat: 1,
        lng: 1,
      }),
    )
    await asCrew((tx) =>
      tx.insert(tripPoints).values({
        id: uuidv7(),
        tenantId: tenantA,
        tripId: tripA,
        userId: driver,
        deviceId: `phone-a-${run}`,
        recordedAt: new Date(Date.now() + 1000),
        lat: 19.25,
        lng: 73.14,
      }),
    )
    await asCrew((tx) =>
      tx
        .update(vehiclePositions)
        .set({ lat: 19.26, recordedAt: new Date() })
        .where(sql`${vehiclePositions.vehicleId} = ${vehicleA}`),
    )
    // the same writes on the OTHER crew's trip are refused (WITH CHECK) or touch nothing (USING)
    await expect(
      asCrew((tx) =>
        tx.insert(tripExpenses).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripB,
          kind: 'toll',
          amountPaise: 5_000,
          recordedBy: driver,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asCrew((tx) =>
        tx
          .insert(podEvidence)
          .values({ id: uuidv7(), tenantId: tenantA, deliveryId: deliveryB, kind: 'geo' }),
      ),
    ).rejects.toThrow()
    await expect(
      asCrew((tx) =>
        tx.insert(tripPoints).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripB,
          userId: driver,
          deviceId: `phone-a-${run}`,
          recordedAt: new Date(),
          lat: 19.2,
          lng: 73.1,
        }),
      ),
    ).rejects.toThrow()
    // a phone never files a point under someone else's name, even on its own trip
    await expect(
      asCrew((tx) =>
        tx.insert(tripPoints).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          userId: otherDriver,
          deviceId: `phone-x-${run}`,
          recordedAt: new Date(),
          lat: 19.2,
          lng: 73.1,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asCrew((tx) =>
        tx
          .update(trips)
          .set({ endOdometerKm: 1 })
          .where(sql`${trips.id} = ${tripB}`),
      ),
    ).resolves.toMatchObject({ rowCount: 0 })
    // and a crew member cannot hand its own trip to someone else
    await expect(
      asCrew((tx) =>
        tx
          .update(trips)
          .set({ driverId: otherDriver })
          .where(sql`${trips.id} = ${tripA}`),
      ),
    ).rejects.toThrow()
    // the other crew, through its own token, sees the mirror image and cannot move van A on the map
    const asOtherCrew = as('delivery', otherDriver)
    expect((await asOtherCrew((tx) => tx.select().from(trips))).map((t) => t.id)).toEqual(
      expect.arrayContaining([tripB, tripClosing]),
    )
    expect((await asOtherCrew((tx) => tx.select().from(deliveries))).map((d) => d.id)).toEqual([
      deliveryB,
    ])
    await expect(
      asOtherCrew((tx) =>
        tx.insert(vehiclePositions).values({
          tenantId: tenantA,
          vehicleId: vehicleA,
          tripId: tripB,
          lat: 0,
          lng: 0,
          recordedAt: new Date(),
        }),
      ),
    ).rejects.toThrow()
    // the crew never posts the settlement: that is the money desk's
    await expect(
      asCrew((tx) =>
        tx.insert(tripSettlements).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          expectedCashPaise: 0,
          handedOverCashPaise: 0,
          cashVariancePaise: 0,
          settledBy: driver,
        }),
      ),
    ).rejects.toThrow()
  })

  it('lets the godown plan and load a trip but never touch its money or its proof', async () => {
    const asStore = as('warehouse')
    expect((await asStore((tx) => tx.select().from(trips))).map((t) => t.id)).toEqual(
      expect.arrayContaining([tripA, tripB]),
    )
    expect((await asStore((tx) => tx.select().from(vehicles))).map((v) => v.id)).toContain(vehicleA)
    const planned = uuidv7()
    await asStore((tx) =>
      tx.insert(trips).values({
        id: planned,
        tenantId: tenantA,
        tripNo: `TRIP-W-${run}`,
        tripDate: '2026-09-05',
        vehicleId: vehicleB,
        driverId: driver,
      }),
    )
    await asStore((tx) =>
      tx.insert(tripStops).values({
        id: uuidv7(),
        tenantId: tenantA,
        tripId: planned,
        sequence: 1,
        retailerId: retailerA,
      }),
    )
    for (const table of [
      deliveries,
      deliveryLines,
      podEvidence,
      collections,
      tripExpenses,
      tripSettlements,
      tripPoints,
      vehiclePositions,
    ]) {
      expect(await asStore((tx) => tx.select().from(table))).toHaveLength(0)
    }
    await expect(
      asStore((tx) =>
        tx.insert(collections).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          retailerId: retailerA,
          receiptId: uuidv7(),
          mode: 'cash',
          amountPaise: 1,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asStore((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          stopId: stopA,
          retailerId: retailerA,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-store-${run}`,
        }),
      ),
    ).rejects.toThrow()
  })

  it('keeps the doorstep record from the accountant, and the fleet from everyone but the owner or manager', async () => {
    const asBooks = as('accountant')
    // the money desk reads every trip, its cash and its proof, and closes the trip
    expect((await asBooks((tx) => tx.select().from(collections))).map((c) => c.id)).toEqual(
      expect.arrayContaining([collectionA, collectionB]),
    )
    expect((await asBooks((tx) => tx.select().from(podEvidence))).map((p) => p.id)).toEqual(
      expect.arrayContaining([podA, podB]),
    )
    expect(await asBooks((tx) => tx.select().from(tripPoints))).toHaveLength(0)
    expect(await asBooks((tx) => tx.select().from(vehiclePositions))).toHaveLength(0)
    await asBooks((tx) =>
      tx.insert(collections).values({
        id: uuidv7(),
        tenantId: tenantA,
        tripId: tripClosing,
        retailerId: retailerB,
        receiptId: uuidv7(),
        mode: 'cash',
        amountPaise: 10_000,
        collectedBy: actorFor('accountant'),
      }),
    )
    // but it never records a delivery, a line or a proof: that happens at the door
    await expect(
      asBooks((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          stopId: stopA,
          retailerId: retailerA,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-books-${run}`,
        }),
      ),
    ).rejects.toThrow()
    await expect(
      asBooks((tx) =>
        tx
          .insert(podEvidence)
          .values({ id: uuidv7(), tenantId: tenantA, deliveryId: deliveryA, kind: 'otp' }),
      ),
    ).rejects.toThrow()
    await expect(
      asBooks((tx) =>
        tx
          .update(deliveryLines)
          .set({ returnedQtyPcs: 1 })
          .where(sql`${deliveryLines.id} = ${deliveryLineA}`),
      ),
    ).resolves.toMatchObject({ rowCount: 0 })
    // the fleet: the owner or the manager, nobody else
    for (const role of ['accountant', 'warehouse', 'delivery'] as const) {
      await expect(
        as(role)((tx) =>
          tx.insert(vehicles).values({
            id: uuidv7(),
            tenantId: tenantA,
            regNo: `MH-05-${role.slice(0, 2).toUpperCase()}-${run.slice(-4)}`,
            locationId: vanA,
          }),
        ),
        `${role} must not add a vehicle`,
      ).rejects.toThrow()
    }
    const managerVan = uuidv7()
    await as('manager')((tx) =>
      tx.insert(vehicles).values({
        id: managerVan,
        tenantId: tenantA,
        regNo: `MH-05-MG-${run.slice(-4)}`,
        locationId: vanA,
      }),
    )
    expect((await as('manager')((tx) => tx.select().from(vehicles))).map((v) => v.id)).toContain(
      managerVan,
    )
  })

  it('keeps a delivery about the stop’s shop, on the stop’s trip', async () => {
    const asManager = as('manager')
    // the shop is filled in from the stop when the writer leaves it out (the read policy keys on it):
    // a second visit to shop A on the same trip, since one invoice is delivered once per stop
    const stopA2 = uuidv7()
    await asManager((tx) =>
      tx.insert(tripStops).values({
        id: stopA2,
        tenantId: tenantA,
        tripId: tripA,
        sequence: 2,
        retailerId: retailerA,
      }),
    )
    const filled = uuidv7()
    await asManager((tx) =>
      tx.execute(sql`
        insert into deliveries (id, tenant_id, trip_id, stop_id, invoice_id, idempotency_key)
        values (${filled}, ${tenantA}, ${tripA}, ${stopA2}, ${invoiceA}, ${`dlv-fill-${run}`})`),
    )
    const [row] = await asManager((tx) =>
      tx
        .select()
        .from(deliveries)
        .where(sql`${deliveries.id} = ${filled}`),
    )
    expect(row?.retailerId).toBe(retailerA)
    // another shop on shop A's stop, or shop A's stop on another crew's trip, is refused outright
    await rejectsWith(
      asManager((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          stopId: stopA,
          retailerId: retailerB,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-wrong-shop-${run}`,
        }),
      ),
      /not the shop of stop/,
    )
    await rejectsWith(
      asManager((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripB,
          stopId: stopA,
          retailerId: retailerA,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-wrong-trip-${run}`,
        }),
      ),
      /belongs to trip/,
    )
    // one invoice is delivered at most once per stop
    await expect(
      asManager((tx) =>
        tx.insert(deliveries).values({
          id: uuidv7(),
          tenantId: tenantA,
          tripId: tripA,
          stopId: stopA,
          retailerId: retailerA,
          invoiceId: invoiceA,
          idempotencyKey: `dlv-twice-${run}`,
        }),
      ),
    ).rejects.toThrow()
  })

  it('closes a red settlement only with the owner, and keeps its arithmetic honest', async () => {
    const base = {
      tenantId: tenantA,
      tripId: tripClosing,
      expectedCashPaise: 300_000,
      upiCollectedPaise: 0,
      expensesPaise: 30_000,
    }
    // ₹450 short is beyond the ₹100 tolerance: a manager or an accountant filing it is refused, and so
    // is anyone calling it green
    await rejectsWith(
      as('accountant')((tx) =>
        tx.insert(tripSettlements).values({
          ...base,
          id: uuidv7(),
          handedOverCashPaise: 255_000,
          cashVariancePaise: -45_000,
          hasVariance: true,
          settledBy: actorFor('accountant'),
        }),
      ),
      /settlement_needs_owner/,
    )
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(tripSettlements).values({
          ...base,
          id: uuidv7(),
          handedOverCashPaise: 255_000,
          cashVariancePaise: -45_000,
          hasVariance: false,
          settledBy: manager,
        }),
      ),
      /has_variance must be true/,
    )
    // a van stock miscount is red whatever the rupee value
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(tripSettlements).values({
          ...base,
          id: uuidv7(),
          handedOverCashPaise: 300_000,
          cashVariancePaise: 0,
          hasVariance: false,
          stockVariance: [{ lotId: balanceLot, expectedPcs: 24, countedPcs: 23 }],
          settledBy: manager,
        }),
      ),
      /has_variance must be true/,
    )
    // the arithmetic is checked to the paisa
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(tripSettlements).values({
          ...base,
          id: uuidv7(),
          handedOverCashPaise: 300_000,
          cashVariancePaise: -100,
          hasVariance: false,
          settledBy: manager,
        }),
      ),
      /must equal handed_over_cash_paise/,
    )
    // a manager may not sign the owner's approval, not even with the owner's id
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(tripSettlements).values({
          ...base,
          id: uuidv7(),
          handedOverCashPaise: 255_000,
          cashVariancePaise: -45_000,
          hasVariance: true,
          settledBy: manager,
          approvedBy: owner,
          approvedAt: new Date(),
        }),
      ),
      /only the owner accepts a variance/,
    )
    // the owner closing a red settlement IS the approval: both columns are filled from the actor
    const red = uuidv7()
    await as('owner')((tx) =>
      tx.insert(tripSettlements).values({
        ...base,
        id: red,
        handedOverCashPaise: 255_000,
        cashVariancePaise: -45_000,
        hasVariance: true,
        stockVariance: [{ lotId: balanceLot, expectedPcs: 24, countedPcs: 23 }],
        settledBy: owner,
      }),
    )
    const [saved] = await as('owner')((tx) =>
      tx
        .select()
        .from(tripSettlements)
        .where(sql`${tripSettlements.id} = ${red}`),
    )
    expect(saved?.approvedBy).toBe(owner)
    expect(saved?.approvedAt).toBeInstanceOf(Date)
    // and within tolerance the money desk closes the trip alone (a fresh closing trip for the unique key)
    const green = uuidv7()
    const tripGreen = uuidv7()
    await as('manager')((tx) =>
      tx.insert(trips).values({
        id: tripGreen,
        tenantId: tenantA,
        tripNo: `TRIP-G-${run}`,
        tripDate: '2026-09-04',
        vehicleId: vehicleB,
        driverId: otherDriver,
        state: 'closing',
      }),
    )
    await as('accountant')((tx) =>
      tx.insert(tripSettlements).values({
        ...base,
        id: green,
        tripId: tripGreen,
        handedOverCashPaise: 299_950,
        cashVariancePaise: -50,
        hasVariance: false,
        settledBy: actorFor('accountant'),
      }),
    )
    expect(
      (await as('accountant')((tx) => tx.select().from(tripSettlements))).map((s) => s.id),
    ).toEqual(expect.arrayContaining([settlementA, red, green]))
  })

  it('keeps the last mile inside the tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    for (const table of [
      trips,
      vehicles,
      tripStops,
      deliveries,
      collections,
      tripSettlements,
      vehiclePositions,
    ]) {
      expect(await asOtherTenant((tx) => tx.select().from(table))).toHaveLength(0)
    }
  })

  // Migrations 0016/0017 (docint). A supplier bill is a page full of purchase rates, so `documents` and
  // `document_pages` are scoped by KIND (docint §3i, docs/17 A12): the inbound desk (owner, manager,
  // accountant, warehouse, system) reads every kind, the field reads and writes only a proof of delivery,
  // a claim sheet or "other", and the shopkeeper reads none. Everything the engine produced — the
  // extraction, its checks, the SKU candidates, the review, the corrections, the disagreements — stays
  // with the back office. One refusal per role per table.

  it('keeps a supplier bill image from the field and the shop, and shows the field only its own kinds', async () => {
    // the inbound desk reads every kind, including the priced one
    for (const role of ['owner', 'manager', 'accountant', 'warehouse'] as const) {
      const ids = (await as(role)((tx) => tx.select().from(documents))).map((d) => d.id)
      expect(ids, `${role} reads the supplier bill`).toEqual(
        expect.arrayContaining([docSupplier, docPod, docClaim]),
      )
      expect(
        (await as(role)((tx) => tx.select().from(documentPages))).map((p) => p.id),
        `${role} reads its pages`,
      ).toEqual(expect.arrayContaining([pageSupplier, pagePod]))
    }
    // the crew and the rep see the field kinds and never the supplier bill, nor its page
    for (const role of ['delivery', 'salesperson'] as const) {
      const ids = (await as(role)((tx) => tx.select().from(documents))).map((d) => d.id)
      expect(ids, `${role} sees the field kinds`).toEqual(
        expect.arrayContaining([docPod, docClaim]),
      )
      expect(ids, `${role} must not see a supplier invoice`).not.toContain(docSupplier)
      const pages = (await as(role)((tx) => tx.select().from(documentPages))).map((p) => p.id)
      expect(pages, `${role} sees the pod page`).toContain(pagePod)
      expect(pages, `${role} must not see a supplier invoice page`).not.toContain(pageSupplier)
    }
    // the shopkeeper sees no document of any kind
    expect(await as('retailer')((tx) => tx.select().from(documents))).toHaveLength(0)
    expect(await as('retailer')((tx) => tx.select().from(documentPages))).toHaveLength(0)
    // the worker (app_rw with the system role, the way `withTenant` runs a job) reads every kind
    const asSystem = (
      await withTenant(db, { tenantId: tenantA, actorId: 'worker', actorRole: 'system' }, (tx) =>
        tx.select().from(documents),
      )
    ).map((d) => d.id)
    expect(asSystem).toEqual(expect.arrayContaining([docSupplier, docPod, docClaim]))
  })

  it('lets the crew capture a proof of delivery and the rep a claim sheet, and neither a supplier bill', async () => {
    const capture = (
      role: 'salesperson' | 'delivery' | 'retailer',
      kind: (typeof documents.$inferInsert)['kind'],
    ) =>
      as(role)((tx) =>
        tx
          .insert(documents)
          .values({ id: uuidv7(), tenantId: tenantA, kind, uploadedBy: actorFor(role) }),
      )
    await capture('delivery', 'pod')
    await capture('salesperson', 'claim_sheet')
    await capture('delivery', 'other')
    for (const role of ['delivery', 'salesperson'] as const) {
      for (const kind of ['supplier_invoice', 'lorry_receipt', 'brand_dms_invoice'] as const) {
        await rejectsWith(capture(role, kind), /row-level security/)
      }
    }
    await rejectsWith(capture('retailer', 'pod'), /row-level security/)
    // a page follows its document: the crew adds a page to its own proof, never to the supplier bill
    const addPage = (role: 'delivery' | 'salesperson' | 'retailer', documentId: string) =>
      as(role)((tx) =>
        tx.insert(documentPages).values({
          id: uuidv7(),
          tenantId: tenantA,
          documentId,
          pageNo: 2 + Math.floor(Math.random() * 1_000_000),
          objectKey: `tenant/${tenantA}/docs/${documentId}/page-x.jpg`,
          mimeType: 'image/jpeg',
        }),
      )
    await addPage('delivery', docPod)
    await rejectsWith(addPage('delivery', docSupplier), /row-level security/)
    await rejectsWith(addPage('salesperson', docSupplier), /row-level security/)
    await rejectsWith(addPage('retailer', docPod), /row-level security/)
    // nor may the field change a supplier bill it cannot see: the update matches no row
    for (const role of ['delivery', 'salesperson', 'retailer'] as const) {
      const touched = await as(role)((tx) =>
        tx
          .update(documents)
          .set({ status: 'rejected', rejectedReason: 'not_ours' })
          .where(eq(documents.id, docSupplier))
          .returning({ id: documents.id }),
      )
      expect(touched, `${role} must not reach the supplier bill`).toHaveLength(0)
    }
    const stillOpen = await db.select().from(documents).where(eq(documents.id, docSupplier))
    expect(stillOpen[0]?.status).toBe('needs_review')
  })

  it('keeps the extraction output (printed purchase rates) to the back office: not even the gate staff', async () => {
    const priced = [
      extractions,
      extractionChecks,
      skuMatchCandidates,
      reviewSessions,
      correctionsLog,
      engineDisagreements,
    ] as const
    for (const role of ['salesperson', 'delivery', 'retailer', 'warehouse'] as const) {
      for (const table of priced) {
        expect(
          await as(role)((tx) => tx.select().from(table)),
          `${role} must not read a priced docint table`,
        ).toHaveLength(0)
      }
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(extractions).values({
            id: uuidv7(),
            tenantId: tenantA,
            documentId: docPod,
            engine: 'manual',
            result: {},
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(reviewSessions).values({
            id: uuidv7(),
            tenantId: tenantA,
            documentId: docPod,
            reviewerId: actorFor(role),
            lockedUntil: new Date(Date.now() + 60_000),
          }),
        ),
        /row-level security/,
      )
    }
    // the CA reviews inbound invoices: the accountant reads the full priced surface
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        (await as(role)((tx) => tx.select().from(extractions))).map((e) => e.id),
        `${role} reads the extraction`,
      ).toContain(extractionA)
      expect(
        (await as(role)((tx) => tx.select().from(reviewSessions))).map((r) => r.id),
        `${role} reads the review`,
      ).toContain(reviewA)
    }
    const [row] = await as('accountant')((tx) =>
      tx.select().from(extractions).where(eq(extractions.id, extractionA)),
    )
    expect(row?.totalPaise).toBe(100_000)
    expect(row?.invoiceDate).toBe('2026-09-01')
    // and the warehouse role, which captured the bill, reads the document but sees nothing of its rates
    expect((await as('warehouse')((tx) => tx.select().from(documents))).map((d) => d.id)).toContain(
      docSupplier,
    )
  })

  it('keeps one match candidate per line and variant, and lets the cascade upsert it', async () => {
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(skuMatchCandidates).values({
          id: uuidv7(),
          tenantId: tenantA,
          extractionId: extractionA,
          lineNo: 1,
          variantId: variant,
          score: 0.9,
          reason: 'external_code',
        }),
      ),
      /sku_match_candidates_unique_idx/,
    )
    await as('manager')((tx) =>
      tx
        .insert(skuMatchCandidates)
        .values({
          id: uuidv7(),
          tenantId: tenantA,
          extractionId: extractionA,
          lineNo: 1,
          variantId: variant,
          score: 1,
          reason: 'reviewer',
          chosen: true,
          matchedBy: 'reviewer',
        })
        .onConflictDoUpdate({
          target: [
            skuMatchCandidates.tenantId,
            skuMatchCandidates.extractionId,
            skuMatchCandidates.lineNo,
            skuMatchCandidates.variantId,
          ],
          set: { score: 1, reason: 'reviewer', chosen: true, matchedBy: 'reviewer' },
        }),
    )
    const rows = await as('manager')((tx) =>
      tx.select().from(skuMatchCandidates).where(eq(skuMatchCandidates.extractionId, extractionA)),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: candidateA, chosen: true, matchedBy: 'reviewer', score: 1 })
    // a second manager may not open a review while the first holds the lock (partial unique index)
    await rejectsWith(
      as('owner')((tx) =>
        tx.insert(reviewSessions).values({
          id: uuidv7(),
          tenantId: tenantA,
          documentId: docSupplier,
          reviewerId: owner,
          lockedUntil: new Date(Date.now() + 60_000),
        }),
      ),
      /review_sessions_open_idx/,
    )
  })

  it('stands the fuzzy SKU stage on pg_trgm with the five trigram indexes', async () => {
    const ext = await db.execute(sql`select extname from pg_extension where extname = 'pg_trgm'`)
    expect(ext.rows).toHaveLength(1)
    const idx = await db.execute(
      sql`select indexname from pg_indexes where schemaname = 'public' and indexdef like '%gin_trgm_ops%' order by indexname`,
    )
    expect(idx.rows.map((r) => (r as { indexname: string }).indexname)).toEqual([
      'product_aliases_normalized_trgm_idx',
      'product_variants_name_trgm_idx',
      'products_name_trgm_idx',
      'supplier_aliases_normalized_trgm_idx',
      'supplier_pack_configs_desc_trgm_idx',
    ])
    // the cascade's fuzzy step, as the back office runs it: similarity() resolves against the alias
    const hit = await as('manager')((tx) =>
      tx
        .select({ id: supplierAliases.id })
        .from(supplierAliases)
        .where(sql`similarity(${supplierAliases.normalized}, ${`depot${run}x`}) > 0.6`),
    )
    expect(hit.map((h) => h.id)).toEqual([aliasA])
  })

  it('keeps the inbound pipeline inside the tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    for (const table of [
      documents,
      documentPages,
      extractions,
      extractionChecks,
      skuMatchCandidates,
      reviewSessions,
      correctionsLog,
      engineDisagreements,
      supplierAliases,
    ]) {
      expect(await asOtherTenant((tx) => tx.select().from(table))).toHaveLength(0)
    }
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0018/0019 (integrations: the generic mapped importer and the Tally desk, docs/17 §D7,
  // docs/plans/integrations.md §1, §3, §5.16). Six back-office tables — a saved column-mapping profile
  // decides where real shops and real money land — so every field role and the shopkeeper are refused on
  // every one of them, and one trigger keeps a job's profile inside the job's tenant and target.

  const integrationsTables = [
    importProfiles,
    importJobs,
    importRows,
    exportJobs,
    tallyMappings,
    tallySyncLedger,
  ] as const

  it('keeps the import wizard and the Tally desk to the back office: not the rep, the godown, the crew or the shop', async () => {
    for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
      for (const table of integrationsTables) {
        expect(
          await as(role)((tx) => tx.select().from(table)),
          `${role} must not read an integrations table`,
        ).toHaveLength(0)
      }
      // nor save a profile, start an import, request an export or map a Tally ledger
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(importProfiles).values({
            id: uuidv7(),
            tenantId: tenantA,
            name: `Sneaky ${role} ${run}`,
            kind: 'csv',
            target: 'retailers',
            createdBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(importJobs).values({
            id: uuidv7(),
            tenantId: tenantA,
            kind: 'csv',
            target: 'retailers',
            sourceObjectKey: `tenant/${tenantA}/import/x/${role}.csv`,
            requestedBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(exportJobs).values({
            id: uuidv7(),
            tenantId: tenantA,
            kind: 'outstanding_xlsx',
            requestedBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(tallyMappings).values({
            id: uuidv7(),
            tenantId: tenantA,
            entityType: 'party',
            entityId: retailerA,
            tallyName: 'Shop A',
          }),
        ),
        /row-level security/,
      )
      // nor resolve a row under review, or re-aim a staged job: the update matches nothing
      const touchedRow = await as(role)((tx) =>
        tx
          .update(importRows)
          .set({ status: 'matched', reviewedBy: actorFor(role), reviewedAt: new Date() })
          .where(eq(importRows.id, importRowA))
          .returning({ id: importRows.id }),
      )
      expect(touchedRow, `${role} must not resolve an import row`).toHaveLength(0)
      const touchedJob = await as(role)((tx) =>
        tx
          .update(importJobs)
          .set({ status: 'cancelled' })
          .where(eq(importJobs.id, importJobA))
          .returning({ id: importJobs.id }),
      )
      expect(touchedJob, `${role} must not cancel an import`).toHaveLength(0)
    }
    const [row] = await db.select().from(importRows).where(eq(importRows.id, importRowA))
    expect(row?.status).toBe('needs_review')
    expect(row?.reviewedBy).toBeNull()
    // the desk — owner, manager and the accountant's "reads and exports" seat — reads all six
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        (await as(role)((tx) => tx.select().from(importProfiles))).map((p) => p.id),
        `${role} reads the saved profile`,
      ).toContain(profileA)
      expect(
        (await as(role)((tx) => tx.select().from(importJobs))).map((j) => j.id),
        `${role} reads the import`,
      ).toContain(importJobA)
      expect(
        (await as(role)((tx) => tx.select().from(importRows))).map((r) => r.id),
        `${role} reads its rows`,
      ).toContain(importRowA)
      expect(
        (await as(role)((tx) => tx.select().from(exportJobs))).map((e) => e.id),
        `${role} reads the export`,
      ).toContain(exportJobA)
      expect(
        (await as(role)((tx) => tx.select().from(tallySyncLedger))).map((s) => s.id),
        `${role} reads the sync ledger`,
      ).toContain(tallySyncA)
      expect(
        (await as(role)((tx) => tx.select().from(tallyMappings))).map((m) => m.id),
        `${role} reads the Tally mapping`,
      ).toContain(tallyMappingA)
    }
    // the worker (app_rw with the system role, the way the stage/commit/render jobs run) reads them too
    const asSystem = await withTenant(
      db,
      { tenantId: tenantA, actorId: 'worker', actorRole: 'system' },
      (tx) => tx.select({ id: importJobs.id }).from(importJobs),
    )
    expect(asSystem.map((j) => j.id)).toContain(importJobA)
  })

  it('lets the desk save a named profile once per tenant and pin a job only to a profile of its own tenant and target', async () => {
    // a second profile with the same name is a second copy of the same decision: refused by the unique index
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(importProfiles).values({
          id: uuidv7(),
          tenantId: tenantA,
          name: `TradeEzee party master ${run}`,
          kind: 'tradeezee_party',
          target: 'retailers',
          createdBy: manager,
        }),
      ),
      /import_profiles_name_idx/,
    )
    // the accountant reads and exports; it may also save a profile (integrations §8.7: uniform desk)
    const accountantProfile = uuidv7()
    await as('accountant')((tx) =>
      tx.insert(importProfiles).values({
        id: accountantProfile,
        tenantId: tenantA,
        name: `TradeEzee outstanding ${run}`,
        kind: 'tradeezee_outstanding',
        target: 'opening_balances',
        mapping: { Party: 'retailerName', 'Bill No': 'invoiceNo', Balance: 'amountRupees' },
        transforms: { amountRupees: { rupeesToPaise: true } },
        createdBy: owner,
      }),
    )
    const startJob = (target: string, profileId: string | null) =>
      as('manager')((tx) =>
        tx
          .insert(importJobs)
          .values({
            id: uuidv7(),
            tenantId: tenantA,
            kind: 'tradeezee_party',
            target,
            sourceObjectKey: `tenant/${tenantA}/import/${uuidv7()}/file.csv`,
            profileId,
            requestedBy: manager,
          })
          .returning({
            id: importJobs.id,
            status: importJobs.status,
            profileId: importJobs.profileId,
          }),
      )
    // right tenant, right target: the job carries the profile
    const [pinned] = await startJob('retailers', profileA)
    expect(pinned).toMatchObject({ status: 'queued', profileId: profileA })
    // a job mapped by hand carries none
    const [byHand] = await startJob('retailers', null)
    expect(byHand?.profileId).toBeNull()
    // a retailers profile cannot drive an opening-balances import (a wrong mapping misfiles real money)
    await rejectsWith(
      startJob('opening_balances', profileA),
      /cannot drive a opening_balances import/,
    )
    // tenant B's profile is invisible to tenant A's desk AND refused by the guard even where visible
    expect(
      (await as('manager')((tx) => tx.select().from(importProfiles))).map((p) => p.id),
    ).not.toContain(profileB)
    await rejectsWith(startJob('retailers', profileB), /belongs to another tenant/)
    // a profile that does not exist
    await rejectsWith(startJob('retailers', uuidv7()), /does not exist/)
    // and a staged job cannot be re-aimed at a target its profile does not map
    await rejectsWith(
      as('manager')((tx) =>
        tx
          .update(importJobs)
          .set({ target: 'products' })
          .where(eq(importJobs.id, importJobA))
          .returning({ id: importJobs.id }),
      ),
      /cannot drive a products import/,
    )
  })

  it('pauses a parsed import at staged and records who resolved a row', async () => {
    // the stage job left the fixture at `staged`, the value 0018 added to the shared job enum
    const [job] = await as('manager')((tx) =>
      tx.select().from(importJobs).where(eq(importJobs.id, importJobA)),
    )
    expect(job).toMatchObject({
      status: 'staged',
      profileId: profileA,
      sourceFileName: 'party-master.csv',
      hasHeaderRow: true,
      sourceColumns: ['Party Name', 'Mobile', 'GSTIN'],
      totalRows: 1,
    })
    expect(job?.startedAt).toBeInstanceOf(Date)
    expect(job?.finishedAt).toBeInstanceOf(Date)
    // the reviewer resolves the ambiguous row: the row remembers who and when
    const reviewedAt = new Date()
    const [resolved] = await as('manager')((tx) =>
      tx
        .update(importRows)
        .set({
          status: 'matched',
          normalized: { name: 'Shop A', phone: `+91900${run}3`, retailerId: retailerA },
          error: null,
          reviewedBy: manager,
          reviewedAt,
        })
        .where(eq(importRows.id, importRowA))
        .returning(),
    )
    expect(resolved).toMatchObject({ status: 'matched', reviewedBy: manager, error: null })
    expect(resolved?.reviewedAt?.getTime()).toBe(reviewedAt.getTime())
    // an export never pauses for review, but the enum is shared: the value is there for it too. 0023
    // completed the import machine (committed = applied and reversible, confirmed = signed off,
    // rolled_back = reversed; importJobMachine in @dos/domain) — an export never holds those either.
    const labels = await db.execute(
      sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'job_status' order by enumsortorder`,
    )
    expect(labels.rows.map((r) => (r as { enumlabel: string }).enumlabel)).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'staged',
      'committed',
      'confirmed',
      'rolled_back',
    ])
    // the export-detail screen's "what did this job push" list has its index (0018), leading with tenant_id
    const idx = await db.execute(
      sql`select indexdef from pg_indexes where schemaname = 'public' and indexname in ('tally_sync_ledger_export_idx', 'import_profiles_name_idx', 'import_jobs_profile_idx') order by indexname`,
    )
    expect(idx.rows).toHaveLength(3)
    for (const r of idx.rows) {
      expect((r as { indexdef: string }).indexdef).toMatch(/\(tenant_id,/)
    }
    const pushed = await as('accountant')((tx) =>
      tx
        .select({ docId: tallySyncLedger.docId })
        .from(tallySyncLedger)
        .where(eq(tallySyncLedger.exportJobId, exportJobA)),
    )
    expect(pushed.map((p) => p.docId)).toEqual([invoiceA])
  })

  it('keeps the import wizard and the Tally desk inside the tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    for (const table of integrationsTables) {
      const rows = await asOtherTenant((tx) => tx.select().from(table))
      // tenant B owns exactly its own profile and nothing of tenant A
      expect(rows.map((r) => r.id)).not.toContain(profileA)
      expect(rows.map((r) => r.id)).not.toContain(importJobA)
      expect(rows.map((r) => r.id)).not.toContain(exportJobA)
    }
    expect(
      (await asOtherTenant((tx) => tx.select().from(importProfiles))).map((p) => p.id),
    ).toContain(profileB)
    expect(await asOtherTenant((tx) => tx.select().from(importJobs))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(importRows))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(exportJobs))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(tallyMappings))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(tallySyncLedger))).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0021/0022 (claims: money the brand owes the distributor, docs/plans/claims.md §3, §4.21,
  // §5.16–19, §5.23; coordination §5.3). Five back-office tables plus the brand's claim policy. A claim
  // line on a damage claim carries PURCHASE COST (`rate_paise`) and a scheme line says which schemes
  // the brand funds — the two secrets the field must never learn (docs/22 §9 never-list 1) — so every
  // field role and the shopkeeper are refused on all six, in both directions; the owner alone sets a
  // policy; and the arithmetic (settled within claimed, one live claim per period, one claim per
  // source) is a constraint, not service code.

  const claimsTables = [
    claims,
    claimLines,
    claimEvidence,
    claimStatements,
    claimSettlements,
    returnPolicies,
  ] as const

  it('keeps every claims table from the rep, the godown, the crew and the shop: not a row, not a write', async () => {
    for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
      for (const table of claimsTables) {
        expect(
          await as(role)((tx) => tx.select().from(table)),
          `${role} must not read a claims table`,
        ).toHaveLength(0)
      }
      // the purchase-cost leak vector, named: the priced line
      expect(
        await as(role)((tx) =>
          tx
            .select({ ratePaise: claimLines.ratePaise })
            .from(claimLines)
            .where(eq(claimLines.id, claimLineA)),
        ),
        `${role} must not read claim_lines.rate_paise`,
      ).toHaveLength(0)
      // nor open a claim, add a line, attach a photo, ask for a sheet, record the brand's money, or set a policy
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(claims).values({
            id: uuidv7(),
            tenantId: tenantA,
            supplierId: supplierA,
            kind: 'other',
            periodFrom: '2026-09-01',
            periodTo: '2026-09-30',
            createdBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(claimLines).values({
            id: uuidv7(),
            tenantId: tenantA,
            claimId: claimA,
            sourceType: 'manual',
            sourceId: `sneaky-${role}-${run}`,
            amountPaise: 1,
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(claimEvidence).values({
            id: uuidv7(),
            tenantId: tenantA,
            claimId: claimA,
            objectKey: `tenant/${tenantA}/claims/${claimA}/${role}.jpg`,
            uploadedBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(claimStatements).values({
            id: uuidv7(),
            tenantId: tenantA,
            claimId: claimA,
            format: 'generic_xlsx',
            generatedAt: null,
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(claimSettlements).values({
            id: uuidv7(),
            tenantId: tenantA,
            claimId: claimA,
            settledOn: '2026-09-05',
            amountPaise: 1,
            mode: 'adjustment',
            recordedBy: actorFor(role),
          }),
        ),
        /row-level security/,
      )
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(returnPolicies).values({
            id: uuidv7(),
            tenantId: tenantA,
            brandId: brandA,
            damageClaimable: true,
          }),
        ),
        /row-level security|return_policies_tenant_brand_idx/,
      )
      // nor settle, reject or renumber a claim, or touch a line's money: the update matches nothing
      const touchedClaim = await as(role)((tx) =>
        tx
          .update(claims)
          .set({ settledPaise: 100_000, status: 'settled' })
          .where(eq(claims.id, claimA))
          .returning({ id: claims.id }),
      )
      expect(touchedClaim, `${role} must not settle a claim`).toHaveLength(0)
      const touchedLine = await as(role)((tx) =>
        tx
          .update(claimLines)
          .set({ settledPaise: 100_000 })
          .where(eq(claimLines.id, claimLineA))
          .returning({ id: claimLines.id }),
      )
      expect(touchedLine, `${role} must not touch a claim line`).toHaveLength(0)
      const touchedPolicy = await as(role)((tx) =>
        tx
          .update(returnPolicies)
          .set({ damageClaimable: false })
          .where(eq(returnPolicies.id, policyA))
          .returning({ id: returnPolicies.id }),
      )
      expect(touchedPolicy, `${role} must not change a claim policy`).toHaveLength(0)
      const deleted = await as(role)((tx) =>
        tx.delete(claimLines).where(eq(claimLines.id, claimLineA)).returning({ id: claimLines.id }),
      )
      expect(deleted, `${role} must not remove a claim line`).toHaveLength(0)
    }
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimA))
    expect(claim?.status).toBe('partially_settled')
    expect(claim?.settledPaise).toBe(40_000)
    const [line] = await db.select().from(claimLines).where(eq(claimLines.id, claimLineA))
    expect(line?.settledPaise).toBe(40_000)
    // the desk — owner, manager and the accountant's money seat — reads all six
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        (await as(role)((tx) => tx.select().from(claims))).map((c) => c.id),
        `${role} reads the claim`,
      ).toContain(claimA)
      const lines = await as(role)((tx) =>
        tx.select().from(claimLines).where(eq(claimLines.id, claimLineA)),
      )
      expect(lines[0]?.ratePaise, `${role} reads the line at cost`).toBe(3_000)
      expect(
        (await as(role)((tx) => tx.select().from(claimEvidence))).map((e) => e.id),
        `${role} reads the evidence`,
      ).toContain(claimEvidenceA)
      expect(
        (await as(role)((tx) => tx.select().from(claimStatements))).map((s) => s.id),
        `${role} reads the sheet`,
      ).toContain(claimStatementA)
      expect(
        (await as(role)((tx) => tx.select().from(claimSettlements))).map((s) => s.id),
        `${role} reads the settlement`,
      ).toContain(claimSettlementA)
      expect(
        (await as(role)((tx) => tx.select().from(returnPolicies))).map((p) => p.id),
        `${role} reads the claim policy`,
      ).toContain(policyA)
    }
    // the worker (app_rw with the system role: the period rollover, the sheet renderer) reads them too
    const asSystem = await withTenant(
      db,
      { tenantId: tenantA, actorId: 'worker', actorRole: 'system' },
      (tx) => tx.select({ id: claims.id }).from(claims),
    )
    expect(asSystem.map((c) => c.id)).toContain(claimA)
  })

  it('lets the owner alone set a brand’s claim policy; the manager and the accountant read it and record the money', async () => {
    // a policy is what money the business believes it can recover: owner only, like claims.policies.upsert
    for (const role of ['manager', 'accountant'] as const) {
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(returnPolicies).values({
            id: uuidv7(),
            tenantId: tenantA,
            brandId: uuidv7(),
            expiryClaimable: true,
          }),
        ),
        /row-level security/,
      )
      const touched = await as(role)((tx) =>
        tx
          .update(returnPolicies)
          .set({ settlementDays: 7 })
          .where(eq(returnPolicies.id, policyA))
          .returning({ id: returnPolicies.id }),
      )
      expect(touched, `${role} must not change a claim policy`).toHaveLength(0)
      const removed = await as(role)((tx) =>
        tx
          .delete(returnPolicies)
          .where(eq(returnPolicies.id, policyA))
          .returning({ id: returnPolicies.id }),
      )
      expect(removed, `${role} must not remove a claim policy`).toHaveLength(0)
    }
    const changed = await as('owner')((tx) =>
      tx
        .update(returnPolicies)
        .set({ settlementDays: 21, claimPeriodKind: 'fortnightly' })
        .where(eq(returnPolicies.id, policyA))
        .returning({ settlementDays: returnPolicies.settlementDays }),
    )
    expect(changed).toEqual([{ settlementDays: 21 }])
    // the money desk records a brand's credit note (claims.settlements.record is BACK_OFFICE) …
    const settlementByAccountant = uuidv7()
    const recorded = await as('accountant')((tx) =>
      tx
        .insert(claimSettlements)
        .values({
          id: settlementByAccountant,
          tenantId: tenantA,
          claimId: claimA,
          settledOn: '2026-09-05',
          amountPaise: 10_000,
          mode: 'adjustment',
          note: 'rounding agreed on the phone',
          recordedBy: owner,
        })
        .returning({ id: claimSettlements.id }),
    )
    expect(recorded).toEqual([{ id: settlementByAccountant }])
    // … and the same brand reference never twice on one claim
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(claimSettlements).values({
          id: uuidv7(),
          tenantId: tenantA,
          claimId: claimA,
          settledOn: '2026-09-05',
          amountPaise: 1_000,
          mode: 'credit_note',
          externalRef: `CN/${run}`,
        }),
      ),
      /claim_settlements_ref_idx/,
    )
    await db.delete(claimSettlements).where(eq(claimSettlements.id, settlementByAccountant))
  })

  it('keeps a claim’s arithmetic honest: settled within claimed, a period in order, an amount above zero, evidence that points somewhere', async () => {
    // the brand cannot pay more than was claimed (settled + written off ≤ claimed), on the claim …
    await rejectsWith(
      as('owner')((tx) =>
        tx.update(claims).set({ settledPaise: 100_001 }).where(eq(claims.id, claimA)),
      ),
      /claims_settled_within_claimed/,
    )
    await rejectsWith(
      as('owner')((tx) =>
        tx
          .update(claims)
          .set({ settledPaise: 60_000, writtenOffPaise: 40_001 })
          .where(eq(claims.id, claimA)),
      ),
      /claims_settled_within_claimed/,
    )
    // … and on the line
    await rejectsWith(
      as('owner')((tx) =>
        tx.update(claimLines).set({ settledPaise: 100_001 }).where(eq(claimLines.id, claimLineA)),
      ),
      /claim_lines_settled_within_amount/,
    )
    // a period runs forwards
    await rejectsWith(
      as('owner')((tx) =>
        tx.insert(claims).values({
          id: uuidv7(),
          tenantId: tenantA,
          supplierId: supplierA,
          kind: 'other',
          periodFrom: '2026-09-30',
          periodTo: '2026-09-01',
        }),
      ),
      /claims_period_order/,
    )
    // a settlement is money that arrived
    await rejectsWith(
      as('owner')((tx) =>
        tx.insert(claimSettlements).values({
          id: uuidv7(),
          tenantId: tenantA,
          claimId: claimA,
          settledOn: '2026-09-05',
          amountPaise: 0,
          mode: 'bank_receipt',
        }),
      ),
      /claim_settlements_amount_positive/,
    )
    // evidence is a document or an object key, never neither
    await rejectsWith(
      as('owner')((tx) =>
        tx.insert(claimEvidence).values({
          id: uuidv7(),
          tenantId: tenantA,
          claimId: claimA,
          kind: 'email',
          caption: 'the brand said yes',
        }),
      ),
      /claim_evidence_has_target/,
    )
    // the sheet row exists before the sheet does (the worker fills it), and the closing state exists
    const [statement] = await db
      .select()
      .from(claimStatements)
      .where(eq(claimStatements.id, claimStatementA))
    expect(statement?.objectKey).toBeNull()
    expect(statement?.generatedAt).toBeNull()
    expect(statement?.exportJobId).toBe(exportJobA)
    const closing = await db.execute(
      sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'claim_status' and e.enumlabel = 'written_off'`,
    )
    expect(closing.rows).toHaveLength(1)
    const [claim] = await db.select().from(claims).where(eq(claims.id, claimA))
    expect(claim?.settledPaise).toBe(40_000)
    expect(claim?.writtenOffPaise).toBe(0)
  })

  it('claims a source once, and again only after the claim that held it is rejected', async () => {
    const source = `stock-ledger-${run}`
    const first = uuidv7()
    await as('manager')((tx) =>
      tx.insert(claimLines).values({
        id: first,
        tenantId: tenantA,
        claimId: claimA,
        lineNo: 2,
        sourceType: 'stock_ledger',
        sourceId: source,
        variantId: variant,
        qtyPcs: 12,
        ratePaise: 3_000,
        basis: 'ptd',
        amountPaise: 36_000,
      }),
    )
    // the same damage row on a second line: refused, whichever claim it is on (the build counts it as skipped)
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(claimLines).values({
          id: uuidv7(),
          tenantId: tenantA,
          claimId: claimA,
          lineNo: 3,
          sourceType: 'stock_ledger',
          sourceId: source,
          amountPaise: 36_000,
        }),
      ),
      /claim_lines_source_unique_idx/,
    )
    // an out-of-window copy is recorded as rejected, so the loss is visible, and does not collide
    const outOfWindow = uuidv7()
    await as('manager')((tx) =>
      tx.insert(claimLines).values({
        id: outOfWindow,
        tenantId: tenantA,
        claimId: claimA,
        lineNo: 3,
        status: 'rejected',
        sourceType: 'stock_ledger',
        sourceId: source,
        amountPaise: 36_000,
        detail: { reason: 'out_of_window' },
      }),
    )
    // once the line that holds the source is rejected, the source is claimable again
    await as('manager')((tx) =>
      tx.update(claimLines).set({ status: 'rejected' }).where(eq(claimLines.id, first)),
    )
    const again = uuidv7()
    await as('manager')((tx) =>
      tx.insert(claimLines).values({
        id: again,
        tenantId: tenantA,
        claimId: claimA,
        lineNo: 4,
        sourceType: 'stock_ledger',
        sourceId: source,
        amountPaise: 36_000,
      }),
    )
    // one live claim per supplier × brand × kind × period — with NO brand, which is where a plain
    // unique index would let two shortage claims cover the same month (NULLs never collide)
    const shortage = uuidv7()
    await as('manager')((tx) =>
      tx.insert(claims).values({
        id: shortage,
        tenantId: tenantA,
        supplierId: supplierA,
        kind: 'shortage',
        periodFrom: '2026-08-01',
        periodTo: '2026-08-31',
        createdBy: manager,
      }),
    )
    await rejectsWith(
      as('manager')((tx) =>
        tx.insert(claims).values({
          id: uuidv7(),
          tenantId: tenantA,
          supplierId: supplierA,
          kind: 'shortage',
          periodFrom: '2026-08-01',
          periodTo: '2026-08-31',
          createdBy: manager,
        }),
      ),
      /claims_open_period_idx/,
    )
    await as('manager')((tx) =>
      tx
        .update(claims)
        .set({
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: 'raised on the wrong month',
        })
        .where(eq(claims.id, shortage)),
    )
    const reraised = uuidv7()
    await as('manager')((tx) =>
      tx.insert(claims).values({
        id: reraised,
        tenantId: tenantA,
        supplierId: supplierA,
        kind: 'shortage',
        periodFrom: '2026-08-01',
        periodTo: '2026-08-31',
        createdBy: manager,
      }),
    )
    await db.delete(claimLines).where(eq(claimLines.id, first))
    await db.delete(claimLines).where(eq(claimLines.id, outOfWindow))
    await db.delete(claimLines).where(eq(claimLines.id, again))
    await db.delete(claims).where(eq(claims.id, shortage))
    await db.delete(claims).where(eq(claims.id, reraised))
  })

  it('keeps a claim inside the tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    const seen = await asOtherTenant((tx) => tx.select().from(claims))
    expect(seen.map((c) => c.id)).toContain(claimB)
    expect(seen.map((c) => c.id)).not.toContain(claimA)
    expect(await asOtherTenant((tx) => tx.select().from(claimLines))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(claimEvidence))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(claimStatements))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(claimSettlements))).toHaveLength(0)
    expect(await asOtherTenant((tx) => tx.select().from(returnPolicies))).toHaveLength(0)
    // and nothing of tenant B's can be pinned onto tenant A's claim: RLS hides the claim from app_rw,
    // but a foreign-key check bypasses row security, so the guard trigger is the rule — for the owner
    // connection (no RLS at all) as much as for a tenant B actor
    await rejectsWith(
      asOtherTenant((tx) =>
        tx.insert(claimSettlements).values({
          id: uuidv7(),
          tenantId: tenantB,
          claimId: claimA,
          settledOn: '2026-09-05',
          amountPaise: 1,
          mode: 'adjustment',
        }),
      ),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.insert(claimLines).values({
        id: uuidv7(),
        tenantId: tenantB,
        claimId: claimA,
        sourceType: 'manual',
        sourceId: `pin-${run}`,
        amountPaise: 1,
      }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.insert(claimEvidence).values({
        id: uuidv7(),
        tenantId: tenantB,
        claimId: claimA,
        objectKey: `tenant/${tenantB}/claims/x.jpg`,
      }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.insert(claimStatements).values({
        id: uuidv7(),
        tenantId: tenantB,
        claimId: claimA,
        format: 'generic_xlsx',
        generatedAt: null,
      }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db
        .update(claimSettlements)
        .set({ claimId: claimB })
        .where(eq(claimSettlements.id, claimSettlementA)),
      /belongs to another tenant/,
    )
  })

  // Migrations 0024/0025 (notifications): `messages` loses its any-member FOR ALL policy — under which a
  // shopkeeper token read every other shop's bill, proof-of-delivery and dues-reminder history in the
  // tenant — and gains a read scoped through retailer_links, staff writes, and one narrow shop write:
  // the read receipt on its own in-app / push notice (`messages.markRead`, docs/23 R12), whose column is
  // held by `dos_messages_guard()`. Inbound texts and the 24-hour windows go staff-only; a device token
  // is written by its own user or the worker; a broadcast is sent by the owner or the manager and read
  // by the money desk. One refusal per role on each.

  it('shows a shop only the messages addressed to its own shop, and lets it mark its own notice read and nothing else', async () => {
    const asShop = as('retailer')
    expect(
      (await asShop((tx) => tx.select({ id: messages.id }).from(messages))).map((m) => m.id).sort(),
    ).toEqual([messageA, noticeA].sort())
    // the other shop's token is the mirror image; neither sees the rep's staff-only push notice
    const asOtherShop = as('retailer', otherShopUser)
    expect(
      (await asOtherShop((tx) => tx.select({ id: messages.id }).from(messages))).map((m) => m.id),
    ).toEqual([messageB])
    // a shop never queues a message
    await rejectsWith(
      asShop((tx) =>
        tx.insert(messages).values({
          id: uuidv7(),
          tenantId: tenantA,
          channel: 'in_app',
          to: shopUser,
          recipientRetailerId: retailerA,
          payload: {},
          idempotencyKey: `shop-${run}`,
        }),
      ),
      /row-level security/,
    )
    // the read receipt on its own in-app notice: the one write it may make
    const readAt = new Date()
    const marked = await asShop((tx) =>
      tx
        .update(messages)
        .set({ readAt })
        .where(eq(messages.id, noticeA))
        .returning({ id: messages.id, readAt: messages.readAt }),
    )
    expect(marked).toHaveLength(1)
    expect(marked[0]?.readAt?.getTime()).toBe(readAt.getTime())
    // not on a WhatsApp row (read state comes from the provider): the update matches nothing
    expect(
      await asShop((tx) =>
        tx
          .update(messages)
          .set({ readAt })
          .where(eq(messages.id, messageA))
          .returning({ id: messages.id }),
      ),
    ).toHaveLength(0)
    // not on another shop's row
    expect(
      await asShop((tx) =>
        tx
          .update(messages)
          .set({ readAt })
          .where(eq(messages.id, messageB))
          .returning({ id: messages.id }),
      ),
    ).toHaveLength(0)
    // and never a column other than read_at, even on its own notice: the trigger refuses
    await rejectsWith(
      asShop((tx) =>
        tx.update(messages).set({ status: 'read', costPaise: 0 }).where(eq(messages.id, noticeA)),
      ),
      /marks its own notice read/,
    )
    await rejectsWith(
      asShop((tx) => tx.update(messages).set({ attempts: 99 }).where(eq(messages.id, noticeA))),
      /marks its own notice read/,
    )
    expect(
      await asShop((tx) =>
        tx.delete(messages).where(eq(messages.id, noticeA)).returning({ id: messages.id }),
      ),
    ).toHaveLength(0)
    const [notice] = await db.select().from(messages).where(eq(messages.id, noticeA))
    expect(notice?.status).toBe('delivered')
    expect(notice?.attempts).toBe(0)
    // the staff-only operational tables, the device list and the broadcast desk: not a row, not a write
    for (const table of [inboundMessages, whatsappWindows, pushTokens, broadcasts]) {
      expect(await asShop((tx) => tx.select().from(table))).toHaveLength(0)
    }
    await rejectsWith(
      asShop((tx) =>
        tx.insert(inboundMessages).values({
          id: uuidv7(),
          tenantId: tenantA,
          channel: 'whatsapp',
          from: `+91900${run}3`,
          body: 'sneaky',
        }),
      ),
      /row-level security/,
    )
    await rejectsWith(
      asShop((tx) =>
        tx.insert(pushTokens).values({
          id: uuidv7(),
          tenantId: tenantA,
          userId: shopUser,
          deviceId: `dev-shop-${run}`,
          token: 'x',
          platform: 'android',
        }),
      ),
      /row-level security/,
    )
    await rejectsWith(
      asShop((tx) =>
        tx.insert(broadcasts).values({
          id: uuidv7(),
          tenantId: tenantA,
          channel: 'sms',
          templateKey: 'scheme_announcement',
          createdBy: shopUser,
          totalRecipients: 0,
        }),
      ),
      /row-level security/,
    )
    expect(
      await asShop((tx) =>
        tx
          .update(inboundMessages)
          .set({ handled: true })
          .where(eq(inboundMessages.id, inboundA))
          .returning({ id: inboundMessages.id }),
      ),
    ).toHaveLength(0)
  })

  it('keeps a message what it was when it was queued: a correction is a fresh message', async () => {
    // the dispatch columns move (status, provider id, cost, attempts, next try) ...
    const dispatched = await as('owner')((tx) =>
      tx
        .update(messages)
        .set({ status: 'delivered', deliveredAt: new Date(), attempts: 1 })
        .where(eq(messages.id, messageA))
        .returning({ status: messages.status }),
    )
    expect(dispatched[0]?.status).toBe('delivered')
    // ... the message itself never does, for the owner, the worker, or the owner connection itself
    await rejectsWith(
      as('owner')((tx) =>
        tx
          .update(messages)
          .set({ to: `+91900${run}4` })
          .where(eq(messages.id, messageA)),
      ),
      /never change after insert/,
    )
    await rejectsWith(
      withTenant(db, { tenantId: tenantA, actorId: 'worker', actorRole: 'system' }, (tx) =>
        tx
          .update(messages)
          .set({ payload: { invoiceNo: 'X' } })
          .where(eq(messages.id, messageA)),
      ),
      /never change after insert/,
    )
    await rejectsWith(
      db.update(messages).set({ recipientRetailerId: retailerB }).where(eq(messages.id, messageA)),
      /never change after insert/,
    )
    await rejectsWith(
      db.update(messages).set({ templateKey: 'dues_reminder' }).where(eq(messages.id, messageA)),
      /never change after insert/,
    )
    await rejectsWith(
      db.update(messages).set({ attempts: -1 }).where(eq(messages.id, messageA)),
      /messages_attempts_nonnegative/,
    )
    const [row] = await db.select().from(messages).where(eq(messages.id, messageA))
    expect(row?.to).toBe(`+91900${run}3`)
    expect(row?.recipientRetailerId).toBe(retailerA)
    expect(row?.locale).toBe('en-IN')
  })

  it('keeps inbound texts and the 24-hour windows to staff, and the message log to staff plus the shop it names', async () => {
    for (const role of [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
    ] as const) {
      expect(
        (await as(role)((tx) => tx.select({ id: inboundMessages.id }).from(inboundMessages))).map(
          (m) => m.id,
        ),
        `${role} reads the inbound queue`,
      ).toContain(inboundA)
      expect(
        (await as(role)((tx) => tx.select().from(whatsappWindows))).map((w) => w.phone),
        `${role} reads the windows`,
      ).toContain(`+91900${run}3`)
      const seen = (await as(role)((tx) => tx.select({ id: messages.id }).from(messages))).map(
        (m) => m.id,
      )
      expect(seen, `${role} reads the whole log`).toEqual(
        expect.arrayContaining([messageA, messageB, noticeA, staffNotice]),
      )
    }
    // the rep marks the shop's text handled — its beat, its triage
    const handled = await as('salesperson')((tx) =>
      tx
        .update(inboundMessages)
        .set({ handled: true })
        .where(eq(inboundMessages.id, inboundA))
        .returning({ handled: inboundMessages.handled, body: inboundMessages.body }),
    )
    expect(handled[0]).toEqual({ handled: true, body: 'bhai 2 case cola kal' })
  })

  it('lets a staff member register only its own device and read the tenant’s list; not even the owner rewrites a co-worker’s token', async () => {
    const asRep = as('salesperson')
    expect(
      (await asRep((tx) => tx.select({ id: pushTokens.id }).from(pushTokens))).map((t) => t.id),
    ).toEqual(expect.arrayContaining([tokenRep, tokenDriver]))
    // its own device: register, refresh, forget
    const own = uuidv7()
    await asRep((tx) =>
      tx.insert(pushTokens).values({
        id: own,
        tenantId: tenantA,
        userId: rep,
        deviceId: `dev-rep-2-${run}`,
        token: `ExponentPushToken[rep-2-${run}]`,
        platform: 'ios',
      }),
    )
    expect(
      await asRep((tx) =>
        tx
          .update(pushTokens)
          .set({ token: `ExponentPushToken[rep-2-${run}-refreshed]`, lastSeenAt: new Date() })
          .where(eq(pushTokens.id, own))
          .returning({ id: pushTokens.id }),
      ),
    ).toHaveLength(1)
    expect(
      await asRep((tx) =>
        tx.delete(pushTokens).where(eq(pushTokens.id, own)).returning({ id: pushTokens.id }),
      ),
    ).toHaveLength(1)
    // never someone else's: a token for the driver is refused, the driver's row is untouchable
    await rejectsWith(
      asRep((tx) =>
        tx.insert(pushTokens).values({
          id: uuidv7(),
          tenantId: tenantA,
          userId: driver,
          deviceId: `dev-driver-2-${run}`,
          token: 'hijack',
          platform: 'android',
        }),
      ),
      /row-level security/,
    )
    // nor may it re-point its own row at someone else
    await rejectsWith(
      asRep((tx) =>
        tx.update(pushTokens).set({ userId: driver }).where(eq(pushTokens.id, tokenRep)),
      ),
      /row-level security/,
    )
    for (const role of ['owner', 'manager', 'accountant', 'salesperson', 'warehouse'] as const) {
      expect(
        await as(role)((tx) =>
          tx
            .update(pushTokens)
            .set({ token: `stolen-${role}` })
            .where(eq(pushTokens.id, tokenDriver))
            .returning({ id: pushTokens.id }),
        ),
        `${role} must not rewrite the driver's token`,
      ).toHaveLength(0)
      expect(
        await as(role)((tx) =>
          tx
            .delete(pushTokens)
            .where(eq(pushTokens.id, tokenDriver))
            .returning({ id: pushTokens.id }),
        ),
        `${role} must not remove the driver's token`,
      ).toHaveLength(0)
    }
    const [driverToken] = await db.select().from(pushTokens).where(eq(pushTokens.id, tokenDriver))
    expect(driverToken?.token).toBe(`ExponentPushToken[driver-${run}]`)
    // the worker (system) prunes a dead token
    expect(
      await withTenant(db, { tenantId: tenantA, actorId: 'worker', actorRole: 'system' }, (tx) =>
        tx
          .update(pushTokens)
          .set({ lastSeenAt: new Date() })
          .where(eq(pushTokens.id, tokenDriver))
          .returning({ id: pushTokens.id }),
      ),
    ).toHaveLength(1)
  })

  it('lets the owner or the manager send a broadcast, the accountant read the history, and the rep, the godown and the crew neither', async () => {
    for (const role of ['salesperson', 'warehouse', 'delivery'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(broadcasts)),
        `${role} must not read broadcasts`,
      ).toHaveLength(0)
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(broadcasts).values({
            id: uuidv7(),
            tenantId: tenantA,
            beatId: beatA,
            channel: 'sms',
            templateKey: 'scheme_announcement',
            createdBy: actorFor(role),
            totalRecipients: 0,
          }),
        ),
        /row-level security/,
      )
    }
    // the accountant reads the history and sends nothing (docs/22 §8 2026-09-05: reads, no decisions)
    expect(
      (await as('accountant')((tx) => tx.select({ id: broadcasts.id }).from(broadcasts))).map(
        (b) => b.id,
      ),
    ).toContain(broadcastA)
    await rejectsWith(
      as('accountant')((tx) =>
        tx.insert(broadcasts).values({
          id: uuidv7(),
          tenantId: tenantA,
          channel: 'sms',
          templateKey: 'scheme_announcement',
          createdBy: owner,
          totalRecipients: 0,
        }),
      ),
      /row-level security/,
    )
    expect(
      await as('accountant')((tx) =>
        tx
          .update(broadcasts)
          .set({ sentCount: 1 })
          .where(eq(broadcasts.id, broadcastA))
          .returning({ id: broadcasts.id }),
      ),
    ).toHaveLength(0)
    // the manager sends; the worker refreshes the counters, within the arithmetic
    const byManager = uuidv7()
    await as('manager')((tx) =>
      tx.insert(broadcasts).values({
        id: byManager,
        tenantId: tenantA,
        channel: 'in_app',
        templateKey: 'scheme_announcement',
        createdBy: manager,
        totalRecipients: 2,
        queuedCount: 2,
      }),
    )
    expect(
      await withTenant(db, { tenantId: tenantA, actorId: 'worker', actorRole: 'system' }, (tx) =>
        tx
          .update(broadcasts)
          .set({ queuedCount: 0, sentCount: 1, failedCount: 1 })
          .where(eq(broadcasts.id, byManager))
          .returning({ id: broadcasts.id }),
      ),
    ).toHaveLength(1)
    await rejectsWith(
      db.update(broadcasts).set({ sentCount: 5 }).where(eq(broadcasts.id, byManager)),
      /broadcasts_counts_within_total/,
    )
    await rejectsWith(
      db
        .update(broadcasts)
        .set({ failedCount: -1, sentCount: 0 })
        .where(eq(broadcasts.id, byManager)),
      /broadcasts_counts_nonnegative/,
    )
    // a broadcast is a message to shops: never push, never email
    await rejectsWith(
      as('owner')((tx) =>
        tx.insert(broadcasts).values({
          id: uuidv7(),
          tenantId: tenantA,
          channel: 'push',
          templateKey: 'scheme_announcement',
          createdBy: owner,
          totalRecipients: 0,
        }),
      ),
      /broadcasts_channel_for_shops/,
    )
  })

  it('keeps the message log and a broadcast’s beat inside the tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    for (const table of [messages, inboundMessages, whatsappWindows, pushTokens, broadcasts]) {
      expect(await asOtherTenant((tx) => tx.select().from(table))).toHaveLength(0)
    }
    // tenant B cannot announce to tenant A's beat: RLS hides the beat from app_rw, but a foreign-key
    // check bypasses row security, so the guard trigger is the rule — for the owner connection too
    await rejectsWith(
      asOtherTenant((tx) =>
        tx.insert(broadcasts).values({
          id: uuidv7(),
          tenantId: tenantB,
          beatId: beatA,
          channel: 'sms',
          templateKey: 'scheme_announcement',
          createdBy: owner,
          totalRecipients: 0,
        }),
      ),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.insert(broadcasts).values({
        id: uuidv7(),
        tenantId: tenantA,
        beatId: beatB,
        channel: 'sms',
        templateKey: 'scheme_announcement',
        createdBy: owner,
        totalRecipients: 0,
      }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.update(broadcasts).set({ beatId: beatB }).where(eq(broadcasts.id, broadcastA)),
      /belongs to another tenant/,
    )
  })

  // ---------------------------------------------------------------------------------------------
  // Reporting (0027/0028): the six rollup tables the owner's graphs read. The shop is a customer of the
  // distributorship, not a member of it — it never reads the tenant's day, another shop's habits or its
  // own series here (docs/plans/reporting.md §3 item 1, §4 rule 14); cost and margin stay with the back
  // office (docs/22 §9 never-list 1); the rep reads only its own field day.

  it('shows the distributorship’s day, every shop’s habits and each shop’s series to staff, and none of it to the shop', async () => {
    for (const role of [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
    ] as const) {
      const days = await as(role)((tx) =>
        tx.select().from(dailyTenantStats).where(eq(dailyTenantStats.day, statsDay)),
      )
      expect(
        days.map((d) => d.tenantId),
        `${role} reads the tenant's day`,
      ).toEqual([tenantA])
      expect(days[0]?.byBeat, `${role} reads the beat mix`).toEqual({
        [beatA]: { invoicedPaise: 118_000, invoiceCount: 1 },
      })
      expect(
        (await as(role)((tx) => tx.select().from(retailerBehaviour))).map((r) => r.retailerId),
        `${role} reads every shop's habits`,
      ).toEqual(expect.arrayContaining([retailerA, retailerB]))
      expect(
        (await as(role)((tx) => tx.select().from(dailyRetailerStats))).map((r) => r.retailerId),
        `${role} reads every shop's day rows`,
      ).toEqual(expect.arrayContaining([retailerA, retailerB]))
    }
    // the shop: not the tenant's day, not even its OWN habits or series — a shop never sees a report
    const asShop = as('retailer')
    expect(await asShop((tx) => tx.select().from(dailyTenantStats))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(retailerBehaviour))).toHaveLength(0)
    expect(await asShop((tx) => tx.select().from(dailyRetailerStats))).toHaveLength(0)
    await rejectsWith(
      asShop((tx) =>
        tx
          .insert(dailyTenantStats)
          .values({ tenantId: tenantA, day: '2026-09-02', ordersCount: 1 }),
      ),
      /row-level security/,
    )
    await rejectsWith(
      asShop((tx) =>
        tx
          .insert(retailerBehaviour)
          .values({ tenantId: tenantA, retailerId: retailerA, ordersLast30: 99 }),
      ),
      /row-level security/,
    )
    expect(
      await asShop((tx) =>
        tx
          .update(dailyRetailerStats)
          .set({ invoicedPaise: 1 })
          .where(eq(dailyRetailerStats.retailerId, retailerA))
          .returning({ retailerId: dailyRetailerStats.retailerId }),
      ),
    ).toHaveLength(0)
  })

  it('keeps the cost-bearing day series and the owner’s home row to the back office: not the rep, the godown, the crew or the shop', async () => {
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      const days = await as(role)((tx) =>
        tx.select().from(dailyOwnerStats).where(eq(dailyOwnerStats.day, statsDay)),
      )
      expect(
        days.map((d) => d.grossMarginPaise),
        `${role} reads the margin`,
      ).toEqual([28_000])
      expect(
        (await as(role)((tx) => tx.select().from(ownerSummary))).map((o) => o.mtdGrossMarginPaise),
        `${role} reads the home row`,
      ).toEqual([28_000])
    }
    for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(dailyOwnerStats)),
        `${role} reads no cost row`,
      ).toHaveLength(0)
      expect(
        await as(role)((tx) => tx.select().from(ownerSummary)),
        `${role} reads no home row`,
      ).toHaveLength(0)
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(dailyOwnerStats).values({ tenantId: tenantA, day: '2026-09-02' }),
        ),
        /row-level security/,
      )
      expect(
        await as(role)((tx) =>
          tx
            .update(dailyOwnerStats)
            .set({ cogsPaise: 0, grossMarginPaise: 296_000 })
            .where(eq(dailyOwnerStats.day, statsDay))
            .returning({ day: dailyOwnerStats.day }),
        ),
        `${role} rewrites no cost row`,
      ).toHaveLength(0)
    }
    // the arithmetic is a constraint, not service code: margin is net sales less cost, always
    await rejectsWith(
      db
        .insert(dailyOwnerStats)
        .values({ tenantId: tenantA, day: '2026-09-02', netSalesPaise: 100, cogsPaise: 90 }),
      /daily_owner_stats_margin_identity/,
    )
  })

  it('shows a rep only its own field day, the desk everyone’s, and lets nobody but the worker write one', async () => {
    const asRep = as('salesperson')
    const mine = await asRep((tx) =>
      tx.select().from(dailyRepStats).where(eq(dailyRepStats.day, statsDay)),
    )
    expect(mine.map((r) => r.userId)).toEqual([rep])
    // the index the cross-rep reads stand on leads with the tenant, then the day
    const [idx] = (
      await db.execute(
        sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'daily_rep_stats_day_idx'`,
      )
    ).rows as { indexdef: string }[]
    expect(idx?.indexdef).toContain('(tenant_id, day)')
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        (
          await as(role)((tx) =>
            tx.select().from(dailyRepStats).where(eq(dailyRepStats.day, statsDay)),
          )
        ).map((r) => r.userId),
        `${role} reads every rep's day`,
      ).toEqual(expect.arrayContaining([rep, owner]))
    }
    for (const role of ['owner', 'salesperson', 'retailer'] as const) {
      await rejectsWith(
        as(role)((tx) =>
          tx.insert(dailyRepStats).values({ tenantId: tenantA, userId: rep, day: '2026-09-02' }),
        ),
        /row-level security/,
      )
    }
    expect(
      await asRep((tx) =>
        tx
          .update(dailyRepStats)
          .set({ productiveVisits: 99 })
          .where(eq(dailyRepStats.userId, rep))
          .returning({ userId: dailyRepStats.userId }),
      ),
    ).toHaveLength(0)
    // the worker's rollup is the one writer
    const written = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'system' },
      (tx) =>
        tx
          .insert(dailyRepStats)
          .values({ tenantId: tenantA, userId: rep, day: '2026-09-02', visits: 3 })
          .onConflictDoUpdate({
            target: [dailyRepStats.tenantId, dailyRepStats.userId, dailyRepStats.day],
            set: { visits: 3 },
          })
          .returning({ day: dailyRepStats.day }),
    )
    expect(written).toEqual([{ day: '2026-09-02' }])
  })

  it('keeps the rollups inside the tenant, and a shop’s day row on a shop of its own tenant', async () => {
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)
    for (const table of [
      dailyTenantStats,
      dailyRepStats,
      dailyRetailerStats,
      dailyOwnerStats,
      retailerBehaviour,
      ownerSummary,
    ]) {
      expect(await asOtherTenant((tx) => tx.select().from(table))).toHaveLength(0)
    }
    // tenant B's owner cannot file a day row on tenant A's shop: RLS refuses the row (wrong tenant)
    await rejectsWith(
      asOtherTenant((tx) =>
        tx
          .insert(dailyRetailerStats)
          .values({ tenantId: tenantB, retailerId: retailerA, day: statsDay, ordersCount: 1 }),
      ),
      /belongs to another tenant/,
    )
    // and the owner connection (the worker's cross-tenant rollup, a seed) cannot either: a foreign-key
    // check bypasses row security, so the guard trigger is the rule
    await rejectsWith(
      db
        .insert(dailyRetailerStats)
        .values({ tenantId: tenantA, retailerId: retailerOfB, day: statsDay, ordersCount: 1 }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db.insert(retailerBehaviour).values({ tenantId: tenantA, retailerId: retailerOfB }),
      /belongs to another tenant/,
    )
    await rejectsWith(
      db
        .update(retailerBehaviour)
        .set({ retailerId: retailerOfB })
        .where(eq(retailerBehaviour.retailerId, retailerB)),
      /belongs to another tenant/,
    )
  })
  // ---------------------------------------------------------------------------------------------
  // Incentives (0029/0030): what a rep earns is the most personal number in the product. A rep sees
  // its OWN target, achievement and statement and never another rep's; the desk sees the team; the
  // godown and the shop see none of it. `computed_payouts` was FOR ALL over the back office alone, so
  // the rep the statement is ABOUT could not read the one screen it exists for (docs/23 S9, D12) —
  // 0029 splits that into an own-row SELECT and a back-office write set.

  it('shows a rep its own target, achievement and statement, and never another rep’s', async () => {
    const asRep = as('salesperson')
    expect(
      (await asRep((tx) => tx.select().from(targets))).map((t) => t.id).sort(),
      'the rep reads both of its own targets',
    ).toEqual([targetRepValue, targetRepVisits].sort())
    expect(
      (await asRep((tx) => tx.select().from(targets))).find((t) => t.id === targetRepVisits)
        ?.metric,
      'a beat-call target is storable: 0029 added the metric the founder asked for',
    ).toBe('visits')
    expect((await asRep((tx) => tx.select().from(achievements))).map((a) => a.id)).toEqual([
      achievementRep,
    ])
    expect(
      (await asRep((tx) => tx.select().from(computedPayouts))).map((p) => p.id),
      'the rep reads its own statement — the whole point of the 0029 split',
    ).toEqual([payoutRep])

    // the crew: its own van's numbers, never the second van's
    const asCrew = as('delivery')
    expect((await asCrew((tx) => tx.select().from(targets))).map((t) => t.id)).toEqual([
      targetDriver,
    ])
    expect((await asCrew((tx) => tx.select().from(achievements))).map((a) => a.id)).toEqual([
      achievementDriver,
    ])
    expect((await asCrew((tx) => tx.select().from(computedPayouts))).map((p) => p.id)).toEqual([
      payoutDriver,
    ])
    const asOtherCrew = as('delivery', otherDriver)
    expect((await asOtherCrew((tx) => tx.select().from(targets))).map((t) => t.id)).toEqual([
      targetOtherDriver,
    ])
    expect((await asOtherCrew((tx) => tx.select().from(computedPayouts))).map((p) => p.id)).toEqual(
      [payoutOtherDriver],
    )
    expect(
      await asOtherCrew((tx) => tx.select().from(achievements)),
      'the second van has no achievement row yet, and reads none of the first van’s',
    ).toHaveLength(0)

    // the desk sees the team
    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        (await as(role)((tx) => tx.select().from(targets))).length,
        `${role} reads every target`,
      ).toBe(4)
      expect(
        (await as(role)((tx) => tx.select().from(achievements))).length,
        `${role} reads every achievement`,
      ).toBe(2)
      expect(
        (await as(role)((tx) => tx.select().from(computedPayouts))).map((p) => p.id).sort(),
        `${role} reads the payout register`,
      ).toEqual([payoutRep, payoutDriver, payoutOtherDriver].sort())
    }

    // the godown does not run a beat and the shop is a customer: neither reaches this module at all
    for (const role of ['warehouse', 'retailer'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(targets)),
        `${role} reads no target`,
      ).toHaveLength(0)
      expect(
        await as(role)((tx) => tx.select().from(achievements)),
        `${role} reads no achievement`,
      ).toHaveLength(0)
      expect(
        await as(role)((tx) => tx.select().from(computedPayouts)),
        `${role} reads no statement`,
      ).toHaveLength(0)
    }
  })

  it('lets nobody but the desk write a statement, and nobody but the worker write the achievement cache', async () => {
    const payoutRow = (userId: string) => ({
      id: uuidv7(),
      tenantId: tenantA,
      userId,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      amountPaise: 9_999_900,
      breakdown: [],
    })
    // nobody raises their own payout: the read policy is SELECT only, so the own-row branch grants no write
    for (const [role, actor] of [
      ['salesperson', rep],
      ['delivery', driver],
      ['warehouse', storeKeeper],
      ['retailer', shopUser],
    ] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(computedPayouts).values(payoutRow(actor))),
        /row-level security/,
      )
    }
    expect(
      await as('salesperson')((tx) =>
        tx
          .update(computedPayouts)
          .set({ amountPaise: 9_999_900, approvedBy: rep, approvedAt: new Date() })
          .where(eq(computedPayouts.id, payoutRep))
          .returning({ id: computedPayouts.id }),
      ),
      'a rep may not approve, revalue or sign off its own statement',
    ).toHaveLength(0)
    expect(
      await as('delivery')((tx) =>
        tx
          .delete(computedPayouts)
          .where(eq(computedPayouts.id, payoutDriver))
          .returning({ id: computedPayouts.id }),
      ),
    ).toHaveLength(0)
    // the desk signs it off
    expect(
      await as('owner')((tx) =>
        tx
          .update(computedPayouts)
          .set({ approvedBy: owner, approvedAt: new Date() })
          .where(eq(computedPayouts.id, payoutRep))
          .returning({ id: computedPayouts.id }),
      ),
    ).toEqual([{ id: payoutRep }])

    // the achievement cache is the worker's: `targets.refresh` enqueues a job, it never writes here
    const achievementRow = () => ({
      id: uuidv7(),
      tenantId: tenantA,
      targetId: targetRepVisits,
      achievedValue: 240,
      achievedPct: 10_000,
    })
    for (const role of [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'delivery',
      'warehouse',
      'retailer',
    ] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(achievements).values(achievementRow())),
        /row-level security/,
      )
    }
    expect(
      await as('owner')((tx) =>
        tx
          .update(achievements)
          .set({ achievedPct: 10_000 })
          .where(eq(achievements.id, achievementRep))
          .returning({ id: achievements.id }),
      ),
      'not even the owner nudges an achievement: it is a computed cache, not a decision',
    ).toHaveLength(0)
    const swept = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'system' },
      (tx) =>
        tx
          .insert(achievements)
          .values(achievementRow())
          .onConflictDoUpdate({
            target: [achievements.tenantId, achievements.targetId],
            set: { achievedPct: 10_000 },
          })
          .returning({ targetId: achievements.targetId }),
    )
    expect(swept, 'the hourly sweep is the one writer').toEqual([{ targetId: targetRepVisits }])
  })

  it('lets only the owner assign a target: the manager and the accountant read the team and set nothing', async () => {
    const targetRow = () => ({
      id: uuidv7(),
      tenantId: tenantA,
      userId: rep,
      metric: 'value' as const,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      targetValue: 10_000_000,
      payoutRule: [{ fromPct: 10_000, flatPaise: 100_000 }],
      createdBy: owner,
    })
    for (const role of [
      'manager',
      'accountant',
      'salesperson',
      'delivery',
      'warehouse',
      'retailer',
    ] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(targets).values(targetRow())),
        /row-level security/,
      )
    }
    expect(
      await as('manager')((tx) =>
        tx
          .update(targets)
          .set({ targetValue: 1 })
          .where(eq(targets.id, targetRepValue))
          .returning({ id: targets.id }),
      ),
      'a manager sees the whole team and changes nobody’s target (docs/17 §7 question 20)',
    ).toHaveLength(0)
    expect(
      await as('salesperson')((tx) =>
        tx
          .update(targets)
          .set({ targetValue: 1 })
          .where(eq(targets.id, targetRepValue))
          .returning({ id: targets.id }),
      ),
      'nor does the rep lower its own',
    ).toHaveLength(0)
    const mine = targetRow()
    expect(
      await as('owner')((tx) => tx.insert(targets).values(mine).returning({ id: targets.id })),
    ).toEqual([{ id: mine.id }])
    await as('owner')((tx) => tx.delete(targets).where(eq(targets.id, mine.id)))
  })

  it('keeps an incentive row on a person of this distributorship, and an achievement on a target of its own tenant', async () => {
    // `users` is global (one identity across every distributor, ADR 0006), so the foreign key says
    // nothing about tenancy and a foreign-key check bypasses row security: the guard is the rule, and
    // it binds the owner connection the cross-tenant sweep and the seeds run on.
    await rejectsWith(
      db.insert(targets).values({
        id: uuidv7(),
        tenantId: tenantA,
        userId: outsider,
        metric: 'value',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 1_000_000,
        payoutRule: [],
      }),
      /is not a member of this distributorship/,
    )
    await rejectsWith(
      db.insert(targets).values({
        id: uuidv7(),
        tenantId: tenantA,
        userId: rep,
        metric: 'value',
        periodFrom: incentiveFrom,
        periodTo: incentiveTo,
        targetValue: 1_000_000,
        payoutRule: [],
        createdBy: outsider,
      }),
      /targets\.created_by/,
    )
    await rejectsWith(
      db.insert(computedPayouts).values({
        id: uuidv7(),
        tenantId: tenantA,
        userId: outsider,
        periodFrom: closedFrom,
        periodTo: closedTo,
        amountPaise: 100,
        breakdown: [],
      }),
      /is not a member of this distributorship/,
    )
    await rejectsWith(
      db
        .update(computedPayouts)
        .set({ approvedBy: outsider })
        .where(eq(computedPayouts.id, payoutRep)),
      /computed_payouts\.approved_by/,
    )
    await rejectsWith(
      db.insert(achievements).values({
        id: uuidv7(),
        tenantId: tenantB,
        targetId: targetRepValue,
        achievedValue: 1,
        achievedPct: 1,
      }),
      /belongs to another tenant/,
    )

    // tenant isolation: tenant B's owner reads none of it, and cannot file a row under tenant A
    const asOtherTenant = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, fn)
    for (const table of [targets, achievements, computedPayouts]) {
      expect(await asOtherTenant((tx) => tx.select().from(table))).toHaveLength(0)
    }
    await rejectsWith(
      asOtherTenant((tx) =>
        tx.insert(targets).values({
          id: uuidv7(),
          tenantId: tenantA,
          userId: rep,
          metric: 'value',
          periodFrom: incentiveFrom,
          periodTo: incentiveTo,
          targetValue: 1,
          payoutRule: [],
        }),
      ),
      /row-level security/,
    )

    // the tenant-wide reads (the owner's target list, the team leaderboard) have an index that leads
    // with the tenant; `targets_user_period_idx` leads with the user and cannot serve them
    const [idx] = (
      await db.execute(
        sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'targets_tenant_period_idx'`,
      )
    ).rows as { indexdef: string }[]
    expect(idx?.indexdef).toContain('(tenant_id, period_from, period_to)')
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0031/0032 (ai). The founder put every AI feature in v1 (docs/22 §8, 2026-09-05): a
  // shop's WhatsApp sentence or a rep's spoken one becomes a DRAFT order a human always confirms, the
  // ledger becomes a reorder suggestion, and a trip's stops get a proposed sequence the driver may
  // override. Three tables, three different populations, and the database is what keeps them apart.

  it('shows an order draft to the desk, to the rep whose beat the shop is on and to the shop itself, and to nobody else', async () => {
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()
    const all = [draftShopA, draftRepVoice, draftShopB, draftUnmatched].sort()

    for (const role of ['owner', 'manager', 'accountant'] as const) {
      expect(
        ids(await as(role)((tx) => tx.select().from(aiOrderDrafts))),
        `${role} reads every draft of the distributorship`,
      ).toEqual(all)
    }

    // The rep works beat A, and shop A is on it: it reads shop A's WhatsApp draft and the voice order
    // it recorded itself. Shop B is on no beat, and the unmatched draft names no shop at all — both
    // belong to the desk until someone puts a shop on them.
    expect(ids(await as('salesperson')((tx) => tx.select().from(aiOrderDrafts)))).toEqual(
      [draftShopA, draftRepVoice].sort(),
    )

    // The shop reads its own words and no other shop's.
    expect(ids(await as('retailer')((tx) => tx.select().from(aiOrderDrafts)))).toEqual(
      [draftShopA, draftRepVoice].sort(),
    )
    expect(
      ids(await as('retailer', otherShopUser)((tx) => tx.select().from(aiOrderDrafts))),
    ).toEqual([draftShopB])

    // The godown and the crew take no orders: neither sees a single draft.
    for (const role of ['warehouse', 'delivery'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(aiOrderDrafts)),
        `${role} reads no draft`,
      ).toHaveLength(0)
    }

    // Tenant isolation, asserted at the database and not at the guard.
    expect(
      await withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, (tx) =>
        tx.select().from(aiOrderDrafts),
      ),
    ).toHaveLength(0)
  })

  it('lets a rep or a shop file only a draft it could read back, and refuses the godown, the crew and every delete', async () => {
    const draft = (over: Record<string, unknown>) => ({
      id: uuidv7(),
      tenantId: tenantA,
      source: 'text' as const,
      parsedLines: [],
      idempotencyKey: uuidv7(),
      ...over,
    })

    // the rep captures for a shop on its own beat, naming itself
    const mine = draft({ retailerId: retailerA, createdBy: rep })
    expect(
      await as('salesperson')((tx) =>
        tx.insert(aiOrderDrafts).values(mine).returning({ id: aiOrderDrafts.id }),
      ),
      'INSERT … RETURNING needs the row to pass the SELECT policy too',
    ).toEqual([{ id: mine.id }])

    // A rep may walk into any shop and take an order there — beats are a plan, not a fence, and
    // `orders.create` is not beat-scoped either — so its OWN capture for a shop off its beat is a row
    // it may file and read back. What the beat decides is what it sees WITHOUT having created it.
    const offBeat = draft({ retailerId: retailerB, createdBy: rep })
    expect(
      await as('salesperson')((tx) =>
        tx.insert(aiOrderDrafts).values(offBeat).returning({ id: aiOrderDrafts.id }),
      ),
    ).toEqual([{ id: offBeat.id }])
    // ...but it never files one in nobody's name for a shop that is not on its beat, which is how a
    // rep would otherwise plant a row on another rep's shop and read it back
    await rejectsWith(
      as('salesperson')((tx) => tx.insert(aiOrderDrafts).values(draft({ retailerId: retailerB }))),
      /row-level security/,
    )
    await rejectsWith(
      as('salesperson')((tx) =>
        tx.insert(aiOrderDrafts).values(draft({ retailerId: retailerB, createdBy: manager })),
      ),
      /row-level security/,
    )
    await db.delete(aiOrderDrafts).where(eq(aiOrderDrafts.id, offBeat.id))

    // the shop files for itself and never for the shop next door
    const ours = draft({ retailerId: retailerA, source: 'text' as const })
    expect(
      await as('retailer')((tx) =>
        tx.insert(aiOrderDrafts).values(ours).returning({ id: aiOrderDrafts.id }),
      ),
    ).toEqual([{ id: ours.id }])
    await rejectsWith(
      as('retailer')((tx) => tx.insert(aiOrderDrafts).values(draft({ retailerId: retailerB }))),
      /row-level security/,
    )

    // the godown and the crew write none
    for (const role of ['warehouse', 'delivery'] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(aiOrderDrafts).values(draft({ retailerId: retailerA }))),
        /row-level security/,
      )
    }

    // a rep cannot edit a draft of another beat, and cannot see it to try
    expect(
      await as('salesperson')((tx) =>
        tx
          .update(aiOrderDrafts)
          .set({ status: 'rejected' })
          .where(eq(aiOrderDrafts.id, draftShopB))
          .returning({ id: aiOrderDrafts.id }),
      ),
    ).toHaveLength(0)

    // a draft is rejected with a reason, never erased: nobody holds a DELETE policy, the owner included
    for (const role of ['owner', 'manager', 'salesperson', 'retailer'] as const) {
      expect(
        await as(role)((tx) =>
          tx
            .delete(aiOrderDrafts)
            .where(eq(aiOrderDrafts.id, mine.id))
            .returning({ id: aiOrderDrafts.id }),
        ),
        `${role} deletes no draft`,
      ).toHaveLength(0)
    }
    await db.delete(aiOrderDrafts).where(eq(aiOrderDrafts.id, mine.id))
    await db.delete(aiOrderDrafts).where(eq(aiOrderDrafts.id, ours.id))
  })

  it('never lets a parsed draft become an order without a person on it, and never under another distributorship', async () => {
    const scratch = uuidv7()
    await db.insert(aiOrderDrafts).values({
      id: scratch,
      tenantId: tenantA,
      source: 'whatsapp',
      retailerId: retailerA,
      rawText: '2 case cola',
      parsedLines: [],
      status: 'needs_review',
      idempotencyKey: `ai-draft-scratch-${run}`,
    })
    const confirm = (over: Record<string, unknown>) =>
      as('manager')((tx) =>
        tx
          .update(aiOrderDrafts)
          .set({ status: 'confirmed', ...over })
          .where(eq(aiOrderDrafts.id, scratch)),
      )

    await rejectsWith(confirm({}), /must name who reviewed it/)
    await rejectsWith(
      confirm({ reviewedBy: manager, reviewedAt: new Date() }),
      /must point at the order it created/,
    )
    // the parser is never the reviewer: an actor whose role is `system` cannot confirm at all
    await rejectsWith(
      withTenant(db, { tenantId: tenantA, actorId: manager, actorRole: 'system' }, (tx) =>
        tx
          .update(aiOrderDrafts)
          .set({
            status: 'confirmed',
            reviewedBy: manager,
            reviewedAt: new Date(),
            createdOrderId: orderA,
          })
          .where(eq(aiOrderDrafts.id, scratch)),
      ),
      /never confirms its own draft/,
    )
    // a rejection carries the reason the reviewer gave
    await rejectsWith(
      as('manager')((tx) =>
        tx
          .update(aiOrderDrafts)
          .set({ status: 'rejected', reviewedBy: manager, reviewedAt: new Date() })
          .where(eq(aiOrderDrafts.id, scratch)),
      ),
      /must carry the reason/,
    )
    // ...and the whole thing works when a person actually did it
    expect(
      await as('manager')((tx) =>
        tx
          .update(aiOrderDrafts)
          .set({
            status: 'confirmed',
            reviewedBy: manager,
            reviewedAt: new Date(),
            createdOrderId: orderA,
          })
          .where(eq(aiOrderDrafts.id, scratch))
          .returning({ id: aiOrderDrafts.id }),
      ),
    ).toEqual([{ id: scratch }])

    // `users`, `retailers` and `sales_orders` are reached by foreign keys that prove nothing about
    // tenancy (and an FK check bypasses row security), so the guard binds even the owner connection
    // the worker and the seeds run on.
    await rejectsWith(
      db.insert(aiOrderDrafts).values({
        id: uuidv7(),
        tenantId: tenantA,
        source: 'whatsapp',
        retailerId: retailerOfB,
        parsedLines: [],
        idempotencyKey: uuidv7(),
      }),
      /shop .* belongs to another distributorship/,
    )
    await rejectsWith(
      db.insert(aiOrderDrafts).values({
        id: uuidv7(),
        tenantId: tenantA,
        source: 'text',
        retailerId: retailerA,
        createdBy: outsider,
        parsedLines: [],
        idempotencyKey: uuidv7(),
      }),
      /created_by: user .* is not a member/,
    )

    // an offline replay of the same capture is a no-op, not a second draft
    await rejectsWith(
      db.insert(aiOrderDrafts).values({
        id: uuidv7(),
        tenantId: tenantA,
        source: 'whatsapp',
        retailerId: retailerA,
        parsedLines: [],
        idempotencyKey: `ai-draft-scratch-${run}`,
      }),
      /ai_order_drafts_idempotency_idx/,
    )
    // ...and one inbound message is parsed once, however often the relay retries it
    await rejectsWith(
      db.insert(aiOrderDrafts).values({
        id: uuidv7(),
        tenantId: tenantA,
        source: 'whatsapp',
        retailerId: retailerA,
        inboundMessageId: inboundA,
        parsedLines: [],
        idempotencyKey: uuidv7(),
      }),
      /ai_order_drafts_inbound_idx/,
    )

    await db.delete(aiOrderDrafts).where(eq(aiOrderDrafts.id, scratch))
  })

  it('keeps a demand forecast to the desk and the godown, writable by the worker alone', async () => {
    for (const role of ['owner', 'manager', 'accountant', 'warehouse'] as const) {
      expect(
        (await as(role)((tx) => tx.select().from(aiForecasts))).map((f) => f.id),
        `${role} reads the buying plan`,
      ).toEqual([forecastA])
    }
    // A forecast says what the distributor is about to buy: the field does not need it and the shop
    // must never learn it (docs/22 §9 never-list 1 in its planning form).
    for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(aiForecasts)),
        `${role} reads no forecast`,
      ).toHaveLength(0)
    }

    const row = () => ({
      id: uuidv7(),
      tenantId: tenantA,
      variantId: variant,
      locationId: godownA,
      horizonDays: 14,
      expectedQtyPcs: 200,
      reorderQtyPcs: 90,
      onHandPcs: 120,
      daysCover: 8,
      method: 'moving_average_28',
      confidenceBps: 6_000,
    })
    // Nobody edits a computed number by hand — not even the owner. The request enqueues a job instead.
    for (const role of ['owner', 'manager', 'accountant', 'warehouse', 'salesperson'] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(aiForecasts).values(row())),
        /row-level security/,
      )
    }
    expect(
      await as('owner')((tx) =>
        tx
          .update(aiForecasts)
          .set({ reorderQtyPcs: 1 })
          .where(eq(aiForecasts.id, forecastA))
          .returning({ id: aiForecasts.id }),
      ),
      'not even the owner nudges a forecast',
    ).toHaveLength(0)

    // the sweep rewrites in place, keyed by (tenant, variant, location, horizon), so a retry is a no-op
    const swept = await withTenant(
      db,
      { tenantId: tenantA, actorId: owner, actorRole: 'system' },
      (tx) =>
        tx
          .insert(aiForecasts)
          .values({ ...row(), horizonDays: 7 })
          .onConflictDoUpdate({
            target: [
              aiForecasts.tenantId,
              aiForecasts.variantId,
              aiForecasts.locationId,
              aiForecasts.horizonDays,
            ],
            set: { reorderQtyPcs: 72, computedAt: new Date() },
          })
          .returning({ id: aiForecasts.id }),
    )
    expect(swept, 'the worker sweep is the one writer, and it upserts').toEqual([{ id: forecastA }])

    // the cross-tenant sweep cannot file another distributorship's godown here
    await rejectsWith(
      db.insert(aiForecasts).values({ ...row(), locationId: godownB }),
      /location .* belongs to another distributorship/,
    )
    await withTenant(db, { tenantId: tenantA, actorId: owner, actorRole: 'system' }, (tx) =>
      tx.update(aiForecasts).set({ reorderQtyPcs: 48 }).where(eq(aiForecasts.id, forecastA)),
    )
  })

  it('lets the crew read and APPLY the route of its own trip, and never rewrite the one the desk computed', async () => {
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()
    // The desk AND THE GODOWN read every plan: `ai.routing.get` is granted to `warehouse` by the
    // permission matrix, because the van is loaded in the order it will be emptied. Migration 0035
    // widened `route_plans_read` to say the same thing — before it, that screen answered `item: null`
    // for ever, which is a refusal nobody can see.
    for (const role of ['owner', 'manager', 'accountant', 'warehouse'] as const) {
      expect(
        ids(await as(role)((tx) => tx.select().from(routePlans))),
        `${role} sees the board`,
      ).toEqual([routePlanA, routePlanB].sort())
    }
    // A route names every shop on the van and the hour their goods are on it: a rep and a shop read
    // none, and each crew reads only the trip it is on.
    for (const role of ['salesperson', 'retailer'] as const) {
      expect(
        await as(role)((tx) => tx.select().from(routePlans)),
        `${role} reads no route plan`,
      ).toHaveLength(0)
    }
    expect(ids(await as('delivery')((tx) => tx.select().from(routePlans)))).toEqual([routePlanA])
    expect(ids(await as('delivery', otherDriver)((tx) => tx.select().from(routePlans)))).toEqual([
      routePlanB,
    ])

    const planRow = (over: Record<string, unknown> = {}) => ({
      id: uuidv7(),
      tenantId: tenantA,
      tripId: tripA,
      method: 'manual' as const,
      sequence: [],
      ...over,
    })
    // Planning is an operational decision: the accountant is a money desk (docs/22 §8, 2026-09-05),
    // the godown loads what it is told, and the field takes orders.
    for (const role of ['accountant', 'warehouse', 'salesperson', 'retailer'] as const) {
      await rejectsWith(
        as(role)((tx) => tx.insert(routePlans).values(planRow())),
        /row-level security/,
      )
    }
    // The CREW OF THIS TRIP may ask the solver for a better round — `ai.routing.plan` is granted to
    // `delivery`, and migration 0035 gave `route_plans_insert` the same crew-of-this-trip branch the
    // read and update policies already carried, so `RoutingService.plan` writes the row as the driver
    // instead of escalating to `system`. A driver on ANOTHER trip is still refused, by the policy.
    expect(
      await as('delivery')((tx) =>
        tx.insert(routePlans).values(planRow()).returning({ id: routePlans.id }),
      ),
    ).toHaveLength(1)
    await rejectsWith(
      as('delivery', otherDriver)((tx) => tx.insert(routePlans).values(planRow())),
      /row-level security/,
    )

    // the crew applies its own plan, as itself
    expect(
      await as('delivery')((tx) =>
        tx
          .update(routePlans)
          .set({ appliedAt: new Date(), appliedBy: driver, overridden: false })
          .where(eq(routePlans.id, routePlanA))
          .returning({ id: routePlans.id }),
      ),
    ).toEqual([{ id: routePlanA }])
    // ...and may say it went its own way, which is the driver's right
    expect(
      await as('delivery')((tx) =>
        tx
          .update(routePlans)
          .set({ overridden: true })
          .where(eq(routePlans.id, routePlanA))
          .returning({ id: routePlans.id }),
      ),
    ).toEqual([{ id: routePlanA }])
    // ...but never rewrites the sequence, the distance or the method and passes it off as the plan
    await rejectsWith(
      as('delivery')((tx) =>
        tx
          .update(routePlans)
          .set({ sequence: [{ stopId: stopB, seq: 1, etaAt: null, distanceM: 0 }] })
          .where(eq(routePlans.id, routePlanA)),
      ),
      /never rewrite the one the desk computed/,
    )
    await rejectsWith(
      as('delivery')((tx) =>
        tx.update(routePlans).set({ totalDistanceM: 1 }).where(eq(routePlans.id, routePlanA)),
      ),
      /never rewrite the one the desk computed/,
    )
    // ...and applies as themselves, never in the other crew's name
    await rejectsWith(
      as('delivery')((tx) =>
        tx.update(routePlans).set({ appliedBy: otherDriver }).where(eq(routePlans.id, routePlanA)),
      ),
      /applies a plan as themselves/,
    )
    // the other crew cannot even see this trip's plan to touch it
    expect(
      await as(
        'delivery',
        otherDriver,
      )((tx) =>
        tx
          .update(routePlans)
          .set({ overridden: true })
          .where(eq(routePlans.id, routePlanA))
          .returning({ id: routePlans.id }),
      ),
    ).toHaveLength(0)

    // a trip runs one route: a second applied plan on the same trip is refused by the partial unique
    const second = planRow()
    await as('manager')((tx) => tx.insert(routePlans).values(second))
    await rejectsWith(
      as('manager')((tx) =>
        tx
          .update(routePlans)
          .set({ appliedAt: new Date(), appliedBy: manager })
          .where(eq(routePlans.id, second.id)),
      ),
      /route_plans_applied_idx/,
    )
    // a plan is superseded, never erased: no DELETE policy, the owner included
    expect(
      await as('owner')((tx) =>
        tx.delete(routePlans).where(eq(routePlans.id, second.id)).returning({ id: routePlans.id }),
      ),
    ).toHaveLength(0)
    await db.delete(routePlans).where(eq(routePlans.id, second.id))

    // the trip is a trip of this distributorship, whatever the foreign key says
    await rejectsWith(
      db.insert(routePlans).values({ ...planRow(), tenantId: tenantB }),
      /trip .* belongs to another distributorship/,
    )
    expect(
      await withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, (tx) =>
        tx.select().from(routePlans),
      ),
    ).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0033/0034 — module 13, the platform console (founder decision 2026-09-05, docs/22 §2 row 7
  // and §8: "organisation onboarding, plans and subscription state, support-access grants — time-boxed,
  // owner-approved, audited"). Four GLOBAL tables, the only business tables in the product that carry no
  // tenant predicate at all: they are reached by ACTOR ROLE alone, because a platform admin holds no
  // membership anywhere. So the refusals below are the ones that matter — a distributor's owner, manager
  // and accountant must not read who our staff are, what anybody pays, or what we did; and our own staff
  // must not be able to let themselves into a customer's data without that customer's owner saying yes.

  describe('the platform console (module 13)', () => {
    const platformSuper = uuidv7()
    const platformSupport = uuidv7()
    const adminSuperRow = uuidv7()
    const adminSupportRow = uuidv7()
    const subscriptionA = uuidv7()
    const subscriptionB = uuidv7()
    /** Tenant A: one grant its owner already approved, one still waiting. Tenant B: one of its own. */
    const grantA = uuidv7()
    const grantPending = uuidv7()
    const grantB = uuidv7()
    const auditA = uuidv7()

    const days = (n: number) => new Date(Date.now() + n * 86_400_000)

    /**
     * The console's own actor: `platform_admin` is a value of `ActorRole` and NOT of `membership_role`,
     * so no tenant sign-in can ever produce it. `tenantId` is whatever tenant the console is looking at;
     * none of the four tables' policies compare it, which is exactly what makes them global.
     */
    const asPlatform =
      (actorId: string = platformSuper, tenantId: string = tenantA) =>
      <T>(fn: (tx: Db) => Promise<T>) =>
        withTenant(db, { tenantId, actorId, actorRole: 'platform_admin' }, fn)

    const TENANT_ROLES = [
      'owner',
      'manager',
      'accountant',
      'salesperson',
      'warehouse',
      'delivery',
      'retailer',
    ] as const

    beforeAll(async () => {
      await db.insert(users).values([
        { id: platformSuper, phone: `+91902${run}1`, name: 'Platform super' },
        { id: platformSupport, phone: `+91902${run}2`, name: 'Platform support' },
      ])
      // The founding row is written by the migrating connection, which has no app.actor_role: that is
      // the only way a first administrator can exist (0034 §2).
      await db.insert(platformAdmins).values([
        { id: adminSuperRow, userId: platformSuper, role: 'super' },
        {
          id: adminSupportRow,
          userId: platformSupport,
          role: 'support',
          createdBy: platformSuper,
        },
      ])
      await db.insert(subscriptions).values([
        {
          id: subscriptionA,
          tenantId: tenantA,
          plan: 'standard',
          status: 'active',
          periodStart: '2026-09-01',
          periodEnd: '2027-08-31',
          seats: 12,
          pricePaiseMonth: 250_000,
          updatedBy: platformSuper,
        },
        {
          id: subscriptionB,
          tenantId: tenantB,
          plan: 'pro',
          status: 'trial',
          trialEndsAt: days(21),
          seats: 4,
        },
      ])
      await db.insert(supportGrants).values([
        {
          id: grantA,
          tenantId: tenantA,
          adminUserId: platformSupport,
          reason: 'invoice numbering ticket',
          expiresAt: days(3),
          approvedBy: owner,
          approvedAt: new Date(),
          scope: 'read',
        },
        {
          id: grantPending,
          tenantId: tenantA,
          adminUserId: platformSupport,
          reason: 'stock ledger correction, waiting for the owner',
          expiresAt: days(5),
          scope: 'read_write',
        },
        {
          id: grantB,
          tenantId: tenantB,
          adminUserId: platformSupport,
          reason: 'another distributorship entirely',
          expiresAt: days(5),
        },
      ])
      await db.insert(platformAudit).values({
        id: auditA,
        adminUserId: platformSupport,
        action: 'support.requested',
        tenantId: tenantA,
        payload: { grantId: grantA },
      })
    })

    it('keeps the console to Distribution OS staff: no distributor role reads an administrator, a subscription or our trail', async () => {
      for (const role of TENANT_ROLES) {
        expect(
          await as(role)((tx) => tx.select().from(subscriptions)),
          `${role} reads no subscription`,
        ).toHaveLength(0)
        expect(
          await as(role)((tx) => tx.select().from(platformAdmins)),
          `${role} reads no console account`,
        ).toHaveLength(0)
        expect(
          await as(role)((tx) => tx.select().from(platformAudit)),
          `${role} reads no platform audit row`,
        ).toHaveLength(0)
      }
      // An owner never learns what ANOTHER distributor pays — nor what its own does: the console
      // records revenue, the owner app has no billing screen (docs/22 §8, docs/25 P2-22). If a "your
      // plan" card is ever wanted, it is one narrow own-tenant SELECT policy, added deliberately.
      expect(
        await withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, (tx) =>
          tx.select().from(subscriptions),
        ),
        'the owner of another distributorship reads no subscription either',
      ).toHaveLength(0)
      await rejectsWith(
        as('owner')((tx) =>
          tx
            .insert(subscriptions)
            .values({ id: uuidv7(), tenantId: tenantA, plan: 'pro', status: 'active' }),
        ),
        /row-level security/,
      )
      expect(
        await as('owner')((tx) =>
          tx
            .update(subscriptions)
            .set({ seats: 999 })
            .where(eq(subscriptions.id, subscriptionA))
            .returning({ id: subscriptions.id }),
        ),
        'nor does an owner give itself more seats',
      ).toHaveLength(0)
      // ...and our own staff read every distributor's row, which is the whole job of the console
      expect(
        (
          await asPlatform()((tx) =>
            tx
              .select()
              .from(subscriptions)
              .where(inArray(subscriptions.tenantId, [tenantA, tenantB])),
          )
        )
          .map((s) => s.id)
          .sort(),
      ).toEqual([subscriptionA, subscriptionB].sort())
    })

    /**
     * Migration 0039. The console's mutations carry an `idempotencyKey` like every other mutation in
     * the product, so they have to write `idempotency_keys` — a TENANT table, whose original policy
     * compares `tenant_id` to `app.tenant_id`, which a console session leaves empty. The three
     * platform policies added there are what let module 13 stay under RLS instead of running its
     * writes as `app_worker` to buy one row.
     *
     * What they widen is WHO may write a key, never WHAT the key may be: the row still points at a
     * real distributor (foreign-keyed to `tenants`) and holds a request hash and the console's own
     * reply. This case pins both halves — the console can file one, and it still reads nothing of the
     * distributor's business through the same session.
     */
    it('lets the console file an idempotency key against a distributor, and still read none of its rows', async () => {
      const key = `console-${run}`
      // THE REAL CONSOLE CONTEXT: `app.tenant_id` is the EMPTY STRING. `withPlatform()` in
      // `@dos/core` (`modules/platform-admin/internals.ts`, `PLATFORM_SCOPE`) sets it that way on
      // purpose, and this test uses the same thing rather than the block's default helper — because
      // the empty string is not cosmetic. Most tenant tables carry `tenantPolicy`, which has no role
      // predicate at all: it compares `tenant_id` to `app.tenant_id` and nothing else. A console
      // session that put a real distributor's id there would read that distributor's shops. It never
      // does, and the assertions below are what stops that from being reintroduced.
      const asConsole = asPlatform(platformSuper, '')
      await asConsole((tx) =>
        tx
          .insert(idempotencyKeys)
          // `platform_scoped`, exactly as `platformIdempotent()` writes it (@dos/core): it is what
          // keeps the STORED REPLY — our price to this distributor, among other things — out of the
          // distributor's own reach through a table it otherwise reads by tenant alone.
          .values({ tenantId: tenantA, key, requestHash: 'hash', platformScoped: true })
          .onConflictDoNothing(),
      )
      expect(
        (await asConsole((tx) => tx.select().from(idempotencyKeys))).some((r) => r.key === key),
        'the console reads back the key it wrote',
      ).toBe(true)
      expect(
        await asConsole((tx) => tx.select().from(retailers)),
        'a console session reads no shop',
      ).toHaveLength(0)
      expect(
        await asConsole((tx) => tx.select().from(salesOrders)),
        'a console session reads no order',
      ).toHaveLength(0)
      expect(
        await asConsole((tx) => tx.select().from(invoices)),
        'a console session reads no invoice',
      ).toHaveLength(0)
      // ...and its OWN four tables still answer, which is what makes the empty tenant workable: they
      // key on the actor's role and carry no tenant predicate at all.
      expect(
        (await asConsole((tx) => tx.select().from(subscriptions))).length,
        'the console still reads its own tables with no tenant of its own',
      ).toBeGreaterThan(0)
      // ...and a distributor's own staff still cannot see the console's keys through the widened
      // policy: it is keyed on the ACTOR ROLE, and no membership role holds it.
      expect(
        (await as('owner')((tx) => tx.select().from(idempotencyKeys))).some((r) => r.key === key),
        'the owner does not read the console key filed against its own tenant',
      ).toBe(false)
    })

    it('shows a distributor its own support grants and no other, and lets its owner approve or revoke but never rewrite one', async () => {
      expect(
        (await as('owner')((tx) => tx.select().from(supportGrants))).map((g) => g.id).sort(),
        'the owner sees every request against its own distributorship',
      ).toEqual([grantA, grantPending].sort())
      // Answering a support request is the owner's own decision: not the manager's, not the money
      // desk's (docs/22 §8, accountant scope 2026-09-05), and certainly not the field's.
      for (const role of [
        'manager',
        'accountant',
        'salesperson',
        'warehouse',
        'delivery',
        'retailer',
      ] as const) {
        expect(
          await as(role)((tx) => tx.select().from(supportGrants)),
          `${role} reads no support grant`,
        ).toHaveLength(0)
      }
      expect(
        (
          await withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, (tx) =>
            tx.select().from(supportGrants),
          )
        ).map((g) => g.id),
        'another distributorship sees only its own',
      ).toEqual([grantB])

      // the owner approves, under its own name
      expect(
        await as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ approvedBy: owner, approvedAt: new Date(), updatedAt: new Date() })
            .where(eq(supportGrants.id, grantPending))
            .returning({ id: supportGrants.id }),
        ),
      ).toEqual([{ id: grantPending }])
      // ...and may not re-scope it, push the window out, or rewrite the reason we gave
      await rejectsWith(
        as('owner')((tx) =>
          tx.update(supportGrants).set({ scope: 'read' }).where(eq(supportGrants.id, grantPending)),
        ),
        /not theirs to rewrite/,
      )
      // Once open, the window never moves again — not by an hour, not by a fortnight.
      await rejectsWith(
        as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ expiresAt: days(20) })
            .where(eq(supportGrants.id, grantPending)),
        ),
        /never moved afterwards/,
      )

      // ...but AT THE MOMENT OF APPROVAL the owner may take LESS than was asked for, which is what
      // `tenancy.support.approve.hours` is for ("two hours, not four"), and never more. Migration
      // 0036 is what draws that line; 0034 froze the column against the owner outright, which made
      // the contract's own "may shorten it, never lengthen it" impossible to serve.
      const shortenable = uuidv7()
      const lengthenable = uuidv7()
      await db.insert(supportGrants).values([
        {
          id: shortenable,
          tenantId: tenantA,
          adminUserId: platformSupport,
          reason: 'four hours to read the numbering series',
          expiresAt: days(4),
        },
        {
          id: lengthenable,
          tenantId: tenantA,
          adminUserId: platformSupport,
          reason: 'two hours to read the numbering series',
          expiresAt: days(2),
        },
      ])
      expect(
        await as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ approvedBy: owner, approvedAt: new Date(), expiresAt: days(1) })
            .where(eq(supportGrants.id, shortenable))
            .returning({ id: supportGrants.id }),
        ),
        'the owner may open a shorter window than the one asked for',
      ).toEqual([{ id: shortenable }])
      await rejectsWith(
        as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ approvedBy: owner, approvedAt: new Date(), expiresAt: days(10) })
            .where(eq(supportGrants.id, lengthenable)),
        ),
        /never lengthen it/,
      )
      await rejectsWith(
        as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ revokedAt: new Date(), revokedBy: manager })
            .where(eq(supportGrants.id, grantPending)),
        ),
        /revokes as themselves/,
      )
      // an owner answers a request; it never files one
      await rejectsWith(
        as('owner')((tx) =>
          tx.insert(supportGrants).values({
            id: uuidv7(),
            tenantId: tenantA,
            adminUserId: platformSupport,
            reason: 'let me invite you in',
            expiresAt: days(2),
          }),
        ),
        /never files one/,
      )
      // it revokes, and after that the grant is closed for good
      await as('owner')((tx) =>
        tx
          .update(supportGrants)
          .set({ revokedAt: new Date(), revokedBy: owner })
          .where(eq(supportGrants.id, grantPending)),
      )
      await rejectsWith(
        as('owner')((tx) =>
          tx
            .update(supportGrants)
            .set({ revokedAt: null, revokedBy: null })
            .where(eq(supportGrants.id, grantPending)),
        ),
        /a revoked grant is closed/,
      )
      // a grant is revoked and kept: no DELETE policy, and no delete at all
      expect(
        await as('owner')((tx) =>
          tx
            .delete(supportGrants)
            .where(eq(supportGrants.id, grantPending))
            .returning({ id: supportGrants.id }),
        ),
      ).toHaveLength(0)
      await rejectsWith(
        db.delete(supportGrants).where(eq(supportGrants.id, grantPending)),
        /append-only/,
      )
    })

    it('never lets the requester approve their own access, and holds the window to thirty days', async () => {
      const request = () => ({
        id: uuidv7(),
        tenantId: tenantA,
        adminUserId: platformSupport,
        reason: 'ticket 41: numbering series stuck',
        expiresAt: days(3),
      })
      // we ask...
      const filedId = uuidv7()
      expect(
        await asPlatform(platformSupport)((tx) =>
          tx
            .insert(supportGrants)
            .values({ ...request(), id: filedId })
            .returning({ id: supportGrants.id }),
        ),
      ).toEqual([{ id: filedId }])
      // ...and may never answer, on the way in or afterwards
      await rejectsWith(
        asPlatform(platformSupport)((tx) =>
          tx
            .insert(supportGrants)
            .values({ ...request(), approvedBy: owner, approvedAt: new Date() }),
        ),
        /files a request, never an approval/,
      )
      await rejectsWith(
        asPlatform(platformSupport)((tx) =>
          tx
            .update(supportGrants)
            .set({ approvedBy: owner, approvedAt: new Date() })
            .where(eq(supportGrants.id, filedId)),
        ),
        /only the distributorship own owner approves/,
      )
      // an approved grant keeps the scope and the window the owner said yes to
      await rejectsWith(
        asPlatform()((tx) =>
          tx.update(supportGrants).set({ scope: 'read_write' }).where(eq(supportGrants.id, grantA)),
        ),
        /keeps the scope and the window the owner approved/,
      )
      // not even the migrating connection can forge an approval: it is the tenant's own active owner
      await rejectsWith(
        db
          .update(supportGrants)
          .set({ approvedBy: platformSupport, approvedAt: new Date() })
          .where(eq(supportGrants.id, filedId)),
        /the requester never approves their own access/,
      )
      await rejectsWith(
        db
          .update(supportGrants)
          .set({ approvedBy: rep, approvedAt: new Date() })
          .where(eq(supportGrants.id, filedId)),
        /approved by the distributorship own owner/,
      )
      // an `owner`-role token whose user is not an owner MEMBER of that distributorship approves nothing
      await rejectsWith(
        withTenant(db, { tenantId: tenantB, actorId: outsider, actorRole: 'owner' }, (tx) =>
          tx
            .update(supportGrants)
            .set({ approvedBy: outsider, approvedAt: new Date() })
            .where(eq(supportGrants.id, grantB)),
        ),
        /approved by the distributorship own owner/,
      )
      // time-boxed, in the database rather than in a service that the next endpoint could bypass
      await rejectsWith(
        asPlatform(platformSupport)((tx) =>
          tx.insert(supportGrants).values({ ...request(), expiresAt: days(45) }),
        ),
        /time-boxed to at most 30 days/,
      )
      await rejectsWith(
        asPlatform(platformSupport)((tx) =>
          tx.insert(supportGrants).values({ ...request(), expiresAt: days(-1) }),
        ),
        /the window ends after the request/,
      )
      // and only one of ours asks at all
      await rejectsWith(
        asPlatform()((tx) => tx.insert(supportGrants).values({ ...request(), adminUserId: owner })),
        /is not an active platform administrator/,
      )
    })

    it('keeps the platform trail append-only and filed under the person who acted', async () => {
      expect(
        (
          await asPlatform()((tx) =>
            tx.select().from(platformAudit).where(eq(platformAudit.tenantId, tenantA)),
          )
        ).map((r) => r.id),
      ).toEqual([auditA])
      const row = {
        id: uuidv7(),
        adminUserId: platformSupport,
        action: 'support.opened',
        tenantId: tenantA,
        payload: { grantId: grantA },
      }
      // a row is filed under the person who acted, never under a colleague (the INSERT check pins it,
      // exactly as `audit_log` pins actor_id)
      await rejectsWith(
        asPlatform()((tx) => tx.insert(platformAudit).values(row)),
        /row-level security/,
      )
      expect(
        await asPlatform(platformSupport)((tx) =>
          tx.insert(platformAudit).values(row).returning({ id: platformAudit.id }),
        ),
      ).toEqual([{ id: row.id }])
      // ...and under somebody who is one of ours at all
      await rejectsWith(
        db
          .insert(platformAudit)
          .values({ id: uuidv7(), adminUserId: owner, action: 'support.opened', payload: {} }),
        /is not a platform administrator/,
      )
      // append-only for every role, the connection that runs the migrations included
      await rejectsWith(
        db.update(platformAudit).set({ action: 'edited' }).where(eq(platformAudit.id, auditA)),
        /append-only/,
      )
      await rejectsWith(db.delete(platformAudit).where(eq(platformAudit.id, auditA)), /append-only/)
      expect(
        await asPlatform()((tx) =>
          tx
            .update(platformAudit)
            .set({ action: 'edited' })
            .where(eq(platformAudit.id, auditA))
            .returning({ id: platformAudit.id }),
        ),
        'there is no UPDATE policy at all, so the console reaches no row to change',
      ).toHaveLength(0)
    })

    it('lets only an active super administrator open a console account, and nobody edit their own', async () => {
      expect(
        (
          await asPlatform()((tx) =>
            tx
              .select()
              .from(platformAdmins)
              .where(inArray(platformAdmins.id, [adminSuperRow, adminSupportRow])),
          )
        )
          .map((a) => a.id)
          .sort(),
      ).toEqual([adminSuperRow, adminSupportRow].sort())

      const newcomer = uuidv7()
      await db.insert(users).values({ id: newcomer, phone: `+91902${run}3`, name: 'New colleague' })
      const account = () => ({
        id: uuidv7(),
        userId: newcomer,
        role: 'billing' as const,
        createdBy: platformSuper,
      })
      await rejectsWith(
        asPlatform(platformSupport)((tx) => tx.insert(platformAdmins).values(account())),
        /only an active super administrator/,
      )
      await rejectsWith(
        asPlatform()((tx) =>
          tx.insert(platformAdmins).values({ ...account(), createdBy: platformSupport }),
        ),
        /names the super administrator who added them/,
      )
      const created = account()
      expect(
        await asPlatform()((tx) =>
          tx.insert(platformAdmins).values(created).returning({ id: platformAdmins.id }),
        ),
      ).toEqual([{ id: created.id }])
      // no self-promotion and no self-restore, whatever level the actor holds
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .update(platformAdmins)
            .set({ role: 'super' })
            .where(eq(platformAdmins.id, adminSuperRow)),
        ),
        /nobody edits their own console account/,
      )
      // an account is disabled, never deleted: the audit trail keeps its subjects
      await asPlatform()((tx) =>
        tx
          .update(platformAdmins)
          .set({ disabledAt: new Date() })
          .where(eq(platformAdmins.id, created.id)),
      )
      expect(
        await asPlatform()((tx) =>
          tx
            .delete(platformAdmins)
            .where(eq(platformAdmins.id, created.id))
            .returning({ id: platformAdmins.id }),
        ),
      ).toHaveLength(0)
      await rejectsWith(
        db.delete(platformAdmins).where(eq(platformAdmins.id, created.id)),
        /append-only/,
      )
      // ...and a disabled administrator asks for nothing more
      await rejectsWith(
        asPlatform()((tx) =>
          tx.insert(supportGrants).values({
            id: uuidv7(),
            tenantId: tenantA,
            adminUserId: newcomer,
            reason: 'after being disabled',
            expiresAt: days(2),
          }),
        ),
        /is not an active platform administrator/,
      )
    })

    it('keeps a subscription row honest, and lets the console onboard a distributor without entering it', async () => {
      await rejectsWith(
        asPlatform()((tx) =>
          tx.update(subscriptions).set({ seats: -1 }).where(eq(subscriptions.id, subscriptionA)),
        ),
        /seat count is never negative/,
      )
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .update(subscriptions)
            .set({ pricePaiseMonth: -100 })
            .where(eq(subscriptions.id, subscriptionA)),
        ),
        /price is never negative/,
      )
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .update(subscriptions)
            .set({ status: 'trial', trialEndsAt: null })
            .where(eq(subscriptions.id, subscriptionA)),
        ),
        /a trial must say when it ends/,
      )
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .update(subscriptions)
            .set({ periodStart: '2026-09-01', periodEnd: '2026-08-01' })
            .where(eq(subscriptions.id, subscriptionA)),
        ),
        /period ends after it starts/,
      )
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .update(subscriptions)
            .set({ updatedBy: rep })
            .where(eq(subscriptions.id, subscriptionA)),
        ),
        /is not a platform administrator/,
      )
      // one distributor, one subscription state
      await rejectsWith(
        asPlatform()((tx) =>
          tx
            .insert(subscriptions)
            .values({ id: uuidv7(), tenantId: tenantB, plan: 'starter', status: 'active' }),
        ),
        /subscriptions_tenant_idx/,
      )

      // The console reads every distributorship and stamps the onboarding; reading a distributor's
      // BUSINESS data still needs an owner-approved grant — this is the tenant row itself, nothing in it.
      expect(
        (
          await asPlatform()((tx) =>
            tx
              .select({ id: tenants.id })
              .from(tenants)
              .where(inArray(tenants.id, [tenantA, tenantB])),
          )
        )
          .map((t) => t.id)
          .sort(),
      ).toEqual([tenantA, tenantB].sort())
      expect(
        await asPlatform()((tx) =>
          tx
            .update(tenants)
            .set({ onboardedAt: new Date(), onboardedBy: platformSuper, plan: 'standard' })
            .where(eq(tenants.id, tenantA))
            .returning({ id: tenants.id }),
        ),
      ).toEqual([{ id: tenantA }])
      expect(
        (await as('owner')((tx) => tx.select({ id: tenants.id }).from(tenants))).map((t) => t.id),
        'and the distributor still sees only itself',
      ).toEqual([tenantA])
    })
  })

  // ---------------------------------------------------------------------------------------------------
  // Migrations 0038/0040/0041 — OUR OWN offline sync (founder decision 2026-09-05, docs/22 §8 and
  // docs/26 §5: no PowerSync). The device keeps SQLite tables filled by `GET /sync/pull` deltas, which
  // is one sentence — "every row whose updated_at is after my cursor" — that only holds if the database
  // makes it hold. These are the executable form of the three guarantees in 0040's header: updated_at
  // moves and is the DATABASE's clock; a row that is gone leaves a tombstone; and nothing a device pulls
  // carries a purchase cost.

  describe('the offline delta pull (our own sync, no PowerSync)', () => {
    const doomedVisit = uuidv7()
    const doomedBeat = uuidv7()
    const doomedLot = uuidv7()
    const doomedBeatB = uuidv7()
    /** Two shops of tenant A: one linked to `shopUser`, one linked to nobody. */
    const shopMine = uuidv7()
    const shopTheirs = uuidv7()
    /** A third shop of the same shopkeeper, whose LINK is the one cut in the soft-hide test. */
    const shopUnlinked = uuidv7()
    const doomedAssignment = uuidv7()
    const doomedLink = uuidv7()

    const asShop = as('retailer', shopUser)
    /** A signed-in actor of the OTHER distributorship; tenant B has no bootstrap, only rows. */
    const asTenantB = <T>(fn: (tx: Db) => Promise<T>) =>
      withTenant(db, { tenantId: tenantB, actorId: owner, actorRole: 'owner' }, fn)

    const tombstonesOf = (tx: Db, table: string) =>
      tx.select().from(syncTombstones).where(eq(syncTombstones.tableName, table))

    beforeAll(async () => {
      await db.insert(visits).values({
        id: doomedVisit,
        tenantId: tenantA,
        retailerId: retailerA,
        userId: rep,
        beatId: beatA,
        startedAt: new Date(),
        outcome: 'no_order',
      })
      await db.insert(beats).values([
        { id: doomedBeat, tenantId: tenantA, name: `Doomed beat ${run}` },
        { id: doomedBeatB, tenantId: tenantB, name: `Doomed beat B ${run}` },
      ])
      await db.insert(beatAssignments).values({
        id: doomedAssignment,
        tenantId: tenantA,
        beatId: doomedBeat,
        userId: rep,
        validFrom: '2026-09-01',
      })
      await db.insert(stockLots).values({
        id: doomedLot,
        tenantId: tenantA,
        variantId: variant,
        batchNo: `DOOM-${run}`,
        mrpPaise: 4_000,
      })
      await db
        .insert(stockBalances)
        .values({ tenantId: tenantA, lotId: doomedLot, locationId: godownA, onHand: 5 })
      await db.insert(retailers).values([
        {
          id: shopMine,
          tenantId: tenantA,
          identityId: identityA,
          code: `M${run}`,
          name: 'My second shop',
          phone: `+91900${run}3`,
          stateCode: '27',
          beatId: beatA,
        },
        {
          id: shopTheirs,
          tenantId: tenantA,
          code: `X${run}`,
          name: 'A shop I have nothing to do with',
          phone: `+91901${run}9`,
          stateCode: '27',
        },
        {
          id: shopUnlinked,
          tenantId: tenantA,
          identityId: identityA,
          code: `U${run}`,
          name: 'A shop this shopkeeper is about to lose',
          phone: `+91900${run}3`,
          stateCode: '27',
        },
      ])
      await db.insert(retailerLinks).values([
        {
          id: uuidv7(),
          tenantId: tenantA,
          identityId: identityA,
          retailerId: shopMine,
          userId: shopUser,
          linkedBy: 'rep_onboarding',
        },
        {
          id: doomedLink,
          tenantId: tenantA,
          identityId: identityA,
          retailerId: shopUnlinked,
          userId: shopUser,
          linkedBy: 'rep_onboarding',
        },
      ])
    })

    it('stamps updated_at from the database clock on every write, so no delta can step over a row', async () => {
      // A service that sets `updatedAt` from its own process (several do) must not be able to put a row
      // BEHIND a cursor this server has already handed out: the trigger overwrites whatever arrives.
      const stale = new Date('2000-01-01T00:00:00.000Z')
      const [touched] = await as('manager')((tx) =>
        tx
          .update(retailers)
          .set({ name: 'My second shop, renamed', updatedAt: stale })
          .where(eq(retailers.id, shopMine))
          .returning({ updatedAt: retailers.updatedAt }),
      )
      expect(touched?.updatedAt.getTime(), 'the caller’s stale stamp is replaced').toBeGreaterThan(
        Date.now() - 60_000,
      )

      // …on INSERT too, so a row created by a phone whose clock is slow is still pulled by the next device.
      const freshVisit = uuidv7()
      const [inserted] = await as('salesperson')((tx) =>
        tx
          .insert(visits)
          .values({
            id: freshVisit,
            tenantId: tenantA,
            retailerId: retailerA,
            userId: rep,
            startedAt: new Date(),
            updatedAt: stale,
          })
          .returning({ updatedAt: visits.updatedAt }),
      )
      expect(inserted?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)

      // …and on the two tables that are keyed by their business key rather than by an id.
      const [balance] = await as('warehouse')((tx) =>
        tx
          .update(stockBalances)
          .set({ onHand: 4, updatedAt: stale })
          .where(
            sql`${stockBalances.tenantId} = ${tenantA} AND ${stockBalances.lotId} = ${doomedLot}`,
          )
          .returning({ updatedAt: stockBalances.updatedAt }),
      )
      expect(balance?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
    })

    it('files a tombstone when a row a device holds is deleted, and keeps it inside the tenant', async () => {
      await as('manager')((tx) => tx.delete(visits).where(eq(visits.id, doomedVisit)))
      const seenByRep = await as('salesperson')((tx) => tombstonesOf(tx, 'visits'))
      expect(seenByRep.map((t) => t.rowId)).toContain(doomedVisit)
      expect(seenByRep.find((t) => t.rowId === doomedVisit)?.reason).toBe('deleted')
      expect(
        seenByRep.every((t) => t.tenantId === tenantA),
        'a rep is never told what another distributorship deleted',
      ).toBe(true)

      // The two composite-key tables: the row id is the business key, joined by ':'.
      await as('warehouse')((tx) =>
        tx
          .delete(stockBalances)
          .where(
            sql`${stockBalances.tenantId} = ${tenantA} AND ${stockBalances.lotId} = ${doomedLot}`,
          ),
      )
      expect(
        (await as('warehouse')((tx) => tombstonesOf(tx, 'stock_balances'))).map((t) => t.rowId),
      ).toContain(`${doomedLot}:${godownA}`)

      // Tenant isolation, from the other side: B deletes its own beat and A hears nothing of it.
      await asTenantB((tx) => tx.delete(beats).where(eq(beats.id, doomedBeatB)))
      expect(
        (await as('owner')((tx) => tombstonesOf(tx, 'beats'))).map((t) => t.rowId),
        'tenant A never sees tenant B’s deletions',
      ).not.toContain(doomedBeatB)
      expect((await asTenantB((tx) => tombstonesOf(tx, 'beats'))).map((t) => t.rowId)).toContain(
        doomedBeatB,
      )
    })

    it('files a tombstone for the soft hides: a shop off the beat, a shop closed, an assignment ended, a link cut', async () => {
      // A shop that moves off the beat leaves the rep's read set without being deleted. The tombstone
      // says "this row MAY have left your set" — the rep who GAINED the shop gets the row as well, and
      // the device applies deletes before rows.
      await as('manager')((tx) =>
        tx.update(retailers).set({ beatId: null }).where(eq(retailers.id, shopMine)),
      )
      const afterMove = await as('salesperson')((tx) => tombstonesOf(tx, 'retailers'))
      expect(afterMove.find((t) => t.rowId === shopMine)?.reason).toBe('beat_changed')

      await as('manager')((tx) =>
        tx.update(retailers).set({ active: false }).where(eq(retailers.id, shopTheirs)),
      )
      expect(
        (await as('salesperson')((tx) => tombstonesOf(tx, 'retailers'))).find(
          (t) => t.rowId === shopTheirs,
        )?.reason,
      ).toBe('deactivated')

      await as('manager')((tx) =>
        tx
          .update(beatAssignments)
          .set({ validTo: '2026-09-30' })
          .where(eq(beatAssignments.id, doomedAssignment)),
      )
      expect(
        (await as('salesperson')((tx) => tombstonesOf(tx, 'beat_assignments'))).find(
          (t) => t.rowId === doomedAssignment,
        )?.reason,
      ).toBe('assignment_ended')

      await as('manager')((tx) =>
        tx.update(retailerLinks).set({ status: 'blocked' }).where(eq(retailerLinks.id, doomedLink)),
      )
      expect(
        (await as('salesperson')((tx) => tombstonesOf(tx, 'retailer_links'))).find(
          (t) => t.rowId === doomedLink,
        )?.reason,
      ).toBe('unlinked')
    })

    it('tells a shop only about its own rows, and never about the distributorship’s paperwork', async () => {
      await as('manager')(async (tx) => {
        await tx.delete(beatAssignments).where(eq(beatAssignments.id, doomedAssignment))
        await tx.delete(beats).where(eq(beats.id, doomedBeat))
      })

      // A beat, a visit, a stock balance: the godown's and the road's own paperwork. A shop is a
      // customer of the business, not a member of it (never-list 9) — it is not even told the ids.
      for (const table of ['beats', 'visits', 'stock_balances', 'trips', 'picklists']) {
        expect(
          await asShop((tx) => tombstonesOf(tx, table)),
          `a shop reads no ${table} tombstone`,
        ).toEqual([])
      }

      // Its OWN shop rows it does read — that is how its app learns the shop was closed or moved.
      const ownRows = await asShop((tx) => tombstonesOf(tx, 'retailers'))
      expect(ownRows.map((t) => t.rowId)).toContain(shopMine)
      expect(
        ownRows.map((t) => t.rowId),
        'and never another shop’s',
      ).not.toContain(shopTheirs)
      // …while the desk sees both.
      const deskRows = (await as('manager')((tx) => tombstonesOf(tx, 'retailers'))).map(
        (t) => t.rowId,
      )
      expect(deskRows).toContain(shopMine)
      expect(deskRows).toContain(shopTheirs)
    })

    it('lets nobody write a tombstone by hand: the triggers are the only author', async () => {
      const forged = {
        tenantId: tenantA,
        tableName: 'price_list_items',
        rowId: uuidv7(),
        reason: 'deleted',
      }
      for (const role of ['owner', 'manager', 'salesperson', 'warehouse', 'retailer'] as const) {
        await rejectsWith(
          as(role)((tx) => tx.insert(syncTombstones).values(forged)),
          /row-level security|permission denied/i,
        )
      }
      // No UPDATE and no DELETE policy either: a real row is invisible to every writer, so both are
      // no-ops rather than errors. A shop could otherwise resurrect a row every device had dropped.
      expect(
        await asShop((tx) =>
          tx
            .update(syncTombstones)
            .set({ reason: 'not really' })
            .where(eq(syncTombstones.rowId, shopMine))
            .returning({ rowId: syncTombstones.rowId }),
        ),
      ).toEqual([])
      expect(
        await as('manager')((tx) =>
          tx
            .delete(syncTombstones)
            .where(eq(syncTombstones.rowId, shopMine))
            .returning({ rowId: syncTombstones.rowId }),
        ),
      ).toEqual([])
    })

    it('makes every table a device holds pull-able: updated_at, the index and both triggers', async () => {
      for (const spec of SYNC_PULL_TABLES) {
        const column = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = ${spec.table} AND column_name = 'updated_at'`)
        expect(column.rows[0]?.n, `${spec.table} carries updated_at`).toBe(1)

        const pattern = spec.scope === 'tenant' ? '%(tenant_id, updated_at)%' : '%(updated_at)%'
        const index = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = ${spec.table} AND indexdef LIKE ${pattern}`)
        expect(index.rows[0]?.n, `${spec.table} has the delta index`).toBeGreaterThan(0)

        const triggers = await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
           WHERE NOT tg.tgisinternal AND c.relname = ${spec.table}
             AND tg.tgname IN (${spec.table + '_touch_updated_at'}, ${spec.table + '_tombstone'})`)
        expect(triggers.rows[0]?.n, `${spec.table} has the touch and tombstone triggers`).toBe(2)
      }
    })

    it('never hands a field device a purchase cost, a landed cost or a margin', async () => {
      // The literal shape of a pull: `select *` from each table the role's device holds. RLS decides
      // the rows; this asserts the COLUMNS — never-list 1 (docs/22 §9) made structural, so a later
      // migration that puts a cost on stock_lots or invoice_lines fails here instead of shipping.
      for (const role of ['salesperson', 'delivery', 'warehouse', 'retailer'] as const) {
        const tables = syncPullTablesFor(role)
        expect(tables.length, `${role} holds tables`).toBeGreaterThan(0)
        await as(role)(async (tx) => {
          for (const spec of tables) {
            const result = await tx.execute(
              sql`SELECT * FROM ${sql.identifier(spec.table)} LIMIT 0`,
            )
            const columns = result.fields.map((f) => f.name)
            expect(columns.length, `${spec.table} has columns`).toBeGreaterThan(0)
            for (const forbidden of FORBIDDEN_PULL_COLUMN_PATTERNS) {
              const hit = columns.filter((c) => forbidden.test(c))
              expect(
                hit,
                `${role} pulls no ${String(forbidden)} column from ${spec.table}`,
              ).toEqual([])
            }
          }
        })
      }
    })
  })
})
