import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { deliveryChallans, loadSheets, packConfirmations, pickLines, picklists } from '@dos/db'
import { BillingModule } from '../billing/index.js'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { SyncRegistry, tablePull } from '../sync/index.js'
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
    // THE PULL SIDE — the paperwork of the godown floor, and the two documents that leave with the van.
    // Bounded to a month for the devices (docs/20: bounded work per request): a picker never scrolls
    // back further, and the desk pulls the lot. `load_sheets` and `delivery_challans` are held by BOTH
    // the warehouse phone that writes them and the crew that carries them — `sync-tables.ts` says so,
    // and `pullRolesFor` reads it from there rather than repeating it here.
    const recent = sql`created_at > now() - interval '30 days'`
    const fieldOnly = (r: { ctx: { actorRole: string } }) =>
      r.ctx.actorRole === 'warehouse' || r.ctx.actorRole === 'delivery' ? recent : undefined
    this.registry.registerPull('picklists', tablePull(picklists, { extra: fieldOnly }))
    this.registry.registerPull(
      'pick_lines',
      tablePull(pickLines, {
        extra: (r) =>
          fieldOnly(r)
            ? sql`picklist_id in (select p.id from picklists p
                 where p.tenant_id = ${r.ctx.tenantId} and p.created_at > now() - interval '30 days')`
            : undefined,
      }),
    )
    this.registry.registerPull(
      'pack_confirmations',
      tablePull(packConfirmations, { extra: fieldOnly }),
    )
    this.registry.registerPull('load_sheets', tablePull(loadSheets, { extra: fieldOnly }))
    this.registry.registerPull(
      'delivery_challans',
      tablePull(deliveryChallans, { extra: fieldOnly }),
    )
  }
}
