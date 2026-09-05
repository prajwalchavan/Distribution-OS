import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { RetailersController } from './retailers.controller.js'
import { RetailersService } from './retailers.service.js'

@Module({
  imports: [TenancyModule],
  controllers: [RetailersController],
  providers: [RetailersService],
  exports: [RetailersService],
})
export class RetailersModule {}
