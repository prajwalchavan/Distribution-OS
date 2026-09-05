import { inArray, sql } from 'drizzle-orm'
import type {
  OrderDraft,
  OrderDraftDetail,
  OrderDraftLine,
  ReorderSuggestion,
  RoutePlan,
  RoutePlanDetail,
  RoutePlanStatus,
  RoutePlanStop,
} from '@dos/contracts'
import type { aiForecasts } from '@dos/db'
import { retailers, salesOrders, trips, type AiOrderDraftLine, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { clampBps, previewOf, type DraftRow } from './ai.internals.js'
import { lineStatus } from './intake.js'

/**
 * Rows → wire shapes. Everything the contract calls "derived at read" is derived here: a line's
 * status, the three counts, the preview, a plan's status, `belowCover`, `reorderCases`. The stored
 * rows carry only what a computation produced; the labels a human reads are joined in.
 *
 * NO MONEY LEAVES THIS FILE. There is none on any of the three tables, and none is joined in: a
 * reorder suggestion the godown reads must never carry a purchase cost (docs/22 §9), and a draft a
 * shopkeeper reads must never carry the engine that read it or what it cost us.
 */

export type PlanRow = {
  id: string
  tenantId: string
  tripId: string
  method: 'nearest_neighbour_2opt' | 'manual'
  sequence: { stopId: string; seq: number; etaAt: string | null; distanceM: number }[]
  totalDistanceM: number
  totalDurationS: number
  computedAt: Date
  appliedAt: Date | null
  appliedBy: string | null
  overridden: boolean
  createdAt: Date
  updatedAt: Date
}

export type ForecastRow = typeof aiForecasts.$inferSelect

const iso = (value: Date | null): string | null => value?.toISOString() ?? null

export interface VariantLabel {
  name: string
  packSize: number | null
}

/**
 * Names and sell-side pack sizes for the variants a draft points at (chosen lines and candidates
 * alike), so the review screen reads as product names rather than as uuids. One query per draft page.
 */
export async function variantLabels(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, VariantLabel>> {
  const out = new Map<string, VariantLabel>()
  const ids = [...new Set(variantIds.filter((id) => id.length > 0))]
  if (ids.length === 0) return out
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select
      v.id as variant_id,
      trim(coalesce(b.name, '') || ' ' || coalesce(p.name, '') || ' ' || v.name) as label,
      coalesce(tp.case_size_override, v.default_case_size) as pack_size
    from product_variants v
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    left join tenant_products tp on tp.variant_id = v.id and tp.tenant_id = ${tenantId}
    where v.id = any(${sql.param(ids)}::text[])
  `)
  for (const row of result.rows)
    out.set(String(row.variant_id), {
      name: String(row.label).replace(/\s+/g, ' ').trim(),
      packSize: row.pack_size === null ? null : Number(row.pack_size),
    })
  return out
}

export async function retailerNames(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return out
  const rows = await tx
    .select({ id: retailers.id, name: retailers.name })
    .from(retailers)
    .where(inArray(retailers.id, unique))
  for (const row of rows) out.set(row.id, row.name)
  return out
}

export async function orderNumbers(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return out
  const rows = await tx
    .select({ id: salesOrders.id, orderNo: salesOrders.orderNo })
    .from(salesOrders)
    .where(inArray(salesOrders.id, unique))
  for (const row of rows) out.set(row.id, row.orderNo)
  return out
}

export interface DraftDeps {
  retailerNames: ReadonlyMap<string, string>
  orderNumbers: ReadonlyMap<string, string | null>
  variants: ReadonlyMap<string, VariantLabel>
}

/** Every variant id a draft's stored lines mention, chosen or merely offered. */
export function variantIdsOf(rows: readonly DraftRow[]): string[] {
  const ids: string[] = []
  for (const row of rows)
    for (const line of row.parsedLines) {
      if (line.variantId) ids.push(line.variantId)
      for (const candidate of line.candidates) ids.push(candidate.variantId)
    }
  return ids
}

export function toDraftLine(
  line: AiOrderDraftLine,
  lineNo: number,
  variants: ReadonlyMap<string, VariantLabel>,
): OrderDraftLine {
  const chosen = line.variantId ? variants.get(line.variantId) : undefined
  return {
    lineNo,
    rawText: line.text,
    status: lineStatus(line),
    variantId: line.variantId,
    variantName: chosen?.name ?? null,
    packSize: chosen?.packSize ?? null,
    qtyPcs: Math.max(0, Math.trunc(line.qtyPcs)),
    cases: line.cases && line.cases > 0 ? Math.trunc(line.cases) : null,
    unit: line.unit,
    confidenceBps: clampBps(line.confidenceBps),
    candidates: line.candidates.slice(0, 5).map((candidate) => ({
      variantId: candidate.variantId,
      variantName: variants.get(candidate.variantId)?.name ?? candidate.label,
      scoreBps: clampBps(candidate.scoreBps),
    })),
  }
}

export function toDraft(row: DraftRow, deps: DraftDeps): OrderDraft {
  const lines = row.parsedLines
  const matched = lines.filter((line) => lineStatus(line) === 'matched').length
  const unmatched = lines.filter((line) => lineStatus(line) === 'unmatched').length
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    retailerId: row.retailerId,
    retailerName: row.retailerId ? (deps.retailerNames.get(row.retailerId) ?? null) : null,
    inboundMessageId: row.inboundMessageId,
    preview: previewOf(row.rawText ?? row.transcript),
    lineCount: lines.length,
    matchedLineCount: matched,
    unmatchedLineCount: unmatched,
    confidenceBps: clampBps(row.matchConfidenceBps),
    needsHumanConfirmation: true,
    orderId: row.createdOrderId,
    orderNo: row.createdOrderId ? (deps.orderNumbers.get(row.createdOrderId) ?? null) : null,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toDraftDetail(row: DraftRow, deps: DraftDeps): OrderDraftDetail {
  return {
    ...toDraft(row, deps),
    rawText: row.rawText,
    transcript: row.transcript,
    audioObjectKey: row.audioObjectKey,
    lines: row.parsedLines.map((line, index) => toDraftLine(line, index + 1, deps.variants)),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// forecasts

export interface ForecastDeps {
  variants: ReadonlyMap<string, VariantLabel>
  locationNames: ReadonlyMap<string, string>
  coverDays: number
}

export function toReorderSuggestion(row: ForecastRow, deps: ForecastDeps): ReorderSuggestion {
  const variant = deps.variants.get(row.variantId)
  const packSize = variant?.packSize ?? null
  return {
    id: row.id,
    variantId: row.variantId,
    variantName: variant?.name ?? row.variantId,
    packSize,
    locationId: row.locationId,
    locationName: deps.locationNames.get(row.locationId) ?? '',
    horizonDays: row.horizonDays,
    expectedQtyPcs: Math.max(0, row.expectedQtyPcs),
    onHandPcs: Math.max(0, row.onHandPcs),
    reorderQtyPcs: Math.max(0, row.reorderQtyPcs),
    reorderCases:
      packSize && packSize > 0 ? Math.ceil(Math.max(0, row.reorderQtyPcs) / packSize) : null,
    daysCover: row.daysCover === null ? null : Math.max(0, row.daysCover),
    belowCover: row.daysCover !== null && row.daysCover < deps.coverDays,
    method: row.method,
    confidenceBps: clampBps(row.confidenceBps),
    needsHumanConfirmation: true,
    computedAt: row.computedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// route plans

export interface RouteDeps {
  tripNumbers: ReadonlyMap<string, string | null>
  /** Ids of the newest plan per trip, so an older pass reads as `superseded`. */
  newestPlanIds: ReadonlySet<string>
  /**
   * True when the trip's stops no longer stand in the order this plan proposed. DERIVED by comparing
   * the plan's sequence with the trip's current one, not written by anybody: the crew re-sequences
   * through `delivery.stops.reorder`, which knows nothing about `route_plans` (and must not — the
   * edge runs ai → delivery, never back). So "the driver overrode it" is a comparison, and it stays
   * true whichever way the crew changed their mind.
   */
  resequencedAfterApply?: boolean
  /** The trip's stops today: current sequence, shop and pin, joined onto the proposed sequence. */
  stops: ReadonlyMap<
    string,
    {
      sequence: number
      retailerId: string
      retailerName: string
      lat: number | null
      lng: number | null
    }
  >
}

/**
 * DERIVED, never stored: `applied` once the sequence reached the trip, `overridden` when the crew
 * re-sequenced afterwards, `superseded` when a newer pass exists for the same trip, else `draft`.
 */
export function routePlanStatus(
  row: PlanRow,
  newest: ReadonlySet<string>,
  overridden: boolean,
): RoutePlanStatus {
  if (overridden) return 'overridden'
  if (row.appliedAt) return 'applied'
  return newest.has(row.id) ? 'draft' : 'superseded'
}

/** Did the crew move a stop after the plan was applied? A pure comparison of two orderings. */
export function planWasOverridden(row: PlanRow, deps: RouteDeps): boolean {
  if (row.overridden) return true
  if (!row.appliedAt) return false
  if (deps.resequencedAfterApply !== undefined) return deps.resequencedAfterApply
  return row.sequence.some((entry) => {
    const current = deps.stops.get(entry.stopId)
    return current !== undefined && current.sequence !== entry.seq
  })
}

export function toRoutePlan(row: PlanRow, deps: RouteDeps): RoutePlan {
  const stops = row.sequence
  const pinned = stops.filter((stop) => {
    const current = deps.stops.get(stop.stopId)
    return current?.lat !== null && current?.lat !== undefined
  }).length
  const overridden = planWasOverridden(row, deps)
  return {
    id: row.id,
    tripId: row.tripId,
    tripNo: deps.tripNumbers.get(row.tripId) ?? null,
    status: routePlanStatus(row, deps.newestPlanIds, overridden),
    method: row.method,
    stopCount: stops.length,
    unpinnedStops: Math.max(0, stops.length - pinned),
    totalDistanceM: Math.max(0, row.totalDistanceM),
    totalDurationS: Math.max(0, row.totalDurationS),
    // The share of the trip's stops that had coordinates to optimise with: a plan built from three
    // pinned shops out of ten says so instead of pretending.
    confidenceBps: clampBps(stops.length === 0 ? 0 : (pinned / stops.length) * 10_000),
    needsHumanConfirmation: true,
    computedAt: row.computedAt.toISOString(),
    appliedAt: iso(row.appliedAt),
    appliedBy: row.appliedBy,
    overridden,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toRoutePlanDetail(row: PlanRow, deps: RouteDeps): RoutePlanDetail {
  const stops: RoutePlanStop[] = row.sequence.map((stop) => {
    const current = deps.stops.get(stop.stopId)
    return {
      stopId: stop.stopId,
      sequence: stop.seq,
      currentSequence: current?.sequence ?? null,
      retailerId: current?.retailerId ?? '',
      retailerName: current?.retailerName ?? '',
      lat: current?.lat ?? null,
      lng: current?.lng ?? null,
      distanceM: Math.max(0, Math.round(stop.distanceM)),
      etaAt: stop.etaAt,
    }
  })
  return { ...toRoutePlan(row, deps), stops }
}

export async function tripNumbers(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out
  const rows = await tx
    .select({ id: trips.id, tripNo: trips.tripNo })
    .from(trips)
    .where(inArray(trips.id, unique))
  for (const row of rows) out.set(row.id, row.tripNo)
  return out
}
