import {
  defineService,
  TenancyModule,
  CatalogModule,
  TenantCatalogModule,
  RetailersModule,
  PricingModule,
  InventoryModule,
  OrdersModule,
  SyncModule,
} from '@dos/core'

/** The salesperson app: beats, shops, catalog with sellable stock, quotes, orders, bargains, offline sync. Purchase cost is never served here. */
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
    SyncModule,
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
    'sync',
  ],
})
