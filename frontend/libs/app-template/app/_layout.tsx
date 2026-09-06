/**
 * The root layout: the five things every Distribution OS app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the touch floor and the density this app's shell fixes (UX-00 §5.2),
 *    the distributor's own name and logo (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. Hide every rail item the signed-in role could not call, from the SAME `PERMISSIONS` matrix the
 *    server enforces (docs/08 §0). There is no second permission list in this repo.
 *
 * This file is IDENTICAL in all seven apps. What differs is `src/config.ts` and `src/nav.ts`.
 */
import { ApiProvider, useSession } from '@dos/api-client/react'
import { AppShell, Screen, Skeleton, ThemeProvider, setRouterNavigate } from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { ApiClient } from '@dos/api-client'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { boot } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import { SECTIONS } from '../src/nav'
import { strings } from '../src/strings'

export default function RootLayout(): React.JSX.Element | null {
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
      <Shell />
    </ApiProvider>
  )
}

/**
 * Inside the provider, because the theme carries the DISTRIBUTOR's name and logo and there is no
 * distributor until someone has signed in (UX-00 §11: the product's own mark appears nowhere).
 */
function Shell(): React.JSX.Element {
  const { session, hydrating, signOut, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const onSignIn = pathname === '/sign-in'

  // UX-00 §11: the distributor's own name and logo are the chrome, everywhere except the console.
  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(session.tenant.logoUrl) }
        : null,
    [session],
  )

  /**
   * Can this role reach this destination?
   *
   * `NavItem.permission` names a contract procedure (`'orders.list'`), and the answer comes from
   * `PERMISSIONS` in `@dos/contracts` — the linked package the SERVICE reads, so the rail and the
   * gate can never disagree. An item with no `permission` is always shown; the server still answers
   * 403 if a hidden route is reached by hand, and the app carries no second list.
   */
  const role = session?.role as PermissionRole | undefined
  const can = useCallback(
    (item: NavItem): boolean =>
      item.permission === undefined || isAllowed(permissionFor(item.permission), role ?? null),
    [role],
  )

  const choices = useMemo<readonly TenantChoice[]>(
    () =>
      (session?.memberships ?? []).map((membership) => ({
        id: membership.tenantId,
        name: membership.displayName,
        roleLabel: membership.role,
      })),
    [session],
  )

  /**
   * Where the session says this person should be, or null when they are already there.
   *
   * The redirect is imperative, and the layout ALWAYS renders its `<Slot />` once hydration is over.
   * Returning `<Redirect>` INSTEAD of the slot unmounts the navigator the redirect needs, so on a
   * cold start `usePathname()` never changed, the redirect fired again on the next render, and the
   * app hung on the skeleton with "Maximum update depth exceeded" — which is what a signed-in person
   * opening `/sign-in` from a bookmark got.
   */
  const redirectTo = hydrating
    ? null
    : session === null
      ? onSignIn
        ? null
        : '/sign-in'
      : onSignIn
        ? '/'
        : null

  useEffect(() => {
    if (redirectTo !== null) router.replace(redirectTo)
  }, [redirectTo, router])

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  // Signed out, or standing on the sign-in screen itself: the route, with no chrome around it.
  if (session === null || onSignIn) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
        <Slot />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <AppShell
        sections={SECTIONS}
        can={can}
        activeHref={pathname}
        onNavigate={(href) => {
          router.push(href)
        }}
        tenant={{
          current: {
            id: session.tenant.id,
            name: session.tenant.displayName,
            roleLabel: session.role,
          },
          choices,
          onSwitch: (tenantId) => {
            void switchDistributor(tenantId)
          },
        }}
        account={{
          name: session.user.name,
          roleLabel: session.role,
          onSignOut: () => {
            void signOut()
          },
        }}
      >
        <Slot />
      </AppShell>
    </ThemeProvider>
  )
}
