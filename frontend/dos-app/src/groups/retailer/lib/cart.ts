/**
 * THE SHOP'S BASKET — one thing, shared by the home, the brand pages, search and the order screen
 * (founder, 2026-09-28: the shopkeeper's home "must have a shopping app feel").
 *
 * WHAT CHANGED. The basket used to be `useState` inside `app/retailer/order.tsx`: a shop that put two
 * cases in and went back to look at its dues came back to an empty order, and a phone that was locked
 * lost it. A shopping app keeps the basket: across screens, across a restart, and apart per shop.
 *
 * WHAT A BASKET IS HERE. Lines of `{ id, variantId, qtyPcs }` — pieces are the state, exactly as the
 * order screen always held them. How a quantity was ENTERED (whole cases or loose pieces, docs/17 A3)
 * is worked out when the order is placed, from today's case size (`toOrderLines`), which is also what
 * "Order again" always did (DOS-098): the server re-derives pieces as entered quantity × case size, so
 * the case size that matters is the one on the price list at the moment of placing.
 *
 * WHOSE BASKET. One per login AND per distributor: `dos.retailer.cart.<userId>.<tenantId>`. A shop that
 * buys from three distributors has three baskets and never a blended one (UX-01 R11); a second person
 * signing in on the same phone never inherits the first one's basket (the lesson of DOS-167 in the
 * sales app, `src/groups/sales/lib/draft.ts`). Every basket key this device has written is listed
 * under `dos.retailer.carts`, which is how signing out empties EVERY basket on the device.
 *
 * WHERE IT IS KEPT. `@dos/ui/platform`'s storage: the Keychain / EncryptedSharedPreferences on a
 * phone, `localStorage` in a browser. Reads are asynchronous (a phone's secure store is), so a basket
 * is `ready` only once it has been read back, and a tap that lands before that is merged with what
 * comes back rather than overwritten by it. Writes trail by 300 ms: a stepper held down fires many
 * times a second and each write on a phone is a Keychain write.
 *
 * Nothing in here renders and nothing imports React: the store is plain TypeScript so it can be
 * called in a test (`cart.test.ts`), and `useCart()` in `shopping.ts` is the thin hook over it.
 */
import type { OrderLine } from '@dos/contracts'

/** One item in the basket. Pieces are the state; how they were entered is worked out on placing. */
export interface CartLine {
  /** Client-generated UUIDv7: the id the order line will carry. */
  readonly id: string
  readonly variantId: string
  /** Integer pieces, always > 0 in a stored basket. */
  readonly qtyPcs: number
}

/** A line as `orders.create` takes it. */
export interface OrderLineDraft {
  id: string
  variantId: string
  enteredQty: number
  enteredUnit: Extract<OrderLine['enteredUnit'], 'case' | 'piece'>
}

export interface CartSnapshot {
  readonly lines: readonly CartLine[]
  /** False until the stored basket has been read back on this device. */
  readonly ready: boolean
  /** Items taken out because the distributor no longer lists them; said once on the order screen. */
  readonly removed: number
}

/** The basket's key: one per login and per distributor. */
export const CART_PREFIX = 'dos.retailer.cart.'
/** Every basket key this device holds, so signing out can empty them all. */
export const CART_INDEX_KEY = 'dos.retailer.carts'

export function cartKey(userId: string, tenantId: string): string {
  return `${CART_PREFIX}${userId}.${tenantId}`
}

// ---------------------------------------------------------------------------
// The pure half: what a tap does to a basket
// ---------------------------------------------------------------------------

/**
 * How a quantity is recorded: whole cases where the pieces divide by the case size, else pieces. The
 * stepper, "Order again" and the pieces pad all go through it, so a repeated line is entered exactly
 * as a tapped one (DOS-098, DOS-101).
 */
export function enteredFor(
  pieces: number,
  caseSize: number,
): Pick<OrderLineDraft, 'enteredQty' | 'enteredUnit'> {
  return caseSize > 1 && pieces % caseSize === 0
    ? { enteredQty: pieces / caseSize, enteredUnit: 'case' }
    : { enteredQty: Math.max(pieces, 1), enteredUnit: 'piece' }
}

/** Set one item's pieces. Zero or less takes the item out; a new item gets a fresh line id. */
export function withQty(
  lines: readonly CartLine[],
  variantId: string,
  pieces: number,
  newId: () => string,
): CartLine[] {
  const whole = Math.max(0, Math.floor(pieces))
  const existing = lines.find((line) => line.variantId === variantId)
  if (existing === undefined) {
    return whole <= 0 ? [...lines] : [...lines, { id: newId(), variantId, qtyPcs: whole }]
  }
  if (whole <= 0) return lines.filter((line) => line.variantId !== variantId)
  return lines.map((line) => (line.variantId === variantId ? { ...line, qtyPcs: whole } : line))
}

/**
 * "Order again" ADDS to a basket: an item already in it keeps the quantity the shop chose, and only
 * the items not there yet come in (the rule the order screen already had for a tap that landed before
 * the repeated basket did).
 */
export function mergeSeed(current: readonly CartLine[], seeded: readonly CartLine[]): CartLine[] {
  const have = new Set(current.map((line) => line.variantId))
  const out = [...current]
  for (const line of seeded) {
    if (line.qtyPcs <= 0 || have.has(line.variantId)) continue
    have.add(line.variantId)
    out.push(line)
  }
  return out
}

/** Pieces of one item in the basket, 0 when it is not there. */
export function piecesOf(lines: readonly CartLine[], variantId: string): number {
  return lines.find((line) => line.variantId === variantId)?.qtyPcs ?? 0
}

/**
 * The lines to send, each entered the way the stepper enters it, with TODAY's case size. A line whose
 * item is not on the price list is not sent at all: "nothing hidden is placed" (DOS-098).
 */
export function toOrderLines(
  lines: readonly CartLine[],
  caseSizeOf: (variantId: string) => number | undefined,
): OrderLineDraft[] {
  const out: OrderLineDraft[] = []
  for (const line of lines) {
    if (line.qtyPcs <= 0) continue
    const caseSize = caseSizeOf(line.variantId)
    if (caseSize === undefined) continue
    out.push({ id: line.id, variantId: line.variantId, ...enteredFor(line.qtyPcs, caseSize) })
  }
  return out
}

/** The identity of a basket for pricing: which items, how many — never the line ids. */
export function basketKey(lines: readonly CartLine[]): string {
  return JSON.stringify(
    lines
      .filter((line) => line.qtyPcs > 0)
      .map((line) => [line.variantId, line.qtyPcs] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  )
}

// ---------------------------------------------------------------------------
// On the device
// ---------------------------------------------------------------------------

/** `v` so a later shape can be told from this one; `l` is `[variantId, pieces]` per item. */
interface Stored {
  v: 1
  l: [string, number][]
}

/**
 * Compact on purpose: a phone's secure store is happiest under 2 KB a value, and a line id is not
 * worth keeping (it is minted again on the way back in; it only has to be stable while the app runs).
 */
export function encodeCart(lines: readonly CartLine[]): string {
  const stored: Stored = {
    v: 1,
    l: lines.filter((line) => line.qtyPcs > 0).map((line) => [line.variantId, line.qtyPcs]),
  }
  return JSON.stringify(stored)
}

/** Anything unreadable is an empty basket, never an error the shop has to deal with. */
export function decodeCart(raw: string | null, newId: () => string): CartLine[] {
  if (raw === null) return []
  try {
    const held = JSON.parse(raw) as Partial<Stored>
    if (held.v !== 1 || !Array.isArray(held.l)) return []
    const seen = new Set<string>()
    const out: CartLine[] = []
    for (const entry of held.l) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [variantId, qtyPcs] = entry as [unknown, unknown]
      if (typeof variantId !== 'string' || variantId === '' || seen.has(variantId)) continue
      if (typeof qtyPcs !== 'number' || !Number.isInteger(qtyPcs) || qtyPcs <= 0) continue
      seen.add(variantId)
      out.push({ id: newId(), variantId, qtyPcs })
    }
    return out
  } catch {
    return []
  }
}

/** The three calls of `@dos/ui/platform`'s storage the basket needs. */
export interface CartStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export interface CartStore {
  /** The same object until the basket changes, as `useSyncExternalStore` needs. */
  snapshot: (key: string) => CartSnapshot
  subscribe: (listener: () => void) => () => void
  /** Read the stored basket once per key and process; later calls are free. */
  hydrate: (key: string) => Promise<void>
  /** Change a basket; the write to the device trails by `saveDelayMs`. */
  update: (key: string, change: (lines: readonly CartLine[]) => readonly CartLine[]) => void
  /** Take out every line whose item is not listed; answers how many went. */
  prune: (key: string, listed: (variantId: string) => boolean) => number
  /** The shop has read the "taken out" sentence. */
  acknowledgeRemoved: (key: string) => void
  /** Empty one basket (an order was placed, or the shop emptied it). */
  clear: (key: string) => Promise<void>
  /** Empty every basket this device holds (signing out). */
  clearAll: () => Promise<void>
  /** Write every pending change now. */
  flush: () => Promise<void>
}

const EMPTY: CartSnapshot = { lines: [], ready: false, removed: 0 }

export function createCartStore(options: {
  storage: CartStorage
  newId: () => string
  saveDelayMs?: number
}): CartStore {
  const { storage, newId, saveDelayMs = 300 } = options
  const snapshots = new Map<string, CartSnapshot>()
  const reads = new Map<string, Promise<void>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()
  /** Bumped by `clearAll`: a read or a write that started before it must not bring a basket back. */
  let epoch = 0

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const put = (key: string, next: CartSnapshot): void => {
    snapshots.set(key, next)
    emit()
  }

  const readIndex = async (): Promise<string[]> => {
    const raw = await storage.getItem(CART_INDEX_KEY)
    if (raw === null) return []
    try {
      const held: unknown = JSON.parse(raw)
      return Array.isArray(held)
        ? held.filter(
            (key): key is string => typeof key === 'string' && key.startsWith(CART_PREFIX),
          )
        : []
    } catch {
      return []
    }
  }

  const write = async (key: string): Promise<void> => {
    const started = epoch
    const lines = snapshots.get(key)?.lines ?? []
    if (lines.length === 0) {
      await storage.removeItem(key)
      return
    }
    await storage.setItem(key, encodeCart(lines))
    const index = await readIndex()
    if (started !== epoch) {
      // Signed out while this was being written: take it straight back out.
      await storage.removeItem(key)
      return
    }
    if (!index.includes(key)) await storage.setItem(CART_INDEX_KEY, JSON.stringify([...index, key]))
  }

  const schedule = (key: string): void => {
    const held = timers.get(key)
    if (held !== undefined) clearTimeout(held)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        void write(key).catch(() => {
          // A browser with site data blocked keeps the basket for as long as the page is open.
        })
      }, saveDelayMs),
    )
  }

  return {
    snapshot: (key) => snapshots.get(key) ?? EMPTY,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    hydrate: (key) => {
      const known = reads.get(key)
      if (known !== undefined) return known
      const started = epoch
      const read = storage
        .getItem(key)
        .catch(() => null)
        .then((raw) => {
          if (started !== epoch) return
          const stored = decodeCart(raw, newId)
          const now = snapshots.get(key) ?? EMPTY
          // A tap that landed before the read keeps its quantity; the stored items join it.
          const lines = mergeSeed(now.lines, stored)
          put(key, { lines, ready: true, removed: now.removed })
          if (now.lines.length > 0) schedule(key)
        })
      reads.set(key, read)
      return read
    },

    update: (key, change) => {
      const now = snapshots.get(key) ?? EMPTY
      const lines = change(now.lines).filter((line) => line.qtyPcs > 0)
      put(key, { ...now, lines })
      schedule(key)
    },

    prune: (key, listed) => {
      const now = snapshots.get(key) ?? EMPTY
      const kept = now.lines.filter((line) => listed(line.variantId))
      const gone = now.lines.length - kept.length
      if (gone === 0) return 0
      put(key, { ...now, lines: kept, removed: now.removed + gone })
      schedule(key)
      return gone
    },

    acknowledgeRemoved: (key) => {
      const now = snapshots.get(key)
      if (now === undefined || now.removed === 0) return
      put(key, { ...now, removed: 0 })
    },

    clear: async (key) => {
      const held = timers.get(key)
      if (held !== undefined) clearTimeout(held)
      timers.delete(key)
      put(key, { lines: [], ready: true, removed: 0 })
      await storage.removeItem(key)
      const index = await readIndex()
      if (index.includes(key)) {
        const rest = index.filter((one) => one !== key)
        if (rest.length === 0) await storage.removeItem(CART_INDEX_KEY)
        else await storage.setItem(CART_INDEX_KEY, JSON.stringify(rest))
      }
    },

    clearAll: async () => {
      epoch += 1
      for (const held of timers.values()) clearTimeout(held)
      timers.clear()
      reads.clear()
      const keys = new Set([...(await readIndex()), ...snapshots.keys()])
      snapshots.clear()
      emit()
      await Promise.all([...keys].map((key) => storage.removeItem(key)))
      await storage.removeItem(CART_INDEX_KEY)
    },

    flush: async () => {
      const pending = [...timers.keys()]
      for (const key of pending) {
        const held = timers.get(key)
        if (held !== undefined) clearTimeout(held)
        timers.delete(key)
      }
      await Promise.all(pending.map((key) => write(key)))
    },
  }
}

// ---------------------------------------------------------------------------
// The price the bar shows
// ---------------------------------------------------------------------------

export interface CartTotal {
  /** Integer paise; null while nothing has been worked out yet. */
  total: number | null
  /** True while the figure is not yet the engine's answer for THIS basket ("about ₹…"). */
  approximate: boolean
}

/**
 * What the cart bar prints (UX-01 R5: the price the shop sees is the price the bill prints).
 *
 * The quoted total from `pricing.quote` — the engine that prices the order and the bill — is the only
 * figure printed as exact, and only when it was worked out for the basket as it is NOW. While the
 * basket has moved on and the new quote is on its way, the last figure the engine gave is printed
 * as "about"; before the engine has answered anything at all there is no figure, never a guess.
 */
export function cartTotal(input: {
  basket: string
  quotedBasket: string | null
  quotedTotal: number | undefined
  lastKnown: number | null
}): CartTotal {
  if (input.quotedTotal !== undefined && input.quotedBasket === input.basket) {
    return { total: input.quotedTotal, approximate: false }
  }
  return { total: input.lastKnown, approximate: input.lastKnown !== null }
}

// ---------------------------------------------------------------------------
// Waiting for the thumb to stop
// ---------------------------------------------------------------------------

export interface Settler<T> {
  push: (value: T) => void
  cancel: () => void
}

/**
 * The last value pushed, handed on once nothing new has come for `ms`. Every tap on a stepper is a new
 * basket, and `pricing.quote` is a round trip: firing one per tap would paint three stale totals on
 * the way to the right one.
 */
export function createSettler<T>(ms: number, onSettle: (value: T) => void): Settler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    push: (value) => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onSettle(value)
      }, ms)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
