import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { receipts, retailerOutstandingSummary } from '@dos/db'
import { SyncRegistry, tablePull } from '../sync/index.js'
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
    // The pull side. `receipts` is the one WRITABLE money table on a device — the crew records it at
    // the door — so it is both registered above and pulled here: the crew's own receipts of the last
    // 90 days come back with their server numbers, and the shop sees the receipt for money it paid.
    // `allocations` is deliberately not pulled: bill-to-bill settlement is the server's arithmetic and
    // the device shows the OUTSTANDING, not the workings.
    const recent = sql`created_at > now() - interval '90 days'`
    this.registry.registerPull(
      'receipts',
      tablePull(receipts, {
        extra: (r) =>
          r.ctx.actorRole === 'delivery' || r.ctx.actorRole === 'retailer' ? recent : undefined,
      }),
    )
    // What a shop owes, in one row per shop, kept by `refreshOutstanding` — the number on the rep's
    // shop card and on the crew's door screen, and the only dues figure either of them may quote
    // offline. It has NO `id` column: `sync-tables.ts` keys it by `retailer_id`, which is what the
    // manifest publishes as the device's primary key and what a tombstone carries.
    this.registry.registerPull(
      'retailer_outstanding_summary',
      tablePull(retailerOutstandingSummary),
    )
  }
}
