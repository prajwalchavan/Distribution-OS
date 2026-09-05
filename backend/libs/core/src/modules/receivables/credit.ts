import { and, eq } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type { CreditBreachReason, CreditCheckOutput } from '@dos/contracts'
import { businessDate, daysBetween } from '@dos/domain'
import { retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { loadOutstanding } from './outstanding.js'

/**
 * Credit control (§6, ADR 0004). This file moved here from `modules/orders/credit.ts` at the receivables
 * slice (docs/plans/00-coordination.md §3.1): the raw join over billing and receivables tables that lived
 * there is gone, because receivables now maintains `retailer_outstanding_summary` and one rollup row is
 * both correct and O(1) — scale rule 9, and the same number the rep's shop card shows.
 *
 * `orders/index.ts` re-exports `checkCredit` so every call site inside the order aggregate is unchanged.
 * Nothing in this file writes.
 */

export type CreditMode = 'indicate' | 'strict' | 'stop'
export type PaymentTerms = 'PRE' | 'ON' | 'POST_FULFILLMENT'

export interface RetailerCredit {
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
 * `indicate` only annotates the rep's screen; `strict` opens an approval; `stop` blocks without an owner
 * override. Both enforcing modes raise the same `credit_limit` approval — the difference is what the owner
 * is allowed to do with it, which is an approvals-queue decision, not a submit-time one.
 *
 * Three ways to breach (docs/plans/receivables.md §4.14): past the rupee limit, past the number of open
 * bills, or the oldest bill is older than the agreed credit days.
 */
export async function checkCredit(
  tx: Db,
  retailerId: string,
  orderTotalPaise: number,
): Promise<CreditVerdict> {
  const credit = await loadRetailerCredit(tx, retailerId)
  const summary = await loadOutstanding(tx, retailerId)
  const today = businessDate().date
  const overdueDays = summary.oldestDueDate
    ? Math.max(0, daysBetween(summary.oldestDueDate, today))
    : 0
  const enforcing = credit.creditMode === 'strict' || credit.creditMode === 'stop'
  const reasons: CreditBreachReason[] = []
  if (summary.outstandingPaise + orderTotalPaise > credit.creditLimitPaise) {
    reasons.push('limit_exceeded')
  }
  if (credit.creditLimitBills > 0 && summary.openBills >= credit.creditLimitBills) {
    reasons.push('bill_count_exceeded')
  }
  if (credit.creditDays > 0 && overdueDays > credit.creditDays) {
    reasons.push('overdue_days_exceeded')
  }
  return {
    retailerId,
    creditMode: credit.creditMode,
    paymentTerms: credit.paymentTerms,
    creditLimitPaise: credit.creditLimitPaise,
    creditLimitBills: credit.creditLimitBills,
    creditDays: credit.creditDays,
    outstandingPaise: summary.outstandingPaise,
    openBills: summary.openBills,
    oldestDueDate: summary.oldestDueDate,
    overdueDays,
    orderTotalPaise,
    headroomPaise: credit.creditLimitPaise - summary.outstandingPaise - orderTotalPaise,
    breached: enforcing && reasons.length > 0,
    reasons,
  }
}
