import { and, eq, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type { CreditBreachReason, CreditCheckOutput } from '@dos/contracts'
import { businessDate, daysBetween } from '@dos/domain'
import { retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { loadOpenBills, loadOutstanding, netOfOnAccount, openPaiseOf } from './outstanding.js'

/**
 * Credit control (§6, ADR 0004). This file moved here from `modules/orders/credit.ts` at the receivables
 * slice (docs/plans/00-coordination.md §3.1): the raw join over billing and receivables tables that lived
 * there is gone, because receivables now maintains `retailer_outstanding_summary` and one rollup row is
 * both correct and O(1) — scale rule 9, and the same number the rep's shop card shows.
 *
 * THE CREDIT GATE COUNTS UNDELIVERED BILLS (QA DOS-197, architect ruling 2026-09-21). A bill that came
 * back on the van (`invoices.undelivered_at`) is out of the shop's dues, its ageing buckets, the
 * pending-bills file, pay-online and the FIFO allocation — the shop is not yet owed for goods it has
 * not received — but the goods are on their way back to that shop, so its credit EXPOSURE is
 * `outstanding_paise + undelivered_paise`, and where the number of open bills is a limit the bills on
 * the van count too. A shop at its limit must not regain headroom, or a free bill slot, because its
 * bill is waiting for re-delivery; it regains both only when that bill is delivered and paid, or
 * cancelled. `overdue_days` stays on the dues alone: a bill the shop has not received is not late.
 *
 * `orders/index.ts` re-exports `checkCredit` so every call site inside the order aggregate is unchanged.
 * Nothing in this file writes.
 */

export type CreditMode = 'indicate' | 'strict' | 'stop'
export type PaymentTerms = 'PRE' | 'ON' | 'POST_FULFILLMENT'

export interface RetailerCredit {
  /** The shop's name and whether it is active: the words and the gate of DOS-314 and DOS-315. */
  name: string
  active: boolean
  paymentTerms: PaymentTerms
  creditMode: CreditMode
  creditLimitPaise: number
  creditLimitBills: number
  creditDays: number
}

export async function loadRetailerCredit(tx: Db, retailerId: string): Promise<RetailerCredit> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({
      name: retailers.name,
      active: retailers.active,
      paymentTerms: retailers.paymentTerms,
      creditMode: retailers.creditMode,
      creditLimitPaise: retailers.creditLimitPaise,
      creditLimitBills: retailers.creditLimitBills,
      creditDays: retailers.creditDays,
    })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, retailerId)))
    .limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `Retailer ${retailerId} not found` })
  return row
}

/** The shop's AR position in paise: the gross open value of its bills, from the rollup, never a ledger scan. */
export async function outstandingPaise(tx: Db, retailerId: string): Promise<number> {
  const summary = await loadOutstanding(tx, retailerId)
  return summary.outstandingPaise
}

/** Identical to the contract's `receivables.creditCheck` output, so app and server apply one rule. */
export type CreditVerdict = z.infer<typeof CreditCheckOutput>

/**
 * How many of the shop's open bills are riding a van (DOS-197). Asked only when the bill count is a
 * limit and the rollup says something is out there: one shop's open bills, never a tenant scan.
 */
async function undeliveredBillCount(tx: Db, retailerId: string): Promise<number> {
  const bills = await loadOpenBills(tx, { retailerIds: [retailerId], includeUndelivered: true })
  return bills.filter((bill) => bill.undelivered && openPaiseOf(bill) > 0).length
}

/**
 * WHAT IS PROMISED BUT NOT BILLED (QA DOS-313, architect ruling 4, 2026-09-28): the shop's orders that
 * are confirmed, being picked or packed and carry no live bill yet, at their order value. A cancelled or
 * refused order is `cancelled` and never counted; a submitted order still waiting on a decision is not
 * promised yet; an order with a live bill is counted as that bill (it is in `outstanding_paise`), and
 * whatever of an order is not billed yet counts for what is left. Read from the order book here, beside
 * the invoice rows this module already reads, because the rollup only knows bills.
 *
 * One shop's open orders only: `sales_orders_credit_open_idx` (migration 0080) is the partial index that
 * keeps it to the handful of orders in flight however long the shop's history is.
 */
export async function unbilledOrders(
  tx: Db,
  retailerId: string,
): Promise<{ paise: number; orders: number }> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select coalesce(sum(case when o.state = 'packed' and b.billed is not null then 0
                             else greatest(0, o.total_paise - coalesce(b.billed, 0)) end), 0)::bigint as paise,
           count(*) filter (where b.billed is null)::int as orders
      from sales_orders o
      left join lateral (
        select sum(i.total_paise) as billed
          from invoices i
         where i.tenant_id = o.tenant_id and i.order_id = o.id
           and i.state not in ('draft', 'cancelled')) b on true
     where o.tenant_id = ${tenantId}
       and o.retailer_id = ${retailerId}
       and o.state in ('confirmed', 'picking', 'packed')`)
  const row = result.rows[0] as { paise: string | number | null; orders: number } | undefined
  return { paise: Number(row?.paise ?? 0), orders: row?.orders ?? 0 }
}

/**
 * Two orders for one shop must not both pass the check when together they go over (QA DOS-313). Every
 * decision that can put a shop's credit to use takes this transaction-scoped advisory lock on the shop
 * first — the pattern this module already uses for a trip's money (`trip-money:` in the service) — so a
 * second submit for the same shop waits until the first has committed its confirmed order, and then
 * counts it. A lock, not `SELECT … FOR UPDATE` on the shop's row, because the shop's own app submits
 * too and a retailer login may read its row but never lock it for update under RLS.
 */
export async function lockShopCredit(tx: Db, retailerId: string): Promise<void> {
  const { tenantId } = currentTenant()
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`credit:${tenantId}:${retailerId}`}, 0))`,
  )
}

export interface CreditCheckOptions {
  /**
   * The order being checked is pay-on-delivery for a pay-on-delivery shop (DOS-225): no credit is
   * given, so only a stop holds it. When absent, the shop's own terms decide (the rep's pre-check).
   */
  payOnDelivery?: boolean
}

/**
 * `indicate` only annotates the rep's screen. `strict` opens a `credit_limit` approval on any reason.
 * `stop` (QA DOS-314, architect ruling 5) means no order on credit at all: the verdict is always
 * breached, `creditStopped` says why, placing an order on credit is refused and no approval can release
 * one (`orders` enforces both). A pay-on-delivery order of a pay-on-delivery shop (DOS-225) is given no
 * credit, so the limit, the bill count and the overdue days do not apply to it; it is held only when
 * credit is stopped.
 *
 * Three ways to breach (docs/plans/receivables.md §4.14), all NET of the money the shop has on account
 * (DOS-312) and counting what is promised as well as what is billed (DOS-313): past the rupee limit
 * (`exposurePaise` above), past the number of open bills (the bills the money on account does not cover,
 * the bills on a van and the confirmed orders that will become bills), or the oldest bill the money on
 * account does not cover is older than the agreed credit days.
 */
export async function checkCredit(
  tx: Db,
  retailerId: string,
  orderTotalPaise: number,
  options: CreditCheckOptions = {},
): Promise<CreditVerdict> {
  const credit = await loadRetailerCredit(tx, retailerId)
  const summary = await loadOutstanding(tx, retailerId)
  const today = businessDate().date
  const onAccountPaise = summary.unallocatedCreditPaise
  // Net of money on account: the bills it does not cover, their count and the oldest of them (DOS-312).
  // Walked only when there is money on account and a limit that reads the walk; otherwise gross = net.
  const walked =
    onAccountPaise > 0 && (credit.creditDays > 0 || credit.creditLimitBills > 0)
      ? netOfOnAccount(
          await loadOpenBills(tx, { retailerIds: [retailerId] }),
          onAccountPaise,
          today,
        )
      : null
  const openBills = walked ? walked.openBills : summary.openBills
  const oldestDueDate = walked ? walked.oldestDueDate : summary.oldestDueDate
  const overdueDays = oldestDueDate ? Math.max(0, daysBetween(oldestDueDate, today)) : 0
  const unbilled = await unbilledOrders(tx, retailerId)
  // What the shop is exposed for: its dues, the bills on their way back to it, what is promised and
  // not billed yet, less what it has already paid that no bill has claimed.
  const exposurePaise =
    summary.outstandingPaise + summary.undeliveredPaise + unbilled.paise - onAccountPaise
  const undeliveredBills =
    credit.creditLimitBills > 0 && summary.undeliveredPaise > 0
      ? await undeliveredBillCount(tx, retailerId)
      : 0
  const stopped = credit.creditMode === 'stop'
  const payOnDelivery = options.payOnDelivery ?? credit.paymentTerms === 'ON'
  const reasons: CreditBreachReason[] = []
  // A pay-on-delivery order is given no credit: nothing to measure against the limit (DOS-225).
  if (!payOnDelivery) {
    if (exposurePaise + orderTotalPaise > credit.creditLimitPaise) reasons.push('limit_exceeded')
    if (
      credit.creditLimitBills > 0 &&
      openBills + undeliveredBills + unbilled.orders >= credit.creditLimitBills
    )
      reasons.push('bill_count_exceeded')
    if (credit.creditDays > 0 && overdueDays > credit.creditDays)
      reasons.push('overdue_days_exceeded')
  }
  const enforcing = credit.creditMode === 'strict' || stopped
  return {
    retailerId,
    creditMode: credit.creditMode,
    paymentTerms: credit.paymentTerms,
    creditLimitPaise: credit.creditLimitPaise,
    creditLimitBills: credit.creditLimitBills,
    creditDays: credit.creditDays,
    outstandingPaise: summary.outstandingPaise,
    undeliveredPaise: summary.undeliveredPaise,
    unbilledOrdersPaise: unbilled.paise,
    unbilledOrders: unbilled.orders,
    unallocatedCreditPaise: onAccountPaise,
    exposurePaise,
    openBills,
    oldestDueDate,
    overdueDays,
    orderTotalPaise,
    headroomPaise: credit.creditLimitPaise - exposurePaise - orderTotalPaise,
    creditStopped: stopped,
    payOnDelivery,
    breached: stopped || (enforcing && reasons.length > 0),
    reasons,
  }
}
