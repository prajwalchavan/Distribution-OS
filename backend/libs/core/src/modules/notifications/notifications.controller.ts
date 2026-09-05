import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { BroadcastsService } from './broadcasts.service.js'
import { InboundService } from './inbound.service.js'
import { MessagesService } from './messages.service.js'
import { PushTokensService } from './push-tokens.service.js'
import { TemplatesService } from './templates.service.js'

@Controller()
@UseGuards(TenantGuard)
export class NotificationsController {
  constructor(
    private readonly messages: MessagesService,
    private readonly templates: TemplatesService,
    private readonly broadcasts: BroadcastsService,
    private readonly pushTokens: PushTokensService,
    private readonly inbound: InboundService,
  ) {}

  @Implement(contract.notifications.messages.list)
  listMessages(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.messages.list).handler(({ input }) =>
      this.messages.list(input),
    )
  }

  @Implement(contract.notifications.messages.get)
  getMessage(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.messages.get).handler(({ input }) =>
      this.messages.get(input),
    )
  }

  @Implement(contract.notifications.messages.send)
  sendMessage(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.messages.send).handler(({ input }) =>
      this.messages.send(input),
    )
  }

  @Implement(contract.notifications.messages.resend)
  resendMessage(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.messages.resend).handler(({ input }) =>
      this.messages.resend(input),
    )
  }

  @Implement(contract.notifications.messages.markRead)
  markRead(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.messages.markRead).handler(({ input }) =>
      this.messages.markRead(input),
    )
  }

  @Implement(contract.notifications.templates.list)
  listTemplates(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.templates.list).handler(({ input }) =>
      this.templates.list(input),
    )
  }

  @Implement(contract.notifications.templates.upsert)
  upsertTemplate(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.templates.upsert).handler(({ input }) =>
      this.templates.upsert(input),
    )
  }

  @Implement(contract.notifications.broadcasts.create)
  createBroadcast(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.broadcasts.create).handler(({ input }) =>
      this.broadcasts.create(input),
    )
  }

  @Implement(contract.notifications.broadcasts.list)
  listBroadcasts(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.broadcasts.list).handler(({ input }) =>
      this.broadcasts.list(input),
    )
  }

  @Implement(contract.notifications.broadcasts.get)
  getBroadcast(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.broadcasts.get).handler(({ input }) =>
      this.broadcasts.get(input),
    )
  }

  @Implement(contract.notifications.pushTokens.register)
  registerPushToken(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.pushTokens.register).handler(({ input }) =>
      this.pushTokens.register(input),
    )
  }

  @Implement(contract.notifications.pushTokens.unregister)
  unregisterPushToken(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.pushTokens.unregister).handler(({ input }) =>
      this.pushTokens.unregister(input),
    )
  }

  @Implement(contract.notifications.inbound.list)
  listInbound(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.inbound.list).handler(({ input }) =>
      this.inbound.list(input),
    )
  }

  @Implement(contract.notifications.inbound.markHandled)
  markInboundHandled(@OwnsReply() _reply: unknown) {
    return implement(contract.notifications.inbound.markHandled).handler(({ input }) =>
      this.inbound.markHandled(input),
    )
  }
}
