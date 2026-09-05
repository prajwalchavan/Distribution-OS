import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { BillingModule } from '../billing/index.js'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { SyncRegistry } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { LoadSheetsService } from './load-sheets.service.js'
import { PackingService } from './packing.service.js'
import { PicklistsService } from './picklists.service.js'
import { WarehouseController } from './warehouse.controller.js'
import { applyPickLineSync } from './warehouse.sync.js'

/**
 * Outbound fulfilment: pick → pack (the invoice is issued here) → load sheet → delivery challan.
 *
 * It is the only module that writes `picklists`, `pick_lines`, `pack_confirmations`, `load_sheets` and
 * `delivery_challans`, and it reaches everything else through a module's `index.ts` (coordination §4):
 * `OrdersService` for the aggregate and its three fulfilment transitions, `InventoryService` for every
 * piece, `BillingService.issueForPack` for the document at pack.
 *
 * `BillingModule` is a HARD dependency, not `@Optional()`: by the build order billing always exists,
 * and `packs.confirm` is now the only way a pack invoice is issued (coordination §4 step 3), so a
 * warehouse that could not bill would silently pack orders no one ever charges for.
 *
 * The godown phone works offline, so the module registers ONE sync handler — `pick_lines`. Packing and
 * loading allocate server-side document numbers under a row lock and stay online-only. `SyncRegistry`
 * is optional so a spec may boot this module without `SyncModule`.
 */
@Module({
  imports: [TenancyModule, OrdersModule, InventoryModule, BillingModule],
  controllers: [WarehouseController],
  providers: [PicklistsService, PackingService, LoadSheetsService],
  exports: [PicklistsService, PackingService, LoadSheetsService],
})
export class WarehouseModule implements OnModuleInit {
  constructor(
    private readonly picklists: PicklistsService,
    @Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null,
  ) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.register('pick_lines', (tx, op) => applyPickLineSync(tx, op, this.picklists))
  }
}
