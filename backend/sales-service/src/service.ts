import {
  defineService,
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
} from '@dos/core'

/**
 * The salesperson app: beats, shops, catalog with sellable stock, quotes, orders, bargains, offline sync.
 * Purchase cost is never served here.
 *
 * `ReceivablesModule` and `BillingModule` are mounted for READS ONLY (docs/23 §8.1, §8.2): the rep sees
 * a shop's dues, statement and credit check and the bills of the shops it serves. Every write in those
 * two contracts refuses the salesperson in PERMISSIONS — "never collects" (docs/17 §D4) — so mounting
 * the keys exposes no way to record a rupee. `files` is not here: a rep uploads nothing.
 */
export const service = defineService({
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
