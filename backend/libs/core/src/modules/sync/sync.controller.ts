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

  @Implement(contract.sync.errors.list)
  listErrors(@OwnsReply() _reply: unknown) {
    return implement(contract.sync.errors.list).handler(({ input }) => this.sync.listErrors(input))
  }

  @Implement(contract.sync.manifest)
  manifest(@OwnsReply() _reply: unknown) {
    return implement(contract.sync.manifest).handler(({ input }) => this.sync.manifest(input))
  }

  @Implement(contract.sync.pull)
  pull(@OwnsReply() _reply: unknown) {
    return implement(contract.sync.pull).handler(({ input }) => this.sync.pull(input))
  }
}
