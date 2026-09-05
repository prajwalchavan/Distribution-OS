import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { SyncService } from './sync.service.js'

@Controller()
@UseGuards(TenantGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Implement(contract.sync.upload)
  upload(@OwnsReply() _reply: unknown) {
    return implement(contract.sync.upload).handler(({ input }) => this.sync.upload(input))
  }
}
