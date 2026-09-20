import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { CreditNoteDetail, InvoiceDetail } from '@dos/contracts'
import { creditNotes, invoices, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { sellerBranding } from '../tenancy/index.js'
import { invoiceOpenPaise } from '../receivables/index.js'
import { loadCreditNoteDetail, loadInvoiceDetail } from './billing.mappers.js'

/**
 * The document data the worker's PDF renderer prints from — EXACTLY what `billing.invoices.get` and
 * `billing.creditNotes.get` answer, built by the same mappers, so a printed bill can never differ from
 * the bill on the screen. Plain functions, no Nest DI (coordination §3.9 worker rule); they run inside
 * the caller's `withTenant` transaction (the worker opens one as the system role).
 */
export async function loadInvoiceDocument(
  tx: Db,
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .limit(1)
  if (!row) return null
  const due =
    row.state === 'draft' || row.state === 'cancelled' ? 0 : await invoiceOpenPaise(tx, row.id)
  return loadInvoiceDetail(tx, row, await sellerBranding(tx), due)
}

export async function loadCreditNoteDocument(
  tx: Db,
  creditNoteId: string,
): Promise<CreditNoteDetail | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, creditNoteId)))
    .limit(1)
  if (!row) return null
  const [invoice] = await tx
    .select({ invoiceNo: invoices.invoiceNo, isInterState: invoices.isInterState })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, row.invoiceId)))
    .limit(1)
  return loadCreditNoteDetail(
    tx,
    row,
    { invoiceNo: invoice?.invoiceNo ?? null, isInterState: invoice?.isInterState ?? false },
    await sellerBranding(tx),
  )
}

/** The caller's most recent real bill in this distributor, as the shop's home card prints it (DOS-102). */
export interface LastBillForCaller {
  invoiceNo: string | null
  invoiceDate: string
  totalPaise: number
}

/**
 * The newest bill the CALLER can see here — no ids, because RLS supplies the scope: `invoices_read`
 * (`tenantOrOwnRetailerPolicy`) narrows a `retailer` actor to its own shops' bills. A draft is not a
 * bill the shop has and a cancelled one is not a bill any more, so neither can be answered as "your
 * last bill"; the order is by invoice DATE (a bill entered late is still the newest by date), with the
 * id as the tie-break.
 *
 * Used by `auth.memberships.summary`; auth may not read `invoices` itself (module boundary).
 */
export async function lastBillForCaller(tx: Db): Promise<LastBillForCaller | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({
      invoiceNo: invoices.invoiceNo,
      invoiceDate: invoices.invoiceDate,
      totalPaise: invoices.totalPaise,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        notInArray(invoices.state, ['draft', 'cancelled'] as const),
      ),
    )
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
    .limit(1)
  return row ?? null
}
