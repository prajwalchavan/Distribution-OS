import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { currentTenant } from '../../platform/index.js'
import { ProcurementModule } from '../procurement/index.js'
import { SyncRegistry } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { DocintController } from './docint.controller.js'
import { applyDocumentSync, applyPageSync } from './docint.sync.js'
import { DocumentsService } from './documents.service.js'
import { ExtractionsService } from './extractions.service.js'
import { MatchesService } from './matches.service.js'
import { QueueService } from './queue.service.js'
import { ReviewService } from './review.service.js'

/**
 * Document intelligence (docs/22 §5): capture → QR/IRN → engine reading (worker) → deterministic
 * checks → SKU match → single-writer review → supplier invoice DRAFT through procurement. Never a
 * GRN, a lot, a ledger row, a cost or a journal line (never-list 6); `procurement.grns.*` does that,
 * by a human, later. ProcurementModule is imported for exactly one call: `SupplierInvoiceService.
 * createInTx` at `documents.approve`. Everything else is docint's own tables plus reads of the
 * catalog, the tenant catalog and `hsn_rates`.
 *
 * The warehouse phone captures offline, so the module also owns the sync handlers for `documents`
 * and `document_pages` (PUT only, brief §7). SyncRegistry is optional: a spec may boot DocintModule
 * without SyncModule.
 */
@Module({
  imports: [TenancyModule, ProcurementModule],
  controllers: [DocintController],
  providers: [DocumentsService, ExtractionsService, MatchesService, ReviewService, QueueService],
  exports: [DocumentsService, ExtractionsService, MatchesService, ReviewService, QueueService],
})
export class DocintModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.register('documents', (tx, op) => applyDocumentSync(tx, op, currentTenant()))
    this.registry.register('document_pages', (tx, op) => applyPageSync(tx, op, currentTenant()))
  }
}
