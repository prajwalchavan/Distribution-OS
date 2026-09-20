import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  InboundCreateInput,
  InboundCreateOutput,
  InboundListInput,
  InboundListOutput,
  InboundMarkHandledInput,
  InboundMarkHandledOutput,
} from '@dos/contracts'
import { businessDate } from '@dos/domain'
import { inboundMessages, retailers, withTenant, type ActorRole, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { contactPreferences } from '../retailers/index.js'
import { signedObjectUrl } from '../tenancy/index.js'
import { dayWindow, repShopIds } from './notifications.internals.js'
import { toInbound } from './notifications.mappers.js'

type CreateIn = z.infer<typeof InboundCreateInput>
type CreateOut = z.infer<typeof InboundCreateOutput>
type ListIn = z.infer<typeof InboundListInput>
type ListOut = z.infer<typeof InboundListOutput>
type MarkIn = z.infer<typeof InboundMarkHandledInput>
type MarkOut = z.infer<typeof InboundMarkHandledOutput>

type InboundRow = typeof inboundMessages.$inferSelect

/** Support triage: the desk plus the beat-owning rep (permissions.ts TRIAGE + the worker). */
const TRIAGE: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'salesperson', 'system']
/**
 * DOS-103: who READS the queue. The shop is here because it reads back the reports it filed itself;
 * RLS narrows it to the rows attributed to its own shop, and it triages nothing (`markHandled` stays
 * TRIAGE, and no shop UPDATE policy exists under it either).
 */
const INBOUND_READERS: readonly ActorRole[] = [...TRIAGE, 'retailer']
/** How long a "payment done" photo link stays good on the triage screen. */
const MEDIA_URL_TTL_SECONDS = 15 * 60

/**
 * Texts and photos shops sent to the distributor's number, captured raw for a human (the AI intake
 * module turns them into draft orders later, always human-confirmed). The handler scopes a
 * salesperson to the shops on its own beats — an unknown number is the desk's alone; `mediaUrl` is a
 * short-lived signed link built here, never bytes on the wire (docs/20 rule 15).
 */
@Injectable()
export class InboundService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * DOS-103 — a shop reports a problem or asks for a return, from its own app.
   *
   * It lands in the SAME office queue as the WhatsApp texts, because the desk's job is the same either
   * way; `kind` and the reference are the structure the desk needs to tell one from the other and to
   * open the bill it names. The words are stored exactly as typed and never edited.
   *
   * The shop's own shop only. `contactPreferences` answers the link that speaks for the shop: when its
   * login is not the caller, this is someone else's shop and the answer is 403 — RLS would refuse the
   * insert anyway (`inbound_messages_shop_insert`), but a 403 says which of the two things is wrong.
   */
  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(['retailer'])
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const contact = await contactPreferences(tx, input.retailerId)
        if (!contact || contact.userId !== ctx.actorId)
          throw new ORPCError('FORBIDDEN', { message: 'that is not your shop' })
        const [row] = await tx
          .insert(inboundMessages)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            channel: 'in_app',
            // The shop's own number as the distributor knows it; 'app' when it holds none, so the
            // desk still sees where the report came from.
            from: contact.phone ?? 'app',
            retailerId: input.retailerId,
            body: input.body,
            kind: input.kind,
            refType: input.refType ?? null,
            refId: input.refId ?? null,
            createdBy: ctx.actorId,
            receivedAt: new Date(),
            handled: false,
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'the report was not stored' })
        const [item] = await this.items(tx, [row])
        if (!item)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'inbound mapping failed' })
        return { item }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(INBOUND_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const scope = this.scope()
      const filters: (SQL | undefined)[] = [
        eq(inboundMessages.tenantId, ctx.tenantId),
        scope,
        input.retailerId ? eq(inboundMessages.retailerId, input.retailerId) : undefined,
        input.channel ? eq(inboundMessages.channel, input.channel) : undefined,
        input.handled !== undefined ? eq(inboundMessages.handled, input.handled) : undefined,
        ...dayWindow(inboundMessages.receivedAt, input.from, input.to),
        input.cursor ? lt(inboundMessages.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(inboundMessages)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(inboundMessages.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const [open] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(inboundMessages)
        .where(
          and(
            eq(inboundMessages.tenantId, ctx.tenantId),
            eq(inboundMessages.handled, false),
            scope,
          ),
        )
      return {
        items: await this.items(tx, page),
        nextCursor: rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null,
        unhandledCount: open?.n ?? 0,
      }
    })
  }

  /** `handled = true` and nothing else: the raw text is never edited. Idempotent. */
  async markHandled(input: MarkIn): Promise<MarkOut> {
    requireRole(TRIAGE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const scope = this.scope()
        const [row] = await tx
          .select()
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, ctx.tenantId),
              eq(inboundMessages.id, input.id),
              scope,
            ),
          )
          .limit(1)
        if (!row)
          throw new ORPCError('NOT_FOUND', { message: `inbound message ${input.id} not found` })
        const current = row.handled
          ? row
          : ((
              await tx
                .update(inboundMessages)
                .set({ handled: true })
                .where(eq(inboundMessages.id, row.id))
                .returning()
            )[0] ?? row)
        const [item] = await this.items(tx, [current])
        if (!item)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'inbound mapping failed' })
        return { item }
      }),
    )
  }

  /**
   * The extra predicate beyond RLS. A salesperson is scoped to the shops on its own beats (an unknown
   * number is the desk's alone); a shop needs none — `inbound_messages_read` already narrows it to the
   * rows of its own shop, and adding a predicate here would only be a second, drifting copy of it.
   */
  private scope(): SQL | undefined {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'salesperson') return undefined
    return sql`${inboundMessages.retailerId} in ${repShopIds(ctx.actorId, businessDate().date)}`
  }

  private async items(tx: Db, rows: readonly InboundRow[]) {
    const ctx = currentTenant()
    const ids = [...new Set(rows.map((r) => r.retailerId).filter((v): v is string => !!v))]
    const names = ids.length
      ? await tx
          .select({ id: retailers.id, name: retailers.name })
          .from(retailers)
          .where(and(eq(retailers.tenantId, ctx.tenantId), inArray(retailers.id, ids)))
      : []
    const nameOf = new Map(names.map((n) => [n.id, n.name]))
    return Promise.all(
      rows.map(async (row) =>
        toInbound(row, {
          retailerName: row.retailerId ? (nameOf.get(row.retailerId) ?? null) : null,
          mediaUrl: row.mediaObjectKey
            ? await signedObjectUrl(row.mediaObjectKey, MEDIA_URL_TTL_SECONDS)
            : null,
        }),
      ),
    )
  }
}
