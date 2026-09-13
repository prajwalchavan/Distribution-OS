/**
 * DOS-164: the native kit's overlay stack.
 *
 * iOS presents a React Native `<Modal>` from the view controller that owns its host view. A Dialog
 * rendered as a SIBLING of an open Sheet walks up to the screen's controller, which is already
 * presenting the Sheet, and UIKit refuses: "Attempt to present … which is already presenting". The
 * refused Modal then stays `visible` but never shown until its host view is recycled, so the manager's
 * Approve and the accountant's Bank it / Mark bounced did nothing from their panels on an iPhone.
 *
 * The store decides which kit overlay owns the one native Modal (the ROOT) and which render inside it
 * (LAYERS). It is pure TypeScript, so every rule is pinned here without a React Native renderer; the
 * glue in `native/overlay-host.tsx` and the call sites in `native/feedback.tsx` are pinned by
 * `native-overlays.test.ts`, and the device walk is `QA/tools/e2e/dos-164-ios-sheet-dialog.mjs`.
 */
import { describe, expect, it } from 'vitest'

import { createOverlayStack, type OverlayStack } from './overlay-stack.js'

interface Harness {
  readonly stack: OverlayStack<string>
  /** Every onClose the store called, in order. */
  readonly closed: string[]
  readonly emits: () => number
  readonly open: (id: string) => void
  readonly close: (id: string) => void
}

function harness(): Harness {
  const stack = createOverlayStack<string>()
  const closed: string[] = []
  let emits = 0
  stack.subscribe(() => {
    emits += 1
  })
  const onClose = (id: string) => () => {
    closed.push(id)
  }
  return {
    stack,
    closed,
    emits: () => emits,
    open: (id) => {
      stack.request(id, true, onClose(id))
    },
    close: (id) => {
      stack.request(id, false, onClose(id))
    },
  }
}

const layerIds = (stack: OverlayStack<string>, rootId: string): string[] =>
  stack.layersOf(rootId).map((layer) => layer.id)

describe('DOS-164: overlay stack', () => {
  it('DOS-164: a Dialog opened while a Sheet is presented is layered into that Sheet, never a second native modal', () => {
    const { stack, open } = harness()
    open('sheet')
    stack.flush()
    expect(stack.roleOf('sheet')).toBe('root')
    expect(stack.presentedRoots()).toEqual(['sheet'])

    // The order panel's Approve: `setDeciding(...)` from a button inside the Sheet.
    open('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBe('layer')
    expect(stack.hostOf('dialog')).toBe('sheet')
    expect(stack.isPresented('dialog')).toBe(false)
    expect(stack.presentedRoots()).toEqual(['sheet'])
    expect(stack.hasLayers('sheet')).toBe(true)
    expect(layerIds(stack, 'sheet')).toEqual(['dialog'])

    // The layer's content reaches the host's outlet, and only the host's version moves.
    const before = stack.version('sheet')
    stack.setLayer('dialog', 'Note for the person who asked')
    expect(stack.version('sheet')).toBeGreaterThan(before)
    expect(stack.layersOf('sheet')).toEqual([
      { id: 'dialog', render: 'Note for the person who asked' },
    ])
  })

  it("DOS-164: the Sheet's modal stays presented while its layered Dialog is open, even after the Sheet itself is closed", () => {
    const { stack, open, close } = harness()
    open('sheet')
    stack.flush()
    open('dialog')
    stack.flush()

    // A confirm handler that clears the Sheet's selection before the write settles.
    close('sheet')
    stack.flush()
    expect(stack.roleOf('sheet')).toBe('root')
    expect(stack.isPresented('sheet')).toBe(true)
    expect(stack.presentedRoots()).toEqual(['sheet'])
    expect(stack.hostOf('dialog')).toBe('sheet')
    expect(layerIds(stack, 'sheet')).toEqual(['dialog'])

    // The last layer closes: the retained host goes in the same flush.
    close('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBeNull()
    expect(stack.roleOf('sheet')).toBeNull()
    expect(stack.isPresented('sheet')).toBe(false)
    expect(stack.presentedRoots()).toEqual([])
  })

  it('DOS-164: a Dialog cancelled over a Sheet and opened again is layered again, so no dialog is left open but unseen', () => {
    const { stack, open, close } = harness()
    open('sheet')
    stack.flush()
    open('dialog')
    stack.flush()

    // Cancel leaves the panel up.
    close('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBeNull()
    expect(stack.roleOf('sheet')).toBe('root')
    expect(stack.hasLayers('sheet')).toBe(false)
    expect(stack.presentedRoots()).toEqual(['sheet'])

    // Approve again opens the dialog again, inside the same Sheet.
    open('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBe('layer')
    expect(stack.hostOf('dialog')).toBe('sheet')
    expect(stack.presentedRoots()).toEqual(['sheet'])

    // Cancel, Close, then the page-level card's Approve: the dialog owns its own modal.
    close('dialog')
    stack.flush()
    close('sheet')
    stack.flush()
    expect(stack.presentedRoots()).toEqual([])
    open('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBe('root')
    expect(stack.presentedRoots()).toEqual(['dialog'])
  })

  it('DOS-164: a Dialog opened with nothing presented owns its own modal', () => {
    const { stack, open } = harness()
    open('dialog')
    stack.flush()
    expect(stack.roleOf('dialog')).toBe('root')
    expect(stack.hostOf('dialog')).toBeNull()
    expect(stack.isPresented('dialog')).toBe(true)
    expect(stack.hasLayers('dialog')).toBe(false)
    expect(stack.presentedRoots()).toEqual(['dialog'])
  })

  it("DOS-164: a close and an open in the same flush resolve the close first whichever was requested first, so the owner's Sheet/Dialog swap keeps two separate modals in both directions", () => {
    // Contrast: the same two overlays DO layer when the Dialog opens while the Sheet is still up.
    {
      const { stack, open } = harness()
      open('sheet')
      stack.flush()
      open('dialog')
      stack.flush()
      expect(stack.roleOf('dialog')).toBe('layer')
    }

    for (const openFirst of [true, false]) {
      const { stack, open, close } = harness()
      open('sheet')
      stack.flush()

      // Forward (owner approvals.tsx: Approve sets `confirm`, which hides the Sheet in the same commit).
      if (openFirst) {
        open('dialog')
        close('sheet')
      } else {
        close('sheet')
        open('dialog')
      }
      stack.flush()
      expect(stack.roleOf('sheet'), `forward, open requested first: ${openFirst}`).toBeNull()
      expect(stack.roleOf('dialog')).toBe('root')
      expect(stack.hostOf('dialog')).toBeNull()
      expect(stack.presentedRoots()).toEqual(['dialog'])

      // Backward (Cancel: `setConfirm(null)` reopens the Sheet in the same commit).
      if (openFirst) {
        open('sheet')
        close('dialog')
      } else {
        close('dialog')
        open('sheet')
      }
      stack.flush()
      expect(stack.roleOf('dialog'), `backward, open requested first: ${openFirst}`).toBeNull()
      expect(stack.roleOf('sheet')).toBe('root')
      expect(stack.hostOf('sheet')).toBeNull()
      expect(stack.presentedRoots()).toEqual(['sheet'])
    }
  })

  it('DOS-164: a retained Sheet opened again takes its panel back and is never layered into itself', () => {
    const { stack, open, close } = harness()
    open('sheet')
    stack.flush()
    open('dialog')
    stack.flush()
    close('sheet')
    stack.flush()
    expect(stack.isPresented('sheet')).toBe(true)

    open('sheet')
    stack.flush()
    expect(stack.roleOf('sheet')).toBe('root')
    expect(stack.hostOf('sheet')).toBeNull()
    expect(layerIds(stack, 'sheet')).toEqual(['dialog'])
    expect(stack.presentedRoots()).toEqual(['sheet'])

    // Open again now, so the last layer closing leaves it up rather than removing it.
    close('dialog')
    stack.flush()
    expect(stack.roleOf('sheet')).toBe('root')
    expect(stack.isPresented('sheet')).toBe(true)
    expect(stack.hasLayers('sheet')).toBe(false)
  })

  it('DOS-164: a layer whose host unmounts while it is open becomes the root, so it is never left open without a modal', () => {
    {
      const { stack, open } = harness()
      open('sheet')
      stack.flush()
      open('first')
      stack.flush()
      open('second')
      stack.flush()
      expect(layerIds(stack, 'sheet')).toEqual(['first', 'second'])

      stack.remove('sheet')
      stack.flush()
      expect(stack.roleOf('sheet')).toBeNull()
      expect(stack.roleOf('first')).toBe('root')
      expect(stack.hostOf('first')).toBeNull()
      expect(stack.roleOf('second')).toBe('layer')
      expect(stack.hostOf('second')).toBe('first')
      expect(layerIds(stack, 'first')).toEqual(['second'])
      expect(stack.presentedRoots()).toEqual(['first'])
    }
    {
      // A RETAINED host (closed, still hosting) that unmounts hands over the same way.
      const { stack, open, close } = harness()
      open('sheet')
      stack.flush()
      open('dialog')
      stack.flush()
      close('sheet')
      stack.flush()
      stack.remove('sheet')
      // An overlay opened in the same flush joins the promoted root instead of racing it.
      open('late')
      stack.flush()
      expect(stack.roleOf('dialog')).toBe('root')
      expect(stack.roleOf('late')).toBe('layer')
      expect(stack.hostOf('late')).toBe('dialog')
      expect(stack.presentedRoots()).toEqual(['dialog'])
    }
  })

  it('DOS-164: onRequestClose (Android back) closes the top layer before its host', () => {
    const { stack, open, close, closed } = harness()
    open('sheet')
    stack.flush()
    open('first')
    stack.flush()
    open('second')
    stack.flush()

    stack.requestClose('sheet')
    expect(closed).toEqual(['second'])
    close('second')
    stack.flush()

    stack.requestClose('sheet')
    expect(closed).toEqual(['second', 'first'])
    close('first')
    stack.flush()

    stack.requestClose('sheet')
    expect(closed).toEqual(['second', 'first', 'sheet'])
  })

  it("DOS-164: an unchanged request records nothing and an unchanged layer emits nothing, so a root Sheet's re-render never re-renders an outlet", () => {
    const { stack, open, close, emits } = harness()
    // A closed overlay that re-renders closed records nothing.
    close('sheet')
    stack.flush()
    expect(emits()).toBe(0)

    open('sheet')
    stack.flush()
    const afterOpen = emits()
    const version = stack.version('sheet')
    const layers = stack.layersOf('sheet')

    // A field-app Sheet re-rendering on every keystroke: open again, and no layer content.
    open('sheet')
    stack.flush()
    stack.setLayer('sheet', null)
    stack.setLayer('sheet', null)
    expect(emits()).toBe(afterOpen)
    expect(stack.version('sheet')).toBe(version)
    expect(stack.layersOf('sheet')).toBe(layers)

    open('dialog')
    stack.flush()
    const afterLayer = emits()
    stack.setLayer('dialog', null)
    expect(emits()).toBe(afterLayer)
    stack.setLayer('dialog', 'body')
    stack.setLayer('dialog', 'body')
    expect(emits()).toBe(afterLayer + 1)
    stack.setLayer('dialog', null)
    stack.setLayer('dialog', null)
    expect(emits()).toBe(afterLayer + 2)
  })
})

/**
 * Amendment (b): both invariants after EVERY flush, for every order in which two Sheets and two
 * Dialogs open, close and unmount — including a close and an open in the same flush.
 *
 * A breadth-first walk over the reachable states, not a sample: a state is the store's observable
 * shape plus which overlays are mounted, which are open and the intents not yet flushed (at most two,
 * which covers every same-commit pair). Two paths that reach the same state behave the same from then
 * on, so the walk visits each state once and still covers every order of any length.
 */
describe('DOS-164: overlay stack invariants', () => {
  type Step =
    | { readonly kind: 'open' | 'close' | 'unmount'; readonly id: string }
    | { readonly kind: 'flush' }

  const OVERLAYS = ['sheetA', 'sheetB', 'dialogA', 'dialogB'] as const
  const MAX_UNFLUSHED = 2

  interface World {
    readonly stack: OverlayStack<string>
    readonly mounted: Set<string>
    readonly open: Set<string>
    unflushed: Step[]
    readonly failures: string[]
  }

  function describePath(path: readonly Step[]): string {
    return path.map((s) => (s.kind === 'flush' ? 'flush' : `${s.kind} ${s.id}`)).join(' → ')
  }

  function checkInvariants(world: World, path: readonly Step[]): void {
    const { stack } = world
    const roots = stack.presentedRoots()
    if (roots.length > 1) {
      world.failures.push(
        `(i) ${roots.length} native modals [${roots.join(', ')}] after ${describePath(path)}`,
      )
    }
    for (const id of OVERLAYS) {
      const role = stack.roleOf(id)
      if (world.open.has(id)) {
        const host = stack.hostOf(id)
        const seen =
          role === 'root' || (role === 'layer' && host !== null && stack.isPresented(host))
        if (!seen) world.failures.push(`(ii) ${id} is open but unseen after ${describePath(path)}`)
      } else if (role === 'layer' || (role === 'root' && !stack.hasLayers(id))) {
        world.failures.push(`${id} is closed but still ${role} after ${describePath(path)}`)
      }
    }
  }

  function apply(world: World, step: Step, path: readonly Step[]): void {
    if (step.kind === 'flush') {
      world.stack.flush()
      world.unflushed = []
      checkInvariants(world, path)
      return
    }
    world.unflushed.push(step)
    if (step.kind === 'unmount') {
      world.stack.remove(step.id)
      world.mounted.delete(step.id)
      world.open.delete(step.id)
      return
    }
    world.stack.request(step.id, step.kind === 'open', () => undefined)
    if (step.kind === 'open') world.open.add(step.id)
    else world.open.delete(step.id)
  }

  function replay(path: readonly Step[]): World {
    const world: World = {
      stack: createOverlayStack<string>(),
      mounted: new Set(OVERLAYS),
      open: new Set(),
      unflushed: [],
      failures: [],
    }
    path.forEach((step, i) => {
      apply(world, step, path.slice(0, i + 1))
    })
    return world
  }

  function nextSteps(world: World): Step[] {
    const steps: Step[] = []
    if (world.unflushed.length > 0) steps.push({ kind: 'flush' })
    if (world.unflushed.length >= MAX_UNFLUSHED) return steps
    for (const id of OVERLAYS) {
      if (!world.mounted.has(id)) continue
      steps.push({ kind: world.open.has(id) ? 'close' : 'open', id })
      steps.push({ kind: 'unmount', id })
    }
    return steps
  }

  function keyOf(world: World): string {
    const { stack } = world
    return JSON.stringify([
      OVERLAYS.map((id) => [
        world.mounted.has(id),
        world.open.has(id),
        stack.roleOf(id),
        stack.hostOf(id),
        stack.layersOf(id).map((layer) => layer.id),
      ]),
      world.unflushed,
    ])
  }

  it('DOS-164: at most one overlay owns a native modal and no open overlay is left unseen after every flush, for every open/close/unmount order of two Sheets and two Dialogs', () => {
    const seen = new Set<string>([keyOf(replay([]))])
    const queue: Step[][] = [[]]
    const failures: string[] = []
    let flushes = 0
    while (queue.length > 0 && failures.length < 5) {
      const path = queue.shift() ?? []
      for (const step of nextSteps(replay(path))) {
        const next = [...path, step]
        const world = replay(next)
        if (step.kind === 'flush') flushes += 1
        failures.push(...world.failures)
        const key = keyOf(world)
        if (seen.has(key)) continue
        seen.add(key)
        queue.push(next)
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
    // A generator that silently explored nothing would pass the line above.
    expect(seen.size).toBeGreaterThan(1000)
    expect(flushes).toBeGreaterThan(1000)
  })
})
