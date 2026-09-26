import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { salesOrderLines, salesOrders } from '@dos/db'
import { InventoryModule } from '../inventory/index.js'
import { PricingModule } from '../pricing/index.js'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { ApprovalHooks } from './approval-hooks.js'
import { ApprovalsService } from './approvals.service.js'
import { OrdersController } from './orders.controller.js'
import { OrdersService } from './orders.service.js'
import { applyLineSync, applyOrderSync } from './orders.sync.js'

/**
 * The Sales Order aggregate: drafting and pricing, the fulfilment state machine, the owner's approvals queue
 * and the stock reservation taken at confirm. Prices come from PricingModule's engine and stock moves only
 * through InventoryModule; nothing here writes another module's tables.
 *
 * The team app drafts orders offline, so the module also owns the sync handlers for `sales_orders` and
 * `sales_order_lines`. SyncRegistry is optional: a spec may boot OrdersModule without SyncModule.
 */
@Module({
  imports: [TenancyModule, PricingModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService, ApprovalsService, ApprovalHooks],
  exports: [OrdersService, ApprovalsService, ApprovalHooks],
})
export class OrdersModule implements OnModuleInit {
  constructor(
    private readonly orders: OrdersService,
    @Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null,
  ) {}

  onModuleInit(): void {
    if (!this.registry) return
    // The online doors these two tables stand for; the uploader checks PERMISSIONS for them (DOS-166).
    this.registry.register('sales_orders', (tx, op) => applyOrderSync(tx, op, this.orders), {
      standsFor: ['orders.create'],
    })
    this.registry.register('sales_order_lines', (tx, op) => applyLineSync(tx, op, this.orders), {
      standsFor: ['orders.setLines'],
    })
    // The device read set (docs/23 §8.11): a rep pulls its own orders (90 days), the desk everything.
    const ninetyDays = sql`created_at > now() - interval '90 days'`
    /*
     * THE SHOP'S COPY CARRIES NEITHER OFFICE-ONLY FACT (DOS-078 (b), DOS-081 (e)). `toOrder(row,
     * office)` blanks both on the oRPC path, but the shop holds `sales_orders` on its device too and
     * `tablePull` is `select *`: without this the shopkeeper's phone would hold the godown's shortfall
     * and — worse — its own credit limit, outstanding and headroom, which ADR 0006 and the founder's
     * answer to DOS-100 say never reach it. QA DOS-072 is the same shape on `retailers`, and its note
     * stands: "no screen draws it" is not the same as "it is not on the phone". The rep keeps both —
     * it warns against the limit offline and tells the shopkeeper what the godown could not fill. The
     * manifest is built from this same `omit`, so a device that held the columns re-snapshots on the
     * new schema hash instead of keeping a stale copy.
     */
    const OFFICE_ONLY = ['stock_shortages', 'credit_notice']
    this.registry.registerPull(
      'sales_orders',
      tablePull(salesOrders, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson'
            ? sql`salesperson_id = ${r.ctx.actorId} and ${ninetyDays}`
            : ninetyDays,
        omit: (role) => (role === 'retailer' ? OFFICE_ONLY : []),
      }),
    )
    this.registry.registerPull(
      'sales_order_lines',
      tablePull(salesOrderLines, {
        extra: (r) =>
          r.ctx.actorRole === 'salesperson'
            ? sql`order_id in (select o.id from sales_orders o where o.tenant_id = ${r.ctx.tenantId} and o.salesperson_id = ${r.ctx.actorId} and o.created_at > now() - interval '90 days')`
            : undefined,
      }),
    )
  }
}
