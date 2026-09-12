import { oc } from '@orpc/contract'
import { z } from 'zod'
import { InvoiceCreditNoteRefSchema, InvoiceDetailSchema } from './billing.js'
import {
  IdSchema,
  LocaleSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { FileMimeTypeSchema } from './files.js'
import { OrderDetailSchema, OrderLineInput } from './orders.js'
import {
  AllocationSchema,
  ReceiptModeSchema,
  ReceiptSchema,
  RetailerOutstandingSchema,
  SettledInvoiceSchema,
} from './receivables.js'
import { AddressSchema, PaymentTermsSchema } from './retailers.js'

/**
 * Delivery — the physical last mile (ADR 0013: a vehicle IS a stock location). It owns `vehicles`,
 * `trips`, `trip_stops`, `deliveries`, `delivery_lines`, `pod_evidence`, `collections`, `trip_expenses`,
 * `trip_settlements`, `trip_points`, `vehicle_positions` and the crew's `location_consents`, and
 * nothing else. Every rupee goes through `ReceivablesService.recordReceipt` / `postEntry`, every piece
 * through `InventoryService`, every order state through `OrdersService`, the van-sale bill through
 * `BillingService.issueFromLocation` and the doorstep credit note through
 * `CreditNotesService.raiseForDelivery` (coordination §4). It never reads `load_sheets`: "is the load
 * out of the godown" is `LoadSheetsService.confirmedForTrip`.
 *
 * WHICH SERVICES MOUNT `delivery` (docs/plans/00-coordination.md §6 table):
 *
 *   owner :3001      YES — the whole surface: trips, vehicles, the live map and the trip trace (both
 *                    DPDP-audited reads), the settlement with `acceptVariance` for a red check-in
 *   manager :3002    YES — manager + accountant: plan and cancel trips, the day-end desk
 *                    (`trips.settlementPreview`, `trips.settle`, `collections.list`, `expenses.list`).
 *                    The accountant settles WITHIN tolerance and reads the trip's money; it never
 *                    writes a stop, a delivery or a POD, never sees the live map or a trace
 *   sales :3003      NO  — a rep is never on a trip and NEVER collects (docs/17 §D4). A shop's delivery
 *                    status reaches the rep through `orders.get`, never through this key
 *   warehouse :3004  YES — trip PLANNING only (TRIP_PLANNERS / STOCK_VIEWERS): `trips.create`,
 *                    `trips.startLoading`, `stops.add`, `vehicles.list`, `trips.list/get`, `stops.list/
 *                    next`. Never money, never a doorstep write, never a settlement
 *   delivery :3005   YES — the primary app: DOORSTEP writes, MONEY_COLLECTORS at the shop door,
 *                    `gps.points`, its own consent. RLS plus the handler scope the crew to the trips it
 *                    is driver or helper on; `trips.list` is forced to `mine`
 *   retailer :3006   YES — READS OF ITS OWN DELIVERY STATUS ONLY: `stops.list` (an ETA, never a
 *                    coordinate, never the cash plan) and `deliveries.list/get` (its own POD, with a
 *                    signed read URL). Every other procedure refuses the shop in PERMISSIONS
 *
 * FOUNDER ANSWERS (docs/17 §D) THAT OVERRIDE THE MODULE BRIEF (docs/plans/delivery.md):
 *
 *  1. ONLY THE DELIVERY CREW COLLECTS MONEY at the door, plus the desk at the office and the shop paying
 *     online for itself (§D4). `collections.record` is THE money-collection path of the field: its
 *     permission is MONEY_COLLECTORS (owner, manager, accountant, delivery) and the salesperson is in no
 *     row of this file. It wraps `ReceivablesService.recordReceipt`, so a doorstep receipt is ONE
 *     numbered receipt plus one balanced journal entry, never two rows.
 *  2. A VAN SALE IS BILLED FROM THE TENANT'S NORMAL INVOICE SERIES (§D5): `vanSales.create` calls
 *     `BillingService.issueFromLocation` with `source = 'van_sale'` and NO series code. The brief's
 *     per-vehicle `VAN-<reg>` series, `allocation_mode = 'device'` and `vehicles.upsert` seeding a
 *     numbering row are deleted (docs/23 §8.4 correction). Nothing below names a series.
 *  3. CASH DISCOUNT IS REALISED AT RECEIPT (§D2) by receivables inside `recordReceipt`; the delivery
 *     module never computes, prints or deducts a discount. `collections.record` only reports
 *     `cashDiscountPaise` back.
 *  4. WHITE-LABEL (§D6): the bill handed over at the door is `InvoiceDetail` with its `seller` block,
 *     the shop's POD list carries nothing branded "Distribution OS". The crew's foreground GPS notice
 *     text ("location shared with <display name>") reads `tenancy.branding.get`, mounted on
 *     delivery-service.
 *  5. ENGLISH ONLY: `consents.grant.locale` defaults to `en-IN` and no message here is bilingual.
 *
 * COORDINATION FACTS THAT SHAPE THIS FILE:
 *
 *  - WAREHOUSE DISPATCHES, not delivery (§4 item 4): `packed → dispatched` happens at
 *    `warehouse.loadSheets.confirm`. `trips.depart` dispatches only orders whose invoices are NOT on a
 *    confirmed load sheet and treats an already-dispatched order as a no-op, never a 409.
 *  - GODOWN → VEHICLE IS `transfer_out` + `transfer_in`, posted by the warehouse at load-out (§4 item
 *    5). Delivery posts the RETURN direction at check-in (`van_unload` + `transfer_in`, keys
 *    `settle:<tripId>:<lotId>:out|in`), doorstep returns INTO the vehicle (`sale_return_saleable`) or
 *    the damaged bin (`sale_return_damaged`), and van-sale pieces leave the vehicle as `sale`.
 *  - THE SETTLEMENT JOURNAL IS POSTED INLINE through `ReceivablesService.postEntry` (§3.6: no outbox
 *    handlers before docint): Dr CASH (handed over), Dr the expense accounts, Dr/Cr CASH_SHORT for the
 *    variance, Cr CASH_VAN (opening + cash collected). Account codes are `CASH_VAN`, `CHEQUES`, `UPI`,
 *    `TRIP_EXPENSES`, `CASH_SHORT` — never the brief's `CHEQUES_IN_HAND`.
 *  - `/gps/points` BYPASSES THE SYNC QUEUE (ADR 0012, docs/07 §7.5): the device buffers breadcrumbs
 *    outside PowerSync and posts batches keyed `(tripId, deviceId, recordedAt)`. The batch is NOT
 *    wrapped in `idempotent()` (50,000 points/minute must not write an idempotency row per batch,
 *    docs/20 rule 3): the dedupe is the unique index and a replay is free. It is 2xx even when every
 *    point is stale (`dropped`), skewed (`skewed`) or the device is over its budget (`throttled` +
 *    `retryAfterSeconds`); it is 4xx only for a malformed body or a trip the caller is not crew on.
 *
 * DOCS/23 §8.4 GAPS CLOSED HERE: `consents.grant/get` (the DPDP notice screen before `depart`),
 * `deliveries.get` with signed POD read URLs (the shop's proof screen, the owner's dispute view),
 * `TripDetail.policy` (tolerance, POD policy, geofence, GPS retention — the offline device must know
 * the tenant's rules), `TripDetail.vanSalesAllowed` (feature flag AND trip toggle, so the van-sale
 * button exists or not), and `stops.next` (the crew's home screen in one call).
 *
 * PROOF OF DELIVERY AND EXPENSE PROOFS travel through the object-storage flow of `files.ts`: the app
 * calls `files.uploadUrl` (`domain: 'pod'` / `'expense'`, `entityId` = the delivery or expense id),
 * PUTs the bytes to the pre-signed URL on S3, and passes only the `objectKey` here. On the LOCAL driver
 * `files.uploadUrl` answers `inline: true`, which files.ts defines as "send the bytes on the create call
 * that consumes the key": that call is `deliveries.record` / `deliveries.addPod` / `expenses.record`
 * below, through the optional `contentBase64` + `mimeType` pair of `InlineFileInput`, capped well
 * under a request body. Nothing else binary ever passes through the service (docs/20 rule 15).
 *
 * Money is integer paise, quantities integer pieces (cases are display-only, computed from THAT LOT's
 * `case_size`, docs/17 A2), dates IST (`businessDate()`), ids client-generated UUIDv7, every list caps
 * `limit` at 200 and pages on `cursor` = the last row's id. State moves only through `tripMachine`,
 * `stopMachine` and `orderMachine`; a delivery's `outcome` is DERIVED from its lines, never sent. No
 * shape below carries a purchase cost, a landed cost, a PTD or a margin — the delivery role is one of
 * the roles the ADR 0002 test dumps and greps.
 */

const IsoDateSchema = z.iso.date()
const IsoDateTimeSchema = z.iso.datetime({ offset: true })
/** The phone that produced the write; two-person crews carry two phones, so it is in every GPS key. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const LatSchema = z.number().min(-90).max(90)
const LngSchema = z.number().min(-180).max(180)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// enums

/** `tripMachine` in @dos/domain: planned → loading → active → closing → settled | settled_with_variance; cancel from planned/loading. */
export const TripStateSchema = z.enum([
  'planned',
  'loading',
  'active',
  'closing',
  'settled',
  'settled_with_variance',
  'cancelled',
])
export type TripState = z.infer<typeof TripStateSchema>

/**
 * `stopMachine`: pending → started → arrived → delivered | partial | failed. `skipped` is not a machine
 * state — it is what `trips.cancel` stamps on the stops of a trip that never left (the `stop_state`
 * enum carries it for that one write).
 */
export const StopStateSchema = z.enum([
  'pending',
  'started',
  'arrived',
  'delivered',
  'partial',
  'failed',
  'skipped',
])
export type StopState = z.infer<typeof StopStateSchema>

/** Why a stop failed, as the crew taps it. `other` needs a `failureNote`. */
export const StopFailureReasonSchema = z.enum([
  'shop_closed',
  'refused',
  'no_cash',
  'wrong_address',
  'damaged_goods',
  'other',
])
export type StopFailureReason = z.infer<typeof StopFailureReasonSchema>

/**
 * Derived by the server from the lines (rule 8 of the brief): `delivered` = every line full, `partial` =
 * at least one short, `failed` = every line zero. `returned` is a delivered bill taken back whole at a
 * later visit (a desk write, not a doorstep one). `null` on the wire = planned, not attempted yet.
 */
export const DeliveryOutcomeSchema = z.enum(['delivered', 'partial', 'returned', 'failed'])
export type DeliveryOutcome = z.infer<typeof DeliveryOutcomeSchema>

/** Why a line is short or came back. Coded so the owner's register can group it; free text goes in `note`. */
export const DeliveryLineReasonSchema = z.enum([
  'refused',
  'damaged',
  'expired',
  'wrong_item',
  'short_loaded',
  'other',
])
export type DeliveryLineReason = z.infer<typeof DeliveryLineReasonSchema>

/**
 * The reasons whose returned pieces never go back on sale: a damaged or expired piece goes to the tenant's
 * damaged / expiry bin (DOS-058). `deliveries.record` refuses a returned line with one of these reasons and
 * `returnedSaleable: true`, and the delivery app derives the disposition from the reason with the same
 * predicate, so the screen and the server read one list.
 */
export const UNSALEABLE_RETURN_REASONS = [
  'damaged',
  'expired',
] as const satisfies readonly DeliveryLineReason[]

/** False when pieces coming back for this reason belong in the damaged bin; true for every other reason, or none. */
export function isSaleableReturn(reason: DeliveryLineReason | null | undefined): boolean {
  if (reason === null || reason === undefined) return true
  return !(UNSALEABLE_RETURN_REASONS as readonly DeliveryLineReason[]).includes(reason)
}

/** Proof of delivery: photo of the signed bill, a signature image, the shopkeeper's OTP, the geo-fence check. */
export const PodKindSchema = z.enum(['photo', 'signature', 'otp', 'geo'])
export type PodKind = z.infer<typeof PodKindSchema>

/** `tenant_settings['delivery.pod_required']`: when the crew must attach a photo before `deliveries.record` is accepted. */
export const PodPolicySchema = z.enum(['always', 'credit_only', 'never'])
export type PodPolicy = z.infer<typeof PodPolicySchema>

export const VehicleKindSchema = z.enum(['tempo', 'three_wheeler', 'pickup', 'truck', 'bike'])
export type VehicleKind = z.infer<typeof VehicleKindSchema>

/**
 * What the crew may take at the door (docs/22 §4 D6: "cash / UPI with UTR / cheque"). A subset of the
 * receipt modes: a bank transfer or an adjustment is a desk entry through `receivables.receipts.create`.
 */
export const CollectionModeSchema = ReceiptModeSchema.extract(['cash', 'upi', 'cheque'])
export type CollectionMode = z.infer<typeof CollectionModeSchema>

/** Each kind maps to an expense account at settlement; `other` needs a `note`. */
export const TripExpenseKindSchema = z.enum([
  'diesel',
  'toll',
  'parking',
  'loading',
  'food',
  'repair',
  'other',
])
export type TripExpenseKind = z.infer<typeof TripExpenseKindSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — vehicles and consents

export const VehicleSchema = z.object({
  id: IdSchema,
  regNo: z.string(),
  name: z.string().nullable(),
  kind: VehicleKindSchema,
  capacityCases: z.number().int().nullable(),
  /** The `locations` row (`kind = 'vehicle'`) that holds this vehicle's stock — what `inventory.stock.balances` is asked for. */
  locationId: IdSchema,
  active: z.boolean(),
  createdAt: z.string(),
})
export type Vehicle = z.infer<typeof VehicleSchema>

/**
 * One row per vehicle for the owner's live map, upserted from the newest accepted GPS point.
 * `stale` = `recordedAt` older than `staleAfterMinutes` ("location unavailable", never an error).
 */
export const VehiclePositionSchema = z.object({
  vehicleId: IdSchema,
  regNo: z.string(),
  tripId: IdSchema.nullable(),
  tripNo: z.string().nullable(),
  tripState: TripStateSchema.nullable(),
  driverId: IdSchema.nullable(),
  lat: LatSchema,
  lng: LngSchema,
  recordedAt: z.string(),
  updatedAt: z.string(),
  stale: z.boolean(),
  stopsDone: z.number().int().nonnegative(),
  stopsPlanned: z.number().int().nonnegative(),
})
export type VehiclePosition = z.infer<typeof VehiclePositionSchema>

/**
 * DPDP: the crew member's acknowledgement of the location notice, per user per tenant, versioned.
 * `trips.depart` refuses `gps_consent_missing` without a granted row for the driver; a denied OS
 * permission on the phone never blocks a trip (the owner just sees "location unavailable").
 */
export const LocationConsentSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  granted: z.boolean(),
  /** The notice text version the person saw (`location_consents.policy_version`). */
  noticeVersion: z.string(),
  locale: LocaleSchema,
  grantedAt: z.string(),
  withdrawnAt: z.string().nullable(),
})
export type LocationConsent = z.infer<typeof LocationConsentSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — trips and stops

/** The tenant's delivery rules, copied onto every `TripDetail` so the offline device carries them (docs/23 §8.4). */
export const TripPolicySchema = z.object({
  /** `delivery.settlement_tolerance_paise` — beyond it a check-in needs the owner. Default ₹100. */
  settlementTolerancePaise: PaiseSchema,
  /** `delivery.pod_required`. Default `credit_only`: a photo for a shop on credit terms. */
  podRequired: PodPolicySchema,
  /** `delivery.geofence_metres` — evidence shown amber, never a block. Default 150. */
  geofenceMetres: z.number().int().nonnegative(),
  /** `dpdp.gps_retention_days` — raw breadcrumbs are pruned after it. Default 90. */
  gpsRetentionDays: z.number().int().positive(),
})
export type TripPolicy = z.infer<typeof TripPolicySchema>

/**
 * One invoice planned for (or delivered at) a stop. The row is created with the stop (`outcome: null`)
 * and completed by `deliveries.record`; `invoiceNo` / `invoiceTotalPaise` are copied so the crew's
 * stop card needs no second call. The amount still due is `billing.invoices.get.amountDuePaise`.
 */
export const DeliveryRefSchema = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  invoiceNo: z.string().nullable(),
  orderId: IdSchema.nullable(),
  invoiceTotalPaise: PaiseSchema,
  outcome: DeliveryOutcomeSchema.nullable(),
  deliveredAt: z.string().nullable(),
  creditNoteId: IdSchema.nullable(),
})
export type DeliveryRef = z.infer<typeof DeliveryRefSchema>

/**
 * A stop as every role sees it. For the RETAILER role the mapper answers `plannedCollectionPaise`,
 * `arrivedLat`, `arrivedLng` and `vehicleRegNo` as null — the shop gets an ETA and its own bills,
 * never a coordinate or the crew's cash plan (docs/17 B, GPS/DPDP). RLS (`trip_stops_read`) has
 * already narrowed the rows to the shop's own.
 */
export const StopSchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  sequence: z.number().int().positive(),
  retailerId: IdSchema,
  retailerName: z.string(),
  state: StopStateSchema,
  failureReason: StopFailureReasonSchema.nullable(),
  failureNote: z.string().nullable(),
  /** Planned cash at this door: the bills on it plus agreed old dues. Null for the shop. */
  plannedCollectionPaise: PaiseSchema.nullable(),
  etaAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  arrivedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  arrivedLat: LatSchema.nullable(),
  arrivedLng: LngSchema.nullable(),
  vehicleRegNo: z.string().nullable(),
  deliveries: z.array(DeliveryRefSchema),
  createdAt: z.string(),
})
export type Stop = z.infer<typeof StopSchema>

/**
 * The shop as the crew needs it at the door: where it is, who to call, its terms. Deliberately NOT
 * `retailers.get`'s staff shape — no code, tier, credit limit or credit days (docs/23 §5.3: the crew
 * needs the mode and the dues, never the limit). The dues are `receivables.outstanding.get`.
 */
export const StopRetailerSchema = z.object({
  id: IdSchema,
  name: z.string(),
  ownerName: z.string().nullable(),
  phone: z.string().nullable(),
  address: AddressSchema.nullable(),
  lat: LatSchema.nullable(),
  lng: LngSchema.nullable(),
  gstin: z.string().nullable(),
  paymentTerms: PaymentTermsSchema,
})
export type StopRetailer = z.infer<typeof StopRetailerSchema>

export const TripSchema = z.object({
  id: IdSchema,
  /** Assigned from the `TRIP` series at create. */
  tripNo: z.string().nullable(),
  /** IST business date of the trip. */
  tripDate: z.string(),
  vehicleId: IdSchema,
  vehicleRegNo: z.string(),
  /** The vehicle's stock location: `inventory.stock.balances?locationId=` is the van's stock. */
  vehicleLocationId: IdSchema,
  driverId: IdSchema.nullable(),
  helperId: IdSchema.nullable(),
  state: TripStateSchema,
  /** The owner's per-trip toggle; `vanSalesAllowed` on the detail is this AND the tenant feature flag. */
  vanSalesEnabled: z.boolean(),
  plannedStops: z.number().int().nonnegative(),
  /** Stops in a terminal state (delivered, partial, failed, skipped). */
  stopsCompleted: z.number().int().nonnegative(),
  startOdometerKm: z.number().int().nullable(),
  endOdometerKm: z.number().int().nullable(),
  /** The cash float handed to the crew at departure. */
  openingCashPaise: PaiseSchema,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Trip = z.infer<typeof TripSchema>

/**
 * A collection event on a trip: what the crew took at a door. The money itself is the receivables
 * receipt (`receiptId`, `receiptNo`); this row is the trip's cash story and the crew's day summary.
 */
export const CollectionSchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  stopId: IdSchema.nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  receiptId: IdSchema,
  receiptNo: z.string().nullable(),
  mode: CollectionModeSchema,
  amountPaise: PaiseSchema,
  /** UTR for UPI, the cheque number for a cheque, null for cash. */
  reference: z.string().nullable(),
  collectedBy: IdSchema.nullable(),
  collectedAt: z.string(),
})
export type Collection = z.infer<typeof CollectionSchema>

export const TripExpenseSchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  kind: TripExpenseKindSchema,
  amountPaise: PaiseSchema,
  proofObjectKey: z.string().nullable(),
  note: z.string().nullable(),
  recordedBy: IdSchema.nullable(),
  recordedAt: z.string(),
})
export type TripExpense = z.infer<typeof TripExpenseSchema>

/** One lot the van still holds, or was expected to: pieces are the truth, cases are from THAT lot's `case_size`. */
export const VanStockLineSchema = z.object({
  lotId: IdSchema,
  variantId: IdSchema,
  variantName: z.string(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  caseSize: z.number().int().positive().nullable(),
  expectedPcs: PiecesSchema,
  cases: z.number().int().nonnegative(),
  loosePcs: z.number().int().nonnegative(),
})
export type VanStockLine = z.infer<typeof VanStockLineSchema>

export const StockVarianceLineSchema = z.object({
  lotId: IdSchema,
  expectedPcs: PiecesSchema,
  countedPcs: PiecesSchema,
  /** `countedPcs − expectedPcs`; non-zero writes a `cycle_count` row at the vehicle and makes the settlement red. */
  deltaPcs: z.number().int(),
})
export type StockVarianceLine = z.infer<typeof StockVarianceLineSchema>

/**
 * The check-in record, unique per trip. `cashVariancePaise = handedOverCashPaise − expectedCashPaise`;
 * `hasVariance` = beyond the tolerance OR any stock delta, and then `approvedBy` is the owner who
 * accepted it (`acceptVariance`). UPI and cheques are reported, never netted into the cash expected.
 */
export const TripSettlementSchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  expectedCashPaise: PaiseSchema,
  handedOverCashPaise: PaiseSchema,
  cashVariancePaise: PaiseSchema,
  upiCollectedPaise: PaiseSchema,
  chequeCollectedPaise: PaiseSchema,
  expensesPaise: PaiseSchema,
  stockVariance: z.array(StockVarianceLineSchema),
  hasVariance: z.boolean(),
  settledBy: IdSchema.nullable(),
  settledAt: z.string(),
  approvedBy: IdSchema.nullable(),
  approvedAt: z.string().nullable(),
  note: z.string().nullable(),
})
export type TripSettlement = z.infer<typeof TripSettlementSchema>

/**
 * Everything the crew's trip screen and the owner's drill-down need in one call. `loadConfirmedAt` is
 * `LoadSheetsService.confirmedForTrip` (null until the godown has confirmed a sheet for this trip);
 * `expectedCashPaise` is recomputed from the tables on every read (docs/20 rule 1 — nothing is held in
 * process memory). The delivery role gets 403 unless it is the driver or the helper.
 */
export const TripDetailSchema = TripSchema.extend({
  stops: z.array(StopSchema),
  collections: z.array(CollectionSchema),
  expenses: z.array(TripExpenseSchema),
  settlement: TripSettlementSchema.nullable(),
  loadConfirmedAt: z.string().nullable(),
  /** The confirmed load sheets of this trip (`warehouse.loadSheets.get` for the lots and the challan). */
  loadSheetIds: z.array(IdSchema),
  /** `vanSalesEnabled` AND `feature_flags.van_sales`: whether the van-sale button exists at all. */
  vanSalesAllowed: z.boolean(),
  /** opening cash + Σ cash collections − Σ expenses, as of now. */
  expectedCashPaise: PaiseSchema,
  policy: TripPolicySchema,
})
export type TripDetail = z.infer<typeof TripDetailSchema>

const TripItemOutput = z.object({ item: TripDetailSchema })
const StopItemOutput = z.object({ item: StopSchema })

// ---------------------------------------------------------------------------------------------------------------
// output shapes — deliveries and proof

export const DeliveryLineSchema = z.object({
  id: IdSchema,
  invoiceLineId: IdSchema,
  deliveredQtyPcs: PiecesSchema,
  returnedQtyPcs: PiecesSchema,
  /** Saleable returns go back INTO the vehicle; damaged ones into the tenant's damaged bin. */
  returnedSaleable: z.boolean(),
  reason: DeliveryLineReasonSchema.nullable(),
})
export type DeliveryLine = z.infer<typeof DeliveryLineSchema>

/**
 * One delivery attempt of one invoice at one stop. For the RETAILER role the mapper answers
 * `deliveredBy`, `note` and `deviceId` as null; `podKinds` says what proof exists without a URL
 * (`deliveries.get` signs the URLs). `shortPcs` = Σ (invoiced − delivered) over the lines.
 */
export const DeliverySchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  stopId: IdSchema,
  orderId: IdSchema.nullable(),
  invoiceId: IdSchema,
  invoiceNo: z.string().nullable(),
  retailerId: IdSchema,
  outcome: DeliveryOutcomeSchema.nullable(),
  deliveredBy: IdSchema.nullable(),
  deliveredAt: z.string().nullable(),
  /** "Bill signed by", as the crew typed it. */
  receiverName: z.string().nullable(),
  note: z.string().nullable(),
  deviceId: z.string().nullable(),
  shortPcs: PiecesSchema,
  returnedPcs: PiecesSchema,
  /** The single credit note raised at the original rate for the shortfall / return, when any. */
  creditNoteId: IdSchema.nullable(),
  podKinds: z.array(PodKindSchema),
  createdAt: z.string(),
})
export type Delivery = z.infer<typeof DeliverySchema>

export const PodEvidenceSchema = z.object({
  id: IdSchema,
  deliveryId: IdSchema,
  kind: PodKindSchema,
  /** The photo / signature image in object storage; null for an OTP or a geo check. */
  objectKey: z.string().nullable(),
  /** OTP: `{ verified: boolean }`; geo: `{ distanceM: number }`; signature: `{ signerName?: string }`. */
  payload: z.record(z.string(), z.unknown()).nullable(),
  lat: LatSchema.nullable(),
  lng: LngSchema.nullable(),
  capturedAt: z.string(),
})
export type PodEvidence = z.infer<typeof PodEvidenceSchema>

/** `deliveries.get` only: a short-lived read URL for the photo / signature, per `files.readUrl`'s per-domain table. */
export const PodEvidenceViewSchema = PodEvidenceSchema.extend({
  readUrl: z.string().nullable(),
  readUrlExpiresAt: z.string().nullable(),
})
export type PodEvidenceView = z.infer<typeof PodEvidenceViewSchema>

export const DeliveryDetailSchema = DeliverySchema.extend({
  lines: z.array(DeliveryLineSchema),
  pod: z.array(PodEvidenceViewSchema),
  creditNote: InvoiceCreditNoteRefSchema.nullable(),
})
export type DeliveryDetail = z.infer<typeof DeliveryDetailSchema>

// ---------------------------------------------------------------------------------------------------------------
// inputs — shared pieces

/**
 * The bytes of a proof, ONLY when `files.uploadUrl` answered `inline: true` (the local object-storage
 * driver, which has nowhere to PUT). On S3 the app has already PUT the bytes to the pre-signed URL
 * and sends the `objectKey` alone. Capped at ~512 KB decoded: the app compresses a proof to ≤ 1600 px /
 * ~200 KB (UX-00 §8.3) and one request body must stay small on a 2G road.
 */
export const InlineFileInput = z.object({
  mimeType: FileMimeTypeSchema,
  contentBase64: z.base64().max(700_000),
})
export type InlineFileIn = z.infer<typeof InlineFileInput>

/**
 * One piece of proof. `objectKey` comes from `files.uploadUrl` (`domain: 'pod'`, `entityId` = the
 * delivery id); `inline` replaces it on the local driver. A `photo` / `signature` needs one of the
 * two; an `otp` / `geo` carries its result in `payload` and no file.
 */
export const PodEvidenceInput = z
  .object({
    id: IdSchema,
    kind: PodKindSchema,
    objectKey: z.string().trim().min(1).max(512).optional(),
    inline: InlineFileInput.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    lat: LatSchema.optional(),
    lng: LngSchema.optional(),
    capturedAt: IsoDateTimeSchema.optional(),
  })
  .refine(
    (e) =>
      e.kind === 'photo' || e.kind === 'signature'
        ? Boolean(e.objectKey) !== Boolean(e.inline)
        : !e.objectKey && !e.inline,
    'a photo or signature carries exactly one of objectKey / inline; an otp or geo carries neither',
  )
export type PodEvidenceIn = z.infer<typeof PodEvidenceInput>

// ---------------------------------------------------------------------------------------------------------------
// inputs — vehicles and consents

export const VehiclesListInput = z.object({
  activeOnly: QueryBoolSchema.default(true),
  kind: VehicleKindSchema.optional(),
})
export const VehiclesListOutput = z.object({ items: z.array(VehicleSchema) })

/**
 * Creates or updates a vehicle and, on create, its stock location through
 * `InventoryService.ensureVehicleLocation` (`kind = 'vehicle'`, `negative_allowed = false`). No numbering
 * series is seeded: a van sale bills from the tenant's normal series (§D5). A second vehicle with the
 * same `regNo` is 409.
 */
export const UpsertVehicleInput = MutationBase.extend({
  id: IdSchema,
  regNo: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(60).optional(),
  kind: VehicleKindSchema.default('tempo'),
  capacityCases: z.number().int().positive().optional(),
  active: z.boolean().default(true),
})
export const UpsertVehicleOutput = z.object({ item: VehicleSchema, created: z.boolean() })

/** Every call writes one `audit_log` row (`gps.live_map_read`): reading where a person is, is audited (docs/17 A12). */
export const VehiclePositionsInput = z.object({
  vehicleId: IdSchema.optional(),
  staleAfterMinutes: QueryIntSchema.min(1).max(1440).default(30),
})
export const VehiclePositionsOutput = z.object({ items: z.array(VehiclePositionSchema) })

/** The DPDP notice screen. Always writes a row for the CALLER (`user_id = actor`); `granted: false` records a refusal. */
export const GrantConsentInput = MutationBase.extend({
  id: IdSchema,
  granted: z.boolean(),
  noticeVersion: z.string().trim().min(1).max(40),
  locale: LocaleSchema.default('en-IN'),
  deviceId: DeviceIdSchema.optional(),
})
export const GrantConsentOutput = z.object({ item: LocationConsentSchema })

/** The caller's own current consent, or a driver's for the owner/manager planning a trip (`userId`). */
export const ConsentGetInput = z.object({
  userId: IdSchema.optional(),
})
export const ConsentGetOutput = z.object({ item: LocationConsentSchema.nullable() })

// ---------------------------------------------------------------------------------------------------------------
// inputs — trips

/**
 * A planned stop. `invoiceIds` are the packed bills for this shop; each becomes a planned `deliveries`
 * row (`outcome: null`) so `depart`, `fail` and `record` know which documents ride on the van.
 */
export const TripStopInput = z.object({
  id: IdSchema,
  sequence: z.number().int().positive(),
  retailerId: IdSchema,
  invoiceIds: z.array(IdSchema).max(50).default([]),
  plannedCollectionPaise: PaiseSchema.nonnegative().optional(),
  etaAt: IsoDateTimeSchema.optional(),
})

/**
 * Plans a trip (`state = 'planned'`, `tripNo` from the `TRIP` series) with its stops in sequence.
 * `vanSalesEnabled` is 400 unless `feature_flags.van_sales` is on; `driverId === helperId` is 400; a
 * driver already on a non-terminal trip that day is 409. A `delivery` caller must be the driver or
 * helper of the trip it plans. A trip may have zero stops only when van sales are enabled.
 */
export const CreateTripInput = MutationBase.extend({
  id: IdSchema,
  tripDate: IsoDateSchema,
  vehicleId: IdSchema,
  driverId: IdSchema,
  helperId: IdSchema.optional(),
  vanSalesEnabled: z.boolean().default(false),
  openingCashPaise: PaiseSchema.nonnegative().default(0),
  stops: z.array(TripStopInput).max(80).default([]),
  deviceId: DeviceIdSchema.optional(),
})
export const CreateTripOutput = TripItemOutput

export const TripsListInput = z.object({
  state: TripStateSchema.optional(),
  /** Several states in one call (bracket notation on the query string). */
  states: z.array(TripStateSchema).max(7).optional(),
  vehicleId: IdSchema.optional(),
  driverId: IdSchema.optional(),
  /** Trip date on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** Trips the caller is driver or helper on. FORCED to true for the delivery role. */
  mine: QueryBoolSchema.default(false),
  ...CursorInput,
})
export const TripsListOutput = z.object({
  items: z.array(TripSchema),
  nextCursor: z.string().nullable(),
})

export const TripGetInput = z.object({ id: IdSchema })
export const TripGetOutput = TripItemOutput

/** `tripMachine.next(state, 'start_loading')`. The godown's load sheet is built and confirmed while the trip is `loading`. */
export const StartLoadingInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
export const StartLoadingOutput = TripItemOutput

/**
 * `tripMachine.next(state, 'depart')` → `active`. Needs a granted `location_consents` row for the driver
 * (403 `gps_consent_missing`); a denied OS permission on the phone never blocks it. 409 when the trip has
 * no stops and van sales are off. Orders on the trip that the godown has NOT dispatched through a
 * confirmed load sheet are dispatched here; an already-dispatched order is a no-op (coordination §4
 * item 4).
 */
export const DepartTripInput = MutationBase.extend({
  id: IdSchema,
  startOdometerKm: z.number().int().nonnegative().optional(),
  /** Overrides the float planned at create, when the cashier hands over a different amount. */
  openingCashPaise: PaiseSchema.nonnegative().optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const DepartTripOutput = TripItemOutput

/**
 * Check-in: `tripMachine.next(state, 'return')` → `closing`. Stops still pending / started / arrived
 * become `failed` (`other`, "trip returned") and their orders go `return_undelivered`; the pieces stay
 * on the van until the settlement counts them back.
 */
export const ReturnTripInput = MutationBase.extend({
  id: IdSchema,
  endOdometerKm: z.number().int().nonnegative().optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const ReturnTripOutput = TripItemOutput

/** Only from `planned` / `loading`: a trip that has left cannot be cancelled, it returns and settles. Stops → `skipped`. */
export const CancelTripInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const CancelTripOutput = TripItemOutput

// ---------------------------------------------------------------------------------------------------------------
// inputs — settlement

export const SettlementPreviewInput = z.object({ id: IdSchema })

/**
 * The check-in cockpit, read-only and recomputed on every call. `expectedCashPaise = openingCashPaise +
 * Σ cash collections − Σ expenses`; UPI and cheques are reported beside it. `expectedVanStock` is the
 * vehicle location's `stock_balances.on_hand` per lot. `tolerancePaise` is the tenant's setting.
 */
export const SettlementPreviewOutput = z.object({
  tripId: IdSchema,
  tripState: TripStateSchema,
  openingCashPaise: PaiseSchema,
  cashCollectedPaise: PaiseSchema,
  upiCollectedPaise: PaiseSchema,
  chequeCollectedPaise: PaiseSchema,
  expensesPaise: PaiseSchema,
  expectedCashPaise: PaiseSchema,
  tolerancePaise: PaiseSchema,
  expectedVanStock: z.array(VanStockLineSchema),
  stopsPlanned: z.number().int().nonnegative(),
  stopsDelivered: z.number().int().nonnegative(),
  stopsPartial: z.number().int().nonnegative(),
  stopsFailed: z.number().int().nonnegative(),
  collectionsCount: z.number().int().nonnegative(),
  settlement: TripSettlementSchema.nullable(),
})

export const CountedLotInput = z.object({
  lotId: IdSchema,
  countedPcs: PiecesSchema,
})

/**
 * Settle a `closing` trip. Counted pieces move vehicle → godown (`van_unload` + `transfer_in` per lot);
 * a miscount writes a `cycle_count` row at the vehicle so its balance ends at zero; the cash is one
 * balanced journal entry (`ref_type = 'trip_settlement'`). Cash variance beyond `tolerancePaise`, or
 * ANY stock delta, is red: 409 `settlement_needs_owner` — which also files an `approvals` row of kind
 * `trip_settlement` for the owner's queue — unless the caller is the OWNER and sends `acceptVariance`.
 * A lot the van holds that is missing from `counted` is counted as zero.
 */
export const SettleTripInput = MutationBase.extend({
  /** Client-generated id of the settlement row. */
  id: IdSchema,
  tripId: IdSchema,
  handedOverCashPaise: PaiseSchema.nonnegative(),
  counted: z.array(CountedLotInput).max(500).default([]),
  note: z.string().trim().max(300).optional(),
  acceptVariance: z.boolean().default(false),
})
export const SettleTripOutput = z.object({
  item: TripSettlementSchema,
  tripState: TripStateSchema,
  stockAdjustments: z.array(StockVarianceLineSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — stops

export const StopsListInput = z.object({
  tripId: IdSchema.optional(),
  retailerId: IdSchema.optional(),
  state: StopStateSchema.optional(),
  /** The trip's IST date. */
  date: IsoDateSchema.optional(),
  ...CursorInput,
})
export const StopsListOutput = z.object({
  items: z.array(StopSchema),
  nextCursor: z.string().nullable(),
})

export const NextStopInput = z.object({ id: IdSchema })

/**
 * The crew's home screen: the first stop of the trip by `sequence` that is not terminal, with the shop
 * it belongs to. `item` is null when every stop is done (time to head back). `remaining` counts the
 * stops still open including this one.
 */
export const NextStopOutput = z.object({
  item: StopSchema.nullable(),
  retailer: StopRetailerSchema.nullable(),
  remaining: z.number().int().nonnegative(),
})

/**
 * Adds a stop to a `planned` / `loading` / `active` trip — the desk adding a late bill, or the crew
 * adding the shop it is about to sell van stock to. `sequence` defaults to last. A `delivery` caller may
 * add only to its own active trip and only when van sales are allowed on it.
 */
export const AddStopInput = MutationBase.extend({
  /** The trip. */
  id: IdSchema,
  stop: TripStopInput.extend({ sequence: z.number().int().positive().optional() }),
  deviceId: DeviceIdSchema.optional(),
})
export const AddStopOutput = TripItemOutput

export const StopOrderInput = z.object({
  stopId: IdSchema,
  sequence: z.number().int().positive(),
})

/** Rewrites the sequence of the listed open stops. A terminal stop listed with a new sequence is 409. */
export const ReorderStopsInput = MutationBase.extend({
  /** The trip. */
  id: IdSchema,
  order: z.array(StopOrderInput).min(1).max(80),
  deviceId: DeviceIdSchema.optional(),
})
export const ReorderStopsOutput = TripItemOutput

/**
 * `stopMachine.next(state, 'start')`. Out-of-order offline batches are tolerated: a stop already past
 * `started` whose incoming `occurredAt` is OLDER than what is stored answers the current row unchanged,
 * never a 409 (docs/07 §7.3).
 */
export const StartStopInput = MutationBase.extend({
  id: IdSchema,
  occurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const StartStopOutput = StopItemOutput

/** `stopMachine.next(state, 'arrive')`; the fix is evidence for the geofence, never a block (a missing fix is fine). */
export const ArriveStopInput = MutationBase.extend({
  id: IdSchema,
  lat: LatSchema.optional(),
  lng: LngSchema.optional(),
  accuracyM: z.number().nonnegative().optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
/** `distanceM` = haversine to the shop's pin, null when either side has no coordinates. Amber in the app beyond `policy.geofenceMetres`. */
export const ArriveStopOutput = z.object({
  item: StopSchema,
  distanceM: z.number().nonnegative().nullable(),
})

/**
 * `stopMachine.next(state, 'fail')`. Every planned delivery on the stop becomes `outcome = 'failed'`
 * with zero-quantity lines and its order goes `return_undelivered` (`dispatched → packed`). NO stock
 * moves — the pieces stay on the van until check-in.
 */
export const FailStopInput = MutationBase.extend({
  id: IdSchema,
  failureReason: StopFailureReasonSchema,
  failureNote: z.string().trim().max(200).optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
}).refine(
  (i) => i.failureReason !== 'other' || Boolean(i.failureNote?.trim()),
  'failureNote is required when failureReason is other',
)
export const FailStopOutput = z.object({
  item: StopSchema,
  deliveries: z.array(DeliverySchema),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — deliveries

/**
 * Per invoice line: `deliveredQtyPcs + returnedQtyPcs` must equal the line's `qtyPcs + freeQtyPcs`
 * (400 otherwise) — free pieces are delivered and returned like any other piece. A line delivered
 * short with nothing handed back is a short delivery (the pieces were not on the van); a returned
 * line is goods handed back at the door. A returned line whose `reason` is `damaged` or `expired`
 * (`UNSALEABLE_RETURN_REASONS`) goes to the damaged bin and must carry `returnedSaleable: false`
 * (400 `return_not_saleable` otherwise).
 */
export const DeliveryLineInput = z.object({
  id: IdSchema,
  invoiceLineId: IdSchema,
  deliveredQtyPcs: PiecesSchema,
  returnedQtyPcs: PiecesSchema.default(0),
  returnedSaleable: z.boolean().default(true),
  reason: DeliveryLineReasonSchema.optional(),
})

/**
 * THE doorstep write: full, partial or failed in one call — the outcome is derived from the lines,
 * never sent. Writes the delivery, its lines and proof, adds the delivered pieces to the order through
 * `OrdersService.recordDelivered` and moves it `deliver_all` / `deliver_partial`, posts returns into
 * the vehicle (saleable) or the damaged bin, raises ONE credit note at the original rate for any
 * shortfall or return (`CreditNotesService.raiseForDelivery` — the issued invoice is never edited) and
 * moves the stop through `stopMachine`. When the tenant's `podRequired` policy applies to this shop
 * and no photo / signature is attached the call is 400 `pod_required`. `id` is the planned delivery
 * row created with the stop (`Stop.deliveries[].id`), or a new client id for a bill added at the door.
 */
export const RecordDeliveryInput = MutationBase.extend({
  id: IdSchema,
  tripId: IdSchema,
  stopId: IdSchema,
  invoiceId: IdSchema,
  receiverName: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
  deliveredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
  lines: z.array(DeliveryLineInput).min(1).max(200),
  pod: z.array(PodEvidenceInput).max(5).default([]),
})
export const RecordDeliveryOutput = z.object({
  item: DeliveryDetailSchema,
  stop: StopSchema,
  creditNoteId: IdSchema.nullable(),
})

/**
 * Proof arriving AFTER the state ("proof pending", docs/07 §7.3): the photo was uploaded through
 * `files.uploadUrl` (`domain: 'pod'`) and only the key lands here, or the bytes come inline on the
 * local driver. Idempotent by evidence id. At most 10 pieces of proof per delivery.
 */
export const AddPodInput = MutationBase.extend({
  /** The delivery. */
  id: IdSchema,
  evidence: PodEvidenceInput,
})
export const AddPodOutput = z.object({ item: PodEvidenceSchema })

export const DeliveriesListInput = z.object({
  tripId: IdSchema.optional(),
  stopId: IdSchema.optional(),
  invoiceId: IdSchema.optional(),
  retailerId: IdSchema.optional(),
  outcome: DeliveryOutcomeSchema.optional(),
  /** Only rows with an outcome (skips the planned, not-yet-attempted ones). */
  attemptedOnly: QueryBoolSchema.default(false),
  /** Delivered on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const DeliveriesListOutput = z.object({
  items: z.array(DeliverySchema),
  nextCursor: z.string().nullable(),
})

export const DeliveryGetInput = z.object({ id: IdSchema })
export const DeliveryGetOutput = z.object({ item: DeliveryDetailSchema })

// ---------------------------------------------------------------------------------------------------------------
// inputs — collections (THE money-collection path of the field, docs/17 §D4)

/** One line of an explicit split; `id` is the client-generated id of the `allocations` row it creates. */
export const CollectionAllocationInput = z.object({
  id: IdSchema,
  invoiceId: IdSchema,
  amountPaise: PaiseSchema.positive(),
})

/**
 * Money at the door. Calls `ReceivablesService.recordReceipt` (the `RCPT` series, `trip_id` set so cash
 * posts to CASH_VAN, cheque to CHEQUES, UPI to UPI; oldest bill first unless `allocations` names the
 * bills; the cash-discount condition realised inside its window; the journal entry balanced), then
 * writes the `collections` row (`receiptId` unique per tenant). Surplus over the shop's dues stays on
 * the receipt as on-account, never refused. A receipt is append-only: a wrong amount is reversed by the
 * desk (`receivables.receipts.reverse`), never edited here. Only while the trip is `active` or `closing`.
 */
export const RecordCollectionInput = MutationBase.extend({
  /** The collection row. */
  id: IdSchema,
  /** Client-generated id of the receipt receivables writes. */
  receiptId: IdSchema,
  tripId: IdSchema,
  stopId: IdSchema.optional(),
  retailerId: IdSchema,
  mode: CollectionModeSchema,
  amountPaise: PaiseSchema.positive(),
  /** The UPI UTR or the cheque number — required for those two modes (docs/22 §4 D6). */
  reference: z.string().trim().min(1).max(64).optional(),
  upiVpa: z.string().trim().min(3).max(120).optional(),
  chequeDate: IsoDateSchema.optional(),
  bankName: z.string().trim().min(1).max(120).optional(),
  /** A photo of the cheque or the UPI confirmation: `files.uploadUrl` (`domain: 'pod'`, `entityId` = `receiptId`), stored on the receipt. */
  proofObjectKey: z.string().trim().min(1).max(512).optional(),
  /** Explicit bill-to-bill split; omitted = oldest bill first. */
  allocations: z.array(CollectionAllocationInput).max(20).optional(),
  /** The crew's paper book number; with `deviceId` it is the offline dedupe key of the receipt. */
  clientReceiptNo: z.string().trim().min(1).max(32).optional(),
  collectedAt: IsoDateTimeSchema.optional(),
  note: z.string().trim().max(300).optional(),
  deviceId: DeviceIdSchema.optional(),
}).superRefine((c, ctx) => {
  if (c.mode !== 'cash' && !c.reference)
    ctx.addIssue({
      code: 'custom',
      path: ['reference'],
      message: 'the UTR (upi) or the cheque number (cheque) is required',
    })
  if (c.mode === 'cheque' && !c.chequeDate)
    ctx.addIssue({
      code: 'custom',
      path: ['chequeDate'],
      message: 'chequeDate is required for a cheque',
    })
})
export type RecordCollectionIn = z.infer<typeof RecordCollectionInput>

/** The collection plus exactly what `receivables.receipts.create` answers, so the crew's screen is one call. */
export const RecordCollectionOutput = z.object({
  item: CollectionSchema,
  receipt: ReceiptSchema,
  allocations: z.array(AllocationSchema),
  invoices: z.array(SettledInvoiceSchema),
  cashDiscountPaise: PaiseSchema,
  unallocatedPaise: PaiseSchema,
  outstanding: RetailerOutstandingSchema,
})

export const CollectionsListInput = z.object({
  tripId: IdSchema.optional(),
  retailerId: IdSchema.optional(),
  mode: CollectionModeSchema.optional(),
  /** Collected on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
/** `totals` are over the whole filter, not the page: the crew's day summary and the accountant's cash in transit. */
export const CollectionsListOutput = z.object({
  items: z.array(CollectionSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    cashPaise: PaiseSchema,
    upiPaise: PaiseSchema,
    chequePaise: PaiseSchema,
  }),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — van sales (ADR 0013, billed from the tenant's normal series, §D5)

/** Take the money in the same transaction as the bill; the receipt allocates to this invoice first. */
export const VanSaleCollectInput = z.object({
  id: IdSchema,
  receiptId: IdSchema,
  mode: CollectionModeSchema,
  amountPaise: PaiseSchema.positive(),
  reference: z.string().trim().min(1).max(64).optional(),
  upiVpa: z.string().trim().min(3).max(120).optional(),
  chequeDate: IsoDateSchema.optional(),
  bankName: z.string().trim().min(1).max(120).optional(),
  clientReceiptNo: z.string().trim().min(1).max(32).optional(),
})

/**
 * An on-the-spot sale from van stock, in ONE transaction: the order is created through `OrdersService`
 * (`source = 'van_sale'`, `fulfilFromLocationId` = the vehicle's location, priced by `priceOrder()`
 * exactly like any other order) → submitted → confirmed (reserving from the VEHICLE — a shortage is a
 * hard 400 with the short lines, the van never goes negative), billed by
 * `BillingService.issueFromLocation` on the TENANT'S NORMAL SERIES with `source = 'van_sale'` (§D5),
 * the `sale` ledger rows posted at the vehicle, a `deliveries` row written at full quantity, and, when
 * `collect` is present, the collection recorded exactly as `collections.record` does. 403 unless the
 * trip is `active` and `vanSalesAllowed`. The shop must already exist in this tenant (the crew never
 * onboards a shop, docs/17 item 27); `stopId` names the stop it is sold at, else `stops.add` is implied.
 */
export const CreateVanSaleInput = MutationBase.extend({
  /** Client-generated id of the ORDER. */
  id: IdSchema,
  tripId: IdSchema,
  stopId: IdSchema.optional(),
  retailerId: IdSchema,
  /** Client-generated ids of the invoice and the delivery this call creates. */
  invoiceId: IdSchema,
  deliveryId: IdSchema,
  invoiceDate: IsoDateSchema.optional(),
  lines: z.array(OrderLineInput).min(1).max(50),
  collect: VanSaleCollectInput.optional(),
  note: z.string().trim().max(300).optional(),
  deviceId: DeviceIdSchema.optional(),
})
/** The bill is the full `InvoiceDetail` with its `seller` block: it is printed / shared at the door (§D6). */
export const CreateVanSaleOutput = z.object({
  order: OrderDetailSchema,
  invoice: InvoiceDetailSchema,
  delivery: DeliverySchema,
  collection: CollectionSchema.nullable(),
  receipt: ReceiptSchema.nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — expenses

/**
 * Diesel, toll, parking… with a proof photo (`files.uploadUrl`, `domain: 'expense'`, `entityId` = this
 * id; or `inline` on the local driver). Only while the trip is `active` or `closing` (409). No journal
 * row here: expenses hit the books once, at settlement, so the trip's cash story is one entry.
 */
export const RecordExpenseInput = MutationBase.extend({
  id: IdSchema,
  tripId: IdSchema,
  kind: TripExpenseKindSchema,
  amountPaise: PaiseSchema.positive(),
  proofObjectKey: z.string().trim().min(1).max(512).optional(),
  inline: InlineFileInput.optional(),
  note: z.string().trim().max(200).optional(),
  incurredAt: IsoDateTimeSchema.optional(),
  deviceId: DeviceIdSchema.optional(),
})
  .refine((e) => !(e.proofObjectKey && e.inline), 'send proofObjectKey or inline, not both')
  .refine(
    (e) => e.kind !== 'other' || Boolean(e.note?.trim()),
    'note is required when kind is other',
  )
export const RecordExpenseOutput = z.object({ item: TripExpenseSchema })

export const ExpensesListInput = z.object({
  tripId: IdSchema.optional(),
  kind: TripExpenseKindSchema.optional(),
  /** Recorded on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const ExpensesListOutput = z.object({
  items: z.array(TripExpenseSchema),
  nextCursor: z.string().nullable(),
  /** Over the whole filter, not the page. */
  totalPaise: PaiseSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — GPS (ADR 0012: bypasses the sync queue)

export const GpsPointInput = z.object({
  recordedAt: IsoDateTimeSchema,
  lat: LatSchema,
  lng: LngSchema,
  accuracyM: z.number().nonnegative().optional(),
  speedMps: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  battery: z.number().int().min(0).max(100).optional(),
})
export type GpsPointIn = z.infer<typeof GpsPointInput>

/**
 * A batch of breadcrumbs from one phone on one trip (30 s / 50 m, or on reconnect). `idempotencyKey` is
 * carried like every mutation but NOT persisted: the dedupe is `UNIQUE(tenant, trip, device,
 * recordedAt)` with `onConflictDoNothing`, so a replay costs nothing. The caller must be the trip's
 * driver or helper (403 — the one 4xx besides a malformed body).
 */
export const GpsPointsInput = MutationBase.extend({
  tripId: IdSchema,
  deviceId: DeviceIdSchema,
  points: z.array(GpsPointInput).min(1).max(500),
})

/**
 * Always 2xx for a well-formed batch. `accepted` were stored and, when newest, moved the vehicle's
 * position; `duplicates` were already there; `dropped` fell outside `[startedAt − 15 min, endedAt +
 * 15 min]` or arrived for a trip not `active` / `closing`; `skewed` counts points whose device clock
 * was more than 10 minutes off (still stored, just reported). `throttled` means the device is over its
 * per-device budget: nothing was stored, keep the buffer and retry after `retryAfterSeconds` — never a
 * 429 hot loop (docs/20 rule 6).
 */
export const GpsPointsOutput = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  skewed: z.number().int().nonnegative(),
  throttled: z.boolean(),
  retryAfterSeconds: z.number().int().positive().nullable(),
  tripState: TripStateSchema,
  positionUpdated: z.boolean(),
})

export const GpsTracePointSchema = z.object({
  recordedAt: z.string(),
  lat: LatSchema,
  lng: LngSchema,
  accuracyM: z.number().nullable(),
  speedMps: z.number().nullable(),
  heading: z.number().nullable(),
  battery: z.number().int().nullable(),
  deviceId: z.string(),
})
export type GpsTracePoint = z.infer<typeof GpsTracePointSchema>

/**
 * The owner's replay of a trip. Every call writes an `audit_log` row (`gps.trace_read`, docs/17 A12).
 * `everyNth` thins the trace; points older than `policy.gpsRetentionDays` are already gone.
 */
export const GpsTraceInput = z.object({
  /** The trip. */
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
  everyNth: QueryIntSchema.min(1).max(60).default(5),
  limit: QueryIntSchema.min(1).max(500).default(500),
  cursor: z.string().optional(),
})
export const GpsTraceOutput = z.object({
  items: z.array(GpsTracePointSchema),
  nextCursor: z.string().nullable(),
  /** True when the trip holds more points than one page even after thinning. */
  truncated: z.boolean(),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `delivery: deliveryContract` in contract.ts

export const deliveryContract = {
  vehicles: {
    list: oc
      .route({ method: 'GET', path: '/delivery/vehicles', summary: 'Vehicles of this distributor' })
      .input(VehiclesListInput)
      .output(VehiclesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/delivery/vehicles',
        summary: 'Create or update a vehicle (and its stock location)',
      })
      .input(UpsertVehicleInput)
      .output(UpsertVehicleOutput),
    positions: oc
      .route({
        method: 'GET',
        path: '/delivery/vehicle-positions',
        summary: 'Where every vehicle is now — the live map (audited read)',
      })
      .input(VehiclePositionsInput)
      .output(VehiclePositionsOutput),
  },
  consents: {
    grant: oc
      .route({
        method: 'POST',
        path: '/delivery/consents',
        summary: "Record the caller's answer to the location-tracking notice (DPDP)",
      })
      .input(GrantConsentInput)
      .output(GrantConsentOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/delivery/consents',
        summary: 'The current location consent of the caller (or of a driver, for the desk)',
      })
      .input(ConsentGetInput)
      .output(ConsentGetOutput),
  },
  trips: {
    create: oc
      .route({ method: 'POST', path: '/delivery/trips', summary: 'Plan a trip with its stops' })
      .input(CreateTripInput)
      .output(CreateTripOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/delivery/trips',
        summary: 'Trips (the crew sees only its own)',
      })
      .input(TripsListInput)
      .output(TripsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/delivery/trips/{id}',
        summary: "One trip with stops, collections, expenses, settlement and the tenant's policy",
      })
      .input(TripGetInput)
      .output(TripGetOutput),
    startLoading: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/start-loading',
        summary: 'planned → loading: the godown builds the load sheet',
      })
      .input(StartLoadingInput)
      .output(StartLoadingOutput),
    depart: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/depart',
        summary: "Start the trip: loading → active (needs the driver's location consent)",
      })
      .input(DepartTripInput)
      .output(DepartTripOutput),
    return: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/return',
        summary: 'Check in: active → closing; open stops fail and their orders go back to packed',
      })
      .input(ReturnTripInput)
      .output(ReturnTripOutput),
    cancel: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/cancel',
        summary: 'Cancel a trip that has not left (planned / loading)',
      })
      .input(CancelTripInput)
      .output(CancelTripOutput),
    settlementPreview: oc
      .route({
        method: 'GET',
        path: '/delivery/trips/{id}/settlement',
        summary: 'The check-in cockpit: expected cash, collections by mode, expenses, van stock',
      })
      .input(SettlementPreviewInput)
      .output(SettlementPreviewOutput),
    settle: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/settle',
        summary:
          'Settle: count the van back in, hand over the cash; variance beyond tolerance needs the owner',
      })
      .input(SettleTripInput)
      .output(SettleTripOutput),
  },
  stops: {
    list: oc
      .route({
        method: 'GET',
        path: '/delivery/stops',
        summary: 'Stops (a shop sees only its own, with an ETA and never a coordinate)',
      })
      .input(StopsListInput)
      .output(StopsListOutput),
    next: oc
      .route({
        method: 'GET',
        path: '/delivery/trips/{id}/next-stop',
        summary: 'The next open stop of a trip with the shop to visit',
      })
      .input(NextStopInput)
      .output(NextStopOutput),
    add: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/stops',
        summary: 'Add a stop to a trip (a late bill, or the shop a van sale goes to)',
      })
      .input(AddStopInput)
      .output(AddStopOutput),
    reorder: oc
      .route({
        method: 'POST',
        path: '/delivery/trips/{id}/stops/reorder',
        summary: 'Re-sequence the open stops of a trip',
      })
      .input(ReorderStopsInput)
      .output(ReorderStopsOutput),
    start: oc
      .route({
        method: 'POST',
        path: '/delivery/stops/{id}/start',
        summary: 'Heading to the stop: pending → started',
      })
      .input(StartStopInput)
      .output(StartStopOutput),
    arrive: oc
      .route({
        method: 'POST',
        path: '/delivery/stops/{id}/arrive',
        summary: 'At the door: started → arrived, with the geofence distance as evidence',
      })
      .input(ArriveStopInput)
      .output(ArriveStopOutput),
    fail: oc
      .route({
        method: 'POST',
        path: '/delivery/stops/{id}/fail',
        summary: 'Nothing delivered: arrived → failed with a reason; stock stays on the van',
      })
      .input(FailStopInput)
      .output(FailStopOutput),
  },
  deliveries: {
    record: oc
      .route({
        method: 'POST',
        path: '/delivery/deliveries',
        summary:
          'Deliver a bill in full or in part with proof; a shortfall or return raises one credit note',
      })
      .input(RecordDeliveryInput)
      .output(RecordDeliveryOutput),
    addPod: oc
      .route({
        method: 'POST',
        path: '/delivery/deliveries/{id}/pod',
        summary: 'Attach proof of delivery that arrived after the delivery',
      })
      .input(AddPodInput)
      .output(AddPodOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/delivery/deliveries',
        summary: "Delivery register (a shop sees only its own bills' deliveries)",
      })
      .input(DeliveriesListInput)
      .output(DeliveriesListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/delivery/deliveries/{id}',
        summary: 'One delivery with its lines, proof (signed read URLs) and credit note',
      })
      .input(DeliveryGetInput)
      .output(DeliveryGetOutput),
  },
  collections: {
    record: oc
      .route({
        method: 'POST',
        path: '/delivery/collections',
        summary:
          'Collect cash / UPI / cheque at the door: one receipt, allocated oldest bill first',
      })
      .input(RecordCollectionInput)
      .output(RecordCollectionOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/delivery/collections',
        summary: 'What the crew collected, with totals by mode',
      })
      .input(CollectionsListInput)
      .output(CollectionsListOutput),
  },
  vanSales: {
    create: oc
      .route({
        method: 'POST',
        path: '/delivery/van-sales',
        summary:
          'Sell from van stock: order, bill on the normal series, delivery and collection in one call',
      })
      .input(CreateVanSaleInput)
      .output(CreateVanSaleOutput),
  },
  expenses: {
    record: oc
      .route({
        method: 'POST',
        path: '/delivery/expenses',
        summary: 'Record a trip expense with its proof',
      })
      .input(RecordExpenseInput)
      .output(RecordExpenseOutput),
    list: oc
      .route({ method: 'GET', path: '/delivery/expenses', summary: 'Trip expenses with a total' })
      .input(ExpensesListInput)
      .output(ExpensesListOutput),
  },
  gps: {
    points: oc
      .route({
        method: 'POST',
        path: '/gps/points',
        summary:
          'A batch of GPS breadcrumbs from one phone (never through the sync queue, never 4xx for a stale batch)',
      })
      .input(GpsPointsInput)
      .output(GpsPointsOutput),
    trace: oc
      .route({
        method: 'GET',
        path: '/delivery/trips/{id}/trace',
        summary: "Replay a trip's track (audited read)",
      })
      .input(GpsTraceInput)
      .output(GpsTraceOutput),
  },
}
