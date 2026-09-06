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
 * This app is TWO apps in one codebase (docs/22 §2): `manager` runs the day and `accountant` is the
 * money desk and a reader. Step 5 is the whole of that difference — the rail an accountant sees has
 * no Fulfilment and no Prices because `warehouse.queue.list` and `pricing.priceLists.upsert` refuse
 * the accountant, and the screens they do share hide their write controls the same way (`useCan`).
 *
 * The manager app adds three things to the skeleton, all of them chrome rather than screen: the
 * header search box (UX-00 §8.1 keyboard map, `/`), the connection strip on the rail foot, and the
 * two counts the day is actually paced by — orders waiting to be confirmed and bills waiting to be
 * issued.
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
import { ApiError, type ApiClient } from '@dos/api-client'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { boot } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import { SECTIONS } from '../src/nav'
import { strings } from '../src/strings'
import { useHotkeys } from '../src/lib/keys'
import { staffRetailer } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

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
  const onChangePassword = pathname === '/change-password'
  /**
   * docs/23 §0 X2. A staff account is created with a TEMPORARY password — `tenancy.staff.create`
   * sets `must_change_password` and a manager reads the password out loud — so the service reports
   * the flag and leaves the decision to the app. Until it is cleared, every route of this app lands
   * on the change-password screen and no chrome renders. It matters more here than anywhere: the
   * person who hands out those passwords is the one signing in.
   */
  const mustChangePassword = session?.user.mustChangePassword === true

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
      : mustChangePassword
        ? onChangePassword
          ? null
          : '/change-password'
        : onSignIn
          ? '/'
          : null

  /*
   * Wait for the root navigator to exist before moving. On the web the layout effect and the
   * navigator mount in the same tick, so `router.replace` from an effect is safe; on a phone it is
   * not, and React Native answers with "Can't perform a React state update on a component that
   * hasn't mounted yet" naming expo-router's own `<ContextNavigator/>`. `useRootNavigationState()`
   * has a `key` only once that navigator is mounted, which is exactly the condition.
   */
  const navigationState = useRootNavigationState()
  const navigatorReady = navigationState?.key !== undefined

  useEffect(() => {
    if (navigatorReady && redirectTo !== null) router.replace(redirectTo)
  }, [navigatorReady, redirectTo, router])

  if (hydrating) {
    return (
      <ThemeProvider touch={APP.touch} density={APP.density} strings={strings}>
        <Screen>
          <Skeleton rows={4} />
        </Screen>
      </ThemeProvider>
    )
  }

  // Signed out, on the sign-in screen, or holding a password somebody else chose: the route alone.
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
              id: 'profile',
              label: strings['x4.title'],
              onPress: () => {
                router.push('/settings')
              },
            },
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
  const word = useWord()
  const [query, setQuery] = useState('')

  /*
   * The two counts a back office actually runs on, and the honesty line under them.
   *
   * The owner app takes both from `reporting.dashboard.owner`; a manager's day is paced by two
   * queues instead — orders that came in and are waiting for a decision, and packed orders waiting
   * for a bill. Both are cheap reads the destination screen then gets from the cache for free, and
   * `orders.list` is the read that also feeds "Updated 2 min ago": it is the one every role in this
   * app may make, so the strip never goes quiet for the accountant.
   */
  const maySeeOrders = isAllowed(permissionFor('orders.list'), role)
  const submitted = useQuery(
    ['orders', 'list', 'submitted', 'badge'],
    () => api.api.orders.list({ state: 'submitted', limit: 100 }),
    { enabled: maySeeOrders, staleTime: 60_000 },
  )
  const billingQueue = useQuery(
    ['billing', 'queue', 'badge'],
    () => api.api.billing.invoices.queue({ limit: 100 }),
    {
      enabled: isAllowed(permissionFor('billing.invoices.queue'), role),
      staleTime: 60_000,
    },
  )

  const orderCount = submitted.data?.items.length
  const billCount = billingQueue.data?.items.length

  const sections = useMemo(() => {
    const badges: Readonly<Record<string, number | undefined>> = {
      '/orders': orderCount,
      '/billing': billCount,
    }
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const badge = badges[item.href]
        return badge !== undefined && badge > 0 ? { ...item, badge } : item
      }),
    }))
  }, [orderCount, billCount])

  /*
   * "Search shops, bills, orders" — and it does all three, because the box says so. Each result
   * lands on the register that holds it with the query already applied, ACROSS every date: the
   * person holding the paper does not know which month the register is showing.
   */
  const enabled = query.trim().length >= 2
  const shopHits = useQuery(
    ['search', 'retailers', query],
    () => api.api.retailers.list({ q: query, limit: 4 }),
    { enabled: enabled && isAllowed(permissionFor('retailers.list'), role), staleTime: 30_000 },
  )
  const billHits = useQuery(
    ['search', 'invoices', query],
    () => api.api.billing.invoices.list({ q: query, limit: 4 }),
    {
      enabled: enabled && isAllowed(permissionFor('billing.invoices.list'), role),
      staleTime: 30_000,
    },
  )
  const orderHits = useQuery(
    ['search', 'orders', query],
    () => api.api.orders.list({ q: query, limit: 4 }),
    { enabled: enabled && maySeeOrders, staleTime: 30_000 },
  )

  const hits = [
    ...(shopHits.data?.items ?? []).map((shop) => ({
      key: `shop:${shop.id}`,
      primary: shop.name,
      secondary: staffRetailer(shop)?.code ?? strings['app.searchShops'],
      href: `/shops?q=${encodeURIComponent(staffRetailer(shop)?.code ?? shop.name)}`,
    })),
    ...(billHits.data?.items ?? []).map((bill) => ({
      key: `bill:${bill.id}`,
      primary: bill.invoiceNo ?? bill.externalInvoiceNo ?? strings['app.searchBills'],
      secondary: bill.buyerName,
      href: `/registers?q=${encodeURIComponent(bill.invoiceNo ?? bill.id)}`,
    })),
    ...(orderHits.data?.items ?? []).map((order) => ({
      key: `order:${order.id}`,
      primary: order.orderNo ?? strings['app.searchOrders'],
      secondary: word(order.state),
      href: `/orders?q=${encodeURIComponent(order.orderNo ?? order.id)}`,
    })),
  ]
  const searching = shopHits.isFetching || billHits.isFetching || orderHits.isFetching

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
          state={
            !enabled ? 'idle' : searching ? 'typing' : hits.length === 0 ? 'noResults' : 'results'
          }
        >
          {hits.map((hit) => (
            <ListRow
              key={hit.key}
              primary={hit.primary}
              secondary={hit.secondary}
              onPress={() => {
                setQuery('')
                router.push(hit.href)
              }}
            />
          ))}
        </Search>
      }
      connection={
        /*
         * OFFLINE MEANS OFFLINE — not "the server said no".
         *
         * This read `online` as "the header's query has no error", so any answered refusal painted
         * the strip whose entire job is the honesty contract with the wrong fact: signed in as a
         * role manager-service does not serve, every panel says "does not serve the warehouse role"
         * (a 403, delivered over a working connection) and the rail foot said "Offline since 7:15
         * pm". `ApiError.kind` already separates the two — `network` is the request that never got
         * a reply, and only that is offline.
         */
        <ConnectionStrip
          testID="connection"
          state={{
            online: !(submitted.error instanceof ApiError && submitted.error.kind === 'network'),
            lastSyncedAt: submitted.updatedAt === 0 ? null : submitted.updatedAt,
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
