import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { BargainsService } from './bargains.service.js'
import { PricingController } from './pricing.controller.js'
import { PricingService } from './pricing.service.js'
import { QuoteService } from './quote.service.js'
import { SchemesService } from './schemes.service.js'

@Module({
  imports: [TenancyModule],
  controllers: [PricingController],
  providers: [PricingService, SchemesService, QuoteService, BargainsService],
  exports: [PricingService, SchemesService, QuoteService, BargainsService],
})
export class PricingModule {}
