/**
 * `useViewport()` for the web renderer.
 *
 * Its own module because BOTH the shell and a handful of components need it, and because the
 * universal-app decision (docs/08 section 0) makes the viewport a first-class signal: the same build
 * is a desk browser and a phone, so "which shell" and "how many columns" can no longer be read off
 * the app's `density` alone. An owner on a phone is a phone.
 */
import { useMemo, useSyncExternalStore } from 'react'

import { layout } from '../tokens.js'
import type { Viewport } from '../types.js'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

/** A string, so `useSyncExternalStore` compares by value and never loops on a fresh object. */
function read(): string {
  if (typeof window === 'undefined') return SERVER_VIEWPORT
  return `${String(window.innerWidth)}x${String(window.innerHeight)}`
}

/** Server rendering and the static export have no window; desk is the honest default. */
const SERVER_VIEWPORT = '1280x800'

export function useViewport(): Viewport {
  const raw = useSyncExternalStore(subscribe, read, () => SERVER_VIEWPORT)
  return useMemo(() => {
    const [w = '0', h = '0'] = raw.split('x')
    const width = Number(w)
    return {
      width,
      height: Number(h),
      kind: width >= layout.deskBreakpoint ? 'desk' : 'phone',
      railCollapsed: width >= layout.deskBreakpoint && width < layout.railCollapseBreakpoint,
    }
  }, [raw])
}
