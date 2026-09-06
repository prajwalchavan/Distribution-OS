/**
 * The root layout: the five things every Distribution OS app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the touch floor and the density the SHELL fixes (UX-00 §5.2, chosen by
 *    viewport), the distributor's own name and logo (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. Hide every rail item the signed-in role could not call, from the SAME `PERMISSIONS` matrix the
 *    server enforces (docs/08 §0). There is no second permission list in this repo.
 *
 * The owner app adds three things to the skeleton, all of them chrome rather than screen: the header
 * search box (UX-00 §8.1 keyboard map, `/`), the connection strip on the rail foot, and the count of
 * decisions waiting on the Today item.
 */
import { ApiProvider, useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  AppShell,
  ConnectionStrip,
  ListRow,
  Screen,
  Search,
  Skeleton,
  ThemeProvider,
  setRouterNavigate,
} from '@dos/ui'
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
import { useHotkeys } from '../src/lib/keys'
import { staffRetailer } from '../src/lib/ui'

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
   * gate can never disagree. The server still answers 403 if a hidden route is reached by hand.
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
   * Where the session says this person should be, or null when they are already there. The redirect
   * is imperative and the layout ALWAYS renders its `<Slot />`: returning a `<Redirect>` INSTEAD of
   * the slot unmounts the navigator the redirect needs.
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
      <Chrome
        role={role ?? null}
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
          items: [
            {
              id: 'audit',
              label: strings['o25.title'],
              onPress: () => {
                router.push('/settings/audit')
              },
            },
            {
              id: 'settings',
              label: strings['o24.title'],
              onPress: () => {
                router.push('/settings')
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

interface ChromeProps {
  role: PermissionRole | null
  can: (item: NavItem) => boolean
  pathname: string
  tenant: React.ComponentProps<typeof AppShell>['tenant']
  account: React.ComponentProps<typeof AppShell>['account']
  children: React.ReactNode
}

/**
 * The shell with its three live pieces. Split out of `Shell` because all three need `useApi()`, which
 * only exists inside `<ApiProvider>` — and because the hooks below must not run before the session
 * gate above has decided whether there is a session at all.
 */
function Chrome({
  role,
  can,
  pathname,
  tenant,
  account,
  children,
}: ChromeProps): React.JSX.Element {
  const api = useApi()
  const router = useRouter()
  const [query, setQuery] = useState('')

  /*
   * One cheap read serves two honesty jobs: the count of decisions waiting (the rail badge) and
   * "Updated 2 min ago" on the strip. It is the owner dashboard because that is the read this app
   * opens on anyway — the cache hands the Today screen the same rows without a second request.
   */
  const mayRead = isAllowed(permissionFor('reporting.dashboard.owner'), role)
  const dashboard = useQuery(
    ['reporting', 'dashboard', 'owner'],
    () => api.api.reporting.dashboard.owner(),
    { enabled: mayRead, staleTime: 60_000 },
  )

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === '/' && (dashboard.data?.pendingApprovals ?? 0) > 0
            ? { ...item, badge: dashboard.data?.pendingApprovals }
            : item,
        ),
      })),
    [dashboard.data?.pendingApprovals],
  )

  /*
   * The shops register is this app's search surface: its own `<Search>` opens focused, so "go to"
   * lands the cursor in a field the reader can actually type into. The kit's `<Search>` contract has
   * no imperative focus — deliberately, since a native screen has no DOM node to focus — so `/`
   * navigates rather than pretending to reach into a component.
   */
  const matches = useQuery(
    ['search', 'retailers', query],
    () => api.api.retailers.list({ q: query, limit: 6 }),
    { enabled: query.trim().length >= 2, staleTime: 30_000 },
  )

  useHotkeys({
    '/': () => {
      router.push('/shops')
    },
  })

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
      search={
        <Search
          testID="global-search"
          value={query}
          onChange={setQuery}
          placeholder={strings['app.search']}
          size="desk"
          state={
            query.trim().length < 2
              ? 'idle'
              : matches.isFetching
                ? 'typing'
                : (matches.data?.items.length ?? 0) === 0
                  ? 'noResults'
                  : 'results'
          }
        >
          {(matches.data?.items ?? []).map((shop) => (
            <ListRow
              key={shop.id}
              primary={shop.name}
              secondary={staffRetailer(shop)?.code}
              onPress={() => {
                setQuery('')
                router.push(
                  `/shops?q=${encodeURIComponent(staffRetailer(shop)?.code ?? shop.name)}`,
                )
              }}
            />
          ))}
        </Search>
      }
      connection={
        <ConnectionStrip
          testID="connection"
          state={{
            online: dashboard.error === undefined,
            lastSyncedAt: dashboard.updatedAt === 0 ? null : dashboard.updatedAt,
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
