import { sql } from 'drizzle-orm'
import type { z } from 'zod'
import { ORPCError } from '@orpc/server'
import type { AgeingHistoryInput, AgeingHistoryOutput } from '@dos/contracts'
import { daysBetween } from '@dos/domain'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

type HistoryIn = z.infer<typeof AgeingHistoryInput>
type HistoryOut = z.infer<typeof AgeingHistoryOutput>

/** Window caps per grain (docs/23 §1.2): day ≤ 92 points, week ≤ 53, month ≤ 24. */
const MAX_POINTS: Record<HistoryIn['grain'], number> = { day: 92, week: 53, month: 24 }
const DAYS_PER: Record<HistoryIn['grain'], number> = { day: 1, week: 7, month: 31 }

/**
 * The outstanding trend and the ageing history (`receivables.ageing.history`, docs/23 §8.1), read
 * from `ageing_snapshots` — the nightly rollup `ageing.rebuild` writes — and NEVER from a live scan.
 * One row per (bucket, retailer) is summed over the tenant, a beat or one shop; a bucket's point is
 * the LAST snapshot date inside it, so a week that has seven nightly snapshots answers Sunday's.
 * Week buckets are Monday-anchored, month buckets calendar months, both on the IST snapshot date.
 */
export async function ageingHistory(tx: Db, input: HistoryIn): Promise<HistoryOut> {
  const { tenantId } = currentTenant()
  const span = daysBetween(input.from, input.to) + 1
  if (span > MAX_POINTS[input.grain] * DAYS_PER[input.grain])
    throw new ORPCError('BAD_REQUEST', {
      message: `a ${input.grain} history is capped at ${String(MAX_POINTS[input.grain])} points; narrow the window`,
      data: { code: 'window_too_wide', grain: input.grain, maxPoints: MAX_POINTS[input.grain] },
    })
  const bucketExpr =
    input.grain === 'day'
      ? sql`s.as_of`
      : input.grain === 'week'
        ? sql`date_trunc('week', s.as_of)::date`
        : sql`date_trunc('month', s.as_of)::date`
  const filters = [
    sql`s.tenant_id = ${tenantId}`,
    sql`s.as_of between ${input.from} and ${input.to}`,
  ]
  if (input.retailerId) filters.push(sql`s.retailer_id = ${input.retailerId}`)
  if (input.beatId) filters.push(sql`r.beat_id = ${input.beatId}`)
  const where = sql.join(filters, sql` and `)
  const result = await tx.execute(sql`
    with scoped as (
      select s.*, ${bucketExpr} as bucket
        from ageing_snapshots s
        join retailers r on r.id = s.retailer_id and r.tenant_id = s.tenant_id
       where ${where}
    ),
    latest as (
      select bucket, max(as_of) as as_of from scoped group by bucket
    )
    select l.as_of,
           coalesce(sum(x.outstanding_paise), 0) as outstanding,
           coalesce(sum(x.overdue_paise), 0) as overdue,
           coalesce(sum(x.open_bills), 0)::int as open_bills,
           coalesce(sum(x.bucket_0_7_paise), 0) as b0_7,
           coalesce(sum(x.bucket_8_15_paise), 0) as b8_15,
           coalesce(sum(x.bucket_16_30_paise), 0) as b16_30,
           coalesce(sum(x.bucket_31_60_paise), 0) as b31_60,
           coalesce(sum(x.bucket_61_90_paise), 0) as b61_90,
           coalesce(sum(x.bucket_90_plus_paise), 0) as b90plus
      from latest l
      join scoped x on x.bucket = l.bucket and x.as_of = l.as_of
     group by l.as_of
     order by l.as_of asc
     limit ${MAX_POINTS[input.grain]}`)
  const num = (v: unknown): number => Number(v ?? 0)
  const points = result.rows.map((row) => ({
    asOf: String(row.as_of).slice(0, 10),
    outstandingPaise: num(row.outstanding),
    overduePaise: num(row.overdue),
    openBills: Number(row.open_bills ?? 0),
    buckets: {
      b0_7: num(row.b0_7),
      b8_15: num(row.b8_15),
      b16_30: num(row.b16_30),
      b31_60: num(row.b31_60),
      b61_90: num(row.b61_90),
      b90plus: num(row.b90plus),
    },
  }))
  return { grain: input.grain, from: input.from, to: input.to, points }
}
