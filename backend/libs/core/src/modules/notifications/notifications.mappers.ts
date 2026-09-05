import type {
  Broadcast,
  BroadcastRecipient,
  InboundMessage,
  Message,
  MessageDetail,
  MessageRefType,
  PushToken,
  Template,
} from '@dos/contracts'
import { LocaleSchema, MessageRefTypeSchema, PushPlatformSchema } from '@dos/contracts'
import type { broadcasts, inboundMessages, pushTokens, templates } from '@dos/db'
import { PAYLOAD_KEYS, type MessageRow } from './notifications.internals.js'

/** DB rows → contract shapes. Nothing here may add a column the contract does not name. */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

export interface MessageMapping {
  /** Shop name by `recipient_retailer_id`, from one join on the page. */
  retailerNames: ReadonlyMap<string, string>
  /** The distributor's display name for a row whose payload predates the frozen `senderName`. */
  senderFallback: string
  /** Owner / manager / accountant see cost and provider internals; nobody else does (brief §4.7). */
  backOffice: boolean
}

function refTypeOf(value: string | null): MessageRefType | null {
  if (value === null) return null
  const parsed = MessageRefTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function localeOf(value: string): Message['locale'] {
  const parsed = LocaleSchema.safeParse(value)
  return parsed.success ? parsed.data : 'en-IN'
}

export function toMessage(row: MessageRow, m: MessageMapping): Message {
  const payload =
    row.payload !== null && typeof row.payload === 'object'
      ? (row.payload as Record<string, unknown>)
      : {}
  const senderName = payload[PAYLOAD_KEYS.senderName]
  const body = payload[PAYLOAD_KEYS.body]
  const base: Message = {
    id: row.id,
    channel: row.channel,
    templateKey: row.templateKey,
    destination: row.to,
    recipientUserId: row.recipientUserId,
    recipientRetailerId: row.recipientRetailerId,
    retailerName: row.recipientRetailerId
      ? (m.retailerNames.get(row.recipientRetailerId) ?? null)
      : null,
    senderName:
      typeof senderName === 'string' && senderName.length > 0 ? senderName : m.senderFallback,
    locale: localeOf(row.locale),
    body: typeof body === 'string' ? body : null,
    status: row.status,
    refType: refTypeOf(row.refType),
    refId: row.refId,
    scheduledAt: iso(row.scheduledAt),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    createdAt: row.createdAt.toISOString(),
  }
  if (!m.backOffice) return base
  return {
    ...base,
    costPaise: row.costPaise,
    providerMessageId: row.providerMessageId,
    error: row.error,
  }
}

export function toMessageDetail(row: MessageRow, m: MessageMapping): MessageDetail {
  return {
    ...toMessage(row, m),
    payload:
      row.payload !== null && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : {},
    attempts: row.attempts,
    nextAttemptAt: iso(row.nextAttemptAt),
  }
}

export function toTemplate(row: typeof templates.$inferSelect): Template {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    channel: row.channel,
    locale: localeOf(row.locale),
    providerTemplateName: row.providerTemplateName,
    body: row.body,
    variables: row.variables,
    active: row.active,
    isOverride: row.tenantId !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toBroadcast(
  row: typeof broadcasts.$inferSelect,
  extra: { beatName: string | null; createdByName: string },
): Broadcast {
  const channel = row.channel === 'whatsapp' || row.channel === 'sms' ? row.channel : 'in_app'
  const counted = row.queuedCount + row.sentCount + row.deliveredCount + row.failedCount
  return {
    id: row.id,
    channel,
    templateKey: row.templateKey,
    locale: row.locale === null ? null : localeOf(row.locale),
    beatId: row.beatId,
    beatName: extra.beatName,
    variables: row.variables,
    totalRecipients: row.totalRecipients,
    queuedCount: row.queuedCount,
    sentCount: row.sentCount,
    deliveredCount: row.deliveredCount,
    failedCount: row.failedCount,
    skippedCount: Math.max(0, row.totalRecipients - counted),
    createdBy: row.createdBy,
    createdByName: extra.createdByName,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toBroadcastRecipient(
  row: MessageRow,
  retailerName: string | null,
): BroadcastRecipient {
  return {
    messageId: row.id,
    retailerId: row.recipientRetailerId ?? '',
    retailerName,
    channel: row.channel,
    status: row.status,
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    error: row.error,
  }
}

export function toPushToken(row: typeof pushTokens.$inferSelect): PushToken {
  const platform = PushPlatformSchema.safeParse(row.platform)
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    platform: platform.success ? platform.data : 'android',
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toInbound(
  row: typeof inboundMessages.$inferSelect,
  extra: { retailerName: string | null; mediaUrl: string | null },
): InboundMessage {
  return {
    id: row.id,
    channel: row.channel,
    fromPhone: row.from,
    retailerId: row.retailerId,
    retailerName: extra.retailerName,
    body: row.body,
    mediaObjectKey: row.mediaObjectKey,
    mediaUrl: extra.mediaUrl,
    receivedAt: row.receivedAt.toISOString(),
    handled: row.handled,
  }
}
