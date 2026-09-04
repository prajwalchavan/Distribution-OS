import {
  defineService,
  TenancyModule,
  CatalogModule,
  TenantCatalogModule,
  RetailersModule,
  PricingModule,
  InventoryModule,
  ProcurementModule,
  OrdersModule,
  SyncModule,
} from '@dos/core'

/** Everything the distributor owner, manager and accountant do at the desk or on the phone: masters, costs, prices, approvals, registers. */
export const service = defineService({
  name: 'owner',
  title: 'Owner service',
  defaultPort: 3001,
  roles: ['owner', 'manager', 'accountant'],
  modules: [
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
    RetailersModule,
    PricingModule,
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
    'pricing',
    'inventory',
    'procurement',
    'orders',
    'sync',
  ],
})
