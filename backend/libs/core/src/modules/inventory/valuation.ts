import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * Stock on hand per variant and location (coordination §3.9: "9 reporting → `modules/inventory`
 * `valuationByLocation`"). Quantities and expiry ONLY — no rupee crosses this function, because
 * `stock_balances` carries no cost and `tenant_product_costs` is back-office-restricted at the database
 * (ADR 0002). Reporting multiplies these pieces by the cost `TenantCatalogService.costsForVariants`
 * hands it, under `requireRole(BACK_OFFICE)`, so a salesperson could not learn a value from here even
 * if the register were mounted on its service.
 *
 * One grouped query with a bounded page (docs/20 rule 3), ordered `(variant_id, location_id)` so the
 * register's cursor is a stable keyset.
 *
 * A plain exported function so the worker's rollup uses it without Nest DI (coordination §3.9).
 */

export interface ValuationFilter {
  locationId?: string | undefined
  /** The brand of the lot's product (global catalog). */
  brandId?: string | undefined
  /**
   * Pieces in lots expiring on or before this IST date count as near expiry. Omit and `nearExpiryPcs`
   * is 0 — reporting always passes `today + nearExpiryDays`.
   */
  nearExpiryBefore?: string | undefined
  limit?: number | undefined
}

/** `String()` on a value the driver typed `unknown`; keeps the narrowing out of the call site. */
const text = (v: unknown): string => String(v)

export interface ValuationRow {
  variantId: string
  locationId: string
  onHandPcs: number
  /** The part of `onHandPcs` sitting in lots that expire inside the near-expiry window. */
  nearExpiryPcs: number
  /** Earliest expiry among the lots that still have pieces here; null when nothing expires. */
  nearestExpiryDate: string | null
}

export async function valuationByLocation(
  tx: Db,
  filter: ValuationFilter = {},
): Promise<ValuationRow[]> {
  const { tenantId } = currentTenant()
  const limit = Math.min(filter.limit ?? 2_000, 5_000)
  const result = await tx.execute(sql`
    select l.variant_id, b.location_id,
           coalesce(sum(b.on_hand), 0)::bigint as on_hand_pcs,
           coalesce(sum(case
             when ${filter.nearExpiryBefore ?? null}::date is not null
              and l.expiry_date is not null
              and l.expiry_date <= ${filter.nearExpiryBefore ?? null}::date
             then b.on_hand else 0 end), 0)::bigint as near_expiry_pcs,
           min(l.expiry_date)::text as nearest_expiry_date
      from stock_balances b
      join stock_lots l on l.id = b.lot_id and l.tenant_id = b.tenant_id
      join product_variants v on v.id = l.variant_id
      join products p on p.id = v.product_id
     where b.tenant_id = ${tenantId}
       and b.on_hand > 0
       and (${filter.locationId ?? null}::text is null or b.location_id = ${filter.locationId ?? null})
       and (${filter.brandId ?? null}::text is null or p.brand_id = ${filter.brandId ?? null})
     group by l.variant_id, b.location_id
     order by l.variant_id asc, b.location_id asc
     limit ${limit}`)
  return result.rows.map((row: Record<string, unknown>) => ({
    variantId: String(row.variant_id),
    locationId: String(row.location_id),
    onHandPcs: Number(row.on_hand_pcs ?? 0),
    nearExpiryPcs: Number(row.near_expiry_pcs ?? 0),
    nearestExpiryDate: row.nearest_expiry_date ? text(row.nearest_expiry_date) : null,
  }))
}
