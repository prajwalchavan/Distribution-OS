/**
 * The MANAGER + ACCOUNTANT group of the one app (docs/31 §1.4).
 *
 * The root layout (`app/_layout.tsx`) has already done the five things every group shares: booted
 * the API client, handed expo-router's navigation to the kit, mounted the ONE `<ApiProvider>` and
 * the status bar, run the session gate and the elected-role redirect ladder, and shown the landing
 * panel. None of that is repeated here — the ladder lives in exactly one place now, which is what
 * `libs/ui/src/root-layout-redirects.test.ts` asserts.
 *
 * What is left is what makes this group THIS group:
 *
 * 1. The theme — the manager's touch floor and density (`GROUPS.manager`, UX-00 §5.2), the
 *    distributor's own name and logo (UX-00 §11), and this group's string record. The record is
 *    SWAPPED in whole, never merged with another group's (docs/31 §3): `word.POST_FULFILLMENT` is
 *    *Credit* on a manager's desk and *Pay after delivery* in a shopkeeper's hand, and 71 keys like
 *    it would take the wrong audience's wording under one flat catalogue.
 * 2. The shell: the rail from `src/groups/manager/nav.ts`, the distributor switcher, the account
 *    menu and sign-out, the header search box, the connection strip and the two queue counts.
 * 3. Which role may see what — `can()` against the SAME `PERMISSIONS` matrix manager-service
 *    enforces. That is the whole of the difference between the manager and the accountant (docs/31
 *    ruling Q5): the accountant's rail loses Fulfilment and Prices because `warehouse.queue.list`
 *    and `pricing.priceLists.upsert` refuse that role, and the screens they share hide their write
 *    controls the same way (`useCan`). There is no second permission list in this repo.
 *
 * And one rule from ruling Q2: a group layout whose group is NOT the elected one paints NOTHING —
 * not a rail, not a badge count, not for a single frame. The root's redirect is already moving the
 * person to their own group; this layout simply refuses to draw a manager's desk for a driver.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  AppShell,
  ConnectionStrip,
  GroupProvider,
  ListRow,
  Search,
  ThemeProvider,
  routeFor,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import { ApiError, groupOf } from '@dos/api-client'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'

import { GROUPS, absoluteUrl } from '../../src/config'
import { SECTIONS } from '../../src/groups/manager/nav'
import { strings } from '../../src/groups/manager/strings'
import { useHotkeys } from '../../src/groups/manager/lib/keys'
import { staffRetailer } from '../../src/groups/manager/lib/ui'
import { useWord } from '../../src/groups/manager/lib/words'

/** This group's own name, once. Every route literal below goes through it (docs/31 ruling Q1). */
const GROUP = 'manager'

export default function ManagerLayout(): React.JSX.Element | null {
  const { session, signOut, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  // UX-00 §11: the distributor's own name and logo are the chrome, everywhere except the console.
  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(GROUP, session.tenant.logoUrl) }
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

  /*
   * Ruling Q2, and the reason this is a RENDER guard rather than a redirect. All six groups register
   * with expo-router — it builds the route table statically and there is no supported way to hide a
   * branch — so a driver whose bookmark or reload names `/manager/money` mounts this layout for as
   * long as the root's redirect takes to fire. Returning null means no data for a foreign role is
   * ever painted, not even for that one frame; the moving is the root's job, not this file's.
   */
  if (session === null || groupOf(session.role) !== GROUP) return null

  return (
    <ThemeProvider
      touch={GROUPS.manager.touch}
      density={GROUPS.manager.density}
      tenant={tenantBrand}
      strings={strings}
    >
      <GroupProvider group={GROUP}>
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
                  router.push(routeFor(GROUP, '/settings'))
                },
              },
              {
                id: 'change-password',
                label: strings['app.changePassword'],
                onPress: () => {
                  router.push(routeFor(GROUP, '/change-password'))
                },
              },
            ],
          }}
        >
          <Slot />
        </Chrome>
      </GroupProvider>
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
 * The shell with its three live pieces. Split out of the layout because all three need `useApi()`,
 * and because the queries below must not run until the guard above has said this IS the elected
 * group — a driver who reloads on `/manager/money` must not make a manager's reads on the way out.
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
      [routeFor(GROUP, '/orders')]: orderCount,
      [routeFor(GROUP, '/billing')]: billCount,
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
      href: routeFor(
        GROUP,
        `/shops?q=${encodeURIComponent(staffRetailer(shop)?.code ?? shop.name)}`,
      ),
    })),
    /*
     * A bill is looked up to be ACTED ON — cancelled before the van leaves, its e-way bill entered —
     * so it opens on the Billing desk, on the issued register, with its own panel already open
     * (DOS-145). It used to land on the sales register: the right number, but nothing to press.
     */
    ...(billHits.data?.items ?? []).map((bill) => ({
      key: `bill:${bill.id}`,
      primary: bill.invoiceNo ?? bill.externalInvoiceNo ?? strings['app.searchBills'],
      secondary: bill.buyerName,
      href: routeFor(
        GROUP,
        `/billing?view=bills&bill=${encodeURIComponent(bill.id)}&q=${encodeURIComponent(bill.invoiceNo ?? bill.externalInvoiceNo ?? bill.id)}`,
      ),
    })),
    ...(orderHits.data?.items ?? []).map((order) => ({
      key: `order:${order.id}`,
      primary: order.orderNo ?? strings['app.searchOrders'],
      secondary: word(order.state),
      href: routeFor(GROUP, `/orders?q=${encodeURIComponent(order.orderNo ?? order.id)}`),
    })),
  ]
  const searching = shopHits.isFetching || billHits.isFetching || orderHits.isFetching

  useHotkeys({
    '/': () => {
      router.push(routeFor(GROUP, '/shops'))
    },
  })

  return (
    <AppShell
      sections={sections}
      can={can}
      activeHref={pathname}
      homeHref={routeFor(GROUP, '/')}
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
