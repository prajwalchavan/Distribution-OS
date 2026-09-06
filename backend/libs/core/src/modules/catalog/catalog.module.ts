import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { brands, manufacturers, productVariants, products } from '@dos/db'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { CatalogController } from './catalog.controller.js'
import { CatalogService } from './catalog.service.js'

/**
 * The GLOBAL curated catalogue — manufacturers, brands, products, variants — which every device holds
 * because a shop's order line, a picklist row and a bill line all name a variant id (docs/07 §7.2's
 * `reference` stream, now our own pull).
 *
 * These four are the only pull-able tables with **no `tenant_id` column at all**: they are curated
 * once for everybody, so the reader leaves the tenant predicate out and their tombstones are filed
 * under the sentinel tenant `'*'` (migration 0040). `tablePull` reads both facts from
 * `SYNC_PULL_TABLES`, so nothing here has to say it twice. They carry no cost of any kind — the
 * distributor's buying price lives in `tenant_product_costs`, which no device ever pulls.
 */
@Module({
  imports: [TenancyModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.registerPull('manufacturers', tablePull(manufacturers))
    this.registry.registerPull('brands', tablePull(brands))
    this.registry.registerPull('products', tablePull(products))
    this.registry.registerPull('product_variants', tablePull(productVariants))
  }
}
