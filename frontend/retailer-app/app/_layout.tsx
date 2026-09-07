/**
 * The root layout: the six things this app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the `field` (69 dp) floor and field density of UX-00 §5.2, the
 *    DISTRIBUTOR's own name and logo (UX-00 §11, docs/23 §6.5: the shop sees its distributor, never
 *    us), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. Refuse a role retailer-service does not serve, as a SCREEN rather than as a redirect.
 * 6. Say honestly whether the distributor is reachable. This app is ONLINE ONLY (docs/23 §6.4):
 *    nothing is kept on the device, so the strip never claims a figure it cannot refresh.
 *
 * There is NO offline engine here and no sync provider — deliberately. `sync.pull` is in this role's
 * matrix, but docs/02 and docs/23 §6.4 decided the shop's app is online-first with a query cache and
 * no device database, and a half-built local store would be the worst of both.
 */
import { ApiProvider, useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  AppShell,
  Button,
  ConnectionStrip,
  EmptyState,
  Screen,
  Skeleton,
  Stack,
  ThemeProvider,
  setRouterNavigate,
  useStrings,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { ApiClient } from '@dos/api-client'
import type { AccountMenu, NavItem, TenantChoice, TenantSwitcherProps } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { StatusBar } from 'expo-status-bar'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
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
      {/* Dark status-bar content, because the app is light: `userInterfaceStyle` tells the app which
          palette to draw and tells Android nothing, and the default there is light on light. */}
      <StatusBar style="dark" />
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
  const onChangePassword = pathname === '/change-password'

  /** docs/23 §0 X2: a password somebody else chose is changed before anything else renders. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * A role retailer-service does not serve.
   *
   * `auth-service` signs anyone in — it does not know which app asked — so without this a manager
   * typing their own username here would get a shop's chrome drawn around a screen whose every call
   * answers 403. The service's own sentence is the whole screen, and the only button signs them out.
   */
  const wrongRole = session !== null && session.role !== 'retailer'

  // UX-00 §11 and docs/23 §6.5: the distributor's own name and logo are the chrome, never ours.
  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(session.tenant.logoUrl) }
        : null,
    [session],
  )

  /**
   * Can this shop reach this destination? `NavItem.permission` names a contract procedure and the
   * answer comes from `PERMISSIONS` in `@dos/contracts` — the linked package the SERVICE reads, so
   * the rail and the gate can never disagree. The server still answers 403 for a route reached by
   * hand; the app carries no second list.
   */
  const role = session?.role as PermissionRole | undefined
  const can = useCallback(
    (item: NavItem): boolean =>
      item.permission === undefined || isAllowed(permissionFor(item.permission), role ?? null),
    [role],
  )

  /**
   * The distributor switcher — the one control this app is built around (docs/23 §6.1 R2).
   *
   * `MembershipSummary` carries `displayName` and `logoUrl` per distributor, so a shop that buys from
   * three sees three names it recognises rather than three legal entities.
   */
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
   * Where the session says this person should be, or null when they are already there. The redirect
   * is imperative and the layout ALWAYS renders its `<Slot />`: returning a `<Redirect>` instead
   * unmounts the navigator the redirect itself needs.
   */
  const redirectTo = hydrating
    ? null
    : session === null
      ? onSignIn
        ? null
        : '/sign-in'
      : wrongRole
        ? null
        : mustChangePassword
          ? onChangePassword
            ? null
            : '/change-password'
          : onSignIn
            ? '/'
            : null

  /*
   * Wait for the root navigator, then move OUT of the commit. `useRootNavigationState()` has a `key`
   * only once the navigator is mounted; a zero timer puts the replace after the mount, which is what
   * React Native's "Can't perform a React state update on a component that hasn't mounted yet" asks
   * for on a phone.
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

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  if (wrongRole) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
        <WrongRole
          role={session.role}
          onSignOut={() => {
            void signOut()
          }}
        />
      </ThemeProvider>
    )
  }

  // Signed out, on the sign-in screen, or holding a password somebody else chose: the route, with no
  // chrome around it. A rail into an app this person may not use yet would be a lie.
  if (session === null || onSignIn || mustChangePassword) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
        <Slot />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <Chrome
        can={can}
        pathname={pathname}
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
          /*
           * ONLY WHAT THE NAVIGATION DOES NOT ALREADY CARRY. This app has no tab bar, so `AppShell`
           * merges the nav sections AND these items into one ⋯ sheet — and "My account" is already a
           * destination in `SECTIONS`. Listing it here too is how the delivery app came to show two
           * screens twice on its only way of getting around.
           */
          items: [
            {
              id: 'change-password',
              label: strings['app.changePassword'],
              onPress: () => {
                router.push('/change-password')
              },
            },
          ],
        }}
      >
        <Slot />
      </Chrome>
    </ThemeProvider>
  )
}

/** The service's own refusal, as a screen: no shell, no rail, one way out. */
function WrongRole({
  role,
  onSignOut,
}: {
  role: string
  onSignOut: () => void
}): React.JSX.Element {
  const t = useStrings()
  return (
    <Screen title={t('app.wrongRoleTitle')}>
      <Stack gap={4}>
        <EmptyState testID="wrong-role" message={t('app.wrongRoleBody', { role })} />
        <Button label={t('app.signOut')} variant="primary" onPress={onSignOut} />
      </Stack>
    </Screen>
  )
}

interface ChromeProps {
  can: (item: NavItem) => boolean
  pathname: string
  tenant: TenantSwitcherProps
  account: AccountMenu
  children: React.ReactNode
}

/**
 * The shell with its two live pieces: the unread badge on Messages and the connection line.
 *
 * Both come from ONE cheap read this app makes anyway. `notifications.messages.list` answers
 * `unreadCount` on every page, so the badge costs nothing extra, and whether that read succeeded is
 * exactly the honest answer to "is your distributor reachable" — the strip says "Offline since …"
 * rather than leaving a stale figure looking current (docs/23 §6.4: online only, but honest).
 */
function Chrome({ can, pathname, tenant, account, children }: ChromeProps): React.JSX.Element {
  const api = useApi()
  const router = useRouter()

  const inbox = useQuery(
    ['notifications', 'unread'],
    () => api.api.notifications.messages.list({ limit: 1 }),
    { staleTime: 60_000 },
  )
  const unread = inbox.data?.unreadCount ?? 0

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === '/inbox' && unread > 0 ? { ...item, badge: unread } : item,
        ),
      })),
    [unread],
  )

  return (
    <AppShell
      sections={sections}
      can={can}
      activeHref={pathname}
      onNavigate={(href) => {
        router.push(href)
      }}
      tenant={tenant}
      account={account}
      connection={
        <ConnectionStrip
          testID="connection"
          state={{
            online: inbox.error === undefined,
            lastSyncedAt: inbox.updatedAt === 0 ? null : inbox.updatedAt,
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
