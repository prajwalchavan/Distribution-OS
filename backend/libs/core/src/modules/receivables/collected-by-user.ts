import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * What one staff member COLLECTED in a window (coordination §3.1: "added later by the slice that
 * needs them … `collectedByUser(tx, {userId, from, to})` by **incentives (10)**").
 *
 * `receipts` is receivables' table and incentives never joins it (coordination §4). What counts as
 * money collected — which statuses, whose receipt, which instant — is a receivables rule, so it
 * lives here beside `collectionsRegister`, which answers the same question for the register.
 *
 * WHAT COUNTS (docs/plans/incentives.md §4.2):
 *
 *  - STATUS `collected` or `deposited`. A `bounced` cheque was never money and a `cancelled` receipt
 *    never happened, so neither counts toward a `collections` target — a crew member cannot earn on
 *    a cheque that came back.
 *  - `received_by = userId`: whoever took the money. A REVERSAL is a second, negative receipt
 *    pointing back at the original (`reverses_receipt_id`), and it is summed like any other row, so a
 *    corrected collection nets to zero on its own without a special case.
 *  - WINDOW: `received_at` inside `[from 00:00 IST, to+1 00:00 IST)`.
 *
 * WHO CAN EVEN HAVE ONE: only the delivery crew, the shop paying online and the desk take money
 * (docs/17 §D4, docs/22 §6) — a salesperson never records a receipt. A `collections` target on a rep
 * is therefore a target on money that rep may not take; the contract does not refuse it (§5 of the
 * contract header says why) and this function will honestly answer 0.
 *
 * `cash_discount_paise` is NOT added: it is a discount granted at receipt, not money that arrived.
 */

export interface CollectedByUserFilter {
  userId: string
  /** IST business dates, inclusive. */
  from: string
  to: string
}

export interface CollectedByUserRow {
  /** Σ `amount_paise` of the counted receipts — PAISE. */
  amountPaise: number
  /** How many receipts made it up. */
  receipts: number
}

/** IST midnight of a business date as an instant, `plusDays` later. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

/**
 * Plain exported function, so the incentives worker sweep uses it without Nest DI (coordination §3.9
 * worker rule); it runs inside the caller's transaction and RLS scopes it.
 */
export async function collectedByUser(
  tx: Db,
  filter: CollectedByUserFilter,
): Promise<CollectedByUserRow> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select coalesce(sum(r.amount_paise), 0)::bigint as amount_paise,
           count(*)::int                            as receipts
      from receipts r
     where r.tenant_id = ${tenantId}
       and r.received_by = ${filter.userId}
       and r.status in ('collected', 'deposited')
       and r.received_at >= ${istInstant(filter.from)}
       and r.received_at < ${istInstant(filter.to, 1)}`)
  const row: Record<string, unknown> = result.rows[0] ?? {}
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  return { amountPaise: n(row.amount_paise), receipts: n(row.receipts) }
}
