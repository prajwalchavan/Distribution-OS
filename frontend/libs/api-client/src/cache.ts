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
}

const EMPTY: QueryEntry = {
  status: 'idle',
  data: undefined,
  error: undefined,
  updatedAt: 0,
  fetching: false,
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
      slot = { entry: EMPTY, inFlight: null, listeners: new Set() }
      this.#slots.set(hash, slot)
    }
    return slot
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
    this.#emit(hash, {
      status: 'success',
      data,
      error: undefined,
      updatedAt: Date.now(),
      fetching: false,
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

    this.#emit(hash, {
      ...slot.entry,
      status: slot.entry.status === 'success' ? 'success' : 'loading',
      fetching: true,
    })

    const promise = run()
      .then((data) => {
        this.#emit(hash, {
          status: 'success',
          data,
          error: undefined,
          updatedAt: Date.now(),
          fetching: false,
        })
        return data
      })
      .catch((raw: unknown) => {
        const error = toApiError(raw)
        this.#emit(hash, {
          // A failed revalidation keeps the last good value on screen and shows its age.
          status: slot.entry.data === undefined ? 'error' : 'success',
          data: slot.entry.data,
          error,
          updatedAt: slot.entry.updatedAt,
          fetching: false,
        })
        throw error
      })
      .finally(() => {
        slot.inFlight = null
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
      this.#emit(hash, { ...slot.entry, updatedAt: 0 })
    }
  }

  /** Everything goes: called on sign-out, so the next user never sees the last one's rows. */
  clear(): void {
    for (const [hash, slot] of [...this.#slots]) {
      if (slot.listeners.size === 0) this.#slots.delete(hash)
      else this.#emit(hash, EMPTY)
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
