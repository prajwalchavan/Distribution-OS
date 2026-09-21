/**
 * "Is it in stock?" on the price list (R7): pieces available per item at the godown this distributor's orders
 * reserve from (DOS-097).
 *
 * `inventory.stock.availability` answers ONE ROW PER ITEM that has something left to promise at that godown,
 * and pages by item; this hook reads it to the end. The screen used to read `stock.sellable` once — one row
 * per LOT per LOCATION, 500 rows at most — and told a shop "Stock not known" for whichever items fell after
 * row 500. It is a hint, never a promise: the order is reserved when the distributor confirms it.
 *
 * The key carries the tenant id: a shop buys from up to three distributors, and one distributor's stock must
 * never answer for another's (same rule as `useMyShop`).
 */
import { readEveryPage } from '@dos/api-client'
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { useMemo } from 'react'

/** 20 pages of 500: past 10,000 stocked items an unread item reads "Stock not known", never "Out of stock". */
const MAX_PAGES = 20

export interface GodownStock {
  /**
   * Pieces available at the godown, or `null` when that is not known (no answer yet, offline, a failed page,
   * or a read that stopped early). After a complete read an item with no row is `0`: out of stock.
   */
  availableOf: (variantId: string) => number | null
}

export function useGodownStock(): GodownStock {
  const api = useApi()
  const { session } = useSession()
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
    { enabled: session !== null, staleTime: 60_000 },
  )
  return useMemo(() => {
    const read = stock.data
    const totals = new Map<string, number>()
    for (const row of read?.items ?? []) totals.set(row.variantId, row.available)
    return {
      availableOf: (variantId) => {
        if (read === undefined) return null
        return totals.get(variantId) ?? (read.complete ? 0 : null)
      },
    }
  }, [stock.data])
}
