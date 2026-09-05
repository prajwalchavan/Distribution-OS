/**
 * `@dos/core/notifications` — what the pg-boss worker imports (coordination §3.9: plain functions, no
 * Nest DI). Kept separate from `index.ts` so the worker never resolves the controller.
 */
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
  type DispatchOptions,
  type DispatchResult,
} from './dispatch.js'
export {
  createProviders,
  stubProviders,
  type MessageProvider,
  type ProviderSet,
  type ProviderSendRequest,
  type ProviderSendResult,
} from './adapters/index.js'
export {
  MAX_ATTEMPTS,
  DISPATCH_BATCH,
  DUES_REMINDER_COOLDOWN_DAYS,
} from './notifications.internals.js'
