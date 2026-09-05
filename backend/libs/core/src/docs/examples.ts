import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  approvals,
  bargainRequests,
  beats,
  cycleCounts,
  deliveries,
  deliveryChallans,
  devices,
  documents,
  exportJobs,
  extractions,
  importJobs,
  importRows,
  reviewSessions,
  skuMatchCandidates,
  grnLines,
  grns,
  inboundDiscrepancies,
  invoices,
  loadSheets,
  locations,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  purchaseOrders,
  receipts,
  retailerLinks,
  retailers,
  salesOrderLines,
  salesOrders,
  schemes,
  stockBalances,
  stockLots,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPackConfigs,
  suppliers,
  tenantProductCosts,
  tenantProducts,
  tenants,
  trips,
  tripStops,
  users,
  vehicles,
  withSystem,
  writeOffs,
  type Db,
} from '@dos/db'
import { contract, type ProcedureSummary } from '@dos/contracts'
import { BACK_OFFICE } from '../platform/authz.js'
import { DB } from '../platform/db.module.js'
import { sample, type ZodLike } from './sample.js'
import { BUILTIN_PROFILES, builtinProfileId, rowIdFor } from '../modules/integrations/index.js'

/**
 * Real request examples for the OpenAPI document.
 *
 * The Zod schemas alone give Swagger UI nothing but `string` and a random uuid, so pressing
 * "Try it out → Execute" against a seeded database answers 404 or a foreign-key error. This module
 * reads a handful of rows from the demo tenant once per process and rewrites every id-shaped field
 * of the static sampler's body with a row that actually exists, so every operation is executable
 * exactly as rendered.
 *
 * Four properties matter, and examples.spec.ts holds them:
 *  - **valid** — every example still parses against its own contract input schema.
 *  - **deterministic** — the same database gives the same document, so it can be cached and diffed.
 *    Nothing here uses `Date.now()` or a random uuid.
 *  - **idempotent** — every mutation carries a fixed `idempotencyKey` and, where the client generates
 *    the row id, a fixed UUIDv7; both are derived from the SAME per-procedure seed, so a second
 *    Execute replays the first result instead of creating a second row. A procedure that creates a
 *    row also walks that seed forward past the ids this database already holds (`freshSlots`), so a
 *    document generated after the first Execute documents a call that still works.
 *  - **role-aware** — the document belongs to one service, and a service serves a fixed set of roles
 *    (`BuildExamplesOptions.roles`). An example never carries a field the roles of THIS service may
 *    not send (credit terms are back-office only) and never names a row they may not touch (the
 *    shopkeeper app may only order for the shop its login is linked to, ADR 0006).
 */

/** Password every seeded demo user has (printed by `pnpm db:seed`). */
export const DEMO_PASSWORD = 'Dos@1234'

/**
 * The batch the `inventory.lots.upsert` example writes. It is the lot's NATURAL key together with the
 * variant and the MRP, so it has to stay fixed: the example only replays because a second Execute
 * resolves to the same row through this key.
 */
const DOCS_BATCH_NO = 'DOCS-B1'
const DOCS_BATCH_MRP_PAISE = 2000

/** Marker for "leave this optional field out of the example entirely". */
const DROP = Symbol('drop')

/** A 1×1 PNG: the smallest proof-of-delivery photo an example can carry inline (`InlineFileInput`). */
const DOCS_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** `YYYY-MM-DD` plus `days`, as a calendar date — no timezone can creep in. */
function addDaysIso(isoDate: string, days: number): string {
  const at = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

export interface DemoUser {
  id: string
  username: string | null
  name: string
}

/** The listing row of the example product, echoed back so `upsertListing` is a no-op. */
export interface DemoListing {
  variantId: string
  localAlias: string | null
  caseSizeOverride: number | null
  minOrderQty: number
  orderIncrement: number
  maxPerOrder: number | null
  sortOrder: number
}

/** The purchase-cost row of the example product, echoed back so `upsertCost` is a no-op. */
export interface DemoCost {
  variantId: string
  supplierId: string | null
  purchaseRatePaise: number
  landedCostPaise: number
  ptdPaise: number | null
  schemeMarginBps: number | null
}

/** One price-list row, echoed back so `setItems` does not silently reprice a demo product. */
export interface DemoPriceListItem {
  id: string
  variantId: string
  ratePaise: number
  inclusiveOfGst: boolean
}

/**
 * The shopkeeper sign-in the retailer app documents, and the one shop behind it. A retailer login may
 * only read and order for shops it is linked to through `retailer_links.user_id` (ADR 0006), so any
 * other shop in that service's document is a 403 waiting to happen.
 */
export interface DemoLinkedRetailer {
  userId: string
  retailerId: string
  code: string
  name: string
  phone: string
}

/** Order ids in the states the examples need, so one shop's document never reaches into another's. */
export interface DemoOrderSet {
  orderId?: string | undefined
  orderLineId?: string | undefined
  draftOrderIds?: string[] | undefined
  submittedOrderId?: string | undefined
  confirmedOrderId?: string | undefined
}

/**
 * The docint rows (docs/plans/docint.md §6). A document every capture role may read, the priced
 * reading behind it, an extraction with an amber line to accept and a red line to pick for, one
 * reviewable document per desk lane, the open review session each desk user holds, the reviewed
 * document waiting to be approved, and a duplicate to reject.
 */
export interface DocintExamples {
  /** A committed supplier bill with pages: get / status / pageUrl / extractions.list. */
  documentId?: string | undefined
  /** Its engine reading: extractions.get. */
  extractionId?: string | undefined
  /** A reading with candidates in every band: matches.*. */
  matchExtractionId?: string | undefined
  amberLineNo?: number | undefined
  amberCandidateId?: string | undefined
  redLineNo?: number | undefined
  /** Documents with a clean reading and no live lock, one per desk lane: review.start. */
  reviewable: string[]
  /** The open session each desk user holds, by user id: heartbeat / save / submit. */
  openSessions: Record<string, { sessionId: string; documentId: string }>
  /** The reviewed document with a submitted session (else a committed one, which replays): approve. */
  approvable?: { documentId: string; lineNos: number[] } | undefined
  /** A duplicate capture the desk may reject (a rejected one answers 200 again). */
  rejectable?: string | undefined
  /** A read document nobody is reviewing: extractions.run with force. */
  rerunnable?: string | undefined
  /** The GSTIN of the example supplier, for the QR the capture example carries. */
  supplierGstin?: string | undefined
}

/** The generic importer and the exports as the seed left them (docs/plans/integrations.md §6). */
export interface IntegrationsExamples {
  /** The staged party master with rows waiting for a human: preview / rows / review / cancel. */
  stagedJobId?: string | undefined
  /** Its source file in the object store: what a fresh `imports.create` stages again. */
  sourceObjectKey?: string | undefined
  /** The row of that job with a garbled mobile, and the shop it really is (pinned by the review example). */
  reviewRowNo?: number | undefined
  reviewRetailerId?: string | undefined
  reviewPhone?: string | undefined
  /** A finished Tally export: get / download-url / sync-ledger. */
  exportId?: string | undefined
  exportFrom?: string | undefined
  exportTo?: string | undefined
}

/**
 * Rows pulled from the demo tenant. Every field is optional: a missing one falls back to the static
 * sampler, so the document still generates against an empty or unmigrated database.
 */
export interface ExampleContext {
  tenantId?: string | undefined
  tenantSlug?: string | undefined
  /** One user per membership role, keyed by role name. */
  users?: Record<string, DemoUser> | undefined
  /** A staff member who is NOT the primary example user of their role — safe to poke with staff mutations. */
  spareUserId?: string | undefined
  /** Every such candidate with its role, so a service can avoid the roles it signs people in as. */
  spareStaff?: readonly { id: string; role: string }[] | undefined
  deviceId?: string | undefined

  retailerId?: string | undefined
  retailerCode?: string | undefined
  retailerName?: string | undefined
  retailerPhone?: string | undefined
  retailerSearch?: string | undefined
  beatId?: string | undefined
  identityId?: string | undefined

  variantId?: string | undefined
  variantName?: string | undefined
  productSearch?: string | undefined
  productId?: string | undefined
  brandId?: string | undefined
  manufacturerId?: string | undefined
  secondVariantId?: string | undefined
  /** Pieces to order: a multiple of the listing's order increment, at or above its minimum. */
  orderQty?: number | undefined
  listing?: DemoListing | undefined
  cost?: DemoCost | undefined

  locationId?: string | undefined
  vehicleLocationId?: string | undefined
  vehicleId?: string | undefined
  lotId?: string | undefined
  lotLocationId?: string | undefined
  lotQty?: number | undefined
  /** A warehouse/vehicle that is NOT where `lotId` sits — a transfer refuses `from === to`. */
  transferToLocationId?: string | undefined
  /** The lot the `lots.upsert` natural key already resolves to, so the example is a true upsert. */
  docsLotId?: string | undefined

  supplierId?: string | undefined
  /**
   * The pack config the `packConfigs.upsert` natural key (supplier, variant) already resolves to, so
   * the example is a true upsert — the same reason `docsLotId` exists.
   */
  docsPackConfigId?: string | undefined
  purchaseOrderId?: string | undefined
  supplierInvoiceId?: string | undefined
  supplierInvoiceLineId?: string | undefined
  /** An invoice whose lines are still open (not `received`/`cancelled`) — the only one `matchLine` takes. */
  matchableInvoiceId?: string | undefined
  matchableInvoiceLineId?: string | undefined
  /** An `approved` invoice no live GRN has claimed — the only one `grns.open` takes. */
  grnOpenInvoiceId?: string | undefined
  grnId?: string | undefined
  grnLineId?: string | undefined
  /** A GRN in `counting`/`reconciled`: the only states `grns.count` accepts. */
  countableGrnId?: string | undefined
  /** A `reconciled` GRN, else a `posted` one (`post` replies 200 for an already posted GRN). */
  postableGrnId?: string | undefined
  postableGrnStatus?: string | undefined
  /** Status of `grnId`, so the note can say whether count/post are legal on it right now. */
  grnStatus?: string | undefined

  priceListId?: string | undefined
  priceListItem?: DemoPriceListItem | undefined
  schemeId?: string | undefined
  bargainRequestId?: string | undefined
  /** Status of `bargainRequestId`; only `requested` may be decided. */
  bargainStatus?: string | undefined
  /** What that bargain asked for. Approving at the asked rate is always inside the list-rate ceiling. */
  bargainAskedRatePaise?: number | undefined

  /** Draft orders, in id order. Different examples take different ones so they do not fight. */
  draftOrderIds?: string[] | undefined
  submittedOrderId?: string | undefined
  confirmedOrderId?: string | undefined
  /** Any order, for read-only examples. */
  orderId?: string | undefined
  orderLineId?: string | undefined
  approvalId?: string | undefined
  invoiceId?: string | undefined

  /** Rows the platform-gaps procedures point at (docs/23 §8): every `{id}` route names a real one. */
  receiptId?: string | undefined
  /**
   * An allocation the desk may take back (`allocations.remove`): one made from a receipt that is still
   * `collected`/`deposited`. A write-off's or a reversed receipt's allocation is refused, so it is never
   * the example.
   */
  allocationId?: string | undefined
  challanId?: string | undefined
  /** A pack confirmed with `issueInvoice: false` and still unbilled — the one `issueForPack` takes. */
  parkedPackId?: string | undefined
  /** A draft load sheet the manager has NOT approved yet (`loadSheets.approve`), else any draft. */
  approvableLoadSheetId?: string | undefined
  loadSheetId?: string | undefined
  /** An `open` gate-count finding (`discrepancies.resolve`), else any. */
  discrepancyId?: string | undefined
  discrepancyStatus?: string | undefined
  /** A supplier invoice still `extracted`/`in_review`/`approved` with no live GRN (dispute / cancel). */
  disputableInvoiceId?: string | undefined
  cycleCountId?: string | undefined
  cycleCountStatus?: string | undefined
  /** The lot on `cycleCountId`, so `cycleCounts.count` names a line that is on the count. */
  cycleCountLotId?: string | undefined
  /**
   * The road (delivery module). Every trip here is one the demo delivery user is crew on, so the
   * delivery-service document points at trips its own sign-in may open.
   */
  activeTripId?: string | undefined
  plannedTripId?: string | undefined
  /** The first stop of the planned trip and its sequence (a no-op reorder). */
  plannedTripStopId?: string | undefined
  plannedTripStopSequence?: number | undefined
  /** An open stop of the active trip with a planned bill on it, and that bill's lines. */
  tripStopId?: string | undefined
  tripStopRetailerId?: string | undefined
  plannedDeliveryId?: string | undefined
  plannedDeliveryInvoiceId?: string | undefined
  plannedDeliveryLines?: { id: string; qtyPcs: number }[] | undefined
  /** A delivery that was attempted (`outcome` set): the proof screen and `addPod`. */
  deliveryId?: string | undefined
  /** The retailer app's own attempted delivery (its linked shop's). */
  linkedDeliveryId?: string | undefined
  vehicleRegNo?: string | undefined
  crewDriverId?: string | undefined
  crewHelperId?: string | undefined
  /** A variant with sellable pieces on the active trip's vehicle: a one-piece van sale. */
  vanVariantId?: string | undefined
  /** The shop the demo retailer login owns; the retailer app's document is scoped to it. */
  linkedRetailer?: DemoLinkedRetailer | undefined
  /** That shop's own orders, so the shopkeeper's document never points at somebody else's order. */
  linkedOrders?: DemoOrderSet | undefined
  /** That shop's own latest receipt, for the same reason. */
  linkedReceiptId?: string | undefined
  /** The inbound inbox (docint): the rows every docint example points at. */
  docint?: DocintExamples | undefined
  /** The import wizard and the exports screen (integrations). */
  integrations?: IntegrationsExamples | undefined
  /**
   * Free slots of the id sequence of every CREATING procedure, in order — the ones this database does
   * not hold. One lane per role (see `serviceLane`) so seven services generating their documents in
   * the same second still hand out seven different ids.
   */
  slotLanes?: Record<string, number[]> | undefined
  /**
   * The slot THIS service's document took out of `slotLanes`. Derived per build, not read from the
   * database — `buildExamples` fills it in; nothing else should set it.
   */
  freshSlots?: Record<string, number> | undefined
}

export interface ProcedureExample {
  /** Dotted contract path, e.g. `orders.approvals.decide`. */
  path: string
  method: string
  httpPath: string
  /** The complete input, before it is split into path/query/body. This is what the contract validates. */
  input: Record<string, unknown>
  pathParams: Record<string, unknown>
  /** Only the filters that keep the call returning rows; the rest are left blank on purpose. */
  query: Record<string, unknown>
  body: Record<string, unknown> | undefined
  /** Rendered as `x-dos-note` — a caveat the caller must know before pressing Execute. */
  note?: string | undefined
}

export interface BuildExamplesOptions {
  /** The calling service's roles; picks which demo user the sign-in example shows. */
  roles?: readonly string[]
  /**
   * Which free-slot lane to take for the ids an example creates. Defaults to the lane of the most
   * senior role (`serviceLane`). A spec that asserts "this id is not held yet" must pass the spare
   * lane (`SPARE_LANE`): the service specs run in parallel under turbo and press the real lanes.
   */
  lane?: number
}

/** The lane no service uses (`SLOT_LANES` = the seven role lanes plus this spare). */
export const SPARE_LANE = 7

/** `GET /orders/{id}` — how the OpenAPI document identifies an operation. */
export function routeKey(method: string, httpPath: string): string {
  return `${method.toUpperCase()} ${httpPath}`
}

// ---------------------------------------------------------------------------------------------------------------
// reading the demo tenant

/**
 * Reads the example rows once and keeps the promise. A load that comes back empty (no database, no
 * demo data yet) is not cached, so the next request tries again after a seed.
 */
@Injectable()
export class DocExamplesService {
  private pending: Promise<ExampleContext> | null = null

  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  load(): Promise<ExampleContext> {
    this.pending ??= this.read()
    return this.pending
  }

  /** Drops the cache; the next `load()` re-reads the database (used by `/docs/openapi.json?fresh=1`). */
  refresh(): Promise<ExampleContext> {
    this.pending = null
    return this.load()
  }

  private async read(): Promise<ExampleContext> {
    const db = this.db
    if (!db) return {}
    try {
      const ctx = await withSystem(db, (tx) => collect(tx))
      if (!ctx.tenantId) this.pending = null // nothing seeded yet: look again next time
      return ctx
    } catch (error) {
      // Documentation must never fail because of the database: one line, then the static sampler.
      console.warn('[docs] example rows unavailable; falling back to schema samples', error)
      this.pending = null
      return {}
    }
  }
}

const first = <T>(rows: T[]): T | undefined => rows[0]

/**
 * What the `sellable_stock` view calls available: on hand minus reserved. Examples must point at a
 * lot the reads actually return and the writes can actually move, so every stock pick uses this.
 */
const AVAILABLE = sql<number>`${stockBalances.onHand} - ${stockBalances.reserved}`

/** First word of a name, as a search term that certainly matches at least one row. */
function searchTerm(name: string | null | undefined): string | undefined {
  const word = (name ?? '').trim().split(/\s+/)[0]
  return word && word.length >= 2 ? word : undefined
}

/** The oldest active tenant that has both shops and orders — the seeded pilot, not a spec's fixture. */
async function pickTenant(tx: Db): Promise<{ id: string; slug: string } | undefined> {
  const candidates = await tx
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.status, 'active'))
    .orderBy(asc(tenants.createdAt))
    .limit(50)
  if (candidates.length === 0) return undefined
  const ids = candidates.map((row) => row.id)
  const withOrders = new Set(
    (
      await tx
        .selectDistinct({ tenantId: salesOrders.tenantId })
        .from(salesOrders)
        .where(inArray(salesOrders.tenantId, ids))
    ).map((row) => row.tenantId),
  )
  const withRetailers = new Set(
    (
      await tx
        .selectDistinct({ tenantId: retailers.tenantId })
        .from(retailers)
        .where(inArray(retailers.tenantId, ids))
    ).map((row) => row.tenantId),
  )
  return (
    candidates.find((row) => withOrders.has(row.id) && withRetailers.has(row.id)) ?? candidates[0]
  )
}

async function collect(tx: Db): Promise<ExampleContext> {
  const tenant = await pickTenant(tx)
  if (!tenant) return {}
  const ctx: ExampleContext = { tenantId: tenant.id, tenantSlug: tenant.slug }
  await collectPeople(tx, tenant.id, ctx)
  await collectRetailerLogin(tx, tenant.id, ctx)
  await collectOrders(tx, tenant.id, ctx)
  await collectCatalog(tx, tenant.id, ctx)
  await collectStock(tx, tenant.id, ctx)
  await collectProcurement(tx, tenant.id, ctx)
  await collectPricing(tx, tenant.id, ctx)
  await collectPlatformGaps(tx, tenant.id, ctx)
  await collectDelivery(tx, tenant.id, ctx)
  await collectDocint(tx, tenant.id, ctx)
  await collectIntegrations(tx, tenant.id, ctx)
  await collectFreshSlots(tx, tenant.id, ctx)
  return ctx
}

/** The wizard as the seed left it: a staged party master with a row to review, a finished Tally export. */
async function collectIntegrations(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const out: IntegrationsExamples = {}
  ctx.integrations = out
  const [staged] = await tx
    .select({ id: importJobs.id, sourceObjectKey: importJobs.sourceObjectKey })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.tenantId, tenantId),
        eq(importJobs.target, 'party_master'),
        eq(importJobs.status, 'staged'),
      ),
    )
    .orderBy(asc(importJobs.createdAt))
    .limit(1)
  if (!staged) {
    // No staged party master (the founder cancelled it from Swagger, or the seed has not run): the
    // wizard example still needs a file that EXISTS in the object store, so it re-stages the newest
    // party master that ever parsed — never a made-up key, which would land the whole chain `failed`.
    const [parsed] = await tx
      .select({ sourceObjectKey: importJobs.sourceObjectKey })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.tenantId, tenantId),
          eq(importJobs.kind, 'tradeezee'),
          eq(importJobs.target, 'party_master'),
          isNotNull(importJobs.totalRows),
        ),
      )
      .orderBy(desc(importJobs.createdAt))
      .limit(1)
    out.sourceObjectKey = parsed?.sourceObjectKey
  }
  if (staged) {
    out.stagedJobId = staged.id
    out.sourceObjectKey = staged.sourceObjectKey
    const [row] = await tx
      .select({ rowNo: importRows.rowNo, raw: importRows.raw })
      .from(importRows)
      .where(and(eq(importRows.importJobId, staged.id), eq(importRows.status, 'error')))
      .orderBy(asc(importRows.rowNo))
      .limit(1)
    if (row) {
      out.reviewRowNo = row.rowNo
      const name = (row.raw as Record<string, string> | null)?.['Party Name']
      if (name) {
        const [shop] = await tx
          .select({ id: retailers.id, phone: retailers.phone })
          .from(retailers)
          .where(
            and(
              eq(retailers.tenantId, tenantId),
              eq(retailers.name, name),
              eq(retailers.active, true),
            ),
          )
          .limit(1)
        out.reviewRetailerId = shop?.id
        out.reviewPhone = shop?.phone
      }
    }
  }
  const [exported] = await tx
    .select({ id: exportJobs.id, params: exportJobs.params })
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.tenantId, tenantId),
        eq(exportJobs.kind, 'tally_xml'),
        eq(exportJobs.status, 'succeeded'),
      ),
    )
    .orderBy(asc(exportJobs.createdAt))
    .limit(1)
  if (exported) {
    out.exportId = exported.id
    const params = exported.params as { from?: string; to?: string } | null
    out.exportFrom = params?.from
    out.exportTo = params?.to
  }
}

/** The inbound inbox as the seed left it (docs/plans/docint.md §6). */
async function collectDocint(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const docint: DocintExamples = { reviewable: [], openSessions: {} }
  ctx.docint = docint
  const committed = first(
    (
      await tx.execute(
        sql`select d.id from documents d
             where d.tenant_id = ${tenantId} and d.kind = 'supplier_invoice' and d.status = 'committed'
               and exists (select 1 from document_pages p where p.document_id = d.id)
             order by d.created_at desc limit 1`,
      )
    ).rows as { id: string }[],
  )
  docint.documentId =
    committed?.id ??
    first(
      (
        await tx.execute(
          sql`select d.id from documents d
               where d.tenant_id = ${tenantId} and d.kind = 'supplier_invoice'
                 and exists (select 1 from document_pages p where p.document_id = d.id)
               order by d.created_at desc limit 1`,
        )
      ).rows as { id: string }[],
    )?.id
  if (docint.documentId)
    docint.extractionId = first(
      await tx
        .select({ id: extractions.id })
        .from(extractions)
        .where(
          and(eq(extractions.documentId, docint.documentId), eq(extractions.engine, 'llm_vision')),
        )
        .orderBy(desc(extractions.createdAt))
        .limit(1),
    )?.id
  // The reading with an amber line (candidates, none chosen) on a document still open for matching
  // (not committed / rejected); once every line has been accepted, any line that has candidates —
  // accept re-accepts, reject un-chooses, choose picks — so the three writes keep a real target.
  const amber = first(
    (
      await tx.execute(
        sql`select c.extraction_id, c.line_no, c.id as candidate_id, e.line_count,
                   exists (select 1 from sku_match_candidates x
                            where x.extraction_id = c.extraction_id and x.line_no = c.line_no and x.chosen) as chosen
               from sku_match_candidates c
               join extractions e on e.id = c.extraction_id
               join documents d on d.id = e.document_id
              where c.tenant_id = ${tenantId} and d.status in ('extracted', 'needs_review')
              order by chosen asc, e.created_at desc, c.line_no, c.score desc limit 1`,
      )
    ).rows as {
      extraction_id: string
      line_no: number
      candidate_id: string
      line_count: number | null
    }[],
  )
  if (amber) {
    docint.matchExtractionId = amber.extraction_id
    docint.amberLineNo = Number(amber.line_no)
    docint.amberCandidateId = amber.candidate_id
    const withCandidates = new Set(
      (
        await tx
          .selectDistinct({ lineNo: skuMatchCandidates.lineNo })
          .from(skuMatchCandidates)
          .where(eq(skuMatchCandidates.extractionId, amber.extraction_id))
      ).map((r) => r.lineNo),
    )
    for (let n = 1; n <= Number(amber.line_count ?? 0); n++)
      if (!withCandidates.has(n)) {
        docint.redLineNo = n
        break
      }
  } else if (docint.extractionId) docint.matchExtractionId = docint.extractionId
  // Clean readings first (`extracted`), then the flagged ones nobody holds: a captured bill the
  // capture examples submitted earlier lands here too, so the desk chain keeps a target across runs.
  docint.reviewable = (
    (
      await tx.execute(
        sql`select d.id from documents d
             where d.tenant_id = ${tenantId} and d.kind = 'supplier_invoice'
               and d.status in ('extracted', 'needs_review')
               and not exists (select 1 from review_sessions s
                                where s.document_id = d.id and s.status = 'open' and s.locked_until > now())
             order by (d.status = 'extracted') desc, d.created_at limit 8`,
      )
    ).rows as { id: string }[]
  ).map((r) => r.id)
  const open = await tx
    .select({
      id: reviewSessions.id,
      documentId: reviewSessions.documentId,
      reviewerId: reviewSessions.reviewerId,
    })
    .from(reviewSessions)
    .where(
      and(
        eq(reviewSessions.tenantId, tenantId),
        eq(reviewSessions.status, 'open'),
        sql`${reviewSessions.lockedUntil} > now()`,
      ),
    )
    .orderBy(desc(reviewSessions.lockedUntil))
    .limit(20)
  for (const row of open)
    docint.openSessions[row.reviewerId] ??= { sessionId: row.id, documentId: row.documentId }
  const reviewed = first(
    (
      await tx.execute(
        sql`select d.id, coalesce(jsonb_array_length(s.reviewed -> 'lines'), 0)::int as lines
               from documents d join review_sessions s on s.document_id = d.id and s.status = 'submitted'
              where d.tenant_id = ${tenantId} and d.status = 'reviewed' and d.kind = 'supplier_invoice'
              order by s.submitted_at desc nulls last limit 1`,
      )
    ).rows as { id: string; lines: number }[],
  )
  if (reviewed) {
    docint.approvable = {
      documentId: reviewed.id,
      lineNos: Array.from({ length: Math.max(1, Number(reviewed.lines)) }, (_, i) => i + 1),
    }
  } else if (committed) {
    // Approving an already committed document replays its draft, so the example never dead-ends.
    docint.approvable = { documentId: committed.id, lineNos: [1] }
  }
  docint.rejectable = first(
    (
      await tx.execute(
        sql`select d.id from documents d
             where d.tenant_id = ${tenantId} and d.kind = 'supplier_invoice'
               and (d.note ilike '%second copy%' or d.status = 'rejected')
             order by (d.status = 'rejected') asc, d.created_at limit 1`,
      )
    ).rows as { id: string }[],
  )?.id
  docint.rerunnable = first(
    (
      await tx.execute(
        sql`select d.id from documents d
             where d.tenant_id = ${tenantId} and d.kind = 'brand_dms_invoice'
               and d.status in ('extracted', 'needs_review')
               and not exists (select 1 from review_sessions s
                                where s.document_id = d.id and s.status = 'open' and s.locked_until > now())
             order by d.created_at limit 1`,
      )
    ).rows as { id: string }[],
  )?.id
  docint.supplierGstin = ctx.supplierId
    ? (first(
        await tx
          .select({ gstin: suppliers.gstin })
          .from(suppliers)
          .where(eq(suppliers.id, ctx.supplierId))
          .limit(1),
      )?.gstin ?? undefined)
    : undefined
}

/**
 * The road, as the demo delivery user drives it: the active trip and tomorrow's plan (both with that
 * user as crew, so the delivery-service document never names a trip its sign-in cannot open), an open
 * stop with its planned bill, an attempted delivery, and one variant with pieces on the van.
 */
async function collectDelivery(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  // The delivery sign-in the document shows must be able to OPEN the trips it names: prefer the
  // delivery member who drives (or helps on) an active or planned trip over whoever came first.
  const onTheRoad = first(
    (
      await tx.execute(
        sql`select u.id, u.username, u.name
               from trips t
               join memberships m on m.tenant_id = t.tenant_id and m.role = 'delivery' and m.status = 'active'
                and (m.user_id = t.driver_id or m.user_id = t.helper_id)
               join users u on u.id = m.user_id
              where t.tenant_id = ${tenantId} and t.state in ('active', 'planned', 'loading')
                and u.username is not null
              order by (t.state = 'active') desc, abs(t.trip_date - current_date),
                       (m.user_id = t.driver_id) desc
              limit 1`,
      )
    ).rows as { id: string; username: string | null; name: string }[],
  )
  if (onTheRoad) ctx.users = { ...(ctx.users ?? {}), delivery: onTheRoad }
  const crew = ctx.users?.delivery?.id
  const crewFilter = crew ? sql`and (t.driver_id = ${crew} or t.helper_id = ${crew})` : sql``
  const tripRows = (
    await tx.execute(
      sql`select t.id, t.state::text as state, t.driver_id, t.helper_id, v.reg_no
             from trips t join vehicles v on v.id = t.vehicle_id
            where t.tenant_id = ${tenantId} and t.state in ('active', 'planned', 'loading') ${crewFilter}
            order by (t.state = 'active') desc, abs(t.trip_date - current_date), t.id desc limit 10`,
    )
  ).rows as {
    id: string
    state: string
    driver_id: string | null
    helper_id: string | null
    reg_no: string
  }[]
  const active = tripRows.find((r) => r.state === 'active')
  const planned = tripRows.find((r) => r.state === 'planned' || r.state === 'loading')
  ctx.activeTripId = active?.id
  ctx.plannedTripId = planned?.id
  ctx.crewDriverId = active?.driver_id ?? planned?.driver_id ?? crew
  ctx.crewHelperId = active?.helper_id ?? planned?.helper_id ?? undefined
  ctx.vehicleRegNo = first(
    await tx
      .select({ regNo: vehicles.regNo })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.id, ctx.vehicleId ?? '')))
      .limit(1),
  )?.regNo
  if (planned) {
    const stop = first(
      await tx
        .select({ id: tripStops.id, sequence: tripStops.sequence })
        .from(tripStops)
        .where(and(eq(tripStops.tenantId, tenantId), eq(tripStops.tripId, planned.id)))
        .orderBy(asc(tripStops.sequence))
        .limit(1),
    )
    ctx.plannedTripStopId = stop?.id
    ctx.plannedTripStopSequence = stop?.sequence
  }
  if (active) {
    const stop = first(
      (
        await tx.execute(
          sql`select s.id, s.retailer_id, d.id as delivery_id, d.invoice_id
                 from trip_stops s
                 left join deliveries d on d.stop_id = s.id and d.outcome is null
                where s.tenant_id = ${tenantId} and s.trip_id = ${active.id}
                  and s.state in ('pending', 'started', 'arrived')
                order by (d.id is null) asc, s.sequence limit 1`,
        )
      ).rows as {
        id: string
        retailer_id: string
        delivery_id: string | null
        invoice_id: string | null
      }[],
    )
    ctx.tripStopId = stop?.id
    ctx.tripStopRetailerId = stop?.retailer_id
    ctx.plannedDeliveryId = stop?.delivery_id ?? undefined
    ctx.plannedDeliveryInvoiceId = stop?.invoice_id ?? undefined
    if (stop?.invoice_id) {
      ctx.plannedDeliveryLines = (
        (
          await tx.execute(
            sql`select id, (qty_pcs + free_qty_pcs)::int as qty_pcs from invoice_lines
                 where tenant_id = ${tenantId} and invoice_id = ${stop.invoice_id} order by line_no`,
          )
        ).rows as { id: string; qty_pcs: number }[]
      ).map((l) => ({ id: l.id, qtyPcs: Number(l.qty_pcs) }))
    }
    ctx.vanVariantId = first(
      (
        await tx.execute(
          sql`select l.variant_id from trips t join vehicles v on v.id = t.vehicle_id
                 join stock_balances sb on sb.location_id = v.location_id and sb.tenant_id = t.tenant_id
                 join stock_lots l on l.id = sb.lot_id
                where t.tenant_id = ${tenantId} and t.id = ${active.id} and (sb.on_hand - sb.reserved) > 0
                order by (sb.on_hand - sb.reserved) desc, sb.lot_id limit 1`,
        )
      ).rows as { variant_id: string }[],
    )?.variant_id
  }
  const attempted = (filter: SQL) =>
    tx
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, tenantId), sql`${deliveries.outcome} is not null`, filter))
      .orderBy(desc(deliveries.id))
      .limit(1)
  ctx.deliveryId =
    first(await attempted(active ? eq(deliveries.tripId, active.id) : sql`true`))?.id ??
    first(await attempted(sql`true`))?.id
  if (ctx.linkedRetailer)
    ctx.linkedDeliveryId = first(
      await attempted(eq(deliveries.retailerId, ctx.linkedRetailer.retailerId)),
    )?.id
}

/** The rows behind the platform-gaps procedures (docs/23 §8): receipts, challans, parked packs, sheets, findings, counts. */
async function collectPlatformGaps(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  ctx.receiptId = first(
    await tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'collected')))
      .orderBy(desc(receipts.receivedAt), desc(receipts.id))
      .limit(1),
  )?.id
  ctx.allocationId = first(
    (
      await tx.execute(
        sql`select a.id from allocations a
              join receipts r on r.tenant_id = a.tenant_id and r.id = a.receipt_id
             where a.tenant_id = ${tenantId} and a.amount_paise > 0
               and r.status in ('collected', 'deposited')
             order by a.id limit 1`,
      )
    ).rows as { id: string }[],
  )?.id
  ctx.challanId = first(
    await tx
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(eq(deliveryChallans.tenantId, tenantId))
      .orderBy(desc(deliveryChallans.id))
      .limit(1),
  )?.id
  // A parked pack that MOVED stock comes first: `issueForPack` rebuilds the bill from the pack's
  // `pack` ledger rows, and a pack of an order nothing was ever held for (a 100 % short pack) has
  // none to bill. Any parked pack is still the fallback, so the note can say why the call refuses.
  ctx.parkedPackId = first(
    (
      await tx.execute(
        sql`select p.id from pack_confirmations p
             where p.tenant_id = ${tenantId} and p.invoice_id is null
             order by exists (select 1 from stock_ledger sl
                               where sl.tenant_id = p.tenant_id
                                 and sl.ref_type = 'pack' and sl.ref_id = p.order_id) desc,
                      p.id limit 1`,
      )
    ).rows as { id: string }[],
  )?.id
  const sheets = await tx
    .select({ id: loadSheets.id, status: loadSheets.status, approvedBy: loadSheets.approvedBy })
    .from(loadSheets)
    .where(eq(loadSheets.tenantId, tenantId))
    .orderBy(desc(loadSheets.sheetDate), desc(loadSheets.id))
    .limit(50)
  ctx.approvableLoadSheetId = sheets.find((r) => r.status === 'draft' && r.approvedBy === null)?.id
  ctx.loadSheetId = first(sheets)?.id
  // A finding on a POSTED GRN first: a recount (`grns.count`, which another service's document may
  // press on the same open GRN moments later) deletes and re-creates the open findings of the lines it
  // counts, and the example would 404 on the id it published. Posted counts are frozen.
  const findings = await tx
    .select({ id: inboundDiscrepancies.id, status: inboundDiscrepancies.status })
    .from(inboundDiscrepancies)
    .innerJoin(grns, eq(grns.id, inboundDiscrepancies.grnId))
    .where(eq(inboundDiscrepancies.tenantId, tenantId))
    .orderBy(sql`(${grns.status} = 'posted') desc`, desc(inboundDiscrepancies.id))
    .limit(50)
  const finding = findings.find((r) => r.status === 'open') ?? first(findings)
  ctx.discrepancyId = finding?.id
  ctx.discrepancyStatus = finding?.status
  ctx.disputableInvoiceId = first(
    await tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.tenantId, tenantId),
          inArray(supplierInvoices.status, ['extracted', 'in_review', 'approved']),
          sql`NOT EXISTS (SELECT 1 FROM grns g WHERE g.supplier_invoice_id = ${supplierInvoices.id} AND g.status <> 'cancelled')`,
        ),
      )
      .orderBy(asc(supplierInvoices.createdAt))
      .limit(1),
  )?.id
  const counts = await tx
    .select({ id: cycleCounts.id, status: cycleCounts.status })
    .from(cycleCounts)
    .where(eq(cycleCounts.tenantId, tenantId))
    .orderBy(desc(cycleCounts.id))
    .limit(20)
  const count =
    counts.find((r) => r.status === 'open') ??
    counts.find((r) => r.status === 'counted') ??
    first(counts)
  ctx.cycleCountId = count?.id
  ctx.cycleCountStatus = count?.status
  if (count) {
    const line = first(
      (
        await tx.execute(
          sql`select lot_id from cycle_count_lines where tenant_id = ${tenantId} and cycle_count_id = ${count.id} order by lot_id limit 1`,
        )
      ).rows as { lot_id: string }[],
    )
    ctx.cycleCountLotId = line?.lot_id
  }
}

/**
 * The one shop the retailer app's document may use, and the login that owns it.
 *
 * `collectPeople` picks the retailer sign-in by membership order, which says nothing about which shop
 * that person is linked to; pricing and orders answer 403 for any other shop (ADR 0006). So the pick
 * starts from the LINK instead: the linked shop with the lowest retailer code, and the login on that
 * link. Ordering by code (then id) keeps it stable, and it keeps the printed sign-in and the printed
 * shop the same pair, which is the only combination a reader can actually press Execute on.
 */
async function collectRetailerLogin(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const link = first(
    await tx
      .select({
        userId: retailerLinks.userId,
        retailerId: retailers.id,
        code: retailers.code,
        name: retailers.name,
        phone: retailers.phone,
        username: users.username,
        personName: users.name,
      })
      .from(retailerLinks)
      .innerJoin(retailers, eq(retailers.id, retailerLinks.retailerId))
      .innerJoin(users, eq(users.id, retailerLinks.userId))
      .where(and(eq(retailerLinks.tenantId, tenantId), eq(retailerLinks.status, 'active')))
      .orderBy(asc(retailers.code), asc(retailers.id))
      .limit(1),
  )
  const userId = link?.userId
  if (!link || !userId) return
  ctx.linkedRetailer = {
    userId,
    retailerId: link.retailerId,
    code: link.code,
    name: link.name,
    phone: link.phone,
  }
  ctx.users = {
    ...(ctx.users ?? {}),
    retailer: { id: userId, username: link.username, name: link.personName },
  }
}

async function collectPeople(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const staff = await tx
    .select({ id: users.id, username: users.username, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active')))
    .orderBy(asc(memberships.createdAt))
    .limit(200)

  const byRole: Record<string, DemoUser> = {}
  // A person with a username can actually sign in, so they make the better example for their role;
  // someone invited but never given one still fills a `userId` field if nobody else does.
  for (const row of [...staff].sort((a, b) => Number(!a.username) - Number(!b.username))) {
    byRole[row.role] ??= { id: row.id, username: row.username, name: row.name }
  }
  ctx.users = byRole
  const primaries = new Set(Object.values(byRole).map((user) => user.id))
  // Every non-primary staff member, with the role they hold. "Non-primary" alone is not enough to
  // make one safe to poke: a tenant with two owners leaves the SECOND owner out of `primaries`, and
  // if that is the person reading the document, `setStatus` answers "You cannot change your own
  // membership status". `spareStaffFor` narrows it per service, which is what makes it safe.
  ctx.spareStaff = staff
    .filter((row) => row.role !== 'retailer' && !primaries.has(row.id))
    .map((row) => ({ id: row.id, role: row.role }))
  ctx.spareUserId = ctx.spareStaff[0]?.id

  const staffIds = staff.map((row) => row.id)
  if (staffIds.length > 0) {
    const rows = await tx
      .select({ id: devices.id, userId: devices.userId })
      .from(devices)
      .where(and(inArray(devices.userId, staffIds), isNull(devices.revokedAt)))
      .limit(50)
    const preferred = byRole.salesperson?.id ?? byRole.owner?.id
    ctx.deviceId = (rows.find((row) => row.userId === preferred) ?? first(rows))?.id
  }

  ctx.identityId =
    first(
      await tx
        .select({ identityId: retailerLinks.identityId })
        .from(retailerLinks)
        .where(eq(retailerLinks.tenantId, tenantId))
        .limit(1),
    )?.identityId ?? undefined
}

async function collectOrders(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const recent = await tx
    .select({ id: salesOrders.id, state: salesOrders.state, retailerId: salesOrders.retailerId })
    .from(salesOrders)
    .where(eq(salesOrders.tenantId, tenantId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(300)
  ctx.orderId = first(recent)?.id
  ctx.draftOrderIds = recent
    .filter((row) => row.state === 'draft')
    .map((row) => row.id)
    .sort()
  ctx.submittedOrderId = recent.find((row) => row.state === 'submitted')?.id
  ctx.confirmedOrderId = recent.find((row) => row.state === 'confirmed')?.id

  // A shop that certainly has orders, so `GET /orders?retailerId=` and repeat-last both find rows.
  const retailerId =
    recent.find((row) => row.state === 'closed' || row.state === 'delivered')?.retailerId ??
    first(recent)?.retailerId
  const retailer = retailerId
    ? first(
        await tx
          .select({
            id: retailers.id,
            code: retailers.code,
            name: retailers.name,
            phone: retailers.phone,
            beatId: retailers.beatId,
          })
          .from(retailers)
          .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, retailerId)))
          .limit(1),
      )
    : undefined
  if (retailer) {
    ctx.retailerId = retailer.id
    ctx.retailerCode = retailer.code
    ctx.retailerName = retailer.name
    ctx.retailerPhone = retailer.phone
    ctx.retailerSearch = searchTerm(retailer.name)
    ctx.beatId = retailer.beatId ?? undefined
  }
  ctx.beatId ??= first(
    await tx
      .select({ id: beats.id })
      .from(beats)
      .where(and(eq(beats.tenantId, tenantId), eq(beats.active, true)))
      .limit(1),
  )?.id

  const orderId = ctx.orderId
  if (orderId) {
    ctx.orderLineId = first(
      await tx
        .select({ id: salesOrderLines.id })
        .from(salesOrderLines)
        .where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, orderId)))
        .limit(1),
    )?.id
  }

  const decisions = await tx
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(eq(approvals.tenantId, tenantId))
    .orderBy(desc(approvals.createdAt))
    .limit(50)
  ctx.approvalId = (decisions.find((row) => row.status === 'pending') ?? first(decisions))?.id

  ctx.invoiceId = first(
    await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId))
      .orderBy(desc(invoices.createdAt))
      .limit(1),
  )?.id

  await collectLinkedOrders(tx, tenantId, ctx)
}

/** The linked shop's own orders — the only ones a retailer login can open (RLS + ADR 0006). */
async function collectLinkedOrders(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const retailerId = ctx.linkedRetailer?.retailerId
  if (!retailerId) return
  const own = await tx
    .select({ id: salesOrders.id, state: salesOrders.state })
    .from(salesOrders)
    .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.retailerId, retailerId)))
    .orderBy(desc(salesOrders.createdAt))
    .limit(200)
  const orderId = first(own)?.id
  const orderLineId = orderId
    ? first(
        await tx
          .select({ id: salesOrderLines.id })
          .from(salesOrderLines)
          .where(and(eq(salesOrderLines.tenantId, tenantId), eq(salesOrderLines.orderId, orderId)))
          .limit(1),
      )?.id
    : undefined
  ctx.linkedOrders = {
    orderId,
    orderLineId,
    draftOrderIds: own
      .filter((row) => row.state === 'draft')
      .map((row) => row.id)
      .sort(),
    submittedOrderId: own.find((row) => row.state === 'submitted')?.id,
    confirmedOrderId: own.find((row) => row.state === 'confirmed')?.id,
  }
  // The shop's own receipt: `receipts.get/document` answer 404 for anybody else's (RLS).
  ctx.linkedReceiptId = first(
    await tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.retailerId, retailerId)))
      .orderBy(desc(receipts.receivedAt), desc(receipts.id))
      .limit(1),
  )?.id
}

async function collectCatalog(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const listed = await tx
    .select({
      variantId: tenantProducts.variantId,
      localAlias: tenantProducts.localAlias,
      caseSizeOverride: tenantProducts.caseSizeOverride,
      minOrderQty: tenantProducts.minOrderQty,
      orderIncrement: tenantProducts.orderIncrement,
      maxPerOrder: tenantProducts.maxPerOrder,
      sortOrder: tenantProducts.sortOrder,
    })
    .from(tenantProducts)
    .where(and(eq(tenantProducts.tenantId, tenantId), eq(tenantProducts.listed, true)))
    .limit(2000)
  if (listed.length === 0) return
  const priced = new Set(
    (
      await tx
        .selectDistinct({ variantId: priceListItems.variantId })
        .from(priceListItems)
        .where(eq(priceListItems.tenantId, tenantId))
    ).map((row) => row.variantId),
  )
  const stocked = await tx
    .select({ variantId: stockLots.variantId })
    .from(stockBalances)
    .innerJoin(stockLots, eq(stockLots.id, stockBalances.lotId))
    .where(and(eq(stockBalances.tenantId, tenantId), gt(AVAILABLE, 0)))
    .orderBy(desc(AVAILABLE))
    .limit(500)

  const byVariant = new Map(listed.map((row) => [row.variantId, row]))
  const ranked: string[] = []
  const push = (variantId: string): void => {
    if (ranked.length < 2 && !ranked.includes(variantId)) ranked.push(variantId)
  }
  // Best example product: listed AND priced AND in stock — an order for it prices and reserves.
  for (const row of stocked) {
    if (byVariant.has(row.variantId) && priced.has(row.variantId)) push(row.variantId)
  }
  for (const row of listed) push(row.variantId)

  const [primary, second] = ranked
  if (!primary) return
  ctx.variantId = primary
  ctx.secondVariantId = second ?? primary

  const listing = byVariant.get(primary)
  if (listing) ctx.listing = { ...listing, variantId: primary }
  const increment = Math.max(1, listing?.orderIncrement ?? 1)
  const minimum = Math.max(increment, listing?.minOrderQty ?? increment)
  ctx.orderQty = Math.ceil(Math.max(minimum, 12) / increment) * increment

  const named = await tx
    .select({
      variantId: productVariants.id,
      variantName: productVariants.name,
      productId: products.id,
      productName: products.name,
      brandId: products.brandId,
      manufacturerId: products.manufacturerId,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, ranked))
  const head = named.find((row) => row.variantId === primary)
  if (head) {
    ctx.variantName = head.variantName
    ctx.productSearch = searchTerm(head.productName) ?? searchTerm(head.variantName)
    ctx.productId = head.productId
    ctx.brandId = head.brandId ?? undefined
    ctx.manufacturerId = head.manufacturerId
  }

  const cost = first(
    await tx
      .select({
        variantId: tenantProductCosts.variantId,
        supplierId: tenantProductCosts.supplierId,
        purchaseRatePaise: tenantProductCosts.purchaseRatePaise,
        landedCostPaise: tenantProductCosts.landedCostPaise,
        ptdPaise: tenantProductCosts.ptdPaise,
        schemeMarginBps: tenantProductCosts.schemeMarginBps,
      })
      .from(tenantProductCosts)
      .where(
        and(eq(tenantProductCosts.tenantId, tenantId), eq(tenantProductCosts.variantId, primary)),
      )
      .limit(1),
  )
  if (cost) ctx.cost = cost
}

async function collectStock(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const places = await tx
    .select({ id: locations.id, kind: locations.kind, vehicleId: locations.vehicleId })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.active, true)))
    .limit(50)
  ctx.locationId = (places.find((row) => row.kind === 'warehouse') ?? first(places))?.id
  const vehicle = places.find((row) => row.kind === 'vehicle')
  ctx.vehicleLocationId = vehicle?.id
  ctx.vehicleId = vehicle?.vehicleId ?? undefined

  const lot = first(
    await tx
      .select({
        lotId: stockBalances.lotId,
        locationId: stockBalances.locationId,
        available: AVAILABLE,
      })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), gt(AVAILABLE, 0)))
      .orderBy(desc(AVAILABLE))
      .limit(1),
  )
  if (lot) {
    ctx.lotId = lot.lotId
    ctx.lotLocationId = lot.locationId
    ctx.lotQty = lot.available
  }

  // A transfer refuses `from === to`, and goods do not move into the damaged bin by transfer. So the
  // destination is the first warehouse/vehicle that is NOT where the lot already sits — computed
  // rather than assumed, because "the vehicle" is the source itself once stock has been loaded.
  ctx.transferToLocationId = places.find(
    (row) => (row.kind === 'warehouse' || row.kind === 'vehicle') && row.id !== ctx.lotLocationId,
  )?.id

  // `lots.upsert` matches on the natural key (variant, batch, MRP) but the client supplies the row
  // id, so publishing a fixed id fails the moment that id names a lot of a DIFFERENT batch — which
  // is what happened once the demo variant moved. Naming the lot the natural key already resolves to
  // makes the example a true upsert: press Execute as often as you like, same row, 200 every time.
  ctx.docsLotId = ctx.variantId
    ? first(
        await tx
          .select({ id: stockLots.id })
          .from(stockLots)
          .where(
            and(
              eq(stockLots.tenantId, tenantId),
              eq(stockLots.variantId, ctx.variantId),
              eq(stockLots.batchNo, DOCS_BATCH_NO),
              eq(stockLots.mrpPaise, DOCS_BATCH_MRP_PAISE),
            ),
          )
          .limit(1),
      )?.id
    : undefined
}

/**
 * The inbound chain is a state machine, and each of its procedures is legal in exactly one state:
 * `matchLine` refuses a `received` or `cancelled` invoice (its lines are frozen), `grns.open` insists
 * on an `approved` one that does not already carry a live GRN, `grns.count` wants a GRN that is
 * `counting` or `reconciled`. Picking "the newest invoice" for all three published a document whose
 * procurement half was refused on sight — the newest seeded invoice is `received`, the end of the
 * chain. So each example gets the row ITS OWN guard accepts, and says so when nothing qualifies.
 */
async function collectProcurement(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const invoiceRows = await tx
    .select({
      id: supplierInvoices.id,
      supplierId: supplierInvoices.supplierId,
      status: supplierInvoices.status,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.tenantId, tenantId))
    .orderBy(desc(supplierInvoices.createdAt))
    .limit(200)
  const invoice = first(invoiceRows)
  ctx.supplierInvoiceId = invoice?.id
  ctx.supplierId =
    invoice?.supplierId ??
    first(
      await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.active, true)))
        .limit(1),
    )?.id

  // `packConfigs.upsert` matches on (supplier, variant) but the client supplies the row id, so a
  // fixed id fails the moment the demo variant moves and that id already names ANOTHER pair
  // (`supplier_pack_configs_pkey`, a 500 at the delivery gate on 2026-09-05). Name the row the natural
  // key already resolves to; only a pair this tenant has never configured gets a fresh slot.
  ctx.docsPackConfigId =
    ctx.supplierId && ctx.variantId
      ? first(
          await tx
            .select({ id: supplierPackConfigs.id })
            .from(supplierPackConfigs)
            .where(
              and(
                eq(supplierPackConfigs.tenantId, tenantId),
                eq(supplierPackConfigs.supplierId, ctx.supplierId),
                eq(supplierPackConfigs.variantId, ctx.variantId),
              ),
            )
            .limit(1),
        )?.id
      : undefined

  // --- matchLine: any invoice whose lines are still open, and one of its lines ------------------
  const matchable = invoiceRows.filter(
    (row) => row.status !== 'received' && row.status !== 'cancelled',
  )
  for (const candidate of matchable) {
    const line = first(
      await tx
        .select({ id: supplierInvoiceLines.id })
        .from(supplierInvoiceLines)
        .where(
          and(
            eq(supplierInvoiceLines.tenantId, tenantId),
            eq(supplierInvoiceLines.supplierInvoiceId, candidate.id),
          ),
        )
        .orderBy(asc(supplierInvoiceLines.lineNo))
        .limit(1),
    )
    if (line) {
      ctx.matchableInvoiceId = candidate.id
      ctx.matchableInvoiceLineId = line.id
      break
    }
  }
  ctx.supplierInvoiceLineId = ctx.matchableInvoiceLineId

  // --- grns.open: an approved invoice that no live GRN has claimed yet --------------------------
  const claimed = new Set(
    (
      await tx
        .select({ supplierInvoiceId: grns.supplierInvoiceId })
        .from(grns)
        .where(and(eq(grns.tenantId, tenantId), ne(grns.status, 'cancelled')))
    ).map((row) => row.supplierInvoiceId),
  )
  ctx.grnOpenInvoiceId = invoiceRows.find(
    (row) => row.status === 'approved' && !claimed.has(row.id),
  )?.id

  const grnRows = await tx
    .select({ id: grns.id, status: grns.status })
    .from(grns)
    .where(eq(grns.tenantId, tenantId))
    .orderBy(desc(grns.createdAt))
    .limit(200)
  // `count` needs 'counting' or 'reconciled'; `post` needs 'reconciled' and answers 200 for an
  // already 'posted' one, so a posted GRN is still a working `post` example. `get` takes anything.
  const countable = grnRows.find(
    (row) => row.status === 'counting' || row.status === 'reconciled',
  )?.id
  const postableRow =
    grnRows.find((row) => row.status === 'reconciled') ??
    grnRows.find((row) => row.status === 'posted')
  const postable = postableRow?.id
  ctx.countableGrnId = countable
  ctx.postableGrnId = postable
  ctx.postableGrnStatus = postableRow?.status
  const grn = grnRows.find((row) => row.id === (countable ?? postable)) ?? first(grnRows)
  ctx.grnId = grn?.id
  ctx.grnStatus = grn?.status
  if (countable) {
    ctx.grnLineId = first(
      await tx
        .select({ id: grnLines.id })
        .from(grnLines)
        .where(and(eq(grnLines.tenantId, tenantId), eq(grnLines.grnId, countable)))
        .limit(1),
    )?.id
  }

  ctx.purchaseOrderId = first(
    await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.tenantId, tenantId))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(1),
  )?.id
}

async function collectPricing(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const lists = await tx
    .select({ id: priceLists.id, isDefault: priceLists.isDefault })
    .from(priceLists)
    .where(eq(priceLists.tenantId, tenantId))
    .limit(20)
  ctx.priceListId = (lists.find((row) => row.isDefault) ?? first(lists))?.id
  const priceListId = ctx.priceListId
  if (priceListId) {
    ctx.priceListItem = first(
      await tx
        .select({
          id: priceListItems.id,
          variantId: priceListItems.variantId,
          ratePaise: priceListItems.ratePaise,
          inclusiveOfGst: priceListItems.inclusiveOfGst,
        })
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.tenantId, tenantId),
            eq(priceListItems.priceListId, priceListId),
            ...(ctx.variantId ? [eq(priceListItems.variantId, ctx.variantId)] : []),
          ),
        )
        .limit(1),
    )
  }

  const schemeRows = await tx
    .select({ id: schemes.id, active: schemes.active })
    .from(schemes)
    .where(eq(schemes.tenantId, tenantId))
    .limit(20)
  ctx.schemeId = (schemeRows.find((row) => row.active) ?? first(schemeRows))?.id

  const bargains = await tx
    .select({
      id: bargainRequests.id,
      status: bargainRequests.status,
      askedRatePaise: bargainRequests.askedRatePaise,
    })
    .from(bargainRequests)
    .where(eq(bargainRequests.tenantId, tenantId))
    .orderBy(desc(bargainRequests.createdAt))
    .limit(50)
  const bargain = bargains.find((row) => row.status === 'requested') ?? first(bargains)
  ctx.bargainRequestId = bargain?.id
  ctx.bargainStatus = bargain?.status
  ctx.bargainAskedRatePaise = bargain?.askedRatePaise
}

// ---------------------------------------------------------------------------------------------------------------
// ids for the rows an example CREATES

/**
 * How far the id sequence of a creating procedure is probed. One slot per service is spent every time
 * a document is rebuilt AND its example pressed, so 256 is weeks of demoing; the probe is one indexed
 * `id IN (…)` per procedure, once per process, so a generous window costs nothing.
 */
const SLOT_TRIES = 256

/**
 * One free slot is handed to each role (`ROLE_LANES`), plus a spare: the seven services can generate
 * their documents in the same second, and two of them publishing the same new id would put five
 * readers back on the 409 this whole mechanism exists to remove.
 */
const SLOT_LANES = 8

/** Ids of the candidates a table already holds. */
type TakenIds = (candidates: readonly string[]) => Promise<ReadonlySet<string>>

/**
 * The free slots of a procedure's id sequence — the ones this database does not hold yet.
 *
 * A create refuses a duplicate id (`order … already exists`), and it must: the id is the client's, and
 * silently returning somebody else's row would be worse. So the published example cannot be a single
 * fixed id — the first Execute takes it and every later reader is documented into a permanent 409.
 * Walking the sequence keeps the document deterministic (same database, same slots) and executable.
 */
async function freeSlots(procedurePath: string, trail: string, taken: TakenIds): Promise<number[]> {
  // One window at a time; a database that has spent a whole window (weeks of demoing and smoke runs)
  // moves on to the next one rather than publishing ids nobody probed.
  for (let window = 0; window < SLOT_WINDOWS; window++) {
    const base = window * SLOT_TRIES
    const candidates = Array.from({ length: SLOT_TRIES }, (_, i) =>
      createdId(procedurePath, trail, base + i),
    )
    const used = await taken(candidates)
    const free = candidates
      .map((id, i) => (used.has(id) ? -1 : base + i))
      .filter((slot) => slot >= 0)
      .slice(0, SLOT_LANES)
    if (free.length > 0) return free
  }
  return Array.from({ length: SLOT_LANES }, (_, i) => SLOT_WINDOWS * SLOT_TRIES + i)
}

/** How many windows of `SLOT_TRIES` are probed before giving up (4096 ids per procedure). */
const SLOT_WINDOWS = 16

async function collectFreshSlots(tx: Db, tenantId: string, ctx: ExampleContext): Promise<void> {
  const orders: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: salesOrders.id })
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), inArray(salesOrders.id, [...candidates])))
      ).map((row) => row.id),
    )
  const bargains: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: bargainRequests.id })
          .from(bargainRequests)
          .where(
            and(
              eq(bargainRequests.tenantId, tenantId),
              inArray(bargainRequests.id, [...candidates]),
            ),
          )
      ).map((row) => row.id),
    )
  // `setLines` writes the LINE, not the order: its row id sits at `lines[0].id`, and a line id is
  // unique across every order, so it needs a slot of its own.
  const orderLines: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: salesOrderLines.id })
          .from(salesOrderLines)
          .where(
            and(
              eq(salesOrderLines.tenantId, tenantId),
              inArray(salesOrderLines.id, [...candidates]),
            ),
          )
      ).map((row) => row.id),
    )
  const lots: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: stockLots.id })
          .from(stockLots)
          .where(and(eq(stockLots.tenantId, tenantId), inArray(stockLots.id, [...candidates])))
      ).map((row) => row.id),
    )
  // A GRN is opened once per invoice, so the example's row id is consumed as surely as the invoice is.
  const openGrns: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: grns.id })
          .from(grns)
          .where(and(eq(grns.tenantId, tenantId), inArray(grns.id, [...candidates])))
      ).map((row) => row.id),
    )
  // A new staff member is global, not per tenant: the id, the username and the phone are each unique
  // across the whole platform, so all three walk the slot together (see `staffCreateExample`).
  const staff: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, [...candidates]))
      ).map((row) => row.id),
    )
  // A write-off's id is the client's and the row is never replaced, so two desks pressing the same
  // example (owner, then manager) must not carry the same id: the second is a 409 by design.
  const writeOffIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: writeOffs.id })
          .from(writeOffs)
          .where(and(eq(writeOffs.tenantId, tenantId), inArray(writeOffs.id, [...candidates])))
      ).map((row) => row.id),
    )
  // The invoice id a parked pack is billed under is the client's too; the first press books it for
  // good (an issued bill is immutable), so the next document must offer the next free one.
  const invoiceIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, [...candidates])))
      ).map((row) => row.id),
    )
  const tripIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.tenantId, tenantId), inArray(trips.id, [...candidates])))
      ).map((row) => row.id),
    )
  const cycleCountIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: cycleCounts.id })
          .from(cycleCounts)
          .where(and(eq(cycleCounts.tenantId, tenantId), inArray(cycleCounts.id, [...candidates])))
      ).map((row) => row.id),
    )
  const packConfigIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: supplierPackConfigs.id })
          .from(supplierPackConfigs)
          .where(
            and(
              eq(supplierPackConfigs.tenantId, tenantId),
              inArray(supplierPackConfigs.id, [...candidates]),
            ),
          )
      ).map((row) => row.id),
    )
  const documentIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, [...candidates])))
      ).map((row) => row.id),
    )
  const sessionIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: reviewSessions.id })
          .from(reviewSessions)
          .where(
            and(eq(reviewSessions.tenantId, tenantId), inArray(reviewSessions.id, [...candidates])),
          )
      ).map((row) => row.id),
    )
  const supplierInvoiceIds: TakenIds = async (candidates) =>
    new Set(
      (
        await tx
          .select({ id: supplierInvoices.id })
          .from(supplierInvoices)
          .where(
            and(
              eq(supplierInvoices.tenantId, tenantId),
              inArray(supplierInvoices.id, [...candidates]),
            ),
          )
      ).map((row) => row.id),
    )
  ctx.slotLanes = {
    'tenantCatalog.packConfigs.upsert': await freeSlots(
      'tenantCatalog.packConfigs.upsert',
      'id',
      packConfigIds,
    ),
    'inventory.cycleCounts.open': await freeSlots(
      'inventory.cycleCounts.open',
      'id',
      cycleCountIds,
    ),
    'orders.create': await freeSlots('orders.create', 'id', orders),
    'orders.repeatLast': await freeSlots('orders.repeatLast', 'id', orders),
    'orders.setLines': await freeSlots('orders.setLines', 'lines[0].id', orderLines),
    'pricing.bargains.request': await freeSlots('pricing.bargains.request', 'id', bargains),
    'procurement.supplierInvoices.create': await supplierInvoiceSlots(tx, tenantId),
    'inventory.lots.upsert': await freeSlots('inventory.lots.upsert', 'id', lots),
    'tenancy.staff.create': await staffSlots(tx, staff),
    'procurement.grns.open': await freeSlots('procurement.grns.open', 'id', openGrns),
    'receivables.writeOffs.create': await freeSlots(
      'receivables.writeOffs.create',
      'id',
      writeOffIds,
    ),
    'delivery.trips.create': await freeSlots('delivery.trips.create', 'id', tripIds),
    'integrations.imports.create': await freeSlots(
      'integrations.imports.create',
      'id',
      async (candidates) =>
        new Set(
          (
            await tx
              .select({ id: importJobs.id })
              .from(importJobs)
              .where(
                and(eq(importJobs.tenantId, tenantId), inArray(importJobs.id, [...candidates])),
              )
          ).map((row) => row.id),
        ),
    ),
    'billing.invoices.issueForPack': await freeSlots(
      'billing.invoices.issueForPack',
      'id',
      invoiceIds,
    ),
    'docint.documents.create': await freeSlots('docint.documents.create', 'id', documentIds),
    'docint.review.start': await freeSlots('docint.review.start', 'sessionId', sessionIds),
    'docint.documents.approve': await freeSlots(
      'docint.documents.approve',
      'supplierInvoiceId',
      supplierInvoiceIds,
    ),
  }
}

/**
 * A staff slot must be free on the id AND on the username AND on the phone: those are three separate
 * unique indexes on a GLOBAL table, and `staff.create` refuses on whichever one it hits first.
 */
async function staffSlots(tx: Db, takenIds: TakenIds): Promise<number[]> {
  const path = 'tenancy.staff.create'
  const ids = Array.from({ length: SLOT_TRIES }, (_, slot) => createdId(path, 'userId', slot))
  const usedIds = await takenIds(ids)
  const usernames = Array.from({ length: SLOT_TRIES }, (_, slot) => docsStaffUsername(slot))
  const phones = Array.from({ length: SLOT_TRIES }, (_, slot) => docsStaffPhone(slot))
  const rows = await tx
    .select({ username: users.username, phone: users.phone })
    .from(users)
    .where(or(inArray(users.username, usernames), inArray(users.phone, phones)))
  const usedNames = new Set(rows.map((row) => row.username))
  const usedPhones = new Set(rows.map((row) => row.phone))
  const free: number[] = []
  for (let slot = 0; slot < SLOT_TRIES && free.length < SLOT_LANES; slot++) {
    if (
      !usedIds.has(ids[slot] ?? '') &&
      !usedNames.has(usernames[slot] ?? '') &&
      !usedPhones.has(phones[slot] ?? '')
    )
      free.push(slot)
  }
  return free.length > 0 ? free : Array.from({ length: SLOT_LANES }, (_, i) => SLOT_TRIES + i)
}

/** Username and phone of the docs staff member on `slot`; both unique platform-wide, so both walk. */
const docsStaffUsername = (slot: number) =>
  slot === 0 ? 'demo.docs.staff' : `demo.docs.staff${String(slot)}`
const docsStaffPhone = (slot: number) => `+9190000${String(101 + slot).padStart(5, '0')}`

/**
 * A supplier invoice needs a free row id AND a free document number: an invoice number may exist once
 * per supplier, which is the law rather than a bug, so both move together with the slot.
 */
async function supplierInvoiceSlots(tx: Db, tenantId: string): Promise<number[]> {
  const path = 'procurement.supplierInvoices.create'
  const ids = Array.from({ length: SLOT_TRIES }, (_, slot) => createdId(path, 'id', slot))
  const numbers = Array.from({ length: SLOT_TRIES }, (_, slot) => docsInvoiceNo(slot))
  const rows = await tx
    .select({ id: supplierInvoices.id, invoiceNo: supplierInvoices.invoiceNo })
    .from(supplierInvoices)
    .where(
      and(
        eq(supplierInvoices.tenantId, tenantId),
        or(inArray(supplierInvoices.id, ids), inArray(supplierInvoices.invoiceNo, numbers)),
      ),
    )
  const usedIds = new Set(rows.map((row) => row.id))
  const usedNumbers = new Set(rows.map((row) => row.invoiceNo))
  const free: number[] = []
  for (let slot = 0; slot < SLOT_TRIES && free.length < SLOT_LANES; slot++) {
    if (!usedIds.has(ids[slot] ?? '') && !usedNumbers.has(numbers[slot] ?? '')) free.push(slot)
  }
  return free.length > 0 ? free : Array.from({ length: SLOT_LANES }, (_, i) => SLOT_TRIES + i)
}

// ---------------------------------------------------------------------------------------------------------------
// filling the examples

/** Deterministic, well-formed UUIDv7-shaped id. The same procedure always shows the same id. */
export function docUuid(seed: string): string {
  const h = createHash('sha1').update(`dos-docs:${seed}`).digest('hex')
  return `01a0d0c5-${h.slice(0, 4)}-7${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`
}

/**
 * The client-generated id an example writes at `trail`, on slot `slot` of the procedure's sequence.
 * Slot 0 is what an untouched database shows, so a first-run document is unchanged by this.
 */
export function createdId(procedurePath: string, trail: string, slot = 0): string {
  return docUuid(slot === 0 ? `${procedurePath}#${trail}` : `${procedurePath}#${trail}#${slot}`)
}

/**
 * The idempotency key of that same slot. Key and id come from ONE seed on purpose: pressing Execute
 * twice sends an identical body, so `idempotent()` replays the stored reply instead of trying (and
 * refusing) a second insert of the same id.
 */
export function docsIdempotencyKey(procedurePath: string, slot = 0): string {
  return slot === 0 ? `docs-${procedurePath}` : `docs-${procedurePath}-${slot}`
}

/** The supplier document number booked on `slot`; unique per supplier, so it walks with the id. */
export function docsInvoiceNo(slot: number): string {
  return `DOCS/26-27/${String(slot + 1).padStart(4, '0')}`
}

const slotOf = (ctx: ExampleContext, procedurePath: string): number =>
  ctx.freshSlots?.[procedurePath] ?? 0

/**
 * One lane per role, in the order the roles were built. A service's lane is that of the most senior
 * role it serves, which is unique across the six business services (`owner`, `manager` + accountant,
 * `salesperson`, `warehouse`, `delivery`, `retailer`); auth shares the owner lane and serves none of
 * the creating procedures, so nothing collides there.
 */
const ROLE_LANES: readonly string[] = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'warehouse',
  'delivery',
  'retailer',
]

function serviceLane(options: BuildExamplesOptions): number {
  if (options.lane !== undefined) return options.lane
  const lanes = (options.roles ?? [])
    .map((role) => ROLE_LANES.indexOf(role))
    .filter((lane) => lane >= 0)
  return lanes.length === 0 ? 0 : Math.min(...lanes)
}

/**
 * Does this service serve anyone who may send back-office-only fields (tier, credit terms)? With no
 * roles at all — a document built outside a service — the full example is shown.
 */
function servesBackOffice(options: BuildExamplesOptions): boolean {
  const roles = options.roles
  return roles === undefined || roles.length === 0
    ? true
    : roles.some((role) => (BACK_OFFICE as readonly string[]).includes(role))
}

/** True only for the shopkeeper's own service: every example there stays inside the linked shop. */
function servesOnlyRetailer(options: BuildExamplesOptions): boolean {
  const roles = options.roles ?? []
  return roles.length > 0 && roles.every((role) => role === 'retailer')
}

/** Field name → the demo row it should show. Applied at every depth, arrays included. */
function byFieldName(key: string, ctx: ExampleContext): unknown {
  switch (key) {
    case 'tenantId':
      return ctx.tenantId
    case 'retailerId':
      return ctx.retailerId
    case 'beatId':
      return ctx.beatId
    case 'identityId':
      return ctx.identityId
    case 'variantId':
      return ctx.variantId
    case 'freeVariantId':
      return ctx.secondVariantId
    case 'productId':
      return ctx.productId
    case 'brandId':
      return ctx.brandId
    case 'manufacturerId':
      return ctx.manufacturerId
    case 'supplierId':
      return ctx.supplierId
    case 'supplierInvoiceId':
      return ctx.supplierInvoiceId
    case 'purchaseOrderId':
      return ctx.purchaseOrderId
    case 'grnId':
      return ctx.grnId
    case 'grnLineId':
      return ctx.grnLineId
    case 'priceListId':
      return ctx.priceListId
    case 'orderId':
      return ctx.orderId
    case 'invoiceId':
      return ctx.invoiceId
    case 'lotId':
      return ctx.lotId
    // `restockLocationId`: a cancelled bill's goods come back to the godown; the sampler's made-up
    // uuid is a 404 there.
    case 'locationId':
    case 'fulfilFromLocationId':
    case 'restockLocationId':
      return ctx.locationId
    case 'fromLocationId':
      return ctx.lotLocationId ?? ctx.locationId
    case 'toLocationId':
      return ctx.vehicleLocationId
    case 'vehicleId':
      return ctx.vehicleId
    case 'deviceId':
      return ctx.deviceId
    case 'salespersonId':
      return ctx.users?.salesperson?.id
    case 'userId':
      return ctx.users?.salesperson?.id ?? ctx.users?.owner?.id
    case 'approvalId':
      return ctx.approvalId
    case 'packId':
      return ctx.parkedPackId
    case 'extractionId':
      return ctx.docint?.matchExtractionId ?? ctx.docint?.extractionId
    case 'candidateId':
      return ctx.docint?.amberCandidateId
    default:
      return undefined
  }
}

/** `{id}` in a route always names an existing row of the resource the route is about. */
function pathIdFor(httpPath: string, ctx: ExampleContext): string | undefined {
  if (httpPath.startsWith('/retailers/')) return ctx.retailerId
  if (httpPath.startsWith('/beats/')) return ctx.beatId
  if (httpPath.startsWith('/orders/')) return ctx.orderId
  if (httpPath.startsWith('/approvals/')) return ctx.approvalId
  if (httpPath.startsWith('/pricing/bargains/')) return ctx.bargainRequestId
  if (httpPath.startsWith('/procurement/supplier-invoices/')) return ctx.supplierInvoiceId
  if (httpPath.startsWith('/procurement/grns/')) return ctx.grnId
  if (httpPath.startsWith('/procurement/discrepancies/')) return ctx.discrepancyId
  if (httpPath.startsWith('/receipts/')) return ctx.receiptId
  if (httpPath.startsWith('/allocations/')) return ctx.allocationId
  if (httpPath.startsWith('/invoices/')) return ctx.invoiceId
  if (httpPath.startsWith('/warehouse/challans/')) return ctx.challanId
  if (httpPath.startsWith('/warehouse/load-sheets/'))
    return ctx.approvableLoadSheetId ?? ctx.loadSheetId
  if (httpPath.startsWith('/inventory/cycle-counts/')) return ctx.cycleCountId
  if (httpPath.startsWith('/delivery/trips/')) return ctx.activeTripId ?? ctx.plannedTripId
  if (httpPath.startsWith('/delivery/stops/')) return ctx.tripStopId
  if (httpPath.startsWith('/delivery/deliveries/')) return ctx.deliveryId
  if (httpPath.startsWith('/docint/documents/')) return ctx.docint?.documentId
  if (httpPath.startsWith('/docint/extractions/'))
    return ctx.docint?.matchExtractionId ?? ctx.docint?.extractionId
  if (httpPath.startsWith('/docint/review-sessions/'))
    return Object.values(ctx.docint?.openSessions ?? {})[0]?.sessionId
  // The wizard's own job: every `{id}` under /integrations/imports/ is the import THIS document
  // creates, so the chain create → preview → map → dry run → review → commit → confirm reads as one story.
  if (httpPath.startsWith('/integrations/imports/')) return createdImportId(ctx)
  if (httpPath.startsWith('/integrations/exports/')) return ctx.integrations?.exportId
  return undefined
}

/** The import job the create example stages, on this service's lane. */
function createdImportId(ctx: ExampleContext): string {
  return createdId('integrations.imports.create', 'id', slotOf(ctx, 'integrations.imports.create'))
}

/** The built-in profile's mapping as data, for the map-columns example (the same guess the seed staged with). */
function builtinMapping(key: string): unknown {
  return BUILTIN_PROFILES.find((p) => p.key === key)?.mapping
}

/**
 * The review session the service's own sign-in holds: the seeded one (one per desk user), else the
 * session `review.start` opens on this lane a moment earlier in the same document. Never another
 * reviewer's — the lock is single-writer and a foreign session answers 403.
 */
function heldSessionFor(ctx: ExampleContext, options: BuildExamplesOptions): string | undefined {
  const user = signInUser(ctx, options)
  const held = user ? ctx.docint?.openSessions[user.id] : undefined
  return (
    held?.sessionId ??
    createdId('docint.review.start', 'sessionId', slotOf(ctx, 'docint.review.start'))
  )
}

/** One reviewable document per desk lane, so the owner's and the manager's `review.start` never race. */
function reviewableFor(ctx: ExampleContext, options: BuildExamplesOptions): string | undefined {
  const list = ctx.docint?.reviewable ?? []
  return list[serviceLane(options)] ?? list[0]
}

/** The document the capture examples create, on this service's lane. */
function capturedDocumentId(ctx: ExampleContext): string {
  return createdId('docint.documents.create', 'id', slotOf(ctx, 'docint.documents.create'))
}

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A GSTIN with a correct mod-36 check digit: the QR example must pass the checksum validators. */
function docsGstin(stateCode: string, panLike: string, entityCode = '1'): string {
  const base = `${stateCode}${panLike.toUpperCase()}${entityCode}Z`
  let total = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(base[i] ?? '0')
    const factor = i % 2 === 0 ? 1 : 2
    const product = value * factor
    total += Math.floor(product / 36) + (product % 36)
  }
  return `${base}${GSTIN_ALPHABET[(36 - (total % 36)) % 36] ?? '0'}`
}

/**
 * The page the capture example uploads: the 1×1 PNG with the document id appended after IEND (a
 * viewer ignores trailing bytes), so two captured documents never hash the same — the same bill
 * photographed twice is refused by design, and the example must not look like one.
 */
function docsPagePng(documentId: string): string {
  return Buffer.concat([Buffer.from(DOCS_PNG, 'base64'), Buffer.from(documentId, 'utf8')]).toString(
    'base64',
  )
}

/** The e-invoice QR the capture example carries: a bare JSON of the ten fields, valid GSTINs on both sides. */
function docsQrText(ctx: ExampleContext): string {
  const slot = slotOf(ctx, 'docint.documents.create')
  return JSON.stringify({
    SellerGstin: ctx.docint?.supplierGstin ?? docsGstin('27', 'AAPFU0939F'),
    BuyerGstin: docsGstin('27', 'AAETT9021Q'),
    DocNo: `DOCS/QR/${String(slot + 1).padStart(4, '0')}`,
    DocTyp: 'INV',
    DocDt: '01/09/2026',
    TotInvVal: 1344.0,
    ItemCnt: 1,
    MainHsnCode: '2106',
    Irn: createHash('sha256')
      .update(`docs-qr-${String(slot)}`)
      .digest('hex'),
    IrnDt: '2026-09-01 10:15:22',
  })
}

/** The demo user whose sign-in the auth examples show, chosen from the roles the service serves. */
/**
 * The staff member THIS service's document may safely reset or re-activate.
 *
 * Two rules have to hold at once, and each of them has bitten this example. The target may not be
 * the reader (nobody may change their own membership status), so it must not hold a role this
 * service signs people in as — a tenant with two owners leaves the second one looking like a spare.
 * And a MANAGER may only administer salesperson/warehouse/delivery members, so a junior role is the
 * only pick that works on the manager's document as well as the owner's.
 */
const JUNIOR_ROLES: readonly string[] = ['salesperson', 'warehouse', 'delivery']

function spareStaffFor(ctx: ExampleContext, options: BuildExamplesOptions): string | undefined {
  const served = new Set(options.roles ?? [])
  const safe = ctx.spareStaff?.find(
    (row) => JUNIOR_ROLES.includes(row.role) && !served.has(row.role),
  )
  return safe?.id ?? ctx.spareUserId ?? ctx.users?.salesperson?.id
}

function signInUser(ctx: ExampleContext, options: BuildExamplesOptions): DemoUser | undefined {
  const byRole = ctx.users ?? {}
  for (const role of options.roles ?? []) {
    const found = byRole[role]
    if (found?.username) return found
  }
  return byRole.owner?.username ? byRole.owner : Object.values(byRole).find((u) => u.username)
}

type OverrideMap = Record<string, unknown>

/**
 * `retailers.upsert` accepts these, but only owner/manager/accountant may send them (`setCredit` is
 * the back-office procedure); anyone else is refused 403 for carrying them at all.
 */
const CREDIT_ONLY_FIELDS = [
  'tier',
  'creditLimitPaise',
  'creditLimitBills',
  'creditDays',
  'creditMode',
] as const

/** Marks a whole group of optional fields as "leave out of this service's example". */
function dropped(fields: readonly string[]): OverrideMap {
  return Object.fromEntries(fields.map((field) => [field, DROP]))
}

/**
 * A supplier invoice the service will accept: its header total must equal the line totals plus
 * freight and round-off, so the numbers here are one consistent set rather than sampler defaults.
 */
function supplierInvoiceExample(ctx: ExampleContext): OverrideMap {
  const qtyPcs = 12
  const ratePaise = 1000
  const taxablePaise = qtyPcs * ratePaise
  const gstBps = 1200
  const taxPaise = (taxablePaise * gstBps) / 10_000
  const lineTotalPaise = taxablePaise + taxPaise
  return {
    // The next document number this tenant has not booked yet: an invoice number exists once per
    // supplier, so the same one twice is a correct refusal and would make the example a dead end.
    invoiceNo: docsInvoiceNo(slotOf(ctx, 'procurement.supplierInvoices.create')),
    invoiceDate: '2026-09-01',
    dueDate: '2026-09-30',
    irn: DROP, // a 64-hex IRN can only come from the government portal
    ackNo: DROP,
    ewayBillNo: DROP,
    documentId: DROP,
    purchaseOrderId: ctx.purchaseOrderId ?? DROP,
    source: 'manual',
    subtotalPaise: taxablePaise,
    discountPaise: 0,
    cgstPaise: taxPaise / 2,
    sgstPaise: taxPaise / 2,
    igstPaise: 0,
    cessPaise: 0,
    freightPaise: 0,
    roundOffPaise: 0,
    totalPaise: lineTotalPaise,
    'lines[0].lineNo': 1,
    'lines[0].description': ctx.variantName ?? 'One case of the product on the invoice',
    'lines[0].supplierCode': 'DOCS-SKU-1',
    'lines[0].batchNo': 'DOCS-B1',
    'lines[0].mfgDate': '2026-08-01',
    'lines[0].expiryDate': '2027-02-01',
    'lines[0].mrpPaise': 2000,
    'lines[0].printedQty': qtyPcs,
    'lines[0].printedUnit': 'pcs',
    'lines[0].qtyPcs': qtyPcs,
    'lines[0].freeQtyPcs': 0,
    'lines[0].ratePaise': ratePaise,
    'lines[0].discountBps': 0,
    'lines[0].discountPaise': 0,
    'lines[0].gstBps': gstBps,
    'lines[0].cessBps': 0,
    'lines[0].taxablePaise': taxablePaise,
    'lines[0].taxPaise': taxPaise,
    'lines[0].lineTotalPaise': lineTotalPaise,
  }
}

/**
 * Per-procedure values the field-name map cannot know: which of the three draft orders an example
 * points at, which fields must be a NEW row rather than an existing one, and the upserts that echo
 * the row back unchanged so pressing Execute does not quietly reprice the demo data.
 *
 * Keys are field trails (`lines[0].variantId`). A value of DROP removes the field (always an
 * optional one); `undefined` falls through to the field-name map and then to the sampler.
 */
const OVERRIDES: Record<
  string,
  (ctx: ExampleContext, options: BuildExamplesOptions) => OverrideMap
> = {
  'auth.login': (ctx, options) => ({
    username: signInUser(ctx, options)?.username,
    password: DEMO_PASSWORD,
    deviceId: ctx.deviceId,
    deviceName: 'Swagger UI',
    tenantId: ctx.tenantId,
  }),
  'auth.changePassword': () => ({
    currentPassword: DEMO_PASSWORD,
    newPassword: DEMO_PASSWORD,
  }),
  // A NEW person: reusing a seeded id, username or phone collides on three separate unique indexes,
  // so all three walk the free slot together — otherwise the first Execute takes the only person the
  // document ever offers and every later reader (and every other service) is answered 409.
  'tenancy.staff.create': (ctx) => {
    const slot = slotOf(ctx, 'tenancy.staff.create')
    return {
      userId: createdId('tenancy.staff.create', 'userId', slot),
      idempotencyKey: docsIdempotencyKey('tenancy.staff.create', slot),
      username: docsStaffUsername(slot),
      name: 'Demo Docs Staff',
      phone: docsStaffPhone(slot),
      role: 'salesperson',
      locale: 'en-IN',
      temporaryPassword: DEMO_PASSWORD,
    }
  },
  'tenancy.staff.setPassword': (ctx, options) => ({
    userId: spareStaffFor(ctx, options),
    temporaryPassword: DEMO_PASSWORD,
  }),
  'tenancy.staff.setStatus': (ctx, options) => ({
    userId: spareStaffFor(ctx, options),
    status: 'active',
  }),
  'catalog.propose': () => ({
    // Both ids are the client-generated ids of the rows this call creates, not existing rows.
    productId: docUuid('catalog.propose#productId'),
    variantId: docUuid('catalog.propose#variantId'),
    productName: 'Demo Proposed Namkeen',
    productNameHi: 'डेमो नमकीन',
    variantName: 'Demo Proposed Namkeen 50 g',
    category: 'namkeen',
    netQty: 50,
    netUnit: 'g',
    defaultCaseSize: 24,
  }),
  'tenantCatalog.upsertListing': (ctx) => ({
    // Echoes the listing back unchanged, so the example is a no-op on the demo catalogue.
    id: ctx.listing ? undefined : docUuid('tenantCatalog.upsertListing#id'),
    variantId: ctx.listing?.variantId,
    listed: true,
    localAlias: ctx.listing?.localAlias ?? DROP,
    caseSizeOverride: ctx.listing?.caseSizeOverride ?? DROP,
    minOrderQty: ctx.listing?.minOrderQty,
    orderIncrement: ctx.listing?.orderIncrement,
    maxPerOrder: ctx.listing?.maxPerOrder ?? DROP,
    sortOrder: ctx.listing?.sortOrder,
  }),
  'tenantCatalog.upsertSupplier': () => ({
    name: 'Demo Supplier (docs)',
    manufacturerId: DROP,
  }),
  'tenantCatalog.upsertCost': (ctx) => ({
    // Echoes the current cost back, so the example does not move a real margin.
    variantId: ctx.cost?.variantId,
    supplierId: ctx.cost?.supplierId ?? ctx.supplierId,
    purchaseRatePaise: ctx.cost?.purchaseRatePaise,
    landedCostPaise: ctx.cost?.landedCostPaise,
    ptdPaise: ctx.cost?.ptdPaise ?? DROP,
    schemeMarginBps: ctx.cost?.schemeMarginBps ?? DROP,
  }),
  'retailers.get': (ctx) => ({ id: ctx.retailerId }),
  'retailers.upsert': (ctx, options) => ({
    name: 'Demo Kirana Store (docs)',
    ownerName: 'Demo Shopkeeper',
    gstRegType: 'regular',
    beatId: ctx.beatId,
    address: {
      line1: '12 Station Road',
      line2: 'Shop 3, Ganesh Building',
      landmark: 'Opposite the bus depot',
      area: 'Kalyan West',
      city: 'Kalyan',
      pincode: '421301',
    },
    // A rep, packer or driver onboards the shop but may not price its credit: the handler refuses the
    // whole call if any of these is present, so this service's document must not offer them.
    ...(servesBackOffice(options) ? {} : dropped(CREDIT_ONLY_FIELDS)),
  }),
  'retailers.setCredit': (ctx) => ({ id: ctx.retailerId }),
  'retailers.linkIdentity': (ctx) => ({
    id: ctx.retailerId,
    phone: ctx.retailerPhone,
    shopName: ctx.retailerName,
  }),
  'retailers.beats.upsert': () => ({ name: 'Demo Beat (docs)', area: 'Kalyan West' }),
  'retailers.beats.assign': (ctx) => ({ id: ctx.beatId, userId: ctx.users?.salesperson?.id }),
  'retailers.visits.record': (ctx) => ({ retailerId: ctx.retailerId, beatId: ctx.beatId }),
  'sync.upload': (ctx) => ({
    deviceId: ctx.deviceId,
    'ops[0].opId': 'docs-sync-op-1',
    'ops[0].op': 'PUT',
    'ops[0].table': 'sales_orders',
    'ops[0].data': {
      retailer_id: ctx.retailerId,
      source: 'salesperson',
      note: 'Draft uploaded from the API docs',
    },
    'ops[0].clientTime': '2026-09-04T10:30:00.000Z',
  }),
  'pricing.priceLists.upsert': () => ({ name: 'Demo Price List (docs)', isDefault: false }),
  'pricing.priceLists.setItems': (ctx) => ({
    // Echoes the existing row: same list, same variant, same rate.
    'items[0].id': ctx.priceListItem?.id ?? docUuid('pricing.priceLists.setItems#items[0].id'),
    'items[0].variantId': ctx.priceListItem?.variantId,
    'items[0].ratePaise': ctx.priceListItem?.ratePaise,
    'items[0].inclusiveOfGst': ctx.priceListItem?.inclusiveOfGst,
  }),
  'pricing.overrides.upsert': (ctx) => ({
    ratePaise: ctx.priceListItem?.ratePaise,
    final: false,
    note: 'Agreed with the shopkeeper',
  }),
  'pricing.schemes.upsert': (ctx) => ({
    name: 'Demo Scheme (docs) — 12+1 free',
    // Inactive and scoped to one product: creating it cannot change what the demo orders cost.
    active: false,
    scope: { variantIds: [ctx.variantId ?? docUuid('scheme-scope-variant')] },
    brandId: DROP,
    triggerKind: 'qty',
    triggerUnit: 'pcs',
    triggerMin: 12,
    rewardKind: 'free_qty',
    rewardValue: 1,
    freeVariantId: ctx.variantId,
    slabs: DROP,
    sourceRef: DROP,
    validFrom: '2026-09-01',
    validTo: '2026-09-30',
  }),
  'pricing.quote': (ctx) => ({
    retailerId: ctx.retailerId,
    orderId: DROP, // quoting a hypothetical basket needs no order
  }),
  'pricing.bargains.request': (ctx) => ({
    retailerId: ctx.retailerId,
    variantId: ctx.variantId,
    orderId: DROP,
    askedRatePaise: Math.max(1, Math.round((ctx.priceListItem?.ratePaise ?? 1000) * 0.95)),
  }),
  // The ceiling is the LIST rate of the bargain's own variant, not of whatever variant the price-list
  // example happens to show: approving at the rate that was actually asked is always within it.
  'pricing.bargains.decide': (ctx) => ({
    id: ctx.bargainRequestId,
    decision: 'approve',
    approvedRatePaise:
      ctx.bargainAskedRatePaise ??
      Math.max(1, Math.round((ctx.priceListItem?.ratePaise ?? 1000) * 0.95)),
  }),
  'pricing.bounds.set': (ctx) => ({ userId: ctx.users?.salesperson?.id, brandId: DROP }),
  'inventory.locations.upsert': () => ({
    kind: 'warehouse',
    name: 'Demo Godown (docs)',
    vehicleId: DROP, // a warehouse has no vehicle
  }),
  // An upsert on an EXISTING natural key must send that row's own id, or the create path trips over
  // `stock_lots_pkey`; only a batch this tenant has never received gets a fresh slot.
  'inventory.lots.upsert': (ctx) => ({
    id:
      ctx.docsLotId ??
      createdId('inventory.lots.upsert', 'id', slotOf(ctx, 'inventory.lots.upsert')),
    idempotencyKey: ctx.docsLotId
      ? 'docs-inventory.lots.upsert'
      : docsIdempotencyKey('inventory.lots.upsert', slotOf(ctx, 'inventory.lots.upsert')),
    variantId: ctx.variantId,
    batchNo: DOCS_BATCH_NO,
    mrpPaise: DOCS_BATCH_MRP_PAISE,
  }),
  'inventory.stock.adjust': (ctx) => ({
    lotId: ctx.lotId,
    locationId: ctx.lotLocationId ?? ctx.locationId,
    qtyDelta: 1, // a positive delta is always legal; a negative one could go below zero
  }),
  'inventory.stock.transfer': (ctx) => ({
    lotId: ctx.lotId,
    fromLocationId: ctx.lotLocationId ?? ctx.locationId,
    // Not `?? ctx.locationId`: that is where the lot already sits, and a transfer to itself is refused.
    toLocationId: ctx.transferToLocationId ?? ctx.vehicleLocationId,
    qtyPcs: Math.max(1, Math.min(ctx.lotQty ?? 1, 12)),
  }),
  'procurement.supplierInvoices.create': supplierInvoiceExample,
  'procurement.supplierInvoices.get': (ctx) => ({ id: ctx.supplierInvoiceId }),
  // The lines of a `received` invoice are frozen, so this must name one still under review.
  'procurement.supplierInvoices.matchLine': (ctx) => ({
    id: ctx.matchableInvoiceId ?? ctx.supplierInvoiceId,
    lineId: ctx.matchableInvoiceLineId ?? ctx.supplierInvoiceLineId,
    variantId: ctx.variantId,
  }),
  // Only an `approved` invoice with no live GRN opens one; `locationId` must not be the damaged bin.
  // The GRN's own id walks the free slot: one invoice takes one GRN, so the id is spent with it.
  'procurement.grns.open': (ctx) => {
    const slot = slotOf(ctx, 'procurement.grns.open')
    return {
      id: createdId('procurement.grns.open', 'id', slot),
      idempotencyKey: docsIdempotencyKey('procurement.grns.open', slot),
      supplierInvoiceId: ctx.grnOpenInvoiceId ?? ctx.supplierInvoiceId,
      locationId: ctx.locationId,
    }
  },
  'procurement.grns.count': (ctx) => ({
    id: ctx.countableGrnId ?? ctx.grnId,
    'lines[0].grnLineId': ctx.grnLineId,
    'lines[0].damagedQtyPcs': 0,
  }),
  'procurement.grns.post': (ctx) => ({ id: ctx.postableGrnId ?? ctx.grnId }),
  'procurement.grns.get': (ctx) => ({ id: ctx.grnId }),
  'procurement.purchaseOrders.upsert': (ctx) => ({ supplierId: ctx.supplierId, status: 'draft' }),
  // A shopkeeper's own order must say it came from the retailer app; staff may not use that source.
  'orders.create': (ctx, options) => ({
    retailerId: ctx.retailerId,
    source: orderSource(options),
  }),
  'orders.repeatLast': (ctx, options) => ({
    retailerId: ctx.retailerId,
    source: orderSource(options),
  }),
  'orders.setLines': (ctx) => ({ id: draftOrder(ctx, 0) }),
  'orders.submit': (ctx) => ({ id: draftOrder(ctx, 1) }),
  'orders.confirm': (ctx) => ({ id: ctx.submittedOrderId ?? ctx.orderId }),
  'orders.cancel': (ctx) => ({
    id: draftOrder(ctx, 2), // a draft is always cancellable; a delivered order is not
    reason: 'Shop asked to cancel before dispatch',
  }),
  'orders.get': (ctx) => ({ id: ctx.orderId }),
  'orders.approvals.decide': (ctx) => ({
    id: ctx.approvalId,
    decision: 'approve',
    note: 'Approved from the API docs',
  }),
  // The two receivables inputs whose rules are CROSS-FIELD. The sampler fills every optional field it
  // can, and each `.refine()` then refuses the body it built; neither is a fault of the contract.
  // A receipt's `allocations` belong to `strategy: 'explicit'` alone — the documented example is the
  // ordinary FIFO one, so the split is dropped and the money finds the oldest due bill by itself.
  // --- platform gaps (docs/23 §8) ------------------------------------------------------------------
  'auth.forgotPassword': (ctx, options) => ({ username: signInUser(ctx, options)?.username }),
  // The token travels by SMS / WhatsApp and never appears on the wire; the example is the shape only.
  'auth.resetPassword': () => ({
    token: 'paste-the-token-from-the-reset-message-here',
    newPassword: DEMO_PASSWORD,
  }),
  'tenancy.staff.update': (ctx, options) => ({
    userId: spareStaffFor(ctx, options),
    name: 'Demo Docs Staff (edited)',
    phone: DROP,
    locale: 'en-IN',
  }),
  'tenancy.settings.get': () => ({ keys: ['branding.display_name', 'branding.invoice_footer'] }),
  // Echoes the demo values back, so pressing Execute changes nothing visible.
  'tenancy.settings.set': () => ({
    'items[0].key': 'branding.invoice_footer',
    'items[0].value': 'Goods once sold will not be taken back. Subject to Kalyan jurisdiction.',
  }),
  // A series nothing has issued from, so the upsert is legal on every database state.
  'tenancy.numbering.upsert': () => ({
    seriesCode: 'INV-B2C',
    prefix: 'B2C/',
    startingNo: 1,
    allocationMode: 'server',
    fy: DROP,
  }),
  'tenancy.numbering.list': () => ({ fy: DROP }),
  'tenancy.featureFlags.set': () => ({ 'items[0].flag': 'retailer_app', 'items[0].enabled': true }),
  'tenancy.tenant.update': (ctx) => ({
    legalName: 'Tarsun Enterprises',
    gstin: DROP,
    stateCode: '27',
    ...(ctx.tenantSlug ? {} : {}),
  }),
  'tenancy.audit.list': () => ({
    entityType: DROP,
    entityId: DROP,
    actorId: DROP,
    action: DROP,
    from: DROP,
    to: DROP,
  }),
  // The domain a service's own roles may upload to (files.ts table): the owner its logo, the desk an
  // import file, the godown a damage photo, the crew a proof of delivery.
  'files.uploadUrl': (ctx, options) => {
    const upload = uploadDomainFor(options)
    return {
      // One upload intent per domain: the same id under two domains is two keys, which is a 409.
      id: docUuid(`files.uploadUrl#id#${upload.domain}`),
      domain: upload.domain,
      entityId:
        upload.domain === 'logo' ? ctx.tenantId : docUuid(`files.uploadUrl#${upload.domain}`),
      mimeType: upload.mimeType,
      bytes: 20480,
    }
  },
  'files.readUrl': (ctx) => ({
    objectKey: `tenant/${ctx.tenantId ?? 'demo'}/logo/${ctx.tenantId ?? 'demo'}/${docUuid('files.uploadUrl#id#logo')}.png`,
  }),
  'tenantCatalog.repAuthorisations.list': (ctx) => ({ userId: ctx.users?.salesperson?.id ?? DROP }),
  'tenantCatalog.repAuthorisations.set': (ctx) => ({
    userId: ctx.users?.salesperson?.id,
    'items[0].id': docUuid('tenantCatalog.repAuthorisations.set#items[0].id'),
    'items[0].brandId': ctx.brandId,
    'items[0].employedBy': 'distributor',
  }),
  'tenantCatalog.brands.upsert': (ctx) => ({
    brandId: ctx.brandId,
    fulfilmentMode: 'own',
    tallyExportSource: 'dos',
    cashDiscountMode: 'at_receipt_financial_cn',
    claimChannel: 'dos',
    salesForce: 'distributor',
  }),
  // Same rule as `inventory.lots.upsert`: an upsert on an EXISTING natural key sends that row's own
  // id, or the create path trips over `supplier_pack_configs_pkey`.
  'tenantCatalog.packConfigs.upsert': (ctx) => ({
    id:
      ctx.docsPackConfigId ??
      createdId(
        'tenantCatalog.packConfigs.upsert',
        'id',
        slotOf(ctx, 'tenantCatalog.packConfigs.upsert'),
      ),
    idempotencyKey: ctx.docsPackConfigId
      ? 'docs-tenantCatalog.packConfigs.upsert'
      : docsIdempotencyKey(
          'tenantCatalog.packConfigs.upsert',
          slotOf(ctx, 'tenantCatalog.packConfigs.upsert'),
        ),
    supplierId: ctx.supplierId,
    variantId: ctx.variantId,
    pcsPerCase: 24,
    supplierCode: 'DOCS-PACK-24',
    supplierDescription: DROP,
    marginBasis: 'ptd',
  }),
  'retailers.updateOwn': (ctx) => ({
    id: ctx.retailerId,
    ownerName: 'Demo Shopkeeper',
    altPhone: DROP,
    address: DROP,
    gstin: DROP,
    gstRegType: DROP,
  }),
  'retailers.beats.assignments.list': (ctx) => ({
    beatId: DROP,
    userId: ctx.users?.salesperson?.id ?? DROP,
    on: DROP,
  }),
  'sync.errors.list': () => ({ deviceId: DROP, since: DROP }),
  'sync.pull': (ctx) => ({ deviceId: ctx.deviceId, since: DROP, tables: DROP }),
  'pricing.bounds.list': (ctx) => ({ userId: ctx.users?.salesperson?.id ?? DROP }),
  'inventory.cycleCounts.open': (ctx) => ({
    id: createdId('inventory.cycleCounts.open', 'id', slotOf(ctx, 'inventory.cycleCounts.open')),
    idempotencyKey: docsIdempotencyKey(
      'inventory.cycleCounts.open',
      slotOf(ctx, 'inventory.cycleCounts.open'),
    ),
    locationId: ctx.lotLocationId ?? ctx.locationId,
    lotIds: ctx.lotId ? [ctx.lotId] : DROP,
    note: 'Opened from the API docs',
  }),
  'inventory.cycleCounts.count': (ctx) => ({
    id: ctx.cycleCountId,
    'lines[0].lotId': ctx.cycleCountLotId ?? ctx.lotId,
    'lines[0].countedPcs': ctx.lotQty ?? 12,
  }),
  'inventory.cycleCounts.post': (ctx) => ({ id: ctx.cycleCountId }),
  'inventory.cycleCounts.get': (ctx) => ({ id: ctx.cycleCountId }),
  'inventory.cycleCounts.list': () => ({ locationId: DROP, status: DROP }),
  'inventory.stock.balances': () => ({ expiringBefore: DROP, nearExpiryOnly: DROP }),
  'procurement.discrepancies.resolve': (ctx) => ({
    id: ctx.discrepancyId,
    status: 'accepted',
    note: 'Accepted from the API docs',
  }),
  'procurement.supplierInvoices.dispute': (ctx) => ({
    id: ctx.disputableInvoiceId ?? ctx.supplierInvoiceId,
    reason: 'Rate on the bill differs from the agreed rate',
  }),
  'procurement.supplierInvoices.cancel': (ctx) => ({
    id: ctx.disputableInvoiceId ?? ctx.supplierInvoiceId,
    reason: 'Duplicate of an earlier bill',
  }),
  'receivables.receipts.document': (ctx) => ({ id: ctx.receiptId, format: 'a5' }),
  'receivables.ageing.history': () => ({
    from: '2026-08-01',
    to: '2026-09-30',
    grain: 'week',
    beatId: DROP,
    retailerId: DROP,
  }),
  'billing.invoices.issueForPack': (ctx) => ({
    packId: ctx.parkedPackId,
    invoiceDate: DROP,
    deviceId: DROP,
  }),
  'warehouse.loadSheets.approve': (ctx) => ({
    id: ctx.approvableLoadSheetId ?? ctx.loadSheetId,
    note: 'Approved from the API docs',
    deviceId: DROP,
  }),
  'warehouse.challans.pdf': (ctx) => ({ id: ctx.challanId, copy: 'original', format: 'a4' }),
  // --- the road (delivery) -------------------------------------------------------------------------
  // Every trip below is one the demo delivery user is crew on. The active trip is TODAY's real one:
  // a doorstep write on it is what the crew would do at the shop door, so the examples record the one
  // open stop's bill, take a rupee, sell a piece off the van and post two breadcrumbs — all replayable.
  'delivery.vehicles.upsert': (ctx) => ({
    id: ctx.vehicleId,
    regNo: ctx.vehicleRegNo,
    name: DROP,
    kind: 'tempo',
    capacityCases: DROP,
    active: true,
  }),
  'delivery.vehicles.positions': () => ({ vehicleId: DROP, staleAfterMinutes: 30 }),
  'delivery.consents.grant': () => ({
    id: createdId('delivery.consents.grant', 'id'),
    granted: true,
    noticeVersion: 'gps-notice-2026-09',
    locale: 'en-IN',
    deviceId: DROP,
  }),
  'delivery.consents.get': () => ({ userId: DROP }),
  'delivery.trips.create': (ctx) => ({
    id: createdId('delivery.trips.create', 'id', slotOf(ctx, 'delivery.trips.create')),
    idempotencyKey: docsIdempotencyKey(
      'delivery.trips.create',
      slotOf(ctx, 'delivery.trips.create'),
    ),
    // a driver is on one trip a day: each fresh slot plans a day further out
    tripDate: addDaysIso('2026-09-20', slotOf(ctx, 'delivery.trips.create')),
    vehicleId: ctx.vehicleId,
    driverId: ctx.crewDriverId,
    helperId: ctx.crewHelperId ?? DROP,
    vanSalesEnabled: true,
    openingCashPaise: 200_000,
    stops: ctx.retailerId
      ? [
          {
            id: createdId(
              'delivery.trips.create',
              'stops[0].id',
              slotOf(ctx, 'delivery.trips.create'),
            ),
            sequence: 1,
            retailerId: ctx.retailerId,
            invoiceIds: [],
          },
        ]
      : [],
    deviceId: DROP,
  }),
  'delivery.trips.list': () => ({
    state: DROP,
    states: DROP,
    vehicleId: DROP,
    driverId: DROP,
    from: DROP,
    to: DROP,
    mine: DROP,
  }),
  'delivery.trips.get': (ctx) => ({ id: ctx.activeTripId ?? ctx.plannedTripId }),
  'delivery.trips.startLoading': (ctx) => ({
    id: ctx.plannedTripId ?? ctx.activeTripId,
    deviceId: DROP,
  }),
  'delivery.trips.depart': (ctx) => ({
    id: ctx.plannedTripId ?? ctx.activeTripId,
    startOdometerKm: 41_200,
    openingCashPaise: DROP,
    occurredAt: DROP,
    deviceId: DROP,
  }),
  'delivery.trips.return': (ctx) => ({
    id: ctx.activeTripId,
    endOdometerKm: 41_260,
    occurredAt: DROP,
    deviceId: DROP,
  }),
  'delivery.trips.cancel': (ctx) => ({
    id: ctx.plannedTripId ?? ctx.activeTripId,
    reason: 'Vehicle in the workshop today',
  }),
  'delivery.trips.settlementPreview': (ctx) => ({ id: ctx.activeTripId }),
  'delivery.trips.settle': (ctx) => ({
    id: createdId('delivery.trips.settle', 'id'),
    tripId: ctx.activeTripId,
    handedOverCashPaise: 200_000,
    counted: [],
    note: 'Counted with the crew at the depot',
    acceptVariance: false,
  }),
  'delivery.stops.list': () => ({ tripId: DROP, retailerId: DROP, state: DROP, date: DROP }),
  'delivery.stops.next': (ctx) => ({ id: ctx.activeTripId ?? ctx.plannedTripId }),
  'delivery.stops.add': (ctx) => ({
    id: ctx.plannedTripId ?? ctx.activeTripId,
    'stop.id': createdId('delivery.stops.add', 'stop.id'),
    'stop.sequence': DROP,
    'stop.retailerId': ctx.retailerId,
    'stop.invoiceIds': [],
    'stop.plannedCollectionPaise': DROP,
    'stop.etaAt': DROP,
    deviceId: DROP,
  }),
  'delivery.stops.reorder': (ctx) => ({
    id: ctx.plannedTripId ?? ctx.activeTripId,
    'order[0].stopId': ctx.plannedTripStopId ?? ctx.tripStopId,
    'order[0].sequence': ctx.plannedTripStopSequence ?? 1,
    deviceId: DROP,
  }),
  'delivery.stops.start': (ctx) => ({ id: ctx.tripStopId, occurredAt: DROP, deviceId: DROP }),
  'delivery.stops.arrive': (ctx) => ({
    id: ctx.tripStopId,
    lat: 19.2437,
    lng: 73.1355,
    accuracyM: 8,
    occurredAt: DROP,
    deviceId: DROP,
  }),
  'delivery.stops.fail': (ctx) => ({
    id: ctx.tripStopId,
    failureReason: 'shop_closed',
    failureNote: DROP,
    occurredAt: DROP,
    deviceId: DROP,
  }),
  'delivery.deliveries.record': (ctx) => ({
    id: ctx.plannedDeliveryId ?? createdId('delivery.deliveries.record', 'id'),
    tripId: ctx.activeTripId,
    stopId: ctx.tripStopId,
    invoiceId: ctx.plannedDeliveryInvoiceId ?? ctx.invoiceId,
    receiverName: 'Shop owner',
    note: DROP,
    deliveredAt: DROP,
    deviceId: DROP,
    // with no demo data the shape still has to parse: one made-up line the sampler would refuse
    lines: (
      ctx.plannedDeliveryLines ?? [
        { id: createdId('delivery.deliveries.record', 'lines[0].invoiceLineId'), qtyPcs: 12 },
      ]
    ).map((line, i) => ({
      id: createdId('delivery.deliveries.record', `lines[${String(i)}].id`),
      invoiceLineId: line.id,
      deliveredQtyPcs: line.qtyPcs,
      returnedQtyPcs: 0,
      returnedSaleable: true,
    })),
    pod: [
      {
        id: createdId('delivery.deliveries.record', 'pod[0].id'),
        kind: 'signature',
        inline: { mimeType: 'image/png', contentBase64: DOCS_PNG },
      },
    ],
  }),
  'delivery.deliveries.addPod': (ctx, options) => ({
    id: (options.roles ?? []).includes('retailer') ? ctx.linkedDeliveryId : ctx.deliveryId,
    'evidence.id': createdId('delivery.deliveries.addPod', 'evidence.id'),
    'evidence.kind': 'geo',
    'evidence.objectKey': DROP,
    'evidence.inline': DROP,
    'evidence.payload': { distanceM: 40 },
    'evidence.lat': 19.2437,
    'evidence.lng': 73.1355,
    'evidence.capturedAt': DROP,
  }),
  'delivery.deliveries.list': () => ({
    tripId: DROP,
    stopId: DROP,
    invoiceId: DROP,
    retailerId: DROP,
    outcome: DROP,
    from: DROP,
    to: DROP,
  }),
  'delivery.deliveries.get': (ctx, options) => ({
    id: (options.roles ?? []).includes('retailer') ? ctx.linkedDeliveryId : ctx.deliveryId,
  }),
  'delivery.collections.record': (ctx) => ({
    id: createdId('delivery.collections.record', 'id'),
    receiptId: createdId('delivery.collections.record', 'receiptId'),
    tripId: ctx.activeTripId,
    stopId: ctx.tripStopId ?? DROP,
    retailerId: ctx.tripStopRetailerId ?? ctx.retailerId,
    mode: 'cash',
    amountPaise: 100,
    reference: DROP,
    upiVpa: DROP,
    chequeDate: DROP,
    bankName: DROP,
    proofObjectKey: DROP,
    allocations: DROP,
    clientReceiptNo: DROP,
    collectedAt: DROP,
    note: 'One rupee on account, from the API docs',
    deviceId: DROP,
  }),
  'delivery.collections.list': () => ({
    tripId: DROP,
    retailerId: DROP,
    mode: DROP,
    from: DROP,
    to: DROP,
  }),
  'delivery.vanSales.create': (ctx) => ({
    id: createdId('delivery.vanSales.create', 'id'),
    tripId: ctx.activeTripId,
    stopId: DROP,
    retailerId: ctx.tripStopRetailerId ?? ctx.retailerId,
    invoiceId: createdId('delivery.vanSales.create', 'invoiceId'),
    deliveryId: createdId('delivery.vanSales.create', 'deliveryId'),
    invoiceDate: DROP,
    'lines[0].id': createdId('delivery.vanSales.create', 'lines[0].id'),
    'lines[0].variantId': ctx.vanVariantId ?? ctx.variantId,
    'lines[0].enteredQty': 1,
    'lines[0].enteredUnit': 'piece',
    collect: DROP,
    note: DROP,
    deviceId: DROP,
  }),
  'delivery.expenses.record': (ctx) => ({
    id: createdId('delivery.expenses.record', 'id'),
    tripId: ctx.activeTripId,
    kind: 'diesel',
    amountPaise: 100,
    inline: DROP,
    proofObjectKey: DROP,
    note: 'Diesel at the Kalyan bypass pump',
    incurredAt: DROP,
    deviceId: DROP,
  }),
  'delivery.expenses.list': () => ({ tripId: DROP, kind: DROP, from: DROP, to: DROP }),
  'delivery.gps.points': (ctx) => ({
    tripId: ctx.activeTripId,
    deviceId: ctx.deviceId,
    'points[0].recordedAt': '2026-09-04T10:30:00.000Z',
    'points[0].accuracyM': 8,
    'points[0].speedMps': 4,
    'points[0].heading': 90,
    'points[0].battery': 80,
  }),
  'delivery.gps.trace': (ctx) => ({
    id: ctx.activeTripId,
    deviceId: DROP,
    everyNth: 5,
    limit: 500,
    cursor: DROP,
  }),
  // docint: the capture chain creates ONE document per service lane and walks it — slots, a page
  // (inline bytes), the QR, submit — under keys that move with the create slot, so the five calls
  // stay one consistent story and replay together.
  'docint.documents.create': (ctx) => ({
    id: capturedDocumentId(ctx),
    kind: 'supplier_invoice',
    supplierId: ctx.supplierId,
    expectedPages: 1,
    capturedAt: DROP,
    note: 'Captured from the API docs',
    deviceId: DROP,
  }),
  'docint.documents.pageUploadUrl': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'docint.documents.pageUploadUrl',
      slotOf(ctx, 'docint.documents.create'),
    ),
    id: capturedDocumentId(ctx),
    'pages[0].pageNo': 1,
    'pages[0].mimeType': 'image/png',
    'pages[0].bytes': 70,
  }),
  'docint.documents.addPage': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'docint.documents.addPage',
      slotOf(ctx, 'docint.documents.create'),
    ),
    id: capturedDocumentId(ctx),
    pageId: createdId('docint.documents.addPage', 'pageId', slotOf(ctx, 'docint.documents.create')),
    pageNo: 1,
    mimeType: 'image/png',
    bytes: DROP,
    width: DROP,
    height: DROP,
    objectKey: `tenant/${ctx.tenantId ?? 'tenant'}/docs/${capturedDocumentId(ctx)}/page-1.png`,
    contentBase64: docsPagePng(capturedDocumentId(ctx)),
    printedPageLabel: '1 of 1',
    qrDetected: true,
  }),
  'docint.documents.verifyQr': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'docint.documents.verifyQr',
      slotOf(ctx, 'docint.documents.create'),
    ),
    id: capturedDocumentId(ctx),
    qrText: docsQrText(ctx),
  }),
  'docint.documents.submit': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'docint.documents.submit',
      slotOf(ctx, 'docint.documents.create'),
    ),
    id: capturedDocumentId(ctx),
    deviceId: DROP,
  }),
  'docint.documents.list': () => ({
    kind: DROP,
    status: DROP,
    statuses: DROP,
    supplierId: DROP,
    uploadedBy: DROP,
    mine: DROP,
    from: DROP,
    to: DROP,
  }),
  'docint.documents.pageUrl': (ctx) => ({ id: ctx.docint?.documentId, pageNo: 1 }),
  'docint.documents.reject': (ctx) => ({
    id: ctx.docint?.rejectable ?? ctx.docint?.documentId,
    reason: 'duplicate',
    note: 'the same bill was photographed twice',
  }),
  'docint.documents.approve': (ctx) => {
    const slot = slotOf(ctx, 'docint.documents.approve')
    const lineNos = ctx.docint?.approvable?.lineNos ?? [1]
    return {
      idempotencyKey: docsIdempotencyKey('docint.documents.approve', slot),
      id: ctx.docint?.approvable?.documentId ?? ctx.docint?.documentId,
      supplierInvoiceId: createdId('docint.documents.approve', 'supplierInvoiceId', slot),
      supplierId: DROP,
      purchaseOrderId: DROP,
      lineIds: lineNos.map((lineNo) => ({
        lineNo,
        id: createdId('docint.documents.approve', `lineIds[${String(lineNo - 1)}].id`, slot),
      })),
    }
  },
  'docint.extractions.run': (ctx) => ({
    id: ctx.docint?.rerunnable ?? ctx.docint?.documentId,
    engine: 'llm_vision',
    force: true,
  }),
  'docint.extractions.list': (ctx) => ({ id: ctx.docint?.documentId, includeResult: false }),
  'docint.extractions.get': (ctx) => ({ id: ctx.docint?.extractionId }),
  'docint.matches.list': (ctx) => ({
    extractionId: ctx.docint?.matchExtractionId,
    lineNo: DROP,
    unmatchedOnly: DROP,
  }),
  'docint.matches.accept': (ctx) => ({
    id: ctx.docint?.matchExtractionId,
    lineNo: ctx.docint?.amberLineNo ?? 1,
    candidateId: ctx.docint?.amberCandidateId,
    pcsPerCase: DROP,
    rememberAlias: true,
  }),
  'docint.matches.reject': (ctx) => ({
    id: ctx.docint?.matchExtractionId,
    lineNo: ctx.docint?.amberLineNo ?? 1,
    candidateId: ctx.docint?.amberCandidateId,
    reason: 'wrong_pack',
    note: DROP,
  }),
  'docint.matches.choose': (ctx) => ({
    id: ctx.docint?.matchExtractionId,
    lineNo: ctx.docint?.redLineNo ?? ctx.docint?.amberLineNo ?? 1,
    variantId: ctx.variantId,
    pcsPerCase: DROP,
    rememberAlias: true,
  }),
  'docint.matches.rerun': (ctx) => ({ id: ctx.docint?.matchExtractionId }),
  'docint.review.start': (ctx, options) => ({
    id: reviewableFor(ctx, options) ?? ctx.docint?.documentId,
    sessionId: createdId('docint.review.start', 'sessionId', slotOf(ctx, 'docint.review.start')),
    baseExtractionId: DROP,
  }),
  'docint.review.heartbeat': (ctx, options) => ({ id: heldSessionFor(ctx, options) }),
  'docint.review.save': (ctx, options) => ({
    id: heldSessionFor(ctx, options),
    'patch.header': DROP,
    'patch.lines': [{ lineNo: 1, batchNo: 'DOCS-B1' }],
    'patch.annotations': DROP,
  }),
  // Releases the session `review.start` opened on this lane (same slot, same id), so the desk can take
  // the document again; the seeded sessions the save/submit examples use are left alone.
  'docint.review.release': (ctx) => ({
    idempotencyKey: docsIdempotencyKey('docint.review.release', slotOf(ctx, 'docint.review.start')),
    id: createdId('docint.review.start', 'sessionId', slotOf(ctx, 'docint.review.start')),
  }),
  'docint.review.submit': (ctx, options) => ({ id: heldSessionFor(ctx, options) }),
  'docint.queue.list': () => ({ status: DROP, kind: DROP, supplierId: DROP }),
  'docint.stats.summary': () => ({
    from: '2026-08-01',
    to: '2026-12-31',
    supplierId: DROP,
    kind: DROP,
  }),
  // claims (contract landed ahead of module 7; no service mounts it yet): `evidence.attach` takes
  // EXACTLY ONE of `documentId` / `objectKey`, which the sampler cannot know. The file path is the
  // `files.uploadUrl` key of the claim (`domain: 'claim'`, entityId = the claim id in the path). The
  // claims slice replaces this with a real seeded claim when its module and demo data land.
  'claims.evidence.attach': (ctx) => {
    const claimId = docUuid('claims.evidence.attach#id')
    return {
      id: claimId,
      evidenceId: createdId('claims.evidence.attach', 'evidenceId'),
      documentId: DROP,
      objectKey: `tenant/${ctx.tenantId ?? 'tenant'}/claims/${claimId}/evidence-1.jpg`,
      kind: 'damage_photo',
      caption: 'Damaged carton at the door',
    }
  },
  // integrations: the wizard walks ONE import per service lane — the seeded TradeEzee party file is
  // staged again under a fresh job id, mapped, dry-run, its garbled row pinned to the shop it really is,
  // committed and confirmed — under keys that move with the create slot so the steps replay together.
  'integrations.imports.create': (ctx) => ({
    id: createdImportId(ctx),
    source: 'tradeezee',
    target: 'party_master',
    sourceObjectKey:
      ctx.integrations?.sourceObjectKey ??
      `tenant/${ctx.tenantId ?? 'tenant'}/import/${createdImportId(ctx)}/tradeezee-party-master.csv`,
    fileName: 'tradeezee-party-master-sept.csv',
    profileId: ctx.tenantId ? builtinProfileId(ctx.tenantId, 'tradeezee-party-master') : DROP,
    mapping: DROP,
    hasHeaderRow: DROP,
    sheetName: DROP,
  }),
  'integrations.imports.list': () => ({
    source: DROP,
    target: DROP,
    status: DROP,
    from: DROP,
    to: DROP,
  }),
  'integrations.imports.preview': () => ({ rows: 10 }),
  'integrations.imports.setMapping': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.setMapping',
      slotOf(ctx, 'integrations.imports.create'),
    ),
    mapping: builtinMapping('tradeezee-party-master'),
    saveAsProfile: DROP,
  }),
  'integrations.imports.dryRun': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.dryRun',
      slotOf(ctx, 'integrations.imports.create'),
    ),
  }),
  'integrations.imports.rows.list': () => ({ status: DROP, plan: DROP, problemsOnly: DROP }),
  'integrations.imports.rows.review': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.rows.review',
      slotOf(ctx, 'integrations.imports.create'),
    ),
    rowId: rowIdFor(createdImportId(ctx), ctx.integrations?.reviewRowNo ?? 9),
    retailerId: ctx.integrations?.reviewRetailerId ?? ctx.retailerId,
    variantId: DROP,
    values: ctx.integrations?.reviewPhone
      ? [{ field: 'phone', value: ctx.integrations.reviewPhone.replace(/^\+91/, '') }]
      : DROP,
    skip: DROP,
    rememberCode: true,
  }),
  'integrations.imports.commit': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.commit',
      slotOf(ctx, 'integrations.imports.create'),
    ),
    skipUnresolved: true,
  }),
  'integrations.imports.confirm': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.confirm',
      slotOf(ctx, 'integrations.imports.create'),
    ),
  }),
  'integrations.imports.rollback': (ctx) => ({
    idempotencyKey: docsIdempotencyKey(
      'integrations.imports.rollback',
      slotOf(ctx, 'integrations.imports.create'),
    ),
    reason: 'the file was last month’s; importing the right one',
  }),
  // Cancel abandons the SEEDED staged job (the wizard's own job is confirmed by then).
  'integrations.imports.cancel': (ctx) => ({
    id: ctx.integrations?.stagedJobId ?? createdImportId(ctx),
    reason: 'wrong file',
  }),
  'integrations.profiles.list': () => ({ source: DROP, target: DROP }),
  'integrations.profiles.upsert': () => ({
    id: docUuid('integrations.profiles.upsert#id'),
    name: 'Docs: TradeEzee parties',
    source: 'tradeezee',
    target: 'party_master',
    mapping: builtinMapping('tradeezee-party-master'),
    hasHeaderRow: true,
    sheetName: DROP,
  }),
  'integrations.exports.request': (ctx) => ({
    id: docUuid('integrations.exports.request#id'),
    kind: 'tally_xml',
    from: ctx.integrations?.exportFrom ?? '2026-08-01',
    to: ctx.integrations?.exportTo ?? '2026-08-31',
    voucherTypes: ['sales', 'receipts', 'purchases'],
    supplyType: DROP,
    retailerId: DROP,
    supplierId: DROP,
    invoiceIds: DROP,
    tallyCompanyName: DROP,
  }),
  'integrations.exports.list': () => ({ kind: DROP, status: DROP, from: DROP, to: DROP }),
  'integrations.tally.mappings.list': () => ({ entityType: DROP, q: DROP }),
  // The id follows the entity: the same item replays, another item gets a row of its own.
  'integrations.tally.mappings.upsert': (ctx) => ({
    id: docUuid(`integrations.tally.mappings.upsert#id#${ctx.variantId ?? 'variant'}`),
    entityType: 'stock_item',
    entityId: ctx.variantId,
    tallyName: ctx.productSearch ? `${ctx.productSearch} (Tally)` : 'Campa Cola 750 ml',
    tallyParent: 'Campa',
  }),
  'integrations.tally.syncLedger.list': (ctx) => ({
    docType: DROP,
    exportJobId: ctx.integrations?.exportId ?? DROP,
    from: DROP,
    to: DROP,
  }),
  'receivables.receipts.create': (ctx) => ({
    retailerId: ctx.retailerId,
    allocations: DROP,
    strategy: 'fifo',
  }),
  // A statement run names EITHER a list of shops OR one beat, never both: the example names the shop.
  'receivables.statements.send': (ctx) => ({
    retailerIds: ctx.retailerId ? [ctx.retailerId] : undefined,
    beatId: DROP,
  }),
  'receivables.outstanding.get': (ctx) => ({ retailerId: ctx.retailerId }),
  'receivables.ledger.get': (ctx) => ({ retailerId: ctx.retailerId }),
  'receivables.creditCheck': (ctx) => ({ retailerId: ctx.retailerId, orderTotalPaise: 0 }),
}

function draftOrder(ctx: ExampleContext, index: number): string | undefined {
  const drafts = ctx.draftOrderIds ?? []
  return drafts[index] ?? drafts[0]
}

/** Which file domain the roles of this service may upload to (files.ts per-domain table). */
function uploadDomainFor(options: BuildExamplesOptions): { domain: string; mimeType: string } {
  const roles = new Set(options.roles ?? [])
  if (roles.size === 0 || roles.has('owner')) return { domain: 'logo', mimeType: 'image/png' }
  if (roles.has('manager') || roles.has('accountant'))
    return { domain: 'import', mimeType: 'text/csv' }
  if (roles.has('warehouse')) return { domain: 'damage', mimeType: 'image/jpeg' }
  return { domain: 'pod', mimeType: 'image/jpeg' }
}

/** `retailer_app` is the only source a retailer login may place an order under (docs/17, ADR 0006). */
function orderSource(options: BuildExamplesOptions): string {
  return servesOnlyRetailer(options) ? 'retailer_app' : 'salesperson'
}

/**
 * What a reader must know before pressing Execute on a procedure that writes a new row: the id is the
 * client's, so the second press is a replay and only a re-fetched document moves to the next one.
 */
function createsRowNote(ctx: ExampleContext, procedurePath: string, what: string): string {
  const slot = slotOf(ctx, procedurePath)
  const walked =
    slot > 0
      ? ` The id and key shown are slot ${String(slot)} of this procedure's sequence — the earlier ones are already in this database.`
      : ''
  return `Creates ${what}. Pressing Execute twice replays the first result (same id, same idempotencyKey); fetch \`/docs/openapi.json?fresh=1\` for an example that creates the next one.${walked}`
}

/** Caveats that survive into the document as `x-dos-note`. */
const NOTES: Record<string, (ctx: ExampleContext) => string | undefined> = {
  'integrations.imports.create': (ctx) =>
    `Stages the seeded TradeEzee party file again as a NEW import (${createdImportId(ctx)}); the mapping, dry-run, review, commit and confirm examples below all point at it, in that order. A second Execute replays; re-fetch \`/docs/openapi.json?fresh=1\` for the next job.`,
  'integrations.imports.commit': () =>
    'Applies the matched rows for real (shops created or updated). Reversible with rollback until confirm.',
  'integrations.imports.rollback': () =>
    'Undoes a committed, unconfirmed import. The wizard job of this document is confirmed by then, so this answers 409; call it on a committed job.',
  'auth.refresh': () => 'Paste the refreshToken from POST /auth/login; it rotates on every use.',
  'auth.logout': () => 'Paste the refreshToken from POST /auth/login.',
  'auth.switchTenant': () => 'Paste the refreshToken from POST /auth/login.',
  'auth.revokeSession': () =>
    'sessionId is illustrative — take a real one from GET /auth/sessions first. Revoking signs that device out.',
  'auth.changePassword': () =>
    'This really changes the password. The example sets it back to the same demo password, but every OTHER session of that user is signed out.',
  'tenancy.staff.create': (ctx) =>
    `Creates a REAL staff member (${docsStaffUsername(slotOf(ctx, 'tenancy.staff.create'))} / ${docsStaffPhone(slotOf(ctx, 'tenancy.staff.create'))}). A second Execute replays the first result instead of creating another; re-fetch \`/docs/openapi.json?fresh=1\` for an example that creates the next person.`,
  'tenancy.staff.setPassword': () =>
    'Resets that user’s password and forces a change at next sign-in. The example points at a spare staff member, not one of the documented demo sign-ins.',
  'tenancy.staff.setStatus': () =>
    'The example re-activates an already active spare staff member, so it changes nothing; `disabled` would revoke their sessions.',
  'catalog.propose': () =>
    'Adds a proposed product to the GLOBAL catalogue (usable immediately, curated later).',
  'tenantCatalog.upsertListing': (ctx) =>
    ctx.listing
      ? 'The example echoes the current listing back unchanged, so pressing Execute changes nothing.'
      : undefined,
  'tenantCatalog.upsertCost': (ctx) =>
    ctx.cost
      ? 'The example echoes the current purchase cost back unchanged, so pressing Execute changes nothing.'
      : undefined,
  'pricing.priceLists.setItems': (ctx) =>
    ctx.priceListItem
      ? 'The example re-sends the existing row at its existing rate, so pressing Execute does not reprice anything.'
      : undefined,
  'pricing.overrides.upsert': () =>
    'Creates a real shop-specific price for that product at the current list rate. Delete it afterwards if you do not want it.',
  'pricing.schemes.upsert': () =>
    'The example scheme is created `active: false` and scoped to one product, so it cannot change what the demo orders cost until you activate it.',
  'inventory.stock.adjust': () =>
    'Writes one real stock-ledger row (+1 piece). The fixed idempotencyKey means a second Execute is replayed, not added.',
  'inventory.stock.transfer': () =>
    'Really moves stock from the godown to the van. The fixed idempotencyKey means a second Execute is replayed, not added.',
  'procurement.supplierInvoices.create': (ctx) =>
    `This books a REAL purchase document. A supplier invoice number may exist only once per supplier, so the example carries the next unused one (${docsInvoiceNo(slotOf(ctx, 'procurement.supplierInvoices.create'))}); pressing Execute twice replays the first result, and re-fetching the document moves it on to the next number. The amounts are one consistent set: the header total must equal the line totals plus freight and round-off, or the call is refused.`,
  'orders.create': (ctx) => createsRowNote(ctx, 'orders.create', 'a draft order'),
  'orders.repeatLast': (ctx) =>
    createsRowNote(ctx, 'orders.repeatLast', 'a draft order copied from the shop’s last one'),
  'pricing.bargains.request': (ctx) =>
    createsRowNote(ctx, 'pricing.bargains.request', 'a real bargain request'),
  'procurement.grns.open': (ctx) =>
    ctx.grnOpenInvoiceId
      ? 'Opens a REAL GRN, against the one approved supplier invoice that has no live GRN yet. Each invoice takes only one, so re-fetch `/docs/openapi.json?fresh=1` for the next invoice — or run POST /procurement/supplier-invoices first to book one.'
      : 'Every approved supplier invoice already has a live GRN, so this example has nothing to open against. Book one with POST /procurement/supplier-invoices, then re-fetch `/docs/openapi.json?fresh=1`.',
  'procurement.grns.count': (ctx) =>
    ctx.countableGrnId
      ? undefined
      : "No demo GRN is 'counting' or 'reconciled' right now — open one with POST /procurement/grns first, then re-fetch `/docs/openapi.json?fresh=1`.",
  'procurement.grns.post': (ctx) =>
    ctx.postableGrnStatus === 'reconciled'
      ? undefined
      : ctx.postableGrnStatus === 'posted'
        ? 'The GRN in the example is already posted, so this answers 200 with the same GRN — posting is idempotent by design.'
        : "No demo GRN is 'reconciled' or 'posted'. Posting needs every line counted first (POST /procurement/grns/{id}/count).",
  'procurement.supplierInvoices.matchLine': (ctx) =>
    ctx.matchableInvoiceId
      ? 'Matching every line of an invoice approves it, which is what makes it eligible for a GRN.'
      : 'Every demo supplier invoice is already received, and a received invoice has frozen lines. Book a new one with POST /procurement/supplier-invoices first.',
  'pricing.bargains.decide': (ctx) =>
    ctx.bargainStatus === 'requested'
      ? undefined
      : `The demo bargain is '${ctx.bargainStatus ?? 'unknown'}'. Only a 'requested' bargain can be decided.`,
  'orders.setLines': () => 'Points at a draft order; lines can only be set while it is a draft.',
  'orders.submit': (ctx) =>
    (ctx.draftOrderIds?.length ?? 0) > 0
      ? 'Points at a draft order. Once it is submitted the same call answers a state error — pick another draft from GET /orders?state=draft.'
      : 'No draft order in the demo data: create one with POST /orders first.',
  'orders.cancel': () =>
    'Points at a draft order; a dispatched or delivered order cannot be cancelled.',
  'orders.confirm': (ctx) =>
    ctx.submittedOrderId
      ? 'Points at a submitted order; confirming reserves stock.'
      : 'No submitted order in the demo data: submit one first, then confirm it.',
  'orders.approvals.decide': (ctx) =>
    ctx.approvalId
      ? 'Points at a pending approval; deciding it twice answers a state error.'
      : 'No pending approval in the demo data.',
  'sync.upload': () =>
    'Uploads one draft order under a fixed opId, so a second Execute is replayed rather than re-applied.',
  'auth.forgotPassword': () =>
    'Always answers ok. The reset token is handed to the delivery channel (SMS / WhatsApp, the notifications module); outside production it is written to the auth-service log.',
  'auth.resetPassword': () =>
    'Needs the single-use token from the reset message; the placeholder shown is refused with 401.',
  'tenancy.settings.set': () =>
    'Writes the footer printed under every invoice, and one audit_log row per key.',
  'tenancy.numbering.upsert': () =>
    'Creates (or edits) a series nothing has issued from yet. A series with issued documents answers 409 series_locked.',
  'tenancy.featureFlags.set': () =>
    'Re-enables an already enabled flag, so pressing Execute changes nothing.',
  'files.uploadUrl': () =>
    'Mints a pre-signed PUT for the logo (registered in file_objects as pending). PUT the bytes to `url` with `headers`, then set branding.logo_object_key to `objectKey` through tenancy.settings.set.',
  'files.readUrl': () =>
    'Signs a read URL for the key files.uploadUrl mints; the link answers 404 until bytes were PUT there.',
  'billing.invoices.issueForPack': (ctx) =>
    ctx.parkedPackId
      ? 'Bills the one pack that was confirmed with issueInvoice:false. Once billed the same call answers 409 already_invoiced.'
      : 'No pack in the demo data is waiting for a bill (every pack was invoiced at confirm). Confirm one with issueInvoice:false first.',
  'warehouse.loadSheets.approve': (ctx) =>
    ctx.approvableLoadSheetId
      ? 'The manager app gives the load-out PIN: approves the draft sheet the warehouse phone is waiting on. A second Execute answers 409 already_approved.'
      : 'Every draft load sheet in the demo data is already approved; create one with POST /warehouse/load-sheets first.',
  'warehouse.challans.pdf': () =>
    'Answers `queued` until the worker has rendered the challan, then `ready` with a signed URL. Run `pnpm --filter @dos/worker dev`.',
  'receivables.receipts.document': () =>
    'Answers `queued` until the worker has rendered the receipt, then `ready` with a signed URL. Run `pnpm --filter @dos/worker dev`.',
  'inventory.cycleCounts.open': () =>
    'Opens a real count of one lot at its location (expected pieces frozen now). A second Execute replays the first result.',
  'inventory.cycleCounts.count': (ctx) =>
    ctx.cycleCountStatus === 'open' || ctx.cycleCountStatus === 'counted'
      ? undefined
      : 'The demo count is already posted; open one with POST /inventory/cycle-counts first.',
  'inventory.cycleCounts.post': (ctx) =>
    ctx.cycleCountStatus === 'counted'
      ? 'Posts the differences as cycle_count ledger rows.'
      : ctx.cycleCountStatus === 'posted'
        ? 'The demo count is already posted, so this answers 200 with no new ledger rows.'
        : 'The demo count is still open: count every line first (POST /inventory/cycle-counts/{id}/count).',
  'procurement.discrepancies.resolve': (ctx) =>
    ctx.discrepancyStatus === 'open'
      ? undefined
      : `The demo finding is '${ctx.discrepancyStatus ?? 'unknown'}'; only an open or claimed finding is decided.`,
  'procurement.supplierInvoices.dispute': (ctx) =>
    ctx.disputableInvoiceId
      ? 'Marks the one supplier invoice that is still under review as disputed. Pressing Execute twice answers the same disputed invoice.'
      : 'Every demo supplier invoice is received or cancelled; book a new one with POST /procurement/supplier-invoices first.',
  'procurement.supplierInvoices.cancel': (ctx) =>
    ctx.disputableInvoiceId
      ? 'Cancels a supplier invoice that never became stock. Disputing it first (the call above) does not block this.'
      : 'Every demo supplier invoice is received or cancelled; book a new one first.',
  'retailers.updateOwn': () =>
    'The shop edits its own contact details; the example points at the shop linked to the demo retailer login.',
  'delivery.trips.create': (ctx) => createsRowNote(ctx, 'delivery.trips.create', 'a planned trip'),
  'delivery.trips.startLoading': (ctx) =>
    ctx.plannedTripId
      ? "Moves tomorrow's planned trip to loading; the godown then builds its load sheet. Pressing it on a trip already loading or out answers 409."
      : 'No planned trip in the demo data: plan one with POST /delivery/trips first.',
  'delivery.trips.depart': () =>
    'planned → loading → active: press start-loading first. Needs the driver to have answered the location notice (POST /delivery/consents).',
  'delivery.trips.return': () =>
    "Takes TODAY'S ACTIVE demo trip off the road: every open stop fails and its bill goes back to packed. Re-seed to restore it.",
  'delivery.trips.settle': () =>
    'Only a trip in `closing` settles (press return first). The cash handed over here is the float alone, so the cockpit will report the collected cash as short and answer 409 settlement_needs_owner unless the owner sends acceptVariance.',
  'delivery.trips.cancel': () =>
    'Cancels the planned demo trip the delivery app opens on (only planned/loading trips cancel). A cancelled trip is terminal and the seed never recreates one: press this only on a database you can drop.',
  'delivery.stops.start': (ctx) =>
    ctx.tripStopId
      ? "Moves the active trip's next open stop along; an older occurredAt on a stop already past it answers the current row, never 409."
      : 'Every stop of the active demo trip is done; plan a new trip first.',
  'delivery.stops.fail': () =>
    'Fails the open stop: its bill goes back to packed and the pieces stay on the van. Do this INSTEAD of POST /delivery/deliveries for that stop, not after.',
  'delivery.deliveries.record': (ctx) =>
    ctx.plannedDeliveryId
      ? 'Delivers the one open bill of the active trip in full, with a signature inline (the local storage driver). A second Execute replays; the stop is then delivered.'
      : 'No planned bill is open on the active demo trip; plan a trip with a packed bill first.',
  'delivery.collections.record': () =>
    'One rupee in cash at the open stop, allocated oldest bill first (on account when the shop owes nothing). A second Execute replays the same receipt.',
  'delivery.vanSales.create': (ctx) =>
    ctx.vanVariantId
      ? "One piece sold off the active trip's van, billed from the tenant's normal INV series. A second Execute replays."
      : 'The active demo trip has no stock on its vehicle; load a sheet onto it first.',
  'delivery.gps.points': () =>
    'Two breadcrumbs for the active trip; a replay answers duplicates, a point outside the trip window is dropped, never 4xx.',
  'delivery.gps.trace': () => 'Audited (gps.trace_read): owner and manager only.',
  'delivery.vehicles.positions': () => 'Audited (gps.live_map_read): owner and manager only.',
  'sync.pull': () =>
    'Omit `since` for the full read set; send back the `cursor` you get for the delta next time.',
  'docint.documents.create': (ctx) =>
    createsRowNote(
      ctx,
      'docint.documents.create',
      'a supplier-bill document in `uploaded`; the next four examples (upload slot, page, QR, submit) walk this same document',
    ),
  'docint.documents.addPage': () =>
    'Registers page 1 of the document `create` made, sending the bytes inline (the local driver); the objectKey is the slot `pageUploadUrl` minted.',
  'docint.documents.verifyQr': () =>
    'A bare-JSON e-invoice QR with valid GSTINs: decoded (`qrStatus = decoded`), never verified without DOCINT_IRP_KEYS. A repeat of an IRN already captured answers 200 with `duplicate` set.',
  'docint.documents.submit': () =>
    'Closes capture on the document `create` made. With DOCINT_INLINE_JOBS the stub engine reads it inside the request; otherwise the outbox row waits for the worker (`pnpm --filter @dos/worker dev`).',
  'docint.documents.reject': () =>
    'Rejects the seeded duplicate capture; pressing it again on the rejected document answers 200 unchanged.',
  'docint.documents.approve': (ctx) =>
    ctx.docint?.approvable
      ? 'Books the reviewed document as a supplier invoice DRAFT (never a GRN). A committed document answers its existing draft, so a second press replays.'
      : 'No reviewed document in the demo data: submit a review first (review.start → review.submit).',
  'docint.extractions.run': () =>
    'Re-reads the seeded brand-DMS bill with force: inline on the stub engine, else queued for the worker. Refused while a review session is open.',
  'docint.matches.accept': () =>
    'Accepts the top candidate of the amber line on the seeded Too Yumm bill and remembers the pack; reject (next) puts the line back to amber.',
  'docint.matches.choose': () =>
    'Picks the demo variant for the red line (no candidate at all); the pack size defaults to the variant.',
  'docint.review.start': (ctx) =>
    createsRowNote(
      ctx,
      'docint.review.start',
      'a review session on a reading nobody holds (the single-writer lock; a second reviewer is answered 409 with the holder)',
    ),
  'docint.review.save': () =>
    'Patches a batch number on the session this sign-in holds and re-runs the validators; only an owner may patch `header.buyerGstin`.',
  'docint.review.submit': () =>
    "Asserts the reading is right: 400 checks_blocking while a red check stands (the manager's seeded session has one), else the document becomes `reviewed`.",
  'docint.review.release': () =>
    'Gives up the session `review.start` opened on this lane; a session already submitted or released answers 409.',
}

/**
 * GET filters worth pre-filling. Everything else is left blank on purpose: Swagger sends whatever it
 * shows, and stacking optional filters is the quickest way to make a working endpoint return nothing.
 */
const QUERY_FILL: Record<string, readonly string[]> = {
  'catalog.search': ['q'],
  'tenantCatalog.list': ['q'],
  'tenantCatalog.costs': ['variantId'],
  'retailers.list': ['q'],
  'retailers.visits.list': ['retailerId'],
  'orders.list': ['retailerId'],
  'inventory.stock.sellable': ['variantId'],
  'inventory.stock.balances': ['lotId'],
  'inventory.stock.ledger': ['lotId'],
  'pricing.priceLists.list': ['withItems'],
  'pricing.overrides.list': ['retailerId'],
  'procurement.supplierInvoices.list': ['supplierId'],
  'procurement.grns.list': [],
  'procurement.discrepancies.list': ['grnId'],
  'tenancy.settings.get': ['keys'],
  'files.readUrl': ['objectKey'],
  'sync.pull': ['deviceId'],
  'receivables.ageing.history': ['from', 'to', 'grain'],
  'receivables.receipts.document': ['format'],
  'warehouse.challans.pdf': ['copy', 'format'],
  'tenantCatalog.repAuthorisations.list': ['userId'],
  'pricing.bounds.list': ['userId'],
  'retailers.beats.assignments.list': ['userId'],
  'delivery.gps.trace': ['everyNth', 'limit'],
  'delivery.vehicles.positions': ['staleAfterMinutes'],
  'docint.documents.pageUrl': ['pageNo'],
  'docint.extractions.list': ['includeResult'],
  'docint.stats.summary': ['from', 'to'],
  'integrations.imports.preview': ['rows'],
  'integrations.tally.syncLedger.list': ['exportJobId'],
}

/** `q` is a free-text search: give it a word that certainly matches a seeded row. */
function searchFor(procedurePath: string, ctx: ExampleContext): string | undefined {
  if (procedurePath.startsWith('retailers.') || procedurePath.startsWith('orders.'))
    return ctx.retailerSearch
  return ctx.productSearch
}

interface FillScope {
  procedure: ProcedureSummary
  ctx: ExampleContext
  overrides: OverrideMap
  pathParams: Set<string>
}

/**
 * Resolves one leaf by name. `undefined` means "let the static sampler decide"; the per-procedure
 * override table is consulted before this, in `fill`.
 */
function resolve(key: string, trail: string, scope: FillScope): unknown {
  const { ctx, procedure } = scope
  const named = byFieldName(key, ctx)
  if (named !== undefined) return named
  const slot = slotOf(ctx, procedure.path)
  switch (key) {
    case 'idempotencyKey':
      return docsIdempotencyKey(procedure.path, slot)
    case 'id':
      // Only the TOP-LEVEL id can be the path parameter (`buildExamples` moves that one into the
      // path); a nested `lines[0].id` is a row this call creates, so it must be a free id of its
      // own — reading the route's row there writes an order id into a line and collides on the
      // second press. Client-generated ids come from the route plus the procedure's free slot, so
      // pressing Execute twice sends the identical body under the identical key and is replayed.
      return scope.pathParams.has('id') && trail === 'id'
        ? pathIdFor(procedure.httpPath, ctx)
        : createdId(procedure.path, trail, slot)
    case 'lineId':
      return scope.pathParams.has('lineId') && trail === 'lineId'
        ? undefined
        : createdId(procedure.path, trail, slot)
    case 'assignmentId':
      return createdId(procedure.path, trail, slot)
    case 'q':
    case 'search':
      return searchFor(procedure.path, ctx)
    case 'qtyPcs':
    case 'enteredQty':
    case 'countedQtyPcs':
      return ctx.orderQty ?? 12
    default:
      return undefined
  }
}

const CONTAINER_TYPES = new Set(['object', 'array'])

/** Recursive walk of a Zod 4 schema, mirroring `sample()` but consulting the demo rows first. */
function fill(node: ZodLike, key: string, trail: string, scope: FillScope, depth: number): unknown {
  if (depth > 8) return null
  if (trail !== '' && trail in scope.overrides) {
    const chosen = scope.overrides[trail]
    if (chosen !== undefined) return chosen
  }
  const def = node._zod.def
  switch (def.type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [childKey, child] of Object.entries(def.shape ?? {})) {
        if (childKey === 'cursor' || childKey === 'nextCursor') continue
        const childTrail = trail ? `${trail}.${childKey}` : childKey
        const value = fill(child, childKey, childTrail, scope, depth + 1)
        if (value !== DROP && value !== undefined) out[childKey] = value
      }
      return out
    }
    case 'array': {
      const element = def.element
      if (!element) return []
      const value = fill(element, key.replace(/s$/, ''), `${trail}[0]`, scope, depth + 1)
      return value === DROP || value === undefined ? [] : [value]
    }
    case 'optional': {
      const inner = def.innerType
      // An id-shaped optional with nothing real behind it is dropped rather than faked: a made-up
      // uuid in an optional foreign key is the difference between a 200 and a database error.
      return inner ? fill(inner, key, trail, scope, depth + 1) : DROP
    }
    case 'default': {
      const chosen = resolve(key, trail, scope)
      if (chosen !== undefined) return chosen
      if (def.defaultValue !== undefined && typeof def.defaultValue !== 'function')
        return def.defaultValue
      return def.innerType ? fill(def.innerType, key, trail, scope, depth + 1) : null
    }
    case 'nullable': {
      const inner = def.innerType
      if (inner && CONTAINER_TYPES.has(inner._zod.def.type)) {
        const value = fill(inner, key, trail, scope, depth + 1)
        return value === DROP || value === undefined ? null : value
      }
      const chosen = resolve(key, trail, scope)
      // `sample` keeps the "has not happened yet" fields null, which reads better in an example.
      return chosen ?? coerceFormat(def, sample(node, key, depth))
    }
    case 'pipe': {
      const target = def.out ?? def.in
      return target ? fill(target, key, trail, scope, depth + 1) : null
    }
    case 'union': {
      const option = (def.options ?? [])[0]
      return option ? fill(option, key, trail, scope, depth + 1) : null
    }
    default: {
      const chosen = resolve(key, trail, scope)
      return chosen ?? coerceFormat(def, sample(node, key, depth))
    }
  }
}

/**
 * `sample()` lets a field-name hint win over the schema's own format, so a `from` declared as an ISO
 * timestamp comes back as a plain date and the example would not parse. Examples must be executable,
 * so the format wins here. (The generated READMEs still show the sampler's value — see sample.ts.)
 */
function coerceFormat(def: { format?: string }, value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (def.format === 'datetime' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return `${value}T00:00:00.000Z`
  if (def.format === 'date' && value.includes('T')) return value.slice(0, 10)
  return value
}

const ORPC_META = '~orpc'
type OrpcMeta = { inputSchema?: ZodLike }

/** The Zod input schema behind a dotted contract path, e.g. `orders.approvals.decide`. */
export function inputSchemaFor(procedurePath: string): ZodLike | undefined {
  let node: unknown = contract
  for (const segment of procedurePath.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  const meta = (node as Record<string, unknown> | null)?.[ORPC_META] as OrpcMeta | undefined
  return meta?.inputSchema
}

function pathParamNames(httpPath: string): Set<string> {
  return new Set([...httpPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? ''))
}

/** The fields of `patch` that actually have a value, so a missing row never blanks a good one. */
function present<T extends object>(patch: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

/**
 * The rows THIS service's document is built from.
 *
 * Two narrowings: it takes its own lane out of every id sequence, so the seven services never publish
 * the same new id; and, for the shopkeeper app, it swaps the busiest shop and its orders for the one
 * shop that login is linked to — anything else there answers 403 ("This retailer is not linked to
 * your login") or hides behind RLS.
 */
function scopeToService(ctx: ExampleContext, options: BuildExamplesOptions): ExampleContext {
  const lane = serviceLane(options)
  const scoped: ExampleContext = ctx.slotLanes
    ? {
        ...ctx,
        freshSlots: Object.fromEntries(
          Object.entries(ctx.slotLanes).map(([path, slots]) => [
            path,
            slots[lane] ?? slots[slots.length - 1] ?? 0,
          ]),
        ),
      }
    : ctx
  const linked = ctx.linkedRetailer
  if (!linked || !servesOnlyRetailer(options)) return scoped
  return {
    ...scoped,
    retailerId: linked.retailerId,
    retailerCode: linked.code,
    retailerName: linked.name,
    retailerPhone: linked.phone,
    retailerSearch: searchTerm(linked.name) ?? ctx.retailerSearch,
    ...present(ctx.linkedOrders),
    ...(ctx.linkedReceiptId ? { receiptId: ctx.linkedReceiptId } : {}),
  }
}

/**
 * One runnable example per procedure, keyed by dotted contract path. Path params always name a real
 * row; bodies keep the sampler's shape with every id-shaped field replaced by a demo row.
 */
export function buildExamples(
  procedures: readonly ProcedureSummary[],
  rows: ExampleContext,
  options: BuildExamplesOptions = {},
): Map<string, ProcedureExample> {
  const ctx = scopeToService(rows, options)
  const out = new Map<string, ProcedureExample>()
  for (const procedure of procedures) {
    const params = pathParamNames(procedure.httpPath)
    const schema = inputSchemaFor(procedure.path)
    const scope: FillScope = {
      procedure,
      ctx,
      overrides: OVERRIDES[procedure.path]?.(ctx, options) ?? {},
      pathParams: params,
    }
    const filled = schema ? fill(schema, '', '', scope, 0) : {}
    const input: Record<string, unknown> =
      filled !== null && typeof filled === 'object' && !Array.isArray(filled)
        ? (filled as Record<string, unknown>)
        : {}

    const pathParams: Record<string, unknown> = {}
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      if (params.has(key)) pathParams[key] = value
      else rest[key] = value
    }
    const isRead = procedure.method.toUpperCase() === 'GET'
    const query: Record<string, unknown> = {}
    if (isRead) {
      for (const key of QUERY_FILL[procedure.path] ?? []) {
        if (rest[key] !== undefined) query[key] = rest[key]
      }
    }
    out.set(procedure.path, {
      path: procedure.path,
      method: procedure.method.toUpperCase(),
      httpPath: procedure.httpPath,
      input,
      pathParams,
      query,
      body: isRead || Object.keys(rest).length === 0 ? undefined : rest,
      note: NOTES[procedure.path]?.(ctx),
    })
  }
  return out
}

/** The top-of-page paragraph that explains what the examples are and how safe they are to press. */
export function describeExamples(ctx: ExampleContext): string {
  if (!ctx.tenantId)
    return [
      '**No demo data found**, so the examples below come from the schemas alone: replace the ids with rows from your own database before pressing Execute.',
      '',
      'Run `pnpm db:seed` and then fetch `/docs/openapi.json?fresh=1` to fill them in.',
    ].join('\n')
  return [
    `**Every example below is real.** The ids come from the seeded demo distributor \`${ctx.tenantSlug ?? 'demo'}\` (tenant \`${ctx.tenantId}\`), read from the database when this document was generated — press "Try it out", then "Execute", and the call runs against those rows.`,
    '',
    'Mutations are safe to press twice: each carries a fixed `idempotencyKey` (`docs-<procedure>`) and, where the client generates the row id, a UUIDv7 derived from the same seed, so a second Execute replays the first result instead of creating a second row (idempotency rows are pruned after 24 hours). **Change the `idempotencyKey` whenever you change the body** — the same key with a different payload is refused with 409, by design.',
    '',
    'The handful of procedures that create a row under an id you supply (`POST /orders`, `/orders/repeat-last`, `/pricing/bargains`, `/procurement/supplier-invoices`) walk that seed forward: this document already skipped the ids and document numbers the database holds, so the example works even though earlier readers pressed Execute. Fetch `/docs/openapi.json?fresh=1` after using one to get the next.',
    '',
    'Optional GET filters are left blank on purpose: only the ones that keep a call returning rows are pre-filled. A few operations carry an `x-dos-note` — read it first, it says which row the call needs or what it changes. After re-seeding, fetch `/docs/openapi.json?fresh=1` once to pick up the new ids.',
  ].join('\n')
}
