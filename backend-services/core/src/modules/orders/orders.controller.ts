import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { ApprovalsService } from './approvals.service.js'
import { OrdersService } from './orders.service.js'

@Controller()
@UseGuards(TenantGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Implement(contract.orders.create)
  create(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.create).handler(({ input }) => this.orders.create(input))
  }

  @Implement(contract.orders.setLines)
  setLines(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.setLines).handler(({ input }) => this.orders.setLines(input))
  }

  @Implement(contract.orders.repeatLast)
  repeatLast(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.repeatLast).handler(({ input }) =>
      this.orders.repeatLast(input),
    )
  }

  @Implement(contract.orders.submit)
  submit(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.submit).handler(({ input }) => this.orders.submit(input))
  }

  @Implement(contract.orders.confirm)
  confirm(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.confirm).handler(({ input }) => this.orders.confirm(input))
  }

  @Implement(contract.orders.cancel)
  cancel(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.cancel).handler(({ input }) => this.orders.cancel(input))
  }

  @Implement(contract.orders.get)
  get(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.get).handler(({ input }) => this.orders.get(input))
  }

  @Implement(contract.orders.list)
  list(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.list).handler(({ input }) => this.orders.list(input))
  }

  @Implement(contract.orders.approvals.list)
  listApprovals(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.approvals.list).handler(({ input }) =>
      this.approvals.list(input),
    )
  }

  @Implement(contract.orders.approvals.decide)
  decideApproval(@OwnsReply() _reply: unknown) {
    return implement(contract.orders.approvals.decide).handler(({ input }) =>
      this.approvals.decide(input),
    )
  }
}
