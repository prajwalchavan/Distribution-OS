import { Global, Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { SyncController } from './sync.controller.js'
import { SyncRegistry } from './sync.registry.js'
import { SyncService } from './sync.service.js'

/** Global so any module can inject SyncRegistry and register its table handlers in onModuleInit. */
@Global()
@Module({
  imports: [TenancyModule],
  controllers: [SyncController],
  providers: [SyncRegistry, SyncService],
  exports: [SyncRegistry],
})
export class SyncModule {}
