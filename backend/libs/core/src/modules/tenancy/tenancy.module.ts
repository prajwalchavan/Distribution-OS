import { Module } from '@nestjs/common'
import { TenantConfigService } from './config.service.js'
import { SupportAccessService } from './support.service.js'
import { TenancyController } from './tenancy.controller.js'
import { TenancyService } from './tenancy.service.js'
import { TenantGuard } from './tenant.guard.js'

@Module({
  controllers: [TenancyController],
  providers: [TenancyService, TenantConfigService, SupportAccessService, TenantGuard],
  exports: [TenancyService, TenantConfigService, SupportAccessService],
})
export class TenancyModule {}
