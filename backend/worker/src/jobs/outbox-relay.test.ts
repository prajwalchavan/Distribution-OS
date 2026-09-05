import { sql } from 'drizzle-orm'
import { createDb, createPool, loadDotenv, outboxEvents, tenants } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  clearOutboxHandlers,
  defaultBackoffMs,
  registeredEventTypes,
  registerOutboxHandler,
  relayOutbox,
  type OutboxEvent,
} from './outbox-relay.js'

loadDotenv()
process.env.DATABASE_POOL_MAX ??= '3'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('outbox relay registry (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const okType = `spec.ok.${run}`
  const flakyType = `spec.flaky.${run}`
  const orphanType = `spec.orphan.${run}`

  const insert = async (eventType: string, n: number): Promise<string[]> => {
    const ids = Array.from({ length: n }, () => uuidv7())
    await db.insert(outboxEvents).values(
      ids.map((id, i) => ({
        id,
        tenantId,
        aggregateType: 'spec',
        aggregateId: `${eventType}:${String(i)}`,
        eventType,
        payload: { n: i },
      })),
    )
    return ids
  }
  const rowsOf = async (ids: string[]) =>
    (
      await db.execute<
        Record<string, unknown> & {
          id: string
          published_at: string | Date | null
          attempts: number
          next_attempt_at: string | Date | null
          dead_lettered_at: string | Date | null
          last_error: string | null
        }
      >(
        sql`select id, published_at, attempts, next_attempt_at, dead_lettered_at, last_error from outbox_events where id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )}) order by id`,
      )
    ).rows

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `ob-${run}`, legalName: 'Outbox spec', stateCode: '27' })
  })

  afterAll(async () => {
    clearOutboxHandlers()
    await pool.end()
  })

  it('dispatches each registered event exactly once and leaves unregistered types untouched', async () => {
    clearOutboxHandlers()
    const seen: OutboxEvent[] = []
    registerOutboxHandler(okType, async (e) => {
      seen.push(e)
    })
    const second: string[] = []
    registerOutboxHandler(okType, async (e) => {
      second.push(e.id)
    })
    expect(registeredEventTypes()).toEqual([okType])
    const ids = await insert(okType, 3)
    const orphans = await insert(orphanType, 2)

    const first = await relayOutbox(db, { batchSize: 2 })
    expect(first).toMatchObject({ claimed: 3, published: 3, failed: 0, deadLettered: 0 })
    expect(seen.map((e) => e.id).sort()).toEqual([...ids].sort())
    expect(second.sort()).toEqual([...ids].sort())
    expect(seen[0]).toMatchObject({
      tenantId,
      aggregateType: 'spec',
      eventType: okType,
      attempts: 0,
    })

    const again = await relayOutbox(db)
    expect(again.claimed).toBe(0)
    expect(seen).toHaveLength(3)
    expect((await rowsOf(ids)).every((r) => r.published_at !== null && r.attempts === 0)).toBe(true)
    expect((await rowsOf(orphans)).every((r) => r.published_at === null && r.attempts === 0)).toBe(
      true,
    )
  })

  it('retries a failing handler with backoff and dead-letters it after the limit', async () => {
    clearOutboxHandlers()
    let calls = 0
    registerOutboxHandler(flakyType, async () => {
      calls += 1
      if (calls <= 2) throw new Error(`boom ${String(calls)}`)
    })
    const [id] = await insert(flakyType, 1)
    if (!id) throw new Error('insert')
    let clock = Date.now()
    const now = () => new Date(clock)

    const r1 = await relayOutbox(db, { now, maxAttempts: 3 })
    expect(r1).toMatchObject({ claimed: 1, published: 0, failed: 1, deadLettered: 0 })
    let [row] = await rowsOf([id])
    expect(row).toMatchObject({ attempts: 1, published_at: null, dead_lettered_at: null })
    expect(row?.last_error).toContain('boom 1')
    expect(new Date(row?.next_attempt_at ?? 0).getTime()).toBe(clock + defaultBackoffMs(1))

    // Too early: the backoff holds the row back, the handler is not called again.
    const early = await relayOutbox(db, { now, maxAttempts: 3 })
    expect(early.claimed).toBe(0)
    expect(calls).toBe(1)

    clock += defaultBackoffMs(1) + 1
    const r2 = await relayOutbox(db, { now, maxAttempts: 3 })
    expect(r2).toMatchObject({ claimed: 1, failed: 1 })
    ;[row] = await rowsOf([id])
    expect(row?.attempts).toBe(2)
    expect(new Date(row?.next_attempt_at ?? 0).getTime()).toBe(clock + defaultBackoffMs(2))

    clock += defaultBackoffMs(2) + 1
    const r3 = await relayOutbox(db, { now, maxAttempts: 3 })
    expect(r3).toMatchObject({ claimed: 1, published: 1 })
    ;[row] = await rowsOf([id])
    expect(row?.published_at).not.toBeNull()
    expect(row?.last_error).toBeNull()
    expect(calls).toBe(3)

    // A handler that never succeeds is parked after `maxAttempts`, still unpublished.
    const [doomed] = await insert(flakyType, 1)
    if (!doomed) throw new Error('insert')
    calls = -100
    for (let i = 0; i < 3; i++) {
      await relayOutbox(db, { now, maxAttempts: 3 })
      clock += 60 * 60_000 + 1
    }
    ;[row] = await rowsOf([doomed])
    expect(row).toMatchObject({ attempts: 3, published_at: null })
    expect(row?.dead_lettered_at).not.toBeNull()
    const parked = await relayOutbox(db, { now, maxAttempts: 3 })
    expect(parked.claimed).toBe(0)
  })

  it('backs off exponentially and caps at an hour', () => {
    expect(defaultBackoffMs(1)).toBe(30_000)
    expect(defaultBackoffMs(2)).toBe(60_000)
    expect(defaultBackoffMs(4)).toBe(240_000)
    expect(defaultBackoffMs(20)).toBe(3_600_000)
  })
})
