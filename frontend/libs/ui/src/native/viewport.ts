/**
 * `useViewport()` for the native renderer — the same contract as the web one.
 *
 * `useWindowDimensions` already re-renders on rotation and on a split-screen resize, so a tablet that
 * turns from portrait to landscape crosses the 1024 dp line and gets the rail, from the same screen
 * files (docs/08 section 0).
 */
import { useMemo } from 'react'
import { useWindowDimensions } from 'react-native'

import { layout } from '../tokens.js'
import type { Viewport } from '../types.js'

export function useViewport(): Viewport {
  const { width, height } = useWindowDimensions()
  return useMemo(
    () => ({
      width,
      height,
      kind: width >= layout.deskBreakpoint ? 'desk' : 'phone',
      railCollapsed: width >= layout.deskBreakpoint && width < layout.railCollapseBreakpoint,
    }),
    [width, height],
  )
}
