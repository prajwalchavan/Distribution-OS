/**
 * The root layout: the six things this app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the 69 dp field touch floor (UX-00 §5.2), the field density, the
 *    distributor's own name and logo (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. **Start the sync engine.** This is the first field app, so it is the first consumer of
 *    `@dos/offline`: inside the session gate, one engine per install, tables scoped to the signed-in
 *    distributor. The beat, the shops, the catalog, the prices, the schemes, the dues and ninety days
 *    of the rep's own orders come down before the rep leaves; every field screen reads THEM and not a
 *    service (docs/23 §3.4, docs/27).
 * 6. Hide every destination the signed-in role could not call, from the SAME `PERMISSIONS` matrix the
 *    server enforces. There is no second permission list in this repo.
 */
import { ApiProvider, useApi, useSession } from '@dos/api-client/react'
import { openStore } from '@dos/offline'
import { OfflineProvider, useSyncStatus } from '@dos/offline/react'
import { connectionStateFrom } from '@dos/offline'
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
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { boot, deviceId } from '../src/api'
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
  const onChangePassword = pathname === '/change-password'
  /**
   * docs/23 §0 X2. A rep's account is created with a TEMPORARY password a manager reads out loud, so
   * the service reports the flag and leaves the decision to the app. Until it is cleared, every route
   * lands on the change-password screen; nothing else in the app renders, and the sync engine does
   * not start — a phone that has not been claimed does not get the beat on it.
   */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * A role sales-service does not serve.
   *
   * docs/22 §2: "a service serves only its roles (any other role gets 403 before business logic)".
   * `auth-service` will sign anyone in — it does not know which app asked — so a manager who types
   * their own username here got the salesperson's shell drawn around an empty beat, and because this
   * app reads the DEVICE rather than a query, nothing surfaced the refusal: the sync manifest came
   * back **403 "sales-service does not serve the manager role"**, the engine swallowed it, and the
   * beat sat on "Still loading the beat onto this phone" for ever. The service's own sentence is now
   * the screen, the engine is not started, and the only button signs them out.
   */
  const wrongRole = session !== null && session.role !== 'salesperson'

  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(session.tenant.logoUrl) }
        : null,
    [session],
  )

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
   * the slot unmounts the navigator the redirect itself needs.
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

  const navigationState = useRootNavigationState()
  const navigatorReady = navigationState?.key !== undefined

  useEffect(() => {
    if (navigatorReady && redirectTo !== null) router.replace(redirectTo)
  }, [navigatorReady, redirectTo, router])

  /**
   * ONE `<OfflineProvider>`, ABOVE the gate — not inside it.
   *
   * It used to sit in the signed-in branch only, and that cost a rep their queue. `hydrating` flips
   * true whenever the client refreshes the access token; the branch above returned a bare skeleton
   * for that frame, which UNMOUNTED the provider, stopped the engine and threw away its store — and
   * on the web fallback that store is in memory (docs/27 §2), so five queued lines and a whole pull
   * went with it. Measured: queue an order in a dead spot, let the token refresh fail (which is what
   * a dead spot does), and the needs-attention tray reads "0 waiting" over an order the rep was told
   * was saved.
   *
   * So the provider is mounted for the life of the app and switched with `enabled`. A signed-out app
   * runs no engine; a signed-in one runs exactly one, whatever the gate is rendering underneath.
   */
  const content = hydrating ? (
    <Screen>
      <Skeleton rows={4} />
    </Screen>
  ) : wrongRole && !onSignIn ? (
    <WrongRole
      role={session.role}
      onSignOut={() => {
        void signOut()
      }}
    />
  ) : session === null || onSignIn || mustChangePassword ? (
    // Signed out, on the sign-in screen, or holding a password somebody else chose: the route alone.
    <Slot />
  ) : (
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
  )

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <Offline
        tenantId={session?.tenant.id ?? null}
        enabled={session !== null && !mustChangePassword && !wrongRole}
      >
        {content}
      </Offline>
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

/**
 * The sync engine, started once per signed-in session.
 *
 * `tenantId` is not decoration: `schemaVersion` is a hash of the ROLE's tables, so a rep who works
 * for two distributors gets the same hash from both, and without the tenant on the engine the second
 * one's delta would land on the first one's rows. A switch re-snapshots.
 *
 * `tables` is deliberately absent — the whole read set the manifest publishes for this role is what a
 * rep needs on the phone, and choosing a subset here would be this app quietly disagreeing with the
 * server about what a beat is.
 */
function Offline({
  tenantId,
  enabled,
  children,
}: {
  tenantId: string | null
  enabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const api = useApi()
  const device = useMemo(() => deviceId(), [])
  return (
    <OfflineProvider
      api={api.api}
      deviceId={device}
      {...(tenantId === null ? {} : { tenantId })}
      enabled={enabled}
      storeFactory={openStore}
      databaseName="dos-sales.db"
    >
      {children}
    </OfflineProvider>
  )
}

interface ChromeProps {
  can: (item: NavItem) => boolean
  pathname: string
  tenant: React.ComponentProps<typeof AppShell>['tenant']
  account: React.ComponentProps<typeof AppShell>['account']
  children: React.ReactNode
}

/**
 * The shell, plus the one piece of chrome this app cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the needs-attention tray, which is where a rejected write becomes a piece of work. There is
 * never a "Sync now" button (UX-00 §6.11).
 */
function Chrome({ can, pathname, tenant, account, children }: ChromeProps): React.JSX.Element {
  const router = useRouter()
  const status = useSyncStatus()

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === '/orders' ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

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
          state={connectionStateFrom(status)}
          onOpenQueue={() => {
            router.push('/orders/attention')
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
