import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { FilesController } from './files.controller.js'
import { FilesService } from './files.service.js'

/**
 * Signed upload / read URLs over the object-storage platform (docs/23 §8.13). Mounted on owner,
 * manager, warehouse, delivery and retailer services (files.ts header); never on sales.
 */
@Module({
  imports: [TenancyModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
