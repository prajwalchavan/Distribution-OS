import type { MembershipRole } from './common.js'
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

export const ROLE_GROUPS = {
  /** Everyone with an active membership, the shopkeeper included. */
  ANY_MEMBER: ALL_ROLES,
  /** Everyone who works for the distributor. Never the shopkeeper. */
  STAFF: ['owner', 'manager', 'accountant', 'salesperson', 'warehouse', 'delivery'],
  /** The desk: the only roles that may see purchase cost, credit terms and the books. */
  BACK_OFFICE: ['owner', 'manager', 'accountant'],
  OWNER_ONLY: ['owner'],
  /** Who physically keeps stock and may count it. */
  STOCK_KEEPERS: ['owner', 'manager', 'warehouse'],
  /** Out on the beat: sees shops and orders, never cost. */
  FIELD: ['salesperson', 'delivery'],
} as const satisfies Record<string, readonly MembershipRole[]>

export type RoleGroup = keyof typeof ROLE_GROUPS

/**
 * 'public' = no token at all (sign-in, the JWKS document, liveness).
 * 'authenticated' = a valid access token, whatever the membership role is.
 * A role list = a valid access token whose membership role is in the list.
 */
export type Permission = readonly MembershipRole[] | 'public' | 'authenticated'

/** Back office plus the warehouse role, which does the physical receiving and stock work. */
const BACK_OFFICE_OR_WAREHOUSE = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
] as const satisfies readonly MembershipRole[]

/** Per-lot balances and the ledger: everyone who holds stock somewhere (a van counts). Never a rep or a shop. */
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

/** Who acts at the shop's door: the crew, with the desk able to do the same thing from the office. */
const DOORSTEP = ['owner', 'manager', 'delivery'] as const satisfies readonly MembershipRole[]

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

const { ANY_MEMBER, STAFF, BACK_OFFICE, OWNER_ONLY } = ROLE_GROUPS

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

  // Tenancy. Staff administration is the owner's desk; the accountant may look but not hire.
  'tenancy.me': ANY_MEMBER,
  'tenancy.staff.list': BACK_OFFICE,
  'tenancy.staff.create': ONBOARDERS,
  'tenancy.staff.setPassword': ONBOARDERS,
  'tenancy.staff.setStatus': ONBOARDERS,

  // Global catalog: readable by everyone including the shopkeeper's app; only staff may propose.
  'catalog.search': ANY_MEMBER,
  'catalog.manufacturers': ANY_MEMBER,
  'catalog.propose': STAFF,

  // What this distributor sells. Cost endpoints are back office and are the reason the salesperson,
  // delivery and retailer roles never appear on this block.
  'tenantCatalog.list': ANY_MEMBER,
  'tenantCatalog.upsertListing': BACK_OFFICE,
  'tenantCatalog.suppliers': STAFF,
  'tenantCatalog.upsertSupplier': BACK_OFFICE,
  'tenantCatalog.costs': BACK_OFFICE,
  'tenantCatalog.upsertCost': BACK_OFFICE,

  // Retailers. The shopkeeper reads its own record (the handler strips code, tier and credit).
  'retailers.list': ANY_MEMBER,
  'retailers.get': ANY_MEMBER,
  'retailers.upsert': STAFF,
  'retailers.setCredit': BACK_OFFICE,
  // Back office only: a rep must not learn whether a phone exists in another distributor's network.
  'retailers.linkIdentity': ONBOARDERS,
  'retailers.beats.list': STAFF,
  'retailers.beats.upsert': STAFF,
  'retailers.beats.assign': STAFF,
  'retailers.visits.record': STAFF,
  'retailers.visits.list': STAFF,

  // Offline queue. Served to staff apps only; the retailer app is online-first.
  'sync.upload': STAFF,

  // Pricing. Reps read rates and ask for bargains; only the desk changes the economics, and only the
  // owner sets how far a rep may discount on their own.
  'pricing.priceLists.list': STAFF,
  'pricing.priceLists.upsert': BACK_OFFICE,
  'pricing.priceLists.setItems': BACK_OFFICE,
  'pricing.overrides.list': STAFF,
  'pricing.overrides.upsert': BACK_OFFICE,
  'pricing.schemes.list': STAFF,
  'pricing.schemes.upsert': BACK_OFFICE,
  'pricing.quote': ANY_MEMBER,
  'pricing.bargains.request': ANY_MEMBER,
  'pricing.bargains.decide': BACK_OFFICE,
  'pricing.bargains.list': STAFF,
  'pricing.bounds.set': OWNER_ONLY,

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

  // Procurement. Supplier invoices carry printed rates and become purchase cost: back office only.
  // GRN shapes carry pieces, not rates, so the warehouse reads them and does the blind gate count.
  'procurement.supplierInvoices.create': BACK_OFFICE,
  'procurement.supplierInvoices.list': BACK_OFFICE,
  'procurement.supplierInvoices.get': BACK_OFFICE,
  'procurement.supplierInvoices.matchLine': BACK_OFFICE,
  // Opening reads the approved invoice's lines and posting writes tenant_product_costs, whose RLS
  // policy is back office: the desk opens and posts, the gate counts.
  'procurement.grns.open': BACK_OFFICE,
  'procurement.grns.count': ROLE_GROUPS.STOCK_KEEPERS,
  'procurement.grns.post': BACK_OFFICE,
  'procurement.grns.list': BACK_OFFICE_OR_WAREHOUSE,
  'procurement.grns.get': BACK_OFFICE_OR_WAREHOUSE,
  'procurement.discrepancies.list': BACK_OFFICE_OR_WAREHOUSE,
  'procurement.purchaseOrders.upsert': BACK_OFFICE,
  'procurement.purchaseOrders.list': BACK_OFFICE,

  // Orders. A shopkeeper may place, read and cancel its own; only staff submit, only the desk
  // confirms (it reserves stock) and decides approvals.
  'orders.create': ANY_MEMBER,
  'orders.setLines': ANY_MEMBER,
  'orders.repeatLast': ANY_MEMBER,
  'orders.submit': STAFF,
  'orders.confirm': BACK_OFFICE,
  'orders.cancel': ANY_MEMBER,
  'orders.get': ANY_MEMBER,
  'orders.list': ANY_MEMBER,
  'orders.approvals.list': BACK_OFFICE,
  'orders.approvals.decide': BACK_OFFICE,

  // Receivables — the money ledger. Two rules from the founder (docs/17 §D4) shape this block:
  // only the desk and the delivery crew take money, and a shop pays for itself through its own
  // procedure. There is therefore NO salesperson anywhere below, and `payments.initiate` is the
  // retailer's path rather than a wider `receipts.create`.
  'receivables.receipts.create': MONEY_COLLECTORS,
  'receivables.receipts.list': MONEY_READERS,
  'receivables.receipts.get': MONEY_READERS,
  // Reversal, banking and cheque returns are desk work: they move money between accounts.
  'receivables.receipts.reverse': BACK_OFFICE,
  'receivables.receipts.deposit': BACK_OFFICE,
  'receivables.receipts.bounce': BACK_OFFICE,
  // The shop starts an online payment against its own bills; it credits no AR by itself.
  'receivables.payments.initiate': SHOPKEEPER_ONLY,
  'receivables.allocations.create': BACK_OFFICE,
  'receivables.allocations.remove': BACK_OFFICE,
  // Dues: a shop reads its own, the tenant-wide register is staff-only.
  'receivables.outstanding.get': MONEY_READERS,
  'receivables.outstanding.list': MONEY_COLLECTORS,
  'receivables.creditCheck': MONEY_COLLECTORS,
  'receivables.ledger.get': MONEY_READERS,
  'receivables.statements.send': BACK_OFFICE,
  // Writing off a debt is the owner's decision alone; so is forcing an ageing rebuild.
  'receivables.writeOffs.create': OWNER_ONLY,
  'receivables.ageing.rebuild': OWNER_ONLY,
  'receivables.cashDiscounts.list': BACK_OFFICE,
  // The books. The 0007 RLS policies are the guarantee: these paths carry purchase and GRN postings.
  'receivables.accounts.list': BACK_OFFICE,
  'receivables.journal.list': BACK_OFFICE,

  // Billing — the tax document. A bill carries no cost, so everyone including the shopkeeper may READ
  // one (RLS narrows a shop to its own); issuing is the desk plus the warehouse that packs it,
  // cancelling a numbered document is the owner and the manager alone, and the registers are the
  // books, so the field and the shop never see them.
  'billing.invoices.queue': BILLING_ISSUERS,
  // TEMPORARY with the procedure itself: deleted when `warehouse.packs.confirm` takes over issuing
  // (docs/plans/00-coordination.md §4 step 3).
  'billing.invoices.issue': BILLING_ISSUERS,
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
}

/**
 * The declared permission, or undefined when the path is not in the table. The guard MUST treat
 * undefined as a refusal: a procedure nobody declared is a procedure nobody may call.
 */
export function permissionFor(path: string): Permission | undefined {
  return (PERMISSIONS as Record<string, Permission | undefined>)[path]
}

/**
 * `role` is the membership role from a verified access token, or null when there is no valid token.
 * An undeclared permission (undefined) is always a refusal.
 */
export function isAllowed(
  permission: Permission | undefined,
  role: MembershipRole | null,
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
