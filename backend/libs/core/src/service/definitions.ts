import { AuthModule } from '../modules/auth/index.js'
import { AiModule } from '../modules/ai/index.js'
import { BillingModule } from '../modules/billing/index.js'
import { CatalogModule } from '../modules/catalog/index.js'
import { ClaimsModule } from '../modules/claims/index.js'
import { DeliveryModule } from '../modules/delivery/index.js'
import { DocintModule } from '../modules/docint/index.js'
import { FilesModule } from '../modules/files/index.js'
import { IncentivesModule } from '../modules/incentives/index.js'
import { IntegrationsModule } from '../modules/integrations/index.js'
import { InventoryModule } from '../modules/inventory/index.js'
import { NotificationsModule } from '../modules/notifications/index.js'
import { OrdersModule } from '../modules/orders/index.js'
import { PlatformAdminModule } from '../modules/platform-admin/index.js'
import { PricingModule } from '../modules/pricing/index.js'
import { ProcurementModule } from '../modules/procurement/index.js'
import { ReceivablesModule } from '../modules/receivables/index.js'
import { ReportingModule } from '../modules/reporting/index.js'
import { RetailersModule } from '../modules/retailers/index.js'
import { SyncModule } from '../modules/sync/index.js'
import { TenancyModule } from '../modules/tenancy/index.js'
import { TenantCatalogModule } from '../modules/tenant-catalog/index.js'
import { WarehouseModule } from '../modules/warehouse/index.js'
import { defineService, type ServiceDefinition } from './define.js'

/**
 * WHAT EACH SERVICE IS MADE OF — the eight compositions, in one file.
 *
 * Every `backend/<name>-service/src/service.ts` is a one-line re-export of the definition below, and
 * `runAll()` (all-in-one.ts) mounts the very same objects behind path prefixes. That is the whole
 * reason they live in the library rather than in the eight packages: the founder's deployment
 * decision (2026-09-05, docs/26 §7) is that a small installation runs ONE process carrying all eight
 * and a large one runs eight processes, and the two must not be able to drift into serving different
 * modules or different roles. A service package is still an independent, separately runnable process
 * (docs/19) — it owns its port, its README, its spec and its `main.ts`; only the list of parts is
 * shared, and it is shared by construction instead of by copy.
 */

/**
 * Sign-in for every app (:3000): username + password → EdDSA access token + rotating refresh token,
 * refresh, logout, switch distributor, sessions, change password, and the public keys every other
 * service verifies tokens with. It serves all seven membership roles because everyone signs in here.
 */
export const authServiceDefinition = defineService({
  name: 'auth',
  title: 'Auth service',
  defaultPort: 3000,
  roles: ['owner', 'manager', 'accountant', 'salesperson', 'warehouse', 'delivery', 'retailer'],
  modules: [AuthModule],
  contractKeys: ['health', 'auth'],
})

/** Everything the distributor owner does at the desk or on the phone: masters, costs, prices, staff, approvals, registers, settings. */
export const ownerServiceDefinition = defineService({
  name: 'owner',
  title: 'Owner service',
  defaultPort: 3001,
  roles: ['owner'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
    InventoryModule,
    ProcurementModule,
    OrdersModule,
    ReceivablesModule,
    BillingModule,
    WarehouseModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    DocintModule,
    IntegrationsModule,
    ClaimsModule,
    NotificationsModule,
    ReportingModule,
    IncentivesModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'pricing',
    'inventory',
    'procurement',
    'orders',
    'receivables',
    'billing',
    'warehouse',
    'sync',
    'files',
    'delivery',
    'docint',
    'integrations',
    'claims',
    'notifications',
    'reporting',
    'incentives',
    'ai',
  ],
})

/** The back office shared by the manager and the accountant: approvals, orders, stock and GRNs, billing desk, receipts, registers, exports. */
export const managerServiceDefinition = defineService({
  name: 'manager',
  title: 'Manager service',
  defaultPort: 3002,
  roles: ['manager', 'accountant'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
    InventoryModule,
    ProcurementModule,
    OrdersModule,
    ReceivablesModule,
    BillingModule,
    WarehouseModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    DocintModule,
    IntegrationsModule,
    ClaimsModule,
    NotificationsModule,
    ReportingModule,
    IncentivesModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'pricing',
    'inventory',
    'procurement',
    'orders',
    'receivables',
    'billing',
    'warehouse',
    'sync',
    'files',
    'delivery',
    'docint',
    'integrations',
    'claims',
    'notifications',
    'reporting',
    'incentives',
    'ai',
  ],
})

/**
 * The salesperson app: beats, shops, catalog with sellable stock, quotes, orders, bargains, offline sync.
 * Purchase cost is never served here.
 *
 * `ReceivablesModule` and `BillingModule` are mounted for READS ONLY (docs/23 §8.1, §8.2): the rep sees
 * a shop's dues, statement and credit check and the bills of the shops it serves. Every write in those
 * two contracts refuses the salesperson in PERMISSIONS — "never collects" (docs/17 §D4) — so mounting
 * the keys exposes no way to record a rupee. `files` is not here: a rep uploads nothing.
 */
export const salesServiceDefinition = defineService({
  name: 'sales',
  title: 'Sales service',
  defaultPort: 3003,
  roles: ['salesperson'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
    InventoryModule,
    OrdersModule,
    ReceivablesModule,
    BillingModule,
    SyncModule,
    NotificationsModule,
    ReportingModule,
    IncentivesModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'pricing',
    'inventory',
    'orders',
    'receivables',
    'billing',
    'sync',
    'notifications',
    'reporting',
    'incentives',
    'ai',
  ],
})

/**
 * The warehouse app: GRN gate counts, stock, the order queue, picking, packing and load-out.
 *
 * `BillingModule` is mounted because `warehouse.packs.confirm` issues the invoice in the same
 * transaction as the pack (coordination §4 step 3) and the `billing` contract key lets the packer read
 * the bill it just produced. `receivables` is deliberately NOT here: the warehouse role never touches
 * money (coordination §6), and the module is pulled in only as billing's own dependency.
 */
export const warehouseServiceDefinition = defineService({
  name: 'warehouse',
  title: 'Warehouse service',
  defaultPort: 3004,
  roles: ['warehouse'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    InventoryModule,
    ProcurementModule,
    OrdersModule,
    BillingModule,
    WarehouseModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    DocintModule,
    NotificationsModule,
    ReportingModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'inventory',
    'procurement',
    'orders',
    'billing',
    'warehouse',
    'sync',
    'files',
    'delivery',
    'docint',
    'notifications',
    'reporting',
    'ai',
  ],
})

/** The delivery crew app: trips, stops, proof of delivery, collections, van sales from vehicle stock, GPS breadcrumbs, the check-in cockpit. */
export const deliveryServiceDefinition = defineService({
  name: 'delivery',
  title: 'Delivery service',
  defaultPort: 3005,
  roles: ['delivery'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
    InventoryModule,
    OrdersModule,
    ReceivablesModule,
    BillingModule,
    WarehouseModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    NotificationsModule,
    ReportingModule,
    IncentivesModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'pricing',
    'inventory',
    'orders',
    'receivables',
    'billing',
    'warehouse',
    'sync',
    'files',
    'delivery',
    'notifications',
    'reporting',
    'incentives',
    'ai',
  ],
})

/**
 * The shopkeeper app: one card per linked distributor, catalog with availability, own orders, bills and
 * dues. Row-level security limits every read to the shop itself.
 *
 * `SyncModule` is mounted for the READ half of the offline protocol alone (docs/07 §0, founder
 * 2026-09-05): `sync.manifest` and `sync.pull` are ANY_MEMBER, so the shop keeps its own bills, orders
 * and dues in SQLite and opens them in a dead spot, while `sync.upload` and `sync.errors.list` stay
 * STAFF in `permissions.ts` — a shop places an order online through `orders.*` and carries no write
 * queue. What it may pull is a closed list of eighteen tables (`sync-tables.ts` gives the `retailer`
 * role exactly those), narrowed underneath by RLS to its own rows. Same read-only mount as
 * `receivables` and `billing` on sales-service.
 */
export const retailerServiceDefinition = defineService({
  name: 'retailer',
  title: 'Retailer service',
  defaultPort: 3006,
  roles: ['retailer'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
    InventoryModule,
    OrdersModule,
    ReceivablesModule,
    BillingModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    NotificationsModule,
    AiModule,
  ],
  contractKeys: [
    'health',
    'tenancy',
    'catalog',
    'tenantCatalog',
    'retailers',
    'pricing',
    'inventory',
    'orders',
    'receivables',
    'billing',
    'sync',
    'files',
    'delivery',
    'notifications',
    'ai',
  ],
})

/**
 * MODULE 13 — the platform console of Distribution OS itself (founder decision 2026-09-05, docs/22 §2
 * row 7 and §8): "a seventh app + service for organisation onboarding, plans and subscription state,
 * support-access grants — time-boxed, owner-approved, audited".
 *
 * It is the ONLY service whose `roles` list names `platform_admin`, and `platform_admin` is the only
 * role it serves. Both halves of that matter, and `TenantGuard` enforces them symmetrically:
 *   - a `platform_admin` token is refused, at the gate and before any handler, on all six tenant
 *     services (403 "<name>-service does not serve the platform_admin role"), unless it carries an
 *     owner-approved support pass;
 *   - every membership role — a distributor's own owner included — is refused here for the mirror
 *     reason, and `permissions.ts` names none of them on any `admin.*` row.
 *
 * Sign in at auth-service (:3000) with `POST /auth/platform/login`, not `/auth/login`: a console
 * account holds no membership, so there is no distributor to pick. The demo account is
 * `dos.admin` / `Dos@1234` (`pnpm db:seed`).
 *
 * WHAT IT CANNOT SEE. Nothing here reads a distributor's trade. The sizes on the tenant list and the
 * platform metrics are COUNTS and storage bytes; the one path to a distributor's own rows is a support
 * grant its OWNER approved, exchanged for a five-minute pass at `auth.supportPass` and audited on every
 * request (`platform/support-access.ts`).
 */
export const adminServiceDefinition = defineService({
  name: 'admin',
  title: 'Admin console service',
  defaultPort: 3007,
  roles: ['platform_admin'],
  modules: [PlatformAdminModule],
  contractKeys: ['health', 'admin'],
})

/**
 * All eight, in port order — what `runAll()` mounts and what the `--base` mode of `pnpm smoke` walks.
 * Auth is first because every other one is useless without a token.
 */
export const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
  authServiceDefinition,
  ownerServiceDefinition,
  managerServiceDefinition,
  salesServiceDefinition,
  warehouseServiceDefinition,
  deliveryServiceDefinition,
  retailerServiceDefinition,
  adminServiceDefinition,
]
