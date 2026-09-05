import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { DraftsService } from './drafts.service.js'
import { ForecastService } from './forecast.service.js'
import { IntakeService } from './intake.service.js'
import { RoutingService } from './routing.service.js'

const ai = contract.ai

/** The four assistive surfaces. Every one answers advice; none of them decides anything. */
@Controller()
@UseGuards(TenantGuard)
export class AiController {
  constructor(
    private readonly intake: IntakeService,
    private readonly drafts: DraftsService,
    private readonly forecast: ForecastService,
    private readonly routing: RoutingService,
  ) {}

  @Implement(ai.intake.parseText)
  parseText(@OwnsReply() _reply: unknown) {
    return implement(ai.intake.parseText).handler(({ input }) => this.intake.parseText(input))
  }

  @Implement(ai.intake.transcribe)
  transcribe(@OwnsReply() _reply: unknown) {
    return implement(ai.intake.transcribe).handler(({ input }) => this.intake.transcribe(input))
  }

  @Implement(ai.drafts.list)
  listDrafts(@OwnsReply() _reply: unknown) {
    return implement(ai.drafts.list).handler(({ input }) => this.drafts.list(input))
  }

  @Implement(ai.drafts.get)
  getDraft(@OwnsReply() _reply: unknown) {
    return implement(ai.drafts.get).handler(({ input }) => this.drafts.get(input))
  }

  @Implement(ai.drafts.confirm)
  confirmDraft(@OwnsReply() _reply: unknown) {
    return implement(ai.drafts.confirm).handler(({ input }) => this.drafts.confirm(input))
  }

  @Implement(ai.drafts.reject)
  rejectDraft(@OwnsReply() _reply: unknown) {
    return implement(ai.drafts.reject).handler(({ input }) => this.drafts.reject(input))
  }

  @Implement(ai.forecast.run)
  runForecast(@OwnsReply() _reply: unknown) {
    return implement(ai.forecast.run).handler(({ input }) => this.forecast.run(input))
  }

  @Implement(ai.forecast.list)
  listForecast(@OwnsReply() _reply: unknown) {
    return implement(ai.forecast.list).handler(({ input }) => this.forecast.list(input))
  }

  @Implement(ai.routing.plan)
  planRoute(@OwnsReply() _reply: unknown) {
    return implement(ai.routing.plan).handler(({ input }) => this.routing.plan(input))
  }

  @Implement(ai.routing.get)
  getRoutePlan(@OwnsReply() _reply: unknown) {
    return implement(ai.routing.get).handler(({ input }) => this.routing.get(input))
  }

  @Implement(ai.routing.apply)
  applyRoutePlan(@OwnsReply() _reply: unknown) {
    return implement(ai.routing.apply).handler(({ input }) => this.routing.apply(input))
  }
}
