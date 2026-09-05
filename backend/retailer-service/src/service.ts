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
} from '@dos/core'

/** The shopkeeper app: one card per linked distributor, catalog with availability, own orders, bills and dues. Row-level security limits every read to the shop itself. */
export const service = defineService({
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
  ],
})
