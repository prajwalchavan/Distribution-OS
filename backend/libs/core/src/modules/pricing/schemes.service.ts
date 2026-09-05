import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, eq, gt, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  Scheme,
  SchemePublic,
  SchemesListInput,
  SchemesListOutput,
  UpsertSchemeInput,
  UpsertSchemeOutput,
} from '@dos/contracts'
import {
  retailerLinks,
  retailers,
  schemes,
  withTenant,
  type Db,
  type SchemeApplicability,
  type SchemeSlab,
} from '@dos/db'
import {
  ANY_MEMBER,
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  requireDb,
  requireRole,
} from '../../platform/index.js'

/**
 * What a claim needs to know about a scheme it found in `invoice_lines.applied_rules` (coordination §4:
 * claims → pricing `schemesByIds`): who funds it, whether it is claimable, on which channel, its reward
 * kind (a cash discount is never claimable), its window and the brand's circular reference for the sheet.
 */
export interface SchemeForClaim {
  id: string
  name: string
  brandId: string | null
  rewardKind: string
  rewardUnit: 'pcs' | 'case'
  fundingSource: 'company' | 'distributor'
  claimable: boolean
  claimChannel: 'dos' | 'brand_dms'
  claimWindowDays: number | null
  sourceRef: string | null
  version: number
}

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

  /**
   * The schemes behind a set of `applied_rules.ruleId`s, with the claim-side columns only (claims, slice
   * 7). Inside the caller's transaction; unknown ids are simply absent from the map. Bounded by the
   * caller (a build reads at most a few hundred distinct rules).
   */
  async schemesByIds(tx: Db, ids: readonly string[]): Promise<Map<string, SchemeForClaim>> {
    const { tenantId } = currentTenant()
    const wanted = [...new Set(ids)]
    if (wanted.length === 0) return new Map()
    const rows = await tx
      .select({
        id: schemes.id,
        name: schemes.name,
        brandId: schemes.brandId,
        rewardKind: schemes.rewardKind,
        rewardUnit: schemes.rewardUnit,
        fundingSource: schemes.fundingSource,
        claimable: schemes.claimable,
        claimChannel: schemes.claimChannel,
        claimWindowDays: schemes.claimWindowDays,
        sourceRef: schemes.sourceRef,
        version: schemes.version,
      })
      .from(schemes)
      .where(and(eq(schemes.tenantId, tenantId), inArray(schemes.id, wanted)))
    return new Map(rows.map((r) => [r.id, r]))
  }

  /**
   * The back office reads the whole row; the field and the SHOP get `SchemePublicSchema` — never
   * who funds it, whether it is claimable or the brand's circular reference (docs/17 §B [54–57]). A
   * retailer additionally sees only the schemes whose `applicability` (tier, retailerIds, beatIds)
   * includes a shop linked to its login: those are its "deals" (docs/23 §8.16).
   */
  async listSchemes(input: SchemesIn): Promise<SchemesOut> {
    requireRole(ANY_MEMBER)
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
      const shops = ctx.actorRole === 'retailer' ? await this.ownShops(tx) : null
      const rows = await tx
        .select()
        .from(schemes)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(schemes.id))
        .limit(input.limit + 1)
      const visible = shops ? rows.filter((row) => appliesToAny(row.applicability, shops)) : rows
      const page = visible.slice(0, input.limit)
      const items = BACK_OFFICE.includes(ctx.actorRole)
        ? page.map(toScheme)
        : page.map((row) => toSchemePublic(row))
      const last = page[page.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** The shops linked to a retailer login, with the three dimensions applicability is written in. */
  private async ownShops(tx: Db): Promise<ShopKey[]> {
    const ctx = currentTenant()
    return tx
      .select({ id: retailers.id, tier: retailers.tier, beatId: retailers.beatId })
      .from(retailers)
      .innerJoin(
        retailerLinks,
        and(
          eq(retailerLinks.retailerId, retailers.id),
          eq(retailerLinks.userId, ctx.actorId),
          eq(retailerLinks.status, 'active'),
        ),
      )
      .where(eq(retailers.tenantId, ctx.tenantId))
  }

  /**
   * Creates or updates a scheme. Any change to what the engine reads (scope, trigger, slabs, reward,
   * applicability, validity, stacking, GST-on-free, date mode) bumps `version`, so lines priced under the old
   * economics keep pointing at exactly what they got (`applied_rules.version`).
   */
  async upsertScheme(input: SchemeIn): Promise<SchemeOut> {
    requireRole(MANAGEMENT)
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

interface ShopKey {
  id: string
  tier: string
  beatId: string | null
}

/**
 * The engine's rule (docs/17 §B): any listed dimension restricts, dimensions intersect, empty = all.
 * A scheme applies to a shop when every dimension it names includes that shop.
 */
export function appliesToAny(applicability: SchemeApplicability | null, shops: ShopKey[]): boolean {
  const a = applicability ?? {}
  return shops.some(
    (shop) =>
      (!a.tiers || a.tiers.length === 0 || a.tiers.includes(shop.tier)) &&
      (!a.retailerIds || a.retailerIds.length === 0 || a.retailerIds.includes(shop.id)) &&
      (!a.beatIds ||
        a.beatIds.length === 0 ||
        (shop.beatId !== null && a.beatIds.includes(shop.beatId))),
  )
}

/** The field's and the shop's view: the economics, never the funding, the claim or the brand's reference. */
export function toSchemePublic(row: typeof schemes.$inferSelect): SchemePublic {
  const {
    fundingSource: _f,
    claimable: _c,
    claimWindowDays: _w,
    sourceRef: _s,
    ...rest
  } = toScheme(row)
  return rest
}

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
