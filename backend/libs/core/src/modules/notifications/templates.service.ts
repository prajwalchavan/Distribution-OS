import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  TemplatesListInput,
  TemplatesListOutput,
  TemplateUpsertInput,
  TemplateUpsertOutput,
} from '@dos/contracts'
import { RESERVED_TEMPLATE_VARIABLES } from '@dos/contracts'
import { templates, withTenant, type Db } from '@dos/db'
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
import {
  INTERNAL_VARIABLE_NAMES,
  templateTokens,
  type TemplateRow,
} from './notifications.internals.js'
import { toTemplate } from './notifications.mappers.js'

type ListIn = z.infer<typeof TemplatesListInput>
type ListOut = z.infer<typeof TemplatesListOutput>
type UpsertIn = z.infer<typeof TemplateUpsertInput>
type UpsertOut = z.infer<typeof TemplateUpsertOutput>

/** The channels that land on a shopkeeper's phone under the PLATFORM's sender identity: the name must be in the text. */
const SHOP_PHONE_CHANNELS: readonly TemplateRow['channel'][] = ['whatsapp', 'sms']
/** The templates table is small (a few dozen rows per tenant); the page is cut in memory after the override merge. */
const TEMPLATE_SCAN = 1000

/**
 * Wording per `(key, channel, locale)`: platform defaults (`tenant_id IS NULL`) plus this tenant's
 * overrides, an override hiding its default (docs/plans/notifications.md §2). The service always
 * writes `tenantId = ctx.tenantId`; a platform row is never addressable here, and `templates_write`
 * (RLS) is the backstop.
 */
@Injectable()
export class TemplatesService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        or(eq(templates.tenantId, ctx.tenantId), isNull(templates.tenantId)),
        input.key ? eq(templates.key, input.key) : undefined,
        input.channel ? eq(templates.channel, input.channel) : undefined,
        input.locale ? eq(templates.locale, input.locale) : undefined,
        input.activeOnly ? eq(templates.active, true) : undefined,
      ]
      const rows = await tx
        .select()
        .from(templates)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(
          templates.key,
          templates.channel,
          templates.locale,
          sql`${templates.tenantId} nulls last`,
        )
        .limit(TEMPLATE_SCAN)
      // An ACTIVE override hides the platform default of the same key / channel / locale; a retired
      // override (`activeOnly: false` shows it) does not, so the default is visible again next to it.
      const hidden = new Set(
        rows
          .filter((r) => r.tenantId !== null && r.active)
          .map((r) => `${r.key}|${r.channel}|${r.locale}`),
      )
      const merged = rows.filter(
        (r) => r.tenantId !== null || !hidden.has(`${r.key}|${r.channel}|${r.locale}`),
      )
      const start = input.cursor ? merged.findIndex((r) => r.id === input.cursor) + 1 : 0
      const page = merged.slice(start, start + input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map(toTemplate),
        nextCursor: start + input.limit < merged.length && last ? last.id : null,
      }
    })
  }

  /**
   * Create or replace THIS tenant's wording (upsert on the natural key). Rules, all 400: every
   * `{{token}}` of the body is declared (`unknown_variable`); no declared variable is reserved or
   * internal (`reserved_variable`); a WhatsApp / SMS body carries `{{distributorName}}` — the white
   * label (`distributor_name_missing`, docs/17 §D6).
   */
  async upsert(input: UpsertIn): Promise<UpsertOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    this.validate(input)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const natural = and(
          eq(templates.tenantId, ctx.tenantId),
          eq(templates.key, input.key),
          eq(templates.channel, input.channel),
          eq(templates.locale, input.locale),
        )
        const values = {
          providerTemplateName: input.providerTemplateName ?? null,
          body: input.body,
          variables: input.variables,
          active: input.active,
        }
        // The `templates_write` policy admits the owner and the system on a tenant row; the manager
        // is admitted by PERMISSIONS (MANAGEMENT, coordination §6 PIN_HOLDERS), so the write itself
        // runs as the system actor for this one statement — the pattern `loadSettings` and
        // `recordTransition` use — after `requireRole` has decided. Restored in `finally`.
        return this.asSystem(tx, async () => {
          const [existing] = await tx.select().from(templates).where(natural).for('update').limit(1)
          if (existing) {
            const [updated] = await tx
              .update(templates)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(templates.id, existing.id))
              .returning()
            if (!updated) throw new ORPCError('NOT_FOUND', { message: 'template vanished' })
            return { item: toTemplate(updated), created: false }
          }
          try {
            const [inserted] = await tx
              .insert(templates)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                key: input.key,
                channel: input.channel,
                locale: input.locale,
                ...values,
              })
              .returning()
            if (!inserted)
              throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'insert returned nothing' })
            return { item: toTemplate(inserted), created: true }
          } catch (error) {
            if (isUniqueViolation(error))
              throw new ORPCError('CONFLICT', {
                message: `template ${input.id} already exists, or the natural key was taken concurrently`,
              })
            throw error
          }
        })
      }),
    )
  }

  private validate(input: UpsertIn): void {
    const reserved = input.variables.filter((v) => INTERNAL_VARIABLE_NAMES.includes(v))
    if (reserved.length > 0)
      throw new ORPCError('BAD_REQUEST', {
        message: `reserved_variable: ${reserved.join(', ')} ${reserved.length === 1 ? 'is' : 'are'} supplied by the service, never declared`,
      })
    const tokens = templateTokens(input.body)
    const unknown = tokens.filter(
      (t) =>
        !input.variables.includes(t) &&
        !(RESERVED_TEMPLATE_VARIABLES as readonly string[]).includes(t),
    )
    if (unknown.length > 0)
      throw new ORPCError('BAD_REQUEST', {
        message: `unknown_variable: {{${unknown.join('}}, {{')}}} not in variables`,
      })
    if (SHOP_PHONE_CHANNELS.includes(input.channel) && !tokens.includes('distributorName'))
      throw new ORPCError('BAD_REQUEST', {
        message:
          'distributor_name_missing: a WhatsApp / SMS body must carry {{distributorName}} — the shop must see whose message it is',
      })
  }

  private async asSystem<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
    const ctx = currentTenant()
    if (ctx.actorRole === 'system') return fn()
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    try {
      return await fn()
    } finally {
      await tx
        .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
        .catch(() => undefined)
    }
  }
}
