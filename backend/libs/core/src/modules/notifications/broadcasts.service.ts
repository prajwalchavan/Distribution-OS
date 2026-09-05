import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, inArray, lt, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  BroadcastCreateInput,
  BroadcastCreateOutput,
  BroadcastGetInput,
  BroadcastGetOutput,
  BroadcastSkippedRecipient,
  BroadcastsListInput,
  BroadcastsListOutput,
} from '@dos/contracts'
import { beats, broadcasts, messages, retailers, users, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  isUniqueViolation,
  MANAGEMENT,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { RetailersService, type ContactPreferences } from '../retailers/index.js'
import {
  dayWindow,
  FALLBACK_LOCALE,
  MAX_BROADCAST_RECIPIENTS,
  missingVariables,
  queueShopMessage,
  resolveLocale,
  resolveTemplate,
  senderIdentity,
  shopDestination,
  type Locale,
  type ShopChannel,
} from './notifications.internals.js'
import { toBroadcast, toBroadcastRecipient } from './notifications.mappers.js'

type CreateIn = z.infer<typeof BroadcastCreateInput>
type CreateOut = z.infer<typeof BroadcastCreateOutput>
type ListIn = z.infer<typeof BroadcastsListInput>
type ListOut = z.infer<typeof BroadcastsListOutput>
type GetIn = z.infer<typeof BroadcastGetInput>
type GetOut = z.infer<typeof BroadcastGetOutput>

type BroadcastRow = typeof broadcasts.$inferSelect

/**
 * An owner / manager's ad-hoc send to a beat or a hand-picked list (docs/plans/notifications.md §2):
 * the audience is resolved to a bounded set (≤ 500, docs/20 rule 3), each shop gets its channel and
 * locale exactly as an outbox send would (WhatsApp with opt-in, else SMS; opted out or no phone →
 * reported as skipped), one `messages` row per shop is queued under `<broadcastId>:<retailerId>`, and
 * the header row carries the counts the worker keeps fresh. All in one transaction; `idempotent()`
 * replays the same header.
 */
@Injectable()
export class BroadcastsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly retailers: RetailersService,
  ) {}

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const audience = await this.audience(tx, input)
        const sender = await senderIdentity(tx)
        const forced: Locale | undefined = input.locale
        // Every declared variable must be supplied and every wording must exist: checked once per
        // (channel, locale) the audience actually resolves to (at most six), against the template
        // the send will use — so a WhatsApp broadcast to an all-opted-in beat needs no SMS wording.
        const combos = new Map<string, { channel: ShopChannel; locale: Locale }>()
        for (const contact of audience.contacts) {
          const dest = shopDestination(contact, input.channel)
          if (!dest.ok) continue
          const locale = forced ?? resolveLocale(contact.preferredLang, sender.defaultLocale)
          combos.set(`${dest.destination.channel}|${locale}`, {
            channel: dest.destination.channel,
            locale,
          })
        }
        if (combos.size === 0)
          combos.set(`${input.channel}|${FALLBACK_LOCALE}`, {
            channel: input.channel,
            locale: forced ?? FALLBACK_LOCALE,
          })
        for (const { channel, locale } of combos.values()) {
          const resolved = await resolveTemplate(tx, input.templateKey, channel, locale)
          if (!resolved)
            throw new ORPCError('BAD_REQUEST', {
              message: `template_not_found: no ${input.templateKey} template for ${channel}`,
            })
          const missing = missingVariables(resolved.template, input.variables)
          if (missing.length > 0)
            throw new ORPCError('BAD_REQUEST', {
              message: `variables_missing: ${missing.join(', ')}`,
            })
        }
        const skipped: BroadcastSkippedRecipient[] = [...audience.skipped]
        let queued = 0
        for (const contact of audience.contacts) {
          const outcome = await queueShopMessage(
            tx,
            { contact, sender },
            {
              retailerId: contact.retailerId,
              templateKey: input.templateKey,
              refType: 'broadcast',
              refId: input.id,
              channel: input.channel,
              locale: forced,
              variables: input.variables,
              idempotencyKey: `${input.id}:${contact.retailerId}`,
            },
          )
          if (outcome.kind === 'queued') {
            queued += 1
            continue
          }
          skipped.push({
            retailerId: contact.retailerId,
            retailerName: contact.name,
            reason:
              outcome.reason === 'inactive' || outcome.reason === 'not_found'
                ? outcome.reason
                : 'no_phone',
          })
        }
        let header: BroadcastRow | undefined
        try {
          ;[header] = await tx
            .insert(broadcasts)
            .values({
              id: input.id,
              tenantId: ctx.tenantId,
              beatId: input.audience.kind === 'beat' ? input.audience.beatId : null,
              channel: input.channel,
              templateKey: input.templateKey,
              locale: forced ?? null,
              variables: input.variables,
              createdBy: ctx.actorId,
              totalRecipients: audience.total,
              queuedCount: queued,
            })
            .returning()
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ORPCError('CONFLICT', { message: `broadcast ${input.id} already exists` })
          throw error
        }
        if (!header)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'insert returned nothing' })
        return { item: await this.item(tx, header), skipped }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(broadcasts.tenantId, ctx.tenantId),
        input.beatId ? eq(broadcasts.beatId, input.beatId) : undefined,
        input.channel ? eq(broadcasts.channel, input.channel) : undefined,
        ...dayWindow(broadcasts.createdAt, input.from, input.to),
        input.cursor ? lt(broadcasts.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(broadcasts)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(broadcasts.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items = await this.items(tx, page)
      return {
        items,
        nextCursor: rows.length > input.limit ? (page[page.length - 1]?.id ?? null) : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const [header] = await tx
        .select()
        .from(broadcasts)
        .where(and(eq(broadcasts.tenantId, ctx.tenantId), eq(broadcasts.id, input.id)))
        .limit(1)
      if (!header) throw new ORPCError('NOT_FOUND', { message: `broadcast ${input.id} not found` })
      const rows = await tx
        .select({ message: messages, retailerName: retailers.name })
        .from(messages)
        .leftJoin(
          retailers,
          and(
            eq(retailers.tenantId, messages.tenantId),
            eq(retailers.id, messages.recipientRetailerId),
          ),
        )
        .where(
          and(
            eq(messages.tenantId, ctx.tenantId),
            eq(messages.refType, 'broadcast'),
            eq(messages.refId, header.id),
          ),
        )
        .orderBy(asc(retailers.name), asc(messages.id))
        .limit(MAX_BROADCAST_RECIPIENTS)
      return {
        item: await this.item(tx, header),
        recipients: rows.map((r) => toBroadcastRecipient(r.message, r.retailerName)),
      }
    })
  }

  // -------------------------------------------------------------------------------------------------------------

  private async audience(
    tx: Db,
    input: CreateIn,
  ): Promise<{
    contacts: ContactPreferences[]
    skipped: BroadcastSkippedRecipient[]
    total: number
  }> {
    const ctx = currentTenant()
    if (input.audience.kind === 'beat') {
      const [beat] = await tx
        .select({ id: beats.id })
        .from(beats)
        .where(and(eq(beats.tenantId, ctx.tenantId), eq(beats.id, input.audience.beatId)))
        .limit(1)
      if (!beat)
        throw new ORPCError('NOT_FOUND', { message: `beat ${input.audience.beatId} not found` })
      const shops = await tx
        .select({ id: retailers.id })
        .from(retailers)
        .where(
          and(
            eq(retailers.tenantId, ctx.tenantId),
            eq(retailers.beatId, beat.id),
            eq(retailers.active, true),
          ),
        )
        .orderBy(asc(retailers.code))
        .limit(MAX_BROADCAST_RECIPIENTS + 1)
      if (shops.length === 0)
        throw new ORPCError('BAD_REQUEST', {
          message: 'empty_audience: no active shop on this beat',
        })
      if (shops.length > MAX_BROADCAST_RECIPIENTS)
        throw new ORPCError('BAD_REQUEST', {
          message: `too_many_recipients: a broadcast reaches at most ${String(MAX_BROADCAST_RECIPIENTS)} shops`,
        })
      const contacts = await this.retailers.contactPreferencesFor(
        tx,
        shops.map((s) => s.id),
      )
      return {
        contacts: shops.flatMap((s) => contacts.get(s.id) ?? []),
        skipped: [],
        total: shops.length,
      }
    }
    const ids = [...new Set(input.audience.retailerIds)]
    const contacts = await this.retailers.contactPreferencesFor(tx, ids)
    const skipped: BroadcastSkippedRecipient[] = ids
      .filter((id) => !contacts.has(id))
      .map((id) => ({ retailerId: id, retailerName: null, reason: 'not_found' as const }))
    return { contacts: ids.flatMap((id) => contacts.get(id) ?? []), skipped, total: ids.length }
  }

  private async item(tx: Db, header: BroadcastRow) {
    const [item] = await this.items(tx, [header])
    if (!item) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'broadcast mapping failed' })
    return item
  }

  private async items(tx: Db, rows: readonly BroadcastRow[]) {
    if (rows.length === 0) return []
    const ctx = currentTenant()
    const beatIds = [...new Set(rows.map((r) => r.beatId).filter((v): v is string => !!v))]
    const beatNames = beatIds.length
      ? await tx
          .select({ id: beats.id, name: beats.name })
          .from(beats)
          .where(and(eq(beats.tenantId, ctx.tenantId), inArray(beats.id, beatIds)))
      : []
    const userIds = [...new Set(rows.map((r) => r.createdBy))]
    const userNames = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds))
    const beatName = new Map(beatNames.map((b) => [b.id, b.name]))
    const userName = new Map(userNames.map((u) => [u.id, u.name]))
    return rows.map((row) =>
      toBroadcast(row, {
        beatName: row.beatId ? (beatName.get(row.beatId) ?? null) : null,
        createdByName: userName.get(row.createdBy) ?? 'Staff',
      }),
    )
  }
}
