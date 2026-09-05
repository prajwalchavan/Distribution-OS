import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { SyncRegistry } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { ReceivablesController } from './receivables.controller.js'
import { ReceivablesService } from './receivables.service.js'
import { applyAllocationSync, applyReceiptSync } from './receivables.sync.js'

/**
 * The money ledger (ADR 0004): receipts, allocations, the double-entry book, outstanding and ageing.
 * Every other module posts through `ReceivablesService`; nothing else writes `journal_*`, `receipts`,
 * `allocations`, `write_offs` or `retailer_outstanding_summary`.
 *
 * The delivery crew collects at the shop door with no signal, so the module also owns the sync handlers
 * for `receipts` and `allocations`. `SyncRegistry` is optional: a spec may boot this module alone.
 */
@Module({
  imports: [TenancyModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule implements OnModuleInit {
  constructor(
    private readonly receivables: ReceivablesService,
    @Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null,
  ) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.register('receipts', (tx, op) => applyReceiptSync(tx, op, this.receivables))
    this.registry.register('allocations', (tx, op) => applyAllocationSync(tx, op, this.receivables))
  }
}
