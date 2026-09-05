import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { InventoryController } from './inventory.controller.js'
import { InventoryService } from './inventory.service.js'
import { StockService } from './stock.service.js'

/**
 * Stock ledger, lots, balances and reservations (ADR 0003). Other modules post to the ledger through
 * `InventoryService` inside their own `withTenant` transaction; they never touch the stock tables.
 */
@Module({
  imports: [TenancyModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  exports: [InventoryService],
})
export class InventoryModule {}
