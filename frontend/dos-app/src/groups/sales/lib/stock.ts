/**
 * The stock hint on order entry (S3) and the catalog (S11): pieces available per item at the godown orders
 * reserve from (DOS-074).
 *
 * `inventory.stock.availability` answers ONE ROW PER ITEM that has something left to promise at that godown —
 * a van, the damaged bin, stock in transit or a second warehouse never count, because no order reserves from
 * them — and pages by item. This hook reads it to the end. The screens used to read `stock.sellable` once, one
 * row per lot per location and 500 rows at most, and added up whatever came back: "0 cs available" for items
 * the godown held by the pallet.
 *
 * With no signal there is no hint at all rather than an invented one: `sellable_stock` is not in the
 * salesperson's device manifest. Over-available is an `ochre` warning on the stepper and never a block
 * (UX-00 §6.4): the godown short-supplies, the doorway does not.
 */
import { readEveryPage } from '@dos/api-client'
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { useMemo } from 'react'

/** 20 pages of 500: a distributor stocking more than 10,000 items reads as "not known" past that, never as 0. */
const MAX_PAGES = 20

export interface GodownStock {
  /**
   * Pieces available at the godown. `undefined` while there is no answer (loading, offline, a failed page) —
   * the screens then show no chip. After a complete read an item with no row is `0`; after an incomplete one
   * it stays `undefined`.
   */
  availableOf: (variantId: string) => number | undefined
}

export function useGodownStock(): GodownStock {
  const api = useApi()
  const { session } = useSession()
  // Read once per open and shared by S3 and S11; the search box is not in the key (never a read per keystroke).
  const stock = useQuery(
    ['inventory', 'availability', session?.tenant.id ?? null],
    () =>
      readEveryPage(
        (cursor) =>
          api.api.inventory.stock.availability({
            limit: 500,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        { maxPages: MAX_PAGES },
      ),
    { staleTime: 120_000 },
  )
  return useMemo(() => {
    const read = stock.data
    const totals = new Map<string, number>()
    for (const row of read?.items ?? []) totals.set(row.variantId, row.available)
    return {
      availableOf: (variantId) => {
        if (read === undefined) return undefined
        return totals.get(variantId) ?? (read.complete ? 0 : undefined)
      },
    }
  }, [stock.data])
}
