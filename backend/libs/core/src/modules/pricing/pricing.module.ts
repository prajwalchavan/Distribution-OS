import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import {
  bargainRequests,
  priceListItems,
  priceLists,
  retailerPriceOverrides,
  schemes,
} from '@dos/db'
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
    // A SHOP HOLDS ITS OWN SLAB AND NOBODY ELSE'S (never-list 9: "a retailer sees only the rows
    // linked to their own shop"). `price_lists_read` is `tenantReadPolicy` because the engine runs on
    // the rep's phone, and `pricing.priceLists.list` is STAFF in the matrix — so the application
    // layer is the only thing standing between a shopkeeper and every tier's rate card, and a pull
    // with no predicate walks straight past it. The device is given exactly the lists the engine
    // would resolve for it (`QuoteService`: the default list plus the one matching the shop's tier),
    // which is everything it needs to price its own reorder offline and nothing about what the shop
    // down the road pays. `retailers` is itself RLS-narrowed to the caller's own shops, so the tier
    // subquery cannot widen — it reads what the caller may already read.
    const ownTierLists = () => sql`is_default
       or tier in (select r.tier from retailers r
                    where r.tenant_id = (select current_setting('app.tenant_id', true)))`
    const shopOnly = (role: string, predicate: () => SQL): SQL | undefined =>
      role === 'retailer' ? predicate() : undefined
    this.registry.registerPull(
      'price_lists',
      tablePull(priceLists, { extra: (r) => shopOnly(r.ctx.actorRole, ownTierLists) }),
    )
    this.registry.registerPull(
      'price_list_items',
      tablePull(priceListItems, {
        extra: (r) =>
          shopOnly(
            r.ctx.actorRole,
            () => sql`price_list_id in (
              select p.id from price_lists p
               where p.tenant_id = ${r.ctx.tenantId} and (${ownTierLists()}))`,
          ),
      }),
    )
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
    // The rep asked for a special rate and walked to the next shop: the ANSWER has to reach the phone
    // on the next pull, online or not, or the order waits on a screen nobody is looking at. Its own
    // requests only — a rep may not read what another rep asked for, and the decision is the desk's.
    this.registry.registerPull(
      'bargain_requests',
      tablePull(bargainRequests, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson' ? sql`requested_by = ${r.ctx.actorId}` : undefined,
      }),
    )
  }
}
