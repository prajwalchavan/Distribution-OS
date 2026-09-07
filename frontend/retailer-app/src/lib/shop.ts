/**
 * "Which shop am I?" — the one question every screen in this app has to answer first.
 *
 * A retailer login is a PLATFORM user, not a tenant row: `retailer_links.user_id` is what RLS keys
 * on, so `retailers.list` for this role returns the shop (or shops) of THIS distributor that this
 * login is linked to, in the PUBLIC shape — no code, no tier, no credit limit, no beat. The screens
 * therefore never carry a retailer id in a route: they ask this hook, and every read below is scoped
 * by the id it answers.
 *
 * A login that reaches a distributor it has no linked shop in is a real state (a membership created
 * before the link, docs/23 §6.1 R2): the list comes back EMPTY and the home screen says so with the
 * distributor's own name, rather than showing an error or a zero.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import type { RetailerPublic } from '@dos/contracts'

export interface MyShop {
  shop: RetailerPublic | null
  /** Null until the first read lands; a screen that needs an id waits on this, never on a guess. */
  retailerId: string | null
  isLoading: boolean
  error: { message: string; kind?: string } | undefined
  refetch: () => void
  /** The read landed and this login has no shop under the open distributor. */
  unlinked: boolean
}

/**
 * The shop this login is, under the distributor that is currently open.
 *
 * The key carries the tenant id so switching distributor cannot serve the previous one's shop out of
 * the cache — the whole app below the switcher is that distributor's (docs/22 §2).
 */
export function useMyShop(): MyShop {
  const api = useApi()
  const { session } = useSession()
  const tenantId = session?.tenant.id ?? null
  const query = useQuery(
    ['my-shop', tenantId],
    () => api.api.retailers.list({ limit: 5, activeOnly: true }),
    { enabled: session !== null, staleTime: 120_000 },
  )
  const items = query.data?.items ?? []
  const shop = items[0] ?? null
  return {
    shop,
    retailerId: shop?.id ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch()
    },
    unlinked: query.data !== undefined && items.length === 0,
  }
}

/**
 * variantId → the name this distributor gives the item, for the ONE register that carries ids.
 *
 * An invoice line and a credit-note line both carry `description`; an ORDER line carries only
 * `variantId`, so the order screens would print a uuid without this. It reads `tenantCatalog.list`
 * with `listedOnly: true` — this distributor's own 29 listings on the pilot data — and NOT the whole
 * catalogue: `listedOnly: false` answers the 5 768-row GLOBAL master, which under any `limit` gives
 * a first page with the wanted item missing from it, and a screen that then says "unknown" over an
 * item it stocks (the defect the warehouse gate measured on the gate count).
 *
 * A variant the distributor has since unlisted is genuinely not in that answer, so it is NAMED as
 * unknown rather than guessed at.
 */
export function useItemNames(): {
  nameOf: (variantId: string) => string | null
  isLoading: boolean
} {
  const api = useApi()
  const { session } = useSession()
  const query = useQuery(
    ['item-names', session?.tenant.id ?? null],
    () => api.api.tenantCatalog.list({ limit: 500, listedOnly: true }),
    { enabled: session !== null, staleTime: 300_000 },
  )
  const items = query.data?.items ?? []
  return {
    nameOf: (variantId) => {
      const hit = items.find((item) => item.variantId === variantId)
      return hit === undefined ? null : (hit.localAlias ?? hit.name)
    },
    isLoading: query.isLoading,
  }
}

/**
 * A postal address as one readable line — the shop card and the bill header.
 *
 * `AddressSchema` is a LOOSE object (an import may carry keys nobody declared), so this reads the
 * five it knows and ignores whatever else is in there rather than printing raw JSON.
 */
export function addressLine(address: unknown): string {
  if (typeof address !== 'object' || address === null) return ''
  const row = address as Record<string, unknown>
  const read = (key: string): string => (typeof row[key] === 'string' ? row[key] : '')
  return [
    read('line1'),
    read('line2'),
    read('landmark'),
    read('area'),
    read('city'),
    read('pincode'),
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ')
}
