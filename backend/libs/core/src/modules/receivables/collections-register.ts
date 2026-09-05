import { sql } from 'drizzle-orm'
import type { ReceiptMode } from '@dos/contracts'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The collections register (coordination §3.1: "added later by the slice that needs them —
 * `collectionsRegister(tx, {from, to, groupBy})` by reporting (9)"). Receivables owns `receipts`, so
 * the money is counted here once and reporting only shapes it (coordination §4).
 *
 * Grouped and totalled by mode, unlike `receivables.receipts.list`'s row-level view: this is the
 * accountant's banking slip, and the same numbers feed `daily_tenant_stats.by_payment_mode` so the
 * payment-mode stack at month grain is a rollup read, not a 31-day live scan (docs/20 rule 9).
 *
 * A BOUNCED or CANCELLED receipt is not money that arrived, so neither counts. A reversal IS counted:
 * it is a second receipt with a negative amount (never an edit of the first), and the day it was
 * raised is the day the money went back out.
 *
 * Plain exported functions: the worker's rollup and the CSV renderer call them without Nest DI
 * (coordination §3.9).
 */

export type CollectionsGrouping = 'day' | 'collector'

export interface CollectionsRegisterFilter {
  /** IST business dates on `received_at`, inclusive. */
  from: string
  to: string
  groupBy?: CollectionsGrouping | undefined
  mode?: ReceiptMode | undefined
  limit?: number | undefined
}

export interface CollectionsRegisterRow {
  /** The IST date (`day`) or the collector's user id (`collector`). */
  bucket: string
  cashPaise: number
  upiPaise: number
  bankTransferPaise: number
  chequePaise: number
  adjustmentPaise: number
  totalPaise: number
  receiptCount: number
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/** IST midnight of a business date as an instant, `plusDays` later — keeps `receipts_status_idx` usable. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

export async function collectionsRegister(
  tx: Db,
  filter: CollectionsRegisterFilter,
): Promise<CollectionsRegisterRow[]> {
  const { tenantId } = currentTenant()
  const byCollector = (filter.groupBy ?? 'day') === 'collector'
  const bucket = byCollector
    ? sql`r.received_by`
    : sql`(r.received_at at time zone 'Asia/Kolkata')::date::text`
  const mode = filter.mode ?? null
  const result = await tx.execute(sql`
    select ${bucket} as bucket,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'cash'), 0)::bigint          as cash_paise,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'upi'), 0)::bigint           as upi_paise,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'bank_transfer'), 0)::bigint as bank_transfer_paise,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'cheque'), 0)::bigint        as cheque_paise,
           coalesce(sum(r.amount_paise) filter (where r.mode = 'adjustment'), 0)::bigint    as adjustment_paise,
           coalesce(sum(r.amount_paise), 0)::bigint as total_paise,
           count(*)::int                            as receipt_count
      from receipts r
     where r.tenant_id = ${tenantId}
       and r.status in ('collected', 'deposited')
       and r.received_at >= ${istInstant(filter.from)}
       and r.received_at < ${istInstant(filter.to, 1)}
       and (${mode}::text is null or r.mode::text = ${mode})
     group by 1
     order by 1 asc
     limit ${Math.min(filter.limit ?? 500, 2_000)}`)
  return result.rows.map((row: Record<string, unknown>) => ({
    bucket: String(row.bucket),
    cashPaise: n(row.cash_paise),
    upiPaise: n(row.upi_paise),
    bankTransferPaise: n(row.bank_transfer_paise),
    chequePaise: n(row.cheque_paise),
    adjustmentPaise: n(row.adjustment_paise),
    totalPaise: n(row.total_paise),
    receiptCount: n(row.receipt_count),
  }))
}
