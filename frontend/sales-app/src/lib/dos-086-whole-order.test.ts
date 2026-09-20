/**
 * DOS-086, after review — the draft submits itself, but only once the WHOLE order is at the office,
 * and a screen that was not mounted when it landed still finishes it.
 *
 * Two failures the review found, both of them behaviour a rep would meet on a real beat:
 *
 *   1. HALF AN ORDER. `useEnqueueOrder` queues one header and N lines; the engine claims at most 50
 *      ops per upload, so an offline beat puts the header in batch 1 and its lines in batch 2.
 *      Firing on the header's acceptance raced the rest: a submit that won left every remaining line
 *      refused for ever with `order_not_draft` — a short order at the shop, which the rep pressing
 *      the button by hand could never cause.
 *   2. NOTHING LOOKED AGAIN. `useAccepted` is a live subscription with no replay, so an order that
 *      landed while the rep was on the catalog, the inbox or Me reached no listener at all, and
 *      nothing re-scanned on a later mount.
 *
 * THE RULE IS TESTED, NOT THE RENDER. `submitLandedDrafts` is the whole decision — which orders are
 * ready, what is sent, what a refusal does — behind named dependencies, so it runs here against a
 * fake outbox and a fake API with no React at all. That is not a convenience: the app's ESLint
 * forbids importing a renderer in app sources (docs/08 §0, `frontend/libs/config/eslint/app.js`), so
 * a test in this package cannot mount a hook, and the rule was moved out of the hook to be reachable.
 * What is left in `useSubmitAcceptedDrafts` is two lines of wiring — the acceptance listener and the
 * catch-up effect — and the last test reads those off the source, which is the only thing a source
 * check is used for here.
 */
import { describe, expect, it, vi, type Mock } from 'vitest'

import { ordersToSubmit, submitLandedDrafts, type QueuedOp } from './queue'

const ORDER = '01924f9a-0000-7000-8000-0000000000a1'
const OTHER = '01924f9a-0000-7000-8000-0000000000a2'
const DEVICE = '01924f9a-0000-7000-8000-0000000000d1'

function header(orderId: string, status: QueuedOp['status']): QueuedOp {
  return {
    table: 'sales_orders',
    rowId: orderId,
    op: 'PUT',
    status,
    data: { retailer_id: 'r-1', state: 'draft' },
  }
}

function line(orderId: string, id: string, status: QueuedOp['status']): QueuedOp {
  return {
    table: 'sales_order_lines',
    rowId: id,
    op: 'PUT',
    status,
    data: { order_id: orderId, variant_id: 'v-1', entered_qty: 2 },
  }
}

/** Exactly what `orders.submit` is handed — the shape the test asserts on, spelled once. */
interface SubmitInput {
  id: string
  idempotencyKey: string
  deviceId: string
}

interface Fake {
  outbox: QueuedOp[]
  state: string | null
  submit: Mock<(input: SubmitInput) => Promise<unknown>>
  pulls: number
}

function fake(outbox: QueuedOp[], state: string | null = 'draft'): Fake {
  return {
    outbox,
    state,
    submit: vi.fn<(input: SubmitInput) => Promise<unknown>>().mockResolvedValue({}),
    pulls: 0,
  }
}

async function sweep(f: Fake): Promise<string[]> {
  return submitLandedDrafts({
    outbox: () => Promise.resolve(f.outbox),
    orderState: () => Promise.resolve(f.state),
    submit: (input) => f.submit(input),
    pull: () => {
      f.pulls += 1
      return Promise.resolve()
    },
    deviceId: DEVICE,
  })
}

describe('DOS-086 the whole-order gate', () => {
  it('DOS-086 holds an order whose lines are still in the second upload batch', () => {
    expect(
      ordersToSubmit([
        header(ORDER, 'acked'),
        line(ORDER, 'l-1', 'queued'),
        line(ORDER, 'l-2', 'queued'),
      ]),
    ).toEqual([])
    // Mid-flight is no different from queued.
    expect(ordersToSubmit([header(ORDER, 'acked'), line(ORDER, 'l-1', 'sending')])).toEqual([])
  })

  it('DOS-086 names the order once every one of its ops is at the office', () => {
    expect(
      ordersToSubmit([
        header(ORDER, 'acked'),
        line(ORDER, 'l-1', 'acked'),
        line(ORDER, 'l-2', 'acked'),
      ]),
    ).toEqual([ORDER])
  })

  it('DOS-086 never names an order the office refused a line of', () => {
    expect(
      ordersToSubmit([
        header(ORDER, 'acked'),
        line(ORDER, 'l-1', 'acked'),
        line(ORDER, 'l-2', 'rejected'),
      ]),
    ).toEqual([])
    // A refused header is not an order at the office at all.
    expect(ordersToSubmit([header(ORDER, 'rejected'), line(ORDER, 'l-1', 'queued')])).toEqual([])
  })

  it('DOS-086 holds one order without holding the next', () => {
    expect(
      ordersToSubmit([
        header(ORDER, 'acked'),
        line(ORDER, 'l-1', 'queued'),
        header(OTHER, 'acked'),
        line(OTHER, 'l-9', 'acked'),
      ]),
    ).toEqual([OTHER])
  })

  it('DOS-086 reads only this app’s own order writes', () => {
    // Lines whose header is not in the outbox (a reinstall, a wipe) are not an order to submit.
    expect(ordersToSubmit([line(ORDER, 'l-1', 'acked')])).toEqual([])
    // Another table's queued op says nothing about an order.
    expect(
      ordersToSubmit([
        header(ORDER, 'acked'),
        {
          table: 'visits',
          rowId: 'v-1',
          op: 'PUT',
          status: 'queued',
          data: { retailer_id: 'r-1' },
        },
      ]),
    ).toEqual([ORDER])
    // An empty outbox is the ordinary case on a phone that has never been offline.
    expect(ordersToSubmit([])).toEqual([])
  })
})

describe('DOS-086 the sweep finishes what the outbox started', () => {
  it('DOS-086 submits a landed draft with the same key the Submit order button uses', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b1'
    const f = fake([header(id, 'acked'), line(id, 'lb-1', 'acked')])

    expect(await sweep(f)).toEqual([id])
    expect(f.submit).toHaveBeenCalledTimes(1)
    expect(f.submit.mock.calls[0]?.[0]).toEqual({
      id,
      idempotencyKey: `${id}:submit`,
      deviceId: DEVICE,
    })
    // And the number comes down straight after.
    expect(f.pulls).toBe(1)
  })

  it('DOS-086 sends nothing while the order’s lines are still going up, and sends when they land', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b2'
    const f = fake([header(id, 'acked'), line(id, 'lc-1', 'queued')])

    // Batch 1: the header is at the office, the lines are not.
    expect(await sweep(f)).toEqual([])
    expect(f.submit).not.toHaveBeenCalled()

    // Batch 2 lands, and the acceptance it emits runs the sweep again.
    f.outbox = [header(id, 'acked'), line(id, 'lc-1', 'acked')]
    expect(await sweep(f)).toEqual([id])
    expect(f.submit).toHaveBeenCalledTimes(1)
  })

  it('DOS-086 leaves alone an order the office has already moved past', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b3'
    const f = fake([header(id, 'acked')], 'confirmed')

    expect(await sweep(f)).toEqual([])
    expect(f.submit).not.toHaveBeenCalled()
  })

  it('DOS-086 submits a draft the device has not pulled back yet', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b4'
    // No local row: the acceptance is ahead of the pull, which is the ordinary case.
    const f = fake([header(id, 'acked')], null)

    expect(await sweep(f)).toEqual([id])
  })

  it('DOS-086 asks once per order however many screens sweep', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b5'
    const f = fake([header(id, 'acked')])

    // Two screens carrying the hook sweep at the same moment.
    const [first, second] = await Promise.all([sweep(f), sweep(f)])
    expect([...first, ...second]).toEqual([id])
    expect(f.submit).toHaveBeenCalledTimes(1)

    // A third mount asks nothing again.
    expect(await sweep(f)).toEqual([])
    expect(f.submit).toHaveBeenCalledTimes(1)
  })

  it('DOS-086 leaves a refused order as a draft, and does not call again on the next mount', async () => {
    const id = '01924f9a-0000-7000-8000-0000000000b6'
    const f = fake([header(id, 'acked')])
    f.submit.mockRejectedValue(new Error('over the credit limit'))

    expect(await sweep(f)).toEqual([])
    expect(f.submit).toHaveBeenCalledTimes(1)
    expect(f.pulls).toBe(0)

    expect(await sweep(f)).toEqual([])
    expect(f.submit).toHaveBeenCalledTimes(1)
  })
})

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

describe('DOS-086 the hook runs the sweep on a mount, not only on an acceptance', () => {
  it('DOS-086 wires both the acceptance listener and the catch-up effect', async () => {
    const { readFileSync } = (await import(NODE_FS)) as NodeFs
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    const source = readFileSync(fileURLToPath(new URL('./queue.ts', import.meta.url)), 'utf8')
    const hook = source.slice(source.indexOf('export function useSubmitAcceptedDrafts'))

    expect({
      // The landing, while a screen with the hook happens to be mounted.
      onAcceptance: /useAccepted\(\(\) => \{\s*void sweep\(\)/.test(hook),
      // And the catch-up, for everything that landed while none was.
      onMount: /useEffect\(\(\) => \{[\s\S]*?void sweep\(\)[\s\S]*?\}, \[ready, sweep\]\)/.test(
        hook,
      ),
      // The outbox is unreadable before the store opens, so the sweep waits for `ready`.
      waitsForStore: /if \(!ready\) return/.test(hook),
    }).toEqual({ onAcceptance: true, onMount: true, waitsForStore: true })
  })
})
