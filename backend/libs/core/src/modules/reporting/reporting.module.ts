import { Module, type OnModuleInit } from '@nestjs/common'
import { BillingModule } from '../billing/index.js'
import { IntegrationsModule } from '../integrations/index.js'
import { InventoryModule } from '../inventory/index.js'
import { PricingModule } from '../pricing/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { ReportExportsService } from './exports.service.js'
import { ReportingRegistersService } from './registers.service.js'
import { ReportingController } from './reporting.controller.js'
import { ReportingService } from './reporting.service.js'
import { registerReportRenderers } from './renderers.js'

/**
 * Reporting (docs/plans/reporting.md, coordination §1 slot 9): the read model behind every dashboard
 * tile, every GRAPH in the owner app (docs/22 §8, 2026-09-04) and every register screen.
 *
 * It owns the six rollup tables in `database/src/schema/reporting.ts` and NOTHING else. Every other
 * number is fetched through the owning module's exported read (coordination §4) — billing's registers,
 * receivables' collections and ageing, orders' fill rate, inventory's valuation, procurement's purchase
 * register, retailers' beat assignments, delivery's per-trip rows, integrations' export queue — so no
 * arithmetic in this module can disagree with the screen that owns it.
 *
 * Mounted on owner, manager, sales, warehouse and delivery services; NOT on retailer-service and NOT on
 * auth-service (coordination §6). A shop never opens a report, and the 0027/0028 policies give a
 * retailer-role session zero rows of every rollup table even if it somehow reached one.
 *
 * `onModuleInit` arms the twenty `report_*` renderers on integrations' single `exports.render` registry
 * (coordination §3.5). The registry is per process, so the worker's `main.ts` calls the same function.
 */
@Module({
  imports: [
    TenancyModule,
    TenantCatalogModule,
    InventoryModule,
    PricingModule,
    BillingModule,
    IntegrationsModule,
  ],
  controllers: [ReportingController],
  providers: [ReportingService, ReportingRegistersService, ReportExportsService],
  exports: [ReportingService, ReportingRegistersService],
})
export class ReportingModule implements OnModuleInit {
  onModuleInit(): void {
    registerReportRenderers()
  }
}
