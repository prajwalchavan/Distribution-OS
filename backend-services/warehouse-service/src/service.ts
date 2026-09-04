import {
  defineService,
  TenancyModule,
  CatalogModule,
  TenantCatalogModule,
  RetailersModule,
  InventoryModule,
  ProcurementModule,
  OrdersModule,
  SyncModule,
} from '@dos/core'

/** The warehouse manager app: inbound invoices, GRN gate counts, stock, picking and packing, order queue. */
export const service = defineService({
  name: 'warehouse',
  title: 'Warehouse service',
  defaultPort: 3003,
  roles: ['manager', 'owner'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    InventoryModule,
    ProcurementModule,
    OrdersModule,
    SyncModule,
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
    'sync',
  ],
})
