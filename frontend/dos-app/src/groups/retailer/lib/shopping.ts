/**
 * The shop front's hooks: the one basket, the price list, the shop's rates and the basket's quote —
 * lifted out of `app/retailer/order.tsx` so the home, a brand page, search and the order screen all
 * shop into the same basket at the same prices (founder, 2026-09-28).
 *
 * Each hook is thin on purpose. What it decides lives in a pure function beside it (`cart.ts`,
 * `catalog.ts`) with its own tests; what is left here is only React's half — subscribing, reading
 * through `useQuery`, and waiting for the thumb to stop.
 *
 * EVERY READ IS FOR THE DISTRIBUTOR THAT IS OPEN (UX-01 R11). The keys carry the tenant id, the
 * basket's key carries it too, and `switchDistributor` clears the query cache: a shop that buys from
 * three never sees one distributor's items, prices or basket under another's name.
 */
import { readEveryPage } from '@dos/api-client'
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import type { QuotedLine, RateItem, SchemeView, TenantProduct } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { storage } from '@dos/ui/platform'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  basketKey,
  cartKey,
  cartTotal,
  createCartStore,
  createSettler,
  mergeSeed,
  piecesOf,
  withQty,
  type CartLine,
  type CartSnapshot,
  type CartTotal,
  type Settler,
} from './cart'
import { offersForItem, rankUsualItems, type PastOrder } from './catalog'
import { today } from './dates'
import { runningToday } from './offer'
import { useMyShop, type MyShop } from './shop'
import { useGodownStock, type GodownStock } from './stock'

/** The one basket store of the app: every screen reads and writes the same one. */
export const cartStore = createCartStore({ storage, newId: uuidv7 })

/** Signing out empties every basket this device holds (founder, 2026-09-28). */
export function clearAllCarts(): Promise<void> {
  return cartStore.clearAll()
}

const NO_CART: CartSnapshot = { lines: [], ready: false, removed: 0 }

// ---------------------------------------------------------------------------
// The basket
// ---------------------------------------------------------------------------

export interface Cart {
  lines: readonly CartLine[]
  /** The stored basket has been read back; before that a tap still counts. */
  ready: boolean
  /** How many different items are in it. */
  count: number
  /** Items the distributor stopped listing, taken out since the shop last looked. */
  removed: number
  piecesOf: (variantId: string) => number
  setQty: (variantId: string, pieces: number) => void
  /** "Order again": the last order's items join the basket; what is already in it stays. */
  addLines: (lines: readonly CartLine[]) => void
  prune: (listed: (variantId: string) => boolean) => number
  acknowledgeRemoved: () => void
  clear: () => Promise<void>
}

export function useCart(): Cart {
  const { session } = useSession()
  const key = session === null ? null : cartKey(session.user.id, session.tenant.id)

  const read = useCallback(() => (key === null ? NO_CART : cartStore.snapshot(key)), [key])
  const snap = useSyncExternalStore(cartStore.subscribe, read, read)

  useEffect(() => {
    if (key !== null) void cartStore.hydrate(key)
  }, [key])

  return useMemo(
    () => ({
      lines: snap.lines,
      ready: snap.ready,
      count: snap.lines.length,
      removed: snap.removed,
      piecesOf: (variantId) => piecesOf(snap.lines, variantId),
      setQty: (variantId, pieces) => {
        if (key === null) return
        cartStore.update(key, (lines) => withQty(lines, variantId, pieces, uuidv7))
      },
      addLines: (seeded) => {
        if (key === null) return
        cartStore.update(key, (lines) => mergeSeed(lines, seeded))
      },
      prune: (listed) => (key === null ? 0 : cartStore.prune(key, listed)),
      acknowledgeRemoved: () => {
        if (key !== null) cartStore.acknowledgeRemoved(key)
      },
      clear: () => (key === null ? Promise.resolve() : cartStore.clear(key)),
    }),
    [snap, key],
  )
}

// ---------------------------------------------------------------------------
// The price list
// ---------------------------------------------------------------------------

/** 8 pages of 500: a distributor listing more than 4,000 items is read up to there, and says so. */
const PRICE_LIST_PAGES = 8

export interface PriceList {
  items: readonly TenantProduct[]
  byVariant: ReadonlyMap<string, TenantProduct>
  /** The service said nothing follows the last page read. */
  complete: boolean
  isLoading: boolean
  error: { message: string; kind?: string } | undefined
  refetch: () => void
}

/**
 * Everything this distributor lists, read once and kept for five minutes. Search, the brand tiles
 * and "your items" are all answered from it on the device, so typing a name costs no round trip.
 */
export function usePriceList(): PriceList {
  const api = useApi()
  const { session } = useSession()
  const query = useQuery(
    ['price-list', session?.tenant.id ?? null],
    () =>
      readEveryPage(
        (cursor) =>
          api.api.tenantCatalog.list({
            listedOnly: true,
            limit: 500,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        { maxPages: PRICE_LIST_PAGES },
      ),
    { enabled: session !== null, staleTime: 300_000 },
  )
  const data = query.data
  const { refetch } = query
  const built = useMemo(() => {
    const items = data?.items ?? []
    const byVariant = new Map<string, TenantProduct>()
    for (const item of items) byVariant.set(item.variantId, item)
    return { items, byVariant, complete: data?.complete ?? false }
  }, [data])
  return {
    ...built,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => {
      void refetch()
    },
  }
}

// ---------------------------------------------------------------------------
// The shop's own rates
// ---------------------------------------------------------------------------

/**
 * `pricing.rates` (DOS-104): every listed item priced by the engine at one piece — this shop's tier,
 * its override and any rate agreed with it — and nothing else. No quantity offer can show in it.
 */
export function useListRates(retailerId: string | null): {
  rateOf: (variantId: string) => RateItem | undefined
  error: { status: number; data: unknown; message: string } | undefined
} {
  const api = useApi()
  const { session } = useSession()
  const on = today()
  const query = useQuery(
    ['rates', retailerId, on],
    () => api.api.pricing.rates({ retailerId: retailerId ?? '', pricingDate: on }),
    { enabled: session !== null && retailerId !== null, staleTime: 300_000 },
  )
  const byVariant = useMemo(() => {
    const map = new Map<string, RateItem>()
    for (const item of query.data?.items ?? []) map.set(item.variantId, item)
    return map
  }, [query.data])
  return { rateOf: (variantId) => byVariant.get(variantId), error: query.error }
}

// ---------------------------------------------------------------------------
// The basket's price
// ---------------------------------------------------------------------------

/** The last figure the engine gave per basket key, so a new screen can say "about" at once. */
const lastTotals = new Map<string, number>()

export interface CartQuote extends CartTotal {
  /** The engine's line for an item at the quantity in the basket, once that quote is in. */
  quotedOf: (variantId: string) => QuotedLine | undefined
  /** The lines the quote in hand was asked for (after the thumb stopped). */
  settled: readonly CartLine[]
  quote: ReturnType<typeof useQuoteQuery>
}

function useQuoteQuery(retailerId: string | null, settled: readonly CartLine[]) {
  const api = useApi()
  const { session } = useSession()
  const on = today()
  return useQuery(
    ['quote', retailerId, on, basketKey(settled)],
    () =>
      api.api.pricing.quote({
        retailerId: retailerId ?? '',
        pricingDate: on,
        lines: settled.map((line) => ({
          lineId: line.id,
          variantId: line.variantId,
          qtyPcs: line.qtyPcs,
        })),
      }),
    { enabled: session !== null && retailerId !== null && settled.length > 0, staleTime: 30_000 },
  )
}

/**
 * The basket priced by `pricing.quote`, 400 ms after the last tap. The first answer comes at once
 * when the screen opens on a basket already priced elsewhere: the settled basket STARTS as the
 * basket, so the query key is the one the last screen asked and the cache answers it.
 */
export function useCartQuote(retailerId: string | null, lines: readonly CartLine[]): CartQuote {
  const { session } = useSession()
  const priced = lines.filter((line) => line.qtyPcs > 0)
  const [settled, setSettled] = useState<readonly CartLine[]>(() => priced)

  const wanted = JSON.stringify(priced.map((line) => [line.id, line.variantId, line.qtyPcs]))
  const pricedRef = useRef(priced)
  pricedRef.current = priced
  const settler = useRef<Settler<readonly CartLine[]> | null>(null)
  settler.current ??= createSettler<readonly CartLine[]>(400, setSettled)
  useEffect(() => {
    settler.current?.push(pricedRef.current)
  }, [wanted])
  useEffect(() => {
    const held = settler.current
    return () => {
      held?.cancel()
    }
  }, [])

  const quote = useQuoteQuery(retailerId, settled)
  const basket = basketKey(priced)
  const settledBasket = basketKey(settled)
  const memory = `${session?.user.id ?? ''}.${session?.tenant.id ?? ''}`
  /*
   * An EMPTY basket forgets its last figure: the next basket is a new one, and "about ₹1,059" for its
   * first item — the order that was just placed — would be a figure about something else.
   */
  if (priced.length === 0) lastTotals.delete(memory)
  const quotedTotal = quote.data?.totals.totalPaise
  // Only a figure for the basket AS IT IS is remembered: never the quote of a basket already spent.
  const current = quotedTotal !== undefined && priced.length > 0 && settledBasket === basket
  useEffect(() => {
    if (current) lastTotals.set(memory, quotedTotal)
  }, [current, quotedTotal, memory])

  const byVariant = useMemo(() => {
    const map = new Map<string, QuotedLine>()
    for (const line of quote.data?.lines ?? []) map.set(line.variantId, line)
    return map
  }, [quote.data])

  const total =
    priced.length === 0
      ? { total: null, approximate: false }
      : cartTotal({
          basket,
          quotedBasket: quote.data === undefined ? null : settledBasket,
          quotedTotal,
          lastKnown: lastTotals.get(memory) ?? null,
        })

  return {
    ...total,
    quotedOf: (variantId) =>
      settled.some((line) => line.variantId === variantId) ? byVariant.get(variantId) : undefined,
    settled,
    quote,
  }
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** The offers running today for this shop (`schemes.list` already narrows to its applicability). */
export function useOffers(): {
  running: readonly SchemeView[]
  forItem: (item: Pick<TenantProduct, 'variantId' | 'brandId'>) => SchemeView[]
  isLoading: boolean
} {
  const api = useApi()
  const { session } = useSession()
  const on = today()
  const query = useQuery(
    ['schemes', on],
    () => api.api.pricing.schemes.list({ activeOnly: true, on, limit: 100 }),
    { enabled: session !== null, staleTime: 300_000 },
  )
  const running = useMemo(
    () => (query.data?.items ?? []).filter((scheme) => runningToday(scheme, on)),
    [query.data, on],
  )
  return {
    running,
    forItem: (item) => offersForItem(running, item),
    isLoading: query.isLoading,
  }
}

// ---------------------------------------------------------------------------
// Everything a shopping screen needs, once
// ---------------------------------------------------------------------------

export interface Shopping {
  my: MyShop
  list: PriceList
  cart: Cart
  rates: ReturnType<typeof useListRates>
  quote: CartQuote
  stock: GodownStock
  offers: ReturnType<typeof useOffers>
  /** Set an item's pieces in the basket. */
  setQty: (variantId: string, pieces: number) => void
}

/**
 * The basket, the price list, the rates, the quote and the stock hint, for any screen that sells.
 *
 * An item the distributor no longer lists leaves the basket as soon as the COMPLETE list is in hand
 * (never on a partial read), and the order screen says how many went — "nothing hidden is placed"
 * (DOS-098) applies to a kept basket as much as to a repeated one.
 */
export function useShopping(): Shopping {
  const my = useMyShop()
  const list = usePriceList()
  const cart = useCart()
  const rates = useListRates(my.retailerId)
  const quote = useCartQuote(my.retailerId, cart.lines)
  const stock = useGodownStock()
  const offers = useOffers()

  const { complete, byVariant, items } = list
  const { ready, prune, lines } = cart
  useEffect(() => {
    if (!complete || !ready || items.length === 0 || lines.length === 0) return
    prune((variantId) => byVariant.has(variantId))
  }, [complete, ready, items.length, byVariant, lines, prune])

  return { my, list, cart, rates, quote, stock, offers, setQty: cart.setQty }
}

// ---------------------------------------------------------------------------
// "Your items" and "Order again"
// ---------------------------------------------------------------------------

/** The orders a shop has actually PLACED — never a draft (the home's own rule since DOS-098). */
export const PLACED_STATES = [
  'submitted',
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'partially_delivered',
  'delivered',
  'closed',
] as const

/** How many recent orders "your items" is read from. */
const RECENT_ORDERS = 5

/**
 * The items of the shop's own recent orders, most often bought first (`rankUsualItems`).
 *
 * `orders.list` carries no lines, so the five most recent placed orders are read with `orders.get` in
 * ONE query — an API gap recorded in the build report: a list with its lines, or an "items this shop
 * buys" read for the retailer role, would make this one call.
 */
export function useUsualItems(): { variantIds: readonly string[]; isLoading: boolean } {
  const api = useApi()
  const { session } = useSession()
  const recent = useQuery(
    ['orders', 'recent'],
    () => api.api.orders.list({ limit: 20, states: [...PLACED_STATES] }),
    { enabled: session !== null },
  )
  const ids = [...(recent.data?.items ?? [])]
    .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))
    .slice(0, RECENT_ORDERS)
    .map((order) => order.id)
  const lines = useQuery(
    ['orders', 'recent-lines', session?.tenant.id ?? null, ids.join(',')],
    () => Promise.all(ids.map((id) => api.api.orders.get({ id }))),
    { enabled: session !== null && ids.length > 0, staleTime: 300_000 },
  )
  const variantIds = useMemo(() => {
    const orders: PastOrder[] = (lines.data ?? []).map(({ item }) => ({
      placedAt: item.submittedAt ?? item.createdAt,
      lines: item.lines,
    }))
    return rankUsualItems(orders)
  }, [lines.data])
  return { variantIds, isLoading: recent.isLoading || lines.isLoading }
}

export interface LastOrder {
  /** `none` when the shop has never placed one (or nothing of it is still sold). */
  state: 'reading' | 'none' | 'ready' | 'failed'
  /** That order, for the card body to open. */
  orderId: string | null
  /** Items of that order still on the price list — what "Order again" will put in the basket. */
  lines: readonly CartLine[]
  /** That basket priced TODAY by the engine; null until (or unless) it answers. */
  totalPaise: number | null
}

/**
 * The shop's last placed order as the "Order again" card says it: how many items, and about how much
 * at today's prices (`orders.lastPlaced` + one `pricing.quote`). Writes nothing (DOS-098).
 */
export function useLastOrder(retailerId: string | null, list: PriceList): LastOrder {
  const api = useApi()
  const { session } = useSession()
  const last = useQuery(
    ['orders', 'last-placed', retailerId],
    () => api.api.orders.lastPlaced({ retailerId: retailerId ?? '' }),
    { enabled: session !== null && retailerId !== null, staleTime: 60_000 },
  )
  const item = last.data?.item
  const lines = useMemo(() => {
    if (item === undefined || item === null) return []
    const pieces = new Map<string, number>()
    for (const line of item.lines)
      pieces.set(line.variantId, (pieces.get(line.variantId) ?? 0) + line.qtyPcs)
    return [...pieces]
      .filter(([variantId, qtyPcs]) => qtyPcs > 0 && list.byVariant.has(variantId))
      .map(([variantId, qtyPcs]) => ({ id: variantId, variantId, qtyPcs }))
  }, [item, list.byVariant])
  const quote = useQuoteQuery(retailerId, lines)
  const orderId = item?.id ?? null
  if (last.error !== undefined) return { state: 'failed', orderId, lines: [], totalPaise: null }
  if (last.data === undefined || list.isLoading)
    return { state: 'reading', orderId, lines, totalPaise: null }
  if (item === null || item === undefined || lines.length === 0)
    return { state: 'none', orderId, lines: [], totalPaise: null }
  return { state: 'ready', orderId, lines, totalPaise: quote.data?.totals.totalPaise ?? null }
}

// ---------------------------------------------------------------------------
// Leaving
// ---------------------------------------------------------------------------

/**
 * Sign out, and take every basket on this device with it: the next person to pick up the phone must
 * not find the last one's order waiting (founder, 2026-09-28).
 */
export function useLeave(): () => void {
  const { signOut } = useSession()
  return useCallback(() => {
    void clearAllCarts()
      .catch(() => undefined)
      .then(() => signOut())
  }, [signOut])
}
