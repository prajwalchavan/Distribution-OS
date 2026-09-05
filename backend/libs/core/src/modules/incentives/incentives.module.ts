import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { IncentivesController } from './incentives.controller.js'
import { StatementsService } from './statements.service.js'
import { TargetsService } from './targets.service.js'

/**
 * Incentives (docs/plans/incentives.md, coordination §1 slot 10 — the leaf of the module chain).
 * Owns `targets`, `achievements` and `computed_payouts`; nothing else writes them, and it writes
 * nothing else.
 *
 * NO MODULE IMPORTS BEYOND TENANCY. The three aggregates it reads — `salesAggregate` (orders),
 * `visitCount` (retailers), `collectedByUser` (receivables) — are PLAIN EXPORTED FUNCTIONS taken
 * through each module's `index.ts` (coordination §3.9 / §4), not injected services: the achievement
 * sweep runs in the pg-boss worker, where tsx emits no `design:paramtypes` and a Nest container
 * would hand every constructor `undefined`. So there is no `OrdersModule` / `ReceivablesModule` /
 * `RetailersModule` in this provider graph at all, and mounting incentives on a service costs
 * nothing but its own two providers.
 *
 * MOUNTED ON (coordination §6): owner :3001, manager :3002 (manager + accountant), sales :3003,
 * delivery :3005. NOT warehouse and NOT retailer — no procedure names either role, so the key there
 * would be dead surface a guard already refuses.
 *
 * NO SYNC HANDLERS. Every write is an online desk action and every rep-facing procedure is a read,
 * so nothing registers with `SyncRegistry` (brief §7).
 */
@Module({
  imports: [TenancyModule],
  controllers: [IncentivesController],
  providers: [TargetsService, StatementsService],
  exports: [TargetsService, StatementsService],
})
export class IncentivesModule {}
