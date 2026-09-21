/**
 * The OWNER group's layout — `app/owner/_layout.tsx` in the ONE app (docs/31 §1.4).
 *
 * This was `owner-app/app/_layout.tsx`. In the one app it keeps only what belongs to THIS GROUP, and
 * the root layout one level up owns everything that belongs to the install:
 *
 *   root (`app/_layout.tsx`)            `boot()`, `setRouterNavigate`, `<ApiProvider>`, `<StatusBar>`,
 *                                       the session gate, the redirect ladder, the landing panel and
 *                                       the welcome re-arm — written ONCE for all six groups.
 *   here (`app/owner/_layout.tsx`)      the owner's theme pair and string namespace, the owner rail,
 *                                       the owner's tenant switcher and account menu, and the three
 *                                       live pieces of the owner's chrome: the header search box
 *                                       (UX-00 §8.1 keyboard map, `/`), the connection strip on the
 *                                       rail foot, and the count of decisions waiting on Today.
 *
 * Two rules this file exists to obey.
 *
 * 1. **No redirect lives here** (docs/31 §6.1). The ladder is the root's, once. What this layout does
 *    instead is REFUSE: ruling Q2 — a group whose name is not the session's elected group paints
 *    NOTHING, not even for one frame, while the root's redirect moves the person to their own group.
 *    That is why the guard below is a `return null` and not a `router.replace`.
 * 2. **No screen under here writes a route.** `<GroupProvider group="owner">` is what makes
 *    `useGo()` work in every screen of this group; this file, being OUTSIDE its own provider, uses
 *    `routeFor(GROUP, …)` directly (docs/31 §1.1, ruling Q1).
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { groupOf } from '@dos/api-client'
import {
  AppShell,
  ConnectionStrip,
  GroupProvider,
  ListRow,
  Search,
  ThemeProvider,
  routeFor,
  useGo,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'

import { GROUPS, absoluteUrl } from '../../src/config'
import { SECTIONS } from '../../src/groups/owner/nav'
import { strings } from '../../src/groups/owner/strings'
import { useHotkeys } from '../../src/groups/owner/lib/keys'
import { pendingDecisions } from '../../src/groups/owner/lib/pending-decisions'
import { staffRetailer } from '../../src/groups/owner/lib/ui'
import { useWord } from '../../src/groups/owner/lib/words'

/** This group. Spelled here and in `nav.ts`, nowhere else under `app/owner/`. */
const GROUP = 'owner'

export default function OwnerLayout(): React.JSX.Element | null {
  const { session, hydrating, signOut, switchDistributor } = useSession()
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
   * Ruling Q2, the one thing a visible role segment makes possible and therefore has to refuse.
   *
   * All six groups register with expo-router — there is no supported way to hide a branch — so a
   * manager who types `/owner/money`, or a stale tab reloaded after a role change, mounts THIS
   * layout. The root's ladder is already moving them; until it lands, an owner rail and an owner
   * dashboard query would paint for a role that may not read either. Nothing renders instead: no
   * chrome, no `<Slot/>`, no query. The same branch covers the frames before the session exists
   * (`hydrating`) and the signed-out reload, where the root renders the sign-in screen bare.
   */
  if (hydrating || session === null || groupOf(session.role) !== GROUP) return null

  return (
    <GroupProvider group={GROUP}>
      <ThemeProvider
        touch={GROUPS.owner.touch}
        density={GROUPS.owner.density}
        tenant={tenantBrand}
        strings={strings}
      >
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
                id: 'change-password',
                label: strings['app.changePassword'],
                onPress: () => {
                  router.push(routeFor(GROUP, '/change-password'))
                },
              },
              {
                id: 'audit',
                label: strings['o25.title'],
                onPress: () => {
                  router.push(routeFor(GROUP, '/settings/audit'))
                },
              },
              {
                id: 'settings',
                label: strings['o24.title'],
                onPress: () => {
                  router.push(routeFor(GROUP, '/settings'))
                },
              },
            ],
          }}
        >
          <Slot />
        </Chrome>
      </ThemeProvider>
    </GroupProvider>
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
  const go = useGo()
  const api = useApi()
  const router = useRouter()
  const word = useWord()
  const [query, setQuery] = useState('')

  /*
   * The owner dashboard, for "Updated 2 min ago" on the strip. It is the read this app opens on
   * anyway — the cache hands the Today screen the same rows without a second request.
   */
  const mayRead = isAllowed(permissionFor('reporting.dashboard.owner'), role)
  const dashboard = useQuery(
    ['reporting', 'dashboard', 'owner'],
    () => api.api.reporting.dashboard.owner(),
    { enabled: mayRead, staleTime: 60_000 },
  )

  /*
   * The rail badge counts the decisions waiting — the same two live lists, under the same query keys,
   * that the Today panel lists and the Approvals screen decides from (DOS-019). Same keys means one
   * request for the pair, and means a decision's own `invalidates: [['approvals'], ['bargains']]`
   * moves the badge and the heading together. The badge used to read the 15-minute
   * `owner_summary.pendingApprovals`, which counts approvals alone and sat at 5 after two decisions.
   */
  const approvals = useQuery(
    ['approvals', 'pending', 'top'],
    () => api.api.orders.approvals.list({ status: 'pending', limit: 5 }),
    { enabled: isAllowed(permissionFor('orders.approvals.list'), role) },
  )
  const bargains = useQuery(
    ['bargains', 'requested', 'top'],
    () => api.api.pricing.bargains.list({ status: 'requested', limit: 5 }),
    { enabled: isAllowed(permissionFor('pricing.bargains.list'), role) },
  )
  /* The kit's badge is a number (`NavItem.badge`), so a bounded count shows its floor; the heading on
   * Today carries the "+". Nothing here changes the kit. */
  const waiting = pendingDecisions(approvals.data, bargains.data)?.count ?? 0

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === go.href('/') && waiting > 0 ? { ...item, badge: waiting } : item,
        ),
      })),
    [go, waiting],
  )

  /*
   * "Search shops, bills, orders" — and it does all three, because the box says so. It read
   * `retailers.list` alone before, so typing a bill or an order number a person was holding in their
   * hand ("SO-0220", off this app's own orders register) answered "Nothing matches". `orders.list`
   * and `billing.invoices.list` both take a `q` that matches the document number (the contract says
   * so in as many words), so the promise costs two more reads of four rows each, and each result
   * lands on the register that holds it with the query already applied.
   *
   * `/` still goes to the shops register, whose own `<Search>` opens focused: the kit's `<Search>`
   * has no imperative focus, deliberately, since a native screen has no DOM node to reach into.
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
    { enabled: enabled && isAllowed(permissionFor('orders.list'), role), staleTime: 30_000 },
  )

  const hits = [
    ...(shopHits.data?.items ?? []).map((shop) => ({
      key: `shop:${shop.id}`,
      primary: shop.name,
      secondary: staffRetailer(shop)?.code ?? strings['app.searchShops'],
      href: go.href(`/shops?q=${encodeURIComponent(staffRetailer(shop)?.code ?? shop.name)}`),
    })),
    ...(billHits.data?.items ?? []).map((bill) => ({
      key: `bill:${bill.id}`,
      primary: bill.invoiceNo ?? bill.externalInvoiceNo ?? strings['app.searchBills'],
      secondary: bill.buyerName,
      href: go.href(`/billing?q=${encodeURIComponent(bill.invoiceNo ?? bill.id)}`),
    })),
    ...(orderHits.data?.items ?? []).map((order) => ({
      key: `order:${order.id}`,
      primary: order.orderNo ?? strings['app.searchOrders'],
      secondary: word(order.state),
      href: go.href(`/orders?q=${encodeURIComponent(order.orderNo ?? order.id)}`),
    })),
  ]
  const searching = shopHits.isFetching || billHits.isFetching || orderHits.isFetching

  useHotkeys({
    '/': () => {
      go.push('/shops')
    },
  })

  return (
    <AppShell
      sections={sections}
      can={can}
      activeHref={pathname}
      homeHref={go.href('/')}
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
