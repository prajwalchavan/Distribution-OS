/**
 * DOS-086 (integration verifier, major) — THE SWEEP, DRIVEN BY THE REAL ENGINE.
 *
 * Everything DOS-086 had been proved by until now was a fake: `dos-086-whole-order.test.ts` calls
 * `submitLandedDrafts` with hand-written outbox rows and a `vi.fn()` submit, and
 * `dos-086-placed-copy.guard.test.ts` reads two sentences out of `strings.ts`. Both are true and
 * neither answers the verifier's question, which is the only one a rep cares about: does a draft
 * queued in a dead spot actually get submitted, by itself, when the signal comes back?
 *
 * The walks that would answer it (Playwright with `setOffline`, the Pixel 7 with an app kill) cannot
 * run here — this run may not start a dev server, an emulator or a simulator. What CAN run here is
 * the whole of the machinery underneath them, and that is what this file does:
 *
 *   - the REAL `SyncEngine` from `@dos/offline`, with its real outbox, its real batching, its real
 *     `_pending` column, its real `onAccepted` signal and its real store;
 *   - the REAL sweep, `submitLandedDrafts` from `./queue.ts`, wired to that engine EXACTLY as
 *     `useSubmitAcceptedDrafts` wires it (`engine.outbox`, `engine.getRow`, `api.orders.submit`,
 *     `engine.sync`);
 *   - an office double that behaves like the service the sweep is talking to: `orders.sync.ts`
 *     REFUSES a line whose order has moved past `draft` with `order_not_draft` (orders.sync.ts:84,
 *     :140), and `orders.submit` refuses an order that is not a draft.
 *
 * That last part is what makes the green mean something. The office here can punish a premature
 * submit, and the second test proves it does: with the pre-fix rule (submit when the HEADER lands)
 * the same journey ends with a short order at the shop and `order_not_draft` in the tray. The first
 * test then shows the shipped rule ending with all six lines at the office, an empty tray, and one
 * submit under the manual button's key.
 *
 * WHAT IS STILL NOT PROVED HERE, and is only proved by a walk: the pixels. No screen is mounted (the
 * app's ESLint forbids a renderer in app sources, docs/08 §0), so the last test reads the banner's
 * sentence the way the screen composes it — `orderOutcome` over the row the REAL engine holds at
 * that moment, then the string that key names — with `dos-180-banner.guard.test.ts` holding the one
 * remaining link, that `new.tsx` prints `t(outcome.bodyKey)` and nothing else.
 */
import { createMemoryStore, SyncEngine } from '@dos/offline'
import type { EnqueueInput, SyncStore, SyncTableManifest, SyncTransport } from '@dos/offline'
import { describe, expect, it } from 'vitest'

import { orderOutcome } from './outcome'
import { submitLandedDrafts } from './queue'
import { strings } from '../strings'

const DEVICE = 'device-b2-sales-rep'

/** A wire value the device wrote, as the string it is — the op's `data` is `unknown` per field. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function col(
  name: string,
  type: 'string' | 'integer' = 'string',
): SyncTableManifest['columns'][number] {
  return { name, type, nullable: true }
}

const TABLES: SyncTableManifest[] = [
  {
    table: 'sales_orders',
    primaryKey: ['id'],
    columns: [col('id'), col('retailer_id'), col('state'), col('order_no'), col('updated_at')],
    writable: true,
  },
  {
    table: 'sales_order_lines',
    primaryKey: ['id'],
    columns: [
      col('id'),
      col('order_id'),
      col('variant_id'),
      col('entered_qty', 'integer'),
      col('entered_unit'),
      col('updated_at'),
    ],
    writable: true,
  },
]

interface OfficeOrder {
  id: string
  retailer_id: string
  state: string
  order_no: string | null
  updated_at: string
}

/**
 * The office, as far as one queued order can see it: `/sync/upload` with the two rules
 * `orders.sync.ts` actually enforces, and `orders.submit`.
 *
 * It is a double, not a stub — it can say no, and the rules it says no by are the service's own:
 * a device may write a `draft` and its lines, and a line arriving for an order that is no longer a
 * draft is refused `order_not_draft`. That refusal is the whole reason the whole-order gate exists.
 */
class Office {
  readonly orders = new Map<string, OfficeOrder>()
  readonly lines = new Map<string, Record<string, unknown>>()
  /** Every `orders.submit` call this office received, in order. */
  readonly submits: { id: string; idempotencyKey: string; deviceId: string }[] = []
  /** While true every call throws the way a dead spot does. */
  offline = false
  private readonly applied = new Set<string>()
  private rev = 0
  private nextNo = 1

  private stamp(): string {
    this.rev += 1
    return new Date(Date.parse('2026-09-20T06:00:00.000Z') + this.rev * 1000).toISOString()
  }

  /** `api.orders.submit` — the online half a device may not do for itself. */
  async submit(input: { id: string; idempotencyKey: string; deviceId: string }): Promise<void> {
    if (this.offline) throw new TypeError('Failed to fetch')
    this.submits.push(input)
    const order = this.orders.get(input.id)
    if (order === undefined) throw new Error('order_not_found')
    if (order.state !== 'draft') throw new Error('order_not_submittable')
    order.state = 'submitted'
    order.order_no = `SO-26${String(this.nextNo++).padStart(5, '0')}`
    order.updated_at = this.stamp()
  }

  private guard(): void {
    if (this.offline) throw new TypeError('Failed to fetch')
  }

  transport(): SyncTransport {
    return {
      manifest: async (input) => {
        this.guard()
        return {
          protocol: 1,
          schemaVersion: 'v1',
          changed: input.knownSchemaVersion !== 'v1',
          role: 'salesperson',
          tables: TABLES,
          asOf: this.stamp(),
        }
      },
      pull: async () => ({
        changes: [
          {
            table: 'sales_orders',
            rows: [...this.orders.values()].map((order): Record<string, unknown> => ({ ...order })),
            deleted: [] as string[],
          },
          {
            table: 'sales_order_lines',
            rows: [...this.lines.values()],
            deleted: [] as string[],
          },
        ],
        cursor: `c${this.rev}`,
        hasMore: false,
        asOf: this.stamp(),
      }),
      upload: async (input) => {
        this.guard()
        const out = {
          accepted: 0,
          replayed: 0,
          rejected: [] as {
            opId: string
            table: string
            rowId: string
            code: string
            messageEn: string
            messageHi: string
          }[],
          warnings: [],
          upgradeRequired: false,
        }
        for (const op of input.ops) {
          if (this.applied.has(op.opId)) {
            out.replayed += 1
            continue
          }
          const data = op.data ?? {}
          if (op.table === 'sales_orders') {
            this.orders.set(op.id, {
              id: op.id,
              retailer_id: text(data.retailer_id),
              state: text(data.state) === '' ? 'draft' : text(data.state),
              order_no: null,
              updated_at: this.stamp(),
            })
          } else {
            const order = this.orders.get(text(data.order_id))
            if (order === undefined || order.state !== 'draft') {
              out.rejected.push({
                opId: op.opId,
                table: op.table,
                rowId: op.id,
                code: 'order_not_draft',
                messageEn: 'This order is no longer a draft',
                messageHi: 'यह ऑर्डर अब ड्राफ़्ट नहीं है',
              })
              this.applied.add(op.opId)
              continue
            }
            this.lines.set(op.id, { ...data, id: op.id, updated_at: this.stamp() })
          }
          this.applied.add(op.opId)
          out.accepted += 1
        }
        return out
      },
    }
  }
}

function engineOn(store: SyncStore, office: Office): SyncEngine {
  return new SyncEngine({
    transport: office.transport(),
    deviceId: DEVICE,
    // The same store every time: a phone that was restarted, not wiped.
    storeFactory: async () => store,
    pullIntervalMs: 0,
    // 1 header + 6 lines over batches of four: the header and its lines land in DIFFERENT batches,
    // which is the >50-op straddle of a full offline beat, reproduced in seven ops.
    uploadBatchSize: 4,
  })
}

/** The ops `useEnqueueOrder` writes, header first, as ONE `enqueueMany` (queue.ts). */
function orderOps(orderId: string, lineCount: number): EnqueueInput[] {
  const header: EnqueueInput = {
    table: 'sales_orders',
    id: orderId,
    op: 'PUT',
    data: {
      retailer_id: 'ret-1',
      state: 'draft',
      source: 'salesperson',
      pricing_date_mode: 'order',
      note: null,
      expected_delivery_date: null,
    },
  }
  const lines = Array.from({ length: lineCount }, (_, index): EnqueueInput => ({
    table: 'sales_order_lines',
    id: `${orderId}-l${index + 1}`,
    op: 'PUT',
    data: {
      order_id: orderId,
      variant_id: `v-${index + 1}`,
      entered_qty: index + 1,
      entered_unit: 'case',
    },
  }))
  return [header, ...lines]
}

/** The sweep, wired to a real engine exactly as `useSubmitAcceptedDrafts` wires it. */
function sweepOf(engine: SyncEngine, office: Office): () => Promise<string[]> {
  return () =>
    submitLandedDrafts({
      outbox: () => engine.outbox(),
      orderState: async (orderId) => {
        const row = await engine.getRow<{ state?: unknown }>('sales_orders', orderId)
        if (row === null) return null
        return typeof row.state === 'string' ? row.state : null
      },
      submit: (input) => office.submit(input),
      pull: () => engine.sync('queued order submitted'),
      deviceId: DEVICE,
    })
}

describe('DOS-086 a draft queued in a dead spot submits itself when the signal returns', () => {
  it('DOS-086 submits the whole order once, with no line refused, and the number comes back', async () => {
    const ORDER = 'o-b2-whole'
    const office = new Office()
    const store = createMemoryStore()
    const engine = engineOn(store, office)
    await engine.start()

    // The dead spot: the rep places a seven-op order with no signal.
    office.offline = true
    await engine.enqueueMany(orderOps(ORDER, 6))
    expect(office.orders.size).toBe(0)

    // Every screen with the hook sweeps on every acceptance — including the header-only batch.
    const sweep = sweepOf(engine, office)
    const running: Promise<string[]>[] = []
    const off = engine.onAccepted(() => {
      running.push(sweep())
    })

    // The signal comes back. Nobody taps anything.
    office.offline = false
    await engine.flush()
    const submittedIn = (await Promise.all(running)).flat()
    // One more turn of the crank for a sweep that started as the last batch settled.
    await Promise.all(running)
    off()

    expect(office.submits).toEqual([
      { id: ORDER, idempotencyKey: `${ORDER}:submit`, deviceId: DEVICE },
    ])
    expect(submittedIn).toEqual([ORDER])
    // The whole order is at the office: six lines, and NOTHING in the tray.
    expect(office.lines.size).toBe(6)
    expect(await engine.needsAttention()).toEqual([])
    expect(office.orders.get(ORDER)?.state).toBe('submitted')

    // And the number is on the phone, because the sweep pulls after the submit.
    await engine.sync('assert')
    const row = await engine.getRow<{ order_no?: string | null; state?: string }>(
      'sales_orders',
      ORDER,
    )
    expect(row?.order_no).toMatch(/^SO-26\d{5}$/)
    expect(row?.state).toBe('submitted')

    await engine.stop()
  })

  it('DOS-086 the office really refuses a line once the order has been submitted early', async () => {
    /*
     * THE TEETH. This is the pre-fix rule — submit the moment the HEADER is acked — run against the
     * same office, and it is the failure the review found: the second upload batch arrives for an
     * order that is no longer a draft, every line in it is refused `order_not_draft`, and the shop
     * gets a SHORT order. Without this, the first test's green could mean the office never says no.
     */
    const ORDER = 'o-b2-early'
    const office = new Office()
    const store = createMemoryStore()
    const engine = engineOn(store, office)
    await engine.start()

    office.offline = true
    await engine.enqueueMany(orderOps(ORDER, 6))

    const early: Promise<void>[] = []
    const off = engine.onAccepted((ops) => {
      for (const op of ops)
        if (op.table === 'sales_orders')
          early.push(
            office
              .submit({ id: op.rowId, idempotencyKey: `${op.rowId}:submit`, deviceId: DEVICE })
              .catch(() => undefined),
          )
    })

    office.offline = false
    await engine.flush()
    await Promise.all(early)
    // The refused lines of the second batch: send them and let the office answer.
    await engine.flush()
    off()

    const tray = await engine.needsAttention()
    expect(tray.map((item) => item.error.code)).toContain('order_not_draft')
    expect(office.lines.size).toBeLessThan(6)

    await engine.stop()
  })

  it('DOS-086 a phone killed between the upload and the pull submits on the next launch', async () => {
    /*
     * The Pixel 7 walk, minus the device's SQLite: the order lands while no screen carrying the hook
     * is mounted (no listener here at all), the app is killed (`stop()`), and the next launch is a
     * NEW engine over the SAME store. The catch-up sweep reads the rule off the outbox the device
     * kept and finishes the job — this is the half that a live subscription with no replay cannot do.
     */
    const ORDER = 'o-b2-killed'
    const office = new Office()
    const store = createMemoryStore()
    const first = engineOn(store, office)
    await first.start()

    office.offline = true
    await first.enqueueMany(orderOps(ORDER, 6))
    office.offline = false
    await first.flush()
    // It landed whole, and nothing submitted it: the rep was on the catalog, then the app died.
    expect(office.lines.size).toBe(6)
    expect(office.submits).toEqual([])
    await first.stop()

    const second = engineOn(store, office)
    await second.start()
    expect(await sweepOf(second, office)()).toEqual([ORDER])

    expect(office.submits).toEqual([
      { id: ORDER, idempotencyKey: `${ORDER}:submit`, deviceId: DEVICE },
    ])
    await second.sync('assert')
    const row = await second.getRow<{ order_no?: string | null }>('sales_orders', ORDER)
    expect(row?.order_no).toMatch(/^SO-26\d{5}$/)

    await second.stop()
  })

  it('DOS-086 the banner never asks the rep to submit, in either state the real engine produces', async () => {
    /*
     * The merge-review blocker, read off the STATE rather than off a chosen key. `new.tsx:269-275`
     * builds `orderOutcome` from four facts — the mutation's `queued`, the row's `_pending`, the
     * row's `order_no` and whether the row is known — and prints `t(outcome.bodyKey)`. Here those
     * facts come from the real engine at the two moments that matter, with no sweep attached so the
     * second moment stands still long enough to read.
     */
    const ORDER = 'o-b2-banner'
    const office = new Office()
    const store = createMemoryStore()
    const engine = engineOn(store, office)
    await engine.start()

    office.offline = true
    await engine.enqueueMany(orderOps(ORDER, 6))

    // MOMENT ONE: on the phone, nothing sent. The rep is looking at the banner in the dead spot.
    const held = await engine.getRow<{ _pending?: string | null; order_no?: string | null }>(
      'sales_orders',
      ORDER,
    )
    const heldBanner = orderOutcome({
      queued: true,
      pending: (held?._pending ?? null) as 'queued' | 'sending' | 'rejected' | null,
      orderNo: held?.order_no ?? null,
      persistent: true,
      rowKnown: true,
    })
    // `queued`, or `sending` if the flush the write kicks off has already claimed it against a dead
    // spot: both mean the same thing to the rep and to `orderOutcome` — it is still on this phone.
    expect(['queued', 'sending']).toContain(held?._pending)
    expect(heldBanner.kind).toBe('held')
    expect(strings[heldBanner.bodyKey as keyof typeof strings]).toBe(
      'It goes to the office as soon as there is a signal, and this phone submits it the moment it lands.',
    )

    /*
     * MOMENT TWO: the office has taken it and the pull has not run — `pullAfter: false` freezes the
     * exact window the sweep works in, which is where the old copy sent the rep to My orders.
     */
    office.offline = false
    await engine.flush({ pullAfter: false })
    const landed = await engine.getRow<{ _pending?: string | null; order_no?: string | null }>(
      'sales_orders',
      ORDER,
    )
    const draftBanner = orderOutcome({
      queued: true,
      pending: (landed?._pending ?? null) as 'queued' | 'sending' | 'rejected' | null,
      orderNo: landed?.order_no ?? null,
      persistent: true,
      rowKnown: true,
    })
    expect(landed?._pending ?? null).toBeNull()
    expect(draftBanner.kind).toBe('draft')
    expect(strings[draftBanner.bodyKey as keyof typeof strings]).toBe(
      'The office has it and this phone is submitting it now. If the office refuses, Needs you will say why.',
    )

    await engine.stop()
  })
})
