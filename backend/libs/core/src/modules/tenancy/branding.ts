import { ORPCError } from '@orpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SellerBranding } from '@dos/contracts'
import { tenants, tenantSettings, TENANT_SETTING_KEYS, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { createObjectStorage, ObjectStorageError } from '../../platform/object-storage.js'

/**
 * THE WHITE-LABEL BLOCK (docs/17 §D answer 6, docs/22 never-list item 10). Every document a shopkeeper
 * sees — tax invoice, credit note, delivery challan, receipt — and every app's chrome carry the
 * DISTRIBUTOR's own name and logo, never "Distribution OS". This file is the one loader: billing,
 * warehouse and receivables import `sellerBranding` from tenancy's index rather than each reading
 * `tenant_settings` their own way, and `tenancy.branding.get` answers the same block to the apps.
 *
 * It lives in TENANCY because tenancy is the module that owns `tenant_settings` and `tenants`, and
 * because it is the only module every other one may import without a cycle: billing already imports
 * receivables (the ledger), so a receipt's seller block could never have come from billing.
 *
 * Plain functions, no `@Injectable`: the worker's PDF renderer calls them too (coordination §3.9).
 */

/** How long a logo link stays good: a day, so the app chrome does not refetch it on every screen. */
export const LOGO_URL_TTL_SECONDS = 24 * 60 * 60

/**
 * The DISTRIBUTOR's own identity, read from `tenant_settings` with `tenants` as the fallback, so a
 * distributor that has configured nothing still prints its legal name rather than ours. A logo that
 * has never been uploaded is simply absent: `logoUrl` is null and the sheet prints no logo.
 */
export async function sellerBranding(tx: Db): Promise<SellerBranding> {
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
    logoUrl:
      logoObjectKey === null ? null : await signedObjectUrl(logoObjectKey, LOGO_URL_TTL_SECONDS),
    invoiceFooter: asText(settings.get(TENANT_SETTING_KEYS.brandingInvoiceFooter)),
    upiVpa: asText(settings.get(TENANT_SETTING_KEYS.upiVpa)),
  }
}

/**
 * The values of a handful of settings keys. A key that is absent means "not configured", never "".
 *
 * WHY THE ESCALATION. Migration 0009 gives `tenant_settings` a staff read policy that excludes the
 * `retailer` role, and 0013 lets the retailer read `branding.%` keys only. But the shopkeeper is
 * exactly who needs the white-label name on the bill it is looking at AND the UPI id it is about to
 * pay into (docs/17 §D4, §D6). So for THIS read only, and only for the named non-secret keys,
 * `app.actor_role` becomes `system` for one statement and is restored immediately inside the same
 * transaction — the pattern `modules/orders`' `recordTransition` already uses. The `secret.` guard
 * below is what makes the escalation safe for ever: a credential added in six months cannot be
 * reached through it even if a caller asks for it by name.
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
export function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function asAddress(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * A short-lived link to an object. Object storage is configuration, so a tenant on the local driver
 * or a misconfigured bucket must never turn a bill into a 500: the document simply prints without a
 * logo (null), and a caller that needs the URL for its own sake checks for null.
 */
export async function signedObjectUrl(key: string, ttlSeconds?: number): Promise<string | null> {
  try {
    return await createObjectStorage().getUrl(key, ttlSeconds)
  } catch (error) {
    if (error instanceof ObjectStorageError) return null
    throw error
  }
}
