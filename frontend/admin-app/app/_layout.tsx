/**
 * The root layout of the platform console.
 *
 * It does the same five things every Distribution OS app does — build the client, put the theme in
 * place, hand expo-router's navigation to the kit, gate on the session, hide what the role may not
 * call — with two differences that come from what this app IS:
 *
 * 1. **The session has no distributor.** `usePlatformSession()` over `createPlatformClient()`:
 *    `platform_admin` holds no membership, so there is no tenant, no memberships, and no switcher.
 *    A control offering to switch to a distributorship would be a lie about what this account reaches.
 * 2. **The chrome is OURS.** Every other app puts the distributor's own name and logo in the rail
 *    (docs/22 §9 item 10). This one is read by Distribution OS staff about a distributor, so the
 *    product's own name stands there instead — the single exception, stated in the `admin` contract's
 *    own header.
 */
import { ApiProvider, usePlatformSession } from '@dos/api-client/react'
import { AppShell, Screen, Skeleton, ThemeProvider, setRouterNavigate } from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { NavItem } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import type { PlatformApiClient } from '@dos/api-client'
import { StatusBar } from 'expo-status-bar'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { boot } from '../src/api'
import { APP } from '../src/config'
import { SECTIONS } from '../src/nav'
import { strings } from '../src/strings'

export default function RootLayout(): React.JSX.Element | null {
  const [client, setClient] = useState<PlatformApiClient | null>(null)
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
      {/* Dark status-bar content, because the app is light. Android's default is light-on-light. */}
      <StatusBar style="dark" />
      <Shell />
    </ApiProvider>
  )
}

/** The product's own mark, in the one app where it belongs on screen. */
const BRAND = { name: APP.brand, logoUrl: null } as const

function Shell(): React.JSX.Element {
  const { session, hydrating, signOut } = usePlatformSession()
  const pathname = usePathname()
  const router = useRouter()
  const onSignIn = pathname === '/sign-in'
  const onChangePassword = pathname === '/change-password'
  /**
   * docs/23 §0 X2. A console account can be created with a temporary password too (`admin.users`
   * and the seed both do it), and the service reports the flag rather than refusing the API — so
   * until it is cleared, every route lands on the change-password screen and nothing else renders.
   */
  const mustChangePassword = session?.user.mustChangePassword === true

  const role = session?.role as PermissionRole | undefined
  const can = useCallback(
    (item: NavItem): boolean =>
      item.permission === undefined || isAllowed(permissionFor(item.permission), role ?? null),
    [role],
  )

  const redirectTo = hydrating
    ? null
    : session === null
      ? onSignIn
        ? null
        : '/sign-in'
      : mustChangePassword
        ? onChangePassword
          ? null
          : '/change-password'
        : onSignIn
          ? '/'
          : null

  /*
   * Wait for the root navigator to exist, and move OUT of the commit. Both were measured on the
   * Pixel 7 in earlier gates: `router.replace` before the navigator mounts, or inside the commit
   * that mounts it, answers "Can't perform a React state update on a component that hasn't mounted
   * yet" naming expo-router's own `<ContextNavigator/>`. A zero timer is what the message asks for.
   */
  const navigationState = useRootNavigationState()
  const navigatorReady = navigationState?.key !== undefined

  useEffect(() => {
    if (!navigatorReady || redirectTo === null || redirectTo === pathname) return
    const move = setTimeout(() => {
      router.replace(redirectTo)
    }, 0)
    return () => {
      clearTimeout(move)
    }
  }, [navigatorReady, redirectTo, router, pathname])

  const account = useMemo(
    () =>
      session === null
        ? undefined
        : {
            name: session.user.name,
            // The console LEVEL (DOS-106) when the session carries one, so the rail and the phone
            // account label read "Support" or "Super" like the Account screen, not one word for both.
            roleLabel:
              session.level === null
                ? strings['word.platform_admin']
                : strings[`word.${session.level}`],
            onSignOut: () => {
              void signOut()
            },
            /*
             * NO `items`. The phone shell folds the account menu INTO the same ⋯ sheet as the rail's
             * own destinations, and Account is already one of them (`src/nav.ts`, DIRECTORY) — so an
             * entry here drew "Account" twice in the sheet, measured on the Pixel 7. On the desk
             * header the menu keeps Sign out, which is the one thing the rail does not carry.
             */
          },
    [session, signOut, router],
  )

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={BRAND} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  // Signed out, on the sign-in screen, or holding a password somebody else chose: the route, with no
  // chrome around it. A rail into a console this person may not use yet would be a lie.
  if (session === null || onSignIn || mustChangePassword) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={BRAND} strings={strings}>
        <Slot />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={BRAND} strings={strings}>
      <AppShell
        sections={SECTIONS}
        can={can}
        activeHref={pathname}
        onNavigate={(href) => {
          router.push(href)
        }}
        /*
         * The rail head. In the six distributor apps this is the `<TenantSwitcher>` and it carries
         * the distributor's own mark; here there is nothing to switch to, and the switcher with a
         * single choice renders exactly what this console wants — the name, and the subtitle saying
         * what it is. `choices` is empty on purpose: it is not a menu.
         */
        tenant={{
          current: { id: 'platform', name: APP.brand, roleLabel: strings['app.home'] },
          choices: [],
          onSwitch: () => {
            /* A console session has no distributorship to switch to. */
          },
        }}
        account={account}
      >
        <Slot />
      </AppShell>
    </ThemeProvider>
  )
}
