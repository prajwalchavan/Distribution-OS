/**
 * Inventory + inbound procurement (ADR 0003): lots, opening / GRN / count ledger rows, balances, the
 * purchase register with its posted GRNs, and the movements that are not sales (the damaged carton,
 * the stock take that emptied the sold-out SKUs, the van load, the expiry sweep).
 *
 * WHAT is written is decided by `stock-plan.ts` (pure): the sales seed builds its order book first,
 * the planner sizes every supplier bill from that demand and replays every sold line FEFO against
 * the batches, and only then does this module write — so the godown really did receive what it sold
 * and no batch ever goes negative. Stock is written through `postLedger`, so the balances always
 * equal the ledger whatever the database held before.
 */
import { paise, percentOf, splitGst } from '@dos/domain'
import { asc, eq, sql } from 'drizzle-orm'
import type { stockLedger } from '../schema/index.js'
import {
  grnLines,
  grns,
  inboundDiscrepancies,
  locations,
  numberingSeries,
  stockLots,
  supplierInvoiceLines,
  supplierInvoices,
} from '../schema/index.js'
import type { Db } from '../client.js'
import type { VariantRow } from './catalog.js'
import { insertMany, postLedger } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { LotProfile, LotRef, StockPlan } from './stock-plan.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import { atIstTime, FY, isoDate, occurred } from './util.js'

export { DAMAGED_VARIANT_KEYS, lotProfileOf, type LotProfile, type LotRef } from './stock-plan.js'

export interface StockResult {
  godownId: string
  damagedId: string
  /** Every lot for a variant, oldest batch first. */
  lotsByVariantId: Map<string, LotRef[]>
  profileByVariantId: Map<string, LotProfile>
  /** The plan as written, for the seeds that read the picks and the events. */
  plan: StockPlan
}

/** The GRN lines that go wrong at the gate (spec §2.8): two from the original demo, two new. */
const GATE_EVENTS: Record<
  string,
  {
    kind: 'short' | 'damaged' | 'excess'
    cases: number
    status: 'open' | 'credited' | 'accepted'
    note: string
  }
> = {
  'reliance-1:campa-cola-750ml': {
    kind: 'short',
    cases: 1,
    status: 'open',
    note: '1 case short against invoice on gate count.',
  },
  'guru-kripa-1:balaji-ratlami-sev-200g': {
    kind: 'damaged',
    cases: 1,
    status: 'credited',
    note: '1 case crushed in transit, credited by supplier.',
  },
  'godavari-1:godavari-fresh-paneer-200g': {
    kind: 'short',
    cases: 0,
    status: 'open',
    note: 'Whole line refused at the gate: crate arrived at 11 °C, cold chain broken.',
  },
  'annapurna-1:annapurna-chakki-fresh-atta-5kg': {
    kind: 'excess',
    cases: 2,
    status: 'accepted',
    note: '2 bags over the invoice; mill asked us to keep them on the next bill.',
  },
}

const SUPPLIER_BILL_PREFIX: Record<string, string> = {
  reliance: 'RCP',
  guruKripa: 'GKA',
  momMakhana: 'MOM',
  guiltfree: 'GFI',
  alansFoods: 'AFP',
  rajwadiDepot: 'RJB',
  sunriseStockist: 'SSM',
  konkanAgency: 'KTR',
  annapurnaMill: 'ANP',
  godavariDairy: 'GOD',
  shubhdaDist: 'SCC',
}

export async function seedStock(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  people: PeopleResult,
  plan: StockPlan,
): Promise<StockResult> {
  // Oldest first: the tenant's bootstrap rows ('Godown', 'Damaged / expiry bin') come before anything
  // a docs example or a smoke probe adds later ('Demo Godown (docs)', 'Smoke Probe (owner)' — also
  // `warehouse` kind). An unordered `find()` once picked the docs godown on the founder's re-seeded
  // database, so every later seed that trusts `godownId` debited a location the lots were never in.
  const existingLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.tenantId, tenantId))
    .orderBy(asc(locations.createdAt), asc(locations.id))
  const godown =
    existingLocations.find((l) => l.kind === 'warehouse' && l.name === 'Godown') ??
    existingLocations.find((l) => l.kind === 'warehouse')
  const damaged = existingLocations.find((l) => l.kind === 'damaged')
  if (!godown || !damaged) {
    throw new Error(
      'bootstrapTenant must run before seedDemo: Godown/Damaged locations are missing',
    )
  }
  const variantByKey = new Map(variants.map((v) => [v.key, v]))

  // --- stock_lots: every batch of the plan, whichever way it arrived -------------------------------
  await insertMany(
    db,
    stockLots,
    plan.lots.map((lot) => ({
      id: lot.id,
      tenantId,
      variantId: lot.variantId,
      batchNo: lot.batchNo,
      mrpPaise: variantByKey.get(lot.variantKey)?.mrpPaise ?? 0,
      mfgDate: isoDate(lot.mfgDate),
      expiryDate: isoDate(lot.expiryDate),
      caseSize: lot.caseSize,
    })),
  )

  // --- opening rows: the books opened on one morning; a batch made later opens the day it was made;
  //     a batch found on this morning's count comes in as a cycle count. ---------------------------
  const ledgerRows: (typeof stockLedger.$inferInsert)[] = []
  for (const lot of plan.lots) {
    if (lot.kind === 'grn' || lot.qtyPcs <= 0) continue
    ledgerRows.push({
      id: demoId('stock-ledger-opening', lot.id),
      tenantId,
      occurredAt: occurred(atIstTime(lot.availableFrom, 8, 30)),
      lotId: lot.id,
      locationId: godown.id,
      qtyDelta: lot.qtyPcs,
      reason: lot.kind === 'count' ? 'cycle_count' : 'opening',
      refType: lot.kind === 'count' ? 'manual' : 'opening',
      refId: lot.id,
      actorId: lot.kind === 'count' ? people.warehouse.id : people.owner.id,
      idempotencyKey: `opening:${lot.id}`,
      ...(lot.countNote ? { note: lot.countNote } : {}),
    })
  }

  // --- supplier invoices + posted GRNs, one batch per bill line ------------------------------------
  const invoiceRows: (typeof supplierInvoices.$inferInsert)[] = []
  const invoiceLineRows: (typeof supplierInvoiceLines.$inferInsert)[] = []
  const grnRows: (typeof grns.$inferInsert)[] = []
  const grnLineRows: (typeof grnLines.$inferInsert)[] = []
  const discrepancyRows: (typeof inboundDiscrepancies.$inferInsert)[] = []
  let discrepancySeq = 0
  const billSeq = new Map<string, number>()

  plan.invoices.forEach((inv, invoiceIndex) => {
    const supplierId = tenantCatalog.supplierIds[inv.supplierKey]
    const invoiceId = demoId('supplier-invoice', inv.invoiceKey)
    const grnId = demoId('grn', inv.invoiceKey)
    let subtotal = 0
    let cgst = 0
    let sgst = 0
    let igst = 0
    let cess = 0
    const seq = (billSeq.get(inv.supplierKey) ?? 0) + 1
    billSeq.set(inv.supplierKey, seq)

    inv.lines.forEach((line, i) => {
      const v = variantByKey.get(line.variantKey)
      if (!v) throw new Error(`unknown variant key in supplier invoice seed: ${line.variantKey}`)
      const cost = tenantCatalog.costsByVariantId.get(v.id)
      if (!cost) throw new Error(`no cost for variant ${line.variantKey}`)
      const lot = line.lot
      // what the bill printed: the replay sized the batch at what the gate actually counted
      const event = GATE_EVENTS[`${inv.invoiceKey}:${line.variantKey}`]
      const cs = v.defaultCaseSize
      const countedQtyPcs = lot.refused ? 0 : lot.qtyPcs
      let printedCases = Math.max(1, Math.round(lot.qtyPcs / cs))
      let damagedPcs = 0
      let eventPcs = 0
      if (event) {
        if (event.kind === 'short') {
          eventPcs = event.cases === 0 ? lot.qtyPcs : event.cases * cs
          if (event.cases > 0) printedCases = lot.qtyPcs / cs + event.cases
        } else if (event.kind === 'damaged') {
          eventPcs = event.cases * cs
          damagedPcs = eventPcs
        } else {
          eventPcs = event.cases * cs
          printedCases = Math.max(1, lot.qtyPcs / cs - event.cases)
        }
      }
      const qtyPcs = printedCases * cs
      const ratePaise = cost.purchaseRatePaise
      const taxablePaise = paise(ratePaise * qtyPcs)
      const gst = splitGst(taxablePaise, v.gstBps, inv.supplierStateCode, '27')
      const cessAmt = percentOf(taxablePaise, v.cessBps)
      const received = countedQtyPcs

      const lineId = demoId('supplier-invoice-line', `${inv.invoiceKey}:${line.variantKey}`)
      invoiceLineRows.push({
        id: lineId,
        tenantId,
        supplierInvoiceId: invoiceId,
        lineNo: i + 1,
        description: v.name.toUpperCase(),
        variantId: v.id,
        hsnCode: v.hsnCode,
        batchNo: lot.batchNo,
        printedQty: printedCases,
        printedUnit: 'case',
        qtyPcs,
        ratePaise,
        rateBasis: 'piece',
        basisQty: 1,
        gstBps: v.gstBps,
        cessBps: v.cessBps,
        taxablePaise,
        taxPaise: gst.tax + cessAmt,
        lineTotalPaise: taxablePaise + gst.tax + cessAmt,
      })
      subtotal += taxablePaise
      cgst += gst.cgst
      sgst += gst.sgst
      igst += gst.igst
      cess += cessAmt

      const grnLineId = demoId('grn-line', `${inv.invoiceKey}:${line.variantKey}`)
      grnLineRows.push({
        id: grnLineId,
        tenantId,
        grnId,
        supplierInvoiceLineId: lineId,
        variantId: v.id,
        lotId: lot.id,
        expectedQtyPcs: qtyPcs,
        countedQtyPcs: received,
        damagedQtyPcs: damagedPcs,
      })
      if (received > 0) {
        ledgerRows.push({
          id: demoId('stock-ledger-grn', `${inv.invoiceKey}:${line.variantKey}`),
          tenantId,
          occurredAt: occurred(atIstTime(inv.invoiceDate, 11, 0)),
          lotId: lot.id,
          locationId: godown.id,
          qtyDelta: received,
          reason: 'grn',
          refType: 'grn',
          refId: grnId,
          actorId: people.accountant.id,
          idempotencyKey: `grn:${inv.invoiceKey}:${line.variantKey}`,
        })
      }
      if (event) {
        discrepancySeq += 1
        discrepancyRows.push({
          id: demoId('inbound-discrepancy', `${discrepancySeq}`),
          tenantId,
          grnId,
          grnLineId,
          kind: event.kind,
          qtyPcs: eventPcs,
          amountPaise: eventPcs * ratePaise,
          status: event.status,
          note: `${v.name}: ${event.note}`,
          resolvedBy: event.status === 'accepted' ? people.manager.id : null,
          resolvedAt:
            event.status === 'accepted' ? occurred(atIstTime(inv.invoiceDate, 12, 0)) : null,
        })
      }
    })

    const freightPaise = inv.supplierStateCode === '27' ? 50_000 : 180_000
    const totalPaise = subtotal + cgst + sgst + igst + cess + freightPaise
    invoiceRows.push({
      id: invoiceId,
      tenantId,
      supplierId,
      source: 'manual',
      status: 'received',
      invoiceNo: `${SUPPLIER_BILL_PREFIX[inv.supplierKey] ?? 'SUP'}/26-27/${String(400 + seq * 7 + (invoiceIndex % 5)).padStart(5, '0')}`,
      invoiceDate: isoDate(inv.invoiceDate),
      supplierGstin: null,
      placeOfSupplyState: '27',
      subtotalPaise: subtotal,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      cessPaise: cess,
      freightPaise,
      totalPaise,
      dueDate: isoDate(new Date(inv.invoiceDate.getTime() + inv.paymentTermsDays * 86_400_000)),
      approvedBy: people.accountant.id,
      approvedAt: occurred(atIstTime(inv.invoiceDate, 18, 0)),
      createdAt: occurred(atIstTime(inv.invoiceDate, 9, 45)),
    })
    grnRows.push({
      id: grnId,
      tenantId,
      grnNo: `GRN-${String(invoiceIndex + 1).padStart(4, '0')}`,
      supplierInvoiceId: invoiceId,
      locationId: godown.id,
      status: 'posted',
      countedBy: people.warehouse.id,
      countedAt: occurred(atIstTime(inv.invoiceDate, 10, 30)),
      postedBy: people.accountant.id,
      postedAt: occurred(atIstTime(inv.invoiceDate, 11, 0)),
      createdAt: occurred(atIstTime(inv.invoiceDate, 10, 30)),
    })
  })

  await insertMany(db, supplierInvoices, invoiceRows)
  await insertMany(db, supplierInvoiceLines, invoiceLineRows)
  await insertMany(db, grns, grnRows)
  await insertMany(db, grnLines, grnLineRows)
  await insertMany(db, inboundDiscrepancies, discrepancyRows)
  // The GRN counter ends past everything this seed booked, never backwards: `grn_no` carries no
  // unique index, so a counter left at 1 would hand the app's first posted GRN a number the
  // register already shows.
  if (grnRows.length > 0) {
    await db
      .insert(numberingSeries)
      .values({ tenantId, seriesCode: 'GRN', fy: FY, prefix: 'GRN-', nextNo: grnRows.length + 1 })
      .onConflictDoUpdate({
        target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
        set: { nextNo: sql`greatest(${numberingSeries.nextNo}, ${grnRows.length + 1})` },
      })
  }

  // --- the movements that are not sales, exactly where the replay put them --------------------------
  for (const e of plan.events) {
    if (!e.lotId || e.qtyPcs <= 0) continue
    if (e.kind === 'soldout') {
      ledgerRows.push({
        id: demoId('stock-ledger-soldout', e.lotId),
        tenantId,
        occurredAt: e.at,
        lotId: e.lotId,
        locationId: godown.id,
        qtyDelta: -e.qtyPcs,
        reason: 'adjustment',
        refType: 'manual',
        refId: e.lotId,
        actorId: people.manager.id,
        idempotencyKey: `soldout:${e.lotId}`,
        note: e.note,
      })
    } else if (e.kind === 'damage') {
      const vk = e.key.slice('damage:'.length)
      ledgerRows.push(
        {
          id: demoId('stock-ledger-damage-out', vk),
          tenantId,
          occurredAt: e.at,
          lotId: e.lotId,
          locationId: godown.id,
          qtyDelta: -e.qtyPcs,
          reason: 'damage',
          refType: 'manual',
          refId: e.lotId,
          actorId: people.manager.id,
          idempotencyKey: `damage-out:${vk}`,
          note: e.note,
        },
        {
          id: demoId('stock-ledger-damage-in', vk),
          tenantId,
          occurredAt: e.at,
          lotId: e.lotId,
          locationId: damaged.id,
          qtyDelta: e.qtyPcs,
          reason: 'damage',
          refType: 'manual',
          refId: e.lotId,
          actorId: people.manager.id,
          idempotencyKey: `damage-in:${vk}`,
          note: e.note,
        },
      )
    } else if (e.kind === 'expiry_sweep') {
      // Expired leftovers move to the expiry bin as a TRANSFER; the write-off itself (reason
      // `expiry_writeoff`) is the claims module's decision, filed against the bin later.
      ledgerRows.push(
        {
          id: demoId('stock-ledger-sweep-out', e.lotId),
          tenantId,
          occurredAt: e.at,
          lotId: e.lotId,
          locationId: godown.id,
          qtyDelta: -e.qtyPcs,
          reason: 'transfer_out',
          refType: 'manual',
          refId: e.lotId,
          actorId: people.warehouse.id,
          idempotencyKey: `expiry-sweep:${e.lotId}:out`,
          note: e.note,
        },
        {
          id: demoId('stock-ledger-sweep-in', e.lotId),
          tenantId,
          occurredAt: e.at,
          lotId: e.lotId,
          locationId: damaged.id,
          qtyDelta: e.qtyPcs,
          reason: 'transfer_in',
          refType: 'manual',
          refId: e.lotId,
          actorId: people.warehouse.id,
          idempotencyKey: `expiry-sweep:${e.lotId}:in`,
          note: e.note,
        },
      )
    }
    // `van_load` is posted by the warehouse seed once the vehicle locations exist.
  }

  // Openings and GRNs first (all positive), then the issues: `postLedger` folds the deltas per lot and
  // location, so the order only matters for the row timestamps, which are already set above.
  await postLedger(db, tenantId, ledgerRows, new Set([damaged.id]))

  const lotsByVariantId = new Map<string, LotRef[]>()
  for (const [variantId, lots] of plan.lotsByVariantId) lotsByVariantId.set(variantId, [...lots])
  return {
    godownId: godown.id,
    damagedId: damaged.id,
    lotsByVariantId,
    profileByVariantId: plan.profileByVariantId,
    plan,
  }
}
