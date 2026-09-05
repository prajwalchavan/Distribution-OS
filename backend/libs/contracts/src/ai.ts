import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  BpsSchema,
  IdSchema,
  LocaleSchema,
  MutationBase,
  PiecesSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'
import { StopSchema } from './delivery.js'
import { OrderDetailSchema, OrderLineInput } from './orders.js'

/**
 * AI — the four assistive surfaces the founder put in v1 (docs/22 §8, 2026-09-05: "AI features are ALL
 * in v1 (before pilot)"): free-text order intake, voice order capture, demand forecasting for purchase
 * planning, and route optimisation for a delivery trip. Module 12 in the chain. It owns
 * `ai_order_drafts`, `ai_forecasts` and `route_plans` in `database/src/schema/ai.ts` and nothing else;
 * every shape below is that schema seen from the wire, plus the names and pack sizes joined in at read.
 *
 * THE ONE RULE THAT SHAPES EVERY SHAPE BELOW: **nothing here decides anything.** Every output carries
 * `confidenceBps` and `needsHumanConfirmation: true` — a `z.literal(true)`, so no implementation can
 * answer `false` and no app can branch on it being absent. A parse produces a DRAFT and never a sales
 * order; the order appears only when a human presses confirm, and it is then created through
 * `orders.create` → `orders.setLines` → `orders.submit` exactly as a typed order, so pricing
 * (`priceOrder()`), the credit verdict and the approval queue all run unchanged. A forecast produces a
 * SUGGESTION and never a purchase order — `ai_forecasts` is written by `system` alone, so no request
 * path can write one. A route plan produces a SEQUENCE and reaches the trip only through
 * `routing.apply`, which goes through `delivery.stops.reorder`; the crew may re-sequence by hand
 * afterwards, which flips the plan to `overridden` and changes nothing else. This is docs/22 §9
 * non-negotiable 6 ("document intake never commits on its own") applied to every model on the contract.
 *
 * NO COST, NO MARGIN, ANYWHERE (docs/22 §9 non-negotiable 1). A draft carries no money at all — not even
 * a selling rate: the price is what `orders.create` computes at confirm, and until then a draft is a
 * shop, some SKUs and some quantities. A reorder suggestion carries pieces and days of cover, never a
 * purchase rate, a stock value or a supplier's terms, which is what lets the warehouse role read it.
 * `ai.test.ts` walks every output schema here and fails on a key matching /cost|margin|ptd|landed|profit/i.
 *
 * WHICH SERVICES MOUNT `ai` (docs/plans/00-coordination.md §6 pattern; `auth-service` mounts nothing):
 *
 *   owner :3001      YES — the whole surface: the WhatsApp/voice draft queue and its confirmations, the
 *                    reorder suggestions behind purchase planning, and the route plan on the live map
 *   manager :3002    YES — manager + accountant. The manager works the draft queue and the routes; the
 *                    ACCOUNTANT gets `forecast.*` only (it is BACK_OFFICE) and is refused on intake,
 *                    drafts and routing in PERMISSIONS — a draft order is not a money-desk write
 *                    (docs/22 §8, 2026-09-05: no prices, no approvals, no settings for the accountant).
 *                    `ai_order_drafts`' RLS admits the accountant with the rest of BACK_OFFICE_ROLES;
 *                    the MATRIX is what narrows it, the same way `billing.invoices.cancel` narrows
 *   sales :3003      YES — intake + drafts. RLS scopes a rep to the shops on its own current beats plus
 *                    whatever it captured itself (`ai_order_drafts_read`), so "own shops" is a database
 *                    guarantee, not a filter. `forecast.*` and `routing.*` refuse the role
 *   warehouse :3004  YES — READ ONLY: `forecast.list` (BACK_OFFICE_OR_WAREHOUSE, matching the table's
 *                    own `FORECAST_READER_ROLES` — the godown sees what is about to run out where it
 *                    stands) and `routing.get` (TRIP_PLANNERS — the loader wants the order the van will
 *                    be emptied in). Every intake, draft, `forecast.run` and routing write refuses it
 *   delivery :3005   YES — `routing.plan / get / apply` for the trip it drives; `route_plans`' read and
 *                    update policies admit a `delivery` caller only on a trip it is driver or helper on.
 *                    Intake, drafts and forecast refuse the role
 *   retailer :3006   YES — intake + ITS OWN drafts. A shop may text or speak an order in its own app and
 *                    confirm it; `retailerId` is FORCED to the caller's shop whatever was sent, and the
 *                    `myShop` branch of the draft policy narrows every read to its own rows.
 *                    `forecast.*` and `routing.*` are refused — the distributor's purchase planning and
 *                    its van's route are not the shop's business
 *
 * FOUNDER DECISIONS AND HOUSE RULES THIS FILE OBEYS:
 *
 *  1. ALL FOUR AI FEATURES ARE V1 (docs/22 §8, 2026-09-05) and they run on STUB DRIVERS until the founder
 *     adds `ANTHROPIC_API_KEY` (docs/22 §8, same date): the parse, the transcription and the forecast all
 *     go through a pluggable, DETERMINISTIC-under-test engine exactly as docint's `extractions.service.ts`
 *     does, so specs and `pnpm smoke` never make a network call. Which engine read a draft is kept on the
 *     row (`provider`, `model`, `tokens_in`, `tokens_out`) and deliberately NOT put on the wire: it is
 *     our operating detail, and a shopkeeper reading its own draft has no business with it.
 *  2. THE SALESPERSON NEVER COLLECTS AND THE ACCOUNTANT NEVER ORDERS (docs/17 §D4, docs/22 §8): nothing
 *     here touches money, and the four roles that may take a draft are exactly four of the roles that
 *     already reach `orders.create` — owner, manager, salesperson, retailer.
 *  3. ENGLISH ONLY FOR THE PILOT (docs/22 §8, 2026-09-05), but `intake.transcribe` already takes
 *     `language` (`LocaleSchema`: `en-IN` / `hi-IN` / `mr-IN`) because a shopkeeper speaks Marathi into
 *     an English app on day one. It steers speech-to-text and nothing else; the SKU match runs against
 *     the tenant's catalog and the shop's own history whatever the language was.
 *  4. WHITE-LABEL (docs/22 §9 non-negotiable 10): nothing on this contract names Distribution OS.
 *  5. BOUNDED WORK PER REQUEST (docs/20 rule 3): `AI_MAX_INTAKE_CHARS` on the text, `AI_MAX_VOICE_MS` on
 *     the audio, `AI_MAX_DRAFT_LINES` on a draft, `AI_MAX_ROUTE_STOPS` on a plan (the same 80 stops
 *     `delivery.stops.reorder` accepts). `forecast.run` does no work on the request path at all: it
 *     enqueues the worker pass and answers a receipt, the way `billing.invoices.pdf` answers `queued`.
 *  6. IDEMPOTENCY (docs/22 §9 non-negotiable 3): every mutation extends `MutationBase` and carries the
 *     client-generated UUIDv7 `id` of the row it creates — the draft on intake, the ORDER on confirm, the
 *     plan on `routing.plan`. `ai_order_drafts` has a unique `(tenant_id, idempotency_key)`, so a rep's
 *     phone replaying a capture after hours offline is a no-op (ADR 0007). `forecast.run` is idempotent
 *     per DAY as well as per key: a second call for the same date and location answers the queued pass
 *     with `created: false` rather than starting a second one.
 *  7. BASIS POINTS, NEVER A FLOAT (CLAUDE.md, and `schema/ai.ts`: "every confidence is BASIS POINTS
 *     (`_bps`, 0–10000) — the same rule that keeps money in paise"). Every confidence and every match
 *     score on this contract is `BpsSchema`: 94 % is `9400`. This is the one place the repo differs from
 *     docint, which stores its extraction confidence as a `real` 0–1 and shows it that way.
 *
 * WHERE THE INPUTS COME FROM. `intake.transcribe`'s `audioObjectKey` is minted by `files.uploadUrl`
 * (coordination §3.3: nothing binary streams through a service) and lands in
 * `ai_order_drafts.audio_object_key`; the key is anchored at the caller's tenant by `assertTenantKey()`,
 * so an object from another distributor is `invalid_key`. `intake.parseText`'s `inboundMessageId` names
 * the WhatsApp/SMS row the words arrived in (`notifications.inbound.list`), and the table's partial
 * unique index guarantees ONE draft per inbound message however often a relay retries. `routing.plan`
 * reads the trip and its open stops through delivery's exported service and the shop coordinates from
 * `retailers`; the optimiser's assumed speed and per-stop service time come from `tenant_settings`
 * (`ai.routing.avg_speed_kmph`, `ai.routing.service_minutes`), never from the wire, so one distributor's
 * tuning cannot be sent by a client. The optimiser itself is a PURE function in `@dos/domain` (haversine
 * → nearest neighbour → 2-opt), unit-testable without a database and identical on every device.
 *
 * Money is integer paise (there is none here), quantities integer pieces, confidences basis points,
 * dates IST (`businessDate()`), ids client-generated UUIDv7; every list caps `limit` at 200 and pages on
 * `cursor` = the last row's id.
 */

const IsoDateSchema = z.iso.date()
/** The phone that confirmed a draft or applied a plan; passed through to the row that records it. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

/** One WhatsApp message (4096 characters is WhatsApp's own limit). A longer paste is two intakes. */
export const AI_MAX_INTAKE_CHARS = 4096
/** Two minutes of audio. A longer voice note is refused at `transcribe`, never truncated silently. */
export const AI_MAX_VOICE_MS = 120_000
/** Lines on one draft. An order with more lines is typed, not parsed (`orders` itself allows 200). */
export const AI_MAX_DRAFT_LINES = 60
/** Stops in one route plan — the same cap `delivery.stops.reorder` puts on a re-sequencing. */
export const AI_MAX_ROUTE_STOPS = 80
/** The horizon `forecast.run` computes and `forecast.list` reads unless the caller names another. */
export const AI_DEFAULT_HORIZON_DAYS = 14
/** Days of stock a buyer wants to hold; `belowCover` compares `daysCover` against this. */
export const AI_DEFAULT_COVER_DAYS = 21

/**
 * The pair every advisory output carries. `needsHumanConfirmation` is a literal `true`: an
 * implementation cannot answer `false`, and the generated OpenAPI document shows it as a constant — the
 * founder's "always human-confirmed" written into the wire format rather than into a comment.
 */
const AdvisoryFields = {
  confidenceBps: BpsSchema,
  needsHumanConfirmation: z.literal(true),
}

/** The same pair where the number is not known yet — a forecast pass that has only been queued. */
const PendingAdvisoryFields = {
  confidenceBps: BpsSchema.nullable(),
  needsHumanConfirmation: z.literal(true),
}

// ---------------------------------------------------------------------------------------------------------------
// intake and drafts

/**
 * How the words reached us (`ai_draft_source`). `whatsapp` — a message the shop sent, relayed in through
 * `inbound_messages`; `text` — typed or pasted into an app (a rep reading a shopkeeper's chit, a shop
 * typing its own list; an SMS arrives this way too); `voice` — a note recorded in the app and
 * transcribed. It is NOT `orders.OrderSourceSchema`: the order a draft becomes is created with the order
 * source the CALLER implies — `whatsapp` for a relayed message, `retailer_app` for a shop confirming its
 * own draft, `salesperson` for a rep confirming one on the beat.
 */
export const DraftSourceSchema = z.enum(['whatsapp', 'voice', 'text'])
export type DraftSource = z.infer<typeof DraftSourceSchema>

/** `intake.parseText` takes any source except `voice`, which has its own procedure and its own audio. */
export const IntakeTextSourceSchema = DraftSourceSchema.exclude(['voice'])

/**
 * A draft's life (`ai_draft_status`): `parsed` — every line matched a variant above the confidence floor,
 * so the human confirms in one tap; `needs_review` — at least one line is ambiguous or the shop itself is
 * unmatched; `confirmed` — a human accepted it and `orderId` names the order; `rejected` — a human threw
 * it away, with a reason; `expired` — nobody looked at it in time and the retention sweep closed it.
 * The last three are terminal. A draft is never deleted by a request: it is rejected, and the sweep
 * removes it after 180 days.
 */
export const DraftStatusSchema = z.enum([
  'parsed',
  'needs_review',
  'confirmed',
  'rejected',
  'expired',
])
export type DraftStatus = z.infer<typeof DraftStatusSchema>

/**
 * Per line, DERIVED at read from the stored line: `matched` — a variant was chosen; `ambiguous` — none
 * was, but there are candidates to pick from; `unmatched` — nothing came close and the human must
 * search. Not a stored column: it is exactly "is `variantId` null, and are there candidates".
 */
export const DraftLineStatusSchema = z.enum(['matched', 'ambiguous', 'unmatched'])
export type DraftLineStatus = z.infer<typeof DraftLineStatusSchema>

/** A SKU the matcher considered for a line, best first, at most five — so the human picks instead of searching. */
export const DraftLineCandidateSchema = z.object({
  variantId: IdSchema,
  /** The label the matcher stored with the candidate, which is what the review screen shows. */
  variantName: z.string(),
  scoreBps: BpsSchema,
})
export type DraftLineCandidate = z.infer<typeof DraftLineCandidateSchema>

/**
 * One line of a draft, from `ai_order_drafts.parsed_lines`. NO MONEY: the rate, the scheme and the tax
 * appear only on the order the confirm creates. `rawText` is the fragment of the message this line was
 * read from, kept verbatim so the reviewer sees the shopkeeper's own words beside what we understood.
 * `lineNo` is the 1-based position in the stored array — the handle `drafts.confirm` refers back to, as
 * a line in a JSONB array has no id of its own.
 */
export const OrderDraftLineSchema = z.object({
  lineNo: z.number().int().positive(),
  /** The words this line was read from: "2 case parle-g 20rs". */
  rawText: z.string(),
  status: DraftLineStatusSchema,
  variantId: IdSchema.nullable(),
  /** Joined from the catalog at read; null while no variant is chosen. */
  variantName: z.string().nullable(),
  /** Sell-side pack size at read (`tenant_products.case_size_override` else the variant default). */
  packSize: z.number().int().positive().nullable(),
  /** The canonical quantity the confirmed order line will carry. Zero while the pack size is unknown. */
  qtyPcs: PiecesSchema,
  /** Cases as the shopkeeper said them, when they spoke in cases; null when they spoke in pieces. */
  cases: z.number().int().positive().nullable(),
  /** The unit the shopkeeper used, kept the way `sales_order_lines.entered_unit` keeps it (docs/17 A3). */
  unit: z.enum(['piece', 'inner', 'case']),
  confidenceBps: BpsSchema,
  candidates: z.array(DraftLineCandidateSchema).max(5),
})
export type OrderDraftLine = z.infer<typeof OrderDraftLineSchema>

/**
 * A draft order: what we think the shop asked for, before any human agreed. This is the list row —
 * `get` adds the raw text, the transcript and the lines. `retailerId` is null while nobody has named the
 * shop, and such a draft belongs to the desk: the rep-beat and own-shop branches of the read policy both
 * fail on a null shop, by design.
 */
export const OrderDraftSchema = z.object({
  id: IdSchema,
  source: DraftSourceSchema,
  status: DraftStatusSchema,
  retailerId: IdSchema.nullable(),
  /** Joined at read. Null while the shop is unnamed. */
  retailerName: z.string().nullable(),
  /** The WhatsApp / SMS row the words arrived in; at most one draft ever exists per inbound message. */
  inboundMessageId: IdSchema.nullable(),
  /** The first 120 characters of the text or the transcript, so a queue page carries no whole messages. */
  preview: z.string(),
  /** Derived from the stored lines: how many there are, and how many still need a human. */
  lineCount: z.number().int().nonnegative(),
  matchedLineCount: z.number().int().nonnegative(),
  unmatchedLineCount: z.number().int().nonnegative(),
  ...AdvisoryFields,
  /** The order this draft became, and its number once submitted. Null until a human confirmed it. */
  orderId: IdSchema.nullable(),
  orderNo: z.string().nullable(),
  /** The rep who spoke or typed it. Null when the worker parsed an inbound message with nobody present. */
  createdBy: IdSchema.nullable(),
  /** Who confirmed or rejected it — the human the whole design exists to record. */
  reviewedBy: IdSchema.nullable(),
  reviewedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
})
export type OrderDraft = z.infer<typeof OrderDraftSchema>

export const OrderDraftDetailSchema = OrderDraftSchema.extend({
  /** The message as it arrived. Null for a voice capture whose transcript has not landed yet. */
  rawText: z.string().nullable(),
  /** What speech-to-text heard, shown beside the lines. Null for anything but a voice capture. */
  transcript: z.string().nullable(),
  /** The recording, for a replay button. A signed URL comes from `files.readUrl`, never a raw link. */
  audioObjectKey: z.string().nullable(),
  lines: z.array(OrderDraftLineSchema).max(AI_MAX_DRAFT_LINES),
})
export type OrderDraftDetail = z.infer<typeof OrderDraftDetailSchema>

const DraftItemOutput = z.object({ item: OrderDraftDetailSchema })

/**
 * Parse a message into a draft. NEVER creates an order — the answer is a draft, always with
 * `needsHumanConfirmation: true`, whatever the confidence. `retailerId` is optional because a forwarded
 * message often identifies the shop only by how it signs itself; the engine proposes one and the human
 * confirms or corrects it. A `retailer` caller has it FORCED to its own shop; a `salesperson` may name
 * only a shop on its own beats, so a rep cannot probe another rep's shops through the parser (docs/17
 * item 27, the same rule as `retailers.linkIdentity`).
 */
export const ParseTextInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the DRAFT. A retry with the same key answers the same draft. */
  id: IdSchema,
  source: IntakeTextSourceSchema,
  retailerId: IdSchema.optional(),
  /** The inbound WhatsApp / SMS row these words came from, when the desk is working the inbox. */
  inboundMessageId: IdSchema.optional(),
  text: z.string().trim().min(1).max(AI_MAX_INTAKE_CHARS),
})
export const ParseTextOutput = DraftItemOutput

/**
 * Transcribe a voice note and parse it in the same call: one tap in the app, one draft out. The audio is
 * already in object storage — `files.uploadUrl` minted the key and the client PUT the bytes there
 * (docs/20 rule 3: nothing binary through a service). A note longer than `AI_MAX_VOICE_MS` is refused
 * with `voice_too_long`, never truncated.
 */
export const TranscribeVoiceInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the DRAFT this voice note becomes. */
  id: IdSchema,
  /** From `files.uploadUrl`; anchored at the caller's tenant, so another distributor's key is `invalid_key`. */
  audioObjectKey: z.string().min(1).max(512),
  retailerId: IdSchema.optional(),
  /** What the speaker is speaking. English only for the pilot; the other two are already accepted. */
  language: LocaleSchema.default('en-IN'),
  /** What the recorder measured, so a too-long note is refused before the engine is called. */
  durationMs: z.number().int().positive().max(AI_MAX_VOICE_MS).optional(),
})
/** `transcript` is `item.transcript`, lifted because the voice screen shows it before anything else. */
export const TranscribeVoiceOutput = z.object({
  item: OrderDraftDetailSchema,
  transcript: z.string(),
})

/**
 * The draft queue. A `salesperson` sees the drafts of the shops on its own current beats and everything
 * it captured itself; `mine: true` narrows to its own captures (the rep's "my captures" tab). A
 * `retailer` sees only its own shop's — by RLS, not by this filter.
 */
export const DraftsListInput = z.object({
  status: DraftStatusSchema.optional(),
  retailerId: IdSchema.optional(),
  source: DraftSourceSchema.optional(),
  /** Created on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  /** Only what the caller captured. A filter for everyone, forced on for nobody. */
  mine: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const DraftsListOutput = z.object({
  items: z.array(OrderDraftSchema),
  nextCursor: z.string().nullable(),
})

export const DraftGetInput = z.object({ id: IdSchema })
export const DraftGetOutput = DraftItemOutput

/**
 * One line as the human left it. It is `orders.OrderLineInput` — the same shape a typed order uses,
 * because that is exactly what it becomes — plus the draft line it came from, so corrections can be
 * counted later ("how often does the model get this shop's shorthand right"). A line the human ADDED has
 * no `draftLineNo`; a draft line the human deleted simply does not appear.
 */
export const ConfirmDraftLineInput = OrderLineInput.extend({
  draftLineNo: z.number().int().positive().nullable().optional(),
})

/**
 * Turn a draft into a real sales order. The handler runs `orders.create` → `orders.setLines` →
 * `orders.submit` in one transaction with the lines below, so the price engine, the credit verdict, the
 * minimum order value and the approval queue behave exactly as they do for a typed order — there is no
 * second, softer path into `sales_orders`. The draft is then `confirmed` with `orderId`, `reviewedBy`
 * and `reviewedAt` set; the database refuses `confirmed` without both a human and an order on the row.
 * A second confirm with the same key answers the stored result, and with a different payload 409.
 *
 * `retailerId` is required only when the draft has none (the parse could not name the shop); sending one
 * that differs from the draft's is how a human corrects a wrong shop. A `retailer` caller may confirm
 * only its own draft and only for its own shop; a `salesperson` only for a shop it may already order for.
 */
export const ConfirmDraftInput = MutationBase.extend({
  /** The draft. */
  id: IdSchema,
  /** Client-generated UUIDv7 of the ORDER this creates — the id `orders.get` will answer to. */
  orderId: IdSchema,
  /** The shop, when the draft has none or the human corrected it. */
  retailerId: IdSchema.optional(),
  lines: z.array(ConfirmDraftLineInput).min(1).max(AI_MAX_DRAFT_LINES),
  expectedDeliveryDate: IsoDateSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  deviceId: DeviceIdSchema.optional(),
})
/** `order` is the submitted order: `confirmed` when nothing needed approval, `submitted` when it did. */
export const ConfirmDraftOutput = z.object({
  item: OrderDraftDetailSchema,
  order: OrderDetailSchema,
})

/**
 * Throw a draft away. The reason is required and kept: a rejected draft is the training signal that
 * matters most, and nothing is erased — the retention sweep removes the row after 180 days.
 */
export const RejectDraftInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(200),
})
export const RejectDraftOutput = DraftItemOutput

// ---------------------------------------------------------------------------------------------------------------
// forecast: what to buy, and how long the shelf lasts

/**
 * A queued pass, as pg-boss sees it. There is no run table: `ai_forecasts` is rewritten in place by the
 * worker on its unique `(tenant, variant, location, horizon)` key, and `computedAt` on each row is how
 * old the answer is. So this is the JOB's state, read back from the queue by `jobId`.
 */
export const ForecastRunStatusSchema = z.enum(['queued', 'running', 'ready', 'failed'])
export type ForecastRunStatus = z.infer<typeof ForecastRunStatusSchema>

/**
 * What `forecast.run` answers: a receipt, not the numbers. The suggestions arrive in `forecast.list`
 * once the pass has run. `confidenceBps` is null here because a receipt has computed nothing yet; every
 * suggestion carries its own.
 */
export const ForecastReceiptSchema = z.object({
  /** The pg-boss job. Null when the pass ran inline (specs, local demo). */
  jobId: z.string().nullable(),
  status: ForecastRunStatusSchema,
  /** IST business date the pass is for. */
  asOfDate: z.string(),
  /** The location asked for, or null for every stock location of the tenant. */
  locationId: IdSchema.nullable(),
  horizonDays: z.number().int().positive(),
  queuedAt: z.string(),
  ...PendingAdvisoryFields,
})
export type ForecastReceipt = z.infer<typeof ForecastReceiptSchema>

/**
 * One variant at one location over one horizon — the `ai_forecasts` row, which the worker rewrites in
 * place. NO MONEY: not a purchase rate, not a stock value, not a margin (docs/22 §9 non-negotiable 1),
 * which is what lets the warehouse role read this list at all. `reorderQtyPcs` is a NUMBER OF PIECES a
 * human turns into a purchase order through `procurement.purchaseOrders.upsert`; nothing here writes one.
 */
export const ReorderSuggestionSchema = z.object({
  id: IdSchema,
  variantId: IdSchema,
  /** Joined at read, with the sell-side pack size so the app can show cases as well as pieces. */
  variantName: z.string(),
  packSize: z.number().int().positive().nullable(),
  locationId: IdSchema,
  locationName: z.string(),
  horizonDays: z.number().int().positive(),
  /** Pieces expected to leave this location over the horizon. */
  expectedQtyPcs: PiecesSchema,
  onHandPcs: PiecesSchema,
  /** What to order today to cover the horizon, after on-hand and open purchase orders. Zero when nothing is needed. */
  reorderQtyPcs: PiecesSchema,
  /** The same quantity in cases, derived from `packSize`; null when the pack size is unknown. */
  reorderCases: z.number().int().nonnegative().nullable(),
  /**
   * Whole days the current stock lasts at the expected rate. Null when nothing is expected to sell —
   * cover is then not "infinite", it is unknown, and the app says so.
   */
  daysCover: z.number().int().nonnegative().nullable(),
  /** True when `daysCover` is below the `coverDays` the caller asked with (default `AI_DEFAULT_COVER_DAYS`). */
  belowCover: z.boolean(),
  /** Which estimator produced it — `moving_average_28`, `seasonal_naive`, … — so a change is visible. */
  method: z.string(),
  ...AdvisoryFields,
  computedAt: z.string(),
})
export type ReorderSuggestion = z.infer<typeof ReorderSuggestionSchema>

/**
 * Queue a pass. Does no work on the request path: `ai_forecasts` is written by `system` alone, so this
 * enqueues the worker job and answers a receipt (docs/20 rule 3). Idempotent per DAY as well as per key
 * — a second call for the same `asOfDate`, `locationId` and `horizonDays` answers the queued pass with
 * `created: false` instead of starting a second read of the same history.
 */
export const ForecastRunInput = MutationBase.extend({
  /** Client-generated UUIDv7 of this request, which becomes the job's key for the day. */
  id: IdSchema,
  /** One location, or every stock location of the tenant when omitted. */
  locationId: IdSchema.nullable().optional(),
  /** Defaults to today (IST). A past date re-runs the model as it would have seen that day. */
  asOfDate: IsoDateSchema.optional(),
  /** Days of history to read. Default 90; at most a year. */
  lookbackDays: z.number().int().min(7).max(365).optional(),
  /** Days to forecast forward. Default `AI_DEFAULT_HORIZON_DAYS`. */
  horizonDays: z.number().int().min(1).max(90).optional(),
})
/** `created: false` means the pass for this day and location was already queued and nothing changed. */
export const ForecastRunOutput = z.object({
  item: ForecastReceiptSchema,
  created: z.boolean(),
})

/**
 * The current suggestions. Rows exist per horizon, so `horizonDays` picks one — without it a variant
 * would appear once per horizon computed.
 */
export const ForecastListInput = z.object({
  locationId: IdSchema.optional(),
  variantId: IdSchema.optional(),
  horizonDays: QueryIntSchema.min(1).max(90).default(AI_DEFAULT_HORIZON_DAYS),
  /** The cover a buyer wants to hold; `belowCover` on every row is measured against it. */
  coverDays: QueryIntSchema.min(1).max(120).default(AI_DEFAULT_COVER_DAYS),
  /** Only the rows that are short of `coverDays`: the buyer's working list. */
  belowCover: QueryBoolSchema.optional(),
  /** Matches the variant name or its code. */
  q: z.string().trim().min(1).max(60).optional(),
  ...CursorInput,
})
/** `lastComputedAt` is the newest `computedAt` in the tenant's rows, so the screen can show how stale they are. */
export const ForecastListOutput = z.object({
  items: z.array(ReorderSuggestionSchema),
  lastComputedAt: z.string().nullable(),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// routing: the order the van should visit its stops in

/** How the sequence was produced (`route_plan_method`): the solver, or a person dragging stops in the app. */
export const RoutePlanMethodSchema = z.enum(['nearest_neighbour_2opt', 'manual'])
export type RoutePlanMethod = z.infer<typeof RoutePlanMethodSchema>

/**
 * DERIVED at read from `applied_at`, `overridden` and whether a newer plan exists for the trip — not a
 * stored column. `draft` — computed, not applied; `applied` — its sequence was written onto the trip;
 * `overridden` — the crew re-sequenced by hand afterwards, which they are always allowed to do;
 * `superseded` — a newer plan was computed for the same trip. Only `apply` ever touches the trip.
 */
export const RoutePlanStatusSchema = z.enum(['draft', 'applied', 'overridden', 'superseded'])
export type RoutePlanStatus = z.infer<typeof RoutePlanStatusSchema>

/** One stop in the proposed sequence, with the leg that reaches it and the shop joined in at read. */
export const RoutePlanStopSchema = z.object({
  stopId: IdSchema,
  /** 1-based position in the proposed order. */
  sequence: z.number().int().positive(),
  /** Where the stop stands on the trip today, so the app can show what would move. */
  currentSequence: z.number().int().positive().nullable(),
  retailerId: IdSchema,
  retailerName: z.string(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  /** Metres from the previous stop; 0 for the first. */
  distanceM: z.number().int().nonnegative(),
  /** When the van should be at the door, at the tenant's assumed speed and per-stop service time. */
  etaAt: z.string().nullable(),
})
export type RoutePlanStop = z.infer<typeof RoutePlanStopSchema>

/**
 * A proposed sequence for one trip's open stops. Advice, not the record: `trip_stops.sequence` is what
 * the crew actually does, and `appliedAt` / `overridden` say whether the advice was taken. Computed by a
 * pure function in `@dos/domain` (haversine → nearest neighbour → 2-opt); nothing in it is a promise
 * about traffic. `confidenceBps` is derived, not stored: the share of the trip's stops that had
 * coordinates to optimise with, so a plan built from three pinned shops out of ten says so.
 */
export const RoutePlanSchema = z.object({
  id: IdSchema,
  tripId: IdSchema,
  /** Joined at read. */
  tripNo: z.string().nullable(),
  status: RoutePlanStatusSchema,
  method: RoutePlanMethodSchema,
  stopCount: z.number().int().nonnegative(),
  /** Stops with no shop coordinates: they keep their place at the end and are still delivered. */
  unpinnedStops: z.number().int().nonnegative(),
  totalDistanceM: z.number().int().nonnegative(),
  /** Seconds, including the assumed time spent at each door. */
  totalDurationS: z.number().int().nonnegative(),
  ...AdvisoryFields,
  computedAt: z.string(),
  appliedAt: z.string().nullable(),
  appliedBy: IdSchema.nullable(),
  /** The crew re-sequenced by hand after applying: the plan was seen and improved on, which is worth knowing. */
  overridden: z.boolean(),
  createdAt: z.string(),
})
export type RoutePlan = z.infer<typeof RoutePlanSchema>

export const RoutePlanDetailSchema = RoutePlanSchema.extend({
  stops: z.array(RoutePlanStopSchema).max(AI_MAX_ROUTE_STOPS),
})
export type RoutePlanDetail = z.infer<typeof RoutePlanDetailSchema>

const RoutePlanItemOutput = z.object({ item: RoutePlanDetailSchema })

/**
 * Compute a sequence for the trip's open stops. Writes a `route_plans` row and NOTHING on the trip: the
 * stops move only at `apply`. A trip with more than `AI_MAX_ROUTE_STOPS` open stops is refused
 * (`too_many_stops`) rather than truncated. The van starts and ends at the trip's own load-out location.
 */
export const PlanRouteInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the PLAN. */
  id: IdSchema,
  /** The trip whose open stops are being sequenced. */
  tripId: IdSchema,
})
export const PlanRouteOutput = RoutePlanItemOutput

/**
 * The trip's current plan: the newest one, or `planId` for an older pass. `item` is null when nobody has
 * planned this trip — a normal answer, not an error. The godown reads it too, so the loader knows the
 * order the van will be emptied in.
 */
export const RoutePlanGetInput = z.object({
  tripId: IdSchema,
  planId: IdSchema.optional(),
})
export const RoutePlanGetOutput = z.object({ item: RoutePlanDetailSchema.nullable() })

/**
 * Write the plan's sequence onto the trip. The only procedure here that changes anything outside `ai`,
 * and it does it through `delivery.stops.reorder` — the same path, the same state machine and the same
 * refusals the crew's own re-sequencing goes through, never a direct write to `trip_stops`. A stop
 * already started, delivered or failed keeps its place; only open stops move. A trip runs one route, so
 * at most one plan per trip may be the applied one (a partial unique index says so). Applying again with
 * the same key answers the stored result; a stop moved by hand afterwards sets `overridden` and leaves
 * the trip exactly as the human left it.
 */
export const ApplyRoutePlanInput = MutationBase.extend({
  /** The plan to apply. */
  id: IdSchema,
  tripId: IdSchema,
  deviceId: DeviceIdSchema.optional(),
})
/** `stops` is the trip's stops in their new order, so the app re-renders without a second call. */
export const ApplyRoutePlanOutput = z.object({
  item: RoutePlanDetailSchema,
  stops: z.array(StopSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `ai: aiContract` in contract.ts
// Served by owner :3001, manager :3002, sales :3003, warehouse :3004, delivery :3005 and retailer :3006
// (never auth :3000); PERMISSIONS decides which procedure answers for which role — see the header.

export const aiContract = {
  intake: {
    parseText: oc
      .route({
        method: 'POST',
        path: '/ai/intake/text',
        summary: 'Read a message into a draft order (never creates an order)',
      })
      .input(ParseTextInput)
      .output(ParseTextOutput),
    transcribe: oc
      .route({
        method: 'POST',
        path: '/ai/intake/voice',
        summary: 'Transcribe a voice note and read it into a draft order',
      })
      .input(TranscribeVoiceInput)
      .output(TranscribeVoiceOutput),
  },
  drafts: {
    list: oc
      .route({
        method: 'GET',
        path: '/ai/drafts',
        summary: 'The draft queue (a shop sees only its own)',
      })
      .input(DraftsListInput)
      .output(DraftsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/ai/drafts/{id}',
        summary: 'One draft with its text, transcript and lines',
      })
      .input(DraftGetInput)
      .output(DraftGetOutput),
    confirm: oc
      .route({
        method: 'POST',
        path: '/ai/drafts/{id}/confirm',
        summary: 'Confirm the corrected lines: creates and submits a normal sales order',
      })
      .input(ConfirmDraftInput)
      .output(ConfirmDraftOutput),
    reject: oc
      .route({
        method: 'POST',
        path: '/ai/drafts/{id}/reject',
        summary: 'Throw the draft away with a reason',
      })
      .input(RejectDraftInput)
      .output(RejectDraftOutput),
  },
  forecast: {
    run: oc
      .route({
        method: 'POST',
        path: '/ai/forecast/run',
        summary: 'Queue a demand forecast pass (one per day per location)',
      })
      .input(ForecastRunInput)
      .output(ForecastRunOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/ai/forecast',
        summary: 'Reorder suggestions with days of cover (no cost, no value)',
      })
      .input(ForecastListInput)
      .output(ForecastListOutput),
  },
  routing: {
    plan: oc
      .route({
        method: 'POST',
        path: '/ai/routing/trips/{tripId}/plan',
        summary: "Sequence a trip's open stops; writes nothing on the trip",
      })
      .input(PlanRouteInput)
      .output(PlanRouteOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/ai/routing/trips/{tripId}/plan',
        summary: "The trip's current route plan, or null when none was computed",
      })
      .input(RoutePlanGetInput)
      .output(RoutePlanGetOutput),
    apply: oc
      .route({
        method: 'POST',
        path: '/ai/routing/trips/{tripId}/plan/apply',
        summary: 'Write the planned sequence onto the trip through delivery.stops.reorder',
      })
      .input(ApplyRoutePlanInput)
      .output(ApplyRoutePlanOutput),
  },
}
