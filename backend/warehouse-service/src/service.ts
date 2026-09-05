import {
  defineService,
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
} from '@dos/core'

/**
 * The warehouse app: GRN gate counts, stock, the order queue, picking, packing and load-out.
 *
 * `BillingModule` is mounted because `warehouse.packs.confirm` issues the invoice in the same
 * transaction as the pack (coordination §4 step 3) and the `billing` contract key lets the packer read
 * the bill it just produced. `receivables` is deliberately NOT here: the warehouse role never touches
 * money (coordination §6), and the module is pulled in only as billing's own dependency.
 */
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
    BillingModule,
    WarehouseModule,
    SyncModule,
    FilesModule,
    DeliveryModule,
    DocintModule,
    NotificationsModule,
    ReportingModule,
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
  ],
})
