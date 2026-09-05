import { sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { financialYear, NUMBERING_SERIES, numberingSeries, type Db } from '@dos/db'
import { currentTenant } from './tenant-context.js'

/**
 * The series a `bootstrapTenant` tenant already has. The parameter below deliberately accepts any
 * string as well: a distributor configures its OWN series in `numbering_series` (docs/17 §D answer 1 —
 * "do NOT hard-code a series"), so billing's brand-DMS import can name an `external` series this
 * constant has never heard of. `(string & {})` keeps the editor's autocomplete on the seeded codes
 * while letting a configured one through (widened by the billing slice, coordination §3.9).
 */
export type SeriesCode = (typeof NUMBERING_SERIES)[number]['seriesCode'] | (string & {})

/**
 * ADR 0001: human document numbers come from `numbering_series(tenant, series, fy)` at commit time. One
 * atomic upsert takes the row lock and bumps the counter, so two GRNs — or two invoices issued in the
 * same second by two people — never share a number and never leave a gap.
 *
 * PREFIX AND STARTING NUMBER ARE TENANT CONFIGURATION, not code (docs/17 §D1). A distributor moving off
 * TradeEzee may continue `GL/1687`; another starts at 1. Both are rows in `numbering_series`, settable
 * during onboarding and changeable until the first document is issued, so this reads the row's own
 * `prefix` and never overwrites it, and `GREATEST(next_no, starting_no)` means a configured starting
 * number is honoured the first time the series is used. With the default `starting_no = 1` the
 * expression is `next_no + 1` exactly as before, so nothing already numbered moves.
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
      set: {
        nextNo: sql`GREATEST(${numberingSeries.nextNo}, ${numberingSeries.startingNo}) + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ prefix: numberingSeries.prefix, nextNo: numberingSeries.nextNo })
  if (!row)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `numbering series ${seriesCode} unavailable`,
    })
  return `${row.prefix}${String(row.nextNo - 1).padStart(4, '0')}`
}
