import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { FilesService } from './files.service.js'

@Controller()
@UseGuards(TenantGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Implement(contract.files.uploadUrl)
  uploadUrl(@OwnsReply() _reply: unknown) {
    return implement(contract.files.uploadUrl).handler(({ input }) => this.files.uploadUrl(input))
  }

  @Implement(contract.files.readUrl)
  readUrl(@OwnsReply() _reply: unknown) {
    return implement(contract.files.readUrl).handler(({ input }) => this.files.readUrl(input))
  }
}
