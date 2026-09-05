import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool, withTenant, type Db } from './client.js'
import {
  accounts,
  allocations,
  approvals,
  auditLog,
  authEvents,
  bargainRequests,
  beatAssignments,
  beats,
  collections,
  correctionsLog,
  creditNoteLines,
  creditNotes,
  deliveries,
  deliveryChallans,
  deliveryLines,
  documentPages,
  documents,
  engineDisagreements,
  extractionChecks,
  extractions,
  featureFlags,
  fileObjects,
  grns,
  invoiceLines,
  authSessions,
  invoices,
  journalEntries,
  journalLines,
  loadSheets,
  memberships,
  numberingSeries,
  packConfirmations,
  pickLines,
  picklists,
  podEvidence,
  priceLists,
  priceListItems,
  receipts,
  retailerIdentities,
  retailerLinks,
  retailerOutstandingSummary,
  retailerPriceOverrides,
  retailers,
  reviewSessions,
  salesOrderLines,
  salesOrders,
  skuMatchCandidates,
  stockBalances,
  stockLedger,
  stockLots,
  supplierAliases,
  supplierInvoices,
  suppliers,
  syncErrors,
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
      expect(ids, `${role} sees the field kinds`).toEqual(expect.arrayContaining([docPod, docClaim]))
      expect(ids, `${role} must not see a supplier invoice`).not.toContain(docSupplier)
      const pages = (await as(role)((tx) => tx.select().from(documentPages))).map((p) => p.id)
      expect(pages, `${role} sees the pod page`).toContain(pagePod)
      expect(pages, `${role} must not see a supplier invoice page`).not.toContain(pageSupplier)
    }
    // the shopkeeper sees no document of any kind
    expect(await as('retailer')((tx) => tx.select().from(documents))).toHaveLength(0)
    expect(await as('retailer')((tx) => tx.select().from(documentPages))).toHaveLength(0)
    // the worker (app_rw with the system role, the way `withTenant` runs a job) reads every kind
    const asSystem = (await withTenant(
      db,
      { tenantId: tenantA, actorId: 'worker', actorRole: 'system' },
      (tx) => tx.select().from(documents),
    )).map((d) => d.id)
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
    expect(
      (await as('warehouse')((tx) => tx.select().from(documents))).map((d) => d.id),
    ).toContain(docSupplier)
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
      tx
        .select()
        .from(skuMatchCandidates)
        .where(eq(skuMatchCandidates.extractionId, extractionA)),
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
})
