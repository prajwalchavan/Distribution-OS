import { ORPCError } from '@orpc/server'
import { and, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm'
import { businessDate } from '@dos/domain'
import { packConfirmations, pickLines, picklists, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { istDateWord } from '../../platform/refusal-words.js'
import { fulfilPlaceRefusal, type InventoryService } from '../inventory/index.js'
import type { OrdersService } from '../orders/index.js'
import { MAX_PICK_ROWS, type LotRow } from './warehouse.internals.js'

/**
 * THE THREE STOCK RULES OF THE GODOWN FLOOR (architect rulings of 2026-09-28, QA phases 10 + 9), shared by the
 * pick (`PicklistsService.applyPicks`, online and offline) and the pack (`PackingService.confirm`):
 *
 *   (3) EXPIRED GOODS ARE NEVER SOLD (QA DOS-351). A batch whose expiry date is before today's IST business date
 *       is refused at pick and at pack, whatever the sheet suggested. A SHORT-dated batch still only warns
 *       (the 13 Sep ruling, QA DOS-054): that is `short_shelf_life`, not this.
 *   (7) A PICK TAKES ONLY ITS OWN HELD PIECES PLUS FREE ONES (QA DOS-353). A line may take from a batch at most
 *       what the godown holds for THAT line plus what it holds for nobody; the pieces promised to another
 *       confirmed order stay on the rack for it, and the refusal names that order.
 *   A PACKED ORDER'S PICK IS HISTORY (QA DOS-361). Its pieces left the rack at pack and its bill was made from
 *       them, so a row of it on a still-live wave is never edited again.
 *
 * Each refusal is a 409 with a `data.code` the offline handler carries into its sync rejection unchanged, and a
 * sentence a godown hand can act on: the batch and the item by name, the date, the pieces, the order.
 */

/** Today in IST, the day a batch is judged against (never `current_date`, which is UTC). */
export const todayIst = (): string => businessDate().date

/** `23 Sep 2026`: an expiry date as a person reads it, with the year a batch date needs. */
export const expiryWords = (isoDate: string): string =>
  `${istDateWord(isoDate)} ${isoDate.slice(0, 4)}`

/** "Sunbake Choco Chip Cookies batch P10-B-EXP", or the item alone for a lot with no batch number. */
export function batchWords(lot: Pick<LotRow, 'batchNo' | 'id'>, item: string | undefined): string {
  const name = item ?? 'this item'
  return lot.batchNo === '' ? `${name} (no batch number)` : `${name} batch ${lot.batchNo}`
}

/** True when the lot's expiry date is before `today` (a lot with no expiry never expires). */
export const isExpired = (lot: Pick<LotRow, 'expiryDate'>, today: string): boolean =>
  lot.expiryDate !== null && lot.expiryDate < today

/** The codes of the refusals above, which `warehouse.sync.ts` hands to the device as its rejection code. */
export const STOCK_RULE_CODES = new Set([
  'batch_expired',
  'held_for_another_order',
  'order_packed',
  'fulfil_location_not_sellable',
])

/**
 * AN ORDER IS SERVED FROM A GODOWN (architect ruling of 2026-09-28, the last stock row; QA verify 4, N1). An order
 * already in the database that names a van — drafted before the ruling, when a rep's order naming van C held and
 * then packed the pieces of another trip's loaded bill — or the bin, the dock or a shop's floor, is refused at pick
 * and at pack with the sentence of its place, before anything moves (offline: the pick keeps this code). The van
 * sale's own order never comes here: it is billed off its van inside its own door. The exit is the desk's cancel,
 * which frees its holds; placed again without a location, it is picked and packed from the godown.
 */
export async function assertServedFromGodown(
  tx: Db,
  order: { orderNo: string | null; fulfilFromLocationId: string | null },
  at: 'pick' | 'pack',
): Promise<void> {
  if (order.fulfilFromLocationId === null) return
  const refusal = await fulfilPlaceRefusal(tx, order.fulfilFromLocationId)
  if (refusal === null) return
  const place = refusal.name ?? `location ${refusal.locationId}`
  throw new ORPCError('CONFLICT', {
    message: `${order.orderNo ?? 'This order'} is set to be served from ${place}, so it is not ${at === 'pick' ? 'picked' : 'packed'}: ${refusal.why} An order is served from a godown: cancel it and place it again without a location; it is then picked and packed from the godown.`,
    data: { code: refusal.code, locationId: refusal.locationId },
  })
}

/** Which of these orders already have a pack confirmation (warehouse's own table). */
export async function packedOrders(tx: Db, orderIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(orderIds)]
  if (ids.length === 0) return new Set()
  const rows = await tx
    .select({ orderId: packConfirmations.orderId })
    .from(packConfirmations)
    .where(
      and(
        eq(packConfirmations.tenantId, currentTenant().tenantId),
        inArray(packConfirmations.orderId, ids),
      ),
    )
  return new Set(rows.map((r) => r.orderId))
}

/** `lineId␀lotId`: one order line's pieces of one batch. */
export const lineLot = (orderLineId: string, lotId: string): string =>
  `${orderLineId}\u0000${lotId}`
const splitLineLot = (key: string): [string, string] => {
  const at = key.indexOf('\u0000')
  return [key.slice(0, at), key.slice(at + 1)]
}

/**
 * Pieces recorded on OTHER live waves against these lots, per order line and lot, for orders not yet packed
 * (a packed order's pieces have already left the rack, so they no longer compete for what stands there).
 */
async function picksOnOtherWaves(
  tx: Db,
  sheetId: string,
  lotIds: readonly string[],
): Promise<Map<string, number>> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      orderLineId: pickLines.orderLineId,
      lotId: pickLines.lotId,
      picked: sql<number>`coalesce(sum(${pickLines.pickedQtyPcs}), 0)::int`,
    })
    .from(pickLines)
    .innerJoin(picklists, eq(picklists.id, pickLines.picklistId))
    .where(
      and(
        eq(pickLines.tenantId, tenantId),
        ne(pickLines.picklistId, sheetId),
        inArray(picklists.status, ['open', 'picking', 'picked']),
        isNull(pickLines.cancelledAt),
        inArray(pickLines.lotId, [...lotIds]),
        sql`${pickLines.pickedQtyPcs} > 0`,
        notExists(
          tx
            .select({ one: sql`1` })
            .from(packConfirmations)
            .where(
              and(
                eq(packConfirmations.tenantId, tenantId),
                eq(packConfirmations.orderId, pickLines.orderId),
              ),
            ),
        ),
      ),
    )
    .groupBy(pickLines.orderLineId, pickLines.lotId)
  const out = new Map<string, number>()
  for (const r of rows)
    if (r.lotId !== null) out.set(lineLot(r.orderLineId, r.lotId), Number(r.picked))
  return out
}

/** Pending holds at `locationId` of these order lines, per line and lot. */
async function holdsOf(
  tx: Db,
  inventory: InventoryService,
  locationId: string,
  orderLineIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(orderLineIds)]
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  for (const hold of await inventory.listReservations(tx, {
    orderLineIds: ids,
    locationId,
    state: 'pending',
    limit: MAX_PICK_ROWS,
  })) {
    if (hold.lotId === null) continue
    const key = lineLot(hold.orderLineId, hold.lotId)
    out.set(key, (out.get(key) ?? 0) + hold.qtyPcs)
  }
  return out
}

/**
 * The orders that hold pieces of `lot` at `locationId`, other than `exceptLineIds` — the names a refusal gives
 * for "those pieces are someone else's". Read for the sentence only, so one bounded page is enough.
 */
async function holdersOf(
  tx: Db,
  inventory: InventoryService,
  orders: OrdersService,
  locationId: string,
  lot: Pick<LotRow, 'id' | 'variantId'>,
  exceptLineIds: ReadonlySet<string>,
): Promise<string[]> {
  const holds = (
    await inventory.listReservations(tx, {
      variantId: lot.variantId,
      locationId,
      state: 'pending',
      limit: MAX_PICK_ROWS,
    })
  ).filter((h) => h.lotId === lot.id && !exceptLineIds.has(h.orderLineId) && h.qtyPcs > 0)
  const owners = await orders.orderLineOwners(
    tx,
    holds.map((h) => h.orderLineId),
  )
  return [
    ...new Set(
      holds.map((h) => {
        const owner = owners.get(h.orderLineId)
        return owner?.orderNo ?? owner?.orderId ?? 'another order'
      }),
    ),
  ]
}

function heldForAnother(i: {
  orderNo: string
  what: string
  allowed: number
  own: number
  free: number
  recorded: number
  holders: string[]
  atPack: boolean
}): ORPCError<'CONFLICT', { code: string; allowedPcs: number; recordedPcs: number }> {
  const share = `${String(i.own)} held for it${i.free > 0 ? ` and ${String(i.free)} free` : ', none free'}`
  const others =
    i.holders.length > 0
      ? `The other pieces of that batch are held for ${i.holders.join(', ')}: leave them on the rack for ${i.holders.length === 1 ? 'that order' : 'those orders'}`
      : 'The godown has no more of that batch for it'
  const next = i.atPack
    ? `record ${i.orderNo}'s pick again with what is really in its carton, and the rest as short with a reason.`
    : `record the rest of ${i.orderNo} as short, with a reason.`
  return new ORPCError('CONFLICT', {
    message: `${i.orderNo} may take ${String(i.allowed)} pc of ${i.what} (${share}) and ${String(i.recorded)} ${i.atPack ? 'are packed' : 'were recorded'}. ${others}; ${next}`,
    data: { code: 'held_for_another_order', allowedPcs: i.allowed, recordedPcs: i.recorded },
  })
}

/**
 * QA DOS-353 AT PICK. `before` and `after` are this sheet's rows around the call; only a (line, batch) whose
 * recorded pieces GROW is judged, so a correction downwards is never refused, even on a line already over its
 * share before this rule existed.
 *
 * The share: what the godown holds for the line on that batch, plus the batch's free pieces (`on_hand −
 * reserved`, read under the balance row's lock) less what other lines have already recorded beyond their own
 * holds on it, on this wave or another live one — so two short orders cannot both take the same free carton.
 */
export async function assertPicksWithinShare(
  tx: Db,
  deps: { inventory: InventoryService; orders: OrdersService },
  sheet: { id: string; locationId: string },
  before: readonly {
    orderLineId: string
    orderId: string
    lotId: string | null
    pickedQtyPcs: number
    cancelledAt: Date | null
  }[],
  after: readonly {
    orderLineId: string
    orderId: string
    lotId: string | null
    pickedQtyPcs: number
    cancelledAt: Date | null
  }[],
  lots: ReadonlyMap<string, LotRow>,
  itemOf: (variantId: string) => string | undefined,
  packed: ReadonlySet<string>,
): Promise<void> {
  const total = (rows: typeof after): Map<string, number> => {
    const out = new Map<string, number>()
    for (const r of rows) {
      if (r.cancelledAt !== null || r.lotId === null || packed.has(r.orderId)) continue
      const key = lineLot(r.orderLineId, r.lotId)
      out.set(key, (out.get(key) ?? 0) + r.pickedQtyPcs)
    }
    return out
  }
  const was = total(before)
  const now = total(after)
  const grown = [...now].filter(([key, pcs]) => pcs > (was.get(key) ?? 0))
  if (grown.length === 0) return
  const lotIds = [...new Set(grown.map(([key]) => splitLineLot(key)[1]))]
  const onLots = new Map([...now].filter(([key]) => lotIds.includes(splitLineLot(key)[1])))
  for (const [key, pcs] of await picksOnOtherWaves(tx, sheet.id, lotIds))
    onLots.set(key, (onLots.get(key) ?? 0) + pcs)
  const holds = await holdsOf(
    tx,
    deps.inventory,
    sheet.locationId,
    [...onLots.keys()].map((key) => splitLineLot(key)[0]),
  )
  const free = await deps.inventory.freeAt(tx, sheet.locationId, lotIds)
  for (const [key, recorded] of grown) {
    const [orderLineId, lotId] = splitLineLot(key)
    const own = holds.get(key) ?? 0
    let othersBeyond = 0
    for (const [otherKey, pcs] of onLots) {
      const [otherLine, otherLot] = splitLineLot(otherKey)
      if (otherLot !== lotId || otherLine === orderLineId) continue
      othersBeyond += Math.max(0, pcs - (holds.get(otherKey) ?? 0))
    }
    const freeForIt = Math.max(0, (free.get(lotId) ?? 0) - othersBeyond)
    const allowed = own + freeForIt
    if (recorded <= allowed) continue
    const lot = lots.get(lotId)
    const owner = (await deps.orders.orderLineOwners(tx, [orderLineId])).get(orderLineId)
    const holders = lot
      ? await holdersOf(
          tx,
          deps.inventory,
          deps.orders,
          sheet.locationId,
          lot,
          new Set([orderLineId]),
        )
      : []
    throw heldForAnother({
      orderNo: owner?.orderNo ?? 'this order',
      what: lot ? batchWords(lot, itemOf(lot.variantId)) : `batch ${lotId}`,
      allowed,
      own,
      free: freeForIt,
      recorded,
      holders,
      atPack: false,
    })
  }
}

/**
 * QA DOS-353 AT PACK: the pieces an order is about to move off the rack, per batch, against what the godown holds
 * for that order plus what it holds for nobody — the same share as at pick, so a pick recorded before the rule
 * existed cannot bill what belongs to another order. The balance rows are read under their lock, and the pack
 * moves them in the same transaction.
 */
export async function assertPackWithinShare(
  tx: Db,
  deps: { inventory: InventoryService; orders: OrdersService },
  order: { id: string; orderNo: string | null },
  locationId: string,
  lines: readonly { orderLineId: string; picks: readonly { lotId: string; qtyPcs: number }[] }[],
  lots: ReadonlyMap<string, LotRow>,
  itemOf: (variantId: string) => string | undefined,
): Promise<void> {
  const need = new Map<string, number>()
  for (const line of lines)
    for (const pick of line.picks)
      if (pick.qtyPcs > 0) need.set(pick.lotId, (need.get(pick.lotId) ?? 0) + pick.qtyPcs)
  if (need.size === 0) return
  const lineIds = lines.map((l) => l.orderLineId)
  const holds = await holdsOf(tx, deps.inventory, locationId, lineIds)
  const own = new Map<string, number>()
  for (const [key, pcs] of holds) {
    const lotId = splitLineLot(key)[1]
    own.set(lotId, (own.get(lotId) ?? 0) + pcs)
  }
  const free = await deps.inventory.freeAt(tx, locationId, [...need.keys()])
  for (const [lotId, pcs] of need) {
    const ownPcs = own.get(lotId) ?? 0
    const freePcs = free.get(lotId) ?? 0
    if (pcs <= ownPcs + freePcs) continue
    const lot = lots.get(lotId)
    throw heldForAnother({
      orderNo: order.orderNo ?? 'this order',
      what: lot ? batchWords(lot, itemOf(lot.variantId)) : `batch ${lotId}`,
      allowed: ownPcs + freePcs,
      own: ownPcs,
      free: freePcs,
      recorded: pcs,
      holders: lot
        ? await holdersOf(tx, deps.inventory, deps.orders, locationId, lot, new Set(lineIds))
        : [],
      atPack: true,
    })
  }
}

/** QA DOS-351: the refusal for a batch past its expiry, at pick (`atPack` false) or at pack. */
export function expiredBatch(i: {
  what: string
  expiryDate: string
  pcs: number
  orderNo: string | null
  atPack: boolean
}): ORPCError<'CONFLICT', { code: string; expiryDate: string }> {
  const when = expiryWords(i.expiryDate)
  return new ORPCError('CONFLICT', {
    message: i.atPack
      ? `${i.orderNo ?? 'This order'} cannot be packed: ${String(i.pcs)} pc of it are ${i.what}, which expired on ${when}. Expired goods are never billed or sent — record the pick again from an in-date batch, and move the expired pieces into the damaged / expiry bin with Move on the Stock screen.`
      : `${i.what} expired on ${when}. Expired goods are never sold — pick an in-date batch, and move the expired pieces into the damaged / expiry bin with Move on the Stock screen.`,
    data: { code: 'batch_expired', expiryDate: i.expiryDate },
  })
}

/** QA DOS-361: the refusal for a pick row of an order that has already been packed. */
export function orderAlreadyPacked(orderNo: string): ORPCError<'CONFLICT', { code: string }> {
  return new ORPCError('CONFLICT', {
    message: `${orderNo} is already packed, so its pick cannot change any more: its bill and its stock were made from what was recorded. If the carton went out wrong, the desk corrects the bill with a credit note.`,
    data: { code: 'order_packed' },
  })
}

/**
 * WHERE STOCK IS DRAWN FROM (architect ruling 6 of 2026-09-28, vans and trips; ruling 2 of the stock rulings): a
 * wave is picked, and a load sheet's van stock drawn, from a godown or a van — never from the damaged / expiry bin
 * (nothing leaves it for sale), the dock (its pieces are packed for their bills) or a shop's floor. Refused when
 * the wave or the sheet is MADE, not only when stock would move: 404 for a place that is not this distributor's,
 * 409 `damaged_not_for_sale` for the bin, 409 `source_not_sellable` for the others. Null when the place may be used.
 */
export function sourceRefusal(
  place: { name: string; kind: string } | null,
  locationId: string,
  what: 'wave' | 'load sheet',
): ORPCError<'NOT_FOUND' | 'CONFLICT', Record<string, unknown>> | null {
  if (place === null)
    return new ORPCError('NOT_FOUND', {
      message: `location ${locationId} is not one of this distributor's places`,
      data: { code: 'location_not_found', locationId },
    })
  if (place.kind === 'warehouse' || place.kind === 'vehicle') return null
  const instead =
    what === 'wave' ? 'Wave the orders from the godown.' : 'Draw the van stock from the godown.'
  if (place.kind === 'damaged')
    return new ORPCError('CONFLICT', {
      message: `A ${what} is never drawn from ${place.name}: pieces in the damaged / expiry bin never go back for sale. They leave the bin only by a write-off or a return to the brand. ${instead}`,
      data: { code: 'damaged_not_for_sale', locationId },
    })
  const why =
    place.kind === 'in_transit'
      ? 'the pieces standing on the dock are already packed for their bills'
      : 'those pieces stand at a shop, not in the godown'
  return new ORPCError('CONFLICT', {
    message: `A ${what} is never drawn from ${place.name}: ${why}. ${instead}`,
    data: { code: 'source_not_sellable', locationId, kind: place.kind },
  })
}
