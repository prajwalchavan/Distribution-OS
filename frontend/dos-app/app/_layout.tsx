/**
 * The ROOT layout of the one app — docs/31 §1.3, re-derived from HEAD.
 *
 * Everything an INSTALL has exactly one of lives here, and nothing else does:
 *
 * 1. `boot()` the client and hold the tree while it is null.
 * 2. `setRouterNavigate`, so `<Link>`, `<AppShell>` and `useGo()` can move.
 * 3. ONE `<ApiProvider>` and ONE `<StatusBar style="dark" />`, for the life of the app. One client
 *    means one in-memory access token and one single-flight refresh across all six groups; the
 *    service a call leaves for is decided per request from the elected role (`src/api.ts`).
 * 4. The session gate: hydrating → skeleton; no session → `/sign-in`; a password somebody else chose
 *    → `/change-password`. Each renders a bare `<Slot/>`, with no chrome around it.
 * 5. The redirect ladder (docs/31 §1.3 step 7): the elected role in the token, through `GROUP_OF`,
 *    is this person's group, and a pathname outside it moves them to `/<group>`. An unmapped role
 *    signs out rather than redirecting to `/undefined` (ruling Q2).
 * 6. The landing panel and the welcome re-arm (docs/29 §1).
 *
 * What is NOT here, by design: the shell, the rail, the tenant switcher, the account menu, the badge
 * queries, the connection strip, the offline engine and the theme's touch floor, density and strings.
 * All of those are the GROUP's (docs/31 §1.4), because all of those differ between a godown phone
 * and an owner's laptop, and `app/<g>/_layout.tsx` is where a group says what it is.
 *
 * THE CHOOSER. After the password, somebody whose membership permits more than one role is asked
 * which they are doing now (ruling B3). That is rendered by `app/sign-in.tsx`, inside the router, and
 * the one thing it needs of this file is that the ladder hold still while it is open — a signed-in
 * person on `/sign-in` would otherwise be swept into a group before they had chosen one.
 */
import { ApiProvider, useSession } from '@dos/api-client/react'
import { groupOf, type GroupName } from '@dos/api-client'
import {
  Landing,
  Screen,
  Skeleton,
  ThemeProvider,
  clearWelcomeSeen,
  routeFor,
  setRouterNavigate,
  useLandingGate,
} from '@dos/ui'
import type { ApiClient } from '@dos/api-client'
import { StatusBar } from 'expo-status-bar'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { boot } from '../src/api'
import { APP, GROUPS, absoluteUrl } from '../src/config'
import { isChoosing, subscribeChoosing } from '../src/election'
import { strings } from '../src/strings'

export default function RootLayout(): React.JSX.Element {
  const [client, setClient] = useState<ApiClient | null>(null)
  const router = useRouter()

  useEffect(() => {
    let live = true
    void boot().then((next) => {
      if (live) setClient(next)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    setRouterNavigate((href, replace) => {
      if (replace) router.replace(href)
      else router.push(href)
    })
    return () => {
      setRouterNavigate(null)
    }
  }, [router])

  if (!client) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  return (
    <ApiProvider client={client}>
      {/*
       * DARK STATUS-BAR CONTENT, BECAUSE THE APP IS LIGHT.
       *
       * `userInterfaceStyle: "light"` in app.json tells the app which palette to draw; it does not
       * tell ANDROID which colour to draw the clock, signal and battery in, and the default there is
       * light-on-light. Measured on the Pixel 7 emulator: the whole status bar was white over the
       * app's own #F2F2EF ground. Owner and manager never had this line; in one app they do.
       */}
      <StatusBar style="dark" />
      <Shell />
    </ApiProvider>
  )
}

/** Is the Continue-as chooser open? Subscribed rather than read once: it opens mid-render elsewhere. */
function useChoosing(): boolean {
  return useSyncExternalStore(subscribeChoosing, isChoosing, isChoosing)
}

/** Is this pathname inside this group's tree? `/salesman` is not inside `/sales`. */
function inGroup(pathname: string, group: GroupName): boolean {
  const base = `/${group}`
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Inside the provider, because `useSession()` needs it — and because the theme carries the
 * DISTRIBUTOR's name and logo and there is no distributor until somebody has signed in (UX-00 §11:
 * the product's own mark appears nowhere else).
 */
function Shell(): React.JSX.Element {
  const { session, hydrating, signOut } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const choosing = useChoosing()
  const onSignIn = pathname === '/sign-in'
  const onChangePassword = pathname === '/change-password'
  /**
   * docs/23 §0 X2. A staff account is created with a TEMPORARY password — `tenancy.staff.create` and
   * the platform console both set `must_change_password`, and a manager reads it out loud — so the
   * service reports the flag and leaves the decision to the app. Until it is cleared, every route
   * lands on the change-password screen; nothing else in the app renders.
   */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * THE ELECTED ROLE'S GROUP (docs/31 §1.3 step 6). The token's `role` claim IS the elected role —
   * the server minted it that way, re-validates it on every refresh and re-mints it (ruling B1), so
   * there is no second election held on the device.
   */
  const group = session === null ? null : groupOf(session.role)

  /*
   * RULING Q2 — an unmapped role signs out rather than redirecting to `/undefined`.
   *
   * `GROUP_OF` is total over `MembershipRole`, so this cannot happen from a token this build minted.
   * It can happen from a SNAPSHOT a build before a role was added restored out of storage, and the
   * honest answer to "I do not know where this person belongs" is the sign-in form, never a blank
   * screen with a rail on it.
   */
  useEffect(() => {
    if (session !== null && group === null) void signOut()
  }, [session, group, signOut])

  // UX-00 §11: the distributor's own name and logo are the chrome, everywhere except the console.
  const tenantBrand = useMemo(
    () =>
      session && group
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(group, session.tenant.logoUrl) }
        : null,
    [session, group],
  )

  /**
   * Where the session says this person should be, or null when they are already there.
   *
   * The redirect is imperative, and the layout ALWAYS renders its `<Slot />` once hydration is over.
   * Returning `<Redirect>` INSTEAD of the slot unmounts the navigator the redirect needs, so on a
   * cold start `usePathname()` never changed, the redirect fired again on the next render, and the
   * app hung on the skeleton with "Maximum update depth exceeded" — which is what a signed-in person
   * opening `/sign-in` from a bookmark got.
   *
   * The two arms this merge adds are the last two: on `/sign-in` with a session the destination is
   * `/<group>` rather than `/`, and a signed-in pathname OUTSIDE the elected group is moved into it.
   * That second arm is the whole of route safety on the web, where every URL is typeable and every
   * group's tree is registered (ruling Q2). `choosing` holds the ladder while the chooser is open.
   * `/change-password` is the one root route a signed-in person may stand on WITHOUT the flag: the
   * account menu's voluntary change (docs/23 §0 X2, "the same screen serves a voluntary change from
   * Settings"). Before this exception the ladder read it as "outside the group" and sent the owner
   * straight back to the home — a Change password item that opened `/owner` (founder, 2026-09-26).
   */
  const redirectTo =
    hydrating || choosing
      ? null
      : session === null
        ? onSignIn
          ? null
          : '/sign-in'
        : mustChangePassword
          ? onChangePassword
            ? null
            : '/change-password'
          : group === null
            ? null
            : onSignIn || (!inGroup(pathname, group) && !onChangePassword)
              ? routeFor(group, '/')
              : null

  /*
   * Wait for the root navigator to exist before moving. On the web the layout effect and the
   * navigator mount in the same tick, so `router.replace` from an effect is safe; on a phone it is
   * not, and React Native answers with "Can't perform a React state update on a component that
   * hasn't mounted yet" naming expo-router's own `<ContextNavigator/>` — measured on the Pixel 7
   * emulator, on the first launch and on every sign-in. `useRootNavigationState()` has a `key` only
   * once that navigator is mounted, which is exactly the condition.
   */
  const navigationState = useRootNavigationState()
  const navigatorReady = navigationState?.key !== undefined

  /*
   * AND MOVE OUT OF THE COMMIT. `navigatorReady` says the navigator EXISTS; it does not say React has
   * finished committing the tree it belongs to, and on a phone `router.replace` inside that commit
   * still answers "Can't perform a React state update on a component that hasn't mounted yet",
   * naming expo-router's own `<ContextNavigator/>` — measured on the Pixel 7 in the delivery gate,
   * on the launch where the session restores a frame after `hydrating` clears and the redirect fires
   * twice. A zero timer is exactly what the message asks for: do the work after the mount.
   *
   * ONE effect for the whole install now, where there used to be eight — one per app (DOS-055).
   */
  useEffect(() => {
    if (!navigatorReady || redirectTo === null || redirectTo === pathname) return
    const move = setTimeout(() => {
      router.replace(redirectTo)
    }, 0)
    return () => {
      clearTimeout(move)
    }
  }, [navigatorReady, redirectTo, router, pathname])

  /**
   * docs/29 §1 — the two seconds after a fresh sign-in, and the welcome the next person gets.
   *
   * `useLandingGate` answers one question: has a session just ARRIVED (a sign-in, or a switch to
   * another distributorship), as against "is there a session". A launch that restored one is never
   * held up: a driver at 6 am is taken to the trip, not told where he is. The panel COVERS the app
   * rather than replacing it, so the navigator underneath stays mounted and the redirect this
   * sign-in started is not stranded behind it.
   *
   * The welcome flag is DEVICE-SCOPED and cleared here on the render a session went away (ruling Q7
   * and `sessionEnded`), rather than on each sign-out button: with one install, signing out of sales
   * and in as delivery is the same device, and the welcome is a wordmark, not a gate.
   *
   * `appTitle` is the GROUP's own title, not `APP.title`. `<Landing>` prints `appShortName(appTitle)`
   * — the part after the last dash — so one product name for all six would have read "Distribution
   * OS app" to everybody, where docs/29 §1 promised the panel says WHICH APP THIS IS.
   */
  const landing = useLandingGate(
    hydrating,
    session === null ? null : `${session.tenant.id}:${session.user.id}`,
  )
  useEffect(() => {
    if (landing.signedOut) clearWelcomeSeen()
  }, [landing.signedOut])
  const landingPanel =
    landing.show && session !== null && group !== null ? (
      <Landing
        tenantName={session.tenant.displayName}
        logoUrl={absoluteUrl(group, session.tenant.logoUrl)}
        personName={session.user.name}
        appTitle={GROUPS[group].title}
        onDone={landing.done}
      />
    ) : null

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  // Signed out, on the sign-in screen (chooser included), or holding a password somebody else chose:
  // the route, with no chrome around it. A rail into a group this person has not elected is a lie.
  if (session === null || onSignIn || mustChangePassword || group === null) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
        <Slot />
        {landingPanel}
      </ThemeProvider>
    )
  }

  /*
   * THE GROUP RENDERS THE CHROME (docs/31 §1.4). What is left here is the theme the LANDING PANEL
   * needs — it is painted beside `<Slot/>`, outside the group layout's own provider, and on the web
   * every kit style is scoped to `.dos-root`, which is a provider's own element. The group's provider
   * nests inside this one and wins for every screen: `buildTheme` replaces, it never merges, so this
   * one's `strings` never reach a group's screens and the swap of docs/31 §3 is intact.
   *
   * It is rendered on EVERY signed-in frame rather than only while the panel is up: mounting a
   * provider around `<Slot/>` two seconds after a sign-in would remount the whole group tree —
   * stopping the sync engine and throwing away a driver's unsent work to show an introduction.
   */
  const g = GROUPS[group]
  return (
    <ThemeProvider touch={g.touch} density={g.density} tenant={tenantBrand} strings={strings}>
      <Slot />
      {landingPanel}
    </ThemeProvider>
  )
}
