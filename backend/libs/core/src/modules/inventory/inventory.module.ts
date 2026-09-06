import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { locations, stockBalances, stockLots } from '@dos/db'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { CycleCountsService } from './cycle-counts.service.js'
import { InventoryController } from './inventory.controller.js'
import { InventoryService } from './inventory.service.js'
import { StockService } from './stock.service.js'

/**
 * Stock ledger, lots, balances and reservations (ADR 0003). Other modules post to the ledger through
 * `InventoryService` inside their own `withTenant` transaction; they never touch the stock tables.
 *
 * THE GODOWN PHONE'S READ SET (`sync-tables.ts`: warehouse only). Three tables travel — `locations`,
 * `stock_lots` and `stock_balances` — so a picker can work a picklist in a shed with no signal: the
 * lot to pick from, where it is, and how much is there. Two things are deliberately NOT here:
 *
 *  - `stock_ledger` and `reservations`, because a device may not replay a ledger; the balance IS the
 *    device's view and the ledger stays where it is written;
 *  - any cost. `stock_lots` carries no buying price (it lives in `tenant_product_costs`), and
 *    migration 0040 asserts that on every pull-able table rather than trusting this comment.
 *
 * `stock_balances` is one of the two tables with no `id` column: it is keyed `(lot_id, location_id)`,
 * which is what the manifest publishes and what a tombstone's `row_id` joins with a `:`.
 *
 * Nothing is registered on the UPLOAD side: a count is `warehouse.pick_lines` or a cycle count, both
 * of which belong to the module that owns the screen, and stock never moves because a phone said so.
 */
@Module({
  imports: [TenancyModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockService, CycleCountsService],
  exports: [InventoryService],
})
export class InventoryModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.registerPull('locations', tablePull(locations))
    this.registry.registerPull('stock_lots', tablePull(stockLots))
    this.registry.registerPull('stock_balances', tablePull(stockBalances))
  }
}
