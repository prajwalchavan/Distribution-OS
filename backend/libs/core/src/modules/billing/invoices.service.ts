import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { z } from 'zod'
import type {
  BillingQueueInput,
  BillingQueueOutput,
  CancelInvoiceInput,
  CancelInvoiceOutput,
  ImportBrandDmsInvoiceInput,
  ImportBrandDmsInvoiceOutput,
  InvoiceDetail,
  InvoiceGetInput,
  InvoiceGetOutput,
  InvoicePdfInput,
  InvoicePdfOutput,
  InvoicesListInput,
  InvoicesListOutput,
  InvoiceUpiQrInput,
  InvoiceUpiQrOutput,
  IssueVanSaleInvoiceInput,
  IssueVanSaleInvoiceOutput,
  RequestIrnInput,
  RequestIrnOutput,
  SellerBranding,
  SetEwayBillInput,
  SetEwayBillOutput,
} from '@dos/contracts'
import {
  allocate,
  businessDate,
  financialYear,
  paise,
  percentOf,
  roundToRupee,
  splitGst,
  uuidv7,
} from '@dos/domain'
import {
  creditNotes,
  featureFlags,
  invoiceLines,
  invoices,
  locations,
  outboxEvents,
  retailers,
  salesOrderLines,
  salesOrders,
  stockLots,
  withTenant,
  type ActorRole,
  type AppliedRule,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { createObjectStorage, ObjectStorageError } from '../../platform/object-storage.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import { ReceivablesService } from '../receivables/index.js'
import {
  addDays,
  asLedgerPoster,
  invoiceDateOf,
  invoiceTransition,
  isUniqueViolation,
  loadBuyer,
  loadHsnRates,
  loadSeller,
  loadVariantBilling,
  placeOfSupplyOf,
  upiIntent,
  type BuyerProfile,
  type VariantBilling,
} from './billing.internals.js'
import {
  loadInvoiceDetail,
  toInvoiceListItem,
  type InvoiceLineRow,
  type InvoiceRow,
} from './billing.mappers.js'

/**
 * The tax invoice. This file holds the class other modules import as `BillingService` (warehouse calls
 * `issueForPack`, delivery calls `issueFromLocation`, integrations calls `importBrandDms` and
 * `recordOpeningInvoice`); the file is named for the aggregate, the class for the module, exactly as
 * `docs/plans/00-coordination.md` §3.1 and §4 name them.
 *
 * WHAT THIS MODULE OWNS: `invoices` and `invoice_lines` (credit notes are `credit-notes.service.ts`).
 * Every rupee it moves is posted through `ReceivablesService`, every piece through `InventoryService`,
 * every order state through `OrdersService`. It never writes `journal_*`, `allocations`,
 * `cash_discount_conditions`, `stock_ledger` or `sales_orders` itself, and it never writes
 * `invoices.state` after issue — receivables owns the derived payment state (coordination §3.2).
 *
 * WHAT MAKES A BILL CORRECT, in one place:
 *  - money is integer paise and `allocate()` spreads a header amount to the paisa; one rupee rounding
 *    per invoice (s.170), never per line, with the residue on ROUND_OFF so the journal balances;
 *  - the GST split follows PLACE OF SUPPLY (`splitGst`) at the HSN rate DATED to the invoice date, so a
 *    reprint of an old bill shows the rate that applied then;
 *  - the number is taken from the tenant's configured series at ISSUE and never for a draft (ADR 0001);
 *    prefix and starting number are per-tenant configuration, never a constant here (docs/17 §D1);
 *  - the invoice never re-prices: rate, discount and `applied_rules` are copied verbatim from the order
 *    line, and only quantity and tax are recomputed (ADR 0004);
 *  - an issued invoice is immutable — the whole row is written in ONE insert, and the only later writes
 *    are the payment state, the cancellation pair and the document keys the 0003 trigger permits;
 *  - cancellation before dispatch KEEPS the number (GSTR-1 Table 13) and reverses stock and money;
 *  - every document carries the DISTRIBUTOR's own name, logo and UPI id from `tenant_settings` (§D6).
 */

type QueueIn = z.infer<typeof BillingQueueInput>
type QueueOut = z.infer<typeof BillingQueueOutput>
type VanSaleIn = z.infer<typeof IssueVanSaleInvoiceInput>
type VanSaleOut = z.infer<typeof IssueVanSaleInvoiceOutput>
type BrandDmsIn = z.infer<typeof ImportBrandDmsInvoiceInput>
type BrandDmsOut = z.infer<typeof ImportBrandDmsInvoiceOutput>
type CancelIn = z.infer<typeof CancelInvoiceInput>
type CancelOut = z.infer<typeof CancelInvoiceOutput>
type GetIn = z.infer<typeof InvoiceGetInput>
type GetOut = z.infer<typeof InvoiceGetOutput>
type ListIn = z.infer<typeof InvoicesListInput>
type ListOut = z.infer<typeof InvoicesListOutput>
type UpiIn = z.infer<typeof InvoiceUpiQrInput>
type UpiOut = z.infer<typeof InvoiceUpiQrOutput>
type PdfIn = z.infer<typeof InvoicePdfInput>
type PdfOut = z.infer<typeof InvoicePdfOutput>
type EwbIn = z.infer<typeof SetEwayBillInput>
type EwbOut = z.infer<typeof SetEwayBillOutput>
type IrnIn = z.infer<typeof RequestIrnInput>
type IrnOut = z.infer<typeof RequestIrnOutput>

/**
 * The tenant's own series KEYS. The printed prefix and the starting number are configuration on the
 * `numbering_series` row (docs/17 §D1) — these are only how billing addresses that row. `EXT` is where
 * a brand DMS's own number is filed so it never touches the tenant's counter.
 */
export const INVOICE_SERIES = 'INV'
export const EXTERNAL_INVOICE_SERIES = 'EXT'

/** A van sale uses the TENANT'S NORMAL SERIES (docs/17 §D5): `source` is the only difference. */
const BILLING_ISSUERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'system',
]
const PIN_HOLDERS: readonly ActorRole[] = ['owner', 'manager', 'system']
const DOORSTEP: readonly ActorRole[] = ['owner', 'manager', 'delivery', 'system']
const MONEY_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'retailer',
  'system',
]
export const ANY_MEMBER: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'warehouse',
  'delivery',
  'retailer',
  'system',
]

/** Once the goods have left, cancelling the bill is no longer lawful (docs/17 item 26). */
const DISPATCHED_ORDER_STATES = new Set([
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
])

/** One (order line × lot) the pack actually moved. Warehouse hands these over at step 3. */
export interface IssueForPackLine {
  orderLineId: string
  lotId: string | null
  qtyPcs: number
  freeQtyPcs: number
}

export interface IssueForPackInput {
  orderId: string
  /** `warehouse.pack_confirmations.id`, stored on the event so warehouse can stamp its own row. */
  packConfirmationId?: string | null | undefined
  lines: readonly IssueForPackLine[]
  issuedBy: string
  /** Client-generated id of the invoice; a fresh UUIDv7 when the caller has none. */
  invoiceId?: string | undefined
  invoiceDate?: string | undefined
  source?: 'pack' | 'van_sale' | undefined
  deviceId?: string | null | undefined
  transportMode?: string | null | undefined
  vehicleNo?: string | null | undefined
}

export interface IssueFromLocationInput {
  orderId: string
  /** The vehicle the crew is selling out of. Pieces leave THIS location, never the godown. */
  locationId: string
  issuedBy: string
  invoiceId?: string | undefined
  invoiceDate?: string | undefined
  deviceId?: string | null | undefined
}

export interface RecordOpeningInvoiceInput {
  id: string
  retailerId: string
  externalInvoiceNo: string
  invoiceDate: string
  amountPaise: number
  importJobId: string
  dueDate?: string | null | undefined
  seriesCode?: string | undefined
}

/** What a non-billing document may know about a bill: its number and its sale total. Never a cost. */
export interface InvoiceRef {
  id: string
  invoiceNo: string | null
  totalPaise: number
  state: InvoiceRow['state']
}

interface PricedLine {
  row: typeof invoiceLines.$inferInsert
  grossPaise: number
}

@Injectable()
export class BillingService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly receivables: ReceivablesService,
  ) {}

  // =============================================================================================================
  // the surface other modules import (coordination §3.1 and §4)
  // =============================================================================================================

  /**
   * THE DOCUMENT, and nothing else. Takes the number from the tenant's series under the row lock the
   * upsert holds, computes the GST split by place of supply at the dated HSN rate, writes one line per
   * (order line × lot) from the quantities the caller says actually moved, posts the AR entry through
   * `ReceivablesService.postInvoiceIssued` (which also writes the due date and opens the cash-discount
   * offer), and emits `InvoiceIssued`.
   *
   * It moves NO stock and NO order state: the caller has already done that. Warehouse's `packs.confirm`
   * is that caller (coordination §4 step 3) and, for the doorstep, `issueFromLocation` below. The
   * temporary `invoices.issue` procedure that used to do the stock half here is gone.
   */
  async issueForPack(tx: Db, input: IssueForPackInput): Promise<InvoiceRow> {
    const order = await this.orders.lockOrder(tx, input.orderId)
    await this.assertNoLiveInvoice(tx, order.id)
    const invoiceDate = invoiceDateOf(input.invoiceDate)
    const orderLines = await tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(asc(salesOrderLines.lineNo))
    const byId = new Map(orderLines.map((l) => [l.id, l]))
    const moved = input.lines.filter((l) => l.qtyPcs > 0 || l.freeQtyPcs > 0)
    if (moved.length === 0)
      throw new ORPCError('BAD_REQUEST', {
        message: `order ${order.id} has nothing packed to bill`,
      })
    for (const line of moved) {
      if (!byId.has(line.orderLineId))
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${line.orderLineId} does not belong to order ${order.id}`,
        })
    }

    const buyer = await loadBuyer(tx, order.retailerId)
    const seller = await loadSeller(tx)
    const placeOfSupply = placeOfSupplyOf(buyer)
    const isInterState = seller.stateCode !== placeOfSupply
    const variantIds = [...new Set(moved.map((l) => byId.get(l.orderLineId)?.variantId ?? ''))]
    const variants = await loadVariantBilling(tx, variantIds)
    const rates = await loadHsnRates(
      tx,
      [...variants.values()].map((v) => v.hsnCode),
      invoiceDate,
    )
    const lots = await this.loadLots(
      tx,
      moved.map((l) => l.lotId).filter((id) => id !== null),
    )

    const invoiceId = input.invoiceId ?? uuidv7()
    const priced: PricedLine[] = []
    for (const orderLine of orderLines) {
      const group = moved.filter((l) => l.orderLineId === orderLine.id)
      if (group.length === 0) continue
      const variant = variants.get(orderLine.variantId)
      if (!variant)
        throw new ORPCError('BAD_REQUEST', { message: `unknown variant ${orderLine.variantId}` })
      const rate = rates.get(variant.hsnCode)
      if (!rate)
        throw new ORPCError('BAD_REQUEST', { message: `no GST rate for HSN ${variant.hsnCode}` })
      for (const line of this.priceOrderLineGroup({
        invoiceId,
        orderLine,
        variant,
        rate,
        group,
        lots,
        seller,
        placeOfSupply,
        startLineNo: priced.length + 1,
      })) {
        priced.push(line)
      }
    }

    return this.writeInvoice(tx, {
      invoiceId,
      order,
      buyer,
      seller,
      placeOfSupply,
      isInterState,
      invoiceDate,
      priced,
      source: input.source ?? 'pack',
      issuedBy: input.issuedBy,
      seriesCode: INVOICE_SERIES,
      transportMode: input.transportMode ?? null,
      vehicleNo: input.vehicleNo ?? null,
      packConfirmationId: input.packConfirmationId ?? null,
    })
  }

  /**
   * The doorstep sale: the same document, from the VEHICLE's stock instead of the godown, on the
   * tenant's normal series with `source = 'van_sale'` (docs/17 §D5 — no per-vehicle series and no
   * device-allocated numbers). The van being short is a 400 from the reservation, never a negative
   * balance. Delivery (slice 4) calls this from its own trip transaction.
   */
  async issueFromLocation(tx: Db, input: IssueFromLocationInput): Promise<InvoiceRow> {
    const order = await this.orders.lockOrder(tx, input.orderId)
    if (order.source !== 'van_sale')
      throw new ORPCError('CONFLICT', {
        message: `order ${order.id} is a ${order.source} order; only a van_sale order is billed off the van`,
      })
    await this.assertVehicleLocation(tx, input.locationId)
    const invoiceId = input.invoiceId ?? uuidv7()
    const lines = await this.moveStock(tx, order.id, invoiceId, input.locationId, undefined)
    await this.orders.markPacked(tx, order, input.deviceId ?? null)
    return this.issueForPack(tx, {
      orderId: order.id,
      lines,
      issuedBy: input.issuedBy,
      invoiceId,
      source: 'van_sale',
      ...(input.invoiceDate === undefined ? {} : { invoiceDate: input.invoiceDate }),
    })
  }

  /**
   * ADR 0014 / docs/17 item 1: the brand's own DMS already issued the legal invoice, so we store it
   * VERBATIM and never create a second one — `invoice_no = external_invoice_no`, the tenant's counter is
   * untouched, and no stock moves (the goods arrive on the brand's documents, through the GRN). The AR
   * is posted normally, because the distributor still collects the money.
   */
  async importBrandDms(tx: Db, input: BrandDmsIn): Promise<InvoiceRow> {
    const { tenantId } = currentTenant()
    const [clash] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.externalInvoiceNo, input.externalInvoiceNo),
        ),
      )
      .limit(1)
    if (clash)
      throw new ORPCError('CONFLICT', {
        message: `invoice ${input.externalInvoiceNo} has been imported before (${clash.id}); a brand-DMS bill is never stored twice`,
      })

    // A DMS bill may name one of our own orders; that order may already carry a live invoice, and one
    // live invoice per order is the rule the partial unique index enforces. Checking here gives the
    // caller the order's own number instead of a bare constraint violation.
    if (input.orderId) await this.assertNoLiveInvoice(tx, input.orderId)

    const buyer = await loadBuyer(tx, input.retailerId)
    const seller = await loadSeller(tx)
    const placeOfSupply = input.placeOfSupplyState
    const isInterState = seller.stateCode !== placeOfSupply
    const variants = await loadVariantBilling(
      tx,
      input.lines.map((l) => l.variantId),
    )

    const priced: PricedLine[] = input.lines.map((line, index) => {
      const variant = variants.get(line.variantId)
      const gross = line.ratePaise * line.qtyPcs
      const taxable = gross - line.discountPaise
      if (taxable < 0)
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${String(index + 1)} discounts more than it charges`,
        })
      const gst = splitGst(paise(taxable), line.gstBps, seller.stateCode, placeOfSupply)
      const cess = percentOf(paise(taxable), line.cessBps)
      return {
        grossPaise: gross,
        row: {
          id: line.id,
          tenantId,
          invoiceId: input.id,
          lineNo: index + 1,
          orderLineId: null,
          variantId: line.variantId,
          lotId: null,
          description: line.description,
          hsnCode: line.hsnCode,
          batchNo: line.batchNo ?? null,
          expiryDate: line.expiryDate ?? null,
          mrpPaise: line.mrpPaise ?? variant?.mrpPaise ?? null,
          qtyPcs: line.qtyPcs,
          freeQtyPcs: line.freeQtyPcs,
          enteredQty: line.enteredQty ?? line.qtyPcs,
          enteredUnit: line.enteredUnit,
          packSizeAtEntry: line.packSizeAtEntry ?? 1,
          caseSize: variant?.caseSize ?? null,
          ratePaise: line.ratePaise,
          discountBps: gross > 0 ? Math.round((line.discountPaise * 10_000) / gross) : 0,
          discountPaise: line.discountPaise,
          taxablePaise: taxable,
          gstBps: line.gstBps,
          cgstPaise: gst.cgst,
          sgstPaise: gst.sgst,
          igstPaise: gst.igst,
          cessBps: line.cessBps,
          cessPaise: cess,
          lineTotalPaise: taxable + gst.tax + cess,
          appliedRules: [] as AppliedRule[],
        },
      }
    })

    return this.writeInvoice(tx, {
      invoiceId: input.id,
      order: null,
      orderId: input.orderId ?? null,
      buyer,
      seller,
      placeOfSupply,
      isInterState,
      invoiceDate: input.invoiceDate,
      priced,
      source: 'brand_dms_import',
      issuedBy: currentTenant().actorId,
      seriesCode: input.seriesCode ?? EXTERNAL_INVOICE_SERIES,
      externalInvoiceNo: input.externalInvoiceNo,
      // The brand printed the number; ours is never allocated (docs/17 item 1).
      invoiceNo: input.externalInvoiceNo,
      roundOffOverridePaise: input.roundOffPaise,
      transportMode: null,
      vehicleNo: null,
      packConfirmationId: null,
    })
  }

  /**
   * A bill carried over from whatever software the distributor is leaving (docs/17 §D7), stored so
   * bill-to-bill allocation and the ageing buckets work from day one. Integrations (slice 6) calls it
   * once per outstanding row; the money enters the books through `postOpeningBalance`, against OPENING
   * equity rather than SALES, because the sale itself was made on the old system.
   */
  async recordOpeningInvoice(tx: Db, input: RecordOpeningInvoiceInput): Promise<InvoiceRow> {
    const { tenantId } = currentTenant()
    const buyer = await loadBuyer(tx, input.retailerId)
    const seller = await loadSeller(tx)
    const [existing] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, input.id)))
      .limit(1)
    if (existing) return existing
    const [row] = await tx
      .insert(invoices)
      .values({
        id: input.id,
        tenantId,
        invoiceNo: input.externalInvoiceNo,
        seriesCode: input.seriesCode ?? EXTERNAL_INVOICE_SERIES,
        fy: financialYear(new Date(`${input.invoiceDate}T00:00:00.000+05:30`)),
        invoiceDate: input.invoiceDate,
        orderId: null,
        retailerId: buyer.id,
        source: 'import',
        externalInvoiceNo: input.externalInvoiceNo,
        state: invoiceTransition('draft', 'issue'),
        supplyType: buyer.gstin ? 'B2B' : 'B2C',
        sellerGstin: seller.gstin,
        buyerGstin: buyer.gstin,
        buyerName: buyer.name,
        buyerAddress: buyer.address,
        placeOfSupplyState: placeOfSupplyOf(buyer),
        buyerFssai: buyer.fssai,
        sellerFssai: seller.fssai,
        isInterState: seller.stateCode !== placeOfSupplyOf(buyer),
        // An opening balance is a carried-forward amount, not a taxable supply we are declaring again.
        subtotalPaise: input.amountPaise,
        taxablePaise: 0,
        totalPaise: input.amountPaise,
        dueDate: input.dueDate ?? input.invoiceDate,
        issuedAt: new Date(),
      })
      .returning()
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'opening invoice insert returned nothing',
      })
    await this.receivables.postOpeningBalance(tx, {
      retailerId: buyer.id,
      invoiceId: row.id,
      amountPaise: input.amountPaise,
      asOfDate: input.invoiceDate,
      importJobId: input.importJobId,
    })
    await this.emit(tx, row, 'InvoiceIssued', { importJobId: input.importJobId })
    return row
  }

  // =============================================================================================================
  // procedures
  // =============================================================================================================

  /**
   * The billing desk's "to bill" list: confirmed / picking / packed orders that have no ISSUED bill.
   * An order whose bill is still a draft stays in the queue with `hasDraftInvoice`, because it is still
   * work; an order with an issued bill has left the desk, and a cancelled bill puts it back.
   */
  async queue(input: QueueIn): Promise<QueueOut> {
    requireRole(BILLING_ISSUERS)
    const db = requireDb(this.db)
    const { tenantId } = currentTenant()
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(salesOrders.tenantId, tenantId),
        inArray(salesOrders.state, ['confirmed', 'picking', 'packed']),
        input.locationId ? eq(salesOrders.fulfilFromLocationId, input.locationId) : undefined,
        input.retailerId ? eq(salesOrders.retailerId, input.retailerId) : undefined,
        input.cursor ? sql`${salesOrders.id} > ${input.cursor}` : undefined,
        sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = ${tenantId}
              AND i.order_id = ${salesOrders.id} AND i.state NOT IN ('cancelled', 'draft'))`,
      ]
      const rows = await tx
        .select({
          orderId: salesOrders.id,
          orderNo: salesOrders.orderNo,
          retailerId: salesOrders.retailerId,
          retailerName: retailers.name,
          state: salesOrders.state,
          orderTotalPaise: salesOrders.totalPaise,
          expectedDeliveryDate: salesOrders.expectedDeliveryDate,
          lineCount: sql<number>`(SELECT count(*)::int FROM sales_order_lines l WHERE l.order_id = ${salesOrders.id})`,
          hasDraftInvoice: sql<boolean>`EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = ${tenantId}
              AND i.order_id = ${salesOrders.id} AND i.state = 'draft')`,
        })
        .from(salesOrders)
        .innerJoin(retailers, eq(retailers.id, salesOrders.retailerId))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(salesOrders.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map((r) => ({
        orderId: r.orderId,
        orderNo: r.orderNo,
        retailerId: r.retailerId,
        retailerName: r.retailerName,
        state: r.state,
        lineCount: Number(r.lineCount),
        orderTotalPaise: r.orderTotalPaise,
        expectedDeliveryDate: r.expectedDeliveryDate,
        hasDraftInvoice: Boolean(r.hasDraftInvoice),
      }))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.orderId : null }
    })
  }

  // THE TEMPORARY `issue` PROCEDURE IS GONE (coordination §4 step 3). Billing did the reserve →
  // `postReservationAsSale` → `markPacked` half itself while the warehouse module did not exist; that
  // half now belongs to `warehouse.packs.confirm`, which posts the picked pieces through
  // `InventoryService.postPick`, advances the order through `OrdersService.applyFulfilmentEvent('pack')`
  // and then calls `issueForPack` above for the document. Two HTTP callers would post `sale` rows for
  // one order and stock would leave the godown twice, so this is deliberately not replaced.

  async issueVanSale(input: VanSaleIn): Promise<VanSaleOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.issueFromLocation(tx, {
          orderId: input.orderId,
          locationId: input.vehicleLocationId,
          issuedBy: ctx.actorId,
          invoiceId: input.id,
          ...(input.invoiceDate === undefined ? {} : { invoiceDate: input.invoiceDate }),
          ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        })
        return { item: await this.detail(tx, row) }
      }),
    )
  }

  async importBrandDmsInvoice(input: BrandDmsIn): Promise<BrandDmsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.importBrandDms(tx, input)
        return { item: await this.detail(tx, row) }
      }),
    )
  }

  /**
   * Cancellation is lawful only before the goods leave and before a rupee is allocated. The NUMBER
   * SURVIVES (GSTR-1 Table 13): the row keeps `invoice_no` and gains `cancelled_at` / `cancel_reason`,
   * which are the only columns the 0003 immutability trigger permits. The pieces come back on
   * compensating ledger rows and the money on a reversing journal entry, so the order returns to the
   * billing queue with nothing left over.
   */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const invoice = await this.lockInvoice(tx, input.id)
        if (invoice.state === 'cancelled') return { item: await this.detail(tx, invoice) }
        // The business refusals come FIRST so the message says why; `invoiceMachine` then has the last
        // word, which is what stops a `paid` bill being cancelled by a rule nobody wrote down here.
        if (invoice.orderId) {
          const order = await this.orders.findOrder(tx, invoice.orderId)
          if (order && DISPATCHED_ORDER_STATES.has(order.state))
            throw new ORPCError('CONFLICT', {
              message: `order ${order.id} is ${order.state}; after dispatch the only correction is a credit note`,
            })
        }
        const outstanding = await this.receivables.invoiceOutstandingPaise(tx, invoice.id)
        if (outstanding < invoice.totalPaise)
          throw new ORPCError('CONFLICT', {
            message: `bill ${invoice.invoiceNo ?? invoice.id} has money allocated against it; raise a credit note instead`,
          })
        const [note] = await tx
          .select({ id: creditNotes.id })
          .from(creditNotes)
          .where(
            and(
              eq(creditNotes.tenantId, ctx.tenantId),
              eq(creditNotes.invoiceId, invoice.id),
              ne(creditNotes.state, 'cancelled'),
            ),
          )
          .limit(1)
        if (note)
          throw new ORPCError('CONFLICT', {
            message: `bill ${invoice.invoiceNo ?? invoice.id} already carries a credit note; it cannot be cancelled`,
          })

        const to = invoiceTransition(invoice.state, 'cancel')
        await this.restock(tx, invoice, input.restockLocationId)
        await this.reverseInvoiceEntry(tx, invoice)
        const [cancelled] = await tx
          .update(invoices)
          .set({
            state: to,
            cancelledAt: new Date(),
            cancelReason: input.reason,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, invoice.id)))
          .returning()
        const row = cancelled ?? invoice
        await this.receivables.refreshOutstanding(tx, row.retailerId)
        await this.emit(tx, row, 'InvoiceCancelled', { reason: input.reason })
        return { item: await this.detail(tx, row) }
      }),
    )
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await this.findInvoice(tx, input.id)
      return { item: await this.detail(tx, row) }
    })
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const { tenantId } = currentTenant()
    return withTenant(db, currentTenant(), async (tx) => {
      const today = businessDate().date
      const filters: (SQL | undefined)[] = [
        eq(invoices.tenantId, tenantId),
        input.retailerId ? eq(invoices.retailerId, input.retailerId) : undefined,
        input.orderId ? eq(invoices.orderId, input.orderId) : undefined,
        input.state ? eq(invoices.state, input.state) : undefined,
        input.source ? eq(invoices.source, input.source) : undefined,
        input.from ? gte(invoices.invoiceDate, input.from) : undefined,
        input.to ? lte(invoices.invoiceDate, input.to) : undefined,
        input.openOnly ? inArray(invoices.state, ['issued', 'partially_paid']) : undefined,
        input.overdueOnly
          ? and(inArray(invoices.state, ['issued', 'partially_paid']), lt(invoices.dueDate, today))
          : undefined,
        input.q
          ? or(
              ilike(invoices.invoiceNo, `%${input.q}%`),
              ilike(invoices.externalInvoiceNo, `%${input.q}%`),
              ilike(invoices.buyerName, `%${input.q}%`),
            )
          : undefined,
        input.cursor ? lt(invoices.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(invoices)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(invoices.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const due = await this.outstandingByInvoice(tx, page)
      const items = page.map((row) => toInvoiceListItem(row, due.get(row.id) ?? 0))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /**
   * The QR for what is STILL DUE, recomputed now — `invoices.upi_qr_payload` is the snapshot printed on
   * the bill and goes stale the moment a rupee lands. `payload` is null, never an invented VPA, when the
   * tenant has not configured one; the payee is the DISTRIBUTOR's own display name (docs/17 §D6).
   */
  async upiQr(input: UpiIn): Promise<UpiOut> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await this.findInvoice(tx, input.id)
      const seller = await loadSeller(tx)
      const amountPaise = await this.amountDue(tx, row)
      return {
        payload: upiIntent({
          vpa: seller.upiVpa,
          payeeName: seller.displayName,
          amountPaise,
          reference: row.invoiceNo,
        }),
        amountPaise,
        vpa: seller.upiVpa,
        payeeName: seller.displayName,
        invoiceNo: row.invoiceNo,
      }
    })
  }

  /**
   * Nothing renders on the request path (scale rule 3). A bill whose PDF exists answers with a
   * pre-signed link; otherwise `queued`, which is a normal state and never an error — the renderer is
   * a separate slice after these ten (coordination §3.4).
   */
  async pdf(input: PdfIn): Promise<PdfOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await this.findInvoice(tx, input.id)
      const key = row.pdfObjectKey
      if (!key) return { status: 'queued' as const, objectKey: null, url: null, expiresAt: null }
      try {
        const storage = createObjectStorage()
        const url = await storage.getUrl(key)
        return {
          status: 'ready' as const,
          objectKey: key,
          url,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        }
      } catch (error) {
        if (error instanceof ObjectStorageError)
          return { status: 'queued' as const, objectKey: key, url: null, expiresAt: null }
        throw error
      }
    })
  }

  /** Manual entry from the government portal (docs/17 A8): only the four transport columns move. */
  async setEwayBill(input: EwbIn): Promise<EwbOut> {
    requireRole(BILLING_ISSUERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const invoice = await this.lockInvoice(tx, input.id)
        if (invoice.state === 'cancelled')
          throw new ORPCError('CONFLICT', {
            message: `bill ${invoice.invoiceNo ?? invoice.id} is cancelled`,
          })
        const [updated] = await tx
          .update(invoices)
          .set({
            ewayBillNo: input.ewayBillNo,
            ewayBillValidUntil: new Date(input.validUntil),
            transportMode: input.transportMode ?? invoice.transportMode,
            vehicleNo: input.vehicleNo ?? invoice.vehicleNo,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, invoice.id)))
          .returning()
        return { item: await this.detail(tx, updated ?? invoice) }
      }),
    )
  }

  /**
   * A LOCAL STUB, never an external call. With the `e_invoicing` flag off it writes nothing; with it on
   * it writes a deterministic placeholder so the print layout and the integrations module can be
   * finished before a GSP contract exists. Replacing it is a change to this method alone.
   */
  async requestIrn(input: IrnIn): Promise<IrnOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const invoice = await this.lockInvoice(tx, input.id)
        const [flag] = await tx
          .select({ enabled: featureFlags.enabled })
          .from(featureFlags)
          .where(and(eq(featureFlags.tenantId, ctx.tenantId), eq(featureFlags.flag, 'e_invoicing')))
          .limit(1)
        if (!flag?.enabled) {
          return {
            status: 'skipped' as const,
            irn: null,
            ackNo: null,
            ackDate: null,
            signedQr: null,
            reason: 'e-invoicing is not enabled for this distributor',
          }
        }
        if (invoice.state === 'cancelled' || invoice.invoiceNo === null) {
          return {
            status: 'skipped' as const,
            irn: null,
            ackNo: null,
            ackDate: null,
            signedQr: null,
            reason: 'an e-invoice needs an issued, uncancelled bill with a number',
          }
        }
        if (invoice.irn) {
          return {
            status: 'ready' as const,
            irn: invoice.irn,
            ackNo: invoice.ackNo,
            ackDate: invoice.ackDate?.toISOString() ?? null,
            signedQr: invoice.signedQr,
            reason: null,
          }
        }
        const irn = createHash('sha256')
          .update(`${invoice.sellerGstin ?? ''}:${invoice.invoiceNo}:${invoice.fy}`)
          .digest('hex')
        const ackNo = `STUB${irn.slice(0, 10).replace(/\D/g, '0').padEnd(10, '0').slice(0, 10)}`
        const ackDate = new Date()
        await tx
          .update(invoices)
          .set({ irn, ackNo, ackDate, updatedAt: new Date() })
          .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.id, invoice.id)))
        return {
          status: 'stubbed' as const,
          irn,
          ackNo,
          ackDate: ackDate.toISOString(),
          signedQr: null,
          reason: 'local placeholder: no GSP is wired up yet',
        }
      }),
    )
  }

  // =============================================================================================================
  // shared internals
  // =============================================================================================================

  /** The bill with its lines, its credit notes, what is still due and the seller's own branding. */
  async detail(tx: Db, row: InvoiceRow): Promise<InvoiceDetail> {
    const seller = await loadSeller(tx)
    return loadInvoiceDetail(tx, row, seller, await this.amountDue(tx, row))
  }

  /** A draft was never posted to AR and a cancelled bill was reversed: neither owes anything. */
  private async amountDue(tx: Db, row: InvoiceRow): Promise<number> {
    if (row.state === 'draft' || row.state === 'cancelled') return 0
    return this.receivables.invoiceOutstandingPaise(tx, row.id)
  }

  /**
   * What a whole page of bills still owes, in ONE query. `allocations` is receivables' table, so this
   * goes through `ReceivablesService.invoiceOutstandingMany` (coordination §3.1: methods other slices
   * need are added to receivables' own files rather than invented twice) instead of an N+1 loop.
   */
  private async outstandingByInvoice(
    tx: Db,
    rows: readonly InvoiceRow[],
  ): Promise<Map<string, number>> {
    const live = rows.filter((r) => r.state !== 'draft' && r.state !== 'cancelled')
    if (live.length === 0) return new Map()
    return this.receivables.invoiceOutstandingMany(
      tx,
      live.map((r) => r.id),
    )
  }

  async findInvoice(tx: Db, id: string): Promise<InvoiceRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `invoice ${id} not found` })
    return row
  }

  /**
   * The number and the total of a handful of bills, for a document that names them without being
   * billing (coordination §4: WAREHOUSE's pack list and load sheet). Sale values only — no cost, no
   * margin, nothing a picker may not see — and bounded by the caller's own page size, which is why the
   * warehouse never selects from `invoices` itself.
   */
  async invoiceRefs(tx: Db, invoiceIds: readonly string[]): Promise<Map<string, InvoiceRef>> {
    const ids = [...new Set(invoiceIds)]
    if (ids.length === 0) return new Map()
    const { tenantId } = currentTenant()
    const rows = await tx
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        totalPaise: invoices.totalPaise,
        state: invoices.state,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, ids)))
    return new Map(rows.map((r) => [r.id, r]))
  }

  private async lockInvoice(tx: Db, id: string): Promise<InvoiceRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `invoice ${id} not found` })
    return row
  }

  private async assertNoLiveInvoice(tx: Db, orderId: string): Promise<void> {
    const { tenantId } = currentTenant()
    const [live] = await tx
      .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, state: invoices.state })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.orderId, orderId),
          ne(invoices.state, 'cancelled'),
        ),
      )
      .limit(1)
    if (live)
      throw new ORPCError('CONFLICT', {
        message: `order ${orderId} is already billed as ${live.invoiceNo ?? live.id} (${live.state})`,
      })
  }

  private async warehouseLocation(tx: Db): Promise<string> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenantId),
          eq(locations.kind, 'warehouse'),
          eq(locations.active, true),
        ),
      )
      .orderBy(asc(locations.id))
      .limit(1)
    if (!row)
      throw new ORPCError('BAD_REQUEST', {
        message: 'this distributor has no active warehouse location (bootstrap it first)',
      })
    return row.id
  }

  private async assertVehicleLocation(tx: Db, locationId: string): Promise<void> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ kind: locations.kind })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `location ${locationId} not found` })
    if (row.kind !== 'vehicle')
      throw new ORPCError('BAD_REQUEST', {
        message: `location ${locationId} is a ${row.kind}; a van sale leaves a vehicle`,
      })
  }

  /**
   * Hold the pieces that are actually going out and post them as `sale` rows, returning the (order line
   * × lot) split the document is written from. Reservations are released and retaken so a short pack
   * gives the unshipped pieces straight back to the shelf; `InventoryService` is the only thing that
   * touches `stock_ledger` and `stock_balances`, which is what keeps the pair consistent.
   */
  private async moveStock(
    tx: Db,
    orderId: string,
    invoiceId: string,
    locationId: string,
    packed: Map<string, number> | undefined,
  ): Promise<IssueForPackLine[]> {
    const lines = await tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, orderId))
      .orderBy(asc(salesOrderLines.lineNo))
    const out: IssueForPackLine[] = []
    for (const line of lines) {
      const requestedPaid = Math.min(
        packed?.get(line.id) ?? (line.pickedQtyPcs > 0 ? line.pickedQtyPcs : line.qtyPcs),
        line.qtyPcs,
      )
      // Free goods of the same variant ship with the paid pieces, in proportion to what is packed.
      const free =
        line.qtyPcs > 0
          ? Math.floor((line.freeQtyPcs * requestedPaid) / line.qtyPcs)
          : line.freeQtyPcs
      const total = requestedPaid + free
      await this.inventory.releaseReservation(tx, line.id)
      if (total <= 0) continue
      await this.inventory.reserve(tx, {
        orderLineId: line.id,
        variantId: line.variantId,
        locationId,
        qtyPcs: total,
      })
      const posted = await this.inventory.postReservationAsSale(
        tx,
        line.id,
        'invoice',
        invoiceId,
        `invoice:${invoiceId}`,
      )
      let paidLeft = requestedPaid
      for (const entry of posted.entries) {
        const moved = Math.abs(entry.qtyDelta)
        const paid = Math.min(paidLeft, moved)
        paidLeft -= paid
        out.push({
          orderLineId: line.id,
          lotId: entry.lotId,
          qtyPcs: paid,
          freeQtyPcs: moved - paid,
        })
      }
    }
    return out
  }

  private async loadLots(
    tx: Db,
    lotIds: readonly string[],
  ): Promise<Map<string, typeof stockLots.$inferSelect>> {
    const ids = [...new Set(lotIds)]
    if (ids.length === 0) return new Map()
    const rows = await tx.select().from(stockLots).where(inArray(stockLots.id, ids))
    return new Map(rows.map((r) => [r.id, r]))
  }

  /**
   * One order line becomes one invoice line PER LOT the pieces left from, with the batch, expiry and
   * MRP frozen from that lot. The order line's discount scales with what was actually packed
   * (`allocate`, largest remainder, no paisa lost) and is then split across the lots the same way, so
   * the header is a plain sum of its lines.
   */
  private priceOrderLineGroup(i: {
    invoiceId: string
    orderLine: typeof salesOrderLines.$inferSelect
    variant: VariantBilling
    rate: { gstBps: number; cessBps: number }
    group: readonly IssueForPackLine[]
    lots: Map<string, typeof stockLots.$inferSelect>
    seller: SellerBranding
    placeOfSupply: string
    startLineNo: number
  }): PricedLine[] {
    const { tenantId } = currentTenant()
    const paidQtys = i.group.map((g) => g.qtyPcs)
    const packedPaid = paidQtys.reduce((s, q) => s + q, 0)
    const ordered = i.orderLine.qtyPcs
    const shortfall = Math.max(0, ordered - packedPaid)
    const groupDiscount =
      i.orderLine.discountPaise === 0 || packedPaid === 0
        ? 0
        : shortfall === 0
          ? i.orderLine.discountPaise
          : (allocate(paise(i.orderLine.discountPaise), [packedPaid, shortfall])[0] ?? 0)
    const weights = packedPaid > 0 ? paidQtys : i.group.map((g) => g.freeQtyPcs)
    const perLot =
      groupDiscount === 0 || weights.every((w) => w === 0)
        ? weights.map(() => 0)
        : allocate(paise(groupDiscount), weights)

    return i.group.map((g, index) => {
      const lot = g.lotId === null ? undefined : i.lots.get(g.lotId)
      const discount = perLot[index] ?? 0
      const gross = i.orderLine.ratePaise * g.qtyPcs
      const taxable = gross - discount
      const gst = splitGst(paise(taxable), i.rate.gstBps, i.seller.stateCode, i.placeOfSupply)
      const cess = percentOf(paise(taxable), i.rate.cessBps)
      const packSize = i.orderLine.packSizeAtEntry
      // "2 cs + 3 pcs" must still print honestly after a short pack (docs/17 A3).
      const divides = packSize > 1 && g.qtyPcs > 0 && g.qtyPcs % packSize === 0
      return {
        grossPaise: gross,
        row: {
          id: uuidv7(),
          tenantId,
          invoiceId: i.invoiceId,
          lineNo: i.startLineNo + index,
          orderLineId: i.orderLine.id,
          variantId: i.orderLine.variantId,
          lotId: g.lotId,
          description: i.variant.description,
          hsnCode: i.variant.hsnCode,
          batchNo: lot?.batchNo ?? null,
          expiryDate: lot?.expiryDate ?? null,
          mrpPaise: lot?.mrpPaise ?? i.variant.mrpPaise ?? null,
          qtyPcs: g.qtyPcs,
          freeQtyPcs: g.freeQtyPcs,
          enteredQty: divides ? g.qtyPcs / packSize : g.qtyPcs,
          enteredUnit: divides ? i.orderLine.enteredUnit : ('piece' as const),
          packSizeAtEntry: divides ? packSize : 1,
          caseSize: lot?.caseSize ?? i.variant.caseSize,
          ratePaise: i.orderLine.ratePaise,
          discountBps: gross > 0 ? Math.round((discount * 10_000) / gross) : 0,
          discountPaise: discount,
          taxablePaise: taxable,
          gstBps: i.rate.gstBps,
          cgstPaise: gst.cgst,
          sgstPaise: gst.sgst,
          igstPaise: gst.igst,
          cessBps: i.rate.cessBps,
          cessPaise: cess,
          lineTotalPaise: taxable + gst.tax + cess,
          appliedRules: i.orderLine.appliedRules,
        },
      }
    })
  }

  /**
   * The single INSERT that makes the bill. Everything above it is arithmetic; from here the row is
   * immutable by database trigger, so nothing may be filled in afterwards. The number is taken LAST,
   * inside this transaction, so a refusal earlier never burns one (ADR 0001).
   */
  private async writeInvoice(
    tx: Db,
    i: {
      invoiceId: string
      order: { id: string; retailerId: string } | null
      orderId?: string | null
      buyer: BuyerProfile
      seller: SellerBranding
      placeOfSupply: string
      isInterState: boolean
      invoiceDate: string
      priced: readonly PricedLine[]
      source: 'pack' | 'van_sale' | 'brand_dms_import' | 'import'
      issuedBy: string
      seriesCode: string
      externalInvoiceNo?: string
      invoiceNo?: string
      roundOffOverridePaise?: number
      transportMode: string | null
      vehicleNo: string | null
      packConfirmationId: string | null
    },
  ): Promise<InvoiceRow> {
    const { tenantId } = currentTenant()
    if (i.priced.length === 0)
      throw new ORPCError('BAD_REQUEST', { message: 'an invoice needs at least one line' })
    const sum = (pick: (l: PricedLine) => number): number =>
      i.priced.reduce((s, l) => s + pick(l), 0)
    const subtotal = sum((l) => l.grossPaise)
    const discount = sum((l) => l.row.discountPaise ?? 0)
    const taxable = sum((l) => l.row.taxablePaise)
    const cgst = sum((l) => l.row.cgstPaise ?? 0)
    const sgst = sum((l) => l.row.sgstPaise ?? 0)
    const igst = sum((l) => l.row.igstPaise ?? 0)
    const cess = sum((l) => l.row.cessPaise ?? 0)
    // s.170: ONE rounding per invoice, the residue to ROUND_OFF so the journal balances to the paisa.
    const beforeRounding = paise(taxable + cgst + sgst + igst + cess)
    const rounded = roundToRupee(beforeRounding)
    const roundOff = i.roundOffOverridePaise ?? rounded.roundOff
    const totalPaise =
      i.roundOffOverridePaise === undefined ? rounded.rounded : beforeRounding + roundOff

    const at = new Date(`${i.invoiceDate}T12:00:00.000+05:30`)
    const invoiceNo = i.invoiceNo ?? (await nextDocumentNumber(tx, i.seriesCode, at))
    const cashDiscountBps = i.buyer.cashDiscountBps
    const cashDiscountUntil =
      cashDiscountBps > 0 ? addDays(i.invoiceDate, i.buyer.cashDiscountDays) : null
    const dueDate = addDays(i.invoiceDate, i.buyer.creditDays)
    const upiQrPayload = upiIntent({
      vpa: i.seller.upiVpa,
      payeeName: i.seller.displayName,
      amountPaise: totalPaise,
      reference: invoiceNo,
    })

    let row: InvoiceRow | undefined
    try {
      ;[row] = await tx
        .insert(invoices)
        .values({
          id: i.invoiceId,
          tenantId,
          invoiceNo,
          seriesCode: i.seriesCode,
          fy: financialYear(at),
          invoiceDate: i.invoiceDate,
          orderId: i.order?.id ?? i.orderId ?? null,
          retailerId: i.buyer.id,
          source: i.source,
          externalInvoiceNo: i.externalInvoiceNo ?? null,
          state: invoiceTransition('draft', 'issue'),
          supplyType: i.buyer.gstin ? 'B2B' : 'B2C',
          sellerGstin: i.seller.gstin,
          buyerGstin: i.buyer.gstin,
          buyerName: i.buyer.name,
          buyerAddress: i.buyer.address,
          placeOfSupplyState: i.placeOfSupply,
          buyerFssai: i.buyer.fssai,
          sellerFssai: i.seller.fssai,
          isInterState: i.isInterState,
          subtotalPaise: subtotal,
          discountPaise: discount,
          taxablePaise: taxable,
          cgstPaise: cgst,
          sgstPaise: sgst,
          igstPaise: igst,
          cessPaise: cess,
          roundOffPaise: roundOff,
          totalPaise,
          cashDiscountBps,
          cashDiscountUntil,
          dueDate,
          transportMode: i.transportMode,
          vehicleNo: i.vehicleNo,
          upiQrPayload,
          issuedBy: i.issuedBy,
          issuedAt: new Date(),
        })
        .returning()
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ORPCError('CONFLICT', {
          message: `this order is already billed, or document number ${invoiceNo} is already booked in series ${i.seriesCode}`,
        })
      throw error
    }
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'invoice insert returned nothing' })
    await tx.insert(invoiceLines).values(i.priced.map((l) => l.row))
    const rowRef = row

    // The warehouse role may issue a bill but may not write the books (coordination §5.3 vs §6).
    await asLedgerPoster(tx, () =>
      this.receivables.postInvoiceIssued(tx, {
        id: rowRef.id,
        retailerId: rowRef.retailerId,
        invoiceDate: rowRef.invoiceDate,
        subtotalPaise: rowRef.subtotalPaise,
        discountPaise: rowRef.discountPaise,
        cgstPaise: rowRef.cgstPaise,
        sgstPaise: rowRef.sgstPaise,
        igstPaise: rowRef.igstPaise,
        cessPaise: rowRef.cessPaise,
        roundOffPaise: rowRef.roundOffPaise,
        totalPaise: rowRef.totalPaise,
        dueDate: rowRef.dueDate,
        cashDiscountBps: rowRef.cashDiscountBps,
        cashDiscountUntil: rowRef.cashDiscountUntil,
      }),
    )
    await this.emit(tx, row, 'InvoiceIssued', {
      packConfirmationId: i.packConfirmationId,
    })
    return row
  }

  /**
   * The mirror of `postInvoiceIssued`, line for line, so the pair nets to zero in the books. Built from
   * the invoice's own columns rather than by reading the original entry: the amounts are frozen on an
   * issued bill, and a reversal that reads nothing cannot disagree with what was posted.
   */
  private async reverseInvoiceEntry(tx: Db, invoice: InvoiceRow): Promise<void> {
    await asLedgerPoster(tx, () =>
      this.receivables.postEntry(tx, {
        entryDate: businessDate().date,
        refType: 'invoice_cancel',
        refId: invoice.id,
        narration: `cancels invoice ${invoice.invoiceNo ?? invoice.id}`,
        idempotencyKey: `journal:invoice-cancel:${invoice.id}`,
        lines: [
          {
            accountCode: 'AR',
            amountPaise: -invoice.totalPaise,
            partyType: 'retailer',
            partyId: invoice.retailerId,
          },
          { accountCode: 'DISCOUNTS', amountPaise: -invoice.discountPaise },
          { accountCode: 'SALES', amountPaise: invoice.subtotalPaise },
          { accountCode: 'OUTPUT_CGST', amountPaise: invoice.cgstPaise },
          { accountCode: 'OUTPUT_SGST', amountPaise: invoice.sgstPaise },
          { accountCode: 'OUTPUT_IGST', amountPaise: invoice.igstPaise },
          { accountCode: 'OUTPUT_CESS', amountPaise: invoice.cessPaise },
          { accountCode: 'ROUND_OFF', amountPaise: invoice.roundOffPaise },
        ],
      }),
    )
  }

  /**
   * The goods come back where the caller says, or to the location the order shipped from. Quantities are
   * summed PER LOT so two invoice lines drawn from the same batch produce one compensating row under one
   * deterministic key — a replay can never double-count.
   */
  private async restock(
    tx: Db,
    invoice: InvoiceRow,
    restockLocationId: string | undefined,
  ): Promise<void> {
    const lines = await tx
      .select({
        lotId: invoiceLines.lotId,
        qtyPcs: invoiceLines.qtyPcs,
        freeQtyPcs: invoiceLines.freeQtyPcs,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
    const byLot = new Map<string, number>()
    for (const line of lines) {
      if (!line.lotId) continue
      byLot.set(line.lotId, (byLot.get(line.lotId) ?? 0) + line.qtyPcs + line.freeQtyPcs)
    }
    if (byLot.size === 0) return
    const locationId =
      restockLocationId ??
      (invoice.orderId
        ? ((await this.orders.findOrder(tx, invoice.orderId))?.fulfilFromLocationId ??
          (await this.warehouseLocation(tx)))
        : await this.warehouseLocation(tx))
    await this.inventory.post(
      tx,
      [...byLot].map(([lotId, qty]) => ({
        lotId,
        locationId,
        qtyDelta: qty,
        reason: 'adjustment' as const,
        refType: 'invoice_cancel',
        refId: invoice.id,
        idempotencyKey: `invoice-cancel:${invoice.id}:${lotId}:${locationId}`,
        note: `cancelled invoice ${invoice.invoiceNo ?? invoice.id}`,
      })),
    )
  }

  /** Other modules react to a bill through these events, never by reading `invoices` (docs/16 §2). */
  private async emit(
    tx: Db,
    row: InvoiceRow,
    eventType: 'InvoiceIssued' | 'InvoiceCancelled',
    extra: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      tenantId: currentTenant().tenantId,
      aggregateType: 'invoice',
      aggregateId: row.id,
      eventType,
      payload: {
        invoiceId: row.id,
        invoiceNo: row.invoiceNo,
        seriesCode: row.seriesCode,
        fy: row.fy,
        orderId: row.orderId,
        retailerId: row.retailerId,
        source: row.source,
        totalPaise: row.totalPaise,
        dueDate: row.dueDate,
        isInterState: row.isInterState,
        placeOfSupplyState: row.placeOfSupplyState,
        ...extra,
      },
    })
  }
}

export type { InvoiceLineRow, InvoiceRow }
