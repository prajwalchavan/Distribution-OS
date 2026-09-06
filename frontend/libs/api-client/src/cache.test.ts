import { describe, expect, it, vi } from 'vitest'

import { QueryCache, serialiseKey } from './cache.js'
import { ApiError } from './errors.js'

describe('serialiseKey', () => {
  it('is stable whatever order an object literal was written in', () => {
    expect(serialiseKey(['orders', { beat: 'x', status: 'submitted' }])).toBe(
      serialiseKey(['orders', { status: 'submitted', beat: 'x' }]),
    )
  })

  it('separates different filters', () => {
    expect(serialiseKey(['orders', { status: 'submitted' }])).not.toBe(
      serialiseKey(['orders', { status: 'confirmed' }]),
    )
  })
})

describe('QueryCache.fetch', () => {
  it('de-duplicates concurrent reads of the same key into ONE request', async () => {
    const cache = new QueryCache()
    const run = vi.fn(async () => {
      await Promise.resolve()
      return 42
    })
    const [a, b, c] = await Promise.all([
      cache.fetch(['x'], run),
      cache.fetch(['x'], run),
      cache.fetch(['x'], run),
    ])
    expect([a, b, c]).toEqual([42, 42, 42])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('serves a fresh value without going back to the service', async () => {
    const cache = new QueryCache()
    const run = vi.fn(async () => Promise.resolve(1))
    await cache.fetch(['x'], run, { staleTime: 60_000 })
    await cache.fetch(['x'], run, { staleTime: 60_000 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('re-reads once the value is stale, and always on force', async () => {
    const cache = new QueryCache()
    let n = 0
    const run = async (): Promise<number> => Promise.resolve(++n)
    await cache.fetch(['x'], run, { staleTime: 0 })
    await cache.fetch(['x'], run, { staleTime: 0 })
    expect(n).toBe(2)
    await cache.fetch(['x'], run, { staleTime: 60_000, force: true })
    expect(n).toBe(3)
  })

  it('keeps the last good value on screen when a revalidation fails, and records the age', async () => {
    const cache = new QueryCache()
    await cache.fetch(['x'], async () => Promise.resolve('good'))
    const firstUpdatedAt = cache.get<string>(['x']).updatedAt
    await expect(
      cache.fetch(['x'], () => Promise.reject(new TypeError('offline')), { force: true }),
    ).rejects.toBeInstanceOf(ApiError)
    const entry = cache.get<string>(['x'])
    expect(entry.data).toBe('good')
    expect(entry.status).toBe('success')
    expect(entry.error?.kind).toBe('network')
    expect(entry.updatedAt).toBe(firstUpdatedAt)
  })

  it('reports an error state only when there was never anything to show', async () => {
    const cache = new QueryCache()
    await expect(
      cache.fetch(['x'], () => Promise.reject(new TypeError('offline'))),
    ).rejects.toBeInstanceOf(ApiError)
    expect(cache.get(['x']).status).toBe('error')
    expect(cache.get(['x']).data).toBeUndefined()
  })
})

describe('QueryCache.invalidate', () => {
  it('clears every key under a prefix and leaves the rest alone', async () => {
    const cache = new QueryCache()
    const keep = (): void => undefined
    for (const key of [
      ['orders', { status: 'submitted' }],
      ['orders', { status: 'confirmed' }],
      ['receivables', 'outstanding'],
    ]) {
      cache.subscribe(key, keep)
      await cache.fetch(key, async () => Promise.resolve('v'))
    }
    cache.invalidate(['orders'])
    expect(cache.get(['orders', { status: 'submitted' }]).updatedAt).toBe(0)
    expect(cache.get(['orders', { status: 'confirmed' }]).updatedAt).toBe(0)
    expect(cache.get(['receivables', 'outstanding']).updatedAt).toBeGreaterThan(0)
  })

  it('does not confuse a prefix with a key that merely starts with the same letters', async () => {
    const cache = new QueryCache()
    const keep = (): void => undefined
    cache.subscribe(['order'], keep)
    cache.subscribe(['orders'], keep)
    await cache.fetch(['order'], async () => Promise.resolve(1))
    await cache.fetch(['orders'], async () => Promise.resolve(2))
    cache.invalidate(['orders'])
    expect(cache.get(['order']).updatedAt).toBeGreaterThan(0)
    expect(cache.get(['orders']).updatedAt).toBe(0)
  })

  it('notifies the subscribers of an invalidated key', async () => {
    const cache = new QueryCache()
    const listener = vi.fn()
    cache.subscribe(['orders', 1], listener)
    await cache.fetch(['orders', 1], async () => Promise.resolve('v'))
    listener.mockClear()
    cache.invalidate(['orders'])
    expect(listener).toHaveBeenCalled()
  })
})

describe('QueryCache.clear', () => {
  it('drops every row so the next user never sees the last one’s data', async () => {
    const cache = new QueryCache()
    await cache.fetch(['retailers'], async () => Promise.resolve(['Shree Ganesh']))
    cache.clear()
    expect(cache.get(['retailers']).data).toBeUndefined()
    expect(cache.lastUpdatedAt()).toBeNull()
  })
})
