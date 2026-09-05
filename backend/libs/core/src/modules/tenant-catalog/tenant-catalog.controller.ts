import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { CatalogOverlayService } from './overlay.service.js'
import { TenantCatalogService } from './tenant-catalog.service.js'

@Controller()
@UseGuards(TenantGuard)
export class TenantCatalogController {
  constructor(
    private readonly svc: TenantCatalogService,
    private readonly overlay: CatalogOverlayService,
  ) {}

  @Implement(contract.tenantCatalog.repAuthorisations.list)
  listRepAuthorisations(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.repAuthorisations.list).handler(({ input }) =>
      this.overlay.listRepAuthorisations(input),
    )
  }

  @Implement(contract.tenantCatalog.repAuthorisations.set)
  setRepAuthorisations(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.repAuthorisations.set).handler(({ input }) =>
      this.overlay.setRepAuthorisations(input),
    )
  }

  @Implement(contract.tenantCatalog.brands.list)
  listBrands(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.brands.list).handler(() => this.overlay.listBrands())
  }

  @Implement(contract.tenantCatalog.brands.upsert)
  upsertBrand(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.brands.upsert).handler(({ input }) =>
      this.overlay.upsertBrand(input),
    )
  }

  @Implement(contract.tenantCatalog.packConfigs.list)
  listPackConfigs(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.packConfigs.list).handler(({ input }) =>
      this.overlay.listPackConfigs(input),
    )
  }

  @Implement(contract.tenantCatalog.packConfigs.upsert)
  upsertPackConfig(@OwnsReply() _reply: unknown) {
    return implement(contract.tenantCatalog.packConfigs.upsert).handler(({ input }) =>
      this.overlay.upsertPackConfig(input),
    )
  }

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
