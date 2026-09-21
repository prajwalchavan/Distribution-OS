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
 * of the protocol was opened to the retailer role (docs/07 §0). `retailers` carries credit terms:
 * RLS (`tenantOrOwnRetailerPolicy`) narrows the rows to the shop's OWN, and the `omit` below narrows
 * the COLUMNS, because a shop is never shown its own limit or credit headroom (docs/22 §8, S-177);
 * a rep sees them, on rows it may read anyway, because it quotes against the limit offline.
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
    /*
     * THE CREW'S COPY CARRIES NO CREDIT TERMS (QA DOS-072). A driver's device held the shop's limit,
     * its bill count, its days and its tier — docs/23 §5.3 flagged it before the walk found it — and
     * "no screen draws it" is not the same as "it is not on the phone". What the door actually needs
     * is `credit_mode` (may this shop take goods on credit at all) and the dues, which come from
     * `retailer_outstanding_summary`; those stay. The rep keeps the block: it quotes and warns
     * against the limit offline. The manifest is built from this same `omit`, so a device that held
     * the columns re-snapshots on the new schema hash instead of keeping a stale copy.
     */
    const CREDIT_TERMS = ['credit_limit_paise', 'credit_limit_bills', 'credit_days', 'tier']
    /*
     * AND THE SHOP'S OWN COPY CARRIES NO CREDIT POLICY AT ALL (QA S-177). RLS narrows `retailers` to
     * the shopkeeper's OWN row, and for a long time that was read as "which is the row whose limit
     * and terms the shop is entitled to see". It is not: docs/22 §8 (DOS-100, ADR 0006) says the
     * shop's screen shows the overdue amount with a Pay button "and never a credit limit or
     * credit-available figure", and the oRPC door has always agreed — `toView` hands the retailer
     * role the PUBLIC record, with no code, no tier and no credit. `tablePull` is `select *`, so the
     * sync door was serving through the wall the other door holds; QA found it open before the
     * retailer app grew an offline client, which is the only reason nothing was on a phone yet. The
     * crew's omission keeps `credit_mode` (may this shop take goods on credit at the door); the shop
     * does not get even that. What the shop IS owed — what it owes today — still reaches it through
     * `retailer_outstanding_summary` and `receivables.outstanding`. The TIER goes with the policy:
     * the shop's slab is the desk's rate decision about it, and the oRPC door's `toPublic` has never
     * handed the retailer role its tier either, so the two doors agree. The manifest is built from
     * this same `omit`, so a device that held the columns re-snapshots on the new schema hash.
     */
    const CREDIT_POLICY = [
      'credit_limit_paise',
      'credit_limit_bills',
      'credit_days',
      'credit_mode',
      'tier',
    ]
    this.registry.registerPull(
      'retailers',
      tablePull(retailers, {
        extra: (r) => (r.ctx.actorRole === 'salesperson' ? ownBeats(r.ctx.actorId) : undefined),
        omit: (role) =>
          role === 'delivery' ? CREDIT_TERMS : role === 'retailer' ? CREDIT_POLICY : [],
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
