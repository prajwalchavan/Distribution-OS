import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  GstinSchema,
  IdSchema,
  LocaleSchema,
  MembershipRoleSchema,
  MutationBase,
  PasswordSchema,
  PhoneSchema,
  QueryIntSchema,
  StateCodeSchema,
  UsernameSchema,
} from './common.js'
import { AddressSchema } from './retailers.js'

/**
 * Tenancy — the distributor itself: who it is (`me`, `tenant.update`), how it looks to a shopkeeper
 * (`branding.get`), how it is configured (`settings`, `numbering`, `featureFlags`), who works in it
 * (`staff`) and who changed what (`audit`). It owns `tenants`, `memberships`, `tenant_settings`,
 * `numbering_series`, `feature_flags` and `audit_log`.
 *
 * WHICH SERVICES MOUNT `tenancy` (every one of the six; auth-service :3000 mounts nothing here):
 *
 *   owner :3001      YES — the whole surface. This is the only service where `settings.set`,
 *                    `numbering.upsert`, `featureFlags.set` and `tenant.update` can succeed (OWNER_ONLY)
 *   manager :3002    YES — manager + accountant: `me`, `branding.get`, `settings.get` (non-secret keys,
 *                    e.g. the e-way bill threshold on the load-out desk), `featureFlags.list`,
 *                    `audit.list`, `staff.list`; the manager also runs `staff.create/update/
 *                    setPassword/setStatus` (ONBOARDERS). The accountant reads and never writes here
 *                    (docs/22, 2026-09-05: NO settings for the accountant)
 *   sales :3003      YES — `me`, `branding.get` (the app chrome), `settings.get`, `featureFlags.list`
 *   warehouse :3004  YES — the same four reads
 *   delivery :3005   YES — the same four reads; `settings.get` carries the delivery policy keys
 *                    (settlement tolerance, POD policy, geofence) the crew's offline device caches, and
 *                    `branding.get` the display name in the foreground GPS notification
 *   retailer :3006   YES — `me`, `branding.get` and `featureFlags.list` ONLY. The retailer role cannot
 *                    read `tenant_settings` at the database (policy `tenant_settings_staff_read` excludes
 *                    it), so `branding.get` is SERVICE-MEDIATED: the handler reads the keys as the
 *                    service, never as the caller, and hands back a pre-signed logo URL
 *
 * WHITE-LABEL (docs/17 §D6, docs/22 §7 and never-list item 10). The product is white-labelled: inside
 * every app and on every printed or shared document the distributor sees and shows THEIR OWN name and
 * logo, never "Distribution OS". `SellerBrandingSchema` below is that block. It lives HERE — not in
 * billing — because it is the tenant's identity, read by billing (invoice, credit note), warehouse
 * (challan), receivables (receipt) and every app's chrome (`branding.get`); putting it in billing would
 * make receivables import billing, and billing already imports receivables. Keys come from
 * `TENANT_SETTING_KEYS` in `@dos/db` (`branding.display_name`, `branding.logo_object_key`,
 * `branding.invoice_footer`, `branding.address`, `seller_fssai`, `upi_vpa`), falling back to
 * `tenants.legal_name` / `gstin` / `state_code`.
 *
 * FOUNDER ANSWERS THAT SHAPE THIS FILE: the invoice series is per-tenant configuration, never code
 * (docs/17 §D1) — `numbering.upsert` is that setting, changeable until the first number of the series
 * is issued; no per-vehicle or device-allocated series exists (§D5), so `allocationMode` on the wire
 * accepts `server` and `external` only. Every write below is the owner's alone and lands in
 * `audit_log`, which `audit.list` reads back. English only for now: no `hi-IN` defaults anywhere here.
 */

const IsoDateSchema = z.iso.date()
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// the tenant, the user, the membership

export const TenantSchema = z.object({
  id: IdSchema,
  slug: z.string().min(2).max(40),
  legalName: z.string().min(2).max(200),
  gstin: GstinSchema.nullable(),
  stateCode: StateCodeSchema,
  plan: z.enum(['pilot', 'starter', 'growth']),
  status: z.enum(['active', 'suspended', 'closed']),
})
export type Tenant = z.infer<typeof TenantSchema>

export const UserSchema = z.object({
  id: IdSchema,
  /** Null while the user has been invited but not given a sign-in name yet. */
  username: UsernameSchema.nullable(),
  phone: PhoneSchema,
  name: z.string().min(1).max(120),
  locale: LocaleSchema,
})
export type User = z.infer<typeof UserSchema>

export const MembershipSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  userId: IdSchema,
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
})
export type Membership = z.infer<typeof MembershipSchema>

export const MeOutputSchema = z.object({
  user: UserSchema,
  tenant: TenantSchema,
  membership: MembershipSchema,
})
export type MeOutput = z.infer<typeof MeOutputSchema>

/**
 * The owner edits the legal identity that prints on every tax document. `slug`, `plan` and `status`
 * are platform-managed and deliberately absent. Audited (`tenant.update` in `audit_log`).
 */
export const TenantUpdateInput = MutationBase.extend({
  legalName: z.string().trim().min(2).max(200),
  gstin: GstinSchema.nullable().optional(),
  stateCode: StateCodeSchema,
})
export type TenantUpdateIn = z.infer<typeof TenantUpdateInput>
export const TenantUpdateOutput = z.object({ item: TenantSchema })
export type TenantUpdateOut = z.infer<typeof TenantUpdateOutput>

// ---------------------------------------------------------------------------------------------------------------
// branding — the distributor's own identity on every document and every screen

/**
 * The distributor's own identity on every document a shopkeeper sees and in every app's chrome (§D6).
 * Read from `tenant_settings` (`branding.display_name`, `branding.logo_object_key`,
 * `branding.invoice_footer`, `branding.address`, `seller_fssai`, `upi_vpa`) with `tenants.legal_name`
 * / `gstin` / `state_code` as the fallback. `logoUrl` is a pre-signed object-storage URL good for 24
 * hours and is null until a logo is uploaded (`files.uploadUrl` with `domain: 'logo'`, then
 * `settings.set` of `branding.logo_object_key`).
 */
export const SellerBrandingSchema = z.object({
  displayName: z.string(),
  legalName: z.string(),
  gstin: z.string().nullable(),
  stateCode: StateCodeSchema,
  fssai: z.string().nullable(),
  address: AddressSchema.nullable(),
  logoObjectKey: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** The tenant's own terms/footer line printed under the totals. */
  invoiceFooter: z.string().nullable(),
  upiVpa: z.string().nullable(),
})
export type SellerBranding = z.infer<typeof SellerBrandingSchema>

/** `branding.get` answers the block itself: the app chrome needs nothing else. */
export const BrandingGetOutput = SellerBrandingSchema
export type BrandingGet = z.infer<typeof BrandingGetOutput>

// ---------------------------------------------------------------------------------------------------------------
// settings — the key/value rows of `tenant_settings`

/**
 * A setting key: dotted lowercase, e.g. `branding.display_name`, `delivery.pod_required`,
 * `secret.whatsapp_token`. `secret.*` keys are owner-only at the database and never leave
 * `settings.get` for any other role.
 */
export const SettingKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
    'dotted lowercase key, e.g. branding.display_name',
  )
export type SettingKey = z.infer<typeof SettingKeySchema>

/** A JSON value: a string, a number (paise, metres, days — always an integer), a boolean or an object. */
export const SettingValueSchema = z.union([
  z.string().max(2000),
  z.number().int().safe(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
])
export type SettingValue = z.infer<typeof SettingValueSchema>

export const SettingSchema = z.object({
  key: SettingKeySchema,
  value: SettingValueSchema,
  updatedAt: z.string().nullable(),
})
export type Setting = z.infer<typeof SettingSchema>

/** Omit `keys` for every setting the caller may read; `secret.*` keys are returned to the owner only. */
export const SettingsGetInput = z.object({
  keys: z.array(SettingKeySchema).max(50).optional(),
})
export const SettingsGetOutput = z.object({ items: z.array(SettingSchema) })
export type SettingsGet = z.infer<typeof SettingsGetOutput>

/**
 * Owner only. Upserts every item in one transaction and writes one `audit_log` row per key
 * (`setting.set`, before → after). Rows are keyed by (tenant, key), so there is no client id here.
 */
export const SettingsSetInput = MutationBase.extend({
  items: z
    .array(z.object({ key: SettingKeySchema, value: SettingValueSchema }))
    .min(1)
    .max(50),
})
export type SettingsSetIn = z.infer<typeof SettingsSetInput>
export const SettingsSetOutput = SettingsGetOutput

// ---------------------------------------------------------------------------------------------------------------
// numbering series — the invoice series is a per-tenant setting, never code (docs/17 §D1)

/**
 * `server` = allocated under FOR UPDATE at issue; `external` = numbers printed by a brand DMS and
 * imported (docs/17 A5). `device` is still a value of the database enum but is never written any more:
 * the founder removed per-vehicle, device-allocated series (§D5), so the upsert accepts the other two.
 */
export const AllocationModeSchema = z.enum(['server', 'device', 'external'])
export type AllocationMode = z.infer<typeof AllocationModeSchema>

/** ≤ 12 characters of `[A-Za-z0-9/-]`, so prefix + number stays within the 16-character IRN limit. */
export const SeriesPrefixSchema = z
  .string()
  .max(12)
  .regex(/^[A-Za-z0-9/-]*$/, 'letters, digits, slash and hyphen only')

export const SeriesCodeSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_-]{1,11}$/,
    'series code: 2–12 upper-case letters, digits, hyphen or underscore, e.g. INV, DC, INV-B2C',
  )

export const NumberingSeriesSchema = z.object({
  seriesCode: SeriesCodeSchema,
  /** Indian financial year label, e.g. 2026-27; a series restarts every FY. */
  fy: z.string(),
  prefix: z.string(),
  startingNo: z.number().int().positive(),
  /** The next number that will be issued; `startingNo` while nothing has been issued. */
  nextNo: z.number().int().positive(),
  allocationMode: AllocationModeSchema,
  /** True once the first number of this series and FY has been issued: prefix and start are frozen. */
  lockedAfterFirstIssue: z.boolean(),
})
export type NumberingSeries = z.infer<typeof NumberingSeriesSchema>

export const NumberingListInput = z.object({
  /** Defaults to the current IST financial year. */
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
})
export const NumberingListOutput = z.object({
  fy: z.string(),
  items: z.array(NumberingSeriesSchema),
})
export type NumberingList = z.infer<typeof NumberingListOutput>

/**
 * Owner only, and only while nothing has been issued from that series in that FY (409 `series_locked`
 * afterwards — a printed tax document's numbering never changes under it). Creates the row when the
 * tenant has no series of that code yet. Audited (`numbering.upsert`).
 */
export const NumberingUpsertInput = MutationBase.extend({
  seriesCode: SeriesCodeSchema,
  prefix: SeriesPrefixSchema,
  startingNo: z.number().int().min(1).max(999_999_999),
  allocationMode: AllocationModeSchema.exclude(['device']).default('server'),
  /** Defaults to the current IST financial year. */
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
})
export type NumberingUpsertIn = z.infer<typeof NumberingUpsertInput>
export const NumberingUpsertOutput = z.object({ item: NumberingSeriesSchema })

// ---------------------------------------------------------------------------------------------------------------
// feature flags — what each app hides or shows (`DEFAULT_FLAGS` in @dos/db)

/**
 * `van_sales` shows the van-sale button in the delivery app; `brand_dms_import` the FieldAssist bill
 * capture; `claims_ui` the claims screens; `retailer_app` whether shops may sign in; `e_invoicing`
 * whether `billing.invoices.requestIrn` runs. Readable by every member: an app that hides a feature
 * behind a flag has to know it.
 */
export const FeatureFlagSchema = z.enum([
  'van_sales',
  'brand_dms_import',
  'claims_ui',
  'retailer_app',
  'e_invoicing',
])
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>

export const FeatureFlagRowSchema = z.object({
  flag: FeatureFlagSchema,
  enabled: z.boolean(),
})
export type FeatureFlagRow = z.infer<typeof FeatureFlagRowSchema>

export const FeatureFlagsListOutput = z.object({ items: z.array(FeatureFlagRowSchema) })
export type FeatureFlagsList = z.infer<typeof FeatureFlagsListOutput>

/** Owner only; one `audit_log` row per flag changed. */
export const FeatureFlagsSetInput = MutationBase.extend({
  items: z.array(FeatureFlagRowSchema).min(1).max(20),
})
export type FeatureFlagsSetIn = z.infer<typeof FeatureFlagsSetInput>
export const FeatureFlagsSetOutput = FeatureFlagsListOutput

// ---------------------------------------------------------------------------------------------------------------
// audit — who changed prices, credit, approvals, settings; who exported; who read a GPS trace

export const AuditEntrySchema = z.object({
  id: IdSchema,
  actorId: z.string(),
  actorRole: z.string(),
  /** Dotted verb, e.g. `retailer.set_credit`, `setting.set`, `approval.decide`, `gps.trace_read`. */
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  deviceId: z.string().nullable(),
  occurredAt: z.string(),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

/** Newest first. The window defaults to the last 30 IST days and is capped at 92 (docs/20 rule 3). */
export const AuditListInput = z.object({
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  actorId: IdSchema.optional(),
  action: z.string().trim().min(1).max(60).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const AuditListOutput = z.object({
  items: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
})
export type AuditList = z.infer<typeof AuditListOutput>

// ---------------------------------------------------------------------------------------------------------------
// staff administration

/**
 * Staff administration: the owner (and the manager) create the people who work in this distributor
 * and hand them a temporary password. A retailer is never staff — it arrives through
 * `retailers.linkIdentity` instead, so the role here excludes it.
 */
export const StaffRoleSchema = MembershipRoleSchema.exclude(['retailer'])
export type StaffRole = z.infer<typeof StaffRoleSchema>

export const StaffMemberSchema = z.object({
  userId: IdSchema,
  username: UsernameSchema.nullable(),
  name: z.string().min(1).max(120),
  phone: PhoneSchema,
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
  lastLoginAt: z.iso.datetime().nullable(),
})
export type StaffMember = z.infer<typeof StaffMemberSchema>

export const StaffListOutput = z.object({ items: z.array(StaffMemberSchema) })
export type StaffList = z.infer<typeof StaffListOutput>

export const StaffCreateInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the membership row. */
  id: IdSchema,
  /** Client-generated UUIDv7 of the user; reused when the same person already exists by phone. */
  userId: IdSchema,
  username: UsernameSchema,
  name: z.string().min(1).max(120),
  phone: PhoneSchema,
  role: StaffRoleSchema,
  locale: LocaleSchema.optional(),
  temporaryPassword: PasswordSchema,
})
export type StaffCreateIn = z.infer<typeof StaffCreateInput>

export const StaffCreateOutput = z.object({
  userId: IdSchema,
  membershipId: IdSchema,
  mustChangePassword: z.literal(true),
})
export type StaffCreateOut = z.infer<typeof StaffCreateOutput>

/** Edit a staff member's profile; at least one field. The role is not editable here (disable + re-create). */
export const StaffUpdateInput = MutationBase.extend({
  userId: IdSchema,
  name: z.string().trim().min(1).max(120).optional(),
  phone: PhoneSchema.optional(),
  locale: LocaleSchema.optional(),
}).refine(
  (s) => s.name !== undefined || s.phone !== undefined || s.locale !== undefined,
  'nothing to update: send name, phone or locale',
)
export type StaffUpdateIn = z.infer<typeof StaffUpdateInput>

export const StaffSetPasswordInput = MutationBase.extend({
  userId: IdSchema,
  temporaryPassword: PasswordSchema,
})
export type StaffSetPasswordIn = z.infer<typeof StaffSetPasswordInput>

export const StaffSetStatusInput = MutationBase.extend({
  userId: IdSchema,
  status: z.enum(['active', 'disabled']),
})
export type StaffSetStatusIn = z.infer<typeof StaffSetStatusInput>

/** Staff mutations that succeed without a payload. */
export const StaffOkOutput = z.object({ ok: z.literal(true) })
export type StaffOk = z.infer<typeof StaffOkOutput>

export const staffContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/tenancy/staff',
      summary: 'People who work in this distributor',
    })
    .output(StaffListOutput),
  create: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff',
      summary: 'Add a staff member with a temporary password',
    })
    .input(StaffCreateInput)
    .output(StaffCreateOutput),
  update: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff/update',
      summary: "Edit a staff member's name, phone or locale",
    })
    .input(StaffUpdateInput)
    .output(StaffOkOutput),
  setPassword: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff/set-password',
      summary: 'Reset a staff password; they must change it at next sign-in',
    })
    .input(StaffSetPasswordInput)
    .output(StaffOkOutput),
  setStatus: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff/set-status',
      summary: 'Enable or disable a staff membership (disabling revokes their sessions)',
    })
    .input(StaffSetStatusInput)
    .output(StaffOkOutput),
}

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `tenancy: tenancyContract` in contract.ts

export const tenancyContract = {
  me: oc
    .route({ method: 'GET', path: '/tenancy/me', summary: 'Current user, tenant and membership' })
    .output(MeOutputSchema),
  staff: staffContract,
  branding: {
    get: oc
      .route({
        method: 'GET',
        path: '/tenancy/branding',
        summary: "The distributor's own name, logo and footer for every screen and document",
      })
      .output(BrandingGetOutput),
  },
  settings: {
    get: oc
      .route({
        method: 'GET',
        path: '/tenancy/settings',
        summary: 'Tenant settings (secret.* keys to the owner only)',
      })
      .input(SettingsGetInput)
      .output(SettingsGetOutput),
    set: oc
      .route({
        method: 'POST',
        path: '/tenancy/settings',
        summary: 'Set tenant settings (owner only, audited per key)',
      })
      .input(SettingsSetInput)
      .output(SettingsSetOutput),
  },
  numbering: {
    list: oc
      .route({
        method: 'GET',
        path: '/tenancy/numbering-series',
        summary: 'Document number series for a financial year (owner only)',
      })
      .input(NumberingListInput)
      .output(NumberingListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/tenancy/numbering-series',
        summary: 'Set a series prefix and starting number; locked once the first number is issued',
      })
      .input(NumberingUpsertInput)
      .output(NumberingUpsertOutput),
  },
  featureFlags: {
    list: oc
      .route({
        method: 'GET',
        path: '/tenancy/feature-flags',
        summary: 'Which features are switched on for this distributor',
      })
      .output(FeatureFlagsListOutput),
    set: oc
      .route({
        method: 'POST',
        path: '/tenancy/feature-flags',
        summary: 'Switch features on or off (owner only, audited)',
      })
      .input(FeatureFlagsSetInput)
      .output(FeatureFlagsSetOutput),
  },
  tenant: {
    update: oc
      .route({
        method: 'POST',
        path: '/tenancy/tenant',
        summary: 'Edit the legal name, GSTIN and state (owner only, audited)',
      })
      .input(TenantUpdateInput)
      .output(TenantUpdateOutput),
  },
  audit: {
    list: oc
      .route({
        method: 'GET',
        path: '/tenancy/audit',
        summary: 'Who changed what: prices, credit, approvals, settings, exports, trace reads',
      })
      .input(AuditListInput)
      .output(AuditListOutput),
  },
}
