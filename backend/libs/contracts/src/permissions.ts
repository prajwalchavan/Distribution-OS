import type { MembershipRole, PlatformRole } from './common.js'
import { contract, type AppContract } from './contract.js'

/**
 * Who may call what, declared next to the contract instead of scattered across handlers.
 *
 * The guard in every service reads this table before any business logic runs, the generated READMEs
 * and the OpenAPI document render it, and a spec calls every endpoint with every role against it.
 * It is an application-level check that gives a clear 403: row-level security in Postgres remains
 * the guarantee, and a handler may still narrow further (a retailer sees only its own rows).
 */

export const ALL_ROLES = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'warehouse',
  'delivery',
  'retailer',
] as const satisfies readonly MembershipRole[]

/**
 * Staff of Distribution OS itself (docs/22 §2, the platform console decided on 2026-09-05). NOT part
 * of `ALL_ROLES`: `platform_admin` is not a membership, holds no tenant, and every generated README,
 * permission-matrix spec and role column that walks `ALL_ROLES` is about the six apps' roles. Keeping
 * the two lists apart is what makes the two guarantees structural rather than remembered — a tenant
 * role can never satisfy an `admin.*` row and `platform_admin` can never satisfy a tenant row,
 * because the enums are disjoint.
 */
export const PLATFORM_ROLES = ['platform_admin'] as const satisfies readonly PlatformRole[]

/** Every role the matrix can name: a membership role inside one tenant, or a platform role. */
export type PermissionRole = MembershipRole | PlatformRole

export const ROLE_GROUPS = {
  /** Everyone with an active membership, the shopkeeper included. */
  ANY_MEMBER: ALL_ROLES,
  /** Everyone who works for the distributor. Never the shopkeeper. */
  STAFF: ['owner', 'manager', 'accountant', 'salesperson', 'warehouse', 'delivery'],
  /** The desk: the only roles that may see purchase cost, credit terms and the books. */
  BACK_OFFICE: ['owner', 'manager', 'accountant'],
  /**
   * The money desk (docs/22 decision 2026-09-05): who records an office receipt, reverses one, banks a
   * cheque, marks a bounce, allocates, writes off a debt and sends statements — and who takes the exports.
   * The same three people as BACK_OFFICE, named separately because the accountant's WRITE scope is
   * exactly this and nothing else: no price, scheme, credit limit, approval, setting or catalog row.
   */
  MONEY_DESK: ['owner', 'manager', 'accountant'],
  OWNER_ONLY: ['owner'],
  /** Who physically keeps stock and may count it. */
  STOCK_KEEPERS: ['owner', 'manager', 'warehouse'],
  /** Out on the beat: sees shops and orders, never cost. */
  FIELD: ['salesperson', 'delivery'],
  /**
   * Distribution OS's own staff, and the only group that is not a membership role (docs/22 §2, the
   * founder's platform-console decision of 2026-09-05). It guards `admin.*` and nothing else: a
   * `platform_admin` token carries no `tid`, `TenantGuard` accepts it on admin-service :3007 alone,
   * and no procedure of the six tenant services names this group. Reading a distributor's own rows is
   * NOT in this group's gift — it needs an owner-approved `support_grants` window (tenancy.ts).
   */
  PLATFORM: PLATFORM_ROLES,
} as const satisfies Record<string, readonly PermissionRole[]>

export type RoleGroup = keyof typeof ROLE_GROUPS

/**
 * 'public' = no token at all (sign-in, the JWKS document, liveness).
 * 'authenticated' = a valid access token, whatever role is on it.
 * A role list = a valid access token whose role is in the list. Almost every list is membership roles;
 * the `admin.*` rows are the single exception and name `platform_admin` instead (ROLE_GROUPS.PLATFORM).
 */
export type Permission = readonly PermissionRole[] | 'public' | 'authenticated'

/** Back office plus the warehouse role, which does the physical receiving and stock work. */
const BACK_OFFICE_OR_WAREHOUSE = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
] as const satisfies readonly MembershipRole[]

/**
 * Per-lot balances and the ledger: everyone who holds stock somewhere (a van counts). Never a rep or a
 * shop. It is also warehouse's FULFILMENT_READERS (coordination §6): the reads a crew needs on the road
 * — its load sheet and its challan — plus the accountant who reconciles the paperwork. One tuple, not
 * two: holding stock somewhere and being handed the paperwork for it are the same population.
 */
const STOCK_VIEWERS = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'delivery',
] as const satisfies readonly MembershipRole[]

/** Who may bring a person or a shop into the network (docs/17 item 27: a rep must not probe identities). */
const ONBOARDERS = ['owner', 'manager'] as const satisfies readonly MembershipRole[]

/**
 * Who may take money from a shopkeeper: the desk at the office and the crew at the shop door.
 * The salesperson is deliberately absent — the founder's answer in docs/17 §D4 is that a rep never
 * collects. A shop paying for itself has its own procedure, `receivables.payments.initiate`.
 */
const MONEY_COLLECTORS = [
  'owner',
  'manager',
  'accountant',
  'delivery',
] as const satisfies readonly MembershipRole[]

/** Who may look at a shop's dues and its statement, the shop itself included (RLS narrows it to its own). */
const MONEY_READERS = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'retailer',
] as const satisfies readonly MembershipRole[]

/** The shop's own online-payment path. Never a widening of the receipt endpoint (docs/17 §D4). */
const SHOPKEEPER_ONLY = ['retailer'] as const satisfies readonly MembershipRole[]

/**
 * Who may issue a numbered GST invoice: the desk, plus the warehouse role that packs the order and
 * prints the bill with it. It coincides with BACK_OFFICE_OR_WAREHOUSE today and is deliberately its own
 * tuple — issuing a tax document and receiving stock are different powers that will drift apart.
 */
const BILLING_ISSUERS = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
] as const satisfies readonly MembershipRole[]

/**
 * The manager's PIN: cancelling a NUMBERED document, load-out, releasing a hold. The accountant may
 * issue bills and raise credit notes but may not cancel a numbered one (coordination §7 q13).
 */
const PIN_HOLDERS = ['owner', 'manager'] as const satisfies readonly MembershipRole[]

/**
 * Who RUNS the distributorship: the owner and the manager. Everything the founder took away from the
 * accountant on 2026-09-05 (docs/22 §8) lands here — setting a price list, a scheme, an override, a
 * retailer's credit terms; deciding an approval, a bargain, a gate-count discrepancy; confirming an
 * order into fulfilment; editing the catalog overlay. Same two people as ONBOARDERS and PIN_HOLDERS,
 * declared apart because "who may change the economics" is a different power from "who may bring a
 * person in" or "whose token is the PIN", and the three will drift.
 */
const MANAGEMENT = ['owner', 'manager'] as const satisfies readonly MembershipRole[]

/**
 * Who may look at a shop's dues and its statement: the desk, the rep on the beat, the crew at the door
 * and the shop itself (RLS narrows it to its own). The founder's rule is "the salesperson never
 * COLLECTS" (docs/17 §D4), not "never sees": the outstanding chip on the beat screen and the shop card
 * (docs/22 §4, docs/23 §3.1) are this tuple. Exactly three receivables reads carry it.
 */
const DUES_READERS = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
  'retailer',
] as const satisfies readonly MembershipRole[]

/**
 * Who runs the credit check before an order: the desk, the rep on the device before submit (docs/22 §4
 * S4) and the crew before a van sale. NOT the shop — the verdict carries the credit limit, which the
 * retailer role never sees (retailers.ts). Same as STAFF minus the warehouse.
 */
const CREDIT_CHECKERS = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
] as const satisfies readonly MembershipRole[]

/** Who acts at the shop's door: the crew, with the desk able to do the same thing from the office. */
const DOORSTEP = ['owner', 'manager', 'delivery'] as const satisfies readonly MembershipRole[]

/**
 * Who plans and loads a trip (coordination §6): the desk, the godown that builds the load and the
 * crew that drives it (a van-only day is planned by the crew itself). Never the accountant — a trip
 * plan is not a money-desk write — and never a rep or a shop. A `delivery` caller may only plan a trip
 * it is driver or helper on; the handler enforces that, the tuple only gates the verb.
 */
const TRIP_PLANNERS = [
  'owner',
  'manager',
  'warehouse',
  'delivery',
] as const satisfies readonly MembershipRole[]

/**
 * Who may raise a credit note: the desk, and the delivery crew for a short delivery or a return taken
 * at the door. Separate from MONEY_COLLECTORS on purpose — a credit note is a tax document, not cash.
 */
const CREDIT_NOTE_RAISERS = [
  'owner',
  'manager',
  'accountant',
  'delivery',
] as const satisfies readonly MembershipRole[]

/**
 * Who may accept a LOSS on a claim to a brand (`claims.writeOff`): the owner and the accountant. The
 * manager builds and submits claims but does not decide that money is unrecoverable (claims brief §2,
 * coordination §6). Narrower than MONEY_DESK on purpose — the one money-desk write the manager lacks.
 */
const LOSS_ACCEPTORS = ['owner', 'accountant'] as const satisfies readonly MembershipRole[]

/**
 * Support triage (coordination §6): who reads what a shop texted us and marks it handled — the desk
 * plus the beat-owning rep (the handler scopes a salesperson to the shops on its own beats). Never the
 * godown, the crew or the shop: a rep's own conversations about pricing and complaints are not the
 * crew's business, and a shop does not triage itself.
 */
const TRIAGE = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
] as const satisfies readonly MembershipRole[]

/**
 * Who may push a document to a shop's phone ON DEMAND (`notifications.messages.send`, docs/23 §8.8:
 * "send this bill / receipt / statement to the shop now" — D9, M9, O6): the desk from the office and
 * the crew at the door. The same four people as MONEY_COLLECTORS and CREDIT_NOTE_RAISERS, declared
 * apart because handing a shop its paperwork is neither taking its money nor raising a tax document,
 * and the three will drift. The salesperson is absent on purpose: the rep READS what went to its shops
 * (`messages.list`, ANY_MEMBER) and what they wrote back (TRIAGE) and sends nothing (notifications.ts).
 */
const SHOP_MESSENGERS = [
  'owner',
  'manager',
  'accountant',
  'delivery',
] as const satisfies readonly MembershipRole[]

/**
 * Who reads a rep's numbers (coordination §6 names this tuple for `reporting.dashboard.rep`,
 * `dailyStats.rep`, `retailers.behaviour/lapsed`, `registers.repProductivity`): the desk, and the rep
 * itself — whose `userId` the handler FORCES to its own id whatever it sent, and whose shop reads are
 * scoped to its own beats. The same four people as TRIAGE, declared apart: reading what a shop texted
 * is not reading a rep's strike rate, and the two will drift. Never the godown, the crew or the shop.
 */
const REP_PERFORMANCE_READERS = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
] as const satisfies readonly MembershipRole[]

/**
 * Who reads a trip's performance (coordination §6: `reporting.registers.deliveryPerformance`): the desk,
 * and the crew — whose `driverId` the handler FORCES to its own id, so it sees the trips it drove or
 * helped on and nobody else's. The same four as MONEY_COLLECTORS, declared apart: stops, on-time and POD
 * coverage are not money. Never the rep, the godown or the shop.
 */
const CREW_PERFORMANCE_READERS = [
  'owner',
  'manager',
  'accountant',
  'delivery',
] as const satisfies readonly MembershipRole[]

/**
 * Rep-facing performance surfaces (coordination §6 names this tuple for `incentives.targets.get/list`
 * and `incentives.statements.get/list`): the desk, and the rep or crew member whose target it is —
 * narrowed to their OWN row by RLS (`targets_read`, `achievements_read`, the 0024 `computed_payouts_read`
 * split), never by a filter the client sends. The same five people as CREDIT_CHECKERS and one more than
 * REP_PERFORMANCE_READERS, declared apart: a target is money PROMISED to a named staff member, which is
 * neither a credit decision nor a strike rate. Never the godown or the shop — incentives is not mounted
 * on warehouse- or retailer-service at all (incentives.ts header, coordination §6).
 */
const INCENTIVE_READERS = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'delivery',
] as const satisfies readonly MembershipRole[]

/**
 * Who may turn a message or a voice note into a DRAFT order and confirm one into a real order (docs/22
 * §8, 2026-09-05: the AI features are all in v1). The desk that runs the distributorship, the rep whose
 * shops they are — narrowed by the handler to the shops on its own beats — and the shop itself, forced
 * to its own `retailerId`. The four roles that already reach `orders.create` in practice, and no wider:
 * confirming a draft creates the order through `orders.create/setLines/submit`, so this tuple can only
 * ever be a NARROWING of `orders.*` (ANY_MEMBER), never a second, softer way in. The accountant is
 * absent — a draft order is not a money-desk write (docs/22 §8, 2026-09-05: no prices, no approvals) —
 * and so are the godown and the crew, neither of which takes an order.
 */
const DRAFT_ORDER_TAKERS = [
  'owner',
  'manager',
  'salesperson',
  'retailer',
] as const satisfies readonly MembershipRole[]

/**
 * Who may sequence a trip's stops with the optimiser and push that sequence onto the trip: the desk, and
 * the crew that drives it (the handler narrows a `delivery` caller to a trip it is driver or helper on,
 * the way `delivery.trips.*` already does). The same three people as DOORSTEP, declared apart because
 * planning a day's route is not standing at a door and the two will drift. The godown READS a plan
 * (`ai.routing.get` is TRIP_PLANNERS — the loader wants the order the van will be emptied in) and never
 * computes or applies one; a rep and a shop appear in no routing row at all.
 */
const ROUTE_OPTIMISERS = [
  'owner',
  'manager',
  'delivery',
] as const satisfies readonly MembershipRole[]

const { ANY_MEMBER, STAFF, BACK_OFFICE, MONEY_DESK, OWNER_ONLY, PLATFORM } = ROLE_GROUPS

/** Dotted path of a leaf procedure in the contract, e.g. 'orders.approvals.decide'. */
export type ProcedurePath = ContractPaths<AppContract>

type ContractPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends { '~orpc': unknown }
    ? `${Prefix}${K}`
    : T[K] extends object
      ? ContractPaths<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

/**
 * Every procedure of the contract. Adding one without a line here fails permissions.test.ts, and the
 * guard refuses an undeclared path, so the failure mode is "nobody can call it", never "anybody can".
 */
export const PERMISSIONS: Record<ProcedurePath, Permission> = {
  'health.ping': 'public',

  // Auth. Sign-in obviously cannot require a token; refresh and switch-tenant authenticate with the
  // refresh token in the body, and logout must work even when the access token has already expired.
  'auth.login': 'public',
  'auth.refresh': 'public',
  'auth.logout': 'public',
  'auth.switchTenant': 'public',
  'auth.jwks': 'public',
  'auth.me': 'authenticated',
  'auth.sessions': 'authenticated',
  'auth.revokeSession': 'authenticated',
  'auth.changePassword': 'authenticated',
  // Self-service reset: no token by definition. `forgotPassword` always answers ok; `resetPassword`
  // authenticates with the single-use token in the body.
  'auth.forgotPassword': 'public',
  'auth.resetPassword': 'public',
  // Distribution OS staff (docs/22 §2, 2026-09-05). Sign-in is public for the same reason every
  // sign-in is; the refresh authenticates with the refresh token in its body. `platformMe` is the one
  // procedure outside `admin.*` that names PLATFORM: a membership role asking "who am I as platform
  // staff" is not a question with an answer, so it is refused rather than answered with nulls. The
  // shared session procedures (`logout`, `sessions`, `revokeSession`, `changePassword`) stay
  // 'authenticated' and serve a platform session unchanged — a session is a session.
  'auth.platformLogin': 'public',
  'auth.platformRefresh': 'public',
  'auth.platformMe': PLATFORM,

  // Tenancy. Staff administration is the owner's desk; the accountant may look but not hire. The
  // branding block and the feature flags are read by EVERY member including the shop (the app chrome and
  // the "is this feature on" checks); settings are read by staff (never `secret.*` to a non-owner) and
  // written by the owner alone, as are the numbering series and the tenant's legal identity (docs/22
  // 2026-09-05: NO settings for the accountant). The audit trail is the desk's to read.
  'tenancy.me': ANY_MEMBER,
  'tenancy.staff.list': BACK_OFFICE,
  'tenancy.staff.create': ONBOARDERS,
  'tenancy.staff.update': ONBOARDERS,
  'tenancy.staff.setPassword': ONBOARDERS,
  'tenancy.staff.setStatus': ONBOARDERS,
  'tenancy.branding.get': ANY_MEMBER,
  'tenancy.settings.get': STAFF,
  'tenancy.settings.set': OWNER_ONLY,
  'tenancy.numbering.list': OWNER_ONLY,
  'tenancy.numbering.upsert': OWNER_ONLY,
  'tenancy.featureFlags.list': ANY_MEMBER,
  'tenancy.featureFlags.set': OWNER_ONLY,
  'tenancy.tenant.update': OWNER_ONLY,
  'tenancy.audit.list': BACK_OFFICE,
  // Platform support access is the OWNER's decision alone (docs/17 §B [57], docs/22 §2): who at
  // Distribution OS may look inside this distributor's books, and for how many hours. Not the
  // manager's (it is not day-to-day running) and not the accountant's (it is not money): the same
  // OWNER_ONLY as the settings and the legal identity. The console's half of the flow is `admin.support.*`,
  // which no tenant role can reach and which cannot open a window by itself.
  'tenancy.support.list': OWNER_ONLY,
  'tenancy.support.approve': OWNER_ONLY,
  'tenancy.support.revoke': OWNER_ONLY,

  // Files. The guard gates the verb — staff mint upload URLs, any member may ask for a read URL — and
  // the handler applies the per-domain table in files.ts (a supplier-invoice page is never readable by
  // the field or the shop; a POD photo by the shop that received it). A shop uploads nothing.
  'files.uploadUrl': STAFF,
  'files.readUrl': ANY_MEMBER,

  // Global catalog: readable by everyone including the shopkeeper's app; only staff may propose.
  'catalog.search': ANY_MEMBER,
  'catalog.manufacturers': ANY_MEMBER,
  'catalog.propose': STAFF,

  // What this distributor sells. Cost endpoints are back office and are the reason the salesperson,
  // delivery and retailer roles never appear on this block. Every WRITE to the overlay is MANAGEMENT:
  // the accountant reads the catalog, the suppliers and the costs, and edits none of them (docs/22
  // 2026-09-05). A rep reads its own brand authorisations; the buy-side pack sizes are the receiving
  // side's (desk + gate) and carry no rate.
  'tenantCatalog.list': ANY_MEMBER,
  'tenantCatalog.upsertListing': MANAGEMENT,
  'tenantCatalog.suppliers': STAFF,
  'tenantCatalog.upsertSupplier': MANAGEMENT,
  'tenantCatalog.costs': BACK_OFFICE,
  'tenantCatalog.upsertCost': MANAGEMENT,
  'tenantCatalog.repAuthorisations.list': STAFF,
  'tenantCatalog.repAuthorisations.set': MANAGEMENT,
  'tenantCatalog.brands.list': STAFF,
  'tenantCatalog.brands.upsert': MANAGEMENT,
  'tenantCatalog.packConfigs.list': BACK_OFFICE_OR_WAREHOUSE,
  'tenantCatalog.packConfigs.upsert': MANAGEMENT,

  // Retailers. The shopkeeper reads its own record (the handler strips code, tier and credit) and edits
  // its own contact details through `updateOwn` — never through `upsert`. Credit terms are set by the
  // owner and the manager alone (docs/22 2026-09-05: no credit limits for the accountant).
  'retailers.list': ANY_MEMBER,
  'retailers.get': ANY_MEMBER,
  'retailers.upsert': STAFF,
  'retailers.updateOwn': SHOPKEEPER_ONLY,
  'retailers.setCredit': MANAGEMENT,
  // Back office only: a rep must not learn whether a phone exists in another distributor's network.
  'retailers.linkIdentity': ONBOARDERS,
  // Beats are the desk's to create and assign (docs/23 §8.14: a rep, a loader or a driver could
  // otherwise create beats and assign anyone); everyone in the field reads them, and a salesperson
  // reads its own assignment to learn today's beat.
  'retailers.beats.list': STAFF,
  'retailers.beats.upsert': ONBOARDERS,
  'retailers.beats.assign': ONBOARDERS,
  'retailers.beats.assignments.list': STAFF,
  'retailers.visits.record': STAFF,
  'retailers.visits.list': STAFF,

  // Offline queue. Served to staff apps only; the retailer app is online-first. A field role reads its
  // own rejections and pulls its own read set (the handler forces the actor; RLS narrows the rows).
  'sync.upload': STAFF,
  'sync.errors.list': STAFF,
  'sync.pull': STAFF,

  // Pricing. Reps read rates, their own bound and ask for bargains; the SHOP reads its deals
  // (`schemes.list` filtered to what applies to it, public shape) and the outcome of its own bargain
  // requests (RLS: own rows). Only the owner and the manager change the economics or decide a bargain —
  // the accountant reads (docs/22 2026-09-05) — and only the owner sets how far a rep may discount.
  'pricing.priceLists.list': STAFF,
  'pricing.priceLists.upsert': MANAGEMENT,
  'pricing.priceLists.setItems': MANAGEMENT,
  'pricing.overrides.list': STAFF,
  'pricing.overrides.upsert': MANAGEMENT,
  'pricing.schemes.list': ANY_MEMBER,
  'pricing.schemes.upsert': MANAGEMENT,
  'pricing.quote': ANY_MEMBER,
  'pricing.bargains.request': ANY_MEMBER,
  'pricing.bargains.decide': MANAGEMENT,
  'pricing.bargains.list': ANY_MEMBER,
  'pricing.bounds.set': OWNER_ONLY,
  'pricing.bounds.list': STAFF,

  // Inventory. `sellable` is the only stock surface a rep or a shop ever sees; per-lot balances and
  // the ledger stay with the people who hold the stock.
  'inventory.locations.list': STAFF,
  'inventory.locations.upsert': BACK_OFFICE_OR_WAREHOUSE,
  'inventory.stock.sellable': ANY_MEMBER,
  'inventory.stock.balances': STOCK_VIEWERS,
  'inventory.stock.adjust': BACK_OFFICE_OR_WAREHOUSE,
  'inventory.stock.transfer': BACK_OFFICE_OR_WAREHOUSE,
  'inventory.stock.ledger': STOCK_VIEWERS,
  'inventory.lots.upsert': BACK_OFFICE_OR_WAREHOUSE,
  // A cycle count is the godown's paperwork: the stock keepers open and count, the desk posts the
  // differences into the ledger (docs/23 §8.18), the accountant and the crew may read it.
  'inventory.cycleCounts.open': ROLE_GROUPS.STOCK_KEEPERS,
  'inventory.cycleCounts.count': ROLE_GROUPS.STOCK_KEEPERS,
  'inventory.cycleCounts.post': BACK_OFFICE,
  'inventory.cycleCounts.list': STOCK_VIEWERS,
  'inventory.cycleCounts.get': STOCK_VIEWERS,

  // Procurement. Supplier invoices carry printed rates and become purchase cost: back office only.
  // GRN shapes carry pieces, not rates, so the warehouse reads them and does the blind gate count.
  'procurement.supplierInvoices.create': BACK_OFFICE,
  'procurement.supplierInvoices.list': BACK_OFFICE,
  'procurement.supplierInvoices.get': BACK_OFFICE,
  'procurement.supplierInvoices.matchLine': BACK_OFFICE,
  'procurement.supplierInvoices.dispute': BACK_OFFICE,
  'procurement.supplierInvoices.cancel': BACK_OFFICE,
  // Opening reads the approved invoice's lines and posting writes tenant_product_costs, whose RLS
  // policy is back office: the desk opens and posts, the gate counts.
  'procurement.grns.open': BACK_OFFICE,
  'procurement.grns.count': ROLE_GROUPS.STOCK_KEEPERS,
  'procurement.grns.post': BACK_OFFICE,
  'procurement.grns.list': BACK_OFFICE_OR_WAREHOUSE,
  'procurement.grns.get': BACK_OFFICE_OR_WAREHOUSE,
  'procurement.discrepancies.list': BACK_OFFICE_OR_WAREHOUSE,
  // A gate-count finding is decided in the owner's approvals queue ("GRN exceptions", docs/23 O3): the
  // owner and the manager, never the accountant (docs/22 2026-09-05: no approvals).
  'procurement.discrepancies.resolve': MANAGEMENT,
  'procurement.purchaseOrders.upsert': BACK_OFFICE,
  'procurement.purchaseOrders.list': BACK_OFFICE,

  // Orders. A shopkeeper may place, SUBMIT (its own draft — docs/22 §4 draws R1 → S5 directly; the
  // approvals a submit raises stay invisible to the shop), read and cancel its own; the owner and the
  // manager confirm (it reserves stock) and decide approvals — an approval is a decision the accountant
  // does not take (docs/22 2026-09-05); the accountant reads the queue.
  'orders.create': ANY_MEMBER,
  'orders.setLines': ANY_MEMBER,
  'orders.repeatLast': ANY_MEMBER,
  'orders.submit': ANY_MEMBER,
  'orders.confirm': MANAGEMENT,
  'orders.cancel': ANY_MEMBER,
  'orders.get': ANY_MEMBER,
  'orders.list': ANY_MEMBER,
  'orders.approvals.list': BACK_OFFICE,
  'orders.approvals.decide': MANAGEMENT,

  // Receivables — the money ledger. Three rules from the founder (docs/17 §D4, docs/22 2026-09-05)
  // shape this block: only the desk and the delivery crew take money, and a shop pays for itself
  // through its own procedure (`payments.initiate`, never a wider `receipts.create`); the salesperson
  // appears in exactly three READ rows (dues, credit check, statement — "never collects" is not "never
  // sees") and in no write; and the accountant is the MONEY_DESK — office receipts, reversals, banking,
  // bounces, allocations, write-offs, statements — which is the whole of its write scope.
  'receivables.receipts.create': MONEY_COLLECTORS,
  'receivables.receipts.list': MONEY_READERS,
  'receivables.receipts.get': MONEY_READERS,
  // The printed / WhatsApp receipt: whoever may read the receipt may print it, the shop included.
  'receivables.receipts.document': MONEY_READERS,
  // Reversal, banking and cheque returns are the money desk's: they move money between accounts.
  'receivables.receipts.reverse': MONEY_DESK,
  'receivables.receipts.deposit': MONEY_DESK,
  'receivables.receipts.bounce': MONEY_DESK,
  // The shop starts an online payment against its own bills; it credits no AR by itself.
  'receivables.payments.initiate': SHOPKEEPER_ONLY,
  'receivables.allocations.create': MONEY_DESK,
  'receivables.allocations.remove': MONEY_DESK,
  // Dues: the rep sees the shop's, the crew the shop's at the door, the shop its own; the tenant-wide
  // register and its history are the desk's alone (the crew needs one shop at a time, docs/23 §5.3).
  'receivables.outstanding.get': DUES_READERS,
  'receivables.outstanding.list': BACK_OFFICE,
  'receivables.creditCheck': CREDIT_CHECKERS,
  'receivables.ledger.get': DUES_READERS,
  'receivables.statements.send': MONEY_DESK,
  // Writing off a debt is a money-desk decision (docs/22 2026-09-05 names it for the accountant);
  // forcing an ageing rebuild is the owner's alone.
  'receivables.writeOffs.create': MONEY_DESK,
  'receivables.ageing.rebuild': OWNER_ONLY,
  'receivables.ageing.history': BACK_OFFICE,
  'receivables.cashDiscounts.list': MONEY_DESK,
  // The books. The 0007 RLS policies are the guarantee: these paths carry purchase and GRN postings.
  'receivables.accounts.list': BACK_OFFICE,
  'receivables.journal.list': BACK_OFFICE,

  // Billing — the tax document. A bill carries no cost, so everyone including the shopkeeper may READ
  // one (RLS narrows a shop to its own); issuing is the desk plus the warehouse that packs it,
  // cancelling a numbered document is the owner and the manager alone, and the registers are the
  // books, so the field and the shop never see them.
  'billing.invoices.queue': BILLING_ISSUERS,
  // `billing.invoices.issue` USED TO BE HERE and was removed with the procedure at coordination §4
  // step 3: `warehouse.packs.confirm` now does the stock-and-state half and calls
  // `BillingService.issueForPack`, so stock leaves once. `issueForPack` below bills a pack that was
  // PARKED with `issueInvoice: false` — the document only, never a piece of stock (billing.ts).
  'billing.invoices.issueForPack': BILLING_ISSUERS,
  // A van sale is billed at the door from the tenant's normal series (docs/17 §D5).
  'billing.invoices.issueVanSale': DOORSTEP,
  'billing.invoices.importBrandDms': BACK_OFFICE,
  'billing.invoices.cancel': PIN_HOLDERS,
  'billing.invoices.get': ANY_MEMBER,
  'billing.invoices.list': ANY_MEMBER,
  'billing.invoices.pdf': ANY_MEMBER,
  // The QR is a way to take money: the desk, the crew and the shop paying its own bill (docs/17 §D4).
  'billing.invoices.upiQr': MONEY_READERS,
  'billing.invoices.setEwayBill': BILLING_ISSUERS,
  'billing.invoices.requestIrn': BACK_OFFICE,
  'billing.creditNotes.create': CREDIT_NOTE_RAISERS,
  'billing.creditNotes.issue': CREDIT_NOTE_RAISERS,
  'billing.creditNotes.cancel': BACK_OFFICE,
  'billing.creditNotes.get': ANY_MEMBER,
  'billing.creditNotes.list': ANY_MEMBER,
  // GSTR-1 and the sales register are filing documents: back office only.
  'billing.registers.gstSummary': BACK_OFFICE,
  'billing.registers.salesRegister': BACK_OFFICE,

  // Warehouse — the godown floor. Three populations, no new tuples (coordination §6):
  //  * ROLE_GROUPS.STOCK_KEEPERS (owner, manager, warehouse) is the brief's WAREHOUSE_DESK: whoever
  //    touches the goods. A rep and a shopkeeper are never here — a shop learns that its order is
  //    being packed or has been dispatched from `orders.get`, never from a warehouse endpoint.
  //  * STOCK_VIEWERS is the brief's FULFILMENT_READERS: the same list plus the accountant and the
  //    crew, who read the load sheet and the challan on the road but write nothing.
  //  * PIN_HOLDERS guards the three steps that ARE the manager's PIN — cancelling a wave, APPROVING a
  //    load sheet, and cancelling a sheet — because holding an owner/manager token is the PIN (§7 q15).
  //    The PIN is given in the MANAGER app (docs/22 2026-09-05): `loadSheets.approve` is PIN_HOLDERS and
  //    `loadSheets.confirm` — the crew's count on the warehouse phone — is STOCK_KEEPERS, refusing an
  //    unapproved sheet in the handler. Nothing is typed on the warehouse phone but the count.
  // `reservations.release` and `challans.recordEwb` are BACK_OFFICE: freeing a hold on a live order
  // and typing a government e-way bill number are desk decisions, not floor work.
  'warehouse.queue.list': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.create': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.list': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.get': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.start': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.pick': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.picklists.cancel': PIN_HOLDERS,
  // The only way a pack invoice is issued (coordination §4 step 3).
  'warehouse.packs.confirm': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.packs.list': STOCK_VIEWERS,
  'warehouse.packs.get': STOCK_VIEWERS,
  'warehouse.loadSheets.create': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.loadSheets.list': STOCK_VIEWERS,
  'warehouse.loadSheets.get': STOCK_VIEWERS,
  // The manager's PIN, from the manager app; the warehouse phone then confirms the approved sheet.
  'warehouse.loadSheets.approve': PIN_HOLDERS,
  'warehouse.loadSheets.confirm': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.loadSheets.cancel': PIN_HOLDERS,
  'warehouse.challans.list': STOCK_VIEWERS,
  'warehouse.challans.get': STOCK_VIEWERS,
  'warehouse.challans.pdf': STOCK_VIEWERS,
  'warehouse.challans.recordEwb': BACK_OFFICE,
  'warehouse.reservations.list': ROLE_GROUPS.STOCK_KEEPERS,
  'warehouse.reservations.release': BACK_OFFICE,

  // Delivery — the last mile (coordination §6, corrected by the founder's answers in docs/17 §D4/§D5).
  // Five populations, one new tuple:
  //  * STOCK_VIEWERS reads the plan: vehicles, trips, the next stop — the desk, the godown, the crew.
  //  * TRIP_PLANNERS (new) plans and loads: create, start loading, depart, add a stop.
  //  * DOORSTEP writes at the door: stops, deliveries, proof, the van sale, the GPS batch, the DPDP
  //    consent, and the check-in (`trips.return`).
  //  * MONEY_COLLECTORS is the field's ONLY money path (docs/17 §D4): `collections.record` wraps
  //    `ReceivablesService.recordReceipt`, so the same four people who may take a receipt take it at
  //    the door — the salesperson is in no row of this block. The same four keep the trip's cash story:
  //    expenses, the collections register and the check-in cockpit. The godown is NOT here (it never
  //    touches money; the `collections` RLS policy excludes it too), so `collections.list` and
  //    `expenses.list` are narrower than coordination's STOCK_VIEWERS on purpose.
  //  * MONEY_DESK settles (`trips.settle`): the day-end handover is a money-desk write; a variance beyond
  //    tolerance is refused in the handler unless the OWNER accepts it (docs/22 2026-09-05: no approvals
  //    for the accountant). PIN_HOLDERS cancel a trip, register a vehicle and read where people ARE —
  //    the live map and the trace are DPDP-audited reads that `trip_points` RLS already limits to the
  //    owner and the manager.
  // The shop reads its own delivery status and nothing else: `stops.list` (ANY_MEMBER; RLS narrows it
  // to its own stops, the mapper drops coordinates and the cash plan) and `deliveries.list/get`
  // (MONEY_READERS; its own POD with a signed URL). Every write refuses the retailer.
  'delivery.vehicles.list': STOCK_VIEWERS,
  'delivery.vehicles.upsert': PIN_HOLDERS,
  'delivery.vehicles.positions': PIN_HOLDERS,
  'delivery.consents.grant': DOORSTEP,
  'delivery.consents.get': DOORSTEP,
  'delivery.trips.create': TRIP_PLANNERS,
  'delivery.trips.list': STOCK_VIEWERS,
  'delivery.trips.get': STOCK_VIEWERS,
  'delivery.trips.startLoading': TRIP_PLANNERS,
  'delivery.trips.depart': TRIP_PLANNERS,
  'delivery.trips.return': DOORSTEP,
  'delivery.trips.cancel': PIN_HOLDERS,
  'delivery.trips.settlementPreview': MONEY_COLLECTORS,
  'delivery.trips.settle': MONEY_DESK,
  'delivery.stops.list': ANY_MEMBER,
  'delivery.stops.next': STOCK_VIEWERS,
  'delivery.stops.add': TRIP_PLANNERS,
  'delivery.stops.reorder': DOORSTEP,
  'delivery.stops.start': DOORSTEP,
  'delivery.stops.arrive': DOORSTEP,
  'delivery.stops.fail': DOORSTEP,
  'delivery.deliveries.record': DOORSTEP,
  'delivery.deliveries.addPod': DOORSTEP,
  'delivery.deliveries.list': MONEY_READERS,
  'delivery.deliveries.get': MONEY_READERS,
  // THE money-collection path of the field (docs/17 §D4). Never the salesperson.
  'delivery.collections.record': MONEY_COLLECTORS,
  'delivery.collections.list': MONEY_COLLECTORS,
  // Billed from the tenant's normal series (docs/17 §D5) by the crew at the door.
  'delivery.vanSales.create': DOORSTEP,
  'delivery.expenses.record': MONEY_COLLECTORS,
  'delivery.expenses.list': MONEY_COLLECTORS,
  // ADR 0012: the batch bypasses the sync queue; the caller must be the trip's crew (handler).
  'delivery.gps.points': DOORSTEP,
  'delivery.gps.trace': PIN_HOLDERS,

  // Docint — inbound document intake (coordination §6; docs/22 §5, never-list 1 and 6). Two
  // populations, no new tuple:
  //  * BACK_OFFICE_OR_WAREHOUSE is the brief's CAP: CAPTURE and STATUS. The gate photographs the
  //    supplier's bill at the door (`create`, `pageUploadUrl`, `addPage`, `verifyQr`, `submit`), reads
  //    what it captured (`list`, `get`, `status`, `pageUrl`). None of these shapes carries a rate, and
  //    `documents` / `document_pages` RLS scopes the field to `pod` / `claim_sheet` / `other` by kind.
  //  * BACK_OFFICE is everything the engine produced and everything a human decides on it: the
  //    extraction (printed purchase rates), the SKU candidates, the review session, the queue, the
  //    stats, `reject` and `approve`. The warehouse reads ZERO rows of those tables (migrations
  //    0016/0017, rls.test.ts "not even the gate staff"), so the matrix agrees with the database.
  //    The accountant reviews and approves inbound bills (brief §5: the CA reviews them; approving a
  //    supplier's bill is bookkeeping — the same three people own `procurement.supplierInvoices.create`).
  //  `approve` books a supplier invoice DRAFT and nothing else — never a GRN, a lot, a ledger row or a
  //  cost; `procurement.grns.post` (BACK_OFFICE, above) is where cost is written, by a human, later.
  //  Letting the gate approve is a founder decision plus a policy migration (docint.ts header), not a
  //  handler flag: nothing here pre-widens for it.
  'docint.documents.create': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.pageUploadUrl': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.addPage': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.verifyQr': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.submit': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.list': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.get': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.status': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.pageUrl': BACK_OFFICE_OR_WAREHOUSE,
  'docint.documents.reject': BACK_OFFICE,
  'docint.documents.approve': BACK_OFFICE,
  'docint.extractions.run': BACK_OFFICE,
  'docint.extractions.list': BACK_OFFICE,
  'docint.extractions.get': BACK_OFFICE,
  'docint.matches.list': BACK_OFFICE,
  'docint.matches.accept': BACK_OFFICE,
  'docint.matches.reject': BACK_OFFICE,
  'docint.matches.choose': BACK_OFFICE,
  'docint.matches.rerun': BACK_OFFICE,
  'docint.review.start': BACK_OFFICE,
  'docint.review.heartbeat': BACK_OFFICE,
  'docint.review.save': BACK_OFFICE,
  'docint.review.release': BACK_OFFICE,
  'docint.review.submit': BACK_OFFICE,
  'docint.queue.list': BACK_OFFICE,
  'docint.stats.summary': BACK_OFFICE,

  // Integrations — the file bridge (coordination §6 says "every integrations.* = BACK_OFFICE"; the founder's
  // 2026-09-05 narrowing of the accountant splits that into three populations, no new tuple):
  //  * BACK_OFFICE reads: every import, its rows, the preview, the profiles, every export job and its
  //    download, the Tally mapping and the sync ledger. The accountant "reads and exports everything".
  //  * MANAGEMENT writes the IMPORTER: a bulk file creates and updates retailers and catalog listings —
  //    the same rows the accountant may not touch one at a time (`retailers.upsert`,
  //    `tenantCatalog.upsertListing`) — and, for `opening_outstanding`, money with no sale behind it,
  //    which the handler narrows further to the OWNER on `commit` and `confirm` (integrations.ts header).
  //    A saved mapping profile is configuration, and the accountant sets no setting.
  //  * MONEY_DESK takes the EXPORTS and keeps the Tally names — ROLE_GROUPS.MONEY_DESK is literally "who
  //    takes the exports", and the Tally mapping is the CA's own tool, not one of the founder's forbidden
  //    settings. `exports.request` never renders inline; `downloadUrl` is a read.
  // No field role and no shop appears anywhere: the six tables are BACK_OFFICE_ROLES in RLS since 0003, and
  // only owner-service and manager-service mount the key.
  'integrations.imports.create': MANAGEMENT,
  'integrations.imports.list': BACK_OFFICE,
  'integrations.imports.get': BACK_OFFICE,
  'integrations.imports.preview': BACK_OFFICE,
  'integrations.imports.setMapping': MANAGEMENT,
  'integrations.imports.dryRun': MANAGEMENT,
  'integrations.imports.rows.list': BACK_OFFICE,
  'integrations.imports.rows.review': MANAGEMENT,
  'integrations.imports.commit': MANAGEMENT,
  'integrations.imports.confirm': MANAGEMENT,
  'integrations.imports.rollback': MANAGEMENT,
  'integrations.imports.cancel': MANAGEMENT,
  'integrations.profiles.list': BACK_OFFICE,
  'integrations.profiles.upsert': MANAGEMENT,
  'integrations.exports.request': MONEY_DESK,
  'integrations.exports.list': BACK_OFFICE,
  'integrations.exports.get': BACK_OFFICE,
  'integrations.exports.downloadUrl': BACK_OFFICE,
  'integrations.tally.mappings.list': BACK_OFFICE,
  'integrations.tally.mappings.upsert': MONEY_DESK,
  'integrations.tally.syncLedger.list': BACK_OFFICE,

  // Claims — money the brand owes us (coordination §6: "every claims.* = BACK_OFFICE, except
  // policies.upsert = OWNER_ONLY and writeOff = owner + accountant"). One population and two exceptions,
  // one new tuple:
  //  * BACK_OFFICE is everything: a claim is an entry in the books — submit accrues a receivable from
  //    the brand, a settlement books its credit note / cheque / bank receipt, a rejection reverses the
  //    accrual — so the accountant (the money desk, docs/22 2026-09-05) opens, builds, reviews, submits,
  //    settles and rejects alongside the owner and the manager. None of it is a price, a scheme, a
  //    credit limit, an approval or a setting. A damage line carries PURCHASE COST (`ratePaise` at PTD)
  //    and a scheme line says which schemes the brand funds, so no field role and no shop appears in any
  //    row; the five tables are BACK_OFFICE_ROLES in RLS and only owner- and manager-service mount the key.
  //  * OWNER_ONLY sets a brand's policy: what is claimable, at what value, how often — a SETTING about
  //    what money the business believes it can recover.
  //  * LOSS_ACCEPTORS (owner, accountant) write off the unrecovered remainder: accepting a loss is not
  //    the manager's call.
  'claims.policies.list': BACK_OFFICE,
  'claims.policies.upsert': OWNER_ONLY,
  'claims.periods.list': BACK_OFFICE,
  'claims.ageing': BACK_OFFICE,
  'claims.register': BACK_OFFICE,
  'claims.reconcile.suggest': BACK_OFFICE,
  'claims.open': BACK_OFFICE,
  'claims.list': BACK_OFFICE,
  'claims.get': BACK_OFFICE,
  'claims.build': BACK_OFFICE,
  'claims.lines.list': BACK_OFFICE,
  'claims.lines.add': BACK_OFFICE,
  'claims.lines.adjust': BACK_OFFICE,
  'claims.lines.remove': BACK_OFFICE,
  'claims.evidence.attach': BACK_OFFICE,
  'claims.submit': BACK_OFFICE,
  'claims.acknowledge': BACK_OFFICE,
  'claims.settlements.record': BACK_OFFICE,
  'claims.reject': BACK_OFFICE,
  'claims.writeOff': LOSS_ACCEPTORS,
  'claims.cancel': BACK_OFFICE,
  'claims.statements.generate': BACK_OFFICE,
  'claims.statements.list': BACK_OFFICE,

  // Notifications — every message the platform sends under the DISTRIBUTOR'S name (coordination §6,
  // narrowed by the founder's 2026-09-05 accountant scope). Five populations, two new tuples:
  //  * ANY_MEMBER reads the log / its inbox and marks its own notice read: `messages.list/get/markRead`.
  //    RLS (`messages_read`) scopes the shop to rows addressed to its own shop; the handler scopes the
  //    rep to the shops on its own beats plus its own in-app notices; `costPaise` / `providerMessageId`
  //    / `error` are omitted for every role but the back office (brief §4.7 — messaging spend is a
  //    back-office figure like purchase cost).
  //  * BACK_OFFICE reads templates and broadcast history and resends a failed row: the accountant "reads
  //    and exports everything" and a resend changes no wording, no audience and no rupee.
  //  * MANAGEMENT writes the wording and picks the audience: `templates.upsert` is what every shop of
  //    the distributorship is TOLD and `broadcasts.create` is a send to a whole beat — decisions about
  //    the business the accountant does not take (docs/22 2026-09-05: no settings). Coordination §6
  //    names PIN_HOLDERS for these two; the same two people, and MANAGEMENT is the tuple this file
  //    later introduced for exactly "the writes the accountant lost" — a template is not the PIN.
  //  * SHOP_MESSENGERS (new) sends a bill / receipt / statement to one shop on demand: the desk and
  //    the crew at the door, never the rep (docs/17 §D4 in spirit: the rep's shop contact is the desk's
  //    to see, not the rep's to push).
  //  * TRIAGE (new) reads and closes what shops texted us: the desk plus the beat-owning rep.
  //  * STAFF registers its own device's push token (`userId` is always the caller); the retailer app is
  //    WhatsApp / in-app first and registers no token (brief §8.7 — a one-line widening later).
  // Only owner- and manager-service serve the whole key; sales mounts it for the rep's reads, warehouse
  // and delivery for their inbox and push token, retailer for its inbox (notifications.ts header).
  'notifications.messages.list': ANY_MEMBER,
  'notifications.messages.get': ANY_MEMBER,
  'notifications.messages.send': SHOP_MESSENGERS,
  'notifications.messages.resend': BACK_OFFICE,
  'notifications.messages.markRead': ANY_MEMBER,
  'notifications.templates.list': BACK_OFFICE,
  'notifications.templates.upsert': MANAGEMENT,
  'notifications.broadcasts.create': MANAGEMENT,
  'notifications.broadcasts.list': BACK_OFFICE,
  'notifications.broadcasts.get': BACK_OFFICE,
  'notifications.pushTokens.register': STAFF,
  'notifications.pushTokens.unregister': STAFF,
  'notifications.inbound.list': TRIAGE,
  'notifications.inbound.markHandled': TRIAGE,

  // Reporting — the tiles, the owner's GRAPHS and the registers (coordination §6; the founder's graphs
  // decision docs/22 §8 2026-09-04; the accountant's scope 2026-09-05). Five populations, two new tuples:
  //  * BACK_OFFICE reads the distributorship: the owner's home, every tenant-level series (sales,
  //    collections, outstanding, ageing, growth, the mixes, the rankings, stock at cost, scheme spend),
  //    the daily sales register, scheme spend, stock value, collections, both GST registers and the
  //    export's status. The accountant "reads and exports everything" (docs/22): the registers and the
  //    money series are its home screen (M12). `dashboard.owner`, `registers.stockValue` and
  //    `series.stock` carry PURCHASE COST and margin — BACK_OFFICE is exactly the never-list's boundary
  //    (docs/22 §9 item 1), and `daily_owner_stats` / `owner_summary` RLS agree.
  //  * OWNER_ONLY reads the margin SERIES (`series.grossMargin`): O17 is an owner-only route (docs/23
  //    §1.2 "grossMargin must exist only on owner-service"), so the manager sees MTD margin on the home
  //    tile and never the trend by brand.
  //  * REP_PERFORMANCE_READERS (new): the desk plus the rep for the rep's own numbers — its day, its
  //    per-day rows, its productivity register and series, and the shop-card reads (`behaviour`,
  //    `lapsed`, the shop's own series) scoped by the handler to the shops on its own beats.
  //  * BACK_OFFICE_OR_WAREHOUSE reads the fill rate (register and series): picking accuracy is the
  //    godown's job (docs/23 §4.2 W1); nothing else in the block reaches the warehouse role.
  //  * CREW_PERFORMANCE_READERS (new): the desk plus the crew for the trips it drove — the delivery
  //    performance register and series, `driverId` forced to the caller.
  //  * MONEY_DESK queues an export: `exports.request` is the same power as `integrations.exports.request`
  //    ("who takes the exports"); the row it makes is audited and rendered off the request path.
  // The retailer appears in NO row: reporting is not mounted on retailer-service at all (reporting.ts
  // header), and the 0027 policies give a shop's session zero rows of every rollup table.
  'reporting.dashboard.owner': BACK_OFFICE,
  'reporting.dashboard.rep': REP_PERFORMANCE_READERS,
  'reporting.series.get': BACK_OFFICE,
  'reporting.series.sales': BACK_OFFICE,
  'reporting.series.collections': BACK_OFFICE,
  'reporting.series.outstanding': BACK_OFFICE,
  'reporting.series.ageing': BACK_OFFICE,
  'reporting.series.growth': BACK_OFFICE,
  'reporting.series.brandMix': BACK_OFFICE,
  'reporting.series.categoryMix': BACK_OFFICE,
  'reporting.series.topShops': BACK_OFFICE,
  'reporting.series.topBeats': BACK_OFFICE,
  'reporting.series.productivity': REP_PERFORMANCE_READERS,
  'reporting.series.fillRate': BACK_OFFICE_OR_WAREHOUSE,
  'reporting.series.deliveryPerformance': CREW_PERFORMANCE_READERS,
  'reporting.series.stock': BACK_OFFICE,
  'reporting.series.grossMargin': OWNER_ONLY,
  'reporting.series.schemeSpend': BACK_OFFICE,
  'reporting.dailyStats.tenant': BACK_OFFICE,
  'reporting.dailyStats.rep': REP_PERFORMANCE_READERS,
  'reporting.retailers.behaviour': REP_PERFORMANCE_READERS,
  'reporting.retailers.series': REP_PERFORMANCE_READERS,
  'reporting.retailers.lapsed': REP_PERFORMANCE_READERS,
  'reporting.registers.repProductivity': REP_PERFORMANCE_READERS,
  'reporting.registers.schemeSpend': BACK_OFFICE,
  'reporting.registers.stockValue': BACK_OFFICE,
  'reporting.registers.fillRate': BACK_OFFICE_OR_WAREHOUSE,
  'reporting.registers.deliveryPerformance': CREW_PERFORMANCE_READERS,
  'reporting.registers.collections': BACK_OFFICE,
  'reporting.registers.gstSalesRegister': BACK_OFFICE,
  'reporting.registers.gstPurchaseRegister': BACK_OFFICE,
  'reporting.exports.request': MONEY_DESK,
  'reporting.exports.get': BACK_OFFICE,

  // Incentives — staff targets, live achievement and the COMPUTED (never paid) payout statement
  // (coordination §6; the founder's answers to §7 q19, q20 and q32). Four populations, one new tuple:
  //  * OWNER_ONLY assigns and signs off: `targets.upsert/bulkAssign/remove` and
  //    `statements.approve/reopen`. Money promised to staff is the owner's decision (coordination §7
  //    q20) — `targets_write` RLS is already owner + system, and `computed_payouts`' write policy would
  //    let the whole desk through, so the matrix is what narrows approval to the owner, exactly the way
  //    `billing.invoices.cancel` narrows beyond RLS.
  //  * BACK_OFFICE runs the numbers without changing them: `statements.compute` (an arithmetic pass over
  //    the cached achievement), `targets.refresh` (which ENQUEUES a worker job and writes nothing —
  //    `achievements` is `system`-only), `targets.whatIf` (pure, no side effect) and `progress.team`.
  //    The manager and the accountant see the whole team and may compute a period; neither may create a
  //    target or approve a payout.
  //  * INCENTIVE_READERS (new) reads a target and a statement: the desk plus the rep or crew member whose
  //    row it is, narrowed by RLS to their own. A rep sees a COMPUTED-but-unapproved statement with
  //    `approvedBy: null` (coordination §7 q19) — a live figure on the Performance tab, not a payslip.
  //  * ROLE_GROUPS.FIELD reads its own progress: `progress.mine` has no `userId` input to get wrong.
  // The warehouse role and the shopkeeper appear in NO row — this is internal staff performance data and
  // the module's scope is salesperson and delivery (brief §1); incentives is not mounted on warehouse- or
  // retailer-service at all. Nothing in this block carries a purchase cost, a margin or a GST field: a
  // target's `targetValue` and a statement's `amountPaise` are the distributor's own promise to its staff.
  'incentives.targets.upsert': OWNER_ONLY,
  'incentives.targets.bulkAssign': OWNER_ONLY,
  'incentives.targets.whatIf': BACK_OFFICE,
  'incentives.targets.get': INCENTIVE_READERS,
  'incentives.targets.list': INCENTIVE_READERS,
  'incentives.targets.remove': OWNER_ONLY,
  'incentives.targets.refresh': BACK_OFFICE,
  'incentives.progress.mine': ROLE_GROUPS.FIELD,
  'incentives.progress.team': BACK_OFFICE,
  'incentives.statements.compute': BACK_OFFICE,
  'incentives.statements.approve': OWNER_ONLY,
  'incentives.statements.reopen': OWNER_ONLY,
  'incentives.statements.get': INCENTIVE_READERS,
  'incentives.statements.list': INCENTIVE_READERS,

  // AI — assistive only, always human-confirmed (docs/22 §8, 2026-09-05; ai.ts header). Nothing on this
  // block decides anything: a parse writes a DRAFT, a forecast writes a SUGGESTION, a plan writes a
  // SEQUENCE, and each becomes real only when a human calls `drafts.confirm`, places a purchase order or
  // calls `routing.apply`. Three populations:
  //  * DRAFT_ORDER_TAKERS (new) read a message or a voice note into a draft and confirm it: the owner,
  //    the manager, the rep for its own shops and the shop for itself. `drafts.confirm` runs
  //    `orders.create → setLines → submit`, all ANY_MEMBER, so this tuple is a NARROWING of the ordering
  //    surface and never a widening. The accountant, the godown and the crew take no orders.
  //  * The buying desk forecasts: `forecast.run` is BACK_OFFICE (it enqueues a worker pass over the
  //    tenant's history), `forecast.list` is BACK_OFFICE_OR_WAREHOUSE — the godown reads what is about to
  //    run out where it stands. The suggestion carries pieces, days of cover and a supplier and NO
  //    purchase rate or stock value (ai.ts, docs/22 §9 non-negotiable 1), which is what makes the
  //    warehouse read safe; a rep and a shop are refused outright.
  //  * ROUTE_OPTIMISERS (new) compute and apply a route; TRIP_PLANNERS also READ one, adding the godown.
  //    `routing.apply` writes through `delivery.stops.reorder`, whose own permission is DOORSTEP, so the
  //    tuple cannot let anyone move a stop who could not already move it by hand.
  'ai.intake.parseText': DRAFT_ORDER_TAKERS,
  'ai.intake.transcribe': DRAFT_ORDER_TAKERS,
  'ai.drafts.list': DRAFT_ORDER_TAKERS,
  'ai.drafts.get': DRAFT_ORDER_TAKERS,
  'ai.drafts.confirm': DRAFT_ORDER_TAKERS,
  'ai.drafts.reject': DRAFT_ORDER_TAKERS,
  'ai.forecast.run': BACK_OFFICE,
  'ai.forecast.list': BACK_OFFICE_OR_WAREHOUSE,
  'ai.routing.plan': ROUTE_OPTIMISERS,
  'ai.routing.get': TRIP_PLANNERS,
  'ai.routing.apply': ROUTE_OPTIMISERS,

  // Admin — the platform console of Distribution OS itself (module 13; docs/22 §2 row 7 and the
  // founder's decision of 2026-09-05). ONE population, and it is the only block in this file whose
  // roles are not memberships: `ROLE_GROUPS.PLATFORM` is `['platform_admin']`, a role no distributor
  // ever holds. That single fact carries both halves of the guarantee, and neither is a convention
  // somebody has to remember:
  //  * No tenant role can reach any row here — `platform_admin` is not a member of `MembershipRole`,
  //    so no membership role is in any of these lists, and admin-service :3007 serves `platform_admin`
  //    alone, refusing every other role at the service gate before a handler runs.
  //  * `platform_admin` can reach nothing under a tenant service — it appears in no other row of this
  //    table (`auth.platformMe` is the auth service, not a tenant one), and the six tenant services do
  //    not serve the role, so a platform token is refused twice over.
  // Looking INSIDE a distributor is not on this block at all: `support.request` only ASKS, the
  // distributor's OWNER decides through `tenancy.support.approve` (OWNER_ONLY, above), the window is
  // time-boxed and every step is audited (docs/17 §B [57]). `metrics.overview` answers counts and
  // bytes — never a rupee of a distributor's trade, never a cost, never a margin (docs/22 §9 item 1).
  'admin.tenants.create': PLATFORM,
  'admin.tenants.list': PLATFORM,
  'admin.tenants.get': PLATFORM,
  'admin.tenants.suspend': PLATFORM,
  'admin.tenants.reactivate': PLATFORM,
  'admin.subscriptions.upsert': PLATFORM,
  'admin.subscriptions.list': PLATFORM,
  'admin.subscriptions.get': PLATFORM,
  'admin.support.request': PLATFORM,
  'admin.support.list': PLATFORM,
  'admin.support.revoke': PLATFORM,
  'admin.users.list': PLATFORM,
  'admin.users.disable': PLATFORM,
  'admin.metrics.overview': PLATFORM,
  'admin.audit.list': PLATFORM,
}

/**
 * The declared permission, or undefined when the path is not in the table. The guard MUST treat
 * undefined as a refusal: a procedure nobody declared is a procedure nobody may call.
 */
export function permissionFor(path: string): Permission | undefined {
  return (PERMISSIONS as Record<string, Permission | undefined>)[path]
}

/**
 * `role` is the role from a verified access token — a membership role for the six apps, or
 * `platform_admin` for a console session — or null when there is no valid token. An undeclared
 * permission (undefined) is always a refusal.
 */
export function isAllowed(
  permission: Permission | undefined,
  role: PermissionRole | null,
): boolean {
  if (permission === undefined) return false
  if (permission === 'public') return true
  if (role === null) return false
  if (permission === 'authenticated') return true
  return permission.includes(role)
}

export interface ProcedureSummary {
  /** Dotted contract path, e.g. 'orders.approvals.decide'. */
  path: string
  method: string
  /** The HTTP route, e.g. '/approvals/{id}/decide'. */
  httpPath: string
  summary: string
  permission: Permission | undefined
}

type RouteMeta = { route?: { method?: string; path?: string; summary?: string } }

/**
 * Flattens a contract router (or any subset of it, such as one service's keys) into a list in
 * declaration order, each row carrying the permission that guards it.
 */
export function listProcedures(router: unknown, prefix = ''): ProcedureSummary[] {
  const out: ProcedureSummary[] = []
  if (!router || typeof router !== 'object') return out
  for (const [name, value] of Object.entries(router as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${name}` : name
    const meta = (value as { '~orpc'?: RouteMeta })?.['~orpc']
    if (meta?.route) {
      out.push({
        path,
        method: meta.route.method ?? 'POST',
        httpPath: meta.route.path ?? `/${path.replace(/\./g, '/')}`,
        summary: meta.route.summary ?? '',
        permission: permissionFor(path),
      })
    } else if (value && typeof value === 'object') {
      out.push(...listProcedures(value, path))
    }
  }
  return out
}

/** Every procedure of the whole contract, with its route and permission. */
export function allProcedures(): ProcedureSummary[] {
  return listProcedures(contract)
}
