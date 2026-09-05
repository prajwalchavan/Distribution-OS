/**
 * The billing shapes the ordinary sales seed does not produce: a cancelled bill that keeps its number,
 * a van sale, a brand-DMS import, an inter-state (IGST) bill, a B2C shop with no GSTIN, two more credit
 * notes and the e-way-bill fields — plus the `tenant_settings` a white-labelled document needs.
 *
 * Every row is keyed with `demoId()` and inserted with `onConflictDoNothing()`, so `pnpm db:seed` twice
 * adds nothing the second time. Called once PER DISTRIBUTOR from `seed-demo/index.ts`.
 *
 * These rows are written directly rather than through `BillingService`: the seed runs on the owner
 * (BYPASSRLS) connection with no request context, and @dos/db must not depend on @dos/core. The
 * arithmetic below is therefore the same arithmetic the service does, and the invariants it has to keep
 * are: one rupee rounding per invoice with the residue on ROUND_OFF, every journal entry summing to
 * zero, a cancelled invoice keeping its number, and a brand-DMS bill never touching the INV counter.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { paise, percentOf, roundToRupee } from '@dos/domain'
import type { Db } from '../client.js'
import {
  accounts,
  allocations,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  locations,
  numberingSeries,
  receipts,
  retailers,
  salesOrderLines,
  salesOrders,
  stockLedger,
  tenants,
  tenantSettings,
} from '../schema/index.js'
import { TENANT_SETTING_KEYS } from '../tenant-bootstrap.js'
import type { VariantRow } from './catalog.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailersResult } from './retailers.js'
import type { SalesResult } from './sales.js'
import type { StockResult } from './stock.js'
import { atIstTime, daysAgo, FY, isoDate, makeGstin, nth, TODAY as TODAY_SEED } from './util.js'

/** The seller's own FSSAI licence, printed on a food invoice. Display-only, like the demo GSTIN. */
const SELLER_FSSAI = '11525012000456'
/** Where a brand DMS's own number is filed; the tenant's INV counter is never touched (docs/17 item 1). */
const EXTERNAL_SERIES = 'EXT'

/** One open bill with its first line, as the credit-note query returns it (snake_case, raw driver row). */
interface CreditSource {
  id: string
  retailer_id: string
  invoice_date: string
  is_inter_state: boolean
  open_paise: string | number
  line_id: string
  variant_id: string
  lot_id: string | null
  rate_paise: string | number
  gst_bps: string | number
  cess_bps: string | number
  qty_pcs: string | number
}

export async function seedBilling(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  sales: SalesResult,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const sellerGstin = tenant?.gstin ?? makeGstin('27', 'AAXPT9021Q')

  // ---------------------------------------------------------------------------------------------------------------
  // 1. The white-label settings every printed document reads (docs/17 §D6). `branding.display_name`
  //    and `branding.invoice_footer` are already seeded by `bootstrapTenant`; these three are the ones
  //    a distributor configures for itself, and without `upi_vpa` the invoice QR is (correctly) null.

  await insertMany(db, tenantSettings, [
    {
      tenantId,
      key: TENANT_SETTING_KEYS.upiVpa,
      value: `${(tenant?.slug ?? 'demo').replace(/[^a-z0-9]/g, '')}@okhdfcbank`,
    },
    { tenantId, key: TENANT_SETTING_KEYS.sellerFssai, value: SELLER_FSSAI },
    {
      tenantId,
      key: TENANT_SETTING_KEYS.brandingAddress,
      value: {
        line1: 'Gala 4, Shivam Industrial Estate',
        area: 'Khadakpada',
        city: 'Kalyan',
        pincode: '421301',
      },
    },
  ])

  const godown = stock.godownId
  // `seedDelivery` creates one location per vehicle; the van sale below leaves Tempo 1's.
  const [vehicleLocation] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(eq(locations.tenantId, tenantId), eq(locations.id, demoId('location-vehicle', 'tempo'))),
    )
    .limit(1)
  const vanLocationId = vehicleLocation?.id ?? godown

  const invoiceRows: (typeof invoices.$inferInsert)[] = []
  const lineRows: (typeof invoiceLines.$inferInsert)[] = []
  const orderRows: (typeof salesOrders.$inferInsert)[] = []
  const orderLineRows: (typeof salesOrderLines.$inferInsert)[] = []
  const entryRows: (typeof journalEntries.$inferInsert)[] = []
  const journalRows: (typeof journalLines.$inferInsert)[] = []
  const ledgerRows: (typeof stockLedger.$inferInsert)[] = []
  const cnRows: (typeof creditNotes.$inferInsert)[] = []
  const cnLineRows: (typeof creditNoteLines.$inferInsert)[] = []
  const receiptRows: (typeof receipts.$inferInsert)[] = []
  const allocationRows: (typeof allocations.$inferInsert)[] = []

  /**
   * Money against a bill: the receipt, the allocation and the balanced entry, together.
   *
   * The van sale and the inter-state bill are both settled the moment they are raised — the crew takes
   * cash at the door and the Gujarat wholesaler pays by transfer — which is realistic AND keeps the demo
   * books tied: `seedReceivables` asserts that the AR account balance equals the sum of the shop rollups
   * it builds, and it builds those only for the shops `seedRetailers` created.
   */
  const settle = (i: {
    key: string
    invoiceId: string
    retailerId: string
    amountPaise: number
    date: Date
    mode: 'cash' | 'bank_transfer'
    receivedBy: string
  }): void => {
    const receiptId = demoId('receipt', `billing:${i.key}`)
    receiptRows.push({
      id: receiptId,
      tenantId,
      receiptNo: `RCPT-9${String(receiptRows.length + 1).padStart(3, '0')}`,
      retailerId: i.retailerId,
      mode: i.mode,
      amountPaise: i.amountPaise,
      receivedAt: atIstTime(i.date, 18, 0),
      receivedBy: i.receivedBy,
      reference:
        i.mode === 'bank_transfer' ? `NEFT${String(900000000 + receiptRows.length)}` : null,
      idempotencyKey: `receipt:billing:${i.key}`,
    })
    allocationRows.push({
      id: demoId('allocation', `billing:${i.key}`),
      tenantId,
      invoiceId: i.invoiceId,
      receiptId,
      amountPaise: i.amountPaise,
      allocatedAt: atIstTime(i.date, 18, 0),
    })
    const entryId = demoId('journal-entry', `receipt:billing:${i.key}`)
    entryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(i.date),
      refType: 'receipt',
      refId: receiptId,
      narration: `Receipt against ${i.key}`,
      idempotencyKey: `journal:receipt:billing:${i.key}`,
      postedBy: i.receivedBy,
      postedAt: atIstTime(i.date, 18, 0),
    })
    journalRows.push(
      {
        id: demoId('journal-line', `receipt:billing:${i.key}:cash`),
        tenantId,
        entryId,
        accountId: acc(i.mode === 'cash' ? 'CASH' : 'BANK'),
        amountPaise: i.amountPaise,
        partyType: 'retailer',
        partyId: i.retailerId,
      },
      {
        id: demoId('journal-line', `receipt:billing:${i.key}:ar`),
        tenantId,
        entryId,
        accountId: acc('AR'),
        amountPaise: 0 - i.amountPaise,
        partyType: 'retailer',
        partyId: i.retailerId,
      },
    )
  }

  /** One balanced AR entry per bill, exactly as `ReceivablesService.postInvoiceIssued` writes it. */
  const postSale = (i: {
    key: string
    invoiceId: string
    invoiceNo: string
    retailerId: string
    retailerName: string
    date: Date
    subtotal: number
    cgst: number
    sgst: number
    igst: number
    cess: number
    roundOff: number
    total: number
  }): void => {
    const entryId = demoId('journal-entry', `invoice:${i.invoiceId}`)
    entryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(i.date),
      refType: 'invoice',
      refId: i.invoiceId,
      narration: `Invoice ${i.invoiceNo} to ${i.retailerName}`,
      idempotencyKey: `journal:invoice:${i.invoiceId}`,
      postedBy: people.accountant.id,
      postedAt: atIstTime(i.date, 18, 30),
    })
    const line = (suffix: string, code: string, amountPaise: number, party = false) => {
      if (amountPaise === 0) return
      journalRows.push({
        id: demoId('journal-line', `${i.key}:${suffix}`),
        tenantId,
        entryId,
        accountId: acc(code),
        amountPaise,
        ...(party ? { partyType: 'retailer', partyId: i.retailerId } : {}),
      })
    }
    line('ar', 'AR', i.total, true)
    line('sales', 'SALES', -i.subtotal)
    line('cgst', 'OUTPUT_CGST', -i.cgst)
    line('sgst', 'OUTPUT_SGST', -i.sgst)
    line('igst', 'OUTPUT_IGST', -i.igst)
    line('cess', 'OUTPUT_CESS', -i.cess)
    line('roundoff', 'ROUND_OFF', -i.roundOff)
  }

  /** Prices one line the way the invoice does: taxable, then the split by place of supply. */
  const priceLine = (v: VariantRow, qtyPcs: number, ratePaise: number, interState: boolean) => {
    const taxable = ratePaise * qtyPcs
    const gst = percentOf(paise(taxable), v.gstBps)
    const half = percentOf(paise(taxable), v.gstBps / 2)
    const cess = percentOf(paise(taxable), v.cessBps)
    return {
      taxable,
      cgst: interState ? 0 : half,
      sgst: interState ? 0 : half,
      igst: interState ? gst : 0,
      cess,
      total: taxable + (interState ? gst : half + half) + cess,
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2. The GST shapes the ordinary seed cannot make: an inter-state bill needs a shop in another state.
  //    R-9024 is a Gujarat wholesaler, so `27 -> 24` fills `igst_paise` alone and nothing else changes.

  const gujaratRetailerId = demoId('retailer', 'gujarat')
  await insertMany(db, retailers, [
    {
      id: gujaratRetailerId,
      tenantId,
      code: 'R-9024',
      name: 'Surat Sales Agency',
      ownerName: 'Nilesh Patel',
      phone: '+919824000024',
      stateCode: '24',
      gstRegType: 'regular',
      gstin: makeGstin('24', 'AAXPS4410M'),
      tier: 'B',
      creditDays: 21,
      paymentTerms: 'POST_FULFILLMENT',
      address: { line1: 'Ring Road', area: 'Salabatpura', city: 'Surat', pincode: '395003' },
      tallyLedgerName: 'Surat Sales Agency',
    },
  ])

  const wafer = variants.find((v) => v.gstBps > 0) ?? nth(variants, 0)
  const cola = variants.find((v) => v.cessBps > 0) ?? wafer

  const interStateDate = daysAgo(3)
  const interStateInvoiceId = demoId('invoice', 'inter-state')
  {
    const priced = priceLine(wafer, wafer.defaultCaseSize * 10, 950, true)
    const { rounded, roundOff } = roundToRupee(
      paise(priced.taxable + priced.igst + priced.cgst + priced.sgst + priced.cess),
    )
    invoiceRows.push({
      id: interStateInvoiceId,
      tenantId,
      invoiceNo: 'INV/9001',
      seriesCode: 'INV',
      fy: FY,
      invoiceDate: isoDate(interStateDate),
      retailerId: gujaratRetailerId,
      source: 'pack',
      state: 'issued',
      supplyType: 'B2B',
      sellerGstin,
      buyerGstin: makeGstin('24', 'AAXPS4410M'),
      buyerName: 'Surat Sales Agency',
      buyerAddress: { area: 'Salabatpura', city: 'Surat', pincode: '395003' },
      placeOfSupplyState: '24',
      sellerFssai: SELLER_FSSAI,
      isInterState: true,
      subtotalPaise: priced.taxable,
      taxablePaise: priced.taxable,
      igstPaise: priced.igst,
      cessPaise: priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      dueDate: isoDate(new Date(interStateDate.getTime() + 21 * 86_400_000)),
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(interStateDate, 17, 0),
    })
    lineRows.push({
      id: demoId('invoice-line', `${interStateInvoiceId}:0`),
      tenantId,
      invoiceId: interStateInvoiceId,
      lineNo: 1,
      variantId: wafer.id,
      description: wafer.name,
      hsnCode: wafer.hsnCode,
      qtyPcs: wafer.defaultCaseSize * 10,
      enteredQty: 10,
      enteredUnit: 'case',
      packSizeAtEntry: wafer.defaultCaseSize,
      caseSize: wafer.defaultCaseSize,
      ratePaise: 950,
      taxablePaise: priced.taxable,
      gstBps: wafer.gstBps,
      igstPaise: priced.igst,
      cessBps: wafer.cessBps,
      cessPaise: priced.cess,
      lineTotalPaise: priced.total,
    })
    postSale({
      key: 'inter-state',
      invoiceId: interStateInvoiceId,
      invoiceNo: 'INV/9001',
      retailerId: gujaratRetailerId,
      retailerName: 'Surat Sales Agency',
      date: interStateDate,
      subtotal: priced.taxable,
      cgst: 0,
      sgst: 0,
      igst: priced.igst,
      cess: priced.cess,
      roundOff,
      total: rounded,
    })
    settle({
      key: 'inter-state',
      invoiceId: interStateInvoiceId,
      retailerId: gujaratRetailerId,
      amountPaise: rounded,
      date: interStateDate,
      mode: 'bank_transfer',
      receivedBy: people.accountant.id,
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 3. A CANCELLED bill: the number survives (GSTR-1 Table 13), the goods go back on a compensating
  //    ledger row and the money on a reversing entry, and the order returns to the billing queue.

  const cancelledDate = daysAgo(2)
  const cancelledInvoiceId = demoId('invoice', 'cancelled')
  const cancelledOrderId = demoId('order', 'cancelled-invoice')
  const cancelledShop = nth(retailersRes.retailers, 3)
  {
    const qty = wafer.defaultCaseSize * 3
    const priced = priceLine(wafer, qty, 1000, false)
    const { rounded, roundOff } = roundToRupee(
      paise(priced.taxable + priced.cgst + priced.sgst + priced.cess),
    )
    const lot = (stock.lotsByVariantId.get(wafer.id) ?? [])[0]
    orderRows.push({
      id: cancelledOrderId,
      tenantId,
      orderNo: 'SO-9001',
      retailerId: cancelledShop.id,
      state: 'packed',
      source: 'salesperson',
      createdBy: people.salespeople.rahul.id,
      salespersonId: people.salespeople.rahul.id,
      paymentTerms: cancelledShop.paymentTerms,
      fulfilFromLocationId: godown,
      subtotalPaise: priced.taxable,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      submittedAt: atIstTime(cancelledDate, 10, 0),
      confirmedAt: atIstTime(cancelledDate, 11, 0),
    })
    orderLineRows.push({
      id: demoId('order-line', `${cancelledOrderId}:0`),
      tenantId,
      orderId: cancelledOrderId,
      lineNo: 1,
      variantId: wafer.id,
      enteredQty: 3,
      enteredUnit: 'case',
      packSizeAtEntry: wafer.defaultCaseSize,
      qtyPcs: qty,
      pickedQtyPcs: qty,
      listRatePaise: 1000,
      ratePaise: 1000,
      gstBps: wafer.gstBps,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      lineTotalPaise: priced.total,
    })
    invoiceRows.push({
      id: cancelledInvoiceId,
      tenantId,
      invoiceNo: 'INV/9002',
      seriesCode: 'INV',
      fy: FY,
      invoiceDate: isoDate(cancelledDate),
      orderId: cancelledOrderId,
      retailerId: cancelledShop.id,
      source: 'pack',
      // the NUMBER survives cancellation; only the state, the timestamp and the reason change
      state: 'cancelled',
      supplyType: cancelledShop.gstin ? 'B2B' : 'B2C',
      sellerGstin,
      buyerGstin: cancelledShop.gstin,
      buyerName: cancelledShop.name,
      placeOfSupplyState: '27',
      sellerFssai: SELLER_FSSAI,
      subtotalPaise: priced.taxable,
      taxablePaise: priced.taxable,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessPaise: priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      dueDate: isoDate(new Date(cancelledDate.getTime() + cancelledShop.creditDays * 86_400_000)),
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(cancelledDate, 16, 0),
      cancelledAt: atIstTime(cancelledDate, 19, 30),
      cancelReason: 'Retailer refused the load before dispatch.',
    })
    lineRows.push({
      id: demoId('invoice-line', `${cancelledInvoiceId}:0`),
      tenantId,
      invoiceId: cancelledInvoiceId,
      lineNo: 1,
      orderLineId: demoId('order-line', `${cancelledOrderId}:0`),
      variantId: wafer.id,
      lotId: lot?.id ?? null,
      description: wafer.name,
      hsnCode: wafer.hsnCode,
      batchNo: lot?.batchNo ?? null,
      mrpPaise: wafer.mrpPaise,
      qtyPcs: qty,
      enteredQty: 3,
      enteredUnit: 'case',
      packSizeAtEntry: wafer.defaultCaseSize,
      caseSize: lot?.caseSize ?? wafer.defaultCaseSize,
      ratePaise: 1000,
      taxablePaise: priced.taxable,
      gstBps: wafer.gstBps,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessBps: wafer.cessBps,
      cessPaise: priced.cess,
      lineTotalPaise: priced.total,
    })
    postSale({
      key: 'cancelled',
      invoiceId: cancelledInvoiceId,
      invoiceNo: 'INV/9002',
      retailerId: cancelledShop.id,
      retailerName: cancelledShop.name,
      date: cancelledDate,
      subtotal: priced.taxable,
      cgst: priced.cgst,
      sgst: priced.sgst,
      igst: 0,
      cess: priced.cess,
      roundOff,
      total: rounded,
    })
    // …and the reversal that undoes it, line for line, so the pair nets to zero in the books
    const reversalId = demoId('journal-entry', `invoice-cancel:${cancelledInvoiceId}`)
    entryRows.push({
      id: reversalId,
      tenantId,
      entryDate: isoDate(cancelledDate),
      refType: 'invoice_cancel',
      refId: cancelledInvoiceId,
      narration: 'cancels invoice INV/9002',
      idempotencyKey: `journal:invoice-cancel:${cancelledInvoiceId}`,
      postedBy: people.owner.id,
      postedAt: atIstTime(cancelledDate, 19, 30),
    })
    const reversalLine = (suffix: string, code: string, amountPaise: number, party = false) => {
      if (amountPaise === 0) return
      journalRows.push({
        id: demoId('journal-line', `cancel:${suffix}`),
        tenantId,
        entryId: reversalId,
        accountId: acc(code),
        amountPaise,
        ...(party ? { partyType: 'retailer', partyId: cancelledShop.id } : {}),
      })
    }
    reversalLine('ar', 'AR', 0 - rounded, true)
    reversalLine('sales', 'SALES', priced.taxable)
    reversalLine('cgst', 'OUTPUT_CGST', priced.cgst)
    reversalLine('sgst', 'OUTPUT_SGST', priced.sgst)
    reversalLine('cess', 'OUTPUT_CESS', priced.cess)
    reversalLine('roundoff', 'ROUND_OFF', roundOff)
    if (lot) {
      ledgerRows.push(
        {
          id: demoId('ledger', `cancel-sale:${cancelledInvoiceId}`),
          tenantId,
          occurredAt: atIstTime(cancelledDate, 16, 0),
          lotId: lot.id,
          locationId: godown,
          qtyDelta: -qty,
          reason: 'sale',
          refType: 'invoice',
          refId: cancelledInvoiceId,
          actorId: people.warehouse.id,
          idempotencyKey: `invoice:${cancelledInvoiceId}:${lot.id}`,
        },
        {
          id: demoId('ledger', `cancel-restock:${cancelledInvoiceId}`),
          tenantId,
          occurredAt: atIstTime(cancelledDate, 19, 30),
          lotId: lot.id,
          locationId: godown,
          qtyDelta: qty,
          reason: 'adjustment',
          refType: 'invoice_cancel',
          refId: cancelledInvoiceId,
          actorId: people.owner.id,
          idempotencyKey: `invoice-cancel:${cancelledInvoiceId}:${lot.id}:${godown}`,
          note: 'cancelled invoice INV/9002',
        },
      )
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 4. A VAN SALE. Same tenant series as any other bill (docs/17 §D5): `source = 'van_sale'` and the
  //    pieces leaving the VEHICLE location are the only difference.

  const vanDate = daysAgo(1)
  const vanInvoiceId = demoId('invoice', 'van-sale')
  const vanOrderId = demoId('order', 'van-sale-billed')
  const vanShop = nth(retailersRes.retailers, 7)
  {
    const qty = 18
    const priced = priceLine(wafer, qty, 1050, false)
    const { rounded, roundOff } = roundToRupee(
      paise(priced.taxable + priced.cgst + priced.sgst + priced.cess),
    )
    const lot = (stock.lotsByVariantId.get(wafer.id) ?? [])[0]
    orderRows.push({
      id: vanOrderId,
      tenantId,
      orderNo: 'SO-9002',
      retailerId: vanShop.id,
      state: 'delivered',
      source: 'van_sale',
      createdBy: people.delivery.ganesh.id,
      paymentTerms: 'ON',
      fulfilFromLocationId: vanLocationId,
      subtotalPaise: priced.taxable,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      submittedAt: atIstTime(vanDate, 11, 0),
      confirmedAt: atIstTime(vanDate, 11, 1),
    })
    orderLineRows.push({
      id: demoId('order-line', `${vanOrderId}:0`),
      tenantId,
      orderId: vanOrderId,
      lineNo: 1,
      variantId: wafer.id,
      enteredQty: qty,
      enteredUnit: 'piece',
      packSizeAtEntry: 1,
      qtyPcs: qty,
      pickedQtyPcs: qty,
      deliveredQtyPcs: qty,
      listRatePaise: 1050,
      ratePaise: 1050,
      gstBps: wafer.gstBps,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      lineTotalPaise: priced.total,
    })
    invoiceRows.push({
      id: vanInvoiceId,
      tenantId,
      invoiceNo: 'INV/9003',
      seriesCode: 'INV',
      fy: FY,
      invoiceDate: isoDate(vanDate),
      orderId: vanOrderId,
      retailerId: vanShop.id,
      source: 'van_sale',
      state: 'paid',
      supplyType: vanShop.gstin ? 'B2B' : 'B2C',
      sellerGstin,
      buyerGstin: vanShop.gstin,
      buyerName: vanShop.name,
      placeOfSupplyState: '27',
      sellerFssai: SELLER_FSSAI,
      subtotalPaise: priced.taxable,
      taxablePaise: priced.taxable,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessPaise: priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      dueDate: isoDate(vanDate),
      issuedBy: people.delivery.ganesh.id,
      issuedAt: atIstTime(vanDate, 11, 5),
    })
    lineRows.push({
      id: demoId('invoice-line', `${vanInvoiceId}:0`),
      tenantId,
      invoiceId: vanInvoiceId,
      lineNo: 1,
      orderLineId: demoId('order-line', `${vanOrderId}:0`),
      variantId: wafer.id,
      lotId: lot?.id ?? null,
      description: wafer.name,
      hsnCode: wafer.hsnCode,
      batchNo: lot?.batchNo ?? null,
      mrpPaise: wafer.mrpPaise,
      qtyPcs: qty,
      enteredQty: qty,
      enteredUnit: 'piece',
      packSizeAtEntry: 1,
      caseSize: lot?.caseSize ?? wafer.defaultCaseSize,
      ratePaise: 1050,
      taxablePaise: priced.taxable,
      gstBps: wafer.gstBps,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessBps: wafer.cessBps,
      cessPaise: priced.cess,
      lineTotalPaise: priced.total,
    })
    postSale({
      key: 'van-sale',
      invoiceId: vanInvoiceId,
      invoiceNo: 'INV/9003',
      retailerId: vanShop.id,
      retailerName: vanShop.name,
      date: vanDate,
      subtotal: priced.taxable,
      cgst: priced.cgst,
      sgst: priced.sgst,
      igst: 0,
      cess: priced.cess,
      roundOff,
      total: rounded,
    })
    settle({
      key: 'van-sale',
      invoiceId: vanInvoiceId,
      retailerId: vanShop.id,
      amountPaise: rounded,
      date: vanDate,
      mode: 'cash',
      receivedBy: people.delivery.ganesh.id,
    })
    if (lot) {
      ledgerRows.push({
        id: demoId('ledger', `van-sale:${vanInvoiceId}`),
        tenantId,
        occurredAt: atIstTime(vanDate, 11, 5),
        lotId: lot.id,
        locationId: vanLocationId,
        qtyDelta: -qty,
        reason: 'sale',
        refType: 'invoice',
        refId: vanInvoiceId,
        actorId: people.delivery.ganesh.id,
        idempotencyKey: `invoice:${vanInvoiceId}:${lot.id}`,
      })
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 4b. …and ONE van-sale order still waiting to be billed, so `invoices.issueVanSale` has something
  //     real to bill off the van. The variant is whichever one Tempo 1 actually carries, so the
  //     reservation succeeds instead of answering "the van is short".

  const [onVan] = (
    await db.execute(sql`
      SELECT l.variant_id, (sb.on_hand - sb.reserved) AS available
        FROM stock_balances sb
        JOIN stock_lots l ON l.id = sb.lot_id
       WHERE sb.tenant_id = ${tenantId} AND sb.location_id = ${vanLocationId}
         AND (sb.on_hand - sb.reserved) >= 2
       ORDER BY available DESC, l.variant_id
       LIMIT 1`)
  ).rows as unknown as { variant_id: string; available: string | number }[]
  const vanStockVariant = variants.find((v) => v.id === onVan?.variant_id)
  if (vanStockVariant) {
    const pendingVanOrderId = demoId('order', 'van-sale-pending')
    const qty = 2
    const priced = priceLine(vanStockVariant, qty, 1050, false)
    const { rounded, roundOff } = roundToRupee(
      paise(priced.taxable + priced.cgst + priced.sgst + priced.cess),
    )
    orderRows.push({
      id: pendingVanOrderId,
      tenantId,
      orderNo: 'SO-9003',
      retailerId: nth(retailersRes.retailers, 11).id,
      state: 'confirmed',
      source: 'van_sale',
      createdBy: people.delivery.ganesh.id,
      paymentTerms: 'ON',
      fulfilFromLocationId: vanLocationId,
      subtotalPaise: priced.taxable,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      submittedAt: atIstTime(TODAY_SEED, 9, 30),
      confirmedAt: atIstTime(TODAY_SEED, 9, 31),
    })
    orderLineRows.push({
      id: demoId('order-line', `${pendingVanOrderId}:0`),
      tenantId,
      orderId: pendingVanOrderId,
      lineNo: 1,
      variantId: vanStockVariant.id,
      enteredQty: qty,
      enteredUnit: 'piece',
      packSizeAtEntry: 1,
      qtyPcs: qty,
      listRatePaise: 1050,
      ratePaise: 1050,
      gstBps: vanStockVariant.gstBps,
      taxPaise: priced.cgst + priced.sgst + priced.cess,
      lineTotalPaise: priced.total,
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 5. A BRAND-DMS import (ADR 0014 / docs/17 item 1). The brand's system already issued the legal
  //    invoice, so it is stored verbatim on an `external` series, the AR is posted because we still
  //    collect the money, and NO stock moves — the goods came in on the brand's own documents.

  const dmsDate = daysAgo(5)
  const dmsInvoiceId = demoId('invoice', 'brand-dms')
  const dmsShop = nth(retailersRes.retailers, 12)
  const dmsNo = 'TY/26-27/00412'
  {
    const qty = cola.defaultCaseSize * 4
    const priced = priceLine(cola, qty, 1400, false)
    const { rounded, roundOff } = roundToRupee(
      paise(priced.taxable + priced.cgst + priced.sgst + priced.cess),
    )
    invoiceRows.push({
      id: dmsInvoiceId,
      tenantId,
      invoiceNo: dmsNo,
      seriesCode: EXTERNAL_SERIES,
      fy: FY,
      invoiceDate: isoDate(dmsDate),
      retailerId: dmsShop.id,
      source: 'brand_dms_import',
      externalInvoiceNo: dmsNo,
      state: 'issued',
      supplyType: dmsShop.gstin ? 'B2B' : 'B2C',
      sellerGstin,
      buyerGstin: dmsShop.gstin,
      buyerName: dmsShop.name,
      placeOfSupplyState: '27',
      sellerFssai: SELLER_FSSAI,
      subtotalPaise: priced.taxable,
      taxablePaise: priced.taxable,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessPaise: priced.cess,
      roundOffPaise: roundOff,
      totalPaise: rounded,
      dueDate: isoDate(new Date(dmsDate.getTime() + dmsShop.creditDays * 86_400_000)),
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(dmsDate, 12, 0),
    })
    lineRows.push({
      id: demoId('invoice-line', `${dmsInvoiceId}:0`),
      tenantId,
      invoiceId: dmsInvoiceId,
      lineNo: 1,
      variantId: cola.id,
      description: cola.name,
      hsnCode: cola.hsnCode,
      mrpPaise: cola.mrpPaise,
      qtyPcs: qty,
      enteredQty: 4,
      enteredUnit: 'case',
      packSizeAtEntry: cola.defaultCaseSize,
      caseSize: cola.defaultCaseSize,
      ratePaise: 1400,
      taxablePaise: priced.taxable,
      gstBps: cola.gstBps,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      cessBps: cola.cessBps,
      cessPaise: priced.cess,
      lineTotalPaise: priced.total,
    })
    postSale({
      key: 'brand-dms',
      invoiceId: dmsInvoiceId,
      invoiceNo: dmsNo,
      retailerId: dmsShop.id,
      retailerName: dmsShop.name,
      date: dmsDate,
      subtotal: priced.taxable,
      cgst: priced.cgst,
      sgst: priced.sgst,
      igst: 0,
      cess: priced.cess,
      roundOff,
      total: rounded,
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 6. TWO MORE CREDIT NOTES beside the three short deliveries the sales seed raises: one saleable
  //    return that puts the pieces back in the godown, and one purely financial rate difference that
  //    moves nothing at all.

  /**
   * The two extra notes are raised against bills that are still OPEN and carry no note yet, and the
   * quantity is chosen so the note never credits more than the bill still owes — the same cap
   * `CreditNotesService` enforces, and the thing that keeps `seedReceivables`' books-tie assertion true.
   */
  // The note's own id is derived from the SPEC, not from whichever bill it lands on, so re-running the
  // seed is a no-op even though the bill it would choose has moved: the second run finds the note
  // already there and stops. Deriving it from the bill instead would book a SECOND note under the same
  // `CN/900x` number, which the unique index refuses and which used to break the seed halfway through.
  const extraNoteIds = ['return', 'rate'].map((key) => demoId('credit-note', `extra:${key}`))
  const alreadyBooked = new Set(
    (
      await db
        .select({ id: creditNotes.id })
        .from(creditNotes)
        .where(and(eq(creditNotes.tenantId, tenantId), inArray(creditNotes.id, extraNoteIds)))
    ).map((r) => r.id),
  )

  const openForCredit = (
    await db.execute(sql`
      SELECT i.id, i.retailer_id, i.invoice_date, i.is_inter_state,
             (i.total_paise - COALESCE(a.allocated, 0)) AS open_paise,
             l.id AS line_id, l.variant_id, l.lot_id, l.rate_paise, l.gst_bps, l.cess_bps, l.qty_pcs
        FROM invoices i
        JOIN LATERAL (SELECT * FROM invoice_lines il
                       WHERE il.invoice_id = i.id ORDER BY il.line_no LIMIT 1) l ON true
        LEFT JOIN LATERAL (SELECT SUM(al.amount_paise) AS allocated FROM allocations al
                            WHERE al.tenant_id = i.tenant_id AND al.invoice_id = i.id) a ON true
       WHERE i.tenant_id = ${tenantId}
         AND i.state IN ('issued', 'partially_paid')
         AND i.source = 'pack'
         AND NOT EXISTS (SELECT 1 FROM credit_notes c WHERE c.invoice_id = i.id)
       ORDER BY (i.total_paise - COALESCE(a.allocated, 0)) DESC, i.id
       LIMIT 2`)
  ).rows as unknown as CreditSource[]

  const extraNotes: {
    key: string
    no: string
    reason: 'return_saleable' | 'rate_difference'
    ratePaise: (line: CreditSource) => number
    maxQty: number
    restock: boolean
    note: string
  }[] = [
    {
      key: 'return',
      no: 'CN/9001',
      reason: 'return_saleable',
      ratePaise: (line) => Number(line.rate_paise),
      maxQty: 6,
      restock: true,
      note: 'Returned unopened and taken back into the godown.',
    },
    {
      // A rate-difference note passes the DIFFERENCE per piece, never today's price list (ADR 0004),
      // and moves no goods at all.
      key: 'rate',
      no: 'CN/9002',
      reason: 'rate_difference',
      ratePaise: (line) => Math.min(50, Number(line.rate_paise)),
      maxQty: 24,
      restock: false,
      note: 'Rate difference agreed with the shopkeeper: 50 paise a piece. No goods moved.',
    },
  ]

  extraNotes.forEach((spec, index) => {
    const source = openForCredit[index]
    if (!source) return
    const v = variants.find((x) => x.id === source.variant_id)
    if (!v) return
    const openPaise = Number(source.open_paise)
    const rate = spec.ratePaise(source)
    const date = new Date(`${source.invoice_date}T00:00:00.000Z`)
    // Walk the quantity down until the rounded note fits inside what the bill still owes.
    let qty = Math.min(Number(source.qty_pcs), spec.maxQty)
    let priced = priceLine(v, qty, rate, source.is_inter_state)
    let money = roundToRupee(
      paise(priced.taxable + priced.cgst + priced.sgst + priced.igst + priced.cess),
    )
    while (qty > 1 && money.rounded > openPaise) {
      qty -= 1
      priced = priceLine(v, qty, rate, source.is_inter_state)
      money = roundToRupee(
        paise(priced.taxable + priced.cgst + priced.sgst + priced.igst + priced.cess),
      )
    }
    if (money.rounded <= 0 || money.rounded > openPaise) return

    const cnId = demoId('credit-note', `extra:${spec.key}`)
    if (alreadyBooked.has(cnId)) return
    const cnLineId = demoId('credit-note-line', `extra:${spec.key}`)
    cnRows.push({
      id: cnId,
      tenantId,
      creditNoteNo: spec.no,
      seriesCode: 'CN',
      fy: FY,
      noteDate: source.invoice_date,
      invoiceId: source.id,
      retailerId: source.retailer_id,
      reason: spec.reason,
      state: 'issued',
      taxablePaise: priced.taxable,
      cgstPaise: priced.cgst,
      sgstPaise: priced.sgst,
      igstPaise: priced.igst,
      cessPaise: priced.cess,
      roundOffPaise: money.roundOff,
      totalPaise: money.rounded,
      issuedBy: people.accountant.id,
      issuedAt: atIstTime(date, 19, 15),
      note: spec.note,
    })
    cnLineRows.push({
      id: cnLineId,
      tenantId,
      creditNoteId: cnId,
      invoiceLineId: source.line_id,
      qtyPcs: qty,
      saleable: spec.restock,
      ratePaise: rate,
      taxablePaise: priced.taxable,
      gstBps: Number(source.gst_bps),
      taxPaise: priced.cgst + priced.sgst + priced.igst + priced.cess,
      lineTotalPaise: priced.total,
    })
    postCreditNote(cnId, spec.no, source.retailer_id, date, priced, money)
    // The note settles against the bill it corrects, which is what makes the shop's dues drop.
    allocationRows.push({
      id: demoId('allocation', `credit-note:${cnId}`),
      tenantId,
      invoiceId: source.id,
      creditNoteId: cnId,
      amountPaise: money.rounded,
      allocatedAt: atIstTime(date, 19, 15),
    })
    if (spec.restock && source.lot_id) {
      ledgerRows.push({
        id: demoId('ledger', `cn:${cnId}`),
        tenantId,
        occurredAt: atIstTime(date, 19, 15),
        lotId: source.lot_id,
        locationId: godown,
        qtyDelta: qty,
        reason: 'sale_return_saleable',
        refType: 'credit_note',
        refId: cnId,
        actorId: people.accountant.id,
        idempotencyKey: `credit-note:${cnId}:${cnLineId}`,
        note: `credit note ${spec.no}`,
      })
    }
  })

  function postCreditNote(
    cnId: string,
    cnNo: string,
    retailerId: string,
    date: Date,
    priced: { taxable: number; cgst: number; sgst: number; igst: number; cess: number },
    total: { rounded: number; roundOff: number },
  ): void {
    const entryId = demoId('journal-entry', `credit-note:${cnId}`)
    entryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(date),
      refType: 'credit_note',
      refId: cnId,
      narration: `Credit note ${cnNo}`,
      idempotencyKey: `journal:credit_note:${cnId}`,
      postedBy: people.accountant.id,
      postedAt: atIstTime(date, 19, 30),
    })
    const push = (suffix: string, code: string, amountPaise: number, party = false) => {
      if (amountPaise === 0) return
      journalRows.push({
        id: demoId('journal-line', `${cnId}:${suffix}`),
        tenantId,
        entryId,
        accountId: acc(code),
        amountPaise,
        ...(party ? { partyType: 'retailer', partyId: retailerId } : {}),
      })
    }
    push('returns', 'SALES_RETURNS', priced.taxable)
    push('cgst', 'OUTPUT_CGST', priced.cgst)
    push('sgst', 'OUTPUT_SGST', priced.sgst)
    push('igst', 'OUTPUT_IGST', priced.igst)
    push('cess', 'OUTPUT_CESS', priced.cess)
    push('roundoff', 'ROUND_OFF', total.roundOff)
    push('ar', 'AR', 0 - total.rounded, true)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 7. Write everything, parents before children.

  await insertMany(db, salesOrders, orderRows)
  await insertMany(db, salesOrderLines, orderLineRows)
  await insertMany(db, invoices, invoiceRows)
  await insertMany(db, invoiceLines, lineRows)
  await insertMany(db, creditNotes, cnRows)
  await insertMany(db, creditNoteLines, cnLineRows)
  await insertMany(db, receipts, receiptRows)
  await insertMany(db, journalEntries, entryRows)
  await insertMany(db, journalLines, journalRows)
  await insertMany(db, allocations, allocationRows)
  await insertMany(db, stockLedger, ledgerRows)

  // ---------------------------------------------------------------------------------------------------------------
  // 8. The GST shapes the ordinary seed left flat: a bill carrying a buyer GSTIN is a B2B tax invoice,
  //    and the two biggest loads of the fortnight carry an e-way bill typed in from the government
  //    portal. The real threshold is a tenant setting the warehouse slice owns (₹1,00,000 for a single
  //    vehicle load in Maharashtra, coordination §7 q16); the demo simply stamps its two largest bills
  //    so the print layout and `invoices.setEwayBill` have something to show.

  await db.execute(sql`
    UPDATE invoices SET supply_type = 'B2B'
     WHERE tenant_id = ${tenantId} AND buyer_gstin IS NOT NULL AND supply_type = 'B2C'`)
  await db.execute(sql`
    UPDATE invoices
       SET eway_bill_no = '291' || lpad((abs(hashtext(invoices.id)) % 1000000000)::text, 9, '0'),
           eway_bill_valid_until = (invoices.invoice_date + interval '2 days'),
           transport_mode = 'road', vehicle_no = 'MH04AB1234'
      FROM (SELECT id FROM invoices
             WHERE tenant_id = ${tenantId} AND state <> 'cancelled'
               AND source IN ('pack', 'van_sale')
             ORDER BY total_paise DESC, id
             LIMIT 2) big
     WHERE invoices.id = big.id AND invoices.eway_bill_no IS NULL`)

  // 9. The counters end past everything this seed booked, exactly as `seedSales` does for INV/CN/SO,
  // and then past everything the DATABASE holds — the app and `pnpm smoke` issue real bills between
  // reseeds, and a counter that stops at the seed's own last number hands the next caller a number
  // the table already has, which is a 409 nobody can get past without a fresh database.
  await bumpSeries(db, tenantId, 'INV', 9004)
  await bumpSeries(db, tenantId, 'CN', 9003)
  await reconcileSeries(db, tenantId, 'INV')
  await reconcileSeries(db, tenantId, 'CN')
  await db
    .insert(numberingSeries)
    .values({
      tenantId,
      seriesCode: EXTERNAL_SERIES,
      fy: FY,
      prefix: '',
      nextNo: 1,
      allocationMode: 'external',
    })
    .onConflictDoNothing()
}

/**
 * Push a counter past the highest number ACTUALLY BOOKED in its own series and financial year. The
 * trailing digits of the document number are the counter's value (`INV/9004` → 9004); a series with a
 * different shape simply contributes nothing.
 */
async function reconcileSeries(db: Db, tenantId: string, seriesCode: string): Promise<void> {
  const table = seriesCode === 'CN' ? 'credit_notes' : 'invoices'
  const column = seriesCode === 'CN' ? 'credit_note_no' : 'invoice_no'
  await db.execute(sql`
    UPDATE numbering_series ns
       SET next_no = GREATEST(ns.next_no, coalesce((
             SELECT max((regexp_replace(d.${sql.raw(column)}, '^.*[^0-9]', ''))::bigint)
               FROM ${sql.raw(table)} d
              WHERE d.tenant_id = ns.tenant_id AND d.series_code = ns.series_code
                AND d.fy = ns.fy AND d.${sql.raw(column)} ~ '[0-9]+$'), 0) + 1)
     WHERE ns.tenant_id = ${tenantId} AND ns.series_code = ${seriesCode} AND ns.fy = ${FY}`)
}

/** `next_no` never goes BACKWARDS: another seed module may already have booked past this point. */
async function bumpSeries(
  db: Db,
  tenantId: string,
  seriesCode: string,
  nextNo: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE numbering_series SET next_no = GREATEST(next_no, ${nextNo})
     WHERE tenant_id = ${tenantId} AND series_code = ${seriesCode} AND fy = ${FY}`)
}
