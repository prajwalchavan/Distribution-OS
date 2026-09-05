import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { tenantProducts } from '@dos/db'
import { CatalogModule } from '../catalog/index.js'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { CatalogOverlayService } from './overlay.service.js'
import { TenantCatalogController } from './tenant-catalog.controller.js'
import { TenantCatalogService } from './tenant-catalog.service.js'

@Module({
  imports: [TenancyModule, CatalogModule],
  controllers: [TenantCatalogController],
  providers: [TenantCatalogService, CatalogOverlayService],
  exports: [TenantCatalogService, CatalogOverlayService],
})
export class TenantCatalogModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  /** The listed catalogue is on every field device (docs/23 §3.4); `tenant_products` carries no cost. */
  onModuleInit(): void {
    if (!this.registry) return
    this.registry.registerPull('tenant_products', { handler: tablePull(tenantProducts) })
  }
}
