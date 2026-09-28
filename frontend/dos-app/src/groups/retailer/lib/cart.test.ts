/**
 * The shop's one basket (founder, 2026-09-28: the shopkeeper's home "must have a shopping app feel").
 *
 * What is pinned: a tap does what the order screen's stepper always did (`withQty`, `enteredFor`);
 * "Order again" ADDS to a kept basket rather than wiping it (`mergeSeed`); only listed items are ever
 * sent (`toOrderLines`); the basket survives a restart, one per login and distributor, and signing
 * out empties every one on the device (`createCartStore`); the bar says "about" until the engine has
 * priced the basket as it is now (`cartTotal`); and the quote waits for the thumb (`createSettler`).
 *
 * The store is driven through a fake storage with the same three async calls as `@dos/ui/platform`'s,
 * because a phone's secure store IS asynchronous and the interesting cases are the ones where a tap
 * lands before a read comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CART_INDEX_KEY,
  basketKey,
  cartKey,
  cartTotal,
  createCartStore,
  createSettler,
  decodeCart,
  encodeCart,
  enteredFor,
  mergeSeed,
  toOrderLines,
  withQty,
  type CartLine,
  type CartStorage,
} from './cart'

let counter = 0
const newId = (): string => {
  counter += 1
  return `line-${String(counter)}`
}

function fakeStorage(): CartStorage & { held: Map<string, string>; reads: number } {
  const held = new Map<string, string>()
  const store = {
    held,
    reads: 0,
    getItem: (key: string) => {
      store.reads += 1
      return Promise.resolve(held.get(key) ?? null)
    },
    setItem: (key: string, value: string) => {
      held.set(key, value)
      return Promise.resolve()
    },
    removeItem: (key: string) => {
      held.delete(key)
      return Promise.resolve()
    },
  }
  return store
}

/** Let the store's chain of storage promises run out (a write is a set, an index read and a set). */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const SOAP = 'variant-soap'
const BISCUIT = 'variant-biscuit'
const COLA = 'variant-cola'

beforeEach(() => {
  counter = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a tap on the basket', () => {
  it('adds an item with a fresh line id, changes its pieces, and takes it out at zero', () => {
    const one = withQty([], SOAP, 24, newId)
    expect(one).toEqual([{ id: 'line-1', variantId: SOAP, qtyPcs: 24 }])
    const two = withQty(one, SOAP, 48, newId)
    expect(two).toEqual([{ id: 'line-1', variantId: SOAP, qtyPcs: 48 }])
    expect(withQty(two, SOAP, 0, newId)).toEqual([])
    // Nothing to take out is not an error, and a zero never adds a line.
    expect(withQty([], COLA, 0, newId)).toEqual([])
  })

  it('records whole cases where the pieces divide, else loose pieces (DOS-101)', () => {
    expect(enteredFor(48, 24)).toEqual({ enteredQty: 2, enteredUnit: 'case' })
    expect(enteredFor(9, 24)).toEqual({ enteredQty: 9, enteredUnit: 'piece' })
    expect(enteredFor(6, 1)).toEqual({ enteredQty: 6, enteredUnit: 'piece' })
  })

  it('"Order again" adds the last order to a kept basket; what the shop chose keeps its quantity', () => {
    const basket: CartLine[] = [{ id: 'a', variantId: SOAP, qtyPcs: 12 }]
    const last: CartLine[] = [
      { id: 'b', variantId: SOAP, qtyPcs: 48 },
      { id: 'c', variantId: BISCUIT, qtyPcs: 24 },
    ]
    expect(mergeSeed(basket, last)).toEqual([
      { id: 'a', variantId: SOAP, qtyPcs: 12 },
      { id: 'c', variantId: BISCUIT, qtyPcs: 24 },
    ])
  })

  it('sends only items still on the price list, each entered with TODAY s case size (DOS-098)', () => {
    const basket: CartLine[] = [
      { id: 'a', variantId: SOAP, qtyPcs: 48 },
      { id: 'b', variantId: BISCUIT, qtyPcs: 5 },
      { id: 'c', variantId: COLA, qtyPcs: 12 },
    ]
    const caseSizes = new Map([
      [SOAP, 24],
      [BISCUIT, 12],
    ])
    expect(toOrderLines(basket, (id) => caseSizes.get(id))).toEqual([
      { id: 'a', variantId: SOAP, enteredQty: 2, enteredUnit: 'case' },
      { id: 'b', variantId: BISCUIT, enteredQty: 5, enteredUnit: 'piece' },
    ])
  })

  it('prices a basket by what is in it, never by its line ids', () => {
    const a: CartLine[] = [
      { id: 'x', variantId: SOAP, qtyPcs: 24 },
      { id: 'y', variantId: COLA, qtyPcs: 6 },
    ]
    const b: CartLine[] = [
      { id: 'z', variantId: COLA, qtyPcs: 6 },
      { id: 'w', variantId: SOAP, qtyPcs: 24 },
    ]
    expect(basketKey(a)).toBe(basketKey(b))
    expect(basketKey(a)).not.toBe(basketKey([{ id: 'x', variantId: SOAP, qtyPcs: 48 }]))
  })
})

describe('the basket on the device', () => {
  it('keeps a compact copy and reads it back with fresh line ids; anything unreadable is empty', () => {
    const text = encodeCart([
      { id: 'a', variantId: SOAP, qtyPcs: 24 },
      { id: 'b', variantId: COLA, qtyPcs: 6 },
    ])
    expect(text).not.toContain('"a"')
    expect(decodeCart(text, newId)).toEqual([
      { id: 'line-1', variantId: SOAP, qtyPcs: 24 },
      { id: 'line-2', variantId: COLA, qtyPcs: 6 },
    ])
    expect(decodeCart(null, newId)).toEqual([])
    expect(decodeCart('not json', newId)).toEqual([])
    expect(decodeCart('{"v":2,"l":[]}', newId)).toEqual([])
    expect(decodeCart('{"v":1,"l":[["x",-3],["y",1.5],[7,2],["z",4],["z",8]]}', newId)).toEqual([
      { id: 'line-3', variantId: 'z', qtyPcs: 4 },
    ])
  })

  it('survives a restart: written after the thumb stops, read back by a new store', async () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    const key = cartKey('ramesh', 'tarsun')
    const first = createCartStore({ storage, newId })
    await first.hydrate(key)
    first.update(key, (lines) => withQty(lines, SOAP, 24, newId))
    first.update(key, (lines) => withQty(lines, SOAP, 48, newId))
    // Nothing written while the stepper is still being pressed…
    expect(storage.held.get(key)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(300)
    await drain()
    // …one write once it stops, and the key is in the device's list of baskets.
    expect(decodeCart(storage.held.get(key) ?? null, newId)).toMatchObject([
      { variantId: SOAP, qtyPcs: 48 },
    ])
    expect(JSON.parse(storage.held.get(CART_INDEX_KEY) ?? '[]')).toEqual([key])

    // The app is killed and opened again: a new store over the same device storage.
    const second = createCartStore({ storage, newId })
    expect(second.snapshot(key).ready).toBe(false)
    await second.hydrate(key)
    expect(second.snapshot(key)).toMatchObject({
      ready: true,
      lines: [{ variantId: SOAP, qtyPcs: 48 }],
    })
  })

  it('keeps one basket per login and per distributor, and never hands one to another', async () => {
    const storage = fakeStorage()
    const store = createCartStore({ storage, newId })
    const tarsun = cartKey('ramesh', 'tarsun')
    const sai = cartKey('ramesh', 'sai')
    const colleague = cartKey('suresh', 'tarsun')
    await Promise.all([store.hydrate(tarsun), store.hydrate(sai), store.hydrate(colleague)])
    store.update(tarsun, (lines) => withQty(lines, SOAP, 24, newId))
    store.update(sai, (lines) => withQty(lines, COLA, 6, newId))
    expect(store.snapshot(tarsun).lines.map((line) => line.variantId)).toEqual([SOAP])
    expect(store.snapshot(sai).lines.map((line) => line.variantId)).toEqual([COLA])
    expect(store.snapshot(colleague).lines).toEqual([])
  })

  it('a tap that lands before the stored basket is read back is kept, and the stored items join it', async () => {
    const storage = fakeStorage()
    const key = cartKey('ramesh', 'tarsun')
    storage.held.set(key, encodeCart([{ id: 'x', variantId: SOAP, qtyPcs: 24 }]))
    storage.held.set(COLA, 'noise')
    const store = createCartStore({ storage, newId })
    const reading = store.hydrate(key)
    store.update(key, (lines) => withQty(lines, COLA, 6, newId))
    store.update(key, (lines) => withQty(lines, SOAP, 12, newId))
    await reading
    const lines = store.snapshot(key).lines
    expect(lines.map((line) => [line.variantId, line.qtyPcs])).toEqual([
      [COLA, 6],
      [SOAP, 12],
    ])
    expect(store.snapshot(key).ready).toBe(true)
  })

  it('reads the device once per basket, however many screens ask', async () => {
    const storage = fakeStorage()
    const key = cartKey('ramesh', 'tarsun')
    const store = createCartStore({ storage, newId })
    await Promise.all([store.hydrate(key), store.hydrate(key), store.hydrate(key)])
    expect(storage.reads).toBe(1)
  })

  it('placing an order empties that basket on the device and in the list, and no other', async () => {
    const storage = fakeStorage()
    const store = createCartStore({ storage, newId, saveDelayMs: 0 })
    const tarsun = cartKey('ramesh', 'tarsun')
    const sai = cartKey('ramesh', 'sai')
    await Promise.all([store.hydrate(tarsun), store.hydrate(sai)])
    store.update(tarsun, (lines) => withQty(lines, SOAP, 24, newId))
    store.update(sai, (lines) => withQty(lines, COLA, 6, newId))
    await store.flush()
    await store.clear(tarsun)
    expect(store.snapshot(tarsun)).toMatchObject({ lines: [], ready: true })
    expect(storage.held.has(tarsun)).toBe(false)
    expect(storage.held.has(sai)).toBe(true)
    expect(JSON.parse(storage.held.get(CART_INDEX_KEY) ?? '[]')).toEqual([sai])
  })

  it('signing out empties EVERY basket on the device, including another login s', async () => {
    const storage = fakeStorage()
    const store = createCartStore({ storage, newId, saveDelayMs: 0 })
    const mine = cartKey('ramesh', 'tarsun')
    const theirs = cartKey('suresh', 'sai')
    await Promise.all([store.hydrate(mine), store.hydrate(theirs)])
    store.update(mine, (lines) => withQty(lines, SOAP, 24, newId))
    store.update(theirs, (lines) => withQty(lines, COLA, 6, newId))
    await store.flush()
    // A tap still waiting to be written when the shop signs out must not bring a basket back.
    store.update(mine, (lines) => withQty(lines, BISCUIT, 12, newId))
    await store.clearAll()
    expect([...storage.held.keys()]).toEqual([])
    expect(store.snapshot(mine).lines).toEqual([])
    expect(store.snapshot(theirs).lines).toEqual([])
    // The next person reads the device afresh and finds nothing.
    await store.hydrate(mine)
    expect(store.snapshot(mine)).toMatchObject({ lines: [], ready: true })
  })

  it('takes out items the distributor stopped listing, and says how many once', async () => {
    const storage = fakeStorage()
    const store = createCartStore({ storage, newId })
    const key = cartKey('ramesh', 'tarsun')
    await store.hydrate(key)
    store.update(key, (lines) => withQty(withQty(lines, SOAP, 24, newId), COLA, 6, newId))
    expect(store.prune(key, (id) => id === SOAP)).toBe(1)
    expect(store.snapshot(key)).toMatchObject({ removed: 1, lines: [{ variantId: SOAP }] })
    // Nothing left to take out is not a change: no new snapshot, no count.
    const before = store.snapshot(key)
    expect(store.prune(key, (id) => id === SOAP)).toBe(0)
    expect(store.snapshot(key)).toBe(before)
    store.acknowledgeRemoved(key)
    expect(store.snapshot(key).removed).toBe(0)
  })

  it('hands useSyncExternalStore the same snapshot until the basket changes', async () => {
    const store = createCartStore({ storage: fakeStorage(), newId })
    const key = cartKey('ramesh', 'tarsun')
    await store.hydrate(key)
    const seen: number[] = []
    const stop = store.subscribe(() => seen.push(1))
    const a = store.snapshot(key)
    expect(store.snapshot(key)).toBe(a)
    store.update(key, (lines) => withQty(lines, SOAP, 24, newId))
    expect(store.snapshot(key)).not.toBe(a)
    expect(seen.length).toBe(1)
    stop()
    store.update(key, (lines) => withQty(lines, SOAP, 48, newId))
    expect(seen.length).toBe(1)
  })
})

describe('the total on the cart bar (UX-01 R5)', () => {
  it('is exact only when the engine priced the basket as it is now', () => {
    expect(
      cartTotal({ basket: 'b1', quotedBasket: 'b1', quotedTotal: 8_400_00, lastKnown: 7_000_00 }),
    ).toEqual({ total: 8_400_00, approximate: false })
  })

  it('is the last figure, said as "about", while the new quote is on its way', () => {
    expect(
      cartTotal({ basket: 'b2', quotedBasket: 'b1', quotedTotal: 8_400_00, lastKnown: 8_400_00 }),
    ).toEqual({ total: 8_400_00, approximate: true })
    expect(
      cartTotal({ basket: 'b2', quotedBasket: null, quotedTotal: undefined, lastKnown: 8_400_00 }),
    ).toEqual({ total: 8_400_00, approximate: true })
  })

  it('is no figure at all before the engine has answered anything — never a guess', () => {
    expect(
      cartTotal({ basket: 'b1', quotedBasket: null, quotedTotal: undefined, lastKnown: null }),
    ).toEqual({ total: null, approximate: false })
  })
})

describe('waiting for the thumb to stop', () => {
  it('hands on only the last value, once nothing new has come for the delay', () => {
    vi.useFakeTimers()
    const settled: number[] = []
    const settler = createSettler<number>(400, (value) => settled.push(value))
    settler.push(1)
    vi.advanceTimersByTime(300)
    settler.push(2)
    vi.advanceTimersByTime(300)
    settler.push(3)
    expect(settled).toEqual([])
    vi.advanceTimersByTime(400)
    expect(settled).toEqual([3])
    settler.push(4)
    settler.cancel()
    vi.advanceTimersByTime(1000)
    expect(settled).toEqual([3])
  })
})
