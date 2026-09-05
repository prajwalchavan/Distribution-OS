import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { CollectionsService } from './collections.service.js'
import { DeliveriesService } from './deliveries.service.js'
import { GpsService } from './gps.service.js'
import { SettlementService } from './settlement.service.js'
import { TripsService } from './trips.service.js'
import { VanSalesService } from './vansales.service.js'
import { VehiclesService } from './vehicles.service.js'

const d = contract.delivery

@Controller()
@UseGuards(TenantGuard)
export class DeliveryController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly trips: TripsService,
    private readonly deliveries: DeliveriesService,
    private readonly collections: CollectionsService,
    private readonly vanSales: VanSalesService,
    private readonly settlement: SettlementService,
    private readonly gps: GpsService,
  ) {}

  // vehicles + consents

  @Implement(d.vehicles.list)
  listVehicles(@OwnsReply() _reply: unknown) {
    return implement(d.vehicles.list).handler(({ input }) => this.vehicles.list(input))
  }

  @Implement(d.vehicles.upsert)
  upsertVehicle(@OwnsReply() _reply: unknown) {
    return implement(d.vehicles.upsert).handler(({ input }) => this.vehicles.upsert(input))
  }

  @Implement(d.vehicles.positions)
  vehiclePositions(@OwnsReply() _reply: unknown) {
    return implement(d.vehicles.positions).handler(({ input }) => this.vehicles.positions(input))
  }

  @Implement(d.consents.grant)
  grantConsent(@OwnsReply() _reply: unknown) {
    return implement(d.consents.grant).handler(({ input }) => this.vehicles.grantConsent(input))
  }

  @Implement(d.consents.get)
  getConsent(@OwnsReply() _reply: unknown) {
    return implement(d.consents.get).handler(({ input }) => this.vehicles.getConsent(input))
  }

  // trips

  @Implement(d.trips.create)
  createTrip(@OwnsReply() _reply: unknown) {
    return implement(d.trips.create).handler(({ input }) => this.trips.create(input))
  }

  @Implement(d.trips.list)
  listTrips(@OwnsReply() _reply: unknown) {
    return implement(d.trips.list).handler(({ input }) => this.trips.list(input))
  }

  @Implement(d.trips.get)
  getTrip(@OwnsReply() _reply: unknown) {
    return implement(d.trips.get).handler(({ input }) => this.trips.get(input))
  }

  @Implement(d.trips.startLoading)
  startLoading(@OwnsReply() _reply: unknown) {
    return implement(d.trips.startLoading).handler(({ input }) => this.trips.startLoading(input))
  }

  @Implement(d.trips.depart)
  depart(@OwnsReply() _reply: unknown) {
    return implement(d.trips.depart).handler(({ input }) => this.trips.depart(input))
  }

  @Implement(d.trips.return)
  returnTrip(@OwnsReply() _reply: unknown) {
    return implement(d.trips.return).handler(({ input }) => this.trips.return(input))
  }

  @Implement(d.trips.cancel)
  cancelTrip(@OwnsReply() _reply: unknown) {
    return implement(d.trips.cancel).handler(({ input }) => this.trips.cancel(input))
  }

  @Implement(d.trips.settlementPreview)
  settlementPreview(@OwnsReply() _reply: unknown) {
    return implement(d.trips.settlementPreview).handler(({ input }) =>
      this.settlement.preview(input),
    )
  }

  @Implement(d.trips.settle)
  settle(@OwnsReply() _reply: unknown) {
    return implement(d.trips.settle).handler(({ input }) => this.settlement.settle(input))
  }

  // stops

  @Implement(d.stops.list)
  listStops(@OwnsReply() _reply: unknown) {
    return implement(d.stops.list).handler(({ input }) => this.trips.listStops(input))
  }

  @Implement(d.stops.next)
  nextStop(@OwnsReply() _reply: unknown) {
    return implement(d.stops.next).handler(({ input }) => this.trips.nextStop(input))
  }

  @Implement(d.stops.add)
  addStop(@OwnsReply() _reply: unknown) {
    return implement(d.stops.add).handler(({ input }) => this.trips.addStop(input))
  }

  @Implement(d.stops.reorder)
  reorderStops(@OwnsReply() _reply: unknown) {
    return implement(d.stops.reorder).handler(({ input }) => this.trips.reorderStops(input))
  }

  @Implement(d.stops.start)
  startStop(@OwnsReply() _reply: unknown) {
    return implement(d.stops.start).handler(({ input }) => this.trips.startStop(input))
  }

  @Implement(d.stops.arrive)
  arriveStop(@OwnsReply() _reply: unknown) {
    return implement(d.stops.arrive).handler(({ input }) => this.trips.arriveStop(input))
  }

  @Implement(d.stops.fail)
  failStop(@OwnsReply() _reply: unknown) {
    return implement(d.stops.fail).handler(({ input }) => this.trips.failStop(input))
  }

  // deliveries

  @Implement(d.deliveries.record)
  recordDelivery(@OwnsReply() _reply: unknown) {
    return implement(d.deliveries.record).handler(({ input }) => this.deliveries.record(input))
  }

  @Implement(d.deliveries.addPod)
  addPod(@OwnsReply() _reply: unknown) {
    return implement(d.deliveries.addPod).handler(({ input }) => this.deliveries.addPod(input))
  }

  @Implement(d.deliveries.list)
  listDeliveries(@OwnsReply() _reply: unknown) {
    return implement(d.deliveries.list).handler(({ input }) => this.deliveries.list(input))
  }

  @Implement(d.deliveries.get)
  getDelivery(@OwnsReply() _reply: unknown) {
    return implement(d.deliveries.get).handler(({ input }) => this.deliveries.get(input))
  }

  // money

  @Implement(d.collections.record)
  recordCollection(@OwnsReply() _reply: unknown) {
    return implement(d.collections.record).handler(({ input }) => this.collections.record(input))
  }

  @Implement(d.collections.list)
  listCollections(@OwnsReply() _reply: unknown) {
    return implement(d.collections.list).handler(({ input }) => this.collections.list(input))
  }

  @Implement(d.vanSales.create)
  createVanSale(@OwnsReply() _reply: unknown) {
    return implement(d.vanSales.create).handler(({ input }) => this.vanSales.create(input))
  }

  @Implement(d.expenses.record)
  recordExpense(@OwnsReply() _reply: unknown) {
    return implement(d.expenses.record).handler(({ input }) =>
      this.collections.recordExpense(input),
    )
  }

  @Implement(d.expenses.list)
  listExpenses(@OwnsReply() _reply: unknown) {
    return implement(d.expenses.list).handler(({ input }) => this.collections.listExpenses(input))
  }

  // gps

  @Implement(d.gps.points)
  gpsPoints(@OwnsReply() _reply: unknown) {
    return implement(d.gps.points).handler(({ input }) => this.gps.points(input))
  }

  @Implement(d.gps.trace)
  gpsTrace(@OwnsReply() _reply: unknown) {
    return implement(d.gps.trace).handler(({ input }) => this.gps.trace(input))
  }
}
