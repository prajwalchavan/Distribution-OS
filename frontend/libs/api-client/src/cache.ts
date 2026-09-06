/**
 * A small query cache: enough for the six apps, and ours, so nothing in the kit depends on a data
 * library. Read paths cache by key, de-duplicate concurrent fetches, serve a stale value while
 * revalidating, and invalidate by key PREFIX after a write.
 *
 * The rule it exists to keep (UX-00 section 6.13): "every visited screen repaints from the persisted
 * query cache first" — a screen never opens blank on data it has already seen.
 */
import { toApiError, type ApiError } from './errors.js'

export type QueryKey = readonly unknown[]

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error'

export interface QueryEntry<T = unknown> {
  readonly status: QueryStatus
  readonly data: T | undefined
  readonly error: ApiError | undefined
  /** Epoch ms of the last successful read. Drives "Updated 2 min ago" and the stale rules. */
  readonly updatedAt: number
  /** True while a request is in flight, including a background revalidation of a cached value. */
  readonly fetching: boolean
  /**
   * How many times this key has been invalidated or cleared. It only ever goes up.
   *
   * `updatedAt` cannot carry that signal: a read that FAILED leaves `updatedAt` at 0, so "this entry
   * is stale" was already true and `invalidate()` / `clear()` changed nothing a `useEffect` could
   * depend on — the screen sat on an empty state and never asked the server again. Switching
   * distributor is exactly that case (`clear()` after a 403), and it showed four em-dashes with zero
   * requests in flight. A counter always changes, so the refetch always fires.
   */
  readonly generation: number
}

const EMPTY: QueryEntry = {
  status: 'idle',
  data: undefined,
  error: undefined,
  updatedAt: 0,
  fetching: false,
  generation: 0,
}

/** Stable, order-preserving serialisation. Objects inside a key are serialised by sorted field. */
export function serialiseKey(key: QueryKey): string {
  return JSON.stringify(key, (_field, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k]
          return acc
        }, {})
    }
    return value
  })
}

interface Slot {
  entry: QueryEntry
  inFlight: Promise<unknown> | null
  /**
   * The generation the in-flight request belongs to. A response from an older one is DROPPED: after
   * `clear()` the answer in flight belongs to the distributor the user just left, and writing it
   * into the slot would put one tenant's rows on another tenant's screen.
   */
  generation: number
  listeners: Set<() => void>
}

export interface FetchOptions {
  /** How long a cached value counts as fresh. Inside it, a mount does not refetch. */
  staleTime?: number
  /** Force a network read even when the value is fresh. */
  force?: boolean
}

export class QueryCache {
  readonly #slots = new Map<string, Slot>()

  #slot(hash: string): Slot {
    let slot = this.#slots.get(hash)
    if (!slot) {
      slot = { entry: EMPTY, inFlight: null, generation: 0, listeners: new Set() }
      this.#slots.set(hash, slot)
    }
    return slot
  }

  /** Bumps the slot's generation, abandons anything in flight, and returns the new number. */
  #bump(slot: Slot): number {
    slot.generation += 1
    slot.inFlight = null
    return slot.generation
  }

  #emit(hash: string, entry: QueryEntry): void {
    const slot = this.#slot(hash)
    slot.entry = entry
    for (const listener of slot.listeners) listener()
  }

  get<T>(key: QueryKey): QueryEntry<T> {
    return (this.#slots.get(serialiseKey(key))?.entry ?? EMPTY) as QueryEntry<T>
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const hash = serialiseKey(key)
    const slot = this.#slot(hash)
    slot.listeners.add(listener)
    return () => {
      slot.listeners.delete(listener)
      if (slot.listeners.size === 0 && slot.entry.status === 'idle') this.#slots.delete(hash)
    }
  }

  /** Writes a value straight into the cache (an optimistic update, or a list read filling detail rows). */
  setData<T>(key: QueryKey, data: T): void {
    const hash = serialiseKey(key)
    const slot = this.#slot(hash)
    this.#emit(hash, {
      status: 'success',
      data,
      error: undefined,
      updatedAt: Date.now(),
      fetching: false,
      generation: slot.generation,
    })
  }

  /**
   * Reads through the cache. Concurrent callers with the same key share ONE request; a fresh value
   * short-circuits; a stale value is returned to the screen while the revalidation runs behind it.
   */
  async fetch<T>(key: QueryKey, run: () => Promise<T>, options: FetchOptions = {}): Promise<T> {
    const hash = serialiseKey(key)
    const slot = this.#slot(hash)
    const staleTime = options.staleTime ?? 0
    const fresh = slot.entry.status === 'success' && Date.now() - slot.entry.updatedAt < staleTime

    if (!options.force && fresh) return slot.entry.data as T
    if (slot.inFlight) return slot.inFlight as Promise<T>

    // The generation this request belongs to. If `clear()` or `invalidate()` moves the slot on while
    // it is in flight, its answer is stale by definition and never reaches a screen.
    const generation = slot.generation
    const current = (): boolean => slot.generation === generation

    this.#emit(hash, {
      ...slot.entry,
      status: slot.entry.status === 'success' ? 'success' : 'loading',
      fetching: true,
      generation,
    })

    const promise = run()
      .then((data) => {
        if (current()) {
          this.#emit(hash, {
            status: 'success',
            data,
            error: undefined,
            updatedAt: Date.now(),
            fetching: false,
            generation,
          })
        }
        return data
      })
      .catch((raw: unknown) => {
        const error = toApiError(raw)
        if (current()) {
          this.#emit(hash, {
            // A failed revalidation keeps the last good value on screen and shows its age.
            status: slot.entry.data === undefined ? 'error' : 'success',
            data: slot.entry.data,
            error,
            updatedAt: slot.entry.updatedAt,
            fetching: false,
            generation,
          })
        }
        throw error
      })
      .finally(() => {
        // Only if nothing newer has taken the slot: a later `fetch()` must keep its own promise.
        if (slot.inFlight === promise) slot.inFlight = null
      })

    slot.inFlight = promise
    return promise
  }

  /**
   * Invalidates every key that STARTS WITH `prefix`, so `invalidate(['orders'])` clears every orders
   * query whatever its filters. Subscribed entries are marked stale and refetched by their hook;
   * unsubscribed ones are dropped.
   */
  invalidate(prefix: QueryKey): void {
    const head = serialiseKey(prefix).slice(0, -1)
    for (const [hash, slot] of [...this.#slots]) {
      if (hash !== `${head}]` && !hash.startsWith(`${head},`)) continue
      if (slot.listeners.size === 0) {
        this.#slots.delete(hash)
        continue
      }
      this.#emit(hash, { ...slot.entry, updatedAt: 0, generation: this.#bump(slot) })
    }
  }

  /**
   * Everything goes: called on sign-out and on switching distributor, so the next session never sees
   * the last one's rows — neither from the cache nor from a request that was still in the air.
   */
  clear(): void {
    for (const [hash, slot] of [...this.#slots]) {
      if (slot.listeners.size === 0) this.#slots.delete(hash)
      else this.#emit(hash, { ...EMPTY, generation: this.#bump(slot) })
    }
  }

  /** The most recent successful read across every key — what `<ConnectionStrip>` reports. */
  lastUpdatedAt(): number | null {
    let latest = 0
    for (const slot of this.#slots.values()) {
      if (slot.entry.updatedAt > latest) latest = slot.entry.updatedAt
    }
    return latest === 0 ? null : latest
  }
}
