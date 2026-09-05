import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { LoadSheetsService } from './load-sheets.service.js'
import { PackingService } from './packing.service.js'
import { PicklistsService } from './picklists.service.js'

/**
 * Contract-first oRPC (docs/16 §3). Every method takes `@OwnsReply() _reply: unknown`: oRPC writes the
 * Fastify reply itself, and without the parameter Nest replies a second time.
 */
@Controller()
@UseGuards(TenantGuard)
export class WarehouseController {
  constructor(
    private readonly picklists: PicklistsService,
    private readonly packing: PackingService,
    private readonly loadSheets: LoadSheetsService,
  ) {}

  @Implement(contract.warehouse.queue.list)
  queue(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.queue.list).handler(({ input }) =>
      this.picklists.queue(input),
    )
  }

  @Implement(contract.warehouse.picklists.create)
  createPicklist(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.create).handler(({ input }) =>
      this.picklists.create(input),
    )
  }

  @Implement(contract.warehouse.picklists.list)
  listPicklists(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.list).handler(({ input }) =>
      this.picklists.list(input),
    )
  }

  @Implement(contract.warehouse.picklists.get)
  getPicklist(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.get).handler(({ input }) =>
      this.picklists.get(input),
    )
  }

  @Implement(contract.warehouse.picklists.start)
  startPicklist(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.start).handler(({ input }) =>
      this.picklists.start(input),
    )
  }

  @Implement(contract.warehouse.picklists.pick)
  recordPick(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.pick).handler(({ input }) =>
      this.picklists.pick(input),
    )
  }

  @Implement(contract.warehouse.picklists.cancel)
  cancelPicklist(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.picklists.cancel).handler(({ input }) =>
      this.picklists.cancel(input),
    )
  }

  @Implement(contract.warehouse.packs.confirm)
  confirmPack(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.packs.confirm).handler(({ input }) =>
      this.packing.confirm(input),
    )
  }

  @Implement(contract.warehouse.packs.list)
  listPacks(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.packs.list).handler(({ input }) => this.packing.list(input))
  }

  @Implement(contract.warehouse.packs.get)
  getPack(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.packs.get).handler(({ input }) => this.packing.get(input))
  }

  @Implement(contract.warehouse.loadSheets.create)
  createLoadSheet(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.loadSheets.create).handler(({ input }) =>
      this.loadSheets.create(input),
    )
  }

  @Implement(contract.warehouse.loadSheets.list)
  listLoadSheets(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.loadSheets.list).handler(({ input }) =>
      this.loadSheets.list(input),
    )
  }

  @Implement(contract.warehouse.loadSheets.get)
  getLoadSheet(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.loadSheets.get).handler(({ input }) =>
      this.loadSheets.get(input),
    )
  }

  @Implement(contract.warehouse.loadSheets.confirm)
  confirmLoadSheet(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.loadSheets.confirm).handler(({ input }) =>
      this.loadSheets.confirm(input),
    )
  }

  @Implement(contract.warehouse.loadSheets.cancel)
  cancelLoadSheet(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.loadSheets.cancel).handler(({ input }) =>
      this.loadSheets.cancel(input),
    )
  }

  @Implement(contract.warehouse.challans.list)
  listChallans(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.challans.list).handler(({ input }) =>
      this.loadSheets.listChallans(input),
    )
  }

  @Implement(contract.warehouse.challans.get)
  getChallan(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.challans.get).handler(({ input }) =>
      this.loadSheets.getChallan(input),
    )
  }

  @Implement(contract.warehouse.challans.recordEwb)
  recordEwb(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.challans.recordEwb).handler(({ input }) =>
      this.loadSheets.recordEwb(input),
    )
  }

  @Implement(contract.warehouse.reservations.list)
  listReservations(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.reservations.list).handler(({ input }) =>
      this.picklists.listReservations(input),
    )
  }

  @Implement(contract.warehouse.reservations.release)
  releaseReservations(@OwnsReply() _reply: unknown) {
    return implement(contract.warehouse.reservations.release).handler(({ input }) =>
      this.picklists.releaseReservations(input),
    )
  }
}
