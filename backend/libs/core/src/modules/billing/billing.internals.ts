import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { SellerBranding } from '@dos/contracts'
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
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { createObjectStorage, ObjectStorageError } from '../../platform/object-storage.js'

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
 * The DISTRIBUTOR's own identity on every document a shopkeeper sees (docs/17 §D answer 6). Read from
 * `tenant_settings` — readable by every staff role since migration 0009 — with `tenants` as the
 * fallback, so a distributor that has configured nothing still prints its legal name rather than ours.
 * A logo that has never been uploaded is simply absent: `logoUrl` is null and the sheet prints no logo.
 */
export async function loadSeller(tx: Db): Promise<SellerBranding> {
  const { tenantId } = currentTenant()
  const [tenant] = await tx
    .select({ legalName: tenants.legalName, gstin: tenants.gstin, stateCode: tenants.stateCode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!tenant)
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `tenant ${tenantId} not found` })
  const settings = await loadSettings(tx, [
    TENANT_SETTING_KEYS.brandingDisplayName,
    TENANT_SETTING_KEYS.brandingLogoObjectKey,
    TENANT_SETTING_KEYS.brandingInvoiceFooter,
    TENANT_SETTING_KEYS.brandingAddress,
    TENANT_SETTING_KEYS.sellerFssai,
    TENANT_SETTING_KEYS.upiVpa,
  ])
  const logoObjectKey = asText(settings.get(TENANT_SETTING_KEYS.brandingLogoObjectKey))
  return {
    displayName: asText(settings.get(TENANT_SETTING_KEYS.brandingDisplayName)) ?? tenant.legalName,
    legalName: tenant.legalName,
    gstin: tenant.gstin,
    stateCode: tenant.stateCode,
    fssai: asText(settings.get(TENANT_SETTING_KEYS.sellerFssai)),
    address: asAddress(settings.get(TENANT_SETTING_KEYS.brandingAddress)),
    logoObjectKey,
    logoUrl: logoObjectKey === null ? null : await signedLogoUrl(logoObjectKey),
    invoiceFooter: asText(settings.get(TENANT_SETTING_KEYS.brandingInvoiceFooter)),
    upiVpa: asText(settings.get(TENANT_SETTING_KEYS.upiVpa)),
  }
}

/**
 * The values of a handful of settings keys. A key that is absent means "not configured", never "".
 *
 * WHY THE ESCALATION. Migration 0009 gives `tenant_settings` a staff read policy that deliberately
 * excludes the `retailer` role — a shopkeeper is a guest in the distributor's tenant and has no business
 * reading its configuration. But the shopkeeper is exactly who needs the white-label name on the bill it
 * is looking at, and the UPI id it is about to pay into (docs/17 §D4: the retailer app pays online, §D6:
 * every document carries the distributor's own name). So for THIS read only, and only for the named
 * non-secret keys, `app.actor_role` becomes `system` for one statement and is restored immediately
 * inside the same transaction — the pattern `modules/orders`' `recordTransition` already uses. The
 * `secret.` guard below is what makes the escalation safe for ever: a credential added in six months
 * cannot be reached through it even if a caller asks for it by name.
 */
export async function loadSettings(tx: Db, keys: readonly string[]): Promise<Map<string, unknown>> {
  const ctx = currentTenant()
  if (keys.length === 0) return new Map()
  const secret = keys.find((key) => key.startsWith('secret.'))
  if (secret !== undefined)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `${secret} is a credential; it is owner-only and never read for a document`,
    })
  const read = async (): Promise<Map<string, unknown>> => {
    const rows = await tx
      .select({ key: tenantSettings.key, value: tenantSettings.value })
      .from(tenantSettings)
      .where(and(eq(tenantSettings.tenantId, ctx.tenantId), inArray(tenantSettings.key, [...keys])))
    return new Map(rows.map((r) => [r.key, r.value]))
  }
  if (ctx.actorRole !== 'retailer') return read()
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await read()
  } finally {
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

/** A jsonb setting that should be a non-empty string. Anything else reads as "not configured". */
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asAddress(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * A short-lived link to the logo. Object storage is configuration, so a tenant on the local driver or a
 * misconfigured bucket must never turn a bill into a 500: the document simply prints without a logo.
 */
async function signedLogoUrl(key: string): Promise<string | null> {
  try {
    return await createObjectStorage().getUrl(key)
  } catch (error) {
    if (error instanceof ObjectStorageError) return null
    throw error
  }
}

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
