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
