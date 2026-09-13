import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import { businessDate } from '@dos/domain'
import type {
  AdjustStockInput,
  AdjustStockOutput,
  LedgerListInput,
  LedgerListOutput,
  LocationsListInput,
  LocationsListOutput,
  SellableStockInput,
  SellableStockOutput,
  StockAvailabilityInput,
  StockAvailabilityOutput,
  StockBalanceRow,
  StockBalancesInput,
  StockBalancesOutput,
  TransferStockInput,
  TransferStockOutput,
  UpsertLocationInput,
  UpsertLocationOutput,
  UpsertLotInput,
  UpsertLotOutput,
} from '@dos/contracts'
import {
  locations,
  products,
  productVariants,
  stockBalances,
  stockLedger,
  stockLots,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import {
  InventoryService,
  pgConstraint,
  type BalanceRow,
  type LedgerRow,
  type LotRow,
} from './inventory.service.js'
import {
  toAvailability,
  toBalance,
  toEntry,
  toLocation,
  toLot,
  toSellable,
  type AvailabilityRaw,
  type SellableRaw,
} from './inventory.mappers.js'
import { findReservableLocationId } from './reservable-location.js'

type LocationsIn = z.infer<typeof LocationsListInput>
type LocationsOut = z.infer<typeof LocationsListOutput>
type LocationIn = z.infer<typeof UpsertLocationInput>
type LocationOut = z.infer<typeof UpsertLocationOutput>
type SellableIn = z.infer<typeof SellableStockInput>
type SellableOut = z.infer<typeof SellableStockOutput>
type AvailabilityIn = z.infer<typeof StockAvailabilityInput>
type AvailabilityOut = z.infer<typeof StockAvailabilityOutput>
type BalancesIn = z.infer<typeof StockBalancesInput>
type BalancesOut = z.infer<typeof StockBalancesOutput>
type AdjustIn = z.infer<typeof AdjustStockInput>
type AdjustOut = z.infer<typeof AdjustStockOutput>
type TransferIn = z.infer<typeof TransferStockInput>
type TransferOut = z.infer<typeof TransferStockOutput>
type LedgerIn = z.infer<typeof LedgerListInput>
type LedgerOut = z.infer<typeof LedgerListOutput>
type LotIn = z.infer<typeof UpsertLotInput>
type LotOut = z.infer<typeof UpsertLotOutput>

/** Who may see per-lot balances and the ledger: everyone who physically keeps stock (a van counts). Reps and retailers get `availability` and `sellable` only. */
export const STOCK_KEEPERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'warehouse',
  'delivery',
  'accountant',
  'system',
]

/** Who may move stock and maintain locations/lots: the desk plus the godown. None of this touches a rate. */
const STOCK_WRITERS: readonly ActorRole[] = [...BACK_OFFICE, 'warehouse']

/** The near-expiry window `stock.balances?nearExpiryOnly=true` uses (days from today, IST). */
const NEAR_EXPIRY_DAYS = 60

/** Today in IST plus `days`, as `YYYY-MM-DD`. */
function addDaysIst(days: number): string {
  return businessDate(Date.now() + days * 86_400_000).date
}

/** Composite cursor for (lot, location)-keyed lists. */
function splitCursor(cursor: string | undefined): { lotId: string; locationId: string } | null {
  if (!cursor) return null
  const i = cursor.indexOf(':')
  if (i <= 0) throw new ORPCError('BAD_REQUEST', { message: 'cursor must be lotId:locationId' })
  return { lotId: cursor.slice(0, i), locationId: cursor.slice(i + 1) }
}

@Injectable()
export class StockService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly inventory: InventoryService,
  ) {}

  async listLocations(input: LocationsIn): Promise<LocationsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters = [
        input.kind ? eq(locations.kind, input.kind) : undefined,
        input.activeOnly ? eq(locations.active, true) : undefined,
      ]
      const rows = await tx
        .select()
        .from(locations)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(locations.kind), asc(locations.name))
      return { items: rows.map(toLocation) }
    })
  }

  async upsertLocation(input: LocationIn): Promise<LocationOut> {
    requireRole(STOCK_WRITERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const values = {
          kind: input.kind,
          name: input.name,
          vehicleId: input.vehicleId ?? null,
          negativeAllowed: input.negativeAllowed,
          active: input.active,
        }
        try {
          const [row] = await tx
            .insert(locations)
            .values({ id: input.id, tenantId: ctx.tenantId, ...values })
            .onConflictDoUpdate({ target: locations.id, set: { ...values, updatedAt: new Date() } })
            .returning()
          if (!row)
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: 'location upsert returned nothing',
            })
          return { item: toLocation(row) }
        } catch (err) {
          if (pgConstraint(err) === 'locations_tenant_name_idx')
            throw new ORPCError('CONFLICT', {
              message: `a location named "${input.name}" already exists`,
            })
          throw err
        }
      }),
    )
  }

  /** ATP through the `sellable_stock` view (ADR 0003). Open to every role, including retailers; no on-hand split, no cost. */
  async sellable(input: SellableIn): Promise<SellableOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const after = splitCursor(input.cursor)
      const pattern = input.q ? `%${input.q.replace(/[%_]/g, '')}%` : null
      const rows = (
        await tx.execute(sql`
          select s.variant_id, s.location_id, s.lot_id, s.batch_no, s.mrp_paise, s.expiry_date, s.available,
                 v.name as variant_name, p.name as product_name, b.name as brand_name
          from sellable_stock s
          join product_variants v on v.id = s.variant_id
          join products p on p.id = v.product_id
          left join brands b on b.id = p.brand_id
          where s.tenant_id = ${ctx.tenantId}
            ${input.variantId ? sql`and s.variant_id = ${input.variantId}` : sql``}
            ${input.locationId ? sql`and s.location_id = ${input.locationId}` : sql``}
            ${pattern ? sql`and (v.name ilike ${pattern} or p.name ilike ${pattern} or b.name ilike ${pattern})` : sql``}
            ${after ? sql`and (s.lot_id, s.location_id) > (${after.lotId}, ${after.locationId})` : sql``}
          order by s.lot_id, s.location_id
          limit ${input.limit + 1}`)
      ).rows as unknown as SellableRaw[]
      const items = rows.slice(0, input.limit).map(toSellable)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: rows.length > input.limit && last ? `${last.lotId}:${last.locationId}` : null,
      }
    })
  }

  /**
   * The order screens' stock hint (DOS-074 rep, DOS-097 shop): one available-to-promise total per item at the
   * godown orders reserve from (`reservableLocationId`), paged by item. Summing `sellable` would count a van,
   * the damaged bin, stock in transit and a second warehouse — pieces no order can reserve.
   *
   * Only items with something left to promise at the godown have a row, so a caller that has read every page
   * may take a missing item as zero. No expiry filter, because `reserve()` has none. Open to every member,
   * like `sellable` (TenantGuard + PERMISSIONS gate it), and a strict subset of what `sellable` shows.
   */
  async availability(input: AvailabilityIn): Promise<AvailabilityOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      // No active warehouse: nothing can be reserved, so nothing can be promised (its orders cannot confirm).
      const godown = await findReservableLocationId(tx)
      if (godown === null) return { items: [], nextCursor: null }
      const rows = (
        await tx.execute(sql`
          select s.variant_id, sum(s.available)::bigint as available
          from sellable_stock s
          where s.tenant_id = ${ctx.tenantId}
            and s.location_id = ${godown}
            ${input.variantId ? sql`and s.variant_id = ${input.variantId}` : sql``}
            ${input.cursor ? sql`and s.variant_id > ${input.cursor}` : sql``}
          group by s.variant_id
          order by s.variant_id
          limit ${input.limit + 1}`)
      ).rows as unknown as AvailabilityRaw[]
      const items = rows.slice(0, input.limit).map(toAvailability)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.variantId : null }
    })
  }

  async balances(input: BalancesIn): Promise<BalancesOut> {
    requireRole(STOCK_KEEPERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const after = splitCursor(input.cursor)
      const filters: (SQL | undefined)[] = [
        input.variantId ? eq(stockLots.variantId, input.variantId) : undefined,
        input.locationId ? eq(stockBalances.locationId, input.locationId) : undefined,
        input.lotId ? eq(stockBalances.lotId, input.lotId) : undefined,
        // The near-expiry list (docs/23 §8.18): lots expiring on or before a date, or within the
        // tenant's window (60 days). Lots with no expiry are excluded by either filter.
        input.expiringBefore ? sql`${stockLots.expiryDate} <= ${input.expiringBefore}` : undefined,
        input.nearExpiryOnly
          ? sql`${stockLots.expiryDate} <= ${addDaysIst(NEAR_EXPIRY_DAYS)}`
          : undefined,
        after
          ? sql`(${stockBalances.lotId}, ${stockBalances.locationId}) > (${after.lotId}, ${after.locationId})`
          : undefined,
      ]
      const rows = await tx
        .select({
          lotId: stockBalances.lotId,
          variantId: stockLots.variantId,
          locationId: stockBalances.locationId,
          batchNo: stockLots.batchNo,
          mrpPaise: stockLots.mrpPaise,
          expiryDate: stockLots.expiryDate,
          onHand: stockBalances.onHand,
          reserved: stockBalances.reserved,
          version: stockBalances.version,
          variantName: productVariants.name,
          productName: products.name,
        })
        .from(stockBalances)
        .innerJoin(stockLots, eq(stockLots.id, stockBalances.lotId))
        .innerJoin(productVariants, eq(productVariants.id, stockLots.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(stockBalances.lotId), asc(stockBalances.locationId))
        .limit(input.limit + 1)
      const items: StockBalanceRow[] = rows.slice(0, input.limit)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: rows.length > input.limit && last ? `${last.lotId}:${last.locationId}` : null,
      }
    })
  }

  async adjust(input: AdjustIn): Promise<AdjustOut> {
    requireRole(STOCK_WRITERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await this.requireLot(tx, input.lotId)
        const entry: Parameters<InventoryService['post']>[1][number] = {
          lotId: input.lotId,
          locationId: input.locationId,
          qtyDelta: input.qtyDelta,
          reason: input.reason,
          refType: 'adjustment',
          idempotencyKey: input.idempotencyKey,
          ...(input.note ? { note: input.note } : {}),
        }
        const { entries, balances } = await this.inventory.post(tx, [entry])
        const written = entries[0] ?? (await this.ledgerByKey(tx, input.idempotencyKey))
        const balance = balances[0] ?? (await this.balanceOf(tx, input.lotId, input.locationId))
        return { entry: toEntry(written), balance: toBalance(balance) }
      }),
    )
  }

  async transfer(input: TransferIn): Promise<TransferOut> {
    requireRole(STOCK_WRITERS)
    if (input.fromLocationId === input.toLocationId)
      throw new ORPCError('BAD_REQUEST', { message: 'fromLocationId and toLocationId must differ' })
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await this.requireLot(tx, input.lotId)
        const note = input.note ? { note: input.note } : {}
        const { entries, balances } = await this.inventory.post(tx, [
          {
            lotId: input.lotId,
            locationId: input.fromLocationId,
            qtyDelta: -input.qtyPcs,
            reason: 'transfer_out',
            refType: 'transfer',
            refId: input.idempotencyKey,
            idempotencyKey: `${input.idempotencyKey}:out`,
            ...note,
          },
          {
            lotId: input.lotId,
            locationId: input.toLocationId,
            qtyDelta: input.qtyPcs,
            reason: 'transfer_in',
            refType: 'transfer',
            refId: input.idempotencyKey,
            idempotencyKey: `${input.idempotencyKey}:in`,
            ...note,
          },
        ])
        const out =
          entries.find((e) => e.reason === 'transfer_out') ??
          (await this.ledgerByKey(tx, `${input.idempotencyKey}:out`))
        const inn =
          entries.find((e) => e.reason === 'transfer_in') ??
          (await this.ledgerByKey(tx, `${input.idempotencyKey}:in`))
        const from =
          balances.find((b) => b.locationId === input.fromLocationId) ??
          (await this.balanceOf(tx, input.lotId, input.fromLocationId))
        const to =
          balances.find((b) => b.locationId === input.toLocationId) ??
          (await this.balanceOf(tx, input.lotId, input.toLocationId))
        return { out: toEntry(out), in: toEntry(inn), from: toBalance(from), to: toBalance(to) }
      }),
    )
  }

  /** Newest first; `cursor` is the id of the last row seen (UUIDv7 orders by time). */
  async ledger(input: LedgerIn): Promise<LedgerOut> {
    requireRole(STOCK_KEEPERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.lotId ? eq(stockLedger.lotId, input.lotId) : undefined,
        input.locationId ? eq(stockLedger.locationId, input.locationId) : undefined,
        input.from ? gte(stockLedger.occurredAt, new Date(input.from)) : undefined,
        input.to ? lt(stockLedger.occurredAt, new Date(input.to)) : undefined,
        input.cursor ? lt(stockLedger.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(stockLedger)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(stockLedger.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toEntry)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async upsertLot(input: LotIn): Promise<LotOut> {
    requireRole(STOCK_WRITERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const { lot, created } = await this.inventory.findOrCreateLot(tx, {
          id: input.id,
          variantId: input.variantId,
          batchNo: input.batchNo,
          mrpPaise: input.mrpPaise,
          mfgDate: input.mfgDate ?? null,
          expiryDate: input.expiryDate ?? null,
        })
        return { item: toLot(lot), created }
      }),
    )
  }

  private async requireLot(tx: Db, lotId: string): Promise<LotRow> {
    const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId))
    if (!lot) throw new ORPCError('NOT_FOUND', { message: `lot ${lotId} not found` })
    return lot
  }

  private async ledgerByKey(tx: Db, key: string): Promise<LedgerRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.tenantId, tenantId), eq(stockLedger.idempotencyKey, key)))
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `ledger row ${key} missing after post`,
      })
    return row
  }

  private async balanceOf(tx: Db, lotId: string, locationId: string): Promise<BalanceRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.lotId, lotId),
          eq(stockBalances.locationId, locationId),
        ),
      )
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `balance ${lotId}@${locationId} missing after post`,
      })
    return row
  }
}
