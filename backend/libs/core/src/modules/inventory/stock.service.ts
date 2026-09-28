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
import { mayPostAdjustment } from '@dos/contracts'
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
  currentTenant,
  DB,
  idempotent,
  isPrivilegeViolation,
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
import {
  damagedBinPlace,
  findFixedPlace,
  findReservableLocationId,
  FIXED_PLACE_WORDS,
  isFixedPlaceKind,
} from './reservable-location.js'

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

/**
 * Who may see per-lot balances and the ledger (permissions.ts STOCK_VIEWERS): everyone who physically keeps
 * stock (a van counts) and the accountant, who reads it. Reps and retailers get `availability` and
 * `sellable` only.
 */
export const STOCK_VIEWERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'warehouse',
  'delivery',
  'accountant',
  'system',
]

/**
 * Who may move stock and maintain locations/lots: ROLE_GROUPS.STOCK_KEEPERS plus system. The accountant
 * reads stock and writes none of it (docs/23 §2 M16, QA DOS-037). None of this touches a rate. Adding
 * stock by an adjustment is narrower (owner or manager only), checked in `adjust()` through
 * `mayPostAdjustment` (DOS-044).
 */
const STOCK_WRITERS: readonly ActorRole[] = ['owner', 'manager', 'warehouse', 'system']

/**
 * Who takes pieces OFF the books at the damaged / expiry bin — a write-off, a return to the brand, a count
 * found short (architect ruling 6, 2026-09-28: "the write-off is the desk's, from the bin"). The godown
 * only puts pieces in.
 */
const BIN_WRITERS: readonly ActorRole[] = ['owner', 'manager', 'system']

/**
 * Who takes pieces out of the bin WITHOUT writing them off — the correction of a carton binned by mistake
 * (architect ruling 2, and ruling 5 on vans and trips: the owner only). A manager's exits from the bin are the
 * desk's write-offs (`damage`, `expiry_writeoff`).
 */
const BIN_CORRECTORS: readonly ActorRole[] = ['owner', 'system']

/** The adjustment reasons that move pieces INTO the bin when taken off any other place (ruling 6). */
const TO_THE_BIN: ReadonlySet<string> = new Set(['damage', 'expiry_writeoff'])

/** A location's kind as a godown hand names it, for the refusals of `upsertLocation`. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  warehouse: 'godown',
  vehicle: 'vehicle',
  damaged: 'damaged / expiry bin',
  in_transit: 'dock',
  customer: 'shop floor',
}

/** A place as it stood before an upsert: what `assertPlaceMayChange` read, locked. */
interface PlaceWas {
  kind: string
  name: string
  active: boolean
}

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

/** The `sort: 'item'` cursor (QA DOS-253): `[variantName, variantId, lotId, locationId]` of the last row, as JSON. */
function splitItemCursor(
  cursor: string | undefined,
): { name: string; variantId: string; lotId: string; locationId: string } | null {
  if (!cursor) return null
  let parts: unknown
  try {
    parts = JSON.parse(cursor)
  } catch {
    parts = null
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 4 ||
    !parts.every((p): p is string => typeof p === 'string')
  )
    throw new ORPCError('BAD_REQUEST', {
      message: 'cursor must be the nextCursor of the previous page read with sort=item',
    })
  const [name, variantId, lotId, locationId] = parts as [string, string, string, string]
  return { name, variantId, lotId, locationId }
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
    // QA DOS-350, architect ruling 1 (2026-09-28): no place goes below zero — not a godown, not a van,
    // not the damaged / expiry bin, whose "may go negative for a claim cycle" let a hand transfer mint
    // sellable stock from nothing. The field stays in the contract (expand-only) and `false` is the only
    // answer it takes; refused before anything is written, a replayed key the same way.
    if (input.negativeAllowed)
      throw new ORPCError('BAD_REQUEST', {
        message:
          'No stock location may go below zero: every place shows only the pieces that are really in it. Save the location without "negative allowed"; a count corrects a place whose books are wrong.',
        data: { code: 'location_never_negative' },
      })
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const was = await this.assertPlaceMayChange(tx, input.id, input.kind, input.active)
        const values = {
          kind: input.kind,
          name: input.name,
          vehicleId: input.vehicleId ?? null,
          negativeAllowed: input.negativeAllowed,
          active: input.active,
        }
        try {
          // A savepoint: when the database refuses the row (0075's guards), the refusal can still name the places.
          const [row] = await tx.transaction((sp) =>
            sp
              .insert(locations)
              .values({ id: input.id, tenantId: ctx.tenantId, ...values })
              .onConflictDoUpdate({
                target: locations.id,
                set: { ...values, updatedAt: new Date() },
              })
              .returning(),
          )
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
          // the database's own copy of the rule below (migration 0075), for a writer that raced the read
          if (pgConstraint(err) === 'locations_bin_kind_fixed')
            throw new ORPCError('CONFLICT', {
              message:
                'The damaged / expiry bin stays the bin and no other place becomes one: pieces in it never go back for sale. Add a new location instead.',
              data: { code: 'location_kind_fixed', locationId: input.id },
            })
          if (pgConstraint(err) === 'locations_fixed_place')
            throw new ORPCError('CONFLICT', {
              message:
                'The godown, the dock and the damaged / expiry bin are fixed places: they stay switched on and keep their kind. You can rename one; for another place, add a new location.',
              data: { code: 'location_fixed', locationId: input.id },
            })
          if (pgConstraint(err) === 'locations_fixed_place_first')
            throw await this.takesFixedSeat(tx, input.id, input.kind, was)
          // The id is another distributor's place: the upsert's ON CONFLICT reached a row this tenant may not
          // touch, and row security refused it (42501). A sentence, not a 500; the other place is untouched.
          if (isPrivilegeViolation(err))
            throw new ORPCError('CONFLICT', {
              message:
                'Nothing was saved: this location id already belongs to a place you cannot see. Add the place again from the app; a new place gets its own id.',
              data: { code: 'location_id_taken', locationId: input.id },
            })
          throw err
        }
      }),
    )
  }

  /**
   * A PLACE KEEPS ITS KIND WHILE IT IS THE BIN OR HOLDS STOCK (QA DOS-352, architect ruling 2; the blind check's
   * V9). `sellable_stock` decides what may be sold by the place's KIND, so re-saving the damaged / expiry bin as a
   * godown put 161 damaged pieces in 14 lots straight into every rep's availability, and a hand transfer then
   * moved them into the godown — one call, by the godown login, no ledger row. So:
   *
   *   - the bin stays the bin, and no place becomes one by a new kind (its pieces would leave sale with no ledger
   *     row, and the brand's claim would read rows it never received) — 409 `location_kind_fixed`;
   *   - any other place keeps its kind while pieces stand in it or are held there — 409 `location_holds_stock`.
   *
   * THE GODOWN, THE DOCK AND THE BIN ARE FIXED PLACES (architect ruling 5 on vans and trips, 2026-09-28; the
   * second blind check). The godown login switched the bin off in one call (`active: false`, 200): a damage
   * write-off at the godown then reached no bin, and every goods receipt answered 500. The place every service
   * uses as the godown, the dock or the bin — the first active of its kind, the one `bootstrapTenant` made — is
   * never switched off and never changes kind, for every role: 409 `location_fixed`. A place the owner added
   * himself (a second godown, a claim shelf, a van) is switched off only when it holds nothing — 409
   * `location_holds_stock` otherwise, since a switched-off place drops out of every list while its pieces stay on
   * the books.
   *
   * A new place, a new name, switching a place back on and a kind change of an empty place still go. Migration
   * 0075's trigger `locations_bin_kind_fixed` is the bin rule and the fixed-place rule at the database.
   */
  private async assertPlaceMayChange(
    tx: Db,
    locationId: string,
    kind: string,
    active: boolean,
  ): Promise<PlaceWas | undefined> {
    const { tenantId } = currentTenant()
    const [was] = await tx
      .select({ kind: locations.kind, name: locations.name, active: locations.active })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
      .for('update')
    if (!was) return undefined
    const newKind = was.kind !== kind
    const switchedOff = was.active && !active
    if (!newKind && !switchedOff) return was
    if (newKind) this.assertNotIntoOrOutOfBin(was, locationId, kind)
    if (was.active && isFixedPlaceKind(was.kind)) {
      const fixed = await findFixedPlace(tx, was.kind)
      if (fixed?.id === locationId) {
        const { name, job } = FIXED_PLACE_WORDS[was.kind]
        throw new ORPCError('CONFLICT', {
          message: `${was.name} is the ${name}: ${job}, so it is a fixed place — it stays switched on and stays the ${name}. You can rename it; for another place, add a new location.`,
          data: { code: 'location_fixed', locationId, kind: was.kind },
        })
      }
    }
    const [held] = await tx
      .select({
        pcs: sql<string>`coalesce(sum(abs(${stockBalances.onHand}) + ${stockBalances.reserved}), 0)::bigint`,
      })
      .from(stockBalances)
      .where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.locationId, locationId)))
    const pcs = Number(held?.pcs ?? 0)
    if (pcs > 0 && newKind)
      throw new ORPCError('CONFLICT', {
        message: `${was.name} holds ${String(pcs)} pc, so it stays a ${KIND_WORDS[was.kind] ?? was.kind}: a new kind would change what those pieces may be sold as. Move them out first, or add a new location.`,
        data: { code: 'location_holds_stock', locationId, kind: was.kind, pcs },
      })
    if (pcs > 0)
      throw new ORPCError('CONFLICT', {
        message: `${was.name} holds ${String(pcs)} pc, so it stays switched on: a place that is switched off drops out of every list while its pieces are still on the books. Move them out first, then switch it off.`,
        data: { code: 'location_holds_stock', locationId, kind: was.kind, pcs },
      })
    return was
  }

  /**
   * NO PLACE TAKES THE SEAT OF THE GODOWN, THE DOCK OR THE BIN (vans and trips ruling 5; the third blind check's
   * blocker). The fixed place of a kind is the first ACTIVE one by id — what every service reads — so a place
   * created with a client-chosen id older than the dock's became the dock: the bills already packed onto the real
   * dock could not be loaded, cancelled or moved again, and the fixed-place rule then kept the intruder. Migration
   * 0075 refuses the row for every writer (`locations_fixed_place_first`: a new place, one switched on, one given
   * that kind, while an active place of the kind sorts after it); this is its refusal in words. A place added
   * today (UUIDv7) never sorts first, so only a crafted id or one minted on a device whose date is years behind
   * reaches it — which is what the sentence says to check.
   */
  private async takesFixedSeat(
    tx: Db,
    locationId: string,
    kind: string,
    was: PlaceWas | undefined,
  ): Promise<ORPCError<'CONFLICT', Record<string, unknown>>> {
    const fixedKind = isFixedPlaceKind(kind) ? kind : null
    const seat = fixedKind === null ? null : await findFixedPlace(tx, fixedKind)
    const data = {
      code: 'location_before_fixed',
      locationId,
      kind,
      fixedLocationId: seat?.id ?? null,
    }
    if (fixedKind === null || seat === null)
      return new ORPCError('CONFLICT', {
        message:
          'Nothing was saved: this place would take the place of the godown, the dock or the damaged / expiry bin, which are fixed places. Add a new location instead.',
        data,
      })
    const { name: fixedName, job } = FIXED_PLACE_WORDS[fixedKind]
    const kindWord = KIND_WORDS[kind] ?? kind
    if (was === undefined)
      return new ORPCError('CONFLICT', {
        message: `Nothing was saved: a new ${kindWord} with this id would take the place of ${seat.name}, the distributor's ${fixedName} — ${job} — because its id comes before ${seat.name}'s. Such an id comes from a device whose date is set in the past: check the date and time on the device, then add the place again.`,
        data,
      })
    if (was.kind !== kind)
      return new ORPCError('CONFLICT', {
        message: `${was.name} cannot become a ${kindWord}: it was made before ${seat.name}, the distributor's ${fixedName}, and would take its place — ${job}. For another ${kindWord}, add a new location.`,
        data,
      })
    return new ORPCError('CONFLICT', {
      message: `${was.name} cannot be switched on as a ${kindWord}: it was made before ${seat.name}, the distributor's ${fixedName}, and would take its place — ${job}. Leave it switched off and move any pieces out of it with a stock transfer; for another ${kindWord}, add a new location.`,
      data,
    })
  }

  /** The bin half of `assertPlaceMayChange`: no place leaves or joins the `damaged` kind (ruling 2, V9). */
  private assertNotIntoOrOutOfBin(
    was: { kind: string; name: string },
    locationId: string,
    kind: string,
  ): void {
    if (was.kind === 'damaged')
      throw new ORPCError('CONFLICT', {
        message: `${was.name} is the damaged / expiry bin and stays one: pieces in it never go back for sale, so it cannot be saved as a ${KIND_WORDS[kind] ?? kind}. They leave the bin only by a write-off or a return to the brand. For a new ${KIND_WORDS[kind] ?? kind}, add a new location.`,
        data: { code: 'location_kind_fixed', locationId, kind: was.kind },
      })
    if (kind === 'damaged')
      throw new ORPCError('CONFLICT', {
        message: `${was.name} is a ${KIND_WORDS[was.kind] ?? was.kind} and cannot become a damaged / expiry bin: damaged and expired pieces are moved into the bin with a damage or expiry write-off. For another bin, add a new location.`,
        data: { code: 'location_kind_fixed', locationId, kind: was.kind },
      })
  }

  /**
   * ATP through the `sellable_stock` view (ADR 0003). Open to every role, including retailers; no
   * on-hand split, no cost.
   *
   * SELLABLE MEANS SELLABLE (QA DOS-140). A rep and a shop were once offered the damaged / expiry bin
   * as stock they could order — 32 pieces of Marie Light in the bin read as available, and the bin
   * grows with every doorstep return. Goods in transit and a customer's own floor are the same kind of
   * lie. That predicate now lives IN THE VIEW (migration 0063, QA DOS-204): `damaged`, `in_transit`
   * and `customer` are not in `sellable_stock` at all, not even when a caller names one, so the name
   * no longer has to be defended by every reader.
   *
   * What is still this screen's own rule is the narrower one: the godowns always, a VEHICLE only when
   * that vehicle is the location asked for — which is how the crew's van sale reads its own van (D6)
   * without a van's stock ever being promised to someone else's order. Nothing is hidden from the
   * books: `stock.balances` still shows every piece wherever it stands.
   */
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
          join locations l on l.id = s.location_id
          left join brands b on b.id = p.brand_id
          where s.tenant_id = ${ctx.tenantId}
            ${input.locationId ? sql`` : sql`and l.kind = 'warehouse'`}
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
   * may take a missing item as zero. An expired batch is not counted (QA DOS-261, architect ruling 3): the
   * view leaves it out, exactly as `reserve()` never holds it, so the hint and the hold agree. Open to every
   * member, like `sellable` (TenantGuard + PERMISSIONS gate it), and a strict subset of what `sellable` shows.
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
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    const byItem = input.sort === 'item'
    // Parsed before the transaction: a malformed cursor is the caller's 400, not a rolled-back read.
    const after = byItem ? null : splitCursor(input.cursor)
    const afterItem = byItem ? splitItemCursor(input.cursor) : null
    // QA DOS-253: a server-side search over every row, not a filter over the page a screen fetched.
    const like = input.q ? `%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
    return withTenant(db, currentTenant(), async (tx) => {
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
        // QA DOS-234: the lots actually standing here, not every lot that ever did.
        input.nonZero ? sql`${stockBalances.onHand} <> 0` : undefined,
        like
          ? sql`(${productVariants.name} ilike ${like} or ${products.name} ilike ${like} or ${stockLots.batchNo} ilike ${like})`
          : undefined,
        after
          ? sql`(${stockBalances.lotId}, ${stockBalances.locationId}) > (${after.lotId}, ${after.locationId})`
          : undefined,
        afterItem
          ? sql`(${productVariants.name}, ${stockLots.variantId}, ${stockBalances.lotId}, ${stockBalances.locationId}) > (${afterItem.name}, ${afterItem.variantId}, ${afterItem.lotId}, ${afterItem.locationId})`
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
        .orderBy(
          ...(byItem
            ? [
                asc(productVariants.name),
                asc(stockLots.variantId),
                asc(stockBalances.lotId),
                asc(stockBalances.locationId),
              ]
            : [asc(stockBalances.lotId), asc(stockBalances.locationId)]),
        )
        .limit(input.limit + 1)
      const items: StockBalanceRow[] = rows.slice(0, input.limit)
      const last = items[items.length - 1]
      const more = rows.length > input.limit && last !== undefined
      return {
        items,
        nextCursor: !more
          ? null
          : byItem
            ? JSON.stringify([last.variantName, last.variantId, last.lotId, last.locationId])
            : `${last.lotId}:${last.locationId}`,
      }
    })
  }

  async adjust(input: AdjustIn): Promise<AdjustOut> {
    requireRole(STOCK_WRITERS)
    const ctx = currentTenant()
    // DOS-044: only the owner or a manager puts pieces INTO the books by hand; every other role only
    // takes stock off. Refused before the transaction and before `idempotent()`, so nothing is written
    // and a replayed key is refused the same way.
    if (!mayPostAdjustment(ctx.actorRole, input.reason, input.qtyDelta))
      throw new ORPCError('FORBIDDEN', {
        message:
          'Only the owner or a manager can add stock or post opening stock. If the rack holds more than the books show, record a count and tell the desk; goods arriving come in on a GRN.',
        data: { code: 'stock_add_desk_only', reason: input.reason, qtyDelta: input.qtyDelta },
      })
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        // QA DOS-358: a van's books are not changed by hand until its trip is settled — not by a damage
        // adjustment while it is on the road, not by an owner's correction while it is checked in.
        await this.inventory.assertVehicleNotOut(tx, input.locationId, { untilSettled: true })
        await this.requireLot(tx, input.lotId)
        const place = await this.placeOf(tx, input.locationId)
        // Architect ruling 6 (2026-09-28): the write-off is the DESK'S, from the bin. The godown puts
        // damaged and expired pieces into the bin; only the owner or a manager takes them off the books
        // there (a write-off, a return to the brand, a count). Refused before anything is written.
        if (place.kind === 'damaged' && input.qtyDelta < 0 && !BIN_WRITERS.includes(ctx.actorRole))
          throw new ORPCError('FORBIDDEN', {
            message: `Pieces leave ${place.name} only by the desk's write-off or a return to the brand: ask the owner or a manager. The godown moves damaged and expired pieces into the bin and nothing out of it.`,
            data: { code: 'bin_writeoff_desk_only', locationId: input.locationId },
          })
        // A CARTON BINNED BY MISTAKE IS THE OWNER'S CORRECTION (ruling 2, and ruling 5 on vans and trips: "by the
        // OWNER only"; the second blind check found it open to a manager). Pieces leave the bin without being
        // written off — a plain correction, a count by hand, an opening — only by the owner; a manager takes
        // pieces off the books at the bin only as a damage or expiry write-off (ruling 6, the desk's write-off).
        // `stock.adjust` is the only door for such a row (the ledger's other movers never post `refType
        // adjustment`), and the check sits before anything is written.
        if (
          place.kind === 'damaged' &&
          input.qtyDelta < 0 &&
          !TO_THE_BIN.has(input.reason) &&
          !BIN_CORRECTORS.includes(ctx.actorRole)
        )
          throw new ORPCError('FORBIDDEN', {
            message: `Only the owner takes pieces out of ${place.name} without writing them off: a carton put in the bin by mistake is the owner's correction, with a reason. A manager writes damaged or expired pieces off from the bin as a damage or expiry write-off.`,
            data: {
              code: 'bin_correction_owner_only',
              locationId: input.locationId,
              reason: input.reason,
            },
          })
        // ...and "with a reason" (ruling 2): the owner's correction out of the bin says why in words, which the ledger
        // row keeps as its note — the reason code alone ("adjustment") does not say that the carton was sound.
        if (
          place.kind === 'damaged' &&
          input.qtyDelta < 0 &&
          !TO_THE_BIN.has(input.reason) &&
          (input.note ?? '').trim() === ''
        )
          throw new ORPCError('BAD_REQUEST', {
            message: `Write why these pieces leave ${place.name} without a write-off — for example "binned by mistake, carton is sound" — and save again: the owner's correction out of the bin always carries its reason.`,
            data: {
              code: 'bin_correction_needs_note',
              locationId: input.locationId,
              reason: input.reason,
            },
          })
        if (input.qtyDelta < 0)
          await this.assertNotHeldOnDock(tx, input.locationId, input.lotId, -input.qtyDelta)
        const note = input.note ? { note: input.note } : {}
        const entry: Parameters<InventoryService['post']>[1][number] = {
          lotId: input.lotId,
          locationId: input.locationId,
          qtyDelta: input.qtyDelta,
          reason: input.reason,
          refType: 'adjustment',
          idempotencyKey: input.idempotencyKey,
          ...note,
        }
        /*
         * DAMAGED IN THE GODOWN MEANS MOVED TO THE BIN (architect ruling 6, QA phase 10 question 5). A
         * `damage` or `expiry_writeoff` taken off a godown, a van or the dock used to write the pieces off
         * the books there and then: nothing reached the bin, so the brand's damage / expiry claim — built
         * from the rows posted INTO the bin — never saw them, and the desk never decided. They now leave the
         * place and land in the damaged / expiry bin under the same reason, the pair keyed on this call, and
         * the desk writes them off from there. The bin is a fixed place nobody can switch off (ruling 5 on vans
         * and trips): a distributor without one is refused in words (409 `place_missing`) instead of the old
         * silent write-off at the godown, which by-passed the desk and the brand's claim.
         */
        const bin =
          input.qtyDelta < 0 && place.kind !== 'damaged' && TO_THE_BIN.has(input.reason)
            ? await damagedBinPlace(tx)
            : null
        const binKey = `${input.idempotencyKey}:bin`
        const pair: Parameters<InventoryService['post']>[1] =
          bin === null
            ? [entry]
            : [
                { ...entry, refId: input.idempotencyKey },
                {
                  ...entry,
                  locationId: bin.id,
                  qtyDelta: -input.qtyDelta,
                  refId: input.idempotencyKey,
                  idempotencyKey: binKey,
                },
              ]
        const { entries, balances } = await this.inventory.post(tx, pair)
        const written =
          entries.find((e) => e.idempotencyKey === input.idempotencyKey) ??
          (await this.ledgerByKey(tx, input.idempotencyKey))
        const balance =
          balances.find((b) => b.locationId === input.locationId) ??
          (await this.balanceOf(tx, input.lotId, input.locationId))
        if (bin === null) return { entry: toEntry(written), balance: toBalance(balance) }
        const binEntry =
          entries.find((e) => e.idempotencyKey === binKey) ?? (await this.ledgerByKey(tx, binKey))
        const binBalance =
          balances.find((b) => b.locationId === bin.id) ??
          (await this.balanceOf(tx, input.lotId, bin.id))
        return {
          entry: toEntry(written),
          balance: toBalance(balance),
          movedToBin: {
            locationName: bin.name,
            entry: toEntry(binEntry),
            balance: toBalance(binBalance),
          },
        }
      }),
    )
  }

  /** The kind and the name of one of this tenant's locations; 404 when it is not one. */
  private async placeOf(tx: Db, locationId: string): Promise<{ kind: string; name: string }> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ kind: locations.kind, name: locations.name })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `location ${locationId} not found` })
    return row
  }

  async transfer(input: TransferIn): Promise<TransferOut> {
    requireRole(STOCK_WRITERS)
    if (input.fromLocationId === input.toLocationId)
      throw new ORPCError('BAD_REQUEST', { message: 'fromLocationId and toLocationId must differ' })
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        // Both vans (when either is one) are locked first and in one order, before any balance row, so a hand move
        // and a load-out on the same van queue instead of both reading it free (vans and trips 1, QA verify 3).
        await this.inventory.lockVehicleLocations(tx, [input.fromLocationId, input.toLocationId])
        await this.requireLot(tx, input.lotId)
        /*
         * NOTHING LEAVES THE DAMAGED BIN FOR SALE (QA DOS-352, architect ruling 2, 2026-09-28). A godown
         * login moved damaged cartons back into the godown and onto a van with one tap, no reason and no
         * approval, and they were a rep's availability at once. The bin's only exits are a write-off and a
         * return to the brand; a carton binned by mistake is corrected by the owner's stock adjustment with a
         * reason, which records who and why. For every role. A move INTO the bin stays: that is "damaged in
         * the godown" (ruling 6); bin to bin stays too.
         */
        const source = await this.placeOf(tx, input.fromLocationId)
        const target = await this.placeOf(tx, input.toLocationId)
        if (source.kind === 'damaged' && target.kind !== 'damaged')
          throw new ORPCError('CONFLICT', {
            message: `Pieces in ${source.name} never go back for sale, so they cannot be moved to ${target.name}. They leave the bin only by a write-off or a return to the brand. If a carton went into the bin by mistake, the owner corrects it with a stock adjustment and a reason.`,
            data: {
              code: 'damaged_not_for_sale',
              fromLocationId: input.fromLocationId,
              toLocationId: input.toLocationId,
            },
          })
        await this.assertNotHeldOnDock(tx, input.fromLocationId, input.lotId, input.qtyPcs)
        // QA DOS-358: nothing comes off a van by hand until its trip is settled (the van check-in counts it off).
        await this.inventory.assertVehicleNotOut(tx, input.fromLocationId, { untilSettled: true })
        // Vans and trips 1: nor goes onto one — a van carries one trip at a time, loaded through its load sheet.
        await this.inventory.assertVehicleNotOut(tx, input.toLocationId, {
          untilSettled: true,
          onto: true,
        })
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

  /**
   * PACKED PIECES LEAVE THE DOCK WITH THEIR BILL, NEVER BY HAND (QA DOS-247). A bill's pieces stand on the dock
   * under a hold; its load sheet, its cancel or its credit note takes them off and ends the hold. A hand
   * transfer or adjustment out of the dock may move only what the dock holds for nobody — otherwise the hold
   * would outlive its pieces, and the next load would find a bill "covered" by cartons that are gone. 409
   * `dock_held`, saying how many are free to move.
   */
  private async assertNotHeldOnDock(
    tx: Db,
    locationId: string,
    lotId: string,
    qtyPcs: number,
  ): Promise<void> {
    const { tenantId } = currentTenant()
    const [loc] = await tx
      .select({ kind: locations.kind })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
      .limit(1)
    if (loc?.kind !== 'in_transit') return
    const [balance] = await tx
      .select({ onHand: stockBalances.onHand, reserved: stockBalances.reserved })
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.lotId, lotId),
          eq(stockBalances.locationId, locationId),
        ),
      )
      .for('update')
    const reserved = Number(balance?.reserved ?? 0)
    if (reserved <= 0) return
    const free = Math.max(0, Number(balance?.onHand ?? 0) - reserved)
    if (qtyPcs <= free) return
    throw new ORPCError('CONFLICT', {
      message: `${String(reserved)} pc of this batch on the dock are packed for bills, and only ${String(free)} are free to move by hand. Packed pieces leave the dock with their bill — its load sheet, its cancel or its credit note`,
      data: { code: 'dock_held', heldPcs: reserved, freePcs: free, askedPcs: qtyPcs },
    })
  }

  /**
   * NEWEST FIRST by `occurred_at`, the ledger's own time and the one the screen prints, the row id only
   * breaking a tie — the same column `from`/`to` filter, so the window and the order never disagree
   * (QA DOS-186; the founder's list rule, 2026-09-21). It used to order by `id` alone, on the assumption
   * that a UUIDv7 is the posting's time: it is not. Ids are minted on the device, the demo seed's are
   * hashes that sort above every real row, and a legitimately back-dated posting (an opening balance, a
   * late GRN) carries its own `occurred_at`. `cursor` is the id of the last row of the page and walks
   * that same (`occurred_at`, id) order.
   */
  async ledger(input: LedgerIn): Promise<LedgerOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        /*
         * RLS is the guarantee; the literal is what lets the planner start from the tenant-led
         * `stock_ledger_time_idx (tenant_id, occurred_at, id)` instead of scanning (docs/20 rule 8).
         */
        eq(stockLedger.tenantId, ctx.tenantId),
        input.lotId ? eq(stockLedger.lotId, input.lotId) : undefined,
        input.locationId ? eq(stockLedger.locationId, input.locationId) : undefined,
        input.from ? gte(stockLedger.occurredAt, new Date(input.from)) : undefined,
        input.to ? lt(stockLedger.occurredAt, new Date(input.to)) : undefined,
        /*
         * Keyset on the cursor row's own (occurred_at, id), read inside this tenant's transaction with
         * its own tenant fence, so the comparison keeps Postgres's microseconds and no other
         * distributor's row can anchor a page. An unknown cursor matches nothing (the DOS-009/DOS-023
         * convention).
         */
        input.cursor
          ? sql`(${stockLedger.occurredAt}, ${stockLedger.id}) < (select c.occurred_at, c.id from stock_ledger c where c.tenant_id = ${ctx.tenantId} and c.id = ${input.cursor})`
          : undefined,
      ]
      // The item and batch ride along (QA DOS-257): a movement the reader cannot name is no use to him.
      // Both joins are on primary keys of the page's own rows, so they add no scan.
      const rows = await tx
        .select({
          row: stockLedger,
          variantName: productVariants.name,
          batchNo: stockLots.batchNo,
        })
        .from(stockLedger)
        .innerJoin(stockLots, eq(stockLots.id, stockLedger.lotId))
        .innerJoin(productVariants, eq(productVariants.id, stockLots.variantId))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(stockLedger.occurredAt), desc(stockLedger.id))
        .limit(input.limit + 1)
      const items = rows
        .slice(0, input.limit)
        .map((r) => ({ ...toEntry(r.row), variantName: r.variantName, batchNo: r.batchNo }))
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
