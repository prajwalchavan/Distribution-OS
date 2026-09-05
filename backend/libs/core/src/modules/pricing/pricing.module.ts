import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { priceListItems, priceLists, retailerPriceOverrides, schemes } from '@dos/db'
import { BACK_OFFICE } from '../../platform/index.js'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { BargainsService } from './bargains.service.js'
import { PricingController } from './pricing.controller.js'
import { PricingService } from './pricing.service.js'
import { QuoteService } from './quote.service.js'
import { SchemesService } from './schemes.service.js'

/** What a scheme row must NOT carry onto a rep's device (docs/17 §B [54–57]). */
const SCHEME_PRIVATE_COLUMNS = ['funding_source', 'claimable', 'claim_window_days', 'source_ref']

/**
 * The engine's inputs are what the sales app prices with offline (docs/23 §3.4), so the module
 * registers their PULL readers: price lists and items, schemes in the PUBLIC shape, overrides.
 */
@Module({
  imports: [TenancyModule],
  controllers: [PricingController],
  providers: [PricingService, SchemesService, QuoteService, BargainsService],
  exports: [PricingService, SchemesService, QuoteService, BargainsService],
})
export class PricingModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.registerPull('price_lists', tablePull(priceLists))
    this.registry.registerPull('price_list_items', tablePull(priceListItems))
    // Funding source, claimability and the claim window are the DISTRIBUTOR's commercial terms with
    // the brand: the rep quotes the scheme, it never sees who pays for it (docs/17 §B security 54).
    // One `omit` now serves both halves — the rows a device pulls and the columns its manifest
    // publishes — so the field a rep may not see has nowhere to land on the phone either.
    this.registry.registerPull(
      'schemes',
      tablePull(schemes, {
        omit: (role) => (BACK_OFFICE.includes(role) ? [] : SCHEME_PRIVATE_COLUMNS),
      }),
    )
    this.registry.registerPull('retailer_price_overrides', tablePull(retailerPriceOverrides))
  }
}
