import { and, eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { beats, externalPartyCodes, retailerPurchaseHistory, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { nextRetailerCode } from './retailers.helpers.js'

/**
 * The retailer side of the generic importer (docs/plans/00-coordination.md §3.9 and §4: integrations
 * calls `RetailersService.upsert / linkExternalCode / recordPurchaseHistory` and never touches
 * `retailers`, `external_party_codes` or `retailer_purchase_history` itself — this file is the first
 * writer of the last two, docs/17 A7 and A11).
 *
 * Plain, transaction-scoped functions: the import commit runs one row per transaction, in the API
 * and in the worker alike, so nothing here opens a transaction of its own or needs Nest DI. What is
 * deliberately ABSENT: any credit term — a bulk file never sets a limit, days, a tier or a mode
 * (`retailers.setCredit`, one shop at a time, with its audit trail).
 */

export interface RetailerProbe {
  /** The old software (`external_party_codes.system`) a code is remembered under. */
  system?: string | null | undefined
  code?: string | null | undefined
  phone?: string | null | undefined
  gstin?: string | null | undefined
  name?: string | null | undefined
}

export interface RetailerCandidate {
  id: string
  /** "R-0012 · Shree Ganesh Kirana · +9198…": what the review screen shows. */
  label: string
  scoreBps: number
  by: 'code' | 'phone' | 'gstin' | 'name'
}

export interface RetailerMatch {
  /** A match the importer may act on without a human: an exact code / phone / GSTIN hit, or one clear name. */
  match: RetailerCandidate | null
  candidates: RetailerCandidate[]
}

/** Below this trigram similarity a name is not even offered. */
const NAME_FLOOR = 0.55
/** A single name at or above this, with the runner-up this far behind, resolves on its own. */
const NAME_AUTO = 0.9
const NAME_GAP = 0.15

const labelOf = (r: { code: string; name: string; phone: string }): string =>
  `${r.code} · ${r.name} · ${r.phone}`

/** Exact code → phone → GSTIN, then a trigram name search; never two close names silently picked. */
export async function matchRetailer(
  tx: Db,
  probe: RetailerProbe,
  limit = 5,
): Promise<RetailerMatch> {
  const { tenantId } = currentTenant()
  const active = and(eq(retailers.tenantId, tenantId), eq(retailers.active, true))
  const cols = {
    id: retailers.id,
    code: retailers.code,
    name: retailers.name,
    phone: retailers.phone,
  }
  const candidates: RetailerCandidate[] = []
  const seen = new Set<string>()
  const push = (c: RetailerCandidate): void => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    candidates.push(c)
  }

  if (probe.system && probe.code) {
    const [hit] = await tx
      .select(cols)
      .from(externalPartyCodes)
      .innerJoin(retailers, eq(retailers.id, externalPartyCodes.retailerId))
      .where(
        and(
          eq(externalPartyCodes.tenantId, tenantId),
          eq(externalPartyCodes.system, probe.system),
          eq(externalPartyCodes.code, probe.code),
        ),
      )
      .limit(1)
    if (hit) {
      const c: RetailerCandidate = { id: hit.id, label: labelOf(hit), scoreBps: 10_000, by: 'code' }
      return { match: c, candidates: [c] }
    }
  }
  if (probe.phone) {
    const rows = await tx
      .select(cols)
      .from(retailers)
      .where(and(active, eq(retailers.phone, probe.phone)))
      .limit(2)
    if (rows.length === 1 && rows[0]) {
      const c: RetailerCandidate = {
        id: rows[0].id,
        label: labelOf(rows[0]),
        scoreBps: 9_800,
        by: 'phone',
      }
      return { match: c, candidates: [c] }
    }
    for (const r of rows) push({ id: r.id, label: labelOf(r), scoreBps: 9_000, by: 'phone' })
  }
  if (probe.gstin) {
    const rows = await tx
      .select(cols)
      .from(retailers)
      .where(and(active, eq(retailers.gstin, probe.gstin)))
      .limit(2)
    if (rows.length === 1 && rows[0] && candidates.length === 0) {
      const c: RetailerCandidate = {
        id: rows[0].id,
        label: labelOf(rows[0]),
        scoreBps: 9_700,
        by: 'gstin',
      }
      return { match: c, candidates: [c] }
    }
    for (const r of rows) push({ id: r.id, label: labelOf(r), scoreBps: 9_000, by: 'gstin' })
  }
  if (probe.name && probe.name.trim().length >= 3) {
    const q = probe.name.trim()
    const rows = await tx
      .select({ ...cols, score: sql<number>`similarity(${retailers.name}, ${q})` })
      .from(retailers)
      .where(and(active, sql`similarity(${retailers.name}, ${q}) >= ${NAME_FLOOR}`))
      .orderBy(sql`similarity(${retailers.name}, ${q}) desc`, retailers.id)
      .limit(limit)
    const scored = rows.map((r) => ({
      id: r.id,
      label: labelOf(r),
      scoreBps: Math.round(Number(r.score) * 10_000),
      by: 'name' as const,
    }))
    const top = scored[0]
    const second = scored[1]
    const clear =
      top !== undefined &&
      candidates.length === 0 &&
      top.scoreBps >= NAME_AUTO * 10_000 &&
      (second === undefined || top.scoreBps - second.scoreBps >= NAME_GAP * 10_000)
    for (const c of scored) push(c)
    if (clear && top) return { match: top, candidates: candidates.slice(0, limit) }
  }
  return { match: null, candidates: candidates.slice(0, limit) }
}

/** What an import may write on a shop — never a rupee of credit. */
export interface RetailerImportValues {
  name: string
  ownerName?: string | null | undefined
  phone: string
  gstin?: string | null | undefined
  pan?: string | null | undefined
  address?: Record<string, string> | null | undefined
  stateCode: string
  beatId?: string | null | undefined
  tallyLedgerName?: string | null | undefined
}

/** The columns an update touches, kept on the row so a rollback restores them exactly. */
export interface RetailerSnapshot {
  name: string
  ownerName: string | null
  phone: string
  gstin: string | null
  gstRegType: 'unregistered' | 'regular' | 'composition'
  pan: string | null
  address: unknown
  stateCode: string
  beatId: string | null
  tallyLedgerName: string | null
  active: boolean
}

export interface RetailerImportResult {
  id: string
  created: boolean
  before: RetailerSnapshot | null
}

function snapshot(row: typeof retailers.$inferSelect): RetailerSnapshot {
  return {
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    gstin: row.gstin,
    gstRegType: row.gstRegType,
    pan: row.pan,
    address: row.address,
    stateCode: row.stateCode,
    beatId: row.beatId,
    tallyLedgerName: row.tallyLedgerName,
    active: row.active,
  }
}

/**
 * Create the shop (`retailerId` null; the id is the caller's, so a replay lands on the same row) or
 * update the one the row matched. An update only touches the fields the file carries (an empty
 * `ownerName` in the file does not blank the one on record); the `before` snapshot is what a
 * rollback puts back.
 */
export async function upsertRetailerFromImport(
  tx: Db,
  input: { retailerId: string | null; newId: string; values: RetailerImportValues },
): Promise<RetailerImportResult> {
  const { tenantId, actorId } = currentTenant()
  const v = input.values
  const gstRegType = v.gstin ? ('regular' as const) : undefined
  if (input.retailerId) {
    const [existing] = await tx
      .select()
      .from(retailers)
      .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, input.retailerId)))
      .for('update')
    if (!existing) throw new Error(`retailer ${input.retailerId} not found`)
    const patch: Partial<typeof retailers.$inferInsert> = {
      name: v.name,
      phone: v.phone,
      stateCode: v.stateCode,
      updatedAt: new Date(),
    }
    if (v.ownerName != null) patch.ownerName = v.ownerName
    if (v.gstin != null) {
      patch.gstin = v.gstin
      patch.gstRegType = 'regular'
    }
    if (v.pan != null) patch.pan = v.pan
    if (v.address != null) patch.address = v.address
    if (v.beatId != null) patch.beatId = v.beatId
    if (v.tallyLedgerName != null) patch.tallyLedgerName = v.tallyLedgerName
    await tx.update(retailers).set(patch).where(eq(retailers.id, existing.id))
    return { id: existing.id, created: false, before: snapshot(existing) }
  }
  const [already] = await tx
    .select({ id: retailers.id })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, input.newId)))
    .limit(1)
  if (already) return { id: already.id, created: true, before: null }
  await tx.insert(retailers).values({
    id: input.newId,
    tenantId,
    code: await nextRetailerCode(tx, tenantId),
    name: v.name,
    ownerName: v.ownerName ?? null,
    phone: v.phone,
    gstin: v.gstin ?? null,
    gstRegType: gstRegType ?? 'unregistered',
    pan: v.pan ?? null,
    address: v.address ?? null,
    stateCode: v.stateCode,
    beatId: v.beatId ?? null,
    tallyLedgerName: v.tallyLedgerName ?? null,
    onboardedBy: actorId,
  })
  return { id: input.newId, created: true, before: null }
}

/** A rollback: the fields an `update` commit changed, put back exactly. */
export async function restoreRetailer(tx: Db, id: string, before: RetailerSnapshot): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(retailers)
    .set({
      name: before.name,
      ownerName: before.ownerName,
      phone: before.phone,
      gstin: before.gstin,
      gstRegType: before.gstRegType,
      pan: before.pan,
      address: before.address,
      stateCode: before.stateCode,
      beatId: before.beatId,
      tallyLedgerName: before.tallyLedgerName,
      active: before.active,
      updatedAt: new Date(),
    })
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, id)))
}

/** A rollback of a `create`: the shop is deactivated, never deleted (rows may already point at it). */
export async function deactivateRetailer(tx: Db, id: string): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(retailers)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, id)))
}

/**
 * Remember "code X in system S is this shop" (docs/17 A7), so the next file auto-matches. A code
 * already on file is re-pointed — the human just pinned it — and the previous holder is reported
 * so a rollback can restore it.
 */
export async function linkExternalCode(
  tx: Db,
  input: { id?: string | undefined; system: string; code: string; retailerId: string },
): Promise<{ id: string; created: boolean; previousRetailerId: string | null }> {
  const { tenantId } = currentTenant()
  const [existing] = await tx
    .select({ id: externalPartyCodes.id, retailerId: externalPartyCodes.retailerId })
    .from(externalPartyCodes)
    .where(
      and(
        eq(externalPartyCodes.tenantId, tenantId),
        eq(externalPartyCodes.system, input.system),
        eq(externalPartyCodes.code, input.code),
      ),
    )
    .limit(1)
  if (existing) {
    if (existing.retailerId !== input.retailerId)
      await tx
        .update(externalPartyCodes)
        .set({ retailerId: input.retailerId, updatedAt: new Date() })
        .where(eq(externalPartyCodes.id, existing.id))
    return {
      id: existing.id,
      created: false,
      previousRetailerId: existing.retailerId === input.retailerId ? null : existing.retailerId,
    }
  }
  const id = input.id ?? uuidv7()
  await tx
    .insert(externalPartyCodes)
    .values({ id, tenantId, system: input.system, code: input.code, retailerId: input.retailerId })
  return { id, created: true, previousRetailerId: null }
}

/** A rollback: codes a run learned are forgotten again. */
export async function removeExternalCodes(tx: Db, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { tenantId } = currentTenant()
  const removed = await tx
    .delete(externalPartyCodes)
    .where(and(eq(externalPartyCodes.tenantId, tenantId), inArray(externalPartyCodes.id, [...ids])))
    .returning({ id: externalPartyCodes.id })
  return removed.length
}

export interface PurchaseHistoryRow {
  id: string
  retailerId: string
  variantId: string
  invoiceNo: string | null
  invoiceDate: string
  qtyPcs: number
  ratePaise: number | null
  importJobId: string
}

/** Migrated bill lines for the suggested-order engine (docs/17 A11): no ledger effect, no invoice, no stock. */
export async function recordPurchaseHistory(
  tx: Db,
  rows: readonly PurchaseHistoryRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const { tenantId } = currentTenant()
  const inserted = await tx
    .insert(retailerPurchaseHistory)
    .values(rows.map((r) => ({ ...r, tenantId, source: 'migration' })))
    .onConflictDoNothing()
    .returning({ id: retailerPurchaseHistory.id })
  return inserted.length
}

/** A rollback: the history a run wrote is removed (it was never money). */
export async function removePurchaseHistory(tx: Db, importJobId: string): Promise<number> {
  const { tenantId } = currentTenant()
  const removed = await tx
    .delete(retailerPurchaseHistory)
    .where(
      and(
        eq(retailerPurchaseHistory.tenantId, tenantId),
        eq(retailerPurchaseHistory.importJobId, importJobId),
      ),
    )
    .returning({ id: retailerPurchaseHistory.id })
  return removed.length
}

/** The beat a file names, by its exact name (case-insensitive); an unknown beat leaves the shop unassigned. */
export async function findBeatByName(tx: Db, name: string): Promise<string | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: beats.id })
    .from(beats)
    .where(and(eq(beats.tenantId, tenantId), sql`lower(${beats.name}) = lower(${name.trim()})`))
    .limit(1)
  return row?.id ?? null
}

/** "R-0012 · Shree Ganesh Kirana · +91…" for a set of shops, one query. */
export async function retailerLabels(
  tx: Db,
  ids: readonly string[],
): Promise<
  Map<string, { label: string; name: string; tallyLedgerName: string | null; gstin: string | null }>
> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      id: retailers.id,
      code: retailers.code,
      name: retailers.name,
      phone: retailers.phone,
      tallyLedgerName: retailers.tallyLedgerName,
      gstin: retailers.gstin,
    })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), inArray(retailers.id, unique)))
  return new Map(
    rows.map((r) => [
      r.id,
      { label: labelOf(r), name: r.name, tallyLedgerName: r.tallyLedgerName, gstin: r.gstin },
    ]),
  )
}
