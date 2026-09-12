import { oc } from '@orpc/contract'
import { z } from 'zod'
import { InvoiceCopySchema, InvoiceFormatSchema } from './billing.js'
import {
  BpsSchema,
  DocumentRenderOutput,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { OrderStateSchema } from './orders.js'
import { SellerBrandingSchema } from './tenancy.js'

/**
 * Warehouse — outbound fulfilment. It turns confirmed sales orders into picked, packed, invoiced and
 * loaded goods, and it is the only module that writes `picklists`, `pick_lines`, `pack_confirmations`,
 * `load_sheets` and `delivery_challans`. It never reads `sales_orders`, `invoices`, `reservations` or
 * `stock_balances` directly: `OrdersService`, `InventoryService` and `BillingService.issueForPack` are
 * the only doors (coordination §4).
 *
 * WHICH SERVICES MOUNT `warehouse` (docs/plans/00-coordination.md §6 table):
 *
 *   owner :3001      YES — the whole surface, including the manager's-PIN steps
 *   manager :3002    YES — manager + accountant: the manager APPROVES the load-out from this app
 *                    (`loadSheets.approve`, the manager's PIN — docs/22 decision 2026-09-05) and cancels
 *                    a wave or a sheet; the accountant reads the packs, the sheets and the challan
 *                    register (never a write)
 *   sales :3003      NO  — a rep never sees the godown floor. A shop's order state reaches the rep
 *                    through `orders.get` / `orders.list`, which is where "being picked" is visible
 *   warehouse :3004  YES — the primary app: queue, picklists, picking, packing, load sheets. The
 *                    warehouse device CONFIRMS the load-out (`loadSheets.confirm`, the crew's count at
 *                    the gate) but only after the manager has approved the sheet from the manager app;
 *                    it never approves, never cancels a wave or a sheet
 *   delivery :3005   YES — READS ONLY: `packs.list/get`, `loadSheets.list/get` and `challans.list/get`
 *                    are what was packed for the crew, its load sheet and the paperwork it carries.
 *                    Every other procedure refuses the delivery role in PERMISSIONS, so mounting the
 *                    key exposes no write and no picking surface at all
 *   retailer :3006   NO  — a shopkeeper is not in the room at all. It learns that its order is being
 *                    packed or has been dispatched from `orders.get`, never from a warehouse endpoint.
 *                    `staffReadPolicy` on all five tables is the database half of the same rule
 *
 * COORDINATION FACTS THAT SHAPE THIS FILE:
 *
 *  1. `packs.confirm` IS THE HAND-OVER (§4 step 3). It does the stock-and-state half — `postPick`,
 *     `recordPick`, `applyFulfilmentEvent('pack')` — and then calls `BillingService.issueForPack` for
 *     the document. The temporary `billing.invoices.issue` procedure is REMOVED with this slice, so
 *     this is the only way a pack invoice is issued and stock leaves exactly once per pack.
 *  2. WAREHOUSE DISPATCHES, not delivery (§5 item 4). `packed → dispatched` happens at
 *     `loadSheets.confirm`, when the goods physically leave with a challan; `delivery.trips.depart`
 *     treats an already-dispatched order as a no-op.
 *  2b. THE MANAGER'S PIN IS GIVEN IN THE MANAGER APP (docs/22 decision 2026-09-05, docs/23 §4.3 option
 *     a): `loadSheets.approve` (PIN_HOLDERS: owner, manager) marks a draft sheet approved with
 *     `approvedBy` / `approvedAt`; `loadSheets.confirm` (STOCK_KEEPERS, so the warehouse phone may call
 *     it) refuses an unapproved sheet with 409 `approval_required` and, when the crew's count differs
 *     from `expectedPackages`, needs a `varianceNote` and records `pinVerifiedBy = approvedBy` — the
 *     manager who approved the sheet owns its variance in the day-end register. Nothing is typed on the
 *     warehouse phone that is not the count. `auth.stepUp` is therefore not built.
 *  3. GODOWN → VEHICLE IS `transfer_out` + `transfer_in` (§5 item 5), keyed `load:<sheetId>:<lotId>:out`
 *     and `:in`. `van_load` / `van_unload` belong to delivery's on-route movements.
 *  4. Order ids are used IN THE ORDER THE CALLER SUPPLIES (§4 item 3) — "last stop first" is the app's
 *     job. `tripId` on a picklist or a load sheet is a plain label; warehouse never reads `trip_stops`.
 *
 * FOUNDER ANSWERS (docs/17 §D) THAT APPLY HERE:
 *
 *  - §D5 no separate van-sale numbering: the warehouse issues only the `DC` challan. Whatever series a
 *    van sale bills on is the tenant's normal one, allocated by billing — nothing in this file names it.
 *  - §D6 the product is WHITE-LABELLED: the printed challan carries the DISTRIBUTOR's own name and logo,
 *    read from `tenant_settings` (`TENANT_SETTING_KEYS` in `@dos/db`). `DeliveryChallanSchema.seller` is
 *    that block, shared with billing's invoice rather than duplicated.
 *  - §D3 shops are GST-registered, so the challan carries a taxable value and a rate per line (Rule 55)
 *    exactly as the invoice does.
 *
 * Quantities are integer pieces and are the ONLY quantity stored; `cases` / `loosePcs` are display-only
 * and are computed from THAT LOT's `case_size` (docs/17 A2), falling back to the sell-side pack. Money
 * is integer paise and appears in exactly two places — a load sheet's value and a challan's — and both
 * are SALE values. No shape below carries a purchase cost, a landed cost, a PTD or a margin: a picker
 * must never be able to back a purchase rate out of a screen. Dates are IST (`businessDate()`,
 * `financialYear()`), ids are client-generated UUIDv7, every list caps `limit` at 200 and takes the last
 * row's id as its cursor. `picklists.list` is ordered newest first by server creation time
 * (`created_at desc, id desc`, DOS-023); the other lists are ordered by id descending.
 */

const IsoDateSchema = z.iso.date()
/** The device that produced the pick, the pack or the load-out; stored on the transition it causes. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
/** Twelve digits, as the government portal prints it. */
const EwbNoSchema = z.string().regex(/^\d{12}$/, 'e-way bill number is 12 digits')
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// enums

/** `packed` means every order on the wave has a pack confirmation; `cancelled` is only reachable from `open`. */
export const PicklistStatusSchema = z.enum(['open', 'picking', 'picked', 'packed', 'cancelled'])
export type PicklistStatus = z.infer<typeof PicklistStatusSchema>

/** A sheet is built (`draft`), checked out (`confirmed`) or abandoned before anything moved. */
export const LoadSheetStatusSchema = z.enum(['draft', 'confirmed', 'cancelled'])
export type LoadSheetStatus = z.infer<typeof LoadSheetStatusSchema>

/** The three order states the godown floor ever sees. Derived from `orderMachine`'s enum, not retyped. */
export const FulfilmentQueueStateSchema = OrderStateSchema.extract([
  'confirmed',
  'picking',
  'packed',
])
export type FulfilmentQueueState = z.infer<typeof FulfilmentQueueStateSchema>

/** FEFO warns, it never blocks (docs/design R03); a short line warns once its reason is recorded. */
export const PickWarningCodeSchema = z.enum(['fefo_override', 'short_pick'])
export type PickWarningCode = z.infer<typeof PickWarningCodeSchema>

/** A lot on a load sheet either belongs to a packed order or is loose van-sale stock. */
export const LoadSheetLotSourceSchema = z.enum(['order', 'van'])
export type LoadSheetLotSource = z.infer<typeof LoadSheetLotSourceSchema>

/**
 * The state of a stock hold. Declared here because warehouse is the first module to put `reservations`
 * on the wire (`InventoryService.listReservations` is the only reader); it moves to `inventory.ts` the
 * day inventory exposes them itself.
 */
export const ReservationStateSchema = z.enum(['pending', 'posted', 'voided'])
export type ReservationState = z.infer<typeof ReservationStateSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — the queue

/**
 * One confirmed order waiting for a wave. Quantities only: this is the screen the picker opens, so it
 * carries no rate and no total. `fulfilFromLocationId` is here because `picklists.create` refuses a
 * mixed-location wave (409) and the app needs to group before it asks.
 */
export const FulfilmentQueueItemSchema = z.object({
  orderId: IdSchema,
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  retailerCode: z.string().nullable(),
  beatId: IdSchema.nullable(),
  beatName: z.string().nullable(),
  state: FulfilmentQueueStateSchema,
  fulfilFromLocationId: IdSchema.nullable(),
  expectedDeliveryDate: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  lineCount: z.number().int(),
  totalQtyPcs: PiecesSchema,
  /** The live picklist this order is already on, or null when it is still free to be waved. */
  picklistId: IdSchema.nullable(),
})
export type FulfilmentQueueItem = z.infer<typeof FulfilmentQueueItemSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — picklists

/** The wave header. `picklistNo` comes from the `PICK` series at create: internal paper, no legal weight. */
export const PicklistSummarySchema = z.object({
  id: IdSchema,
  picklistNo: z.string().nullable(),
  status: PicklistStatusSchema,
  locationId: IdSchema,
  /** IST business date the wave is picked for. */
  pickDate: z.string(),
  /** Plain labels: delivery is downstream, so warehouse never joins a trip or reads its stops. */
  tripId: IdSchema.nullable(),
  beatId: IdSchema.nullable(),
  note: z.string().nullable(),
  orderCount: z.number().int(),
  lineCount: z.number().int(),
  requestedQtyPcs: PiecesSchema,
  pickedQtyPcs: PiecesSchema,
  assignedTo: IdSchema.nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})
export type PicklistSummary = z.infer<typeof PicklistSummarySchema>

/** An order on the wave, as the picking sheet lists it. No money, not even the order total. */
export const PicklistOrderSchema = z.object({
  orderId: IdSchema,
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  state: OrderStateSchema,
  lineCount: z.number().int(),
})
export type PicklistOrder = z.infer<typeof PicklistOrderSchema>

/**
 * One order line against one lot. A line covered by two lots is two rows — that is how a split is
 * recorded, and it is why `pickedQtyPcs` is summed per `orderLineId` and never per row. `caseSize` is
 * THE LOT's, frozen at picklist creation (docs/17 A2), falling back to the sell-side pack.
 */
export const PickLineSchema = z.object({
  id: IdSchema,
  orderId: IdSchema,
  orderLineId: IdSchema,
  lineNo: z.number().int(),
  variantId: IdSchema,
  variantName: z.string(),
  productName: z.string(),
  lotId: IdSchema.nullable(),
  suggestedLotId: IdSchema.nullable(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  caseSize: z.number().int().positive().nullable(),
  /** `qtyPcs + freeQtyPcs` of the order line, spread across the suggested lots. */
  requestedQtyPcs: PiecesSchema,
  pickedQtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema,
  shortReason: z.string().nullable(),
  /** True when an earlier-expiry lot at the same location still had stock when this one was taken. */
  fefoOverride: z.boolean(),
  pickedBy: IdSchema.nullable(),
  pickedAt: z.string().nullable(),
})
export type PickLine = z.infer<typeof PickLineSchema>

/** One lot under a consolidated SKU row, with its own pack maths (docs/17 A2). */
export const ConsolidatedPickLotSchema = z.object({
  lotId: IdSchema,
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  qtyPcs: PiecesSchema,
  caseSize: z.number().int().positive().nullable(),
  cases: z.number().int().nonnegative(),
  loosePcs: z.number().int().nonnegative(),
  /** True when this lot is not the earliest-expiry lot with stock: a warning on the sheet, never a block. */
  fefoWarning: z.boolean(),
})
export type ConsolidatedPickLot = z.infer<typeof ConsolidatedPickLotSchema>

/**
 * The picking sheet proper: one row per SKU across the whole wave (docs/06), so the picker walks the
 * rack once. `caseSize` here is the SELL-side pack — the lots carry their own.
 */
export const ConsolidatedPickRowSchema = z.object({
  variantId: IdSchema,
  variantName: z.string(),
  productName: z.string(),
  requestedQtyPcs: PiecesSchema,
  pickedQtyPcs: PiecesSchema,
  caseSize: z.number().int().positive().nullable(),
  cases: z.number().int().nonnegative(),
  loosePcs: z.number().int().nonnegative(),
  lots: z.array(ConsolidatedPickLotSchema),
})
export type ConsolidatedPickRow = z.infer<typeof ConsolidatedPickRowSchema>

export const PicklistDetailSchema = PicklistSummarySchema.extend({
  orders: z.array(PicklistOrderSchema),
  lines: z.array(PickLineSchema),
  consolidated: z.array(ConsolidatedPickRowSchema),
})
export type PicklistDetail = z.infer<typeof PicklistDetailSchema>

const PicklistItemOutput = z.object({ item: PicklistDetailSchema })

/** What the picker is told after a pick. Never an error: FEFO and a short pick are both recorded facts. */
export const PickWarningSchema = z.object({
  pickLineId: IdSchema,
  code: PickWarningCodeSchema,
  message: z.string(),
})
export type PickWarning = z.infer<typeof PickWarningSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — packs

/** One lot's contribution to a packed line. */
export const PackLineLotSchema = z.object({
  lotId: IdSchema,
  batchNo: z.string().nullable(),
  qtyPcs: PiecesSchema,
})
export type PackLineLot = z.infer<typeof PackLineLotSchema>

/**
 * What actually went into the cartons for one order line. `shortQtyPcs > 0` is a smaller invoice, never
 * a credit note and never an edit to `sales_order_lines` (§4.6 of the brief).
 */
export const PackLineSchema = z.object({
  orderLineId: IdSchema,
  variantId: IdSchema,
  variantName: z.string(),
  orderedQtyPcs: PiecesSchema,
  packedQtyPcs: PiecesSchema,
  shortQtyPcs: PiecesSchema,
  lots: z.array(PackLineLotSchema),
})
export type PackLine = z.infer<typeof PackLineSchema>

/** One pack confirmation per order for all time — `UNIQUE(tenant_id, order_id)` is the guarantee. */
export const PackConfirmationSchema = z.object({
  id: IdSchema,
  orderId: IdSchema,
  picklistId: IdSchema.nullable(),
  packages: z.number().int().positive(),
  weightGrams: z.number().int().nullable(),
  /** The invoice issued in the same transaction, or null when `issueInvoice: false` was asked for. */
  invoiceId: IdSchema.nullable(),
  shortPacked: z.boolean(),
  packedBy: IdSchema.nullable(),
  packedAt: z.string(),
})
export type PackConfirmation = z.infer<typeof PackConfirmationSchema>

/** The bill this pack produced. A sale total, so the warehouse may see it; no cost, no margin. */
export const PackInvoiceRefSchema = z.object({
  id: IdSchema,
  invoiceNo: z.string().nullable(),
  totalPaise: PaiseSchema,
})
export type PackInvoiceRef = z.infer<typeof PackInvoiceRefSchema>

/** The billing desk's day list: what was packed, and what still has no bill. */
export const PackListItemSchema = PackConfirmationSchema.extend({
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  invoiceNo: z.string().nullable(),
})
export type PackListItem = z.infer<typeof PackListItemSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — load sheets

/**
 * The load-out header. `loadValuePaise` is Σ invoice totals of the packed orders plus
 * `stock_lots.mrp_paise × qtyPcs` for van stock (a declared value: no invoice exists for it yet), and
 * `ewbRequired` is that value against `tenant_settings['ewb_intra_state_threshold']` — checked on the
 * SHEET, because a mixed load crosses ₹1 lakh when no single bill does (docs/17 A8).
 */
export const LoadSheetSummarySchema = z.object({
  id: IdSchema,
  status: LoadSheetStatusSchema,
  /** IST business date of the load-out. */
  sheetDate: z.string(),
  /** Plain label; delivery attaches the real trip. Null until it does. */
  tripId: IdSchema.nullable(),
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  vehicleRegNo: z.string().nullable(),
  orderCount: z.number().int(),
  expectedPackages: z.number().int().nonnegative(),
  /** The crew's blind count at check-out; null while the sheet is a draft. */
  countedPackages: z.number().int().nonnegative().nullable(),
  varianceNote: z.string().nullable(),
  /** The owner/manager who approved the sheet from the manager app (fact 2b); null while unapproved. */
  approvedBy: IdSchema.nullable(),
  approvedAt: z.string().nullable(),
  /** The owner/manager who owns the count variance: copied from `approvedBy` at confirm when the count differs. */
  pinVerifiedBy: IdSchema.nullable(),
  loadValuePaise: PaiseSchema,
  ewbRequired: z.boolean(),
  ewbNo: z.string().nullable(),
  challanNo: z.string().nullable(),
  confirmedBy: IdSchema.nullable(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})
export type LoadSheetSummary = z.infer<typeof LoadSheetSummarySchema>

/** A packed order on the sheet. `stopSequence` is a label copied from delivery, never joined at read. */
export const LoadSheetOrderSchema = z.object({
  orderId: IdSchema,
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  invoiceId: IdSchema.nullable(),
  invoiceNo: z.string().nullable(),
  packages: z.number().int().nonnegative(),
  stopSequence: z.number().int().nullable(),
})
export type LoadSheetOrder = z.infer<typeof LoadSheetOrderSchema>

/** The packed orders' pick lines merged with the van stock, consolidated per lot. */
export const LoadSheetLotSchema = z.object({
  lotId: IdSchema,
  variantId: IdSchema,
  variantName: z.string(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  qtyPcs: PiecesSchema,
  caseSize: z.number().int().positive().nullable(),
  cases: z.number().int().nonnegative(),
  loosePcs: z.number().int().nonnegative(),
  source: LoadSheetLotSourceSchema,
})
export type LoadSheetLot = z.infer<typeof LoadSheetLotSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — delivery challans (GST Rule 55)

/** One printed challan line. A taxable value and a rate, never a cost. */
export const DeliveryChallanLineSchema = z.object({
  variantId: IdSchema,
  variantName: z.string(),
  hsnCode: z.string().nullable(),
  lotId: IdSchema,
  batchNo: z.string().nullable(),
  qtyPcs: PiecesSchema,
  caseSize: z.number().int().positive().nullable(),
  cases: z.number().int().nonnegative(),
  loosePcs: z.number().int().nonnegative(),
  taxableValuePaise: PaiseSchema,
  gstBps: BpsSchema,
})
export type DeliveryChallanLine = z.infer<typeof DeliveryChallanLineSchema>

/** The challan register row: everything GSTR reconciliation needs without opening the document. */
export const DeliveryChallanSummarySchema = z.object({
  id: IdSchema,
  challanNo: z.string().nullable(),
  /** Always the `DC` series today; kept on the wire so a second challan series never needs a migration. */
  seriesCode: z.string(),
  fy: z.string(),
  challanDate: z.string(),
  loadSheetId: IdSchema.nullable(),
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  vehicleNo: z.string().nullable(),
  valuePaise: PaiseSchema,
  /** Tax on the declared value, from `delivery_challans.load_value_gst_paise`. */
  gstPaise: PaiseSchema,
  ewbNo: z.string().nullable(),
  issuedBy: IdSchema.nullable(),
  issuedAt: z.string(),
})
export type DeliveryChallanSummary = z.infer<typeof DeliveryChallanSummarySchema>

/**
 * The printed challan. `seller` is the DISTRIBUTOR's own name and logo (docs/17 §D6, `TENANT_SETTING_KEYS`
 * in `@dos/db`) — the same block the invoice prints, shared rather than duplicated. `pdfObjectKey` is
 * null until the deferred renderer has written the file; `challans.pdf` queues that render and hands
 * back the URL once it exists (docs/23 §8.3).
 */
export const DeliveryChallanSchema = DeliveryChallanSummarySchema.extend({
  seller: SellerBrandingSchema,
  lines: z.array(DeliveryChallanLineSchema),
  pdfObjectKey: z.string().nullable(),
})
export type DeliveryChallan = z.infer<typeof DeliveryChallanSchema>

export const LoadSheetDetailSchema = LoadSheetSummarySchema.extend({
  orders: z.array(LoadSheetOrderSchema),
  lots: z.array(LoadSheetLotSchema),
  challan: DeliveryChallanSchema.nullable(),
})
export type LoadSheetDetail = z.infer<typeof LoadSheetDetailSchema>

const LoadSheetItemOutput = z.object({ item: LoadSheetDetailSchema })
const ChallanItemOutput = z.object({ item: DeliveryChallanSchema })

// ---------------------------------------------------------------------------------------------------------------
// output shapes — reservations

/** One hold the godown is carrying, and for whom. Read through `InventoryService.listReservations`. */
export const ReservationRowSchema = z.object({
  id: IdSchema,
  orderId: IdSchema.nullable(),
  orderNo: z.string().nullable(),
  orderLineId: IdSchema,
  variantId: IdSchema,
  variantName: z.string(),
  lotId: IdSchema.nullable(),
  batchNo: z.string().nullable(),
  locationId: IdSchema,
  qtyPcs: PiecesSchema,
  state: ReservationStateSchema,
  createdAt: z.string(),
})
export type ReservationRow = z.infer<typeof ReservationRowSchema>

// ---------------------------------------------------------------------------------------------------------------
// inputs — the queue

export const FulfilmentQueueInput = z.object({
  locationId: IdSchema.optional(),
  beatId: IdSchema.optional(),
  state: FulfilmentQueueStateSchema.optional(),
  expectedDeliveryDate: IsoDateSchema.optional(),
  /** Hides orders already on an `open` / `picking` / `picked` picklist. */
  unpicklistedOnly: QueryBoolSchema.default(true),
  ...CursorInput,
})
export const FulfilmentQueueOutput = z.object({
  items: z.array(FulfilmentQueueItemSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — picklists

/**
 * Creates the wave and nothing else: `pick_lines` are snapshotted from the orders' lines against the
 * FEFO-suggested lots, and THE ORDER STATE IS NOT TOUCHED, so an order can still be cancelled until
 * someone starts picking. Every order must be `confirmed`, have lines, share one
 * `fulfilFromLocationId` (409 otherwise) and not already be on a live picklist.
 */
export const CreatePicklistInput = MutationBase.extend({
  id: IdSchema,
  orderIds: z.array(IdSchema).min(1).max(200),
  /** Defaults to the single location the orders are fulfilled from. */
  locationId: IdSchema.optional(),
  tripId: IdSchema.optional(),
  beatId: IdSchema.optional(),
  /** Defaults to today in IST. */
  pickDate: IsoDateSchema.optional(),
  note: z.string().trim().max(200).optional(),
})
export const CreatePicklistOutput = PicklistItemOutput

export const PicklistsListInput = z.object({
  status: PicklistStatusSchema.optional(),
  locationId: IdSchema.optional(),
  assignedTo: IdSchema.optional(),
  tripId: IdSchema.optional(),
  /** `pick_date` on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const PicklistsListOutput = z.object({
  items: z.array(PicklistSummarySchema),
  nextCursor: z.string().nullable(),
})

export const PicklistGetInput = z.object({ id: IdSchema })
export const PicklistGetOutput = PicklistItemOutput

/**
 * Hand the sheet to a picker: `open → picking`, and EVERY order on it `confirmed → picking` through
 * `OrdersService.applyFulfilmentEvent(..., 'start_picking', ...)`, which writes the transition row and
 * the `OrderPicking` outbox event in the same transaction. No stock moves.
 */
export const StartPicklistInput = MutationBase.extend({
  id: IdSchema,
  assignedTo: IdSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const StartPicklistOutput = PicklistItemOutput

/**
 * One recorded pick. `id` is the `pick_lines` row: an id already on the sheet updates that row, a new
 * one adds a second row for the same `orderLineId`, which is how a split across two lots is recorded.
 */
export const RecordPickLineInput = z.object({
  id: IdSchema,
  orderLineId: IdSchema,
  lotId: IdSchema,
  pickedQtyPcs: PiecesSchema,
  shortReason: z.string().trim().min(1).max(120).optional(),
})

/**
 * What was actually taken off the rack. PAPER ONLY — no `stock_ledger` row is written here; the pieces
 * leave at pack, so a half-picked wave abandoned at 6 pm leaves the ledger untouched. Σ `pickedQtyPcs`
 * per order line may not exceed the requested pieces (400), and a row the wave created may not take
 * more than its own `requestedQtyPcs` (400; a new `id` is a split row, which asks for nothing of its
 * own); a short line needs a `shortReason`; taking a later-expiry lot is a warning, never a refusal.
 */
export const RecordPickInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
  lines: z.array(RecordPickLineInput).min(1).max(500),
})
export const RecordPickOutput = z.object({
  item: PicklistDetailSchema,
  warnings: z.array(PickWarningSchema),
})

/**
 * Only while `status = 'open'`: once an order has entered `picking` the order machine has no way back
 * (there is no `picking → confirmed`), so a started wave is finished or short-picked, never cancelled.
 */
export const CancelPicklistInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const CancelPicklistOutput = PicklistItemOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — packs

/**
 * THE moment the order becomes cartons, all in one transaction (coordination §4 step 3): the picked
 * pieces leave as `sale` rows through `InventoryService.postPick` and the holds close, `recordPick`
 * writes `sales_order_lines.picked_qty_pcs`, the `pack_confirmations` row is inserted (UNIQUE per
 * order), `applyFulfilmentEvent('pack')` moves `picking → packed` with its transition row and
 * `OrderPacked` event, and `BillingService.issueForPack` issues the bill from the PACKED quantities.
 *
 * This is the only way a pack invoice is issued — `billing.invoices.issue` was removed with this slice.
 * A replay returns the stored response and never a second invoice number.
 */
export const ConfirmPackInput = MutationBase.extend({
  orderId: IdSchema,
  /** Client-generated id of the pack confirmation. */
  id: IdSchema,
  packages: z.number().int().min(1).max(500),
  weightGrams: z.number().int().positive().optional(),
  deviceId: DeviceIdSchema.optional(),
  /** False parks the order in the billing backlog (`packs.list?invoiced=false`) without a document. */
  issueInvoice: z.boolean().default(true),
})
export const ConfirmPackOutput = z.object({
  item: PackConfirmationSchema,
  lines: z.array(PackLineSchema),
  invoice: PackInvoiceRefSchema.nullable(),
})

export const PacksListInput = z.object({
  /** `packed_at` on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  picklistId: IdSchema.optional(),
  orderId: IdSchema.optional(),
  /** False lists the backlog: packed, not yet billed. */
  invoiced: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const PacksListOutput = z.object({
  items: z.array(PackListItemSchema),
  nextCursor: z.string().nullable(),
})

export const PackGetInput = z.object({ id: IdSchema })
export const PackGetOutput = z.object({
  item: PackConfirmationSchema,
  lines: z.array(PackLineSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — load sheets

export const LoadSheetVanStockInput = z.object({
  lotId: IdSchema,
  qtyPcs: PiecesSchema.positive(),
})

/**
 * Builds the sheet WITHOUT moving anything: every order must be `packed`, have a pack confirmation and
 * not be on another live sheet, and `toLocationId` must be an active `vehicle` location. The orders are
 * kept in the order the caller supplies — "last stop first" is the app's job, because reading
 * `trip_stops` would make warehouse depend on delivery (coordination §4 item 3).
 */
export const CreateLoadSheetInput = MutationBase.extend({
  id: IdSchema,
  /** A `kind = 'vehicle'` location. */
  toLocationId: IdSchema,
  /** Defaults to the active warehouse location. */
  fromLocationId: IdSchema.optional(),
  tripId: IdSchema.optional(),
  /** Defaults to today in IST. */
  sheetDate: IsoDateSchema.optional(),
  orderIds: z.array(IdSchema).max(200).default([]),
  vanStock: z.array(LoadSheetVanStockInput).max(200).default([]),
})
export const CreateLoadSheetOutput = LoadSheetItemOutput

export const LoadSheetsListInput = z.object({
  status: LoadSheetStatusSchema.optional(),
  tripId: IdSchema.optional(),
  toLocationId: IdSchema.optional(),
  /** `sheet_date` on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const LoadSheetsListOutput = z.object({
  items: z.array(LoadSheetSummarySchema),
  nextCursor: z.string().nullable(),
})

export const LoadSheetGetInput = z.object({ id: IdSchema })
export const LoadSheetGetOutput = LoadSheetItemOutput

/**
 * The manager's PIN, given from the manager app (fact 2b): marks a draft sheet approved so the
 * warehouse device may confirm it. Only while `status = 'draft'` and not yet approved (409
 * `already_approved`); an `audit_log` row (`load_sheet.approve`) records it.
 */
export const ApproveLoadSheetInput = MutationBase.extend({
  id: IdSchema,
  note: z.string().trim().max(200).optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const ApproveLoadSheetOutput = LoadSheetItemOutput

/**
 * Check-out, one transaction, on the warehouse device once the sheet is approved (409
 * `approval_required` otherwise): the e-way bill gate (400 `ewb_required` above the tenant's threshold
 * with no number), the crew's blind package count (a variance needs a `varianceNote` and records
 * `pinVerifiedBy = approvedBy`), the van stock replaced by what was counted, a `transfer_out` +
 * `transfer_in` pair per counted van-stock lot keyed `load:<sheetId>:<lotId>:out|in` (the packed orders'
 * pieces already left as `sale` at pack), the `DC` challan issued, and every packed order
 * `packed → dispatched` — warehouse dispatches, not delivery (coordination §5 item 4).
 */
export const ConfirmLoadSheetInput = MutationBase.extend({
  id: IdSchema,
  countedPackages: z.number().int().nonnegative(),
  /** What is really on the van; replaces the sheet's `van_stock`. */
  countedVanStock: z.array(LoadSheetVanStockInput).max(200).default([]),
  /** Client-generated id of the challan this confirm issues. */
  challanId: IdSchema,
  ewbNo: EwbNoSchema.optional(),
  varianceNote: z.string().trim().max(200).optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const ConfirmLoadSheetOutput = z.object({
  item: LoadSheetDetailSchema,
  challan: DeliveryChallanSchema,
  /** The orders this confirm moved to `dispatched`. */
  dispatched: z.array(IdSchema),
})

/**
 * Only while `status = 'draft'`. Once confirmed the stock has moved and a numbered challan exists; the
 * correction is a return leg in the delivery module, never a cancellation here.
 */
export const CancelLoadSheetInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const CancelLoadSheetOutput = LoadSheetItemOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — challans

export const ChallansListInput = z.object({
  /** `challan_date` on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  loadSheetId: IdSchema.optional(),
  ...CursorInput,
})
export const ChallansListOutput = z.object({
  items: z.array(DeliveryChallanSummarySchema),
  nextCursor: z.string().nullable(),
})

export const ChallanGetInput = z.object({ id: IdSchema })
export const ChallanGetOutput = ChallanItemOutput

/**
 * The pilot path for the e-way bill: the manager generates it on the government portal and types the
 * number back. Writes the challan and its parent sheet plus an `audit_log` row; 409 once one is
 * recorded, because a wrong number is corrected on the portal and a fresh challan issued.
 */
export const RecordEwbInput = MutationBase.extend({
  id: IdSchema,
  ewbNo: EwbNoSchema,
})
export const RecordEwbOutput = ChallanItemOutput

/**
 * The printed Rule 55 challan that rides with the vehicle. Never renders inline (docs/20 rule 3,
 * coordination §3.4): until the renderer slice exists every call answers `{ status: 'queued',
 * objectKey: null, url: null }` and enqueues `documents.pdf.render` with the `challan` template; that
 * is a normal state, not an error. Three copies as the rules want, A4 or 80 mm thermal.
 */
export const ChallanPdfInput = z.object({
  id: IdSchema,
  copy: InvoiceCopySchema.default('original'),
  format: InvoiceFormatSchema.default('a4'),
})
export const ChallanPdfOutput = DocumentRenderOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — reservations

export const ReservationsListInput = z.object({
  orderId: IdSchema.optional(),
  locationId: IdSchema.optional(),
  variantId: IdSchema.optional(),
  state: ReservationStateSchema.default('pending'),
  ...CursorInput,
})
export const ReservationsListOutput = z.object({
  items: z.array(ReservationRowSchema),
  nextCursor: z.string().nullable(),
})

/**
 * Frees every pending hold of an order that will not be picked (a shop shut, an order parked). Only
 * while the order is still `confirmed` — 409 once it is `picking` or later, because the pieces are on
 * their way out. The order state does not change; an `audit_log` row records who freed what.
 *
 * There is no `id` on this input: it creates nothing the client addresses. The audit row is the
 * server's, and `idempotencyKey` is what makes a retry a no-op.
 */
export const ReleaseReservationsInput = MutationBase.extend({
  orderId: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const ReleaseReservationsOutput = z.object({
  released: z.number().int().nonnegative(),
  orderId: IdSchema,
  freedQtyPcs: PiecesSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `warehouse: warehouseContract` in contract.ts

export const warehouseContract = {
  queue: {
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/queue',
        summary: 'Confirmed orders waiting to be picked, quantities only',
      })
      .input(FulfilmentQueueInput)
      .output(FulfilmentQueueOutput),
  },
  picklists: {
    create: oc
      .route({
        method: 'POST',
        path: '/warehouse/picklists',
        summary: 'Wave selected orders into a picklist with FEFO-suggested lots',
      })
      .input(CreatePicklistInput)
      .output(CreatePicklistOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/picklists',
        summary: 'Picklists, newest first',
      })
      .input(PicklistsListInput)
      .output(PicklistsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/warehouse/picklists/{id}',
        summary: 'The picking sheet: lines, and the wave consolidated by SKU',
      })
      .input(PicklistGetInput)
      .output(PicklistGetOutput),
    start: oc
      .route({
        method: 'POST',
        path: '/warehouse/picklists/{id}/start',
        summary: 'Assign the sheet and move every order on it to picking',
      })
      .input(StartPicklistInput)
      .output(StartPicklistOutput),
    pick: oc
      .route({
        method: 'POST',
        path: '/warehouse/picklists/{id}/pick',
        summary: 'Record picked pieces per lot; FEFO and short picks warn, never block',
      })
      .input(RecordPickInput)
      .output(RecordPickOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/warehouse/picklists/{id}/cancel',
        summary: 'Cancel a wave that has not started, freeing its orders',
      })
      .input(CancelPicklistInput)
      .output(CancelPicklistOutput),
  },
  packs: {
    confirm: oc
      .route({
        method: 'POST',
        path: '/warehouse/orders/{orderId}/pack',
        summary: 'Pack the order: stock leaves, the order moves to packed, the bill is issued',
      })
      .input(ConfirmPackInput)
      .output(ConfirmPackOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/packs',
        summary: 'What was packed, and what still has no bill',
      })
      .input(PacksListInput)
      .output(PacksListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/warehouse/packs/{id}',
        summary: 'One pack confirmation with its packed lines and lots',
      })
      .input(PackGetInput)
      .output(PackGetOutput),
  },
  loadSheets: {
    create: oc
      .route({
        method: 'POST',
        path: '/warehouse/load-sheets',
        summary: 'Build the load-out sheet for a vehicle without moving stock',
      })
      .input(CreateLoadSheetInput)
      .output(CreateLoadSheetOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/load-sheets',
        summary: 'Load sheets: what is loaded on which vehicle, and when it left',
      })
      .input(LoadSheetsListInput)
      .output(LoadSheetsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/warehouse/load-sheets/{id}',
        summary: 'One load sheet with its orders, its lots and its challan',
      })
      .input(LoadSheetGetInput)
      .output(LoadSheetGetOutput),
    approve: oc
      .route({
        method: 'POST',
        path: '/warehouse/load-sheets/{id}/approve',
        summary:
          "Approve a draft sheet from the manager app (the manager's PIN); confirm waits for it",
      })
      .input(ApproveLoadSheetInput)
      .output(ApproveLoadSheetOutput),
    confirm: oc
      .route({
        method: 'POST',
        path: '/warehouse/load-sheets/{id}/confirm',
        summary:
          'Check out an approved sheet: count, move godown → vehicle, issue the challan, dispatch',
      })
      .input(ConfirmLoadSheetInput)
      .output(ConfirmLoadSheetOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/warehouse/load-sheets/{id}/cancel',
        summary: 'Cancel a draft sheet (a confirmed one has already moved stock)',
      })
      .input(CancelLoadSheetInput)
      .output(CancelLoadSheetOutput),
  },
  challans: {
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/challans',
        summary: 'The delivery challan register',
      })
      .input(ChallansListInput)
      .output(ChallansListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/warehouse/challans/{id}',
        summary: 'One challan with everything Rule 55 prints',
      })
      .input(ChallanGetInput)
      .output(ChallanGetOutput),
    pdf: oc
      .route({
        method: 'GET',
        path: '/warehouse/challans/{id}/pdf',
        summary: 'The printed Rule 55 challan (queued until the renderer runs)',
      })
      .input(ChallanPdfInput)
      .output(ChallanPdfOutput),
    recordEwb: oc
      .route({
        method: 'POST',
        path: '/warehouse/challans/{id}/ewb',
        summary: 'Record the e-way bill number typed from the government portal',
      })
      .input(RecordEwbInput)
      .output(RecordEwbOutput),
  },
  reservations: {
    list: oc
      .route({
        method: 'GET',
        path: '/warehouse/reservations',
        summary: 'What the godown is holding, and for which order',
      })
      .input(ReservationsListInput)
      .output(ReservationsListOutput),
    release: oc
      .route({
        method: 'POST',
        path: '/warehouse/reservations/release',
        summary: 'Free the pending holds of an order that will not be picked',
      })
      .input(ReleaseReservationsInput)
      .output(ReleaseReservationsOutput),
  },
}
