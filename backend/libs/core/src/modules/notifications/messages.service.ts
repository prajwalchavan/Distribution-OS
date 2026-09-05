import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  MessageGetInput,
  MessageGetOutput,
  MessageMarkReadInput,
  MessageMarkReadOutput,
  MessageResendInput,
  MessageResendOutput,
  MessageSendInput,
  MessageSendOutput,
  MessagesListInput,
  MessagesListOutput,
} from '@dos/contracts'
import { businessDate } from '@dos/domain'
import { messages, retailers, withTenant, type ActorRole, type Db } from '@dos/db'
import {
  ANY_MEMBER,
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  isPrivilegeViolation,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { RetailersService } from '../retailers/index.js'
import {
  dayWindow,
  queueShopMessage,
  repShopIds,
  senderIdentity,
  type MessageRow,
} from './notifications.internals.js'
import { toMessage, toMessageDetail, type MessageMapping } from './notifications.mappers.js'

type ListIn = z.infer<typeof MessagesListInput>
type ListOut = z.infer<typeof MessagesListOutput>
type GetIn = z.infer<typeof MessageGetInput>
type GetOut = z.infer<typeof MessageGetOutput>
type SendIn = z.infer<typeof MessageSendInput>
type SendOut = z.infer<typeof MessageSendOutput>
type ResendIn = z.infer<typeof MessageResendInput>
type ResendOut = z.infer<typeof MessageResendOutput>
type MarkReadIn = z.infer<typeof MessageMarkReadInput>
type MarkReadOut = z.infer<typeof MessageMarkReadOutput>

/** Who may push a document to a shop's phone on demand (permissions.ts SHOP_MESSENGERS + the worker). */
const SHOP_MESSENGERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'system',
]
const MARKABLE: readonly MessageRow['channel'][] = ['push', 'in_app']

/**
 * The message log and the inbox (docs/plans/notifications.md §2). One procedure serves the desk's
 * full log, the rep's beats, the godown's and the crew's own notices and the shop's inbox: RLS
 * (`messages_read`) scopes a retailer to rows addressed to its own shop, the handler scopes a
 * salesperson to the shops on its beats plus its own notices, and the mapper strips cost and provider
 * internals from everyone but the back office. Every send is a `queued` row the worker dispatches;
 * nothing here calls a provider.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly retailers: RetailersService,
  ) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(messages.tenantId, ctx.tenantId),
        this.scope(),
        input.channel ? eq(messages.channel, input.channel) : undefined,
        input.status ? eq(messages.status, input.status) : undefined,
        input.refType ? eq(messages.refType, input.refType) : undefined,
        input.refId ? eq(messages.refId, input.refId) : undefined,
        input.retailerId && ctx.actorRole !== 'retailer'
          ? eq(messages.recipientRetailerId, input.retailerId)
          : undefined,
        input.mine && ctx.actorRole !== 'retailer'
          ? eq(messages.recipientUserId, ctx.actorId)
          : undefined,
        input.unreadOnly
          ? and(inArray(messages.channel, MARKABLE), isNull(messages.readAt))
          : undefined,
        ...dayWindow(messages.createdAt, input.from, input.to),
        input.cursor ? lt(messages.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(messages)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(messages.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const mapping = await this.mapping(tx, page)
      const [unread] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, ctx.tenantId),
            inArray(messages.channel, MARKABLE),
            isNull(messages.readAt),
            ctx.actorRole === 'retailer' ? undefined : eq(messages.recipientUserId, ctx.actorId),
          ),
        )
      return {
        items: page.map((row) => toMessage(row, mapping)),
        nextCursor: rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null,
        unreadCount: unread?.n ?? 0,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const row = await this.findVisible(tx, input.id)
      return { item: toMessageDetail(row, await this.mapping(tx, [row])) }
    })
  }

  /**
   * On-demand "send this bill / receipt / statement to the shop now" (docs/23 §8.8). The caller
   * supplies the variables from its screen; the service resolves phone, channel and locale exactly
   * as an outbox send does and queues ONE row under the caller's idempotency key.
   */
  async send(input: SendIn): Promise<SendOut> {
    requireRole(SHOP_MESSENGERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sender = await senderIdentity(tx)
        const contact = await this.retailers.contactPreferences(tx, input.retailerId)
        if (!contact)
          throw new ORPCError('NOT_FOUND', { message: `retailer ${input.retailerId} not found` })
        const outcome = await queueShopMessage(
          tx,
          { contact, sender },
          {
            id: input.id,
            retailerId: input.retailerId,
            templateKey: input.templateKey,
            refType: input.refType,
            refId: input.refId,
            channel: input.channel,
            locale: input.locale,
            variables: input.variables,
            idempotencyKey: input.idempotencyKey,
          },
        )
        if (outcome.kind === 'skipped') {
          switch (outcome.reason) {
            case 'template_not_found':
              throw new ORPCError('BAD_REQUEST', {
                message: `template_not_found: no ${input.templateKey} template for this channel`,
              })
            case 'variables_missing':
              throw new ORPCError('BAD_REQUEST', {
                message: `variables_missing: ${(outcome.missing ?? []).join(', ')}`,
              })
            case 'no_phone':
              throw new ORPCError('CONFLICT', {
                message: 'no_phone: the shop has no phone of record to send to',
              })
            case 'opted_out':
              throw new ORPCError('CONFLICT', {
                message: 'opted_out: the shop has blocked messages from this distributor',
              })
            case 'inactive':
              throw new ORPCError('CONFLICT', { message: 'inactive: the shop is not active' })
            case 'not_found':
              throw new ORPCError('NOT_FOUND', {
                message: `retailer ${input.retailerId} not found`,
              })
          }
        }
        if (outcome.row.id !== input.id)
          throw new ORPCError('CONFLICT', {
            message: `idempotencyKey ${input.idempotencyKey} already queued message ${outcome.row.id}`,
          })
        return { item: toMessageDetail(outcome.row, await this.mapping(tx, [outcome.row])) }
      }),
    )
  }

  /** Requeue a failed (or stuck) row for one more try: `attempts` is kept, a delivered row is never resent. */
  async resend(input: ResendIn): Promise<ResendOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.findVisible(tx, input.id)
        if (row.status === 'sent' || row.status === 'delivered' || row.status === 'read')
          throw new ORPCError('CONFLICT', {
            message: `already_sent: message ${row.id} is ${row.status}; a correction is a new message`,
          })
        if (row.status === 'skipped')
          throw new ORPCError('CONFLICT', {
            message: `nothing_to_send: message ${row.id} was skipped (no phone)`,
          })
        const [updated] = await tx
          .update(messages)
          .set({ status: 'queued', nextAttemptAt: new Date(), updatedAt: new Date() })
          .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.id, row.id)))
          .returning()
        if (!updated) throw new ORPCError('NOT_FOUND', { message: `message ${input.id} not found` })
        return { item: toMessageDetail(updated, await this.mapping(tx, [updated])) }
      }),
    )
  }

  /** The caller's own push / in-app row read; idempotent; never a WhatsApp / SMS row (brief §4.11–4.12). */
  async markRead(input: MarkReadIn): Promise<MarkReadOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const row = await this.findVisible(tx, input.id)
        if (ctx.actorRole !== 'retailer' && row.recipientUserId !== ctx.actorId)
          throw new ORPCError('NOT_FOUND', { message: `message ${input.id} not found` })
        if (!MARKABLE.includes(row.channel))
          throw new ORPCError('BAD_REQUEST', {
            message: `channel_not_markable: a ${row.channel} message's read state comes from the provider`,
          })
        if (row.readAt) return { item: toMessageDetail(row, await this.mapping(tx, [row])) }
        const at = new Date()
        let updated: MessageRow | undefined
        try {
          ;[updated] = await tx
            .update(messages)
            .set({ readAt: at, updatedAt: at })
            .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.id, row.id)))
            .returning()
        } catch (error) {
          if (isPrivilegeViolation(error))
            throw new ORPCError('NOT_FOUND', { message: `message ${input.id} not found` })
          throw error
        }
        if (!updated) throw new ORPCError('NOT_FOUND', { message: `message ${input.id} not found` })
        return { item: toMessageDetail(updated, await this.mapping(tx, [updated])) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------

  /**
   * The handler rule on top of RLS: a salesperson sees the shops on its own beats and its own
   * notices; everyone else what the policy admits (staff: the tenant; the shop: its own rows).
   */
  private scope(): SQL | undefined {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'salesperson') return undefined
    return or(
      eq(messages.recipientUserId, ctx.actorId),
      sql`${messages.recipientRetailerId} in ${repShopIds(ctx.actorId, businessDate().date)}`,
    )
  }

  private async findVisible(tx: Db, id: string): Promise<MessageRow> {
    const ctx = currentTenant()
    const [row] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          eq(messages.id, id),
          ...(this.scope() ? [this.scope()] : []),
        ),
      )
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `message ${id} not found` })
    return row
  }

  private async mapping(tx: Db, rows: readonly MessageRow[]): Promise<MessageMapping> {
    const ctx = currentTenant()
    const ids = [...new Set(rows.map((r) => r.recipientRetailerId).filter((v): v is string => !!v))]
    const names = ids.length
      ? await tx
          .select({ id: retailers.id, name: retailers.name })
          .from(retailers)
          .where(and(eq(retailers.tenantId, ctx.tenantId), inArray(retailers.id, ids)))
      : []
    const needsFallback = rows.some((r) => {
      const p = r.payload as Record<string, unknown> | null
      return typeof p?.senderName !== 'string'
    })
    return {
      retailerNames: new Map(names.map((n) => [n.id, n.name])),
      senderFallback: needsFallback ? (await senderIdentity(tx)).displayName : '',
      backOffice: (BACK_OFFICE as readonly string[]).includes(ctx.actorRole),
    }
  }
}
