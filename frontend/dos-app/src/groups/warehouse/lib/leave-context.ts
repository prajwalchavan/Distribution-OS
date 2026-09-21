/**
 * DOS-167 addendum (z1) — the shell's leave flow, for a "Sign out" button outside the shell's own account menu.
 *
 * "Sign out" on the Settings screen used to call `useSession().signOut()` itself: no sheet, no `end()`, the read set left
 * on the phone, the other distributorships never swept, and the session cleared only once the server's revoke had
 * answered — on a browser that keeps nothing, the queued picks went with it. `Chrome` in `app/_layout.tsx` hands down
 * its own `leave`, the one the account menu calls, so every sign-out button takes the same flow (`leave.test.ts` reads
 * every screen to keep it so).
 */
import { createContext, useContext } from 'react'

import type { Leaving } from './leave'

/** `Chrome`'s leave flow; null outside the shell. */
export const LeaveContext = createContext<((to: Leaving) => void) | null>(null)

/**
 * The shell's leave flow — `leave({ mode: 'signOut' })` behind a "Sign out" button. Null for the frame a screen renders
 * outside the shell (signed out, before the gate redirects), where there is nobody left to sign out.
 */
export function useLeave(): ((to: Leaving) => void) | null {
  return useContext(LeaveContext)
}
