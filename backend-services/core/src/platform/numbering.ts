import { sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { financialYear, NUMBERING_SERIES, numberingSeries, type Db } from '@dos/db'
import { currentTenant } from './tenant-context.js'

type SeriesCode = (typeof NUMBERING_SERIES)[number]['seriesCode']

/**
 * ADR 0001: human document numbers come from `numbering_series(tenant, series, fy)` at commit time. One
 * atomic upsert takes the row lock and bumps the counter, so two GRNs posted at once never share a number.
 * Lives here until orders/billing need it too, at which point it moves to src/platform.
 */
export async function nextDocumentNumber(
  tx: Db,
  seriesCode: SeriesCode,
  now: Date = new Date(),
): Promise<string> {
  const { tenantId } = currentTenant()
  const fy = financialYear(now)
  const prefix =
    NUMBERING_SERIES.find((s) => s.seriesCode === seriesCode)?.prefix ?? `${seriesCode}-`
  const [row] = await tx
    .insert(numberingSeries)
    .values({ tenantId, seriesCode, fy, prefix, nextNo: 2 })
    .onConflictDoUpdate({
      target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
      set: { nextNo: sql`${numberingSeries.nextNo} + 1`, updatedAt: new Date() },
    })
    .returning({ prefix: numberingSeries.prefix, nextNo: numberingSeries.nextNo })
  if (!row)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `numbering series ${seriesCode} unavailable`,
    })
  return `${row.prefix}${String(row.nextNo - 1).padStart(4, '0')}`
}
