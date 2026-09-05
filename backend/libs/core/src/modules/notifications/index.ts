/**
 * Notifications' only entry point (`eslint-plugin-boundaries`). What later modules and the worker import:
 *
 *   reporting (9)   nothing yet (messaging spend is a later dashboard figure)
 *   worker          `worker.ts` (via `@dos/core/notifications`) — the outbox translators, the dispatch
 *                   sweep, the two daily sweeps' per-shop work and the provider factory, no Nest DI
 */
export { NotificationsModule } from './notifications.module.js'
export { MessagesService } from './messages.service.js'
export { TemplatesService } from './templates.service.js'
export { BroadcastsService } from './broadcasts.service.js'
export { PushTokensService } from './push-tokens.service.js'
export { InboundService } from './inbound.service.js'
export {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  retryBackoffMs,
  DISPATCH_BATCH,
  MAX_BROADCAST_RECIPIENTS,
  DUES_REMINDER_COOLDOWN_DAYS,
  FALLBACK_LOCALE,
  PAYLOAD_KEYS,
  normalizeLocale,
  resolveLocale,
  resolveTemplate,
  templateTokens,
  renderTemplate,
  missingVariables,
  buildPayload,
  insertMessage,
  queueShopMessage,
  queueStaffNotice,
  shopDestination,
  senderIdentity,
  rupees,
  upiPayLink,
  type Locale,
  type MessageRow,
  type TemplateRow,
  type QueueMessageInput,
  type ShopMessageRequest,
  type ShopMessageOutcome,
  type ShopChannel,
  type SkipReason,
  type SenderIdentity,
} from './notifications.internals.js'
export {
  NOTIFICATION_EVENT_TYPES,
  handleNotificationEvent,
  queueDeliveryToday,
  queueDuesReminders,
  asTenantSystem,
  type NotificationEvent,
  type NotificationEventType,
  type HandledEvent,
} from './events.js'
export {
  dispatchDueMessages,
  refreshBroadcastCounters,
  providerRequest,
  type DispatchOptions,
  type DispatchResult,
} from './dispatch.js'
export {
  createProviders,
  stubProviders,
  StubProvider,
  STUB_COST_PAISE,
  stubMessageId,
  MetaWhatsAppProvider,
  Msg91SmsProvider,
  WHATSAPP_API_VERSION,
  WHATSAPP_BASE_URL,
  MSG91_BASE_URL,
  digitsOnly,
  languageCode,
  type FetchLike,
  type MessageProvider,
  type ProviderChannel,
  type ProviderSendRequest,
  type ProviderSendResult,
  type ProviderSet,
} from './adapters/index.js'
