import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import {
  businessDate,
  invoiceMachine,
  TransitionError,
  type InvoiceEvent,
  type InvoiceState,
} from '@dos/domain'
import {
  hsnRates,
  productVariants,
  retailerIdentities,
  retailers,
  tenantProducts,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The plumbing every billing procedure shares: the machine guard, the dated HSN rates, the sell-side
 * pack and description, the buyer block and the WHITE-LABEL seller block that every printed document
 * carries (docs/17 §D answer 6 — a shopkeeper sees the distributor's own name, never "Distribution OS").
 *
 * Nothing here writes: the services own every INSERT so the transaction boundary stays readable.
 */

// ---------------------------------------------------------------------------------------------------------------
// state

/** `invoiceMachine` owns the rules; an illegal move is a 409, never a silently ignored write. */
export function invoiceTransition(from: InvoiceState, event: InvoiceEvent): InvoiceState {
  try {
    return invoiceMachine.next(from, event)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', { message: error.message, data: { from, event } })
    throw error
  }
}

/**
 * The immutability triggers from migration 0003 raise `restrict_violation`; Drizzle wraps the driver
 * error, so the SQLSTATE and the trigger's own message are on `cause`. A caller trying to edit an
 * issued bill gets the trigger's sentence back as a 409, not a 500.
 */
export function isRestrictViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23001' || e.cause?.code === '23001'
}

/** The trigger's own sentence ("invoice … is issued and immutable; raise a credit note"). */
export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } }
  return e.cause?.message ?? e.message ?? 'the database refused the change'
}

/** 23505 = unique_violation — a second live invoice for one order, or a re-imported DMS number. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } }
  return e.cause?.constraint ?? e.constraint
}

// ---------------------------------------------------------------------------------------------------------------
// posting the book from a role that may not post it

/**
 * The roles migration 0007 lets INSERT into `journal_entries` / `journal_lines` — everyone who can take
 * money in the field or at the desk. `warehouse` is deliberately NOT among them (coordination §5.3): a
 * packer has no business writing the books.
 */
const LEDGER_POSTING_ROLES = new Set([
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
  'system',
])

/**
 * Post the accounts-receivable side of a document as `system` when the actor may not post the book.
 *
 * TWO COORDINATION RULES MEET HERE AND BOTH ARE RIGHT. §6 lets the WAREHOUSE issue a bill — it packs the
 * order and prints it with the load — and §5.3 forbids the warehouse role from inserting a journal row,
 * because a packer must never be able to write the books by hand. Warehouse's own `packs.confirm` will
 * call `issueForPack` at step 3, so this is structural, not a quirk of the temporary HTTP procedure.
 *
 * The resolution is the one `modules/orders`' `recordTransition` already uses for a retailer's audit
 * row: for THESE STATEMENTS ONLY, `app.actor_role` becomes `system` and is restored immediately inside
 * the same transaction. Nothing is widened — the entry is derived from the invoice the packer just
 * created, its `posted_by` still records the packer, and the moment the statement ends the warehouse
 * role can no more read the book (`journal_*` SELECT is back office) than it could before.
 */
export async function asLedgerPoster<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (LEDGER_POSTING_ROLES.has(ctx.actorRole)) return fn()
  return asSystemRole(tx, fn)
}

/**
 * Run `fn` as the system role for the statements inside it, restoring the caller's role after —
 * the one documented escalation pattern (`modules/orders`' `recordTransition`). Billing uses it to
 * stamp `pack_confirmations.invoice_id` when a BILLING_ISSUER who is not a stock keeper (the
 * accountant) bills a parked pack: the column is warehouse's, the write is derived from the bill
 * just issued, and `issued_by` still records the accountant.
 */
export async function asSystemRole<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (ctx.actorRole === 'system') return fn()
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await fn()
  } finally {
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// dates (IST, always — docs/17 A: a pack at 23:40 on 31 March belongs to the old financial year)

/** `date + n` as an IST calendar date. Both ends are plain `YYYY-MM-DD`, so no timezone can creep in. */
export function addDays(isoDate: string, days: number): string {
  const at = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  const d = new Date(at + days * 86_400_000)
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Today in IST, unless the caller named a date (a bill keyed in the next morning keeps yesterday's). */
export function invoiceDateOf(given: string | undefined): string {
  return given ?? businessDate().date
}

/** The instant an IST calendar date starts / ends, for a `timestamptz` window over a date range. */
export const istDayStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
export const istDayEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

// ---------------------------------------------------------------------------------------------------------------
// catalogue

/**
 * Sell-side pack size, HSN and printed description per variant (docs/17 B).
 *
 * `modules/orders/pricing-lines.ts` has the same lookup and `eslint-plugin-boundaries` forbids importing
 * it, which is the right call: the ORDER prices in the tenant's pack at order time, the INVOICE freezes
 * the pack that applied at issue, and the day those two rules diverge one shared helper would hide it.
 * Buy-side `supplier_pack_configs` is never consulted — a case on a bill is the case the distributor
 * sells, not the one it bought.
 */
export interface VariantBilling {
  hsnCode: string
  caseSize: number | null
  description: string
  mrpPaise: number | null
}

export async function loadVariantBilling(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, VariantBilling>> {
  if (variantIds.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      variantId: productVariants.id,
      hsnCode: productVariants.hsnCode,
      name: productVariants.name,
      mrpPaise: productVariants.mrpPaise,
      localAlias: tenantProducts.localAlias,
      caseSize: sql<
        number | null
      >`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
    })
    .from(productVariants)
    .leftJoin(
      tenantProducts,
      and(eq(tenantProducts.variantId, productVariants.id), eq(tenantProducts.tenantId, tenantId)),
    )
    .where(inArray(productVariants.id, [...variantIds]))
  const map = new Map<string, VariantBilling>(
    rows.map((r) => [
      r.variantId,
      {
        hsnCode: r.hsnCode,
        caseSize: r.caseSize === null ? null : Number(r.caseSize),
        description: r.localAlias ?? r.name,
        mrpPaise: r.mrpPaise,
      },
    ]),
  )
  const missing = variantIds.filter((id) => !map.has(id))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', { message: `unknown variant(s): ${missing.join(', ')}` })
  return map
}

/**
 * The GST and cess rate that applied to an HSN ON THE INVOICE DATE. A rate change is a new `hsn_rates`
 * row with its own `effective_from`, so a reprint of an old bill always shows the old rate. A missing
 * rate is a 400 naming the HSN — never a silent 0%, which would under-declare tax.
 */
export interface HsnRate {
  gstBps: number
  cessBps: number
}

export async function loadHsnRates(
  tx: Db,
  hsnCodes: readonly string[],
  on: string,
): Promise<Map<string, HsnRate>> {
  const wanted = [...new Set(hsnCodes)]
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({
      hsnCode: hsnRates.hsnCode,
      gstBps: hsnRates.gstBps,
      cessBps: hsnRates.cessBps,
      effectiveFrom: hsnRates.effectiveFrom,
    })
    .from(hsnRates)
    .where(
      and(
        inArray(hsnRates.hsnCode, wanted),
        lte(hsnRates.effectiveFrom, on),
        or(isNull(hsnRates.effectiveTo), gte(hsnRates.effectiveTo, on)),
      ),
    )
    .orderBy(desc(hsnRates.effectiveFrom))
  const map = new Map<string, HsnRate>()
  for (const row of rows)
    if (!map.has(row.hsnCode)) map.set(row.hsnCode, { gstBps: row.gstBps, cessBps: row.cessBps })
  const missing = wanted.filter((code) => !map.has(code))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', {
      message: `no GST rate for HSN ${missing.join(', ')} on ${on}; add an hsn_rates row`,
      data: { hsnCodes: missing, on },
    })
  return map
}

// ---------------------------------------------------------------------------------------------------------------
// the parties on the document

/** Everything about the shop that is frozen onto the bill at issue. */
export interface BuyerProfile {
  id: string
  name: string
  gstin: string | null
  stateCode: string
  address: Record<string, unknown> | null
  fssai: string | null
  creditDays: number
  cashDiscountBps: number
  cashDiscountDays: number
}

export async function loadBuyer(tx: Db, retailerId: string): Promise<BuyerProfile> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({
      id: retailers.id,
      name: retailers.name,
      gstin: retailers.gstin,
      gstRegType: retailers.gstRegType,
      stateCode: retailers.stateCode,
      address: retailers.address,
      creditDays: retailers.creditDays,
      cashDiscountBps: retailers.cashDiscountBps,
      cashDiscountDays: retailers.cashDiscountDays,
      fssai: retailerIdentities.fssaiLicense,
    })
    .from(retailers)
    .leftJoin(retailerIdentities, eq(retailerIdentities.id, retailers.identityId))
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, retailerId)))
    .limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `retailer ${retailerId} not found` })
  // An `unregistered` or `composition` shop has no GSTIN to print even if one was captured.
  const gstin = row.gstRegType === 'regular' ? row.gstin : null
  return {
    id: row.id,
    name: row.name,
    gstin,
    stateCode: row.stateCode,
    address: (row.address as Record<string, unknown> | null) ?? null,
    fssai: row.fssai,
    creditDays: row.creditDays,
    cashDiscountBps: row.cashDiscountBps,
    cashDiscountDays: row.cashDiscountDays,
  }
}

/**
 * Place of supply drives the CGST/SGST vs IGST split. The shop's `state_code` is the source of truth,
 * except that a registered buyer's GSTIN prefix IS its state by law: when the two disagree we trust the
 * GSTIN, because that is the number the return is filed against.
 */
export function placeOfSupplyOf(buyer: BuyerProfile): string {
  return buyer.gstin ? buyer.gstin.slice(0, 2) : buyer.stateCode
}

/**
 * The DISTRIBUTOR's own identity on every document a shopkeeper sees (docs/17 §D answer 6). The loader
 * moved to `modules/tenancy/branding.ts` at the platform-gaps slice — tenancy owns `tenant_settings`,
 * and receivables (which billing imports) needs the same block on a receipt, so it could not stay
 * here without a cycle. Re-exported so every billing call site and the warehouse's `sellerBranding`
 * import keep working unchanged.
 */
export { sellerBranding as loadSeller, loadSettings } from '../tenancy/index.js'

// ---------------------------------------------------------------------------------------------------------------
// the UPI intent printed as a QR

/**
 * `upi://pay?pa=<vpa>&pn=<payee>&am=<rupees>&tr=<ref>&cu=INR`. The payee is the DISTRIBUTOR's own
 * display name (§D6). Returns null — never an invented VPA — when the tenant has not configured one:
 * a QR that pays the wrong person is far worse than no QR.
 */
export function upiIntent(i: {
  vpa: string | null
  payeeName: string
  amountPaise: number
  reference: string | null
}): string | null {
  if (!i.vpa || i.amountPaise <= 0) return null
  const amount = (i.amountPaise / 100).toFixed(2)
  const params = [
    `pa=${encodeURIComponent(i.vpa)}`,
    `pn=${encodeURIComponent(i.payeeName)}`,
    `am=${amount}`,
    ...(i.reference ? [`tr=${encodeURIComponent(i.reference.replace(/\//g, '-'))}`] : []),
    'cu=INR',
  ]
  return `upi://pay?${params.join('&')}`
}
