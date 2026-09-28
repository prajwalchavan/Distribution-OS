/**
 * The comfortable-form scale of `<Screen centered>` (founder, 2026-09-28: the sign-in page "more user
 * friendly, placed in the middle, not boxy").
 *
 * A centred screen provides it; `<Button>` and `<TextInput>` on BOTH renderers read it. It can only
 * ever RAISE a control — `Math.max` with the app's own floor — so a warehouse phone keeps its 76 dp and
 * a desk's 32 px button becomes 52 px on the four screens that stand before the app, and nowhere else.
 *
 * Not exported from either barrel: a screen asks for it by writing `<Screen centered>`, never by
 * reaching for the context.
 */
import { createContext, useContext } from 'react'

import { layout, radius } from './tokens.js'

export interface ControlScale {
  /** The least a field or button is tall, in dp / px. */
  readonly minHeight: number
  /** The corner of a field and a button. */
  readonly radius: number
}

/** What `<Screen centered>` provides. */
export const COMFORTABLE: ControlScale = {
  minHeight: layout.formControlHeight,
  radius: radius.lg,
}

export const ControlScaleContext = createContext<ControlScale | null>(null)

export function useControlScale(): ControlScale | null {
  return useContext(ControlScaleContext)
}

/** A control's height under the scale: never below its floor, never below the scale's minimum. */
export function scaledHeight(floor: number, scale: ControlScale | null): number {
  return scale === null ? floor : Math.max(floor, scale.minHeight)
}
