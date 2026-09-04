import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { CatalogService } from './catalog.service.js'

@Controller()
@UseGuards(TenantGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Implement(contract.catalog.search)
  search(@OwnsReply() _reply: unknown) {
    return implement(contract.catalog.search).handler(({ input }) => this.catalog.search(input))
  }

  @Implement(contract.catalog.manufacturers)
  manufacturers(@OwnsReply() _reply: unknown) {
    return implement(contract.catalog.manufacturers).handler(() => this.catalog.manufacturers())
  }

  @Implement(contract.catalog.propose)
  propose(@OwnsReply() _reply: unknown) {
    return implement(contract.catalog.propose).handler(({ input }) => this.catalog.propose(input))
  }
}
