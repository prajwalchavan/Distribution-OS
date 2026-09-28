/**
 * A PAYMENT REFERENCE IS USED ONCE (QA DOS-310, architect ruling 2026-09-28).
 *
 * The same UPI UTR and the same cheque number were accepted again as new money (UTR1790564510946 on three live
 * receipts across two shops, CHQ088789 twice for one shop). Since migration 0079 the service refuses it at every
 * door and the database refuses what gets past the service (`receipts_reference_is_free`), for NEW rows only: a
 * database holding imported history may already carry such pairs, and a guarantee that failed on them would stop
 * the migration. This is the release check that names them, from the SQL definition
 * `dos_receipt_reference_duplicates()` (migration 0079):
 *
 *   transfer          a UPI / bank-transfer reference on more than one live receipt of the distributor — money
 *                     booked twice unless one of them is reversed;
 *   cheque_same_shop  a cheque number on more than one live receipt of the same shop — the same;
 *   cheque_shops      one cheque number on live receipts of several shops — each one confirmed by the desk as a
 *                     different cheque (the service asks); listed for information, never a failure.
 *
 * LIVE = `collected` or `deposited`, a positive amount, not a reversal mirror. References compare trimmed, without
 * spaces and without regard to case (`dos_normalise_reference`).
 *
 * The check is also run BEFORE a deploy, read-only, against a database the migration has not reached yet (a copy
 * of live, or the QA lane's database), to see what the release will find. There the function does not exist yet,
 * so the same query is sent inline (`INLINE_DUPLICATES`, word for word the function's body, with the normalisation
 * written out); a spec holds the two forms to the same rows. Either way the look is a READ ONLY transaction: it
 * cannot write a row.
 */
import { sql } from 'drizzle-orm'
import type { Db } from './client.js'

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
 * The body of `dos_receipt_reference_duplicates(p_tenant)` (migration 0079), for a database that does not carry the
 * function yet. `dos_normalise_reference(x)` is written out with `[[:space:]]` for its `\s` (the same class in
 * Postgres), so no escape has to survive a template literal.
 */
const INLINE_DUPLICATES = (tenantId: string | null) => sql`
  WITH live AS (
    SELECT r.*, upper(regexp_replace(coalesce(r.reference, ''), '[[:space:]]', '', 'g')) AS ref
      FROM receipts r
     WHERE (${tenantId}::text IS NULL OR r.tenant_id = ${tenantId}::text)
       AND r.reference IS NOT NULL
       AND r.amount_paise > 0
       AND r.reverses_receipt_id IS NULL
       AND r.status IN ('collected', 'deposited')
       AND r.mode IN ('upi', 'bank_transfer', 'cheque')),
  grouped AS (
    SELECT l.tenant_id, 'transfer'::text AS kind, l.ref, NULL::text AS shop, l.id, l.receipt_no,
           l.retailer_id, l.mode::text AS mode, l.amount_paise, l.received_at
      FROM live l WHERE l.mode IN ('upi', 'bank_transfer') AND l.ref <> ''
    UNION ALL
    SELECT l.tenant_id, 'cheque_same_shop', l.ref, l.retailer_id, l.id, l.receipt_no, l.retailer_id,
           l.mode::text, l.amount_paise, l.received_at
      FROM live l WHERE l.mode = 'cheque' AND l.ref <> ''
    UNION ALL
    SELECT l.tenant_id, 'cheque_shops', l.ref, NULL, l.id, l.receipt_no, l.retailer_id, l.mode::text,
           l.amount_paise, l.received_at
      FROM live l WHERE l.mode = 'cheque' AND l.ref <> '')
  SELECT g.tenant_id, g.kind, g.ref AS reference,
         array_agg(g.id ORDER BY g.received_at, g.id) AS receipt_ids,
         array_agg(coalesce(g.receipt_no, g.id) ORDER BY g.received_at, g.id) AS receipt_nos,
         array_agg(DISTINCT g.retailer_id) AS retailer_ids,
         array_agg(DISTINCT g.mode) AS modes,
         sum(g.amount_paise)::bigint AS amount_paise,
         min(g.received_at) AS first_at,
         max(g.received_at) AS last_at
    FROM grouped g
   GROUP BY g.tenant_id, g.kind, g.ref, g.shop
  HAVING count(*) > 1
     AND (g.kind <> 'cheque_shops' OR count(DISTINCT g.retailer_id) > 1)`

/** Which form of the query ran: the migrated database's function, or the inline copy of its body. */
export type ReceiptReferenceSource = 'function' | 'inline'

/**
 * Every payment reference standing on more than one live receipt, across all tenants or one. Read in a READ ONLY
 * transaction as the system role (`app_worker`, as `withSystem` does): a release check must see every tenant's
 * receipts whatever role the URL holds, and must never write. `form` forces one form of the query (the spec
 * compares them); by default the function is used when the database has it and the inline copy otherwise.
 */
export async function receiptReferenceDuplicates(
  db: Db,
  tenantId?: string,
  form?: ReceiptReferenceSource,
): Promise<ReceiptReferenceDuplicate[]> {
  return (await receiptReferenceReport(db, tenantId, form)).duplicates
}

/** `receiptReferenceDuplicates`, with the form of the query that answered (the release check prints it). */
export async function receiptReferenceReport(
  db: Db,
  tenantId?: string,
  form?: ReceiptReferenceSource,
): Promise<{ source: ReceiptReferenceSource; duplicates: ReceiptReferenceDuplicate[] }> {
  const { source, rows } = await db.transaction(
    async (tx) => {
      await tx.execute(sql`set local role app_worker`)
      await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
      const has = await tx.execute(
        sql`select to_regprocedure('public.dos_receipt_reference_duplicates(text)') is not null as has`,
      )
      const present = (has.rows[0] as { has: boolean } | undefined)?.has === true
      const use: ReceiptReferenceSource = form ?? (present ? 'function' : 'inline')
      const query =
        use === 'function'
          ? sql`SELECT d.tenant_id, d.kind, d.reference, d.receipt_ids, d.receipt_nos, d.retailer_ids,
                       d.modes, d.amount_paise, d.first_at, d.last_at
                  FROM dos_receipt_reference_duplicates(${tenantId ?? null}::text) d`
          : INLINE_DUPLICATES(tenantId ?? null)
      const res = await tx.execute(sql`
        SELECT d.tenant_id, t.slug AS tenant_slug, d.kind, d.reference, d.receipt_ids, d.receipt_nos,
               d.retailer_ids, d.modes, d.amount_paise, d.first_at, d.last_at
          FROM (${query}) d
          JOIN tenants t ON t.id = d.tenant_id
         ORDER BY t.slug, d.kind, d.reference`)
      return { source: use, rows: res.rows as unknown as Row[] }
    },
    { accessMode: 'read only' },
  )
  const duplicates = rows.map((r) => ({
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
  return { source, duplicates }
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
