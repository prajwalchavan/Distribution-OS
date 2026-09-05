import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { RetailersService } from './retailers.service.js'

@Controller()
@UseGuards(TenantGuard)
export class RetailersController {
  constructor(private readonly svc: RetailersService) {}

  @Implement(contract.retailers.list)
  list(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.list).handler(({ input }) => this.svc.list(input))
  }

  @Implement(contract.retailers.get)
  get(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.get).handler(({ input }) => this.svc.get(input))
  }

  @Implement(contract.retailers.upsert)
  upsert(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.upsert).handler(({ input }) => this.svc.upsert(input))
  }

  @Implement(contract.retailers.updateOwn)
  updateOwn(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.updateOwn).handler(({ input }) => this.svc.updateOwn(input))
  }

  @Implement(contract.retailers.setCredit)
  setCredit(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.setCredit).handler(({ input }) => this.svc.setCredit(input))
  }

  @Implement(contract.retailers.linkIdentity)
  linkIdentity(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.linkIdentity).handler(({ input }) =>
      this.svc.linkIdentity(input),
    )
  }

  @Implement(contract.retailers.beats.list)
  listBeats(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.beats.list).handler(({ input }) =>
      this.svc.listBeats(input),
    )
  }

  @Implement(contract.retailers.beats.upsert)
  upsertBeat(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.beats.upsert).handler(({ input }) =>
      this.svc.upsertBeat(input),
    )
  }

  @Implement(contract.retailers.beats.assign)
  assignBeat(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.beats.assign).handler(({ input }) =>
      this.svc.assignBeat(input),
    )
  }

  @Implement(contract.retailers.beats.assignments.list)
  listAssignments(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.beats.assignments.list).handler(({ input }) =>
      this.svc.listAssignments(input),
    )
  }

  @Implement(contract.retailers.visits.record)
  recordVisit(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.visits.record).handler(({ input }) =>
      this.svc.recordVisit(input),
    )
  }

  @Implement(contract.retailers.visits.list)
  listVisits(@OwnsReply() _reply: unknown) {
    return implement(contract.retailers.visits.list).handler(({ input }) =>
      this.svc.listVisits(input),
    )
  }
}
