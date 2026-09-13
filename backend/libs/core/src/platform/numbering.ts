import { and, eq, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { financialYear } from '@dos/domain'
import { NUMBERING_SERIES, numberingSeries, type Db } from '@dos/db'
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
 * The financial year a document number is drawn under — the `fy` key of `numbering_series`. IST, always
 * (docs/22: business dates and FY are IST), whatever the server's own clock says: between 00:00 and 05:30
 * IST on 1 April a UTC host still reads 31 March, and the number must still open the NEW year's register.
 * A module that stores `fy` beside a number takes it from here, so the row is filed under exactly the key
 * its counter used (DOS-032 / DOS-059) — the same year invoices and credit notes stamp.
 */
export function numberingYear(now: Date = new Date()): string {
  return financialYear(now)
}

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
  const fy = numberingYear(now)
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

/** The current tenant's row for one series and FY — its prefix and the number it issues next — or null before first use. */
export async function readDocumentSeries(
  tx: Db,
  seriesCode: SeriesCode,
  now: Date = new Date(),
): Promise<{ prefix: string; nextNo: number } | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ prefix: numberingSeries.prefix, nextNo: numberingSeries.nextNo })
    .from(numberingSeries)
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, seriesCode),
        eq(numberingSeries.fy, numberingYear(now)),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Moves a series FORWARD so the next number it issues is at least `nextNo` — never backwards (the 0013
 * guard refuses that under an app actor anyway). It is the repair a module makes when its own register
 * already holds the number the counter just handed out (a restored backup, a reseed, a counter healed by
 * hand): called in the transaction that drew that number, while `nextDocumentNumber`'s row lock is still
 * held, so no other caller can issue in between. Returns the counter's new `next_no`.
 */
export async function advanceDocumentSeries(
  tx: Db,
  seriesCode: SeriesCode,
  nextNo: number,
  now: Date = new Date(),
): Promise<number> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .update(numberingSeries)
    .set({ nextNo: sql`GREATEST(${numberingSeries.nextNo}, ${nextNo})`, updatedAt: new Date() })
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, seriesCode),
        eq(numberingSeries.fy, numberingYear(now)),
      ),
    )
    .returning({ nextNo: numberingSeries.nextNo })
  if (!row)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `numbering series ${seriesCode} unavailable`,
    })
  return row.nextNo
}
