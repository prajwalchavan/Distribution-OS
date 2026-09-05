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
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  bps,
  id,
  MANAGEMENT_ROLES,
  pieces,
  roleReadPolicy,
  roleWritePolicies,
  timestamps,
  tz,
} from './columns.js'
import { locations } from './inventory.js'
import { productVariants } from './catalog.js'
import { inboundMessages } from './notifications.js'
import { salesOrders } from './orders.js'
import { tenantRef } from './platform.js'
import { retailers } from './retailers.js'
import { appRw } from './roles.js'
import { trips } from './delivery.js'
import { users } from './tenancy.js'

/**
 * The AI surfaces the founder put in v1 (docs/22 §8, 2026-09-05): a shop's free-text WhatsApp message
 * or a rep's spoken sentence becomes a DRAFT order that a human always confirms; demand forecasting
 * turns the ledger into a reorder suggestion for purchase planning; and a trip's stops are sequenced by
 * distance and time, with the driver free to override.
 *
 * Three tables, and the shape of each is chosen so the model is never trusted:
 *
 *   ai_order_drafts   what was heard, what was parsed, how sure the parser was, and WHO confirmed it.
 *                     `created_order_id` is the only bridge into the order aggregate, and a trigger
 *                     refuses to mark a draft `confirmed` without a human on it (docs/22 §9 never-list
 *                     6 in its order-capture form: nothing commits on its own).
 *   ai_forecasts      one row per variant × location × horizon, rewritten by the worker. It is a CACHE
 *                     of a computation, never a decision: `system` alone writes it.
 *   route_plans       a proposed stop order for one trip, and the moment a crew applied or overrode it.
 *                     The plan is advice; `trip_stops.sequence` stays the record.
 *
 * WHO SEES WHAT — the reason each policy below is narrower than `tenantPolicy`:
 *   - a DRAFT names a shop, what it wants and at times its recorded voice: the desk reads every draft,
 *     the REP reads the drafts of the shops on ITS OWN BEATS (plus whatever it captured itself, which
 *     is how `INSERT … RETURNING` works at all under FORCE RLS), and the SHOP reads only its own. The
 *     godown and the crew read none — neither takes an order.
 *   - a FORECAST is purchase planning. The desk and the godown read it, the field does not, and the shop
 *     must never learn what its distributor is about to buy. `system` alone writes it.
 *   - a ROUTE PLAN lists the other shops on the same van. The desk plans it; the CREW of that trip reads
 *     it and may only APPLY or override it (a column rule, so it is a trigger in the hand-written
 *     migration, not a policy); a shop and a rep see nothing.
 *
 * Deletes: none of the three grants DELETE to `app_rw` on purpose. A draft is rejected, not erased; a
 * forecast is overwritten by its unique key; a plan is superseded. The worker's retention sweep runs as
 * `app_worker` (BYPASSRLS) and is the only thing that removes rows — drafts after 180 days, forecasts
 * after 90.
 *
 * Units are the product's units and nothing else: pieces are integers, and every confidence is BASIS
 * POINTS (`_bps`, 0–10000), never a float — the same rule that keeps money in paise.
 */

/** Where the words came from. `text` is typed into the sales app; `voice` is a recording transcribed first. */
export const aiDraftSource = pgEnum('ai_draft_source', ['whatsapp', 'voice', 'text'])

/**
 * `parsed` — every line matched a variant above the confidence floor; `needs_review` — at least one line
 * is ambiguous or the shop itself is unmatched; `confirmed` — a human accepted it and an order exists;
 * `rejected` — a human threw it away, with a reason; `expired` — nobody looked at it in time and the
 * sweep closed it. Values are APPENDED, never reordered: the order is on disk.
 */
export const aiDraftStatus = pgEnum('ai_draft_status', [
  'parsed',
  'needs_review',
  'confirmed',
  'rejected',
  'expired',
])

/** How the sequence was produced: the solver, or a person dragging stops in the delivery app. */
export const routePlanMethod = pgEnum('route_plan_method', ['nearest_neighbour_2opt', 'manual'])

/**
 * One line the parser believes it read. `text` is the fragment as written or spoken ("2 case parle-g
 * 20rs"), kept verbatim so the review screen can show what the model was looking at. `variantId` is
 * null until a SKU matches; `candidates` are the runners-up the reviewer picks from. `qtyPcs` is the
 * canonical quantity in pieces; `cases` and `unit` record how the shopkeeper said it, exactly as
 * `sales_order_lines.entered_unit` does (docs/17 A3), so "2 cs + 3 pcs" survives a case-size change.
 */
export interface AiOrderDraftLine {
  /** The fragment of the message or transcript this line was read from. */
  text: string
  /** The matched `product_variants.id`, or null while the line is still ambiguous. */
  variantId: string | null
  /** Canonical quantity in pieces (integer), computed from `cases`/`unit` at parse time. */
  qtyPcs: number
  /** Cases as the shopkeeper said them, when they said cases; null when they spoke in pieces. */
  cases: number | null
  /** The unit the shopkeeper used, kept for the review screen and the confirmed order line. */
  unit: 'piece' | 'inner' | 'case'
  /** How sure the parser is about THIS line, in basis points (0–10000). */
  confidenceBps: number
  /** Runners-up for the reviewer, best first. */
  candidates: AiOrderDraftCandidate[]
}

/** A SKU the parser considered for a line, with the label the reviewer sees and its score in bps. */
export interface AiOrderDraftCandidate {
  variantId: string
  label: string
  scoreBps: number
}

/** One stop in a proposed sequence: where it sits, when the van should arrive, how far from the previous. */
export interface RoutePlanStop {
  stopId: string
  /** 1-based position in the proposed order. */
  seq: number
  /** Estimated arrival as an ISO timestamp, or null when the solver has no time window to work from. */
  etaAt: string | null
  /** Metres from the previous stop (0 for the first). */
  distanceM: number
}

const tenantMatch = `tenant_id = (SELECT current_setting('app.tenant_id', true))`
const actor = `(SELECT current_setting('app.actor_id', true))`
const role = `(SELECT current_setting('app.actor_role', true))`
const roleIn = (roles: readonly string[]) => `${role} IN (${roles.map((r) => `'${r}'`).join(', ')})`

/** Who reads a demand forecast: the desk that buys and the godown that stores. Not the field, not the shop. */
export const FORECAST_READER_ROLES = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'system',
] as const

/**
 * Who reads a route plan: exactly the roles that already read the TRIP it sequences
 * (`TRIP_READER_ROLES` in `delivery.ts`), plus that trip's own crew. The godown is in the list on
 * purpose — `ai.routing.get` is granted to `warehouse` by the permission matrix, because the van is
 * loaded in the order it will be emptied, and a policy that stopped short of the matrix would answer
 * that screen with an empty plan for ever rather than with a refusal anybody could see.
 */
const ROUTE_PLAN_READER_ROLES = ['owner', 'manager', 'accountant', 'warehouse', 'system'] as const

/**
 * The rep's own beat. A draft names a shop; the rep who works that shop's beat may read and answer it,
 * and no other rep may. The sub-selects run under `retailers`' and `beat_assignments`' own policies
 * (both staff-readable), so this predicate can never show a rep a shop it could not already see; it
 * only ever narrows. `valid_to IS NULL` is the open-ended assignment.
 */
const shopOnMyBeat = (retailerColumn: string) =>
  `(${role} = 'salesperson' AND EXISTS (
        SELECT 1 FROM retailers r
        JOIN beat_assignments ba ON ba.beat_id = r.beat_id AND ba.tenant_id = r.tenant_id
        WHERE r.id = ${retailerColumn}
          AND r.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND ba.user_id = ${actor}
          AND ba.valid_from <= CURRENT_DATE
          AND (ba.valid_to IS NULL OR ba.valid_to >= CURRENT_DATE)
      ))`

/**
 * The shop itself, through the denormalised `retailer_links.user_id` — NEVER by joining
 * `retailer_identities` from a tenant table, which Postgres reports as 42P17 infinite recursion
 * (CLAUDE.md, coordination §5.3). A NULL `retailer_id` (a draft whose sender is not matched yet) fails
 * this branch, which is the intent: an unmatched draft belongs to the desk until someone names the shop.
 */
const myShop = (retailerColumn: string) =>
  `(${role} = 'retailer' AND ${retailerColumn} IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = ${actor}
          AND l.status = 'active'
      ))`

/**
 * One predicate for reads AND for the check on writes, so nobody can write a draft they could not read
 * back. The `created_by = actor` branch is what makes a rep's OWN capture work at all: under FORCE RLS
 * an `INSERT … RETURNING` must also pass the SELECT policy, and a voice order is captured before the
 * shop is matched. It admits nothing a rep did not itself create — and a rep may walk into any shop and
 * take an order there, exactly as `orders.create` lets it, so its own capture off its beat is fine. What
 * the BEAT decides is what a rep sees WITHOUT having created it: the shop's own WhatsApp message and the
 * desk's drafts for the shops that are its round.
 */
const draftVisible = `${tenantMatch} AND (
        ${roleIn(BACK_OFFICE_ROLES)}
        OR (${role} = 'salesperson' AND created_by = ${actor})
        OR ${shopOnMyBeat('ai_order_drafts.retailer_id')}
        OR ${myShop('ai_order_drafts.retailer_id')}
      )`

/**
 * A message, a recording or a typed sentence, and what the parser made of it. Never an order: the order
 * appears only when a human confirms, and `created_order_id` then points at it.
 *
 * `provider` / `model` / `tokens_in` / `tokens_out` are the cost and provenance trail — which engine
 * read this, at what price. Under `NODE_ENV=test` and until `ANTHROPIC_API_KEY` is set the engine is the
 * deterministic stub (docs/22 §8, 2026-09-05), so these read `stub` and zero; the columns exist from day
 * one so switching an engine on needs no migration.
 */
export const aiOrderDrafts = pgTable(
  'ai_order_drafts',
  {
    id: id(),
    tenantId: tenantRef(),
    source: aiDraftSource('source').notNull(),
    /** Null until the sender's phone (or the reviewer) names the shop. */
    retailerId: text('retailer_id').references(() => retailers.id),
    /** The WhatsApp/SMS message this was parsed from; one draft per inbound message, ever. */
    inboundMessageId: text('inbound_message_id').references(() => inboundMessages.id),
    /** What was written, verbatim. Null for a voice capture until the transcript lands. */
    rawText: text('raw_text'),
    /** Object-storage key of the recording (`modules/files`), never a raw link to a client. */
    audioObjectKey: text('audio_object_key'),
    /** What speech-to-text heard; the review screen shows it beside the lines. */
    transcript: text('transcript'),
    parsedLines: jsonb('parsed_lines')
      .$type<AiOrderDraftLine[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** How sure the parser is about the draft as a whole, in basis points (0–10000). */
    matchConfidenceBps: bps('match_confidence_bps').notNull().default(0),
    status: aiDraftStatus('status').notNull().default('parsed'),
    /** The order a human created from this draft. Required by trigger once `status = 'confirmed'`. */
    createdOrderId: text('created_order_id').references(() => salesOrders.id),
    /** Who captured it: the rep who spoke or typed. Null when the worker parsed an inbound message. */
    createdBy: text('created_by').references(() => users.id),
    /** Who accepted or threw it away. Required by trigger for `confirmed` and `rejected`. */
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewedAt: tz('reviewed_at'),
    rejectReason: text('reject_reason'),
    /** Engine provenance: `stub`, `anthropic`, … */
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    /** ADR 0007: a rep's phone may replay this capture after hours offline; the key makes that a no-op. */
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ai_order_drafts_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    /** The review queue: "what is waiting", oldest first. */
    index('ai_order_drafts_status_idx').on(t.tenantId, t.status, t.createdAt),
    /** A shop's own drafts (the retailer app) and the desk's shop-scoped view. */
    index('ai_order_drafts_retailer_idx').on(t.tenantId, t.retailerId, t.createdAt),
    /** The rep's own captures — the exact rows its policy branch admits. */
    index('ai_order_drafts_created_by_idx').on(t.tenantId, t.createdBy, t.createdAt),
    /** One draft per inbound message: a relay retry must never parse the same text twice. */
    uniqueIndex('ai_order_drafts_inbound_idx')
      .on(t.tenantId, t.inboundMessageId)
      .where(sql`inbound_message_id IS NOT NULL`),
    pgPolicy('ai_order_drafts_read', { for: 'select', to: appRw, using: sql.raw(draftVisible) }),
    pgPolicy('ai_order_drafts_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql.raw(draftVisible),
    }),
    pgPolicy('ai_order_drafts_update', {
      for: 'update',
      to: appRw,
      using: sql.raw(draftVisible),
      withCheck: sql.raw(draftVisible),
    }),
  ],
).enableRLS()

/**
 * What one variant is expected to sell out of one location over the next `horizon_days`, and therefore
 * how much to buy. Rewritten in place by the worker (`INSERT … ON CONFLICT DO UPDATE` on the unique key),
 * so a retry never doubles a number and a stale horizon is never read as current — `computed_at` says
 * how old the answer is.
 *
 * It carries no money at all: pieces and a confidence, nothing a purchase cost could leak through. The
 * cost side of a reorder decision stays in `tenant_product_costs`, which the godown cannot read.
 */
export const aiForecasts = pgTable(
  'ai_forecasts',
  {
    id: id(),
    tenantId: tenantRef(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    /** 7, 14, 30 … the window the expectation covers. */
    horizonDays: integer('horizon_days').notNull(),
    expectedQtyPcs: pieces('expected_qty_pcs').notNull().default(0),
    /** What to order today to cover the horizon, after on-hand and open purchase orders. */
    reorderQtyPcs: pieces('reorder_qty_pcs').notNull().default(0),
    onHandPcs: pieces('on_hand_pcs').notNull().default(0),
    /** Days the current stock lasts at the expected rate; null when nothing is expected to sell. */
    daysCover: integer('days_cover'),
    /** Which estimator produced it (`moving_average_28`, `seasonal_naive`, …), so a change is visible. */
    method: text('method').notNull(),
    /** How sure the estimator is, in basis points (0–10000). */
    confidenceBps: bps('confidence_bps').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_forecasts_key_idx').on(t.tenantId, t.variantId, t.locationId, t.horizonDays),
    /** The purchase-planning list: what runs out first in this godown. */
    index('ai_forecasts_cover_idx').on(t.tenantId, t.locationId, t.daysCover),
    roleReadPolicy('ai_forecasts_read', FORECAST_READER_ROLES),
    ...roleWritePolicies('ai_forecasts_write', ['system']),
  ],
).enableRLS()

/**
 * A proposed order for one trip's stops. Advice, not the record: `trip_stops.sequence` is what the crew
 * actually does, and `applied_at` / `overridden` say whether the advice was taken. The crew's only write
 * is that application — enforced as a trigger in the hand-written migration, because "these three columns
 * and no others" is a column rule and RLS has no column granularity.
 */
export const routePlans = pgTable(
  'route_plans',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id),
    method: routePlanMethod('method').notNull(),
    sequence: jsonb('sequence')
      .$type<RoutePlanStop[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    totalDistanceM: integer('total_distance_m').notNull().default(0),
    totalDurationS: integer('total_duration_s').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
    /** When a crew took this plan. At most one applied plan per trip (partial unique index below). */
    appliedAt: tz('applied_at'),
    appliedBy: text('applied_by').references(() => users.id),
    /** The crew resequenced by hand after applying: the plan was seen and rejected, which is worth knowing. */
    overridden: boolean('overridden').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    /** The latest plan for a trip. */
    index('route_plans_trip_idx').on(t.tenantId, t.tripId, t.computedAt),
    /** A trip runs one route, so only one plan may ever be the applied one. */
    uniqueIndex('route_plans_applied_idx')
      .on(t.tenantId, t.tripId)
      .where(sql`applied_at IS NOT NULL`),
    // The desk and the godown read every plan; the crew reads the plans of the trips it is on and
    // nothing else. A rep and a shop are absent by construction — a route plan lists the other shops
    // on the same van.
    pgPolicy('route_plans_read', {
      for: 'select',
      to: appRw,
      using: sql.raw(`${tenantMatch} AND (
        ${roleIn(ROUTE_PLAN_READER_ROLES)}
        OR (${role} = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
            ))
      )`),
    }),
    // Planning is an operational decision, so the accountant (money desk + reads, docs/22 §8 2026-09-05)
    // does not make one: the owner, the manager and the worker compute and store plans — and the CREW
    // OF THAT VERY TRIP, because `ai.routing.plan` is granted to `delivery` by the permission matrix
    // (a driver asks the solver for a better round from the van). The EXISTS branch is the same one
    // this table's read and update policies already carry, and `trips_insert` sets the precedent: the
    // crew may act on its own trip and on no other. Without it the service would have to write the row
    // as `system`, which is a wider escalation than the thing it is trying to allow.
    pgPolicy('route_plans_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql.raw(`${tenantMatch} AND (
        ${roleIn(MANAGEMENT_ROLES)}
        OR (${role} = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
            ))
      )`),
    }),
    // The crew's update is the apply; `dos_route_plan_apply_guard()` holds it to the three apply columns.
    pgPolicy('route_plans_update', {
      for: 'update',
      to: appRw,
      using: sql.raw(`${tenantMatch} AND (
        ${roleIn(MANAGEMENT_ROLES)}
        OR (${role} = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
            ))
      )`),
      withCheck: sql.raw(`${tenantMatch} AND (
        ${roleIn(MANAGEMENT_ROLES)}
        OR (${role} = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = ${actor} OR t.helper_id = ${actor})
            ))
      )`),
    }),
  ],
).enableRLS()
