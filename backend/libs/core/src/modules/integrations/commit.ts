import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { ImportTarget } from '@dos/contracts'
import { importJobs, importRows, withTenant, type Db, type TenantContext } from '@dos/db'
import { currentTenant, idempotent, tenantStorage } from '../../platform/index.js'
import type { RetailerSnapshot } from '../retailers/index.js'
import type { ListingSnapshot } from '../tenant-catalog/index.js'
import {
  emitIntegrationsEvent,
  entityIdFor,
  friendlyMessage,
  IMPORT_COMMITTED_EVENT,
  jobTransition,
} from './integrations.internals.js'
import { rowCounts } from './scoring.js'
import type { ImportServices } from './services.js'

/**
 * COMMIT AND ROLLBACK — the two ends of the reversible window (docs/17 §D7).
 *
 * Commit applies the `matched` rows through the owning modules' services, ONE ROW (or one brand-DMS
 * invoice, which is several rows) PER TRANSACTION keyed `import:<jobId>:<rowNo>`: one bad row of 5,000
 * never rolls back the other 4,999, and a crash mid-run is healed by running commit again — every
 * entity id is derived from (job, row), so the replay lands on the row it created. The outcome of a
 * row (`status`, `entityId`, the `before` snapshot, the `effects`) is written in the same transaction
 * as the entity, so the two can never disagree.
 *
 * Rollback undoes what commit did, in one transaction, newest row first: opening and brand-DMS bills
 * are cancelled through the invoice machine with the mirror journal entry (ledgers are append-only;
 * nothing is deleted from the books), shops and listings the run CREATED are deactivated / unlisted,
 * ones it UPDATED are restored from `before`, purchase history and learned codes are removed. Rows
 * keep their status and entity for the audit trail; the job says `rolled_back`.
 */

type RowRecord = typeof importRows.$inferSelect
type JobRecord = typeof importJobs.$inferSelect

interface CommitOutcome {
  entityType: string
  entityId: string
  before: unknown
  effects: Record<string, unknown>
  /** Rows of the unit that share the outcome (a brand-DMS invoice's lines). */
  rowIds: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function addressOf(v: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {}
  const line1 = str(v.addressLine1)
  const line2 = str(v.addressLine2)
  const area = str(v.area)
  const city = str(v.city)
  const pincode = str(v.pincode)
  if (line1) out.line1 = line1
  if (line2) out.line2 = line2
  if (area) out.area = area
  if (city) out.city = city
  if (pincode && /^\d{6}$/.test(pincode)) out.pincode = pincode
  return Object.keys(out).length > 0 ? out : null
}

// ---------------------------------------------------------------------------------------------------------------
// one unit

async function rememberCode(
  tx: Db,
  services: ImportServices,
  job: JobRecord,
  values: Record<string, unknown>,
  retailerId: string,
  effects: Record<string, unknown>,
): Promise<void> {
  const system = job.kind === 'excel' || job.kind === 'other' ? null : job.kind
  const code = str(values.partyCode)
  if (!system || !code || values.matchedBy === 'code') return
  const linked = await services.retailers.linkExternalCode(tx, {
    id: entityIdFor(job.id, 0, `code:${system}:${code}`),
    system,
    code,
    retailerId,
  })
  if (linked.created) effects.externalCodeId = linked.id
  else if (linked.previousRetailerId)
    effects.externalCodeRepointed = { system, code, from: linked.previousRetailerId }
}

async function commitUnit(
  tx: Db,
  services: ImportServices,
  job: JobRecord,
  rows: readonly RowRecord[],
): Promise<CommitOutcome> {
  const target = job.target as ImportTarget
  const first = rows[0]
  if (!first) throw new Error('empty unit')
  const values = (first.normalized ?? {}) as Record<string, unknown>
  const effects: Record<string, unknown> = {}
  switch (target) {
    case 'party_master': {
      const beatName = str(values.beatName)
      const beatId = beatName ? await services.retailers.findBeatByName(tx, beatName) : null
      const result = await services.retailers.upsertFromImport(tx, {
        retailerId: first.retailerId,
        newId: entityIdFor(job.id, first.rowNo, 'retailer'),
        values: {
          name: str(values.partyName) ?? '',
          ownerName: str(values.ownerName),
          phone: str(values.phone) ?? '',
          gstin: str(values.gstin),
          pan: str(values.pan),
          address: addressOf(values),
          stateCode: str(values.stateCode) ?? '',
          beatId,
          tallyLedgerName: str(values.tallyLedgerName),
        },
      })
      await rememberCode(tx, services, job, values, result.id, effects)
      effects.created = result.created
      return {
        entityType: 'retailer',
        entityId: result.id,
        before: result.before,
        effects,
        rowIds: [first.id],
      }
    }
    case 'item_master': {
      if (!first.variantId) throw new ORPCError('BAD_REQUEST', { message: 'the row has no item' })
      const result = await services.tenantCatalog.upsertListingFromImport(tx, {
        variantId: first.variantId,
        newId: entityIdFor(job.id, first.rowNo, 'listing'),
        values: { localAlias: str(values.localAlias), caseSizeOverride: num(values.caseSize) },
      })
      effects.created = result.created
      return {
        entityType: 'tenant_product',
        entityId: result.id,
        before: result.before,
        effects,
        rowIds: [first.id],
      }
    }
    case 'opening_outstanding': {
      if (!first.retailerId) throw new ORPCError('BAD_REQUEST', { message: 'the row has no shop' })
      const invoiceId = entityIdFor(job.id, first.rowNo, 'invoice')
      const invoice = await services.billing.recordOpeningInvoice(tx, {
        id: invoiceId,
        retailerId: first.retailerId,
        externalInvoiceNo: str(values.invoiceNo) ?? '',
        invoiceDate: str(values.invoiceDate) ?? '',
        amountPaise: num(values.amount) ?? 0,
        importJobId: job.id,
        dueDate: str(values.dueDate),
      })
      effects.journalEntryId = await services.receivables.entryIdByRef(tx, 'opening', invoice.id)
      await rememberCode(tx, services, job, values, first.retailerId, effects)
      return {
        entityType: 'invoice',
        entityId: invoice.id,
        before: null,
        effects,
        rowIds: [first.id],
      }
    }
    case 'sales_register': {
      if (!first.retailerId || !first.variantId)
        throw new ORPCError('BAD_REQUEST', { message: 'the row has no shop or no item' })
      const id = entityIdFor(job.id, first.rowNo, 'history')
      await services.retailers.recordPurchaseHistory(tx, [
        {
          id,
          retailerId: first.retailerId,
          variantId: first.variantId,
          invoiceNo: str(values.invoiceNo),
          invoiceDate: str(values.invoiceDate) ?? '',
          qtyPcs: num(values.qtyPcs) ?? num(values.qty) ?? 0,
          ratePaise: num(values.ratePaise),
          importJobId: job.id,
        },
      ])
      await rememberCode(tx, services, job, values, first.retailerId, effects)
      return {
        entityType: 'purchase_history',
        entityId: id,
        before: null,
        effects,
        rowIds: [first.id],
      }
    }
    case 'brand_dms_invoices': {
      if (!first.retailerId) throw new ORPCError('BAD_REQUEST', { message: 'the row has no shop' })
      const labels = await services.tenantCatalog.variantLabels(
        tx,
        rows.map((r) => r.variantId ?? '').filter((v) => v !== ''),
      )
      const invoiceId = entityIdFor(job.id, first.rowNo, 'invoice')
      const invoice = await services.billing.importBrandDms(tx, {
        idempotencyKey: `import:${job.id}:${String(first.rowNo)}:brand-dms`,
        id: invoiceId,
        retailerId: first.retailerId,
        externalInvoiceNo: str(values.invoiceNo) ?? '',
        invoiceDate: str(values.invoiceDate) ?? '',
        ...(str(values.buyerGstin) ? { buyerGstin: str(values.buyerGstin) ?? '' } : {}),
        placeOfSupplyState: str(values.placeOfSupplyState) ?? '',
        roundOffPaise: 0,
        lines: rows.map((r, index) => {
          const v = (r.normalized ?? {}) as Record<string, unknown>
          if (!r.variantId)
            throw new ORPCError('BAD_REQUEST', { message: `row ${String(r.rowNo)} has no item` })
          const unit = str(v.enteredUnit) ?? 'piece'
          return {
            id: entityIdFor(job.id, r.rowNo, 'line'),
            variantId: r.variantId,
            description: (str(v.itemName) ?? labels.get(r.variantId) ?? 'item').slice(0, 200),
            hsnCode: str(v.hsnCode) ?? '',
            qtyPcs: num(v.qtyPcs) ?? 0,
            freeQtyPcs: num(v.freeQtyPcs) ?? 0,
            ratePaise: num(v.ratePaise) ?? 0,
            discountPaise: num(v.discount) ?? 0,
            gstBps: num(v.gstRate) ?? 0,
            cessBps: 0,
            ...(str(v.batchNo) ? { batchNo: str(v.batchNo) ?? '' } : {}),
            ...(str(v.expiryDate) ? { expiryDate: str(v.expiryDate) ?? '' } : {}),
            ...(num(v.mrp) !== null ? { mrpPaise: num(v.mrp) ?? 0 } : {}),
            enteredQty: num(v.qty) ?? num(v.qtyPcs) ?? 0,
            enteredUnit: unit === 'case' ? 'case' : unit === 'inner' ? 'inner' : 'piece',
            ...(num(v.packSize) !== null ? { packSizeAtEntry: num(v.packSize) ?? 1 } : {}),
            ...(index === 0 ? {} : {}),
          }
        }),
      })
      effects.journalEntryId = await services.receivables.entryIdByRef(tx, 'invoice', invoice.id)
      await rememberCode(tx, services, job, values, first.retailerId, effects)
      return {
        entityType: 'invoice',
        entityId: invoice.id,
        before: null,
        effects,
        rowIds: rows.map((r) => r.id),
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the run

interface Unit {
  rowNo: number
  rowIds: string[]
}

/** Rows in `row_no` order, folded into units: one per row, or one per brand-DMS invoice number. */
async function matchedUnits(tx: Db, job: JobRecord): Promise<{ units: Unit[]; skipped: number }> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      id: importRows.id,
      rowNo: importRows.rowNo,
      status: importRows.status,
      plan: importRows.plan,
      invoiceNo: sql<string | null>`${importRows.normalized} ->> 'invoiceNo'`,
    })
    .from(importRows)
    .where(and(eq(importRows.tenantId, tenantId), eq(importRows.importJobId, job.id)))
    .orderBy(asc(importRows.rowNo))
  let skipped = 0
  if (job.target !== 'brand_dms_invoices') {
    const units: Unit[] = []
    for (const r of rows) {
      if (r.status !== 'matched') continue
      if (r.plan === 'skip') {
        await tx
          .update(importRows)
          .set({ status: 'skipped', updatedAt: new Date() })
          .where(eq(importRows.id, r.id))
        skipped++
        continue
      }
      units.push({ rowNo: r.rowNo, rowIds: [r.id] })
    }
    return { units, skipped }
  }
  // A brand-DMS invoice commits as a whole: every line of the number must be matched and not `skip`.
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.invoiceNo ?? `row:${String(r.rowNo)}`
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  const units: Unit[] = []
  for (const [no, group] of groups) {
    const matched = group.filter((r) => r.status === 'matched')
    if (matched.length === 0) continue
    const unresolved = group.find((r) => r.status === 'needs_review' || r.status === 'error')
    const dup = matched.find((r) => r.plan === 'skip')
    if (unresolved || dup) {
      const why = unresolved
        ? `invoice ${no} has an unresolved line (row ${String(unresolved.rowNo)})`
        : dup?.plan === 'skip'
          ? `bill ${no} is already on file`
          : 'skipped'
      await tx
        .update(importRows)
        .set({ status: 'skipped', error: why, updatedAt: new Date() })
        .where(
          inArray(
            importRows.id,
            matched.map((r) => r.id),
          ),
        )
      skipped += matched.length
      continue
    }
    units.push({ rowNo: matched[0]?.rowNo ?? 0, rowIds: matched.map((r) => r.id) })
  }
  return { units, skipped }
}

export interface CommitRunResult {
  committed: number
  errors: number
  skipped: number
  status: string
}

/**
 * Walk the matched rows of a `running` job and finish it `committed` (or `failed` when the run itself
 * cannot proceed). Called by the API right after `imports.commit` (inline mode) and by the worker.
 */
export async function runCommit(
  db: Db,
  ctx: TenantContext,
  services: ImportServices,
  jobId: string,
): Promise<CommitRunResult> {
  return tenantStorage.run(ctx, async () => {
    const start = await withTenant(db, ctx, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.tenantId, ctx.tenantId), eq(importJobs.id, jobId)))
        .limit(1)
      if (!job) throw new ORPCError('NOT_FOUND', { message: `import ${jobId} not found` })
      if (job.status === 'committed') return { job, units: [] as Unit[], skipped: 0, replay: true }
      if (job.status !== 'running')
        throw new ORPCError('CONFLICT', { message: `the import is ${job.status}, not running` })
      const { units, skipped } = await matchedUnits(tx, job)
      return { job, units, skipped, replay: false }
    })
    if (start.replay) {
      const counts = await withTenant(db, ctx, (tx) => rowCounts(tx, jobId))
      return {
        committed: counts.committed,
        errors: counts.error,
        skipped: counts.skipped,
        status: 'committed',
      }
    }
    const job = start.job
    let committed = 0
    let errors = 0
    for (const unit of start.units) {
      const key = `import:${job.id}:${String(unit.rowNo)}`
      try {
        await withTenant(db, ctx, (tx) =>
          idempotent(tx, key, { jobId: job.id, rowNo: unit.rowNo }, async () => {
            const rows = await tx
              .select()
              .from(importRows)
              .where(inArray(importRows.id, unit.rowIds))
              .orderBy(asc(importRows.rowNo))
            if (rows.every((r) => r.status === 'committed')) return { replay: true }
            const outcome = await commitUnit(tx, services, job, rows)
            await tx
              .update(importRows)
              .set({
                status: 'committed',
                entityType: outcome.entityType,
                entityId: outcome.entityId,
                error: null,
                updatedAt: new Date(),
              })
              .where(inArray(importRows.id, outcome.rowIds))
            // The snapshot and the effects live on the unit's first row: that is the row a rollback
            // reads. Effects a review already recorded (a code learned when the row was pinned) are kept.
            const first = rows.find((r) => r.id === unit.rowIds[0])
            const priorEffects = (first?.effects as Record<string, unknown> | null) ?? {}
            await tx
              .update(importRows)
              .set({ before: outcome.before, effects: { ...priorEffects, ...outcome.effects } })
              .where(eq(importRows.id, unit.rowIds[0] ?? ''))
            return { replay: false }
          }),
        )
        committed += unit.rowIds.length
      } catch (error) {
        errors += unit.rowIds.length
        const message = friendlyMessage(error)
        await withTenant(db, ctx, (tx) =>
          tx
            .update(importRows)
            .set({ status: 'error', error: message, updatedAt: new Date() })
            .where(inArray(importRows.id, unit.rowIds)),
        )
      }
    }
    const status = await withTenant(db, ctx, async (tx) => {
      const counts = await rowCounts(tx, job.id)
      const [fresh] = await tx
        .select({ status: importJobs.status })
        .from(importJobs)
        .where(eq(importJobs.id, job.id))
        .for('update')
      const from = fresh?.status ?? job.status
      if (from !== 'running') return from
      const to = jobTransition(from, 'committed')
      await tx
        .update(importJobs)
        .set({
          status: to,
          okRows: counts.committed,
          errorRows: counts.error,
          committedAt: new Date(),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, job.id))
      await emitIntegrationsEvent(tx, 'import_job', job.id, IMPORT_COMMITTED_EVENT, {
        importJobId: job.id,
        source: job.kind,
        target: job.target,
        okRows: counts.committed,
        errorRows: counts.error,
        skippedRows: counts.skipped,
      })
      return to
    })
    return { committed, errors, skipped: start.skipped, status }
  })
}

/** The run could not proceed at all (the worker crashed, the mapping vanished): the job is `failed`, its rows untouched. */
export async function failRun(
  db: Db,
  ctx: TenantContext,
  jobId: string,
  error: unknown,
): Promise<void> {
  await tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const [job] = await tx
        .select({ status: importJobs.status })
        .from(importJobs)
        .where(eq(importJobs.id, jobId))
        .for('update')
      if (!job || job.status !== 'running') return
      await tx
        .update(importJobs)
        .set({
          status: jobTransition(job.status, 'fail'),
          error: friendlyMessage(error),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId))
    }),
  )
}

// ---------------------------------------------------------------------------------------------------------------
// rollback

export interface RollbackResult {
  reversedRows: number
  reversedByEntity: Record<string, number>
}

/** Undo every committed unit of the job, newest first, inside the caller's transaction (the handler owns the job's state). */
export async function rollbackRows(
  tx: Db,
  services: ImportServices,
  job: JobRecord,
  reason: string,
): Promise<RollbackResult> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.tenantId, tenantId),
        eq(importRows.importJobId, job.id),
        eq(importRows.status, 'committed'),
      ),
    )
    .orderBy(desc(importRows.rowNo))
  const target = job.target as ImportTarget
  const byEntity: Record<string, number> = {}
  const bump = (kind: string, n = 1): void => {
    byEntity[kind] = (byEntity[kind] ?? 0) + n
  }
  const doneEntities = new Set<string>()
  const codeIds: string[] = []
  let reversedRows = 0
  for (const row of rows) {
    if (!row.entityId) continue
    const effects = (row.effects ?? {}) as Record<string, unknown>
    if (typeof effects.externalCodeId === 'string') codeIds.push(effects.externalCodeId)
    const repointed = effects.externalCodeRepointed as
      { system?: string; code?: string; from?: string } | undefined
    if (repointed?.system && repointed.code && repointed.from) {
      // The code pointed at another shop before this run re-pointed it: point it back.
      await services.retailers.linkExternalCode(tx, {
        system: repointed.system,
        code: repointed.code,
        retailerId: repointed.from,
      })
      bump('external_party_code_restored')
    }
    reversedRows++
    if (doneEntities.has(row.entityId)) continue
    doneEntities.add(row.entityId)
    switch (target) {
      case 'party_master':
        if (effects.created === true) {
          await services.retailers.deactivateFromImport(tx, row.entityId)
          bump('retailer_deactivated')
        } else if (row.before) {
          await services.retailers.restoreFromImport(
            tx,
            row.entityId,
            row.before as RetailerSnapshot,
          )
          bump('retailer_restored')
        }
        break
      case 'item_master':
        if (effects.created === true) {
          await services.tenantCatalog.unlistListing(tx, row.entityId)
          bump('listing_unlisted')
        } else if (row.before) {
          await services.tenantCatalog.restoreListing(
            tx,
            row.entityId,
            row.before as ListingSnapshot,
          )
          bump('listing_restored')
        }
        break
      case 'opening_outstanding':
      case 'brand_dms_invoices': {
        const cancelled = await services.billing.cancelImported(tx, {
          invoiceId: row.entityId,
          reason: `import rollback: ${reason}`.slice(0, 200),
        })
        bump('invoice')
        if (cancelled.reversalEntryId) bump('journal_entry')
        break
      }
      case 'sales_register':
        // Removed in one statement below; counted here.
        bump('purchase_history')
        break
    }
  }
  if (target === 'sales_register') {
    const removed = await services.retailers.removePurchaseHistory(tx, job.id)
    byEntity.purchase_history = removed
  }
  if (codeIds.length > 0)
    bump('external_party_code', await services.retailers.removeExternalCodes(tx, codeIds))
  return { reversedRows, reversedByEntity: byEntity }
}
