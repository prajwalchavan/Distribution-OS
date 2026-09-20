/**
 * @vitest-environment jsdom
 *
 * DOS-068 — on a phone the strip must be able to say the radio is off.
 *
 * `status.online` is `radio() && reachable`. `reachable` is honest everywhere: every transport call goes through
 * `call()`, and a failure marks the engine unreachable. `radio()` is not: with no hint it falls back to
 * `navigator.onLine`, and React Native's `navigator` has no `onLine` at all — `undefined !== false` — so a phone
 * believes its radio is up for ever. The provider's only source of hints is `window`'s own `online` / `offline`
 * events, which no phone fires. The delivery gate measured exactly that: airplane mode on the Pixel 7, ping
 * "Network is unreachable", and the strip stayed green on "Updated just now" for the whole run, while the same
 * cut on the web said "Offline since 4:55 pm" within the second.
 *
 * So the radio becomes something an app can TELL the provider — NetInfo on a device, which is what docs/27 §10
 * names — through one optional subscription. The engine already knows what to do with the answer: a hint that
 * the radio is back clears the backoff and drains the queue (DOS-183), which is why this is a hint and not a
 * flag the strip reads on its own.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { OfflineProvider, useSyncStatus } from './react.js'
import { createMemoryStore } from './store/memory.js'
import { column, FakeServer, fixedStoreFactory, tableManifest } from './test-support.js'

const ORDERS = tableManifest(
  'sales_orders',
  [column('id'), column('state'), column('updated_at')],
  {
    writable: true,
  },
)

/** React's act() wants to be told it is in a test, or every update warns. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Strip({ seen }: { seen: boolean[] }): null {
  const status = useSyncStatus()
  seen.push(status.online)
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

/** Let the engine's open, manifest and first pull settle before anyone asks it anything. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

describe('DOS-068 the app tells the provider what the radio is doing', () => {
  it('DOS-068 a radio the app reports as off takes the strip offline, and back on brings it back', async () => {
    const store = createMemoryStore()
    const server = new FakeServer([ORDERS], 'delivery')
    server.queuePull({ changes: [] })
    const seen: boolean[] = []
    let report: ((online: boolean) => void) | null = null
    let stopped = 0

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
          watchRadio={(onChange) => {
            report = onChange
            return () => {
              stopped += 1
            }
          }}
        >
          <Strip seen={seen} />
        </OfflineProvider>,
      )
    })
    await settle()

    // The app is holding the subscription, and the engine started out believing it was connected.
    expect(report).not.toBeNull()
    expect(seen.at(-1)).toBe(true)

    // Airplane mode: the phone knows before any call fails, so the strip says so at once.
    await act(async () => {
      report?.(false)
      await Promise.resolve()
    })
    expect(seen.at(-1)).toBe(false)

    // And the radio coming back is the reconnect: the strip goes green again without waiting for the poll.
    await act(async () => {
      report?.(true)
      await Promise.resolve()
    })
    expect(seen.at(-1)).toBe(true)

    // Nothing is left listening on a provider that has gone.
    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
    mounted = null
    container.remove()
    expect(stopped).toBe(1)
  })
})
