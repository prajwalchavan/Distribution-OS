import { Module } from '@nestjs/common'
import { TenantConfigService } from './config.service.js'
import { TenancyController } from './tenancy.controller.js'
import { TenancyService } from './tenancy.service.js'
import { TenantGuard } from './tenant.guard.js'

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, TenantConfigService, TenantGuard],
  exports: [TenancyService, TenantConfigService],
})
export class TenancyModule {}
