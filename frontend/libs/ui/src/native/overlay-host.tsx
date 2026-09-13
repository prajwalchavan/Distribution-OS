/**
 * DOS-164: the React Native glue for the overlay stack (`../overlay-stack.ts`, where the rules and the
 * reason live). Internal to the native kit: `native/index.ts` does not export it, so renderer parity is
 * unchanged and no screen ever sees it. `<OverlayStackProvider>` sits in the native `<ThemeProvider>`,
 * which every app root already mounts.
 *
 * In one sentence: the first presented Sheet or Dialog owns the one native Modal, and anything opened
 * while it is up renders inside that Modal as a plain full-size View — never a nested Modal, which is a
 * second, chained UIKit presentation with the same failure.
 */
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { StyleSheet, View } from 'react-native'

import { createOverlayStack, type OverlayRole, type OverlayStack } from '../overlay-stack.js'

interface OverlayHost {
  readonly stack: OverlayStack<ReactNode>
  /** At most one flush per tick, after every layout effect of the commit has recorded its intent. */
  readonly schedule: () => void
}

const OverlayStackContext = createContext<OverlayHost | null>(null)

function createHost(): OverlayHost {
  const stack = createOverlayStack<ReactNode>()
  let scheduled = false
  return {
    stack,
    schedule: () => {
      if (scheduled) return
      scheduled = true
      // React Native installs queueMicrotask (Libraries/Core/setUpTimers.js).
      queueMicrotask(() => {
        scheduled = false
        stack.flush()
      })
    },
  }
}

export function OverlayStackProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [host] = useState(createHost)
  return <OverlayStackContext.Provider value={host}>{children}</OverlayStackContext.Provider>
}

export interface Overlay {
  readonly id: string
  /** `null` before the stack has resolved an open (one microtask) and after the overlay closes. */
  readonly role: OverlayRole | null
  /** A root whose Modal is up: open, or retained by the layers over it. */
  readonly presented: boolean
  readonly hasLayers: boolean
  /** For a root's `onRequestClose` (Android back): the top layer's onClose, else its own. */
  readonly requestClose: () => void
}

const noSubscription = (): (() => void) => () => undefined

/**
 * One kit overlay's place in the stack. Snapshots are primitives, so a store change re-renders only
 * the overlays whose own role, presentation or layers changed. With no provider (a renderer test, a
 * gallery) it is today's behaviour: its own root, presented while open.
 */
export function useOverlay(open: boolean, onClose: () => void): Overlay {
  const host = useContext(OverlayStackContext)
  const id = useId()
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })
  const close = useCallback(() => {
    onCloseRef.current()
  }, [])

  const stack = host?.stack
  const subscribe = stack?.subscribe ?? noSubscription
  const role = useSyncExternalStore(subscribe, () => (stack ? stack.roleOf(id) : 'root'))
  const presented = useSyncExternalStore(subscribe, () => (stack ? stack.isPresented(id) : open))
  const hasLayers = useSyncExternalStore(subscribe, () => (stack ? stack.hasLayers(id) : false))

  useLayoutEffect(() => {
    if (host?.stack.request(id, open, close) === true) host.schedule()
  }, [host, id, open, close])
  useLayoutEffect(() => {
    if (host === null) return undefined
    return () => {
      if (host.stack.remove(id)) host.schedule()
    }
  }, [host, id])

  const requestClose = useCallback(() => {
    if (host === null) onCloseRef.current()
    else host.stack.requestClose(id)
  }, [host, id])

  return { id, role, presented, hasLayers, requestClose }
}

/**
 * Hands this overlay's panel to its root's outlet while it is a layer, and `null` otherwise. The role
 * is read live from the stack rather than from the render snapshot, because the flush that made it a
 * layer can land after the render began. No dependency array, and a layout effect, so the outlet has
 * every new element — a keystroke in a controlled field — before paint; the stack ignores an unchanged
 * value, so a root re-rendering costs nothing.
 */
export function useLayerContent(overlay: Overlay, element: ReactNode): void {
  const host = useContext(OverlayStackContext)
  const { id } = overlay
  useLayoutEffect(() => {
    if (host === null) return
    host.stack.setLayer(id, host.stack.roleOf(id) === 'layer' ? element : null)
  })
  useLayoutEffect(() => {
    if (host === null) return undefined
    // An unmounting layer leaves its host's outlet now, not one microtask later.
    return () => {
      host.stack.setLayer(id, null)
    }
  }, [host, id])
}

/**
 * Whether a root renders its own panel inside its Modal.
 *
 * While open, always. After it closes the panel STAYS, so the Modal's slide or fade still has the panel
 * to take out — on iOS React Native keeps a dismissing Modal's children until `onDismiss`
 * (Modal.js `_shouldShowModal`), which is what every Sheet and Dialog did before the stack. The one
 * exception is a root closed while layers sit over it: it is retained, its panel goes at once, and it
 * stays gone through that Modal's later dismissal, until the overlay opens again.
 */
export function useHostPanel(open: boolean, overlay: Overlay): boolean {
  const [kept, setKept] = useState(true)
  const next = open ? true : overlay.hasLayers ? false : kept
  if (next !== kept) setKept(next)
  return open || next
}

/**
 * The layers over root `hostId`, each a plain full-size View after the root's own panel, inside the
 * root's Modal.
 *
 * Memoised and re-rendered only from the stack (`version(hostId)`), never from its parent: a layer's
 * controlled TextInput must receive each value once, from the element its own overlay handed over, and
 * never a stale element pushed down by the host re-rendering (which would move the caret). Keep the
 * wrapper a bare View. `accessibilityViewIsModal` hides only SIBLINGS from VoiceOver, which is why the
 * covered host panel also hides itself.
 */
export const OverlayOutlet = memo(function OverlayOutlet({
  hostId,
}: {
  hostId: string
}): React.JSX.Element | null {
  const host = useContext(OverlayStackContext)
  const stack = host?.stack
  useSyncExternalStore(stack?.subscribe ?? noSubscription, () =>
    stack ? stack.version(hostId) : 0,
  )
  if (stack === undefined) return null
  return (
    <>
      {stack.layersOf(hostId).map((layer) =>
        layer.render === null ? null : (
          <View key={layer.id} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
            {layer.render}
          </View>
        ),
      )}
    </>
  )
})
