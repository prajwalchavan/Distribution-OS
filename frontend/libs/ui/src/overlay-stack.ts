/**
 * DOS-164: which kit overlay owns the one native modal.
 *
 * iOS presents a React Native `<Modal>` from the view controller that owns its host view. A second
 * Modal rendered as a SIBLING of an open one walks up to a controller that is already presenting, and
 * UIKit refuses it ("Attempt to present … which is already presenting"); the refused Modal then stays
 * `visible` but unseen until its host view is recycled. A view INSIDE the presented Modal's content
 * resolves to that Modal's own controller instead. So a Sheet or Dialog opened while another kit
 * overlay is up does not get a Modal of its own: it renders inside that one's Modal, as a layer.
 *
 * This is the pure half, with no React or React Native import, so vitest pins every rule
 * (`overlay-stack.test.ts`); `native/overlay-host.tsx` is the glue. Callers record INTENTS from layout
 * effects and one `flush()` per tick resolves them, so the outcome never depends on which overlay comes
 * first in the React tree.
 *
 * Rules, applied by `flush()`:
 *  1. Removes and closes first, then opens, each in request order.
 *  2. An overlay opened while a root is presented (open, or retained by open layers) becomes a LAYER of
 *     that root. Otherwise it becomes a ROOT, which owns the one native Modal.
 *  3. A retained root that is opened again takes its panel back and stays the root.
 *  4. A role is fixed until the overlay closes, except under rule 6.
 *  5. A root closed while it has open layers is RETAINED (Modal up, panel gone) until its last layer
 *     closes, and is removed in that flush. A root closed with no layers is removed at once.
 *  6. A layer whose root is removed (unmounted) while the layer is open is promoted: the oldest such
 *     layer becomes the root and the rest its layers. An open overlay is never left without a host.
 * After every flush at most one root is presented, and every open overlay is that root or one of its
 * layers. The store keeps those true by these rules; it never throws on an unexpected order.
 */

export type OverlayRole = 'root' | 'layer'

export interface OverlayLayer<T> {
  readonly id: string
  /** What the layer's own overlay last handed over; `null` until it has. */
  readonly render: T | null
}

export interface OverlayStack<T> {
  /**
   * Records an open or close intent. An `open` equal to the overlay's current state records nothing,
   * so a component re-rendering with the same `open` never costs a flush. Returns whether a flush has
   * something to do.
   */
  readonly request: (id: string, open: boolean, onClose: () => void) => boolean
  /** Records an unmount. Returns whether a flush has something to do. */
  readonly remove: (id: string) => boolean
  /** Applies the recorded intents by the rules above, then notifies subscribers once. */
  readonly flush: () => void
  readonly roleOf: (id: string) => OverlayRole | null
  /** A layer's root; `null` for anything else. */
  readonly hostOf: (id: string) => string | null
  /** Whether `rootId` owns the presented native Modal (open, or retained by its layers). */
  readonly isPresented: (rootId: string) => boolean
  readonly hasLayers: (rootId: string) => boolean
  /**
   * A layer's content for its root's outlet. Ignored unless `id` is a layer; notifies (and bumps only
   * its root's version) only when the value changes, so `null` after `null` costs nothing.
   */
  readonly setLayer: (id: string, render: T | null) => void
  /** A root's layers in open order. The same array until that root's version changes. */
  readonly layersOf: (rootId: string) => readonly OverlayLayer<T>[]
  readonly version: (rootId: string) => number
  /** `onRequestClose` (Android back) on a root: the top layer's onClose, or the root's own. */
  readonly requestClose: (rootId: string) => void
  readonly subscribe: (listener: () => void) => () => void
  readonly presentedRoots: () => readonly string[]
}

type Intent = 'open' | 'close' | 'remove'

interface Entry<T> {
  readonly id: string
  role: OverlayRole
  /** False only for a RETAINED root. A layer is open by definition. */
  open: boolean
  /** A layer's root. */
  host: string | null
  /** A root's layers, in open order. */
  layers: readonly string[]
  /** A layer's content. */
  render: T | null
  version: number
  cache: { readonly version: number; readonly list: readonly OverlayLayer<T>[] } | null
}

const NO_LAYERS: readonly OverlayLayer<never>[] = Object.freeze([])

export function createOverlayStack<T>(): OverlayStack<T> {
  // Only overlays that hold a role have an entry.
  const entries = new Map<string, Entry<T>>()
  const callbacks = new Map<string, () => void>()
  // One intent per overlay, the latest; re-inserted so the Map's order is the request order.
  const pending = new Map<string, Intent>()
  const listeners = new Set<() => void>()
  let clock = 0

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const bump = (root: Entry<T>): void => {
    clock += 1
    root.version = clock
  }
  const presentedRoot = (): Entry<T> | undefined => {
    for (const entry of entries.values()) if (entry.role === 'root') return entry
    return undefined
  }

  function detachLayer(layer: Entry<T>): void {
    entries.delete(layer.id)
    const root = layer.host === null ? undefined : entries.get(layer.host)
    if (root === undefined) return
    root.layers = root.layers.filter((id) => id !== layer.id)
    bump(root)
    // Rule 5: a retained root goes with its last layer.
    if (!root.open && root.layers.length === 0) entries.delete(root.id)
  }

  function removeRoot(root: Entry<T>): void {
    entries.delete(root.id)
    // Rule 6: the oldest open layer takes over the Modal and the rest stay its layers.
    const [oldest, ...rest] = root.layers
    const heir = oldest === undefined ? undefined : entries.get(oldest)
    if (heir === undefined) return
    heir.role = 'root'
    heir.host = null
    heir.render = null
    heir.layers = rest
    bump(heir)
    for (const id of rest) {
      const layer = entries.get(id)
      if (layer !== undefined) layer.host = heir.id
    }
  }

  function applyClose(id: string, unmount: boolean): void {
    if (unmount) callbacks.delete(id)
    const entry = entries.get(id)
    if (entry === undefined) return
    if (entry.role === 'layer') {
      detachLayer(entry)
    } else if (!unmount && entry.layers.length > 0) {
      // Rule 5: retained. Its Modal stays up for the layers; the component drops its own panel.
      entry.open = false
    } else {
      removeRoot(entry)
    }
  }

  function applyOpen(id: string): void {
    const entry = entries.get(id)
    if (entry !== undefined) {
      // Rule 3: a retained root takes its panel back. An overlay that is already open stays as it is.
      entry.open = true
      return
    }
    const root = presentedRoot()
    clock += 1
    entries.set(id, {
      id,
      role: root === undefined ? 'root' : 'layer',
      open: true,
      host: root === undefined ? null : root.id,
      layers: [],
      render: null,
      version: clock,
      cache: null,
    })
    if (root !== undefined) {
      root.layers = [...root.layers, id]
      bump(root)
    }
  }

  return {
    request: (id, open, onClose) => {
      const entry = entries.get(id)
      const applied = entry?.open ?? false
      const intent = pending.get(id)
      const current = intent === undefined ? applied : intent === 'open'
      // A pending unmount is always cancelled by a request: the component is evidently still mounted.
      if (intent !== 'remove' && open === current) {
        if (entry !== undefined) callbacks.set(id, onClose)
        return false
      }
      callbacks.set(id, onClose)
      pending.delete(id)
      if (open === applied) return false // back to what is already applied: nothing left to resolve
      pending.set(id, open ? 'open' : 'close')
      return true
    },

    remove: (id) => {
      pending.delete(id)
      if (!entries.has(id)) {
        // Never presented, or already gone: nothing to resolve, only forget it.
        callbacks.delete(id)
        return false
      }
      pending.set(id, 'remove')
      return true
    },

    flush: () => {
      if (pending.size === 0) return
      const intents = [...pending]
      pending.clear()
      // Rule 1. Tree order would make the owner's Sheet/Dialog swap layer in one direction only.
      for (const [id, intent] of intents) if (intent !== 'open') applyClose(id, intent === 'remove')
      for (const [id, intent] of intents) if (intent === 'open') applyOpen(id)
      emit()
    },

    roleOf: (id) => entries.get(id)?.role ?? null,

    hostOf: (id) => {
      const entry = entries.get(id)
      return entry?.role === 'layer' ? entry.host : null
    },

    isPresented: (rootId) => entries.get(rootId)?.role === 'root',

    hasLayers: (rootId) => {
      const entry = entries.get(rootId)
      return entry?.role === 'root' && entry.layers.length > 0
    },

    setLayer: (id, render) => {
      const layer = entries.get(id)
      if (layer === undefined || layer.role !== 'layer' || layer.render === render) return
      layer.render = render
      const root = layer.host === null ? undefined : entries.get(layer.host)
      if (root !== undefined) bump(root)
      emit()
    },

    layersOf: (rootId) => {
      const root = entries.get(rootId)
      if (root === undefined || root.role !== 'root' || root.layers.length === 0) return NO_LAYERS
      let cache = root.cache
      if (cache === null || cache.version !== root.version) {
        cache = {
          version: root.version,
          list: root.layers.map((id) => ({ id, render: entries.get(id)?.render ?? null })),
        }
        root.cache = cache
      }
      return cache.list
    },

    version: (rootId) => entries.get(rootId)?.version ?? 0,

    requestClose: (rootId) => {
      const root = entries.get(rootId)
      const top = root?.role === 'root' ? root.layers[root.layers.length - 1] : undefined
      callbacks.get(top ?? rootId)?.()
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    presentedRoots: () =>
      [...entries.values()].filter((entry) => entry.role === 'root').map((entry) => entry.id),
  }
}
