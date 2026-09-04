import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { TenantCatalogController } from './tenant-catalog.controller.js'
import { TenantCatalogService } from './tenant-catalog.service.js'

@Module({
  imports: [TenancyModule, CatalogModule],
  controllers: [TenantCatalogController],
  providers: [TenantCatalogService],
  exports: [TenantCatalogService],
})
export class TenantCatalogModule {}
