import { ORPCError } from '@orpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * Credit control at submit (§6, ADR 0004).
 *
 * Outstanding is the AR position: the value of the retailer's open invoices (`issued` / `partially_paid`) minus
 * everything allocated against them (receipts and credit notes). It is read here with a plain read-only join
 * over billing/receivables because neither module exists yet; when receivables ships its service this helper
 * becomes a call to it and the SQL goes away. Nothing in this file writes.
 */

export type CreditMode = 'indicate' | 'strict' | 'stop'
export type PaymentTerms = 'PRE' | 'ON' | 'POST_FULFILLMENT'

export interface RetailerCredit {
  paymentTerms: PaymentTerms
  creditMode: CreditMode
  creditLimitPaise: number
}

export async function loadRetailerCredit(tx: Db, retailerId: string): Promise<RetailerCredit> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({
      paymentTerms: retailers.paymentTerms,
      creditMode: retailers.creditMode,
      creditLimitPaise: retailers.creditLimitPaise,
    })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, retailerId)))
    .limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `Retailer ${retailerId} not found` })
  return row
}

/** Σ open invoice totals − Σ allocations against them, in paise. RLS scopes both tables to the tenant. */
export async function outstandingPaise(tx: Db, retailerId: string): Promise<number> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select coalesce(sum(i.total_paise - coalesce(a.allocated, 0)), 0)::bigint as outstanding
    from invoices i
    left join lateral (
      select sum(al.amount_paise) as allocated
      from allocations al
      where al.tenant_id = i.tenant_id and al.invoice_id = i.id
    ) a on true
    where i.tenant_id = ${tenantId}
      and i.retailer_id = ${retailerId}
      and i.state in ('issued', 'partially_paid')`)
  const row = result.rows[0] as { outstanding: string | number } | undefined
  return Number(row?.outstanding ?? 0)
}

export interface CreditVerdict extends RetailerCredit {
  outstandingPaise: number
  orderTotalPaise: number
  /** The order would push the shop past its limit and its mode is enforcing (`strict` or `stop`). */
  breached: boolean
}

/**
 * `indicate` only annotates the rep's screen; `strict` opens an approval; `stop` blocks without an owner
 * override. Both enforcing modes raise the same `credit_limit` approval here — the difference is what the
 * owner is allowed to do with it, which is an approvals-queue decision, not a submit-time one.
 */
export async function checkCredit(
  tx: Db,
  retailerId: string,
  orderTotalPaise: number,
): Promise<CreditVerdict> {
  const credit = await loadRetailerCredit(tx, retailerId)
  const outstanding = await outstandingPaise(tx, retailerId)
  const enforcing = credit.creditMode === 'strict' || credit.creditMode === 'stop'
  return {
    ...credit,
    outstandingPaise: outstanding,
    orderTotalPaise,
    breached: enforcing && outstanding + orderTotalPaise > credit.creditLimitPaise,
  }
}
