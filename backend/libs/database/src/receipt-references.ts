/**
 * A PAYMENT REFERENCE IS USED ONCE (QA DOS-310, architect ruling 2026-09-28).
 *
 * The same UPI UTR and the same cheque number were accepted again as new money (UTR1790564510946 on three live
 * receipts across two shops, CHQ088789 twice for one shop). Since migration 0079 the service refuses it at every
 * door and the database refuses what gets past the service (`receipts_reference_is_free`), for NEW rows only: a
 * database holding imported history may already carry such pairs, and a guarantee that failed on them would stop
 * the migration. This is the release check that names them, from ONE SQL definition,
 * `dos_receipt_reference_duplicates()`:
 *
 *   transfer          a UPI / bank-transfer reference on more than one live receipt of the distributor — money
 *                     booked twice unless one of them is reversed;
 *   cheque_same_shop  a cheque number on more than one live receipt of the same shop — the same;
 *   cheque_shops      one cheque number on live receipts of several shops — each one confirmed by the desk as a
 *                     different cheque (the service asks); listed for information, never a failure.
 *
 * LIVE = `collected` or `deposited`, a positive amount, not a reversal mirror. References compare trimmed, without
 * spaces and without regard to case (`dos_normalise_reference`).
 */
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from './client.js'

export type ReceiptReferenceKind = 'transfer' | 'cheque_same_shop' | 'cheque_shops'

/** One reference standing on more than one live receipt. */
export interface ReceiptReferenceDuplicate {
  tenantId: string
  tenantSlug: string
  kind: ReceiptReferenceKind
  /** The normalised reference. */
  reference: string
  receiptIds: string[]
  receiptNos: string[]
  retailerIds: string[]
  modes: string[]
  /** Σ of the receipts' amounts: what is booked under this reference. */
  amountPaise: number
  firstAt: string
  lastAt: string
  /** `cheque_shops` is information (the desk confirmed each as a different cheque); the other two fail the check. */
  failing: boolean
}

interface Row {
  tenant_id: string
  tenant_slug: string
  kind: ReceiptReferenceKind
  reference: string
  receipt_ids: string[]
  receipt_nos: string[]
  retailer_ids: string[]
  modes: string[]
  amount_paise: string | number
  first_at: string | Date
  last_at: string | Date
}

const iso = (v: string | Date): string => new Date(v).toISOString()

/**
 * Every payment reference standing on more than one live receipt, across all tenants or one. Read as the system
 * role (`withSystem`): a release check must see every tenant's receipts whatever role the URL holds.
 */
export async function receiptReferenceDuplicates(
  db: Db,
  tenantId?: string,
): Promise<ReceiptReferenceDuplicate[]> {
  const rows = await withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      SELECT d.tenant_id, t.slug AS tenant_slug, d.kind, d.reference, d.receipt_ids, d.receipt_nos,
             d.retailer_ids, d.modes, d.amount_paise, d.first_at, d.last_at
        FROM dos_receipt_reference_duplicates(${tenantId ?? null}::text) d
        JOIN tenants t ON t.id = d.tenant_id
       ORDER BY t.slug, d.kind, d.reference`)
    return res.rows as unknown as Row[]
  })
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantSlug: r.tenant_slug,
    kind: r.kind,
    reference: r.reference,
    receiptIds: r.receipt_ids,
    receiptNos: r.receipt_nos,
    retailerIds: r.retailer_ids,
    modes: r.modes,
    amountPaise: Number(r.amount_paise),
    firstAt: iso(r.first_at),
    lastAt: iso(r.last_at),
    failing: r.kind !== 'cheque_shops',
  }))
}

/** The failing duplicates as sentences, for a spec or a gate to assert empty. */
export async function receiptReferenceFaults(db: Db, tenantId?: string): Promise<string[]> {
  return (await receiptReferenceDuplicates(db, tenantId))
    .filter((d) => d.failing)
    .map(
      (d) =>
        `${d.tenantSlug}: ${d.kind === 'transfer' ? 'UPI / transfer reference' : 'cheque number'} ${d.reference} stands on ${String(d.receiptIds.length)} live receipts (${d.receiptNos.join(', ')})`,
    )
}
