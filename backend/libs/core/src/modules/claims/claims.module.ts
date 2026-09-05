import { Module, type OnModuleInit } from '@nestjs/common'
import { BillingModule } from '../billing/index.js'
import { IntegrationsModule } from '../integrations/index.js'
import { InventoryModule } from '../inventory/index.js'
import { PricingModule } from '../pricing/index.js'
import { ProcurementModule } from '../procurement/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { ClaimBuildService } from './build.service.js'
import { ClaimsController } from './claims.controller.js'
import { ClaimsService } from './claims.service.js'
import { ClaimReportsService } from './reports.service.js'
import { registerClaimSheetRenderer } from './statements.js'

/**
 * Claims (docs/plans/claims.md, coordination §1 slot 7): money the manufacturer owes the distributor.
 * Owns `claims`, `claim_lines`, `claim_evidence`, `claim_statements`, `claim_settlements`; reads every
 * source and posts every rupee through the owning module (coordination §4): billing's registers for
 * the invoice and credit-note lines, pricing's schemes, inventory's ledger, procurement's findings,
 * tenant-catalog's policies and costs, receivables' journal, integrations' export queue.
 *
 * BACK OFFICE ONLY: mounted on owner-service and manager-service (coordination §6); never registered
 * with `SyncRegistry` (a damage line carries purchase cost, docs/22 never-list 1).
 */
@Module({
  imports: [
    TenancyModule,
    TenantCatalogModule,
    PricingModule,
    InventoryModule,
    ProcurementModule,
    ReceivablesModule,
    BillingModule,
    IntegrationsModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimBuildService, ClaimReportsService],
  exports: [ClaimsService, ClaimReportsService],
})
export class ClaimsModule implements OnModuleInit {
  onModuleInit(): void {
    // The `claim_sheet` renderer on integrations' one `exports.render` registry (coordination §3.5);
    // the worker registers the same function through `@dos/core/claims`.
    registerClaimSheetRenderer()
  }
}
