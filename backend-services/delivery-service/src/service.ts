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

/** The delivery crew app: trips, stops, proof of delivery, collections, van sales from vehicle stock, GPS. Trip endpoints arrive with the delivery module. */
export const service = defineService({
  name: 'delivery',
  title: 'Delivery service',
  defaultPort: 3004,
  roles: ['delivery', 'owner', 'manager'],
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
