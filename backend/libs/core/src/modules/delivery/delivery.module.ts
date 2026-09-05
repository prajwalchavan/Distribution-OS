import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { BillingModule } from '../billing/index.js'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncRegistry } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { CollectionsService } from './collections.service.js'
import { DeliveriesService } from './deliveries.service.js'
import { DeliveryController } from './delivery.controller.js'
import {
  applyCollectionSync,
  applyDeliverySync,
  applyExpenseSync,
  applyPodSync,
  applyStopSync,
} from './delivery.sync.js'
import { GpsService } from './gps.service.js'
import { SettlementService } from './settlement.service.js'
import { TripsService } from './trips.service.js'
import { VanSalesService } from './vansales.service.js'
import { VehiclesService } from './vehicles.service.js'

/**
 * The physical last mile (ADR 0013: a vehicle IS a stock location): vehicles, trips, stops, the
 * doorstep record with its proof, doorstep money, van sales, expenses, the check-in settlement and the
 * GPS breadcrumbs. It is the only module that writes the eleven delivery tables and the crew's
 * `location_consents`, and it reaches everything else through a module's `index.ts` (coordination §4):
 * `OrdersService` for the order aggregate, `InventoryService` for every piece, `BillingService` /
 * `CreditNotesService` for the van-sale bill and the doorstep credit note, `ReceivablesService` for
 * every rupee, `LoadSheetsService` for "is the load out of the godown".
 *
 * Every dependency is HARD (never `@Optional()`): by the build order they all exist, and a delivery
 * module that could not bill a van sale or post a receipt would quietly record money nobody booked.
 *
 * The delivery phone works offline before the pilot, so the module registers sync handlers for
 * `trip_stops`, `deliveries` (lines and proof inline), `pod_evidence`, `collections` and
 * `trip_expenses`. `trip_points` is deliberately not one of them (ADR 0012). `SyncRegistry` is
 * optional so a spec may boot this module without `SyncModule`.
 */
@Module({
  imports: [
    TenancyModule,
    OrdersModule,
    InventoryModule,
    BillingModule,
    ReceivablesModule,
    WarehouseModule,
  ],
  controllers: [DeliveryController],
  providers: [
    VehiclesService,
    TripsService,
    DeliveriesService,
    CollectionsService,
    VanSalesService,
    SettlementService,
    GpsService,
  ],
  exports: [TripsService, DeliveriesService, CollectionsService, SettlementService],
})
export class DeliveryModule implements OnModuleInit {
  constructor(
    private readonly trips: TripsService,
    private readonly deliveries: DeliveriesService,
    private readonly collections: CollectionsService,
    @Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null,
  ) {}

  onModuleInit(): void {
    if (!this.registry) return
    this.registry.register('trip_stops', (tx, op) => applyStopSync(tx, op, this.trips))
    this.registry.register('deliveries', (tx, op) => applyDeliverySync(tx, op, this.deliveries))
    this.registry.register('pod_evidence', (tx, op) => applyPodSync(tx, op, this.deliveries))
    this.registry.register('collections', (tx, op) => applyCollectionSync(tx, op, this.collections))
    this.registry.register('trip_expenses', (tx, op) => applyExpenseSync(tx, op, this.collections))
  }
}
