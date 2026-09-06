/**
 * The root layout: the four things every Distribution OS app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the touch floor and the density this app's shell fixes (UX-00 §5.2),
 *    the distributor's own name and logo (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 *
 * This file is IDENTICAL in all seven apps. What differs is `src/config.ts` and `src/nav.ts`.
 */
import { ApiProvider, useSession } from '@dos/api-client/react'
import { AppShell, Screen, Skeleton, ThemeProvider, setRouterNavigate } from '@dos/ui'
import type { ApiClient } from '@dos/api-client'
import type { TenantChoice } from '@dos/ui'
import { Redirect, Slot, usePathname, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'

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

  const choices = useMemo<readonly TenantChoice[]>(
    () =>
      (session?.memberships ?? []).map((membership) => ({
        id: membership.tenantId,
        name: membership.displayName,
        roleLabel: membership.role,
      })),
    [session],
  )

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  if (!session) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        {onSignIn ? <Slot /> : <Redirect href="/sign-in" />}
      </ThemeProvider>
    )
  }

  if (onSignIn) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
        <Redirect href="/" />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <AppShell
        sections={SECTIONS}
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
