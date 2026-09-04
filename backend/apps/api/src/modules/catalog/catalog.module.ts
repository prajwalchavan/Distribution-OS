import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { CatalogController } from './catalog.controller.js'
import { CatalogService } from './catalog.service.js'

@Module({
  imports: [TenancyModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
