import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type {
  DryRunSummary,
  ImportMapping,
  ImportMatchCandidate,
  ImportRowPlan,
  ImportRowStatus,
  ImportTarget,
} from '@dos/contracts'
import { DRY_RUN_SAMPLE_ERRORS, ImportMappingSchema } from '@dos/contracts'
import { importRows, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { normalizeRow, quantityInPieces, validateMappingForTarget } from './mapping.js'
import type { ImportServices } from './services.js'

/**
 * THE DRY RUN: every row through the mapping, the matcher and the target's rules, answering what
 * commit WOULD do — create / update / skip / needs a human / wrong — and creating nothing. Batches of
 * `batchSize` rows so a file never holds a transaction for long; safe to repeat as often as the
 * operator likes (contract: "a dry run never changes the job's status").
 *
 * WHAT A ROW BECOMES
 *   status `matched`       validated and resolved; `plan` says create / update / skip (duplicate)
 *   status `needs_review`  the party or the item is below the floor or ambiguous (candidates listed),
 *                          never auto-picked (brief §4.11)
 *   status `error`         a cell is wrong (a bad date, a non-numeric amount, an unknown state)
 *   status `skipped`       a blank line, a footer, or a row the reviewer skipped (sticky: a re-run keeps
 *                          a human's decision; `reviewed_by` is the mark)
 *
 * WHAT IS REMEMBERED ACROSS RE-RUNS: a pinned `retailer_id` / `variant_id` and the reviewer's
 * `overrides` — they are decisions about the row, not about the mapping.
 */

export type JobRow = {
  id: string
  tenantId: string
  kind: string
  target: string
  mapping: unknown
}

type RowRecord = typeof importRows.$inferSelect

export interface ScoreStats {
  rows: number
  create: number
  update: number
  skip: number
  needsReview: number
  errors: number
  amountPaise: number
  sampleErrors: DryRunSummary['sampleErrors']
}

export const emptyStats = (): ScoreStats => ({
  rows: 0,
  create: 0,
  update: 0,
  skip: 0,
  needsReview: 0,
  errors: 0,
  amountPaise: 0,
  sampleErrors: [],
})

/** The mapping the job holds, parsed; null when none was set yet. */
export function jobMapping(job: { mapping: unknown }): ImportMapping | null {
  const parsed = ImportMappingSchema.safeParse(job.mapping)
  return parsed.success && parsed.data.columns.length > 0 ? parsed.data : null
}

interface ScoredRow {
  status: ImportRowStatus
  plan: ImportRowPlan | null
  retailerId: string | null
  variantId: string | null
  candidates: ImportMatchCandidate[]
  normalized: Record<string, unknown> | null
  error: string | null
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const sourceSystem = (kind: string): string | null =>
  kind === 'excel' || kind === 'other' ? null : kind

/**
 * Keys that must not repeat inside one file: a second party with the same phone, a second bill with the
 * same number, a second item with the same EAN. Tracked across batches by the driver (`seen`).
 */
export type SeenKeys = Map<string, number>

function dedupeKey(target: ImportTarget, values: Record<string, unknown>): string | null {
  switch (target) {
    case 'party_master':
      return typeof values.phone === 'string' ? `phone:${values.phone}` : null
    case 'item_master':
      return typeof values.ean === 'string'
        ? `ean:${values.ean}`
        : typeof values.itemCode === 'string'
          ? `code:${values.itemCode}`
          : null
    case 'opening_outstanding':
      return typeof values.invoiceNo === 'string' ? `bill:${values.invoiceNo}` : null
    default:
      return null
  }
}

/** Score one batch of rows inside the caller's transaction and write them; returns the batch's stats. */
export async function scoreRows(
  tx: Db,
  services: ImportServices,
  job: JobRow,
  mapping: ImportMapping,
  rows: readonly RowRecord[],
  seen: SeenKeys,
): Promise<ScoreStats> {
  const target = job.target as ImportTarget
  const stats = emptyStats()
  const system = sourceSystem(job.kind)

  // The bill numbers of this batch that are already on file, in one query (opening balances and
  // brand-DMS bills alike): those rows are `skip`, never a second document (never-list 5).
  const billNumbers: string[] = []
  const prepared = rows.map((row) => {
    const normalized = normalizeRow(
      row.raw as Record<string, string>,
      mapping,
      target,
      (row.overrides as Record<string, string> | null) ?? null,
    )
    if (typeof normalized.values.invoiceNo === 'string')
      billNumbers.push(normalized.values.invoiceNo)
    return { row, normalized }
  })
  const onFile =
    target === 'opening_outstanding' || target === 'brand_dms_invoices'
      ? await services.billing.externalInvoiceNumbersOnFile(tx, billNumbers)
      : new Map<string, { id: string }>()

  for (const { row, normalized } of prepared) {
    stats.rows++
    let scored: ScoredRow
    if (row.reviewedBy && row.status === 'skipped') {
      scored = {
        status: 'skipped',
        plan: 'skip',
        retailerId: row.retailerId,
        variantId: row.variantId,
        candidates: [],
        normalized: normalized.values,
        error: null,
      }
    } else if (normalized.blank) {
      scored = {
        status: 'skipped',
        plan: 'skip',
        retailerId: null,
        variantId: null,
        candidates: [],
        normalized: null,
        error: null,
      }
    } else if (normalized.errors.length > 0) {
      scored = {
        status: 'error',
        plan: null,
        retailerId: row.retailerId,
        variantId: row.variantId,
        candidates: [],
        normalized: normalized.values,
        error: normalized.errors
          .map((e) => e.message)
          .join('; ')
          .slice(0, 300),
      }
      for (const e of normalized.errors) {
        if (stats.sampleErrors.length < DRY_RUN_SAMPLE_ERRORS)
          stats.sampleErrors.push({ rowNo: row.rowNo, field: e.field, message: e.message })
      }
    } else {
      scored = await resolveRow(tx, services, target, system, row, normalized.values, onFile, seen)
      if (scored.status === 'needs_review' || scored.status === 'error') {
        if (stats.sampleErrors.length < DRY_RUN_SAMPLE_ERRORS)
          stats.sampleErrors.push({
            rowNo: row.rowNo,
            field: null,
            message: scored.error ?? 'needs a human',
          })
      }
    }
    switch (scored.status) {
      case 'matched':
        if (scored.plan === 'create') {
          stats.create++
          stats.amountPaise += rowAmount(target, scored.normalized)
        } else if (scored.plan === 'update') stats.update++
        else stats.skip++
        break
      case 'needs_review':
        stats.needsReview++
        break
      case 'error':
        stats.errors++
        break
      case 'skipped':
        stats.skip++
        break
      default:
        break
    }
    await tx
      .update(importRows)
      .set({
        status: scored.status,
        plan: scored.plan,
        retailerId: scored.retailerId,
        variantId: scored.variantId,
        candidates: scored.candidates,
        normalized: scored.normalized,
        error: scored.error,
        entityType: null,
        entityId: null,
        updatedAt: new Date(),
      })
      .where(eq(importRows.id, row.id))
  }
  return stats
}

/** What a created row is worth, for the owner's comparison with the old software's total. */
function rowAmount(target: ImportTarget, values: Record<string, unknown> | null): number {
  if (!values) return 0
  if (target === 'opening_outstanding') return typeof values.amount === 'number' ? values.amount : 0
  if (target === 'brand_dms_invoices') {
    const qty = typeof values.qtyPcs === 'number' ? values.qtyPcs : 0
    const rate = typeof values.ratePaise === 'number' ? values.ratePaise : 0
    const discount = typeof values.discount === 'number' ? values.discount : 0
    const gst = typeof values.gstRate === 'number' ? values.gstRate : 0
    const taxable = Math.max(0, qty * rate - discount)
    return taxable + Math.round((taxable * gst) / 10_000)
  }
  return 0
}

const toCandidate = (
  entityType: 'retailer' | 'variant',
  c: { id: string; label: string; scoreBps: number },
): ImportMatchCandidate => ({ entityType, entityId: c.id, label: c.label, scoreBps: c.scoreBps })

async function resolveRow(
  tx: Db,
  services: ImportServices,
  target: ImportTarget,
  system: string | null,
  row: RowRecord,
  values: Record<string, unknown>,
  onFile: Map<string, { id: string }>,
  seen: SeenKeys,
): Promise<ScoredRow> {
  const normalized: Record<string, unknown> = { ...values }
  const candidates: ImportMatchCandidate[] = []
  let retailerId = row.retailerId
  let variantId = row.variantId
  const problems: string[] = []

  // A duplicate inside the file: the first occurrence wins, the rest are `skip` with a note.
  const key = dedupeKey(target, values)
  if (key) {
    const first = seen.get(key)
    if (first !== undefined && first !== row.rowNo)
      return {
        status: 'matched',
        plan: 'skip',
        retailerId,
        variantId,
        candidates: [],
        normalized,
        error: `duplicate of row ${String(first)} in this file`,
      }
    seen.set(key, row.rowNo)
  }

  // The party (every target but item_master).
  if (target !== 'item_master') {
    if (!retailerId) {
      const probe = {
        system,
        code: typeof values.partyCode === 'string' ? values.partyCode : null,
        phone: typeof values.phone === 'string' ? values.phone : null,
        gstin:
          typeof values.gstin === 'string'
            ? values.gstin
            : typeof values.buyerGstin === 'string'
              ? values.buyerGstin
              : null,
        name: typeof values.partyName === 'string' ? values.partyName : null,
      }
      const match = await services.retailers.matchRetailer(tx, probe)
      for (const c of match.candidates) candidates.push(toCandidate('retailer', c))
      if (match.match) {
        retailerId = match.match.id
        normalized.matchedBy = match.match.by
      } else if (target !== 'party_master' || match.candidates.length > 0) {
        problems.push(
          match.candidates.length > 0
            ? `${String(match.candidates.length)} similar shop${match.candidates.length > 1 ? 's' : ''} on file; pick one or none`
            : `no shop on file matches "${text(values.partyName) ?? text(values.partyCode) ?? ''}"`,
        )
      }
    }
    if (retailerId) normalized.retailerId = retailerId
  }

  // The item (item_master, sales_register, brand_dms_invoices).
  if (target === 'item_master' || target === 'sales_register' || target === 'brand_dms_invoices') {
    if (!variantId) {
      const match = await services.tenantCatalog.matchVariant(tx, {
        ean: typeof values.ean === 'string' ? values.ean : null,
        code: typeof values.itemCode === 'string' ? values.itemCode : null,
        name: typeof values.itemName === 'string' ? values.itemName : null,
        alias: typeof values.localAlias === 'string' ? values.localAlias : null,
      })
      for (const c of match.candidates) candidates.push(toCandidate('variant', c))
      if (match.match) {
        variantId = match.match.id
        normalized.matchedItemBy = match.match.by
      } else {
        problems.push(
          match.candidates.length > 0
            ? `${String(match.candidates.length)} similar item${match.candidates.length > 1 ? 's' : ''} in the catalog; pick one or none`
            : `no item in the catalog matches "${text(values.itemName) ?? text(values.itemCode) ?? text(values.ean) ?? ''}"`,
        )
      }
    }
    if (variantId) normalized.variantId = variantId
  }

  if (problems.length > 0)
    return {
      status: 'needs_review',
      plan: null,
      retailerId,
      variantId,
      candidates: candidates.slice(0, 5),
      normalized,
      error: problems.join('; '),
    }

  // Quantities in pieces, from the row's unit and the sell-side pack size.
  if (variantId && (target === 'sales_register' || target === 'brand_dms_invoices')) {
    const packs = await services.tenantCatalog.sellSidePackSizes(tx, [variantId])
    const pack = packs.get(variantId)
    const packSize = pack?.packSize ?? null
    const unit = typeof values.unit === 'string' ? values.unit : 'piece'
    const qty = typeof values.qty === 'number' ? values.qty : 0
    const pcs = quantityInPieces(qty, unit, packSize)
    if (pcs === null)
      return {
        status: 'error',
        plan: null,
        retailerId,
        variantId,
        candidates: [],
        normalized,
        error: `the quantity is in ${unit}s but the item has no pack size on file`,
      }
    normalized.qtyPcs = pcs
    normalized.packSize = packSize
    normalized.enteredUnit = unit
    if (typeof values.freeQty === 'number') {
      const free = quantityInPieces(values.freeQty, unit, packSize)
      normalized.freeQtyPcs = free ?? 0
    }
    if (typeof values.rate === 'number') {
      // A rate per case becomes a rate per piece, to the paisa (the invoice line is per piece).
      normalized.ratePaise =
        unit === 'piece' || !packSize ? values.rate : Math.round(values.rate / packSize)
    }
    if (pack && typeof values.hsnCode !== 'string') normalized.hsnCode = pack.hsnCode
    if (pack && typeof values.mrp !== 'number' && pack.mrpPaise !== null)
      normalized.mrp = pack.mrpPaise
  }

  // The plan.
  let plan: ImportRowPlan = 'create'
  let note: string | null = null
  switch (target) {
    case 'party_master':
      plan = retailerId ? 'update' : 'create'
      break
    case 'item_master': {
      const packs = await services.tenantCatalog.sellSidePackSizes(tx, variantId ? [variantId] : [])
      plan = variantId && packs.get(variantId)?.listed ? 'update' : 'create'
      break
    }
    case 'opening_outstanding':
    case 'brand_dms_invoices': {
      const no = typeof values.invoiceNo === 'string' ? values.invoiceNo : ''
      const existing = onFile.get(no)
      if (existing) {
        plan = 'skip'
        note = `bill ${no} is already on file (${existing.id})`
      }
      break
    }
    case 'sales_register':
      plan = 'create'
      break
  }
  return {
    status: 'matched',
    plan,
    retailerId,
    variantId,
    candidates: candidates.slice(0, 5),
    normalized,
    error: note,
  }
}

/**
 * The whole job, batch by batch, on the transaction handed in (the inline path: one request, one
 * transaction). Rows come in `row_no` order so the in-file duplicate rule ("the first wins") holds.
 */
export async function scoreAllRows(
  tx: Db,
  services: ImportServices,
  job: JobRow,
  mapping: ImportMapping,
  batchSize: number,
): Promise<ScoreStats> {
  const { tenantId } = currentTenant()
  const total = emptyStats()
  const seen: SeenKeys = new Map()
  let after = 0
  for (;;) {
    const batch = await tx
      .select()
      .from(importRows)
      .where(
        and(
          eq(importRows.tenantId, tenantId),
          eq(importRows.importJobId, job.id),
          gt(importRows.rowNo, after),
        ),
      )
      .orderBy(asc(importRows.rowNo))
      .limit(batchSize)
    if (batch.length === 0) break
    const stats = await scoreRows(tx, services, job, mapping, batch, seen)
    mergeStats(total, stats)
    after = batch[batch.length - 1]?.rowNo ?? after
    if (batch.length < batchSize) break
  }
  return total
}

export function mergeStats(into: ScoreStats, from: ScoreStats): void {
  into.rows += from.rows
  into.create += from.create
  into.update += from.update
  into.skip += from.skip
  into.needsReview += from.needsReview
  into.errors += from.errors
  into.amountPaise += from.amountPaise
  for (const e of from.sampleErrors) {
    if (into.sampleErrors.length >= DRY_RUN_SAMPLE_ERRORS) break
    into.sampleErrors.push(e)
  }
}

export function summaryFrom(
  stats: ScoreStats,
  target: ImportTarget,
  startedAt: string,
  finishedAt: string | null,
): DryRunSummary {
  const money = target === 'opening_outstanding' || target === 'brand_dms_invoices'
  return {
    status: finishedAt ? 'done' : 'running',
    startedAt,
    finishedAt,
    rows: stats.rows,
    willCreate: stats.create,
    willUpdate: stats.update,
    willSkip: stats.skip,
    needsReview: stats.needsReview,
    errors: stats.errors,
    amountPaise: money ? stats.amountPaise : null,
    sampleErrors: stats.sampleErrors,
  }
}

/** The mapping problems a dry run refuses on, as one English sentence. */
export function mappingProblemsMessage(
  mapping: ImportMapping,
  target: ImportTarget,
): string | null {
  const problems = validateMappingForTarget(mapping, target)
  if (problems.length === 0) return null
  return problems.map((p) => p.message).join('; ')
}

/** Row status counts of a job, one grouped query. */
export async function rowCounts(tx: Db, jobId: string): Promise<Record<ImportRowStatus, number>> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ status: importRows.status, n: sql<number>`count(*)::int` })
    .from(importRows)
    .where(and(eq(importRows.tenantId, tenantId), eq(importRows.importJobId, jobId)))
    .groupBy(importRows.status)
  const counts: Record<ImportRowStatus, number> = {
    staged: 0,
    matched: 0,
    needs_review: 0,
    committed: 0,
    skipped: 0,
    error: 0,
  }
  for (const r of rows) counts[r.status] = Number(r.n)
  return counts
}

/** Put every row of a job back to `staged` (a new mapping): plan, candidates and errors cleared, pins and overrides kept. */
export async function resetRows(tx: Db, jobId: string): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(importRows)
    .set({
      status: 'staged',
      plan: null,
      candidates: [],
      normalized: null,
      error: null,
      entityType: null,
      entityId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(importRows.tenantId, tenantId),
        eq(importRows.importJobId, jobId),
        inArray(importRows.status, ['staged', 'matched', 'needs_review', 'error']),
      ),
    )
}
