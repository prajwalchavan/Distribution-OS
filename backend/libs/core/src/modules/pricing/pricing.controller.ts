import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { BargainsService } from './bargains.service.js'
import { PricingService } from './pricing.service.js'
import { QuoteService } from './quote.service.js'
import { SchemesService } from './schemes.service.js'

@Controller()
@UseGuards(TenantGuard)
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly quotes: QuoteService,
    private readonly bargains: BargainsService,
    private readonly schemes: SchemesService,
  ) {}

  @Implement(contract.pricing.priceLists.list)
  listPriceLists(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.priceLists.list).handler(({ input }) =>
      this.pricing.listPriceLists(input),
    )
  }

  @Implement(contract.pricing.priceLists.upsert)
  upsertPriceList(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.priceLists.upsert).handler(({ input }) =>
      this.pricing.upsertPriceList(input),
    )
  }

  @Implement(contract.pricing.priceLists.setItems)
  setPriceListItems(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.priceLists.setItems).handler(({ input }) =>
      this.pricing.setPriceListItems(input),
    )
  }

  @Implement(contract.pricing.overrides.list)
  listOverrides(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.overrides.list).handler(({ input }) =>
      this.pricing.listOverrides(input),
    )
  }

  @Implement(contract.pricing.overrides.upsert)
  upsertOverride(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.overrides.upsert).handler(({ input }) =>
      this.pricing.upsertOverride(input),
    )
  }

  @Implement(contract.pricing.schemes.list)
  listSchemes(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.schemes.list).handler(({ input }) =>
      this.schemes.listSchemes(input),
    )
  }

  @Implement(contract.pricing.schemes.upsert)
  upsertScheme(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.schemes.upsert).handler(({ input }) =>
      this.schemes.upsertScheme(input),
    )
  }

  @Implement(contract.pricing.quote)
  quote(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.quote).handler(({ input }) => this.quotes.quote(input))
  }

  @Implement(contract.pricing.bargains.request)
  requestBargain(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.bargains.request).handler(({ input }) =>
      this.bargains.request(input),
    )
  }

  @Implement(contract.pricing.bargains.decide)
  decideBargain(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.bargains.decide).handler(({ input }) =>
      this.bargains.decide(input),
    )
  }

  @Implement(contract.pricing.bargains.list)
  listBargains(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.bargains.list).handler(({ input }) =>
      this.bargains.list(input),
    )
  }

  @Implement(contract.pricing.bounds.list)
  listBounds(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.bounds.list).handler(({ input }) =>
      this.pricing.listBounds(input),
    )
  }

  @Implement(contract.pricing.bounds.set)
  setBound(@OwnsReply() _reply: unknown) {
    return implement(contract.pricing.bounds.set).handler(({ input }) =>
      this.pricing.setBound(input),
    )
  }
}
