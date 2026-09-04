import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
} from 'drizzle-orm/pg-core'
import {
  bps,
  id,
  paise,
  pieces,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  tenantPolicy,
  timestamps,
  tz,
} from './columns.js'
import { productVariants } from './catalog.js'
import { locations } from './inventory.js'
import { tenantRef } from './platform.js'
import { pricingDateMode } from './pricing.js'
import { paymentTerms, retailers } from './retailers.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/** Sales Order is the primary aggregate; the invoice is a derived artefact issued at pack (§4.4). */

export const orderState = pgEnum('order_state', [
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
export const orderSource = pgEnum('order_source', [
  'salesperson',
  'retailer_app',
  'van_sale',
  'phone',
  'whatsapp',
  'brand_dms_import',
  'import',
])

/** One rule the pricing engine applied to a line, stored so the bill prints Free/Scheme/Disc exactly (ADR 0008). */
export interface AppliedRule {
  ruleId: string
  version: number
  kind: 'override' | 'scheme' | 'bargain' | 'manual'
  rewardKind?: string
  amountPaise?: number
  freeQty?: number
  freeVariantId?: string
}

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: id(),
    tenantId: tenantRef(),
    /** Server-assigned human number (SO-0042) at submit; NULL while draft on device. */
    orderNo: text('order_no'),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    state: orderState('state').notNull().default('draft'),
    source: orderSource('source').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    /** Salesperson credited with the order (may differ from created_by for retailer-app orders on a beat). */
    salespersonId: text('salesperson_id').references(() => users.id),
    pricingDateMode: pricingDateMode('pricing_date_mode').notNull().default('order'),
    paymentTerms: paymentTerms('payment_terms').notNull(),
    fulfilFromLocationId: text('fulfil_from_location_id').references(() => locations.id),
    /** Brand-DMS reference when source = brand_dms_import (FieldAssist SO id). */
    externalRef: text('external_ref'),
    subtotalPaise: paise('subtotal_paise').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    taxPaise: paise('tax_paise').notNull().default(0),
    roundOffPaise: paise('round_off_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull().default(0),
    /** Approval-worthy conditions raised at submit (credit_limit, bargain, below_floor). */
    approvalFlags: jsonb('approval_flags')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expectedDeliveryDate: text('expected_delivery_date'),
    note: text('note'),
    submittedAt: tz('submitted_at'),
    confirmedAt: tz('confirmed_at'),
    closedAt: tz('closed_at'),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
  },
  (t) => [
    index('sales_orders_retailer_idx').on(t.tenantId, t.retailerId, t.createdAt),
    index('sales_orders_state_idx').on(t.tenantId, t.state, t.createdAt),
    index('sales_orders_salesperson_idx').on(t.tenantId, t.salespersonId, t.createdAt),
    index('sales_orders_no_idx').on(t.tenantId, t.orderNo),
    tenantOrOwnRetailerPolicy('sales_orders_read', 'retailer_id'),
    ...staffWritePolicy('sales_orders_write'),
    // The retailer app may create and edit its own draft/submitted orders for a linked retailer.
    pgPolicy('sales_orders_retailer_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND source = 'retailer_app' AND state IN ('draft', 'submitted') AND created_by = (SELECT current_setting('app.actor_id', true))
        AND retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true)) AND l.user_id = (SELECT current_setting('app.actor_id', true)) AND l.status = 'active'
        )`,
    }),
    pgPolicy('sales_orders_retailer_update', {
      for: 'update',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND created_by = (SELECT current_setting('app.actor_id', true)) AND state = 'draft'`,
      withCheck: sql`state IN ('draft', 'submitted', 'cancelled')`,
    }),
  ],
).enableRLS()

export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: id(),
    tenantId: tenantRef(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    lineNo: integer('line_no').notNull(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    /** What the retailer/rep typed, in the unit they think in; qty_pcs is what the ledger uses. */
    orderedQty: pieces('ordered_qty').notNull(),
    orderedUnit: text('ordered_unit').notNull().default('pcs'),
    qtyPcs: pieces('qty_pcs').notNull(),
    freeQtyPcs: pieces('free_qty_pcs').notNull().default(0),
    /** Fulfilment counters filled by warehouse/delivery. */
    pickedQtyPcs: pieces('picked_qty_pcs').notNull().default(0),
    deliveredQtyPcs: pieces('delivered_qty_pcs').notNull().default(0),
    listRatePaise: paise('list_rate_paise').notNull(),
    ratePaise: paise('rate_paise').notNull(),
    discountBps: bps('discount_bps').notNull().default(0),
    discountPaise: paise('discount_paise').notNull().default(0),
    gstBps: bps('gst_bps').notNull(),
    taxPaise: paise('tax_paise').notNull().default(0),
    lineTotalPaise: paise('line_total_paise').notNull().default(0),
    appliedRules: jsonb('applied_rules')
      .$type<AppliedRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Retailer's own retailer_price_override / bargain lock so re-pricing at delivery keeps it. */
    priceLocked: boolean('price_locked').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('sales_order_lines_order_idx').on(t.tenantId, t.orderId, t.lineNo),
    index('sales_order_lines_variant_idx').on(t.tenantId, t.variantId),
    pgPolicy('sales_order_lines_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id)
      )`,
    }),
    ...staffWritePolicy('sales_order_lines_write'),
    pgPolicy('sales_order_lines_retailer_write', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id AND o.state = 'draft' AND o.created_by = (SELECT current_setting('app.actor_id', true)))`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id AND o.state IN ('draft', 'submitted') AND o.created_by = (SELECT current_setting('app.actor_id', true)))`,
    }),
  ],
).enableRLS()

/** Every state change, who did it, from which device — the audit spine for "where is my order". */
export const orderStateTransitions = pgTable(
  'order_state_transitions',
  {
    id: id(),
    tenantId: tenantRef(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    fromState: orderState('from_state'),
    toState: orderState('to_state').notNull(),
    event: text('event').notNull(),
    actorId: text('actor_id').notNull(),
    deviceId: text('device_id'),
    reason: text('reason'),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('order_state_transitions_order_idx').on(t.tenantId, t.orderId, t.occurredAt),
    tenantOrOwnRetailerPolicy(
      'order_state_transitions_read',
      '(SELECT o.retailer_id FROM sales_orders o WHERE o.id = order_state_transitions.order_id)',
    ),
    ...staffWritePolicy('order_state_transitions_write'),
  ],
).enableRLS()

export const approvalKind = pgEnum('approval_kind', [
  'credit_limit',
  'bargain',
  'below_floor',
  'return',
  'scheme_override',
  'manual_price',
])
export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
])

/** Owner approvals queue: gates submitted → confirmed. */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    tenantId: tenantRef(),
    kind: approvalKind('kind').notNull(),
    orderId: text('order_id').references(() => salesOrders.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    status: approvalStatus('status').notNull().default('pending'),
    payload: jsonb('payload').notNull(),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: tz('decided_at'),
    decisionNote: text('decision_note'),
    ...timestamps,
  },
  (t) => [
    index('approvals_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('approvals_order_idx').on(t.tenantId, t.orderId),
    tenantPolicy('approvals_tenant'),
  ],
).enableRLS()
