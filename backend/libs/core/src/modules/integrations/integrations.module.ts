import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/index.js'
import { InventoryModule } from '../inventory/index.js'
import { ProcurementModule } from '../procurement/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { RetailersModule } from '../retailers/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { ExportJobsService } from './export-jobs.service.js'
import { IntegrationsController } from './integrations.controller.js'
import { IntegrationsService } from './integrations.service.js'
import { TallyService } from './tally.service.js'

/**
 * Integrations: the file bridge in (the generic mapped importer, docs/17 §D7) and out (Tally XML,
 * GSTR-1, registers, e-way / e-invoice bundles) — coordination §3.5's one `export_jobs` owner and one
 * `exports.render` queue. It owns `import_jobs`, `import_rows`, `import_profiles`, `export_jobs`,
 * `tally_mappings`, `tally_sync_ledger` and writes nothing else: every shop, listing, bill, journal
 * entry and history row it produces goes through the owning module's exported service (coordination
 * §4). Mounted on owner-service and manager-service only (§6).
 */
@Module({
  imports: [
    TenancyModule,
    RetailersModule,
    TenantCatalogModule,
    BillingModule,
    ReceivablesModule,
    ProcurementModule,
    InventoryModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ExportJobsService, TallyService],
  exports: [IntegrationsService, ExportJobsService, TallyService],
})
export class IntegrationsModule {}
