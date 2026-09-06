import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { beatAssignments, beats, pjp, retailerLinks, retailers, visits } from '@dos/db'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { RetailersController } from './retailers.controller.js'
import { RetailersService } from './retailers.service.js'

/**
 * Shops, beats, assignments and visits. The sales app holds all four offline (docs/23 §3.4), so the
 * module registers their PULL readers on `SyncRegistry` (docs/23 §8.11): a salesperson receives the
 * shops of the beats currently assigned to it and its own assignments; the desk and the crew the
 * whole tenant. The shop holds two of these — `retailers` and `retailer_links` — since the READ half
 * of the protocol was opened to the retailer role (docs/07 §0). `retailers` carries credit terms, and
 * RLS (`tenantOrOwnRetailerPolicy`) already narrows it to the shop's OWN row, which is the row whose
 * limit and terms the shop is entitled to see; a rep sees it only on rows it may read anyway.
 */
@Module({
  imports: [TenancyModule],
  controllers: [RetailersController],
  providers: [RetailersService],
  exports: [RetailersService],
})
export class RetailersModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    const ownBeats = (userId: string) => sql`beat_id in (
      select a.beat_id from beat_assignments a
       where a.tenant_id = (select current_setting('app.tenant_id', true)) and a.user_id = ${userId}
         and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date))`
    this.registry.registerPull(
      'retailers',
      tablePull(retailers, {
        extra: (r) => (r.ctx.actorRole === 'salesperson' ? ownBeats(r.ctx.actorId) : undefined),
      }),
    )
    this.registry.registerPull('beats', tablePull(beats))
    this.registry.registerPull(
      'beat_assignments',
      tablePull(beatAssignments, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson' ? sql`user_id = ${r.ctx.actorId}` : undefined,
      }),
    )
    this.registry.registerPull(
      'visits',
      tablePull(visits, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson' ? sql`user_id = ${r.ctx.actorId}` : undefined,
      }),
    )
    // The journey plan behind the beat: the rep's shops in the order they are called on. Staff-read
    // (`pjp_read`), so a shop never sees the route of the man who visits it.
    this.registry.registerPull(
      'pjp',
      tablePull(pjp, {
        extra: (r) => (r.ctx.actorRole === 'salesperson' ? ownBeats(r.ctx.actorId) : undefined),
      }),
    )
    // Who may sign in for a shop. The shop's own app holds it (that is how it shows who at the shop
    // is linked); a rep holds the links of the shops on its own beats, so the app can show "spoke to
    // the owner, not the counter boy". Nothing here reveals whether a phone exists in another
    // distributor's network (docs/17 item 27): the row is only ever read through the tenant the
    // caller is signed in to, or through the caller's own user id.
    //
    // THE SHOP NEEDS ITS OWN PREDICATE, and this is the one table of its read set where RLS does not
    // supply one. `retailer_links_read` is deliberately `tenant_id = app.tenant_id OR user_id =
    // actor` — that OR is the switch-distributor screen — so for a signed-in shopkeeper the FIRST
    // half is true of every link in the distributorship, and an unfiltered pull hands one customer
    // the identity and login of every other (never-list 9: "a retailer sees only the rows linked to
    // their own shop"). It is the same trap the platform gate found in `modules/ai`'s `ownShopId()`.
    // Scoped to the shops this person is linked to, the app still gets the owner AND the counter
    // staff of its own shops, which is all the screen shows.
    const ownShops = (userId: string) => sql`retailer_id in (
      select l.retailer_id from retailer_links l
       where l.tenant_id = (select current_setting('app.tenant_id', true)) and l.user_id = ${userId})`
    this.registry.registerPull(
      'retailer_links',
      tablePull(retailerLinks, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson'
            ? sql`retailer_id in (select x.id from retailers x where x.tenant_id = ${r.ctx.tenantId} and ${ownBeats(r.ctx.actorId)})`
            : r.ctx.actorRole === 'retailer'
              ? ownShops(r.ctx.actorId)
              : undefined,
      }),
    )
  }
}
