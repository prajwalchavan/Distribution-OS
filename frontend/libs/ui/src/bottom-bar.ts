/**
 * How a bottom bar's CONTENT tells `<Screen>` there is nothing to show.
 *
 * `<CartBar>` is passed as `<Screen bottomBar>`, and an empty cart must draw no bar at all (founder,
 * 2026-09-28: the shop "hidden when the cart is empty"). A React element cannot tell its parent that
 * it rendered nothing, and the screen's bar strip has its own padding and hairline, so an empty cart
 * used to leave a white band at the bottom. The screen provides a setter; the bar's content calls it
 * before paint. The strip stays MOUNTED and is only hidden, so the content that asked is never
 * unmounted by its own answer (which would ask again, for ever).
 *
 * Not exported from either barrel: it is the kit talking to itself.
 */
import { createContext, useContext, useLayoutEffect } from 'react'

export const BottomBarContext = createContext<((hidden: boolean) => void) | null>(null)

/** Hide the enclosing screen's bottom bar while `hidden`, and give it back on unmount. */
export function useHideBottomBar(hidden: boolean): void {
  const hide = useContext(BottomBarContext)
  useLayoutEffect(() => {
    hide?.(hidden)
  }, [hide, hidden])
  useLayoutEffect(
    () => () => {
      hide?.(false)
    },
    [hide],
  )
}
