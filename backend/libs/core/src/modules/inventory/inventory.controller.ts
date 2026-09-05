import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { StockService } from './stock.service.js'

@Controller()
@UseGuards(TenantGuard)
export class InventoryController {
  constructor(private readonly stock: StockService) {}

  @Implement(contract.inventory.locations.list)
  listLocations(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.locations.list).handler(({ input }) =>
      this.stock.listLocations(input),
    )
  }

  @Implement(contract.inventory.locations.upsert)
  upsertLocation(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.locations.upsert).handler(({ input }) =>
      this.stock.upsertLocation(input),
    )
  }

  @Implement(contract.inventory.stock.sellable)
  sellable(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.stock.sellable).handler(({ input }) =>
      this.stock.sellable(input),
    )
  }

  @Implement(contract.inventory.stock.balances)
  balances(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.stock.balances).handler(({ input }) =>
      this.stock.balances(input),
    )
  }

  @Implement(contract.inventory.stock.adjust)
  adjust(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.stock.adjust).handler(({ input }) =>
      this.stock.adjust(input),
    )
  }

  @Implement(contract.inventory.stock.transfer)
  transfer(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.stock.transfer).handler(({ input }) =>
      this.stock.transfer(input),
    )
  }

  @Implement(contract.inventory.stock.ledger)
  ledger(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.stock.ledger).handler(({ input }) =>
      this.stock.ledger(input),
    )
  }

  @Implement(contract.inventory.lots.upsert)
  upsertLot(@OwnsReply() _reply: unknown) {
    return implement(contract.inventory.lots.upsert).handler(({ input }) =>
      this.stock.upsertLot(input),
    )
  }
}
