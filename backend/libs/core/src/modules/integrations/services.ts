import type { Db } from '@dos/db'
import { createBillingStack, type BillingService, type RegistersService } from '../billing/index.js'
import type { ReceivablesService } from '../receivables/index.js'
import { SupplierInvoiceService } from '../procurement/index.js'
import { RetailersService } from '../retailers/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'

/**
 * The owning-module services the importer and the exporters call (coordination §4: integrations →
 * retailers, tenant-catalog, billing, receivables, procurement — never their tables). In the API the
 * Nest container injects them into `IntegrationsService`; in the pg-boss worker, which has no DI,
 * `createImportServices` builds the same set by hand through each module's exported factory or
 * constructor (coordination §3.9), so both paths run the identical commit and render code.
 */
export interface ImportServices {
  retailers: RetailersService
  tenantCatalog: TenantCatalogService
  billing: BillingService
  receivables: ReceivablesService
  registers: RegistersService
  supplierInvoices: SupplierInvoiceService
}

export function createImportServices(db: Db | null): ImportServices {
  const stack = createBillingStack(db)
  return {
    retailers: new RetailersService(db),
    tenantCatalog: new TenantCatalogService(db),
    billing: stack.billing,
    receivables: stack.receivables,
    registers: stack.registers,
    supplierInvoices: new SupplierInvoiceService(db),
  }
}
