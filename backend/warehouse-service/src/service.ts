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

/** The warehouse app: GRN gate counts, stock, picking and packing, order queue. Supplier invoice rates and GRN open/post stay at the desk. */
export const service = defineService({
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
