import { Module } from '@nestjs/common'
import { TenancyController } from './tenancy.controller.js'
import { TenancyService } from './tenancy.service.js'
import { TenantGuard } from './tenant.guard.js'

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, TenantGuard],
  exports: [TenancyService],
})
export class TenancyModule {}
