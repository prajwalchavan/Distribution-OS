/**
 * PLACEHOLDER root layout — `frontend/dos-app`, the ONE app (docs/31).
 *
 * This file exists so the project installs, typechecks, lints and exports before a single screen has
 * moved into it. It is NOT the root layout docs/31 §1.3 describes, and it is not meant to survive:
 * the root lane replaces it wholesale once the six move lanes have filled `app/owner/`,
 * `app/manager/`, `app/sales/`, `app/warehouse/`, `app/delivery/` and `app/retailer/`.
 *
 * What the real one will do, in order (docs/31 §1.3, re-derived from HEAD on 2026-09-21):
 *
 *   1. `boot()` the client and hold the tree while it is null.
 *   2. `setRouterNavigate`, so `<Link>`, `<AppShell>` and `useGo()` can move.
 *   3. `<ApiProvider>` + `<StatusBar style="dark" />` — one client for the life of the app.
 *   4. The session gate: hydrating → skeleton; no session → `/sign-in`; a password somebody else
 *      chose → `/change-password`. Each renders a bare `<Slot/>`, no chrome.
 *   5. The elected role (`session.role`) through `GROUP_OF` (`@dos/api-client`) → this person's
 *      group; a pathname outside it redirects to `/<group>`; an unmapped role signs out rather than
 *      redirecting to `/undefined` (ruling Q2).
 *   6. The landing panel and the welcome re-arm (docs/29 §1).
 *
 * The move lanes touch `app/<group>/**` and `src/groups/<group>/**` and NOTHING here.
 */
import { ThemeProvider } from '@dos/ui'
import { Slot } from 'expo-router'

export default function RootLayout(): React.JSX.Element {
  return (
    <ThemeProvider touch="phone" density="desk">
      <Slot />
    </ThemeProvider>
  )
}
