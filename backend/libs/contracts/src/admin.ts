import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  GstinSchema,
  IdSchema,
  LocaleSchema,
  MembershipRoleSchema,
  MutationBase,
  PaiseSchema,
  PasswordSchema,
  PhoneSchema,
  PlatformRoleSchema,
  QueryBoolSchema,
  QueryIntSchema,
  StateCodeSchema,
  UsernameSchema,
} from './common.js'
import {
  AuditEntrySchema,
  SupportGrantSchema,
  SupportGrantStatusSchema,
  SupportScopeSchema,
  TenantPlanSchema,
  TenantSchema,
  TenantStatusSchema,
} from './tenancy.js'

/**
 * Admin — the platform console of Distribution OS itself (module 13; the founder's decision of
 * 2026-09-05, docs/22 §2 row 7 and §8: "a seventh app + service for organisation onboarding, plans and
 * subscription state, support-access grants — time-boxed, owner-approved, audited"). It onboards a
 * distributor, keeps its subscription, asks a distributor's owner for permission to look inside, lists
 * the global users and their memberships, and shows how the platform as a whole is doing.
 *
 * WHICH SERVICES MOUNT `admin`:
 *
 *   admin :3007      YES — the whole key, and the ONLY service that mounts it. Its `roles` list is
 *                    `['platform_admin']`, so `TenantGuard` refuses every membership role at the
 *                    service gate before a handler runs, and refuses a `platform_admin` token on all
 *                    six tenant services for the mirror-image reason.
 *   owner :3001      NO. The owner's half of the support flow is `tenancy.support.*` (tenancy.ts),
 *                    which owner-service mounts; nothing under `admin.*` is ever reachable by an owner.
 *   manager / sales / warehouse / delivery / retailer   NO.
 *   auth :3000       NO — but it serves `auth.platformLogin` / `platformRefresh` / `platformMe`, the
 *                    only way a `platform_admin` session comes into existence (auth.ts).
 *
 * THE TWO HALVES OF SUPPORT ACCESS. Nothing here lets a platform admin read a distributor's rows. The
 * console can only ASK (`support.request`) and WITHDRAW its own ask (`support.revoke`); the distributor's
 * OWNER decides, from the owner app, through `tenancy.support.approve` / `tenancy.support.revoke`, and
 * the window closes by itself at `expiresAt`. That is the founder's rule from docs/17 §B [57] and
 * docs/22 §2 expressed as two contracts that cannot reach each other: the roles are disjoint enums, and
 * no service mounts both keys.
 *
 * WHAT THIS CONSOLE DELIBERATELY CANNOT SEE. `metrics.overview` answers COUNTS — tenants by status and
 * plan, users active in the last seven days, orders and invoices per day, bytes of object storage — and
 * never a rupee of a distributor's turnover, never a purchase cost, never a margin (docs/22 §9 item 1
 * and item 9: "a tenant never sees another tenant's rows" cuts both ways — the platform bills a
 * subscription, it does not take a cut of trade). `subscriptions.*` carries money, but it is OUR price
 * to the distributor, not the distributor's to its shops. The only path to a distributor's own numbers
 * is an approved support grant, and it is audited.
 *
 * WHITE-LABEL (docs/22 never-list item 10). Everything in this file is INTERNAL: it is the one surface
 * where "Distribution OS" is the brand on screen, because the reader is our own staff. Nothing declared
 * here is ever rendered to a shopkeeper or printed on a document.
 */

const IsoDateSchema = z.iso.date()
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// subscriptions — what the distributor pays us, and whether they are still a customer

/**
 * `trialing` — inside the free window a new tenant is created with; `active` — paying; `past_due` — an
 * invoice of OURS is unpaid but the tenant still works; `suspended` — sign-in refused, data kept (it
 * pairs with `tenants.status = 'suspended'`); `cancelled` — the relationship ended. Suspension is
 * reversible and deliberately not deletion: never-list item 3's "append-only" instinct applied to a
 * customer relationship — no distributor's books disappear because a subscription lapsed.
 */
export const SubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
])
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>

export const BillingIntervalSchema = z.enum(['monthly', 'quarterly', 'yearly'])
export type BillingInterval = z.infer<typeof BillingIntervalSchema>

export const SubscriptionSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  plan: TenantPlanSchema,
  status: SubscriptionStatusSchema,
  /** Integer paise per `billingInterval`, exclusive of GST. Our price to the distributor. */
  amountPaise: PaiseSchema,
  billingInterval: BillingIntervalSchema,
  /** How many staff logins the plan includes; null means "not capped in this plan". */
  seats: z.number().int().positive().nullable(),
  /** IST business dates (`businessDate()`), never a timestamp: a billing period is a day range. */
  currentPeriodStart: IsoDateSchema,
  currentPeriodEnd: IsoDateSchema,
  /**
   * Set while `trialing`; null once the trial has been converted or has lapsed. Named `…Date`, not
   * `…At`, because it is an IST business date and the whole codebase reads that suffix as a date —
   * the docs sampler literally does (`sample.ts`: a name ending in `At` is sampled as a timestamp,
   * which would make the published example fail its own schema).
   */
  trialEndDate: IsoDateSchema.nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  note: z.string().max(500).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Subscription = z.infer<typeof SubscriptionSchema>

export const SubscriptionItemOutput = z.object({ item: SubscriptionSchema })
export type SubscriptionItem = z.infer<typeof SubscriptionItemOutput>

/**
 * Create or replace the subscription row of one tenant. `id` is the client-generated UUIDv7 of the row:
 * sending an id that already exists UPDATES it (one live subscription per tenant), which is why this is
 * an upsert and not a `create` + `update` pair. Changing the plan here is the same word the tenant row
 * carries (`TenantPlanSchema`), so the two can never disagree.
 */
export const SubscriptionUpsertInput = MutationBase.extend({
  id: IdSchema,
  tenantId: IdSchema,
  plan: TenantPlanSchema,
  status: SubscriptionStatusSchema,
  amountPaise: PaiseSchema.nonnegative(),
  billingInterval: BillingIntervalSchema.default('monthly'),
  seats: z.number().int().positive().max(10_000).nullable().optional(),
  currentPeriodStart: IsoDateSchema,
  currentPeriodEnd: IsoDateSchema,
  trialEndDate: IsoDateSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
export type SubscriptionUpsertIn = z.infer<typeof SubscriptionUpsertInput>

export const SubscriptionsListInput = z.object({
  tenantId: IdSchema.optional(),
  status: SubscriptionStatusSchema.optional(),
  plan: TenantPlanSchema.optional(),
  /** Renewals and trials that end within this many days: the console's "needs attention" list. */
  endingWithinDays: QueryIntSchema.min(1).max(365).optional(),
  ...CursorInput,
})
export const SubscriptionsListOutput = z.object({
  items: z.array(SubscriptionSchema),
  nextCursor: z.string().nullable(),
})
export type SubscriptionsList = z.infer<typeof SubscriptionsListOutput>

export const SubscriptionGetInput = z.object({ id: IdSchema })

// ---------------------------------------------------------------------------------------------------------------
// tenants — onboarding a distributor and keeping it alive

/** One row of the console's tenant list: the tenant, its subscription state and its size. */
export const TenantSummarySchema = TenantSchema.extend({
  subscriptionStatus: SubscriptionStatusSchema.nullable(),
  trialEndDate: IsoDateSchema.nullable(),
  /** Active memberships that are not the shopkeeper role. */
  staffCount: z.number().int().nonnegative(),
  retailerCount: z.number().int().nonnegative(),
  /** Orders created in the last 30 IST days — a size signal, never a rupee figure. */
  orders30d: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type TenantSummary = z.infer<typeof TenantSummarySchema>

/** `GET /admin/tenants/{id}`: the summary plus the subscription row and every open support grant. */
export const TenantDetailSchema = TenantSummarySchema.extend({
  subscription: SubscriptionSchema.nullable(),
  supportGrants: z.array(SupportGrantSchema),
  /** Object-storage bytes under `tenant/{tenantId}/`; the one cost figure the console needs. */
  storageBytes: z.number().int().nonnegative(),
  invoices30d: z.number().int().nonnegative(),
})
export type TenantDetail = z.infer<typeof TenantDetailSchema>

/**
 * Onboard a distributor in one call: the tenant row, its chart of accounts / locations / numbering
 * series through `bootstrapTenant`, its first OWNER user with a temporary password, and a trial
 * subscription. Every id is client-generated UUIDv7 so a retried call is the same call — this is the
 * one procedure in the product that creates a tenant, and creating a second one by accident would be
 * expensive to unpick.
 *
 * The owner's password is TEMPORARY by construction (`mustChangePassword` is set), so nobody at
 * Distribution OS knows the distributor's password after the handover call.
 */
export const TenantCreateInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the tenant. */
  id: IdSchema,
  /** Lowercase url-safe handle, unique across the platform, e.g. `tarsun`. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens'),
  legalName: z.string().trim().min(2).max(200),
  gstin: GstinSchema.nullable().optional(),
  stateCode: StateCodeSchema,
  plan: TenantPlanSchema.default('pilot'),
  owner: z.object({
    /** Client-generated UUIDv7 of the user; reused when the person already exists by phone. */
    userId: IdSchema,
    /** Client-generated UUIDv7 of the membership row. */
    membershipId: IdSchema,
    username: UsernameSchema,
    name: z.string().trim().min(1).max(120),
    phone: PhoneSchema,
    locale: LocaleSchema.optional(),
    temporaryPassword: PasswordSchema,
  }),
  subscription: z.object({
    /** Client-generated UUIDv7 of the subscription row. */
    id: IdSchema,
    /** 0 starts a paying subscription straight away. */
    trialDays: z.number().int().min(0).max(365).default(30),
    amountPaise: PaiseSchema.nonnegative().default(0),
    billingInterval: BillingIntervalSchema.default('monthly'),
    seats: z.number().int().positive().max(10_000).nullable().optional(),
  }),
})
export type TenantCreateIn = z.infer<typeof TenantCreateInput>

export const TenantCreateOutput = z.object({
  tenant: TenantSchema,
  owner: z.object({
    userId: IdSchema,
    membershipId: IdSchema,
    username: UsernameSchema,
    mustChangePassword: z.literal(true),
  }),
  subscription: SubscriptionSchema,
})
export type TenantCreateOut = z.infer<typeof TenantCreateOutput>

export const TenantsListInput = z.object({
  status: TenantStatusSchema.optional(),
  plan: TenantPlanSchema.optional(),
  subscriptionStatus: SubscriptionStatusSchema.optional(),
  /** Matches the slug, the legal name or the GSTIN. */
  q: z.string().trim().min(1).max(60).optional(),
  ...CursorInput,
})
export const TenantsListOutput = z.object({
  items: z.array(TenantSummarySchema),
  nextCursor: z.string().nullable(),
})
export type TenantsList = z.infer<typeof TenantsListOutput>

export const TenantGetInput = z.object({ id: IdSchema })
export const TenantGetOutput = z.object({ item: TenantDetailSchema })
export type TenantGet = z.infer<typeof TenantGetOutput>

/**
 * Suspend: every sign-in to this distributor is refused from the next token refresh and nothing is
 * deleted. `reason` is mandatory and lands in the platform audit trail — a distributorship stops
 * working the moment this is called, so "who did this and why" must never be a guess.
 */
export const TenantSuspendInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(500),
})
export type TenantSuspendIn = z.infer<typeof TenantSuspendInput>

export const TenantReactivateInput = MutationBase.extend({
  id: IdSchema,
  note: z.string().trim().max(500).optional(),
})
export type TenantReactivateIn = z.infer<typeof TenantReactivateInput>

export const TenantItemOutput = z.object({ item: TenantSchema })
export type TenantItem = z.infer<typeof TenantItemOutput>

// ---------------------------------------------------------------------------------------------------------------
// support access — the console's half: ask, and withdraw the ask

/**
 * Ask one distributor's owner for a time-boxed window. The row is created `requested` and grants
 * NOTHING; only `tenancy.support.approve` — a call the owner makes, on owner-service — opens it. The
 * defaults are the conservative ones: read-only, four hours.
 */
export const SupportRequestInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the grant row. */
  id: IdSchema,
  tenantId: IdSchema,
  /** Shown to the owner verbatim; it is the whole basis of their decision. */
  reason: z.string().trim().min(10).max(500),
  scope: SupportScopeSchema.default('read_only'),
  hours: z.number().int().min(1).max(72).default(4),
})
export type SupportRequestIn = z.infer<typeof SupportRequestInput>

/** The console's view of a grant: the owner's row plus which distributor it belongs to. */
export const AdminSupportGrantSchema = SupportGrantSchema.extend({
  tenantId: IdSchema,
  tenantSlug: z.string().min(2).max(40),
  tenantName: z.string().min(2).max(200),
})
export type AdminSupportGrant = z.infer<typeof AdminSupportGrantSchema>

export const AdminSupportItemOutput = z.object({ item: AdminSupportGrantSchema })

export const AdminSupportListInput = z.object({
  tenantId: IdSchema.optional(),
  status: SupportGrantStatusSchema.optional(),
  /** Only the grants that are open right now (requested, or approved and not yet expired). */
  openOnly: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const AdminSupportListOutput = z.object({
  items: z.array(AdminSupportGrantSchema),
  nextCursor: z.string().nullable(),
})
export type AdminSupportList = z.infer<typeof AdminSupportListOutput>

/**
 * The console gives the window back before it lapses, or withdraws a request the owner has not decided
 * yet. It can never do the opposite: there is no procedure here that opens a window.
 */
export const AdminSupportRevokeInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().max(500).optional(),
})
export type AdminSupportRevokeIn = z.infer<typeof AdminSupportRevokeInput>

// ---------------------------------------------------------------------------------------------------------------
// users — the global sign-in identities and where they are members

/**
 * A user is global (one phone, one login) and may be a member of several distributors — a shopkeeper
 * buying from three of them, or a person who works for two (docs/22 §2, ADR 0006). The console is the
 * only place that view exists: no tenant-scoped surface may reveal that a phone appears in another
 * distributor's network (docs/17 item 27), which is exactly why `users.list` lives here and nowhere else.
 */
export const AdminMembershipSchema = z.object({
  tenantId: IdSchema,
  tenantSlug: z.string().min(2).max(40),
  tenantName: z.string().min(2).max(200),
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
})
export type AdminMembership = z.infer<typeof AdminMembershipSchema>

/**
 * WHY `username`, `phone` AND `locale` ARE PLAIN STRINGS HERE, and `UsernameSchema` / `PhoneSchema` /
 * `LocaleSchema` everywhere else.
 *
 * Those three schemas are INPUT guards: they decide what may be written, and every procedure that
 * writes a user still applies them (`tenancy.staff.create`, `admin.tenants.create`, the auth service).
 * This is the console's read-only DIRECTORY, and its job includes showing the identity that is WRONG —
 * a row imported from a distributor's old software, one written before a rule existed, or one a bug
 * produced. A schema that refuses to render such a row would 500 the whole page and hide the very
 * thing support was opened to look at. Nothing here is ever sent back as input, so nothing is loosened
 * by saying so.
 */
export const AdminUserSchema = z.object({
  id: IdSchema,
  /** As stored. Written through `UsernameSchema`; shown here even when it predates that rule. */
  username: z.string().nullable(),
  name: z.string().min(1).max(120),
  /** As stored. Written through `PhoneSchema` (Indian mobile, E.164); shown here whatever it holds. */
  phone: z.string(),
  /** As stored. Written through `LocaleSchema` (`en-IN` / `hi-IN` / `mr-IN`). */
  locale: z.string(),
  status: z.enum(['active', 'disabled']),
  /** Set for Distribution OS staff (`platform_admin`); null for everyone who works at a distributor. */
  platformRole: PlatformRoleSchema.nullable(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  memberships: z.array(AdminMembershipSchema),
})
export type AdminUser = z.infer<typeof AdminUserSchema>

export const AdminUsersListInput = z.object({
  /** Matches the username, the name or the phone. */
  q: z.string().trim().min(1).max(60).optional(),
  /** Only the users who are members of this distributor. */
  tenantId: IdSchema.optional(),
  role: MembershipRoleSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
  /** Only Distribution OS staff. */
  platformOnly: QueryBoolSchema.optional(),
  ...CursorInput,
})
export const AdminUsersListOutput = z.object({
  items: z.array(AdminUserSchema),
  nextCursor: z.string().nullable(),
})
export type AdminUsersList = z.infer<typeof AdminUsersListOutput>

/**
 * The platform kill switch for one sign-in identity: `users.status = 'disabled'`, every session
 * revoked, every membership left exactly as it is (this is not a way to remove someone from a
 * distributor — that is `tenancy.staff.setStatus`, and it belongs to the distributor's own owner).
 * `reason` is mandatory and audited: it locks a person out of every distributor at once.
 */
export const AdminUserDisableInput = MutationBase.extend({
  id: IdSchema,
  reason: z.string().trim().min(1).max(500),
})
export type AdminUserDisableIn = z.infer<typeof AdminUserDisableInput>

export const AdminUserItemOutput = z.object({ item: AdminUserSchema })
export type AdminUserItem = z.infer<typeof AdminUserItemOutput>

// ---------------------------------------------------------------------------------------------------------------
// metrics — how the platform as a whole is doing (counts only, never a distributor's rupees)

/** One point of a daily series, IST business dates, ready for a chart with no reshaping. */
export const AdminSeriesPointSchema = z.object({
  day: IsoDateSchema,
  value: z.number().int().nonnegative(),
})
export type AdminSeriesPoint = z.infer<typeof AdminSeriesPointSchema>

export const AdminMetricsInput = z.object({
  /** Length of the daily series, in IST days. Capped at 92 like every other window (docs/20 rule 3). */
  days: QueryIntSchema.min(1).max(92).default(30),
})

/**
 * COUNTS ONLY. There is no rupee of a distributor's trade anywhere in this shape — not turnover, not
 * outstanding, not cost, not margin (docs/22 §9 items 1 and 9). What the platform needs to know is how
 * many distributors there are, how many are paying, how many people signed in this week, how much work
 * the system is doing and how much storage it is buying; all five are answerable from counts.
 */
export const AdminMetricsOutput = z.object({
  generatedAt: z.iso.datetime(),
  windowDays: z.number().int().positive(),
  tenants: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
  }),
  tenantsByPlan: z.array(
    z.object({ plan: TenantPlanSchema, count: z.number().int().nonnegative() }),
  ),
  subscriptions: z.array(
    z.object({ status: SubscriptionStatusSchema, count: z.number().int().nonnegative() }),
  ),
  /** Distinct users with at least one successful sign-in in the last 7 IST days. */
  activeUsers7d: z.number().int().nonnegative(),
  storage: z.object({
    bytes: z.number().int().nonnegative(),
    objects: z.number().int().nonnegative(),
  }),
  series: z.object({
    /** Orders created per day, every tenant summed. */
    orders: z.array(AdminSeriesPointSchema),
    /** Invoices issued per day, every tenant summed. */
    invoices: z.array(AdminSeriesPointSchema),
  }),
  totals: z.object({
    ordersInWindow: z.number().int().nonnegative(),
    invoicesInWindow: z.number().int().nonnegative(),
  }),
})
export type AdminMetrics = z.infer<typeof AdminMetricsOutput>

// ---------------------------------------------------------------------------------------------------------------
// audit — every platform action, across tenants

/**
 * The tenant-side `audit_log` row plus the distributor it happened to. A platform action that belongs
 * to no distributor (creating a tenant, disabling a global user) carries `tenantId: null`. Every
 * mutation in this file writes one of these: onboarding, suspension, reactivation, a subscription
 * change, a support request or withdrawal, a user disable.
 */
export const PlatformAuditEntrySchema = AuditEntrySchema.extend({
  tenantId: IdSchema.nullable(),
  tenantSlug: z.string().nullable(),
})
export type PlatformAuditEntry = z.infer<typeof PlatformAuditEntrySchema>

/** Newest first. The window defaults to the last 30 IST days and is capped at 92 (docs/20 rule 3). */
export const AdminAuditListInput = z.object({
  tenantId: IdSchema.optional(),
  actorId: IdSchema.optional(),
  action: z.string().trim().min(1).max(60).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export const AdminAuditListOutput = z.object({
  items: z.array(PlatformAuditEntrySchema),
  nextCursor: z.string().nullable(),
})
export type AdminAuditList = z.infer<typeof AdminAuditListOutput>

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `admin: adminContract` in contract.ts — admin-service :3007 only

export const adminContract = {
  tenants: {
    create: oc
      .route({
        method: 'POST',
        path: '/admin/tenants',
        summary: 'Onboard a distributor: tenant, chart of accounts, owner login and a trial',
      })
      .input(TenantCreateInput)
      .output(TenantCreateOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/admin/tenants',
        summary: 'Distributors on the platform, with subscription state and size',
      })
      .input(TenantsListInput)
      .output(TenantsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/admin/tenants/{id}',
        summary: 'One distributor: subscription, size, storage and its support grants',
      })
      .input(TenantGetInput)
      .output(TenantGetOutput),
    suspend: oc
      .route({
        method: 'POST',
        path: '/admin/tenants/{id}/suspend',
        summary: 'Refuse every sign-in to this distributor; nothing is deleted (audited)',
      })
      .input(TenantSuspendInput)
      .output(TenantItemOutput),
    reactivate: oc
      .route({
        method: 'POST',
        path: '/admin/tenants/{id}/reactivate',
        summary: 'Let a suspended distributor back in (audited)',
      })
      .input(TenantReactivateInput)
      .output(TenantItemOutput),
  },
  subscriptions: {
    upsert: oc
      .route({
        method: 'POST',
        path: '/admin/subscriptions',
        summary: "Set a distributor's plan, price and period (audited)",
      })
      .input(SubscriptionUpsertInput)
      .output(SubscriptionItemOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/admin/subscriptions',
        summary: 'Subscriptions, filtered by state, plan or what is about to end',
      })
      .input(SubscriptionsListInput)
      .output(SubscriptionsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/admin/subscriptions/{id}',
        summary: 'One subscription',
      })
      .input(SubscriptionGetInput)
      .output(SubscriptionItemOutput),
  },
  support: {
    request: oc
      .route({
        method: 'POST',
        path: '/admin/support-grants',
        summary: "Ask a distributor's owner for a time-boxed window; grants nothing by itself",
      })
      .input(SupportRequestInput)
      .output(AdminSupportItemOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/admin/support-grants',
        summary: 'Support requests and windows across every distributor',
      })
      .input(AdminSupportListInput)
      .output(AdminSupportListOutput),
    revoke: oc
      .route({
        method: 'POST',
        path: '/admin/support-grants/{id}/revoke',
        summary: 'Withdraw our own request, or hand back a window before it lapses',
      })
      .input(AdminSupportRevokeInput)
      .output(AdminSupportItemOutput),
  },
  users: {
    list: oc
      .route({
        method: 'GET',
        path: '/admin/users',
        summary: 'Global sign-in identities with every distributor they are a member of',
      })
      .input(AdminUsersListInput)
      .output(AdminUsersListOutput),
    disable: oc
      .route({
        method: 'POST',
        path: '/admin/users/{id}/disable',
        summary: 'Lock one identity out of every distributor and revoke its sessions (audited)',
      })
      .input(AdminUserDisableInput)
      .output(AdminUserItemOutput),
  },
  metrics: {
    overview: oc
      .route({
        method: 'GET',
        path: '/admin/metrics',
        summary: 'Platform counts: tenants, active users, orders and invoices per day, storage',
      })
      .input(AdminMetricsInput)
      .output(AdminMetricsOutput),
  },
  audit: {
    list: oc
      .route({
        method: 'GET',
        path: '/admin/audit',
        summary: 'Every platform action: onboarding, suspension, plans, support, user locks',
      })
      .input(AdminAuditListInput)
      .output(AdminAuditListOutput),
  },
}
