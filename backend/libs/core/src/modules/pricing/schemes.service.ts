import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, eq, gt, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  Scheme,
  SchemesListInput,
  SchemesListOutput,
  UpsertSchemeInput,
  UpsertSchemeOutput,
} from '@dos/contracts'
import { schemes, withTenant, type Db, type SchemeApplicability, type SchemeSlab } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'

type SchemesIn = z.infer<typeof SchemesListInput>
type SchemesOut = z.infer<typeof SchemesListOutput>
type SchemeIn = z.infer<typeof UpsertSchemeInput>
type SchemeOut = z.infer<typeof UpsertSchemeOutput>

/**
 * THE single `schemes` table (ADR 0008 / D14): read by the engine through QuoteService and referenced by claims.
 * Reads are staff-only; writes are back office. Economics changes bump `version` so `applied_rules` stay exact.
 */
@Injectable()
export class SchemesService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async listSchemes(input: SchemesIn): Promise<SchemesOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(schemes.tenantId, ctx.tenantId),
        input.activeOnly ? eq(schemes.active, true) : undefined,
        input.on ? lte(schemes.validFrom, input.on) : undefined,
        input.on ? sql`${schemes.validTo} >= ${input.on}` : undefined,
        input.brandId ? eq(schemes.brandId, input.brandId) : undefined,
        input.cursor ? gt(schemes.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(schemes)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(schemes.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toScheme)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /**
   * Creates or updates a scheme. Any change to what the engine reads (scope, trigger, slabs, reward,
   * applicability, validity, stacking, GST-on-free, date mode) bumps `version`, so lines priced under the old
   * economics keep pointing at exactly what they got (`applied_rules.version`).
   */
  async upsertScheme(input: SchemeIn): Promise<SchemeOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(schemes)
          .where(and(eq(schemes.tenantId, ctx.tenantId), eq(schemes.id, input.id)))
        const economics = {
          scope: compact(input.scope),
          triggerKind: input.triggerKind,
          triggerMin: input.triggerMin,
          triggerUnit: input.triggerUnit,
          slabs: input.slabs ? input.slabs.map((s) => compact(s) as SchemeSlab) : null,
          rewardKind: input.rewardKind,
          rewardValue: input.rewardValue,
          freeVariantId: input.freeVariantId ?? null,
          applicability: compact(input.applicability) as SchemeApplicability,
          validFrom: input.validFrom,
          validTo: input.validTo,
          stackable: input.stackable,
          final: input.final,
          gstOnFreeGoods: input.gstOnFreeGoods,
          pricingDateMode: input.pricingDateMode,
        }
        const meta = {
          name: input.name,
          brandId: input.brandId ?? null,
          fundingSource: input.fundingSource,
          claimable: input.claimable,
          claimWindowDays: input.claimWindowDays ?? null,
          sourceRef: input.sourceRef ?? null,
          active: input.active,
        }
        const version = existing
          ? existing.version + (stableJson(economicsOf(existing)) === stableJson(economics) ? 0 : 1)
          : 1
        const [row] = await tx
          .insert(schemes)
          .values({ id: input.id, tenantId: ctx.tenantId, version, ...economics, ...meta })
          .onConflictDoUpdate({
            target: schemes.id,
            set: { version, ...economics, ...meta, updatedAt: new Date() },
          })
          .returning()
        if (!row) throw new Error('scheme upsert returned nothing')
        return { item: toScheme(row) }
      }),
    )
  }
}

// ------------------------------------------------------------------------------------------------------ helpers

function compact<T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  )
}

function economicsOf(row: typeof schemes.$inferSelect) {
  return {
    scope: row.scope,
    triggerKind: row.triggerKind,
    triggerMin: row.triggerMin,
    triggerUnit: row.triggerUnit,
    slabs: row.slabs,
    rewardKind: row.rewardKind,
    rewardValue: row.rewardValue,
    freeVariantId: row.freeVariantId,
    applicability: row.applicability,
    validFrom: row.validFrom,
    validTo: row.validTo,
    stackable: row.stackable,
    final: row.final,
    gstOnFreeGoods: row.gstOnFreeGoods,
    pricingDateMode: row.pricingDateMode,
  }
}

export function toScheme(row: typeof schemes.$inferSelect): Scheme {
  return {
    id: row.id,
    name: row.name,
    brandId: row.brandId,
    scope: row.scope,
    triggerKind: row.triggerKind,
    triggerMin: row.triggerMin,
    triggerUnit: row.triggerUnit as Scheme['triggerUnit'],
    slabs: row.slabs,
    rewardKind: row.rewardKind,
    rewardValue: row.rewardValue,
    freeVariantId: row.freeVariantId,
    applicability: row.applicability as Scheme['applicability'],
    validFrom: row.validFrom,
    validTo: row.validTo,
    stackable: row.stackable,
    final: row.final,
    gstOnFreeGoods: row.gstOnFreeGoods,
    pricingDateMode: row.pricingDateMode,
    version: row.version,
    fundingSource: row.fundingSource,
    claimable: row.claimable,
    claimWindowDays: row.claimWindowDays,
    sourceRef: row.sourceRef,
    active: row.active,
  }
}
