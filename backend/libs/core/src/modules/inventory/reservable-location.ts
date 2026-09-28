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
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.kind, 'warehouse'),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.id))
    .limit(1)
  return row?.id ?? null
}

/** The godown, refusing a distributor that has none: nothing can be reserved or packed without one. */
export async function reservableLocationId(tx: Db): Promise<string> {
  const id = await findReservableLocationId(tx)
  if (id === null)
    throw new ORPCError('BAD_REQUEST', {
      message: 'this distributor has no active warehouse location (bootstrap it first)',
    })
  return id
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
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.kind, 'in_transit'),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.id))
    .limit(1)
  if (!row)
    throw new ORPCError('BAD_REQUEST', {
      message: 'this distributor has no in-transit location for packed goods (bootstrap it first)',
    })
  return row.id
}
