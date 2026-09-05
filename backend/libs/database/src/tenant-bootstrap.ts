import { eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import type { Db } from './client.js'
import {
  accounts,
  featureFlags,
  locations,
  numberingSeries,
  tenants,
  tenantSettings,
} from './schema/index.js'

/**
 * Everything a brand-new tenant needs before its first transaction (ADR 0004 chart of accounts, ADR 0003
 * locations, ADR 0001 numbering series). Idempotent: safe to re-run for an existing tenant.
 * Called by the seed and by the tenancy service when a distributor signs up.
 */

/** Indian financial year label for a date, e.g. 2026-09-04 -> "2026-27". */
export function financialYear(date: Date = new Date()): string {
  const y = date.getFullYear()
  const start = date.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export const CHART_OF_ACCOUNTS = [
  { code: 'AR', name: 'Sundry Debtors (retailers)', kind: 'asset' },
  { code: 'AP', name: 'Sundry Creditors (suppliers)', kind: 'liability' },
  { code: 'CASH', name: 'Cash in hand', kind: 'asset' },
  { code: 'CASH_VAN', name: 'Cash with delivery crews', kind: 'asset' },
  { code: 'UPI', name: 'UPI clearing', kind: 'asset' },
  { code: 'BANK', name: 'Bank', kind: 'asset' },
  { code: 'CHEQUES', name: 'Cheques in hand', kind: 'asset' },
  { code: 'SALES', name: 'Sales', kind: 'income' },
  { code: 'SALES_RETURNS', name: 'Sales returns', kind: 'income' },
  { code: 'DISCOUNTS', name: 'Discounts allowed', kind: 'expense' },
  { code: 'CASH_DISCOUNT', name: 'Cash discount allowed', kind: 'expense' },
  { code: 'SCHEME_EXPENSE', name: 'Scheme expense (distributor funded)', kind: 'expense' },
  { code: 'SCHEME_RECEIVABLE', name: 'Scheme receivable from manufacturers', kind: 'asset' },
  { code: 'CLAIMS_RECEIVABLE', name: 'Claims receivable (damage/expiry)', kind: 'asset' },
  { code: 'OUTPUT_CGST', name: 'Output CGST', kind: 'liability' },
  { code: 'OUTPUT_SGST', name: 'Output SGST', kind: 'liability' },
  { code: 'OUTPUT_IGST', name: 'Output IGST', kind: 'liability' },
  { code: 'OUTPUT_CESS', name: 'Output cess', kind: 'liability' },
  { code: 'INPUT_CGST', name: 'Input CGST', kind: 'asset' },
  { code: 'INPUT_SGST', name: 'Input SGST', kind: 'asset' },
  { code: 'INPUT_IGST', name: 'Input IGST', kind: 'asset' },
  { code: 'PURCHASES', name: 'Purchases', kind: 'expense' },
  { code: 'STOCK', name: 'Stock in hand', kind: 'asset' },
  { code: 'DAMAGES', name: 'Damages and expiry write-off', kind: 'expense' },
  { code: 'ROUND_OFF', name: 'Round off', kind: 'income' },
  { code: 'BAD_DEBTS', name: 'Bad debts written off', kind: 'expense' },
  { code: 'BANK_CHARGES', name: 'Bank charges', kind: 'expense' },
  { code: 'CASH_SHORT', name: 'Cash short/over on settlement', kind: 'expense' },
  { code: 'TRIP_EXPENSES', name: 'Delivery trip expenses', kind: 'expense' },
  { code: 'OPENING', name: 'Opening balance equity', kind: 'equity' },
] as const

export const NUMBERING_SERIES = [
  { seriesCode: 'INV', prefix: 'INV/' },
  { seriesCode: 'CN', prefix: 'CN/' },
  { seriesCode: 'SO', prefix: 'SO-' },
  { seriesCode: 'GRN', prefix: 'GRN-' },
  { seriesCode: 'PO', prefix: 'PO-' },
  { seriesCode: 'RCPT', prefix: 'RCPT-' },
  { seriesCode: 'TRIP', prefix: 'TRIP-' },
  { seriesCode: 'PICK', prefix: 'PICK-' },
  /** Rule 55 delivery challan, allocated at `warehouse.loadSheets.confirm` — never at draft. */
  { seriesCode: 'DC', prefix: 'DC-' },
  { seriesCode: 'CLAIM', prefix: 'CLM-' },
] as const

/**
 * WHITE-LABEL SETTINGS (docs/17 §D answer 6). The product is white-labelled per distributor: every
 * document a shopkeeper sees — tax invoice, credit note, delivery challan, statement, WhatsApp message
 * — and the app chrome itself carry the DISTRIBUTOR's own name and logo, never "Distribution OS".
 * These key names are the contract between the owner app's settings screen, the document renderer and
 * every module that prints something; read them, never hard-code a name.
 *
 * | key                        | JSON     | meaning                                                    |
 * | -------------------------- | -------- | ---------------------------------------------------------- |
 * | `branding.display_name`    | string   | business name as printed. Defaults to `tenants.legal_name`. |
 * | `branding.logo_object_key` | string   | object-storage key of the logo. ABSENT until uploaded.      |
 * | `branding.invoice_footer`  | string   | free text under the totals on every printed document.       |
 * | `branding.address`         | object   | the seller's own address block (AddressSchema shape).        |
 * | `seller_fssai`             | string   | FSSAI licence printed on a food invoice. ABSENT = omit it.  |
 * | `upi_vpa`                  | string   | the UPI id the invoice QR pays into. ABSENT = print no QR.  |
 * | `ewb_intra_state_threshold`| number   | paise; a vehicle load at or above it needs an e-way bill.   |
 * | `delivery.settlement_tolerance_paise` | number | cash short/over a crew may hand in without the owner. |
 * | `delivery.pod_required`    | string   | `always` / `credit_only` / `never`: when a photo/signature is a must. |
 * | `delivery.geofence_metres` | number   | distance from the shop pin that turns the arrival amber (evidence). |
 * | `dpdp.gps_retention_days`  | number   | days raw `trip_points` are kept; stop coordinates and POD stay. |
 * | `notifications.default_locale` | string | `LocaleSchema` value a message falls back to when the shop has no `preferred_lang`. |
 * | `whatsapp.phone_number_id` | string   | the Meta Cloud API phone number this tenant sends from. ABSENT = stub adapter. |
 *
 * The four `delivery.*` / `dpdp.*` rows were added by the delivery slice (coordination §2, delivery §3
 * item 11): the crew's offline device reads them through `trips.get` (`TripDetail.settings`, docs/23
 * §8.4), the settlement trigger `dos_trip_settlement_guard` (migration 0015) reads the tolerance, and
 * the worker's retention sweep reads the GPS window. Seeded so none of them ever reads as "absent".
 *
 * `notifications.default_locale` was added by the notifications slice (coordination §2, slice 8):
 * seeded `en-IN`, not the brief's `hi-IN` — English only for now (founder, 2026-09-04). The locale
 * chain is the shop's `retailer_links.preferred_lang` → this row → `en-IN`. `whatsapp.phone_number_id`
 * is deliberately NOT seeded: absent means the stub adapter; the Meta status webhook resolves a tenant
 * by this value, so a made-up one would misroute a real receipt. The Meta access token, when it exists,
 * is `secret.whatsapp.access_token` (owner-only by the `secret.` rule).
 *
 * `branding.address` and `seller_fssai` were added by the billing slice: both are printed on the tax
 * invoice and the credit note, and neither has a sensible default — a made-up address on a GST document
 * is worse than a blank one.
 *
 * `logo_object_key` and `upi_vpa` are deliberately NOT seeded: absent means "not configured", and the
 * renderer prints no logo and the `upiQr` procedure answers `payload: null` rather than inventing one.
 * `upi_vpa` keeps its bare, un-namespaced name because billing's `invoices.upiQr` already reads it
 * under that name. Any setting that is a credential or a token is named `secret.<name>` and stays
 * owner-only — staff read everything else (coordination §5.1).
 */
export const TENANT_SETTING_KEYS = {
  brandingDisplayName: 'branding.display_name',
  brandingLogoObjectKey: 'branding.logo_object_key',
  brandingInvoiceFooter: 'branding.invoice_footer',
  brandingAddress: 'branding.address',
  sellerFssai: 'seller_fssai',
  upiVpa: 'upi_vpa',
  ewbIntraStateThreshold: 'ewb_intra_state_threshold',
  deliverySettlementTolerancePaise: 'delivery.settlement_tolerance_paise',
  deliveryPodRequired: 'delivery.pod_required',
  deliveryGeofenceMetres: 'delivery.geofence_metres',
  dpdpGpsRetentionDays: 'dpdp.gps_retention_days',
  notificationsDefaultLocale: 'notifications.default_locale',
  whatsappPhoneNumberId: 'whatsapp.phone_number_id',
} as const

/**
 * The locale a message is sent in when the shop has stated no preference (notifications §4.4 chain,
 * English-only decision). A `LocaleSchema` value (`en-IN | hi-IN | mr-IN`); the owner changes the
 * `tenant_settings` row, never this constant.
 */
export const DEFAULT_NOTIFICATION_LOCALE = 'en-IN'

/**
 * ₹1,00,000 in paise. A vehicle load worth this or more may not leave the godown without an e-way bill
 * number recorded on the load sheet (docs/17 A8, COMPLETENESS 24). The check is on the SHEET, not per
 * invoice: a mixed load crosses ₹1 lakh long before any single bill does. Seeded so a manager reading the
 * setting never gets "absent" and silently loads a lakh of goods with no EWB; the founder confirms the
 * Maharashtra figure with the CA and changes the row, not the code (coordination §7 question 16).
 */
export const DEFAULT_EWB_INTRA_STATE_THRESHOLD_PAISE = 10_000_000

/**
 * Delivery policy defaults (docs/plans/delivery.md §3 item 11, coordination §7 q14, q23, q28 — the
 * founder changes the ROW, never the code). ₹100 of cash short/over closes a trip without the owner;
 * beyond it, or any van stock that does not tally, the settlement is red and `dos_trip_settlement_guard`
 * (migration 0015) insists on the owner's approval — the trigger falls back to this same figure when the
 * row is unreadable, so the two must stay equal. Proof of delivery is a must for credit shops only and
 * OTP is off for the pilot; 150 m from the shop pin is amber evidence, never a block; raw GPS lives 90
 * days (DPDP), stop coordinates and proof stay with the invoice.
 */
export const DEFAULT_SETTLEMENT_TOLERANCE_PAISE = 10_000
export const POD_REQUIRED_MODES = ['always', 'credit_only', 'never'] as const
export type PodRequiredMode = (typeof POD_REQUIRED_MODES)[number]
export const DEFAULT_POD_REQUIRED: PodRequiredMode = 'credit_only'
export const DEFAULT_GEOFENCE_METRES = 150
export const DEFAULT_GPS_RETENTION_DAYS = 90

export const DEFAULT_FLAGS = [
  { flag: 'van_sales', enabled: false },
  { flag: 'brand_dms_import', enabled: true },
  { flag: 'claims_ui', enabled: false },
  { flag: 'retailer_app', enabled: true },
  { flag: 'e_invoicing', enabled: false },
] as const

export async function bootstrapTenant(
  db: Db,
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  const fy = financialYear(now)
  await db
    .insert(accounts)
    .values(
      CHART_OF_ACCOUNTS.map((a) => ({
        id: uuidv7(),
        tenantId,
        code: a.code,
        name: a.name,
        kind: a.kind,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(locations)
    .values([
      { id: uuidv7(), tenantId, kind: 'warehouse', name: 'Godown' },
      {
        id: uuidv7(),
        tenantId,
        kind: 'damaged',
        name: 'Damaged / expiry bin',
        negativeAllowed: true,
      },
      { id: uuidv7(), tenantId, kind: 'in_transit', name: 'In transit' },
    ])
    .onConflictDoNothing()
  await db
    .insert(numberingSeries)
    .values(
      NUMBERING_SERIES.map((s) => ({ tenantId, seriesCode: s.seriesCode, fy, prefix: s.prefix })),
    )
    .onConflictDoNothing()
  await db
    .insert(featureFlags)
    .values(DEFAULT_FLAGS.map((f) => ({ tenantId, flag: f.flag, enabled: f.enabled })))
    .onConflictDoNothing()
  const [tenant] = await db
    .select({ legalName: tenants.legalName })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  await db
    .insert(tenantSettings)
    .values([
      { tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: tenant?.legalName ?? '' },
      { tenantId, key: TENANT_SETTING_KEYS.brandingInvoiceFooter, value: '' },
      {
        tenantId,
        key: TENANT_SETTING_KEYS.ewbIntraStateThreshold,
        value: DEFAULT_EWB_INTRA_STATE_THRESHOLD_PAISE,
      },
      {
        tenantId,
        key: TENANT_SETTING_KEYS.deliverySettlementTolerancePaise,
        value: DEFAULT_SETTLEMENT_TOLERANCE_PAISE,
      },
      { tenantId, key: TENANT_SETTING_KEYS.deliveryPodRequired, value: DEFAULT_POD_REQUIRED },
      { tenantId, key: TENANT_SETTING_KEYS.deliveryGeofenceMetres, value: DEFAULT_GEOFENCE_METRES },
      {
        tenantId,
        key: TENANT_SETTING_KEYS.dpdpGpsRetentionDays,
        value: DEFAULT_GPS_RETENTION_DAYS,
      },
      {
        tenantId,
        key: TENANT_SETTING_KEYS.notificationsDefaultLocale,
        value: DEFAULT_NOTIFICATION_LOCALE,
      },
    ])
    .onConflictDoNothing()
}
