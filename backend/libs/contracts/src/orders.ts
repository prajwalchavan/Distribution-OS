import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { AppliedRuleSchema } from './pricing.js'
import { CreditCheckOutput } from './receivables.js'
import { PaymentTermsSchema } from './retailers.js'

/**
 * Sales Order — the primary aggregate (§4.3). The order is priced by `priceOrder()` through
 * `pricing.quote`, so every line carries the rules that were applied and the quantity exactly as the rep or
 * retailer typed it (`enteredQty` + `enteredUnit` + `packSizeAtEntry`, docs/17 A3) alongside the pieces the
 * ledger uses. States move only through `orderMachine`; the invoice is a separate artefact issued at pack.
 */

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD')
/** The device that produced a state change; stored on the transition so "where is my order" is answerable. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

export const OrderStateSchema = z.enum([
  'draft',
  'submitted',
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
  'cancelled',
])
export type OrderState = z.infer<typeof OrderStateSchema>

/** `brand_dms_import` and `import` orders are created by their own pipelines, never through these procedures. */
export const OrderSourceSchema = z.enum([
  'salesperson',
  'retailer_app',
  'van_sale',
  'phone',
  'whatsapp',
])
export const EnteredUnitSchema = z.enum(['piece', 'inner', 'case'])
export const OrderPricingDateModeSchema = z.enum(['order', 'delivery'])
export const ApprovalKindSchema = z.enum([
  'credit_limit',
  'bargain',
  'below_floor',
  'return',
  'scheme_override',
  'manual_price',
  /** A trip settlement whose cash or stock variance exceeded the tenant's tolerance (delivery). */
  'trip_settlement',
])
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>
export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired'])

// ---------------------------------------------------------------------------------------------------------------
// output shapes

export const OrderLineSchema = z.object({
  id: IdSchema,
  lineNo: z.number().int(),
  variantId: IdSchema,
  /**
   * The tenant's name for the item: `tenant_products.local_alias`, else the global `product_variants.name`.
   * Read when the order is fetched, so a line whose item was delisted after ordering is still named; the
   * invoice line freezes its own `description` at issue.
   */
  variantName: z.string(),
  /** What was typed, in the unit it was typed in, with the pack size frozen at entry (docs/17 A3). */
  enteredQty: z.number().int(),
  enteredUnit: EnteredUnitSchema,
  packSizeAtEntry: z.number().int(),
  qtyPcs: PiecesSchema,
  freeQtyPcs: PiecesSchema,
  pickedQtyPcs: PiecesSchema,
  deliveredQtyPcs: PiecesSchema,
  listRatePaise: PaiseSchema,
  ratePaise: PaiseSchema,
  discountBps: BpsSchema,
  discountPaise: PaiseSchema,
  gstBps: BpsSchema,
  /** Compensation-cess rate of the item's HSN on the pricing date; 0 for everything but sin/luxury goods. */
  cessBps: BpsSchema,
  /** GST plus compensation cess (DOS-079); `lineTotalPaise − taxPaise` is still the taxable. */
  taxPaise: PaiseSchema,
  /** The cess share of `taxPaise`, never an addition on top of it. */
  cessPaise: PaiseSchema,
  lineTotalPaise: PaiseSchema,
  appliedRules: z.array(AppliedRuleSchema),
  priceLocked: z.boolean(),
})
export type OrderLine = z.infer<typeof OrderLineSchema>

/** Reserved pieces per line; a line the location cannot cover is reserved short, never refused. */
export const OrderShortageSchema = z.object({
  lineId: IdSchema,
  variantId: IdSchema,
  requestedPcs: PiecesSchema,
  reservedPcs: PiecesSchema,
  shortQtyPcs: PiecesSchema,
})

export type OrderShortage = z.infer<typeof OrderShortageSchema>

/**
 * The shop's credit position when the order was submitted, in the words `receivables.creditCheck`
 * uses — the device never re-implements the rule (DOS-081). Present on an order whose check found
 * anything to say, in EVERY credit mode; it is a notice, not a gate.
 */
export const CreditNoticeSchema = CreditCheckOutput.pick({
  creditMode: true,
  reasons: true,
  outstandingPaise: true,
  creditLimitPaise: true,
  headroomPaise: true,
  overdueDays: true,
  orderTotalPaise: true,
})
export type CreditNotice = z.infer<typeof CreditNoticeSchema>

export const OrderSchema = z.object({
  id: IdSchema,
  /** Assigned from the `SO` series at submit, never at draft (ADR 0001). */
  orderNo: z.string().nullable(),
  retailerId: IdSchema,
  state: OrderStateSchema,
  source: z.string(),
  createdBy: IdSchema,
  salespersonId: IdSchema.nullable(),
  pricingDateMode: OrderPricingDateModeSchema,
  paymentTerms: PaymentTermsSchema,
  fulfilFromLocationId: IdSchema.nullable(),
  externalRef: z.string().nullable(),
  subtotalPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  /** GST plus compensation cess on the lines (DOS-079). */
  taxPaise: PaiseSchema,
  /** The cess share of `taxPaise`, never an addition on top of it. */
  cessPaise: PaiseSchema,
  roundOffPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  approvalFlags: z.array(z.string()),
  /**
   * What the godown could not fully hold when this order was confirmed (DOS-078): empty until it is
   * confirmed, and office-only — a retailer-role caller always reads `[]`. Recorded, never acted on:
   * the order confirms short and the warehouse decides what to do with it.
   */
  stockShortages: z.array(OrderShortageSchema),
  /**
   * The shop's credit position at submit when the check found something to say (DOS-081): a "warn at
   * the limit" shop's order confirms and carries this; strict and stop carry it beside their gate.
   * Office-only — `null` for a retailer-role caller — and `null` when nothing was wrong.
   */
  creditNotice: CreditNoticeSchema.nullable(),
  expectedDeliveryDate: z.string().nullable(),
  note: z.string().nullable(),
  submittedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
})
export type Order = z.infer<typeof OrderSchema>

export const OrderTransitionSchema = z.object({
  id: IdSchema,
  fromState: OrderStateSchema.nullable(),
  toState: OrderStateSchema,
  event: z.string(),
  actorId: z.string(),
  deviceId: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: z.string(),
})

export const ApprovalSchema = z.object({
  id: IdSchema,
  kind: ApprovalKindSchema,
  orderId: IdSchema.nullable(),
  entityType: z.string(),
  entityId: z.string(),
  requestedBy: IdSchema,
  status: ApprovalStatusSchema,
  payload: z.record(z.string(), z.unknown()),
  decidedBy: IdSchema.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
})
export type Approval = z.infer<typeof ApprovalSchema>

/**
 * A row of the approvals queue: the approval plus its order's number, total and shop, read from that order when
 * the list is asked (DOS-004), so no screen depends on what a payload happens to carry. All four are null for an
 * approval with no order behind it (a trip settlement, a bargain gate whose request names no order).
 */
export const ApprovalQueueItemSchema = ApprovalSchema.extend({
  orderNo: z.string().nullable(),
  orderTotalPaise: PaiseSchema.nullable(),
  retailerId: IdSchema.nullable(),
  retailerName: z.string().nullable(),
})
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>

/** `approvals` is empty for a retailer-role caller: an approval payload carries the shop's credit position. */
export const OrderDetailSchema = OrderSchema.extend({
  lines: z.array(OrderLineSchema),
  transitions: z.array(OrderTransitionSchema),
  approvals: z.array(ApprovalSchema),
})
export type OrderDetail = z.infer<typeof OrderDetailSchema>

const OrderItemOutput = z.object({ item: OrderDetailSchema })

// ---------------------------------------------------------------------------------------------------------------
// inputs

export const OrderLineInput = z.object({
  id: IdSchema,
  variantId: IdSchema,
  /** In `enteredUnit`; pieces are derived from the tenant's sell-side pack size (docs/17 B). */
  enteredQty: z.number().int().positive(),
  enteredUnit: EnteredUnitSchema.default('piece'),
})

export const CreateOrderInput = MutationBase.extend({
  id: IdSchema,
  retailerId: IdSchema,
  source: OrderSourceSchema,
  pricingDateMode: OrderPricingDateModeSchema.default('order'),
  /** Defaults to the retailer's terms. */
  paymentTerms: PaymentTermsSchema.optional(),
  fulfilFromLocationId: IdSchema.nullable().optional(),
  expectedDeliveryDate: IsoDateSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  deviceId: DeviceIdSchema.optional(),
  lines: z.array(OrderLineInput).min(1).max(200),
})
export const CreateOrderOutput = OrderItemOutput

export const SetOrderLinesInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
  lines: z.array(OrderLineInput).min(1).max(200),
})
export const SetOrderLinesOutput = OrderItemOutput

export const SubmitOrderInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
export const SubmitOrderOutput = OrderItemOutput

export const ConfirmOrderInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
export const ConfirmOrderOutput = z.object({
  item: OrderDetailSchema,
  shortages: z.array(OrderShortageSchema),
})

export const CancelOrderInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
  deviceId: DeviceIdSchema.optional(),
})
export const CancelOrderOutput = OrderItemOutput

export const RepeatLastOrderInput = MutationBase.extend({
  /** Id of the NEW draft; the lines are copied from the retailer's most recently placed order, never a draft. */
  id: IdSchema,
  retailerId: IdSchema,
  source: OrderSourceSchema.default('salesperson'),
  expectedDeliveryDate: IsoDateSchema.nullable().optional(),
  deviceId: DeviceIdSchema.optional(),
})
export const RepeatLastOrderOutput = OrderItemOutput

export const OrderGetInput = z.object({ id: IdSchema })
export const OrderGetOutput = OrderItemOutput

/**
 * The shop's most recently PLACED order with its lines (DOS-098): by when it was placed, by any author and from
 * any source, never a draft or a cancelled order. It writes nothing, so "Order again" builds its basket on the
 * device. `item` is null when the shop has placed none (for a salesperson: none credited to it).
 */
export const LastPlacedOrderInput = z.object({ retailerId: IdSchema })
export const LastPlacedOrderOutput = z.object({ item: OrderDetailSchema.nullable() })

/**
 * NEWEST FIRST by `created_at`, the server time the order was taken, the row id only breaking a tie —
 * the same column `from`/`to` filter, so the window and the order never disagree (QA DOS-009; founder,
 * 2026-09-21, the register reading of his 2026-09-20 rule). An order queue is work waiting to be done,
 * so its date IS the server's clock; ids are minted on the device and the demo seed's are hashes, so id
 * order is not age. `cursor` is the id of the last order of the page and walks that same
 * (`created_at`, id) order.
 */
export const OrdersListInput = z.object({
  state: OrderStateSchema.optional(),
  /** Several states in one call (bracket notation on the query string: `states[0]=confirmed&states[1]=packed`). */
  states: z.array(OrderStateSchema).max(10).optional(),
  /** Still travelling: submitted, confirmed, picking, packed or dispatched — the shop card's "pending undelivered". */
  openOnly: QueryBoolSchema.optional(),
  retailerId: IdSchema.optional(),
  salespersonId: IdSchema.optional(),
  /** On `created_at`, IST calendar dates: taken on or after / on or before this day. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** Matches the order number or the note. */
  q: z.string().trim().min(1).max(60).optional(),
  ...CursorInput,
})
export const OrdersListOutput = z.object({
  items: z.array(OrderSchema),
  nextCursor: z.string().nullable(),
})

export const ApprovalsListInput = z.object({
  status: ApprovalStatusSchema.optional(),
  orderId: IdSchema.optional(),
  kind: ApprovalKindSchema.optional(),
  ...CursorInput,
})
export const ApprovalsListOutput = z.object({
  items: z.array(ApprovalQueueItemSchema),
  nextCursor: z.string().nullable(),
})

export const DecideApprovalInput = MutationBase.extend({
  id: IdSchema,
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(200).optional(),
  deviceId: DeviceIdSchema.optional(),
})
/** `order` is the order after the decision: confirmed when the last pending approval was approved. */
export const DecideApprovalOutput = z.object({
  item: ApprovalSchema,
  order: OrderDetailSchema.nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `orders: ordersContract` in contract.ts

export const ordersContract = {
  create: oc
    .route({ method: 'POST', path: '/orders', summary: 'Create a priced draft order' })
    .input(CreateOrderInput)
    .output(CreateOrderOutput),
  setLines: oc
    .route({
      method: 'POST',
      path: '/orders/{id}/lines',
      summary: 'Replace the lines of a draft and re-price it',
    })
    .input(SetOrderLinesInput)
    .output(SetOrderLinesOutput),
  repeatLast: oc
    .route({
      method: 'POST',
      path: '/orders/repeat-last',
      summary: "Draft a repeat of the retailer's last order, re-priced today",
    })
    .input(RepeatLastOrderInput)
    .output(RepeatLastOrderOutput),
  submit: oc
    .route({
      method: 'POST',
      path: '/orders/{id}/submit',
      summary:
        'Submit: assign the order number, raise approvals or auto-confirm (a shop: its own draft)',
    })
    .input(SubmitOrderInput)
    .output(SubmitOrderOutput),
  confirm: oc
    .route({
      method: 'POST',
      path: '/orders/{id}/confirm',
      summary: 'Confirm and reserve stock (back office)',
    })
    .input(ConfirmOrderInput)
    .output(ConfirmOrderOutput),
  cancel: oc
    .route({
      method: 'POST',
      path: '/orders/{id}/cancel',
      summary: 'Cancel an order and release its reservations',
    })
    .input(CancelOrderInput)
    .output(CancelOrderOutput),
  lastPlaced: oc
    .route({
      method: 'GET',
      path: '/orders/last-placed',
      summary:
        "The shop's most recently placed order with its lines, which is what Order again repeats (writes nothing)",
    })
    .input(LastPlacedOrderInput)
    .output(LastPlacedOrderOutput),
  get: oc
    .route({
      method: 'GET',
      path: '/orders/{id}',
      summary: 'One order with lines, transitions and approvals',
    })
    .input(OrderGetInput)
    .output(OrderGetOutput),
  list: oc
    .route({
      method: 'GET',
      path: '/orders',
      summary: 'Orders (a retailer or a salesperson sees only its own)',
    })
    .input(OrdersListInput)
    .output(OrdersListOutput),
  approvals: {
    list: oc
      .route({ method: 'GET', path: '/approvals', summary: 'Approval queue (back office)' })
      .input(ApprovalsListInput)
      .output(ApprovalsListOutput),
    decide: oc
      .route({
        method: 'POST',
        path: '/approvals/{id}/decide',
        summary: 'Approve or reject; the last approval approved confirms the order',
      })
      .input(DecideApprovalInput)
      .output(DecideApprovalOutput),
  },
}
