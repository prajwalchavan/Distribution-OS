import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, eq, gt, ilike, inArray, or, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type { CatalogSearchInput, CatalogSearchOutput, ManufacturersListOutput, ProposeProductInput, ProposeProductOutput, VariantSummary } from '@dos/contracts'
import { brands, manufacturers, productVariants, products, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb } from '../../platform/index.js'

type SearchIn = z.infer<typeof CatalogSearchInput>
type SearchOut = z.infer<typeof CatalogSearchOutput>
type ManufacturersOut = z.infer<typeof ManufacturersListOutput>
type ProposeIn = z.infer<typeof ProposeProductInput>
type ProposeOut = z.infer<typeof ProposeProductOutput>

/** Columns every catalog list returns; shared with tenant-catalog so both lists look identical to the apps. */
export const variantSummaryColumns = {
  variantId: productVariants.id,
  productId: products.id,
  manufacturerId: products.manufacturerId,
  brandId: products.brandId,
  name: productVariants.name,
  productName: products.name,
  productNameHi: products.nameHi,
  brandName: brands.name,
  manufacturerName: manufacturers.name,
  netQty: productVariants.netQty,
  netUnit: productVariants.netUnit,
  promoExtra: productVariants.promoExtra,
  defaultCaseSize: productVariants.defaultCaseSize,
  hsnCode: productVariants.hsnCode,
  ean: productVariants.ean,
  mrpPaise: productVariants.mrpPaise,
  status: productVariants.status,
}

export function variantSearchPredicate(q: string | undefined): SQL | undefined {
  if (!q) return undefined
  const pattern = `%${q.replace(/[%_]/g, '')}%`
  return or(ilike(productVariants.name, pattern), ilike(products.name, pattern), ilike(brands.name, pattern), ilike(manufacturers.name, pattern))
}

@Injectable()
export class CatalogService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async search(input: SearchIn): Promise<SearchOut> {
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        variantSearchPredicate(input.q),
        input.manufacturerId ? eq(products.manufacturerId, input.manufacturerId) : undefined,
        input.brandId ? eq(products.brandId, input.brandId) : undefined,
        input.includeProposed ? inArray(productVariants.status, ['active', 'proposed']) : eq(productVariants.status, 'active'),
        input.cursor ? gt(productVariants.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select(variantSummaryColumns)
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(productVariants.id))
        .limit(input.limit + 1)
      const items: VariantSummary[] = rows.slice(0, input.limit)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.variantId : null }
    })
  }

  async manufacturers(): Promise<ManufacturersOut> {
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const ms = await tx.select().from(manufacturers).orderBy(asc(manufacturers.name))
      const bs = await tx.select().from(brands).orderBy(asc(brands.name))
      return {
        items: ms.map((m) => ({
          id: m.id,
          name: m.name,
          legalName: m.legalName,
          gstin: m.gstin,
          brands: bs.filter((b) => b.manufacturerId === m.id).map((b) => ({ id: b.id, manufacturerId: b.manufacturerId, name: b.name })),
        })),
      }
    })
  }

  /** ADR 0005: a distributor's proposal is usable immediately as `proposed`; the curator merges or accepts later. */
  async propose(input: ProposeIn): Promise<ProposeOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await tx
          .insert(products)
          .values({
            id: input.productId,
            manufacturerId: input.manufacturerId,
            brandId: input.brandId ?? null,
            name: input.productName,
            nameHi: input.productNameHi ?? null,
            category: input.category ?? null,
            status: 'proposed',
            proposedByTenantId: ctx.tenantId,
          })
          .onConflictDoNothing()
        await tx
          .insert(productVariants)
          .values({
            id: input.variantId,
            productId: input.productId,
            name: input.variantName,
            netQty: input.netQty,
            netUnit: input.netUnit,
            promoExtra: input.promoExtra ?? null,
            defaultCaseSize: input.defaultCaseSize,
            hsnCode: input.hsnCode,
            ean: input.ean ?? null,
            mrpPaise: input.mrpPaise ?? null,
            status: 'proposed',
          })
          .onConflictDoNothing()
        return { productId: input.productId, variantId: input.variantId, status: 'proposed' as const }
      }),
    )
  }
}
