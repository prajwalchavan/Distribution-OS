import { Module } from '@nestjs/common'
import { DeliveryModule } from '../delivery/index.js'
import { OrdersModule } from '../orders/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { AiController } from './ai.controller.js'
import { DraftsService } from './drafts.service.js'
import { ForecastService } from './forecast.service.js'
import { IntakeService } from './intake.service.js'
import { RoutingService } from './routing.service.js'

/**
 * The `ai` module (module 12, founder decision 2026-09-05 in docs/22 §8: every AI feature ships in
 * v1). Four surfaces, one rule: NOTHING HERE DECIDES ANYTHING.
 *
 *   intake     a WhatsApp message, a typed list or a voice note becomes a DRAFT order.
 *   drafts     the queue, and the one confirm that turns a draft into a real sales order.
 *   forecast   reorder suggestions for purchase planning: pieces and days of cover, no money.
 *   routing    a proposed stop sequence for one trip, applied only through delivery's own reorder.
 *
 * It owns `ai_order_drafts`, `ai_forecasts` and `route_plans` and writes nothing else. The two
 * writes that reach the rest of the business go through another module's exported service — coordination
 * §4's edges `ai → orders` (`insertDraft` / `writeLines` / `submitInTx`) and `ai → delivery`
 * (`tripForRouting` / `routingStops` / `reorderStopsInTx` / `stopsOfTrip`) — so the price engine, the
 * credit verdict, the approval queue and the stop state machine all run unchanged.
 *
 * MOUNTED ON (docs/22 §2, the six role services): owner :3001, manager :3002, sales :3003,
 * warehouse :3004, delivery :3005 and retailer :3006. Never on auth :3000. The permission matrix
 * then decides per procedure: only the desk, a rep and a shop take drafts; only the desk queues a
 * forecast and only the desk and the godown read one; only the desk and the crew sequence a trip.
 *
 * NO SYNC HANDLERS. A draft is captured online (a voice note needs the recording uploaded first) and
 * the confirmed order enters the offline queue as an ORDER, through `modules/orders`' own handlers.
 * Nothing here registers with `SyncRegistry`.
 */
@Module({
  imports: [TenancyModule, OrdersModule, DeliveryModule],
  controllers: [AiController],
  providers: [IntakeService, DraftsService, ForecastService, RoutingService],
  exports: [IntakeService, DraftsService, ForecastService, RoutingService],
})
export class AiModule {}
