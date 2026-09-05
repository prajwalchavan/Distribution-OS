import { Module } from '@nestjs/common'
import { RetailersModule } from '../retailers/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { BroadcastsService } from './broadcasts.service.js'
import { InboundService } from './inbound.service.js'
import { MessagesService } from './messages.service.js'
import { NotificationsController } from './notifications.controller.js'
import { PushTokensService } from './push-tokens.service.js'
import { TemplatesService } from './templates.service.js'

/**
 * Notifications (docs/plans/notifications.md, coordination §1 slot 8): every WhatsApp template, SMS,
 * push and in-app notice the platform sends is ONE `messages` row, queued in the same transaction as
 * its trigger and dispatched later by the worker (`@dos/core/notifications`), retried with backoff
 * and metered by cost. Owns `templates`, `messages`, `broadcasts`, `whatsapp_windows`,
 * `inbound_messages`, `push_tokens`. Calls out only to `RetailersService.contactPreferences`
 * (coordination §4) and to tenancy's white-label block; it is called by nobody's write path — every
 * automatic send arrives as an outbox event whose payload is the whole source of the text.
 *
 * Mounted on all six role services (coordination §6): the whole surface for the owner and the
 * manager / accountant, the inbox and push token for the rest, the shop's own inbox on retailer-service.
 */
@Module({
  imports: [TenancyModule, RetailersModule],
  controllers: [NotificationsController],
  providers: [
    MessagesService,
    TemplatesService,
    BroadcastsService,
    PushTokensService,
    InboundService,
  ],
  exports: [MessagesService, TemplatesService, BroadcastsService],
})
export class NotificationsModule {}
