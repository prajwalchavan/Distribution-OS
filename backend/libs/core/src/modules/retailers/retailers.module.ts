import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { beatAssignments, beats, retailers, visits } from '@dos/db'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { RetailersController } from './retailers.controller.js'
import { RetailersService } from './retailers.service.js'

/**
 * Shops, beats, assignments and visits. The sales app holds all four offline (docs/23 §3.4), so the
 * module registers their PULL readers on `SyncRegistry` (docs/23 §8.11): a salesperson receives the
 * shops of the beats currently assigned to it and its own assignments; the desk and the crew the
 * whole tenant. `retailers` carries credit terms, which the retailer role never pulls (sync is not
 * mounted on the retailer service) and a rep sees only on rows it may read anyway (RLS).
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
    this.registry.registerPull('retailers', {
      handler: tablePull(retailers, {
        extra: (r) => (r.ctx.actorRole === 'salesperson' ? ownBeats(r.ctx.actorId) : undefined),
      }),
    })
    this.registry.registerPull('beats', { handler: tablePull(beats) })
    this.registry.registerPull('beat_assignments', {
      handler: tablePull(beatAssignments, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson' ? sql`user_id = ${r.ctx.actorId}` : undefined,
      }),
    })
    this.registry.registerPull('visits', {
      handler: tablePull(visits, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson' ? sql`user_id = ${r.ctx.actorId}` : undefined,
      }),
    })
  }
}
