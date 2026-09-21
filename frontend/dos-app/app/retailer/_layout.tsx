/**
 * The shopkeeper's GROUP layout — what is still this app's own once the six become one (docs/31 §1.4).
 *
 * WHAT STAYS HERE, and why it could not lift. The `<ThemeProvider>` carries this group's touch floor
 * and density (UX-00 §5.2: `field`, 69 dp) and its own STRING RECORD — swapped, never merged, because
 * `word.POST_FULFILLMENT` is "Pay after delivery" to a shopkeeper and "Credit" to an owner (docs/31
 * §3). The whole `<AppShell>` call stays too: `sections` are this group's, the unread badge is this
 * group's, and the tenant switcher and the account menu are PROPS of that one element — splitting
 * them out would mean splitting `AppShell`, which this slice does not do.
 *
 * WHAT LIFTED TO THE ROOT, written once for all six groups: `boot()`, `setRouterNavigate`, the single
 * `<ApiProvider>` and its one in-memory access token, `<StatusBar style="dark" />`, the session gate
 * and the redirect ladder, the landing panel and the welcome re-arm. None of it is recreated here.
 *
 * THE WRONG-ROLE SCREEN IS GONE (docs/31 §1.3, ruling B3). With one group per role there is no wrong
 * app to be in: the person elects a role at sign-in, the token carries it, and the root takes them to
 * their own group. What is left is ruling Q2's floor — a group layout whose group is not the session's
 * renders NOTHING, so no shop data is painted for a foreign role even for a single frame while the
 * root's redirect runs.
 *
 * NO OFFLINE ENGINE, deliberately (docs/22, docs/23 §6.4, docs/31 §4): the shop's app is online-first
 * with a query cache and no device database, and `<ConnectionStrip>` says so honestly rather than
 * leaving a stale figure looking current.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { groupOf } from '@dos/api-client'
import { AppShell, ConnectionStrip, GroupProvider, ThemeProvider, routeFor } from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { AccountMenu, NavItem, TenantChoice, TenantSwitcherProps } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'

import { GROUPS, absoluteUrl } from '../../src/config'
import { SECTIONS } from '../../src/groups/retailer/nav'
import { strings } from '../../src/groups/retailer/strings'

/** The one literal this group writes. Every route below goes through `routeFor`/`useGo` from it. */
const GROUP = 'retailer'

export default function RetailerLayout(): React.JSX.Element | null {
  const { session, signOut, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  // UX-00 §11 and docs/23 §6.5: the distributor's own name and logo are the chrome, never ours.
  const tenantBrand = useMemo(
    () =>
      session
        ? {
            name: session.tenant.displayName,
            logoUrl: absoluteUrl(GROUP, session.tenant.logoUrl),
          }
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

  /*
   * Ruling Q2, and docs/23 §0 X2. No session, a password somebody else chose, or an elected role
   * whose group is not this one: the ROOT is already moving this person somewhere else, and this
   * layout paints nothing in the meantime. It never redirects itself — the ladder lives in one place.
   */
  if (session === null || session.user.mustChangePassword || groupOf(session.role) !== GROUP) {
    return null
  }

  return (
    <ThemeProvider
      touch={GROUPS[GROUP].touch}
      density={GROUPS[GROUP].density}
      tenant={tenantBrand}
      strings={strings}
    >
      <GroupProvider group={GROUP}>
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
             * merges the nav sections AND these items into one ⋯ sheet — and "My account" is already
             * a destination in `SECTIONS`. Listing it here too is how the delivery app came to show
             * two screens twice on its only way of getting around.
             *
             * Change-password is a ROOT route of the one app, shared by all six groups, so `routeFor`
             * hands it back unchanged rather than putting `/retailer` in front of it.
             */
            items: [
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

  const inboxHref = routeFor(GROUP, '/inbox')
  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === inboxHref && unread > 0 ? { ...item, badge: unread } : item,
        ),
      })),
    [unread, inboxHref],
  )

  return (
    <AppShell
      sections={sections}
      can={can}
      activeHref={pathname}
      /*
       * The group's own base is its HOME. Without this the rail would light "Home" on every screen
       * of the group, because `/retailer` is a prefix of `/retailer/dues` (docs/31 §1.3, nav-active).
       */
      homeHref={routeFor(GROUP, '/')}
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
