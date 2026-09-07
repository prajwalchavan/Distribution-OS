/**
 * The root layout: the six things this app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the **76 dp floor** touch target this app's shell fixes (UX-00 §5.2:
 *    "≥ 76 dp on every warehouse screen"), the field density, the distributor's own name and logo
 *    (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. Start the sync engine. A godown is a steel shed: the picking sheet reads the DEVICE and the
 *    picks queue in the outbox (`src/lib/local.ts`, `src/lib/queue.ts`), which is the one flow
 *    docs/23 §4.4 names as needing to survive a dead spot.
 * 6. Hide every destination the signed-in role could not call, from the SAME `PERMISSIONS` matrix the
 *    server enforces. There is no second permission list in this repo.
 */
import { ApiProvider, useApi, useSession } from '@dos/api-client/react'
import { connectionStateFrom, openStore } from '@dos/offline'
import { OfflineProvider, useSyncStatus } from '@dos/offline/react'
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
import { StatusBar } from 'expo-status-bar'
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
      {/*
       * DARK STATUS-BAR CONTENT, BECAUSE THE APP IS LIGHT.
       *
       * `userInterfaceStyle: "light"` in app.json tells the app which palette to draw; it does not
       * tell ANDROID which colour to draw the clock, signal and battery in, and the default there is
       * light-on-light. Measured on the Pixel 7 emulator: the whole status bar was white over the
       * app's own #F2F2EF ground — a godown phone that cannot show the time or the signal strength,
       * on the app whose promise is that it works on a bad connection. `expo-status-bar` was already
       * a dependency of every app and used by none. iOS was already correct; on the web this renders
       * nothing.
       */}
      <StatusBar style="dark" />
      <Shell />
    </ApiProvider>
  )
}

function Shell(): React.JSX.Element {
  const { session, hydrating, signOut, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const onSignIn = pathname === '/sign-in'
  const onChangePassword = pathname === '/change-password'

  /** docs/23 §0 X2: a temporary password a manager read out loud is changed before anything else. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * A role warehouse-service does not serve.
   *
   * docs/22 §2: "a service serves only its roles (any other role gets 403 before business logic)".
   * `auth-service` will sign anyone in — it does not know which app asked — so without this a manager
   * typing their own username here would get the godown's tabs drawn around four empty queues while
   * every call, the sync manifest included, answered 403. The service's own sentence is the screen,
   * the engine is not started, and the only button signs them out.
   */
  const wrongRole = session !== null && session.role !== 'warehouse'

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

  const redirectTo = hydrating
    ? null
    : session === null
      ? onSignIn
        ? null
        : '/sign-in'
      : /*
         * A role this service does not serve is NOT sent to a screen. It used to be: the redirect
         * fired on sign-in, and for the one commit in which expo-router had swapped the route but
         * `pathname` still read `/sign-in`, the home screen mounted and asked warehouse-service for
         * eight things it may not have — measured, EIGHT 403s per wrong-role sign-in, which is the
         * exact thing the refusal screen exists to prevent.
         */
        wrongRole
        ? null
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
   * ONE `<OfflineProvider>`, ABOVE the gate — not inside it. `hydrating` flips true whenever the
   * client refreshes the access token, and a provider inside the gate would be unmounted for that
   * frame, stopping the engine and throwing away its store (in memory on the web fallback, docs/27
   * §2) — with a picker's unsent lines in it. It is mounted for the life of the app and switched
   * with `enabled`.
   */
  const content = hydrating ? (
    <Screen>
      <Skeleton rows={4} />
    </Screen>
  ) : wrongRole ? (
    <WrongRole
      role={session.role}
      onSignOut={() => {
        void signOut()
      }}
    />
  ) : session === null || onSignIn || mustChangePassword ? (
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
            id: 'me',
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
      {/*
       * `!hydrating` is part of the switch, not decoration. A restored session is real the instant
       * the snapshot is read, but the ACCESS token is never persisted (`src/api.ts`) — so starting
       * the engine before the refresh lands sent `GET /sync/manifest` with no bearer and took a
       * **401 on every single cold start**, one console error and one wasted round trip per launch,
       * measured on all twenty routes. The client's own transparent refresh then retried it and the
       * app worked, which is exactly why it went unnoticed. The provider stays MOUNTED through the
       * refresh (see above); only its first call now waits for a token.
       */}
      <Offline
        tenantId={session?.tenant.id ?? null}
        enabled={session !== null && !hydrating && !mustChangePassword && !wrongRole}
      >
        {content}
      </Offline>
    </ThemeProvider>
  )
}

/** The service's own refusal, as a screen: no shell, no tabs, one way out. */
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
 * `tenantId` is not decoration: `schemaVersion` hashes the ROLE's tables, so a hand who works two
 * godowns for two distributors gets the same hash from both, and without the tenant on the engine the
 * second one's delta would land on the first one's rows.
 *
 * `tables` is deliberately absent — the manifest's own thirteen tables for this role are what a
 * godown phone needs, and choosing a subset here would be this app quietly disagreeing with the
 * server about what a picking sheet is.
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
      databaseName="dos-warehouse.db"
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
 * The shell, plus the one piece of chrome a godown cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the tray, which is where a rejected pick becomes a piece of work. There is never a "Sync now"
 * button (UX-00 §6.11).
 */
function Chrome({ can, pathname, tenant, account, children }: ChromeProps): React.JSX.Element {
  const router = useRouter()
  const status = useSyncStatus()

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === '/pick' ? { ...item, badge: status.rejected } : item,
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
            router.push('/pick/attention')
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
