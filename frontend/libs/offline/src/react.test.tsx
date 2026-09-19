/**
 * @vitest-environment jsdom
 *
 * DOS-180 — `useRow` never answers for a row it has not read yet.
 *
 * S3's banner is bound to the order's own row (`orderOutcome`, sales-app/src/lib/outcome.ts), and the
 * field that stops a NOT-YET-READ row being taken for an acked one is `rowKnown: !placedRow.loading`.
 * That guard is only as honest as `loading`, and `loading` belonged to the hook, not to the id: the
 * mount with no id resolved it to false, and nothing put it back when the tap handed the hook a real
 * id. So for the render straight after "Place order" the hook answered "read, and there is no
 * `_pending`" about an order that had only just been queued — which `orderOutcome` reads as the ack
 * and prints "Reached the office as a draft" over an order still sitting in this phone's outbox.
 * Never-list #12: the app never says an order reached the office before it did.
 *
 * THE ONLY TEST IN THIS WORKSPACE THAT NEEDS A DOM. Every other React test here renders once through
 * `renderToStaticMarkup`, which never runs an effect — and the frame this bug lives in is precisely
 * the one between a render and the effect that answers it, so under a static render it does not
 * exist. jsdom is asked for by this file alone; the package's other tests stay in Node, where the
 * store adapters choose themselves by what the global scope carries.
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { OfflineProvider, useRow } from './react.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, tableManifest } from './test-support.js'

const ORDERS = tableManifest(
  'sales_orders',
  [column('id'), column('order_no'), column('state'), column('updated_at')],
  { writable: true },
)

/** React's act() wants to be told it is in a test, or every update warns. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** What the hook answered on one render — exactly what a screen reads on that render, nothing more. */
interface Frame {
  readonly id: string | null
  readonly loading: boolean
  readonly orderNo: string | null
}

/**
 * The screen, reduced to the two facts S3 asks the hook for. It records EVERY render, because the
 * defect is one frame long: a banner that says the wrong thing once has already said it.
 */
function Reader({
  frames,
  ask,
}: {
  frames: Frame[]
  ask: (set: (id: string | null) => void) => void
}): null {
  const [id, setId] = useState<string | null>(null)
  ask(setId)
  const read = useRow<{ order_no?: string | null }>('sales_orders', id)
  frames.push({ id, loading: read.loading, orderNo: read.row?.order_no ?? null })
  return null
}

let mounted: { root: Root; container: HTMLElement } | null = null

afterEach(async () => {
  const live = mounted
  mounted = null
  if (live === null) return
  await act(async () => {
    live.root.unmount()
    await Promise.resolve()
  })
  live.container.remove()
})

/** Mount the reader over a real engine holding one order, and hand back the id setter and the frames. */
async function mount(): Promise<{ frames: Frame[]; setId: (id: string | null) => void }> {
  const store = createMemoryStore()
  const server = new FakeServer([ORDERS])
  server.queuePull({
    changes: [
      {
        table: 'sales_orders',
        rows: [{ id: 'o1', order_no: 'SO-0007', state: 'confirmed', updated_at: '2026-09-19' }],
        deleted: [],
      },
    ],
    cursor: 'c1',
  })

  const frames: Frame[] = []
  let setId: (id: string | null) => void = () => undefined
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }

  await act(async () => {
    root.render(
      <OfflineProvider
        transport={server.transport()}
        deviceId="device-1"
        storeFactory={fixedStoreFactory(store)}
        databaseName="dos-test.db"
        identity={null}
        pullIntervalMs={0}
      >
        <Reader
          frames={frames}
          ask={(set) => {
            setId = set
          }}
        />
      </OfflineProvider>,
    )
  })
  // The engine's open, manifest and first pull are several promises deep; settle them before asking.
  for (let i = 0; i < 6; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  frames.length = 0
  return { frames, setId }
}

describe('DOS-180 a row this device has not read yet is never answered for', () => {
  it('DOS-180 the render straight after the tap says the row is not known yet, never that it is absent', async () => {
    const { frames, setId } = await mount()

    // The tap: `placed` goes from null to the order's own id, exactly as new.tsx sets it onSuccess.
    await act(async () => {
      setId('o1')
    })

    /*
     * The FIRST frame is the whole finding. `loading: false` there is what new.tsx turns into
     * `rowKnown: true`, and a `rowKnown` row with no `_pending` is the ack — the banner's
     * "Reached the office as a draft" over an order the office has never seen.
     */
    expect(frames[0]).toEqual({ id: 'o1', loading: true, orderNo: null })
    // No frame at all may claim the row is read while it is still null.
    expect(frames.filter((frame) => !frame.loading && frame.orderNo === null)).toEqual([])
    // And the read does land: the hook is not simply stuck saying "not yet".
    expect(frames.at(-1)).toEqual({ id: 'o1', loading: false, orderNo: 'SO-0007' })
  })

  it('DOS-180 a second, different id is a new question: not known, then known and absent', async () => {
    const { frames, setId } = await mount()
    await act(async () => {
      setId('o1')
    })
    frames.length = 0

    // A row this device does not hold. "Not read yet" and "read, and not there" are different answers.
    await act(async () => {
      setId('o2')
    })

    expect(frames[0]).toEqual({ id: 'o2', loading: true, orderNo: null })
    expect(frames.at(-1)).toEqual({ id: 'o2', loading: false, orderNo: null })
  })
})
