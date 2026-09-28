/**
 * NO PLACE GOES BELOW ZERO (QA DOS-350, architect ruling 1, 2026-09-28) — the release check's reads.
 *
 * The damaged / expiry bin was created with `negative_allowed = true`, so a hand transfer of 70 pieces out of a
 * bin that held 20 put 50 pieces that never existed into the godown, sellable. Migration 0075 cleared the flag on
 * every bin and on every balance row at zero or more, and refuses it from then on; a balance that was ALREADY below
 * zero kept its flag (clearing it would fail the CHECK), and nothing was written to the ledger for it: only a count
 * can say what is really there. This file names those balances, with the item, the batch and the place, for the
 * owner to count — `pnpm check:stock-negative` prints them and exits 1 while there is one.
 *
 * It also lists what DOS-356 left behind: posted receipt lines whose printed expiry is not their lot's, because
 * before migration 0074 a receipt joined a lot of the same item, batch and MRP whatever its expiry. Those lots are
 * not split (which of their pieces are the early ones cannot be known from the books); the owner counts them.
 *
 * The definitions live in SQL (`dos_stock_below_zero`, `dos_receipts_merged_across_expiry`, migration 0075), read
 * as the system role so the check sees every tenant whatever role the URL holds.
 */
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from './client.js'

/** One balance below zero, named. */
export interface BelowZeroBalance {
  tenantId: string
  tenantSlug: string
  lotId: string
  variantName: string
  batchNo: string
  expiryDate: string | null
  locationId: string
  locationName: string
  locationKind: string
  onHandPcs: number
  reservedPcs: number
  /** The balance row still carries the flag 0075 could not clear (it was below zero then). */
  balanceFlag: boolean
  /** The place itself still allows a balance below zero (no bin can since 0075). */
  locationAllows: boolean
}

interface BelowZeroRow {
  tenant_id: string
  tenant_slug: string
  lot_id: string
  variant_name: string
  batch_no: string
  expiry_date: string | null
  location_id: string
  location_name: string
  location_kind: string
  on_hand: number | string
  reserved: number | string
  balance_flag: boolean
  location_allows: boolean
}

/** Every balance below zero, across all tenants or one. */
export async function stockBelowZero(db: Db, tenantId?: string): Promise<BelowZeroBalance[]> {
  const rows = await withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      SELECT z.tenant_id, t.slug AS tenant_slug, z.lot_id, v.name AS variant_name, sl.batch_no,
             sl.expiry_date::text AS expiry_date, z.location_id, loc.name AS location_name,
             loc.kind::text AS location_kind, z.on_hand, z.reserved, z.balance_flag, z.location_allows
        FROM dos_stock_below_zero(${tenantId ?? null}::text) z
        JOIN tenants t ON t.id = z.tenant_id
        JOIN stock_lots sl ON sl.id = z.lot_id
        JOIN product_variants v ON v.id = sl.variant_id
        JOIN locations loc ON loc.id = z.location_id
       ORDER BY t.slug, loc.name, v.name, sl.batch_no, z.lot_id`)
    return res.rows as unknown as BelowZeroRow[]
  })
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    lotId: r.lot_id,
    variantName: r.variant_name,
    batchNo: r.batch_no,
    expiryDate: r.expiry_date,
    locationId: r.location_id,
    locationName: r.location_name,
    locationKind: r.location_kind,
    onHandPcs: Number(r.on_hand),
    reservedPcs: Number(r.reserved),
    balanceFlag: r.balance_flag,
    locationAllows: r.location_allows,
  }))
}

/** The below-zero balances as sentences, for a spec to assert empty (the `cancelFootprintFaults` style). */
export async function belowZeroFaults(db: Db, tenantId?: string): Promise<string[]> {
  return (await stockBelowZero(db, tenantId)).map(
    (b) =>
      `${b.tenantSlug}: ${b.locationName} shows ${String(b.onHandPcs)} pc of ${b.variantName}${b.batchNo ? ` (batch ${b.batchNo})` : ''}, below zero; count it and correct it on Stock`,
  )
}

/** A posted receipt line whose printed expiry is not the expiry of the lot it went into (pre-0074). */
export interface MergedReceipt {
  tenantId: string
  tenantSlug: string
  lotId: string
  variantName: string
  batchNo: string
  lotExpiry: string | null
  grnId: string
  grnNo: string | null
  grnLineId: string
  lineExpiry: string
  receivedPcs: number
}

interface MergedRow {
  tenant_id: string
  tenant_slug: string
  lot_id: string
  variant_name: string
  batch_no: string
  lot_expiry: string | null
  grn_id: string
  grn_no: string | null
  grn_line_id: string
  line_expiry: string
  received_pcs: number | string
}

/** Every posted receipt line merged into a lot of another expiry, across all tenants or one. */
export async function receiptsMergedAcrossExpiry(
  db: Db,
  tenantId?: string,
): Promise<MergedReceipt[]> {
  const rows = await withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      SELECT m.tenant_id, t.slug AS tenant_slug, m.lot_id, v.name AS variant_name, sl.batch_no,
             m.lot_expiry::text AS lot_expiry, m.grn_id, g.grn_no, m.grn_line_id,
             m.line_expiry::text AS line_expiry, m.received_pcs
        FROM dos_receipts_merged_across_expiry(${tenantId ?? null}::text) m
        JOIN tenants t ON t.id = m.tenant_id
        JOIN stock_lots sl ON sl.id = m.lot_id
        JOIN product_variants v ON v.id = sl.variant_id
        JOIN grns g ON g.id = m.grn_id
       ORDER BY t.slug, v.name, sl.batch_no, m.lot_id, m.line_expiry`)
    return res.rows as unknown as MergedRow[]
  })
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    lotId: r.lot_id,
    variantName: r.variant_name,
    batchNo: r.batch_no,
    lotExpiry: r.lot_expiry,
    grnId: r.grn_id,
    grnNo: r.grn_no,
    grnLineId: r.grn_line_id,
    lineExpiry: r.line_expiry,
    receivedPcs: Number(r.received_pcs),
  }))
}

/** What `dos_clear_negative_flags()` did: the migration's correction, idempotent, run again by hand. */
export interface ClearedNegativeFlags {
  binsCleared: number
  balancesCleared: number
  balancesKeptBelowZero: number
}

/**
 * Runs migration 0075's correction again (`dos_clear_negative_flags`): every bin's flag false, every balance at
 * zero or more at a place that does not allow a negative loses its flag, a balance below zero keeps it and is
 * counted. For a database restored from a dump taken before 0075. Needs a role that bypasses row level security
 * (the migration owner), like `pnpm db:migrate`.
 */
export async function clearNegativeFlags(db: Db, tenantId?: string): Promise<ClearedNegativeFlags> {
  const res = await db.execute(
    sql`SELECT * FROM dos_clear_negative_flags(${tenantId ?? null}::text)`,
  )
  const row = res.rows[0] as
    | {
        bins_cleared: number | string
        balances_cleared: number | string
        balances_kept_below_zero: number | string
      }
    | undefined
  return {
    binsCleared: Number(row?.bins_cleared ?? 0),
    balancesCleared: Number(row?.balances_cleared ?? 0),
    balancesKeptBelowZero: Number(row?.balances_kept_below_zero ?? 0),
  }
}
