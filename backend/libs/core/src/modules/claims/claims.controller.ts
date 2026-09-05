import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { ClaimsService } from './claims.service.js'
import { ClaimReportsService } from './reports.service.js'

/**
 * `/claims/*`. The static siblings (`/claims/policies`, `/periods`, `/ageing`, `/register`,
 * `/reconcile`) are declared before `GET /claims/{id}`, in the contract's order.
 */
@Controller()
@UseGuards(TenantGuard)
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly reports: ClaimReportsService,
  ) {}

  @Implement(contract.claims.policies.list)
  listPolicies(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.policies.list).handler(({ input }) =>
      this.claims.listPolicies(input),
    )
  }

  @Implement(contract.claims.policies.upsert)
  upsertPolicy(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.policies.upsert).handler(({ input }) =>
      this.claims.upsertPolicy(input),
    )
  }

  @Implement(contract.claims.periods.list)
  listPeriods(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.periods.list).handler(({ input }) =>
      this.claims.listPeriods(input),
    )
  }

  @Implement(contract.claims.ageing)
  ageing(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.ageing).handler(({ input }) => this.reports.ageing(input))
  }

  @Implement(contract.claims.register)
  register(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.register).handler(({ input }) => this.reports.register(input))
  }

  @Implement(contract.claims.reconcile.suggest)
  reconcile(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.reconcile.suggest).handler(({ input }) =>
      this.reports.reconcile(input),
    )
  }

  @Implement(contract.claims.open)
  open(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.open).handler(({ input }) => this.claims.open(input))
  }

  @Implement(contract.claims.list)
  list(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.list).handler(({ input }) => this.claims.list(input))
  }

  @Implement(contract.claims.get)
  get(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.get).handler(({ input }) => this.claims.get(input))
  }

  @Implement(contract.claims.build)
  build(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.build).handler(({ input }) => this.claims.build(input))
  }

  @Implement(contract.claims.lines.list)
  listLines(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.lines.list).handler(({ input }) =>
      this.claims.listLines(input),
    )
  }

  @Implement(contract.claims.lines.add)
  addLine(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.lines.add).handler(({ input }) => this.claims.addLine(input))
  }

  @Implement(contract.claims.lines.adjust)
  adjustLine(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.lines.adjust).handler(({ input }) =>
      this.claims.adjustLine(input),
    )
  }

  @Implement(contract.claims.lines.remove)
  removeLine(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.lines.remove).handler(({ input }) =>
      this.claims.removeLine(input),
    )
  }

  @Implement(contract.claims.evidence.attach)
  attachEvidence(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.evidence.attach).handler(({ input }) =>
      this.claims.attachEvidence(input),
    )
  }

  @Implement(contract.claims.submit)
  submit(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.submit).handler(({ input }) => this.claims.submit(input))
  }

  @Implement(contract.claims.acknowledge)
  acknowledge(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.acknowledge).handler(({ input }) =>
      this.claims.acknowledge(input),
    )
  }

  @Implement(contract.claims.settlements.record)
  recordSettlement(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.settlements.record).handler(({ input }) =>
      this.claims.recordSettlement(input),
    )
  }

  @Implement(contract.claims.reject)
  reject(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.reject).handler(({ input }) => this.claims.reject(input))
  }

  @Implement(contract.claims.writeOff)
  writeOff(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.writeOff).handler(({ input }) => this.claims.writeOff(input))
  }

  @Implement(contract.claims.cancel)
  cancel(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.cancel).handler(({ input }) => this.claims.cancel(input))
  }

  @Implement(contract.claims.statements.generate)
  generateStatement(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.statements.generate).handler(({ input }) =>
      this.claims.generateStatement(input),
    )
  }

  @Implement(contract.claims.statements.list)
  listStatements(@OwnsReply() _reply: unknown) {
    return implement(contract.claims.statements.list).handler(({ input }) =>
      this.claims.listStatements(input),
    )
  }
}
