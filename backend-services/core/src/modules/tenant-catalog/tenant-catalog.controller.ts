import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { TenantCatalogService } from './tenant-catalog.service.js'

@Controller()
@UseGuards(TenantGuard)
export class TenantCatalogController {
  constructor(private readonly svc: TenantCatalogService) {}

  @Implement(contract.tenantCatalog.list)
  list(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.list).handler(({ input }) => this.svc.list(input))
  }

  @Implement(contract.tenantCatalog.upsertListing)
  upsertListing(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.upsertListing).handler(({ input }) =>
      this.svc.upsertListing(input),
    )
  }

  @Implement(contract.tenantCatalog.suppliers)
  suppliers(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.suppliers).handler(() => this.svc.suppliers())
  }

  @Implement(contract.tenantCatalog.upsertSupplier)
  upsertSupplier(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.upsertSupplier).handler(({ input }) =>
      this.svc.upsertSupplier(input),
    )
  }

  @Implement(contract.tenantCatalog.costs)
  costs(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.costs).handler(({ input }) => this.svc.costs(input))
  }

  @Implement(contract.tenantCatalog.upsertCost)
  upsertCost(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.upsertCost).handler(({ input }) =>
      this.svc.upsertCost(input),
    )
  }
}
