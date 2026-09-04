import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { ORPCError } from '@orpc/server'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenancyService } from './tenancy.service.js'
import { TenantGuard } from './tenant.guard.js'

@Controller()
@UseGuards(TenantGuard)
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Implement(contract.tenancy.me)
  me(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.me).handler(async () => {
      const me = await this.tenancy.me()
      if (!me)
        throw new ORPCError('UNAUTHORIZED', { message: 'No active membership for this tenant' })
      return me
    })
  }
}
