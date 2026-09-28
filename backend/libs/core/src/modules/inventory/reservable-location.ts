import { ORPCError } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import { locations, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * THE GODOWN: the one location an order reserves from and is packed out of when it names none of its own —
 * the first active `kind = 'warehouse'` location, by id.
 *
 * One rule in one place (DOS-074), because three things must agree on it: `orders` reserves stock there at
 * confirm, `warehouse` packs and loads out of it, and `stock.availability` tells a rep or a shop what is left
 * to promise there. A hint that summed every warehouse would promise pieces no order can ever reserve.
 * `locations` is inventory's table and inventory sits upstream of both modules, so they delegate here.
 *
 * `null` when the distributor has no active warehouse yet (not bootstrapped).
 */
export async function findReservableLocationId(tx: Db): Promise<string | null> {
  return (await findFixedPlace(tx, 'warehouse'))?.id ?? null
}

/** The godown, refusing a distributor that has none: nothing can be reserved or packed without one. */
export async function reservableLocationId(tx: Db): Promise<string> {
  const id = await findReservableLocationId(tx)
  if (id === null) throw placeMissing('warehouse')
  return id
}

/**
 * THE FIXED PLACES (architect ruling 5 on vans and trips, 2026-09-28): the godown, the dock and the damaged /
 * expiry bin that `bootstrapTenant` gives every distributor. Every service finds each of them the same way — the
 * first ACTIVE place of its kind, by id (UUIDv7, so the one the bootstrap made before any other) — and a second
 * godown, a claim shelf or a van added later never displaces it. Nobody switches one off or changes its kind
 * (`StockService.upsertLocation`, and migration 0075's trigger `locations_bin_kind_fixed` for every writer):
 * with the bin switched off, a godown's damage write-off stopped reaching any bin and every goods receipt failed.
 */
export const FIXED_PLACE_KINDS = ['warehouse', 'damaged', 'in_transit'] as const
export type FixedPlaceKind = (typeof FIXED_PLACE_KINDS)[number]

export function isFixedPlaceKind(kind: string): kind is FixedPlaceKind {
  return (FIXED_PLACE_KINDS as readonly string[]).includes(kind)
}

/** What each fixed place is called and what it is for, in the words a refusal uses. */
export const FIXED_PLACE_WORDS: Readonly<Record<FixedPlaceKind, { name: string; job: string }>> = {
  warehouse: {
    name: 'godown',
    job: 'orders are held and packed there and goods are received into it',
  },
  damaged: {
    name: 'damaged / expiry bin',
    job: 'damaged and expired pieces go there and nowhere else',
  },
  in_transit: { name: 'dock', job: 'packed goods wait there for their van' },
}

/** The distributor's godown, dock or bin: the first active place of that kind, by id. Null when it has none. */
export async function findFixedPlace(
  tx: Db,
  kind: FixedPlaceKind,
): Promise<{ id: string; name: string } | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(
      and(eq(locations.tenantId, tenantId), eq(locations.kind, kind), eq(locations.active, true)),
    )
    .orderBy(asc(locations.id))
    .limit(1)
  return row ?? null
}

/**
 * 409 `place_missing` — a distributor without its godown, dock or bin. `bootstrapTenant` makes all three and
 * nobody can switch one off, so only a distributor that was never set up reaches this: a sentence that says what
 * could not happen and what to do, never a 500 (the blind check's goods receipt answered "tenant has no damaged
 * location (bootstrap)" with a 500 after the godown login had switched the bin off).
 */
export function placeMissing(kind: FixedPlaceKind): ORPCError<'CONFLICT', Record<string, unknown>> {
  const { name, job } = FIXED_PLACE_WORDS[kind]
  return new ORPCError('CONFLICT', {
    message: `Nothing was saved: this distributor has no ${name}, and ${job}. The ${name} is one of the places every distributor is set up with; ask support to set this distributor's places up again, then try once more.`,
    data: { code: 'place_missing', kind },
  })
}

/** The damaged / expiry bin, refusing in words a distributor that has none (a goods receipt, a write-off). */
export async function damagedBinPlace(tx: Db): Promise<{ id: string; name: string }> {
  const bin = await findFixedPlace(tx, 'damaged')
  if (bin === null) throw placeMissing('damaged')
  return bin
}

/** Why an order is never packed out of a place of this kind, in the words a refusal uses. */
const NOT_PACKED_FROM: Readonly<Record<string, string>> = {
  damaged: 'pieces in the damaged / expiry bin never go back for sale.',
  in_transit: 'the pieces standing there are already packed for other bills.',
  customer: 'those pieces stand at a shop, not in the godown.',
}

/** An order's fulfilment place that no order may name, and the sentence that says so. */
export interface FulfilPlaceRefusal {
  code: 'fulfil_location_not_sellable'
  locationId: string
  /** The place's name, or null when it is not one of this distributor's places. */
  name: string | null
  kind: string | null
  /** Why, as the end of a sentence: "pieces in the damaged / expiry bin never go back for sale." */
  why: string
  message: string
}

/**
 * WHERE AN ORDER MAY BE PACKED FROM (QA DOS-352, architect ruling 2 of 2026-09-28: nothing leaves the damaged
 * bin for sale). An order names its place in `fulfil_from_location_id`, and the pick, the pack and the bill
 * all take their pieces from there: an owner or a rep who named the damaged / expiry bin had twelve damaged
 * pieces picked, packed and billed to a shop. Only a godown (`warehouse`) or the vehicle a van sale sells off
 * (`vehicle`) — the two kinds `sellable_stock` holds — may be named; the bin, the dock and a shop's floor are
 * refused, and so is an id that is not one of this distributor's places. Null when the place is allowed.
 * Every member reads `locations` (`locations_read`), a shop included, so a retailer's own draft is judged the
 * same way.
 */
export async function fulfilPlaceRefusal(
  tx: Db,
  locationId: string,
): Promise<FulfilPlaceRefusal | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ kind: locations.kind, name: locations.name })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1)
  if (row && (row.kind === 'warehouse' || row.kind === 'vehicle')) return null
  const why = row
    ? (NOT_PACKED_FROM[row.kind] ?? 'no order is packed from there.')
    : 'it is not one of this distributor’s places.'
  return {
    code: 'fulfil_location_not_sellable',
    locationId,
    name: row?.name ?? null,
    kind: row?.kind ?? null,
    why,
    message: `An order is packed from a godown, not from ${row?.name ?? `location ${locationId}`}: ${why} Place the order without a location and it is packed from the godown.`,
  }
}

/**
 * THE DOCK: where packed goods stand between the rack and the van (QA DOS-195).
 *
 * A pack relieves the godown — the cartons are taped shut and off the shelf — but the goods have not been
 * sold yet, and they have not left the business: they wait on the dock for a load sheet. `bootstrapTenant`
 * gives every distributor exactly one `kind = 'in_transit'` location for this, and `sellable_stock` leaves
 * that kind out (migration 0063), so staged goods are stock the owner can see and nobody can promise.
 *
 * Without it the packed pieces were relieved as a `sale` at pack and existed nowhere until a shop took
 * them — so a refused or failed delivery's goods were in no location at all and the van check-in built to
 * count them back had nothing to show.
 */
export async function dockLocationId(tx: Db): Promise<string> {
  const dock = await findFixedPlace(tx, 'in_transit')
  if (dock === null) throw placeMissing('in_transit')
  return dock.id
}
