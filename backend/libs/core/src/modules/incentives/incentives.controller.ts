import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { StatementsService } from './statements.service.js'
import { TargetsService } from './targets.service.js'

const c = contract.incentives

/**
 * The fourteen incentives procedures. Every method takes `@OwnsReply() _reply: unknown` because oRPC
 * writes the Fastify reply itself; without it Nest replies twice.
 *
 * Roles live in the services (`requireRole`) and in `permissions.ts`, never here — the guard refuses
 * an undeclared route before any handler runs, and `TenantGuard` 403s a role this service does not
 * serve before that.
 */
@Controller()
@UseGuards(TenantGuard)
export class IncentivesController {
  constructor(
    private readonly targets: TargetsService,
    private readonly statements: StatementsService,
  ) {}

  @Implement(c.targets.upsert)
  upsertTarget(@OwnsReply() _reply: unknown) {
    return implement(c.targets.upsert).handler(({ input }) => this.targets.upsert(input))
  }

  @Implement(c.targets.bulkAssign)
  bulkAssignTargets(@OwnsReply() _reply: unknown) {
    return implement(c.targets.bulkAssign).handler(({ input }) => this.targets.bulkAssign(input))
  }

  @Implement(c.targets.whatIf)
  targetWhatIf(@OwnsReply() _reply: unknown) {
    return implement(c.targets.whatIf).handler(({ input }) => this.targets.whatIf(input))
  }

  @Implement(c.targets.get)
  getTarget(@OwnsReply() _reply: unknown) {
    return implement(c.targets.get).handler(({ input }) => this.targets.get(input))
  }

  @Implement(c.targets.list)
  listTargets(@OwnsReply() _reply: unknown) {
    return implement(c.targets.list).handler(({ input }) => this.targets.list(input))
  }

  @Implement(c.targets.remove)
  removeTarget(@OwnsReply() _reply: unknown) {
    return implement(c.targets.remove).handler(({ input }) => this.targets.remove(input))
  }

  @Implement(c.targets.refresh)
  refreshTarget(@OwnsReply() _reply: unknown) {
    return implement(c.targets.refresh).handler(({ input }) => this.targets.refresh(input))
  }

  @Implement(c.progress.mine)
  myProgress(@OwnsReply() _reply: unknown) {
    return implement(c.progress.mine).handler(({ input }) => this.targets.mine(input))
  }

  @Implement(c.progress.team)
  teamProgress(@OwnsReply() _reply: unknown) {
    return implement(c.progress.team).handler(({ input }) => this.targets.team(input))
  }

  @Implement(c.statements.compute)
  computeStatement(@OwnsReply() _reply: unknown) {
    return implement(c.statements.compute).handler(({ input }) => this.statements.compute(input))
  }

  @Implement(c.statements.approve)
  approveStatement(@OwnsReply() _reply: unknown) {
    return implement(c.statements.approve).handler(({ input }) => this.statements.approve(input))
  }

  @Implement(c.statements.reopen)
  reopenStatement(@OwnsReply() _reply: unknown) {
    return implement(c.statements.reopen).handler(({ input }) => this.statements.reopen(input))
  }

  @Implement(c.statements.get)
  getStatement(@OwnsReply() _reply: unknown) {
    return implement(c.statements.get).handler(({ input }) => this.statements.get(input))
  }

  @Implement(c.statements.list)
  listStatements(@OwnsReply() _reply: unknown) {
    return implement(c.statements.list).handler(({ input }) => this.statements.list(input))
  }
}
