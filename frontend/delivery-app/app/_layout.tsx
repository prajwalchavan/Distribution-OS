/**
 * The root layout: the seven things this app does before a screen renders.
 *
 * 1. Build the API client over the platform token store, and wait for it (`boot()`).
 * 2. Put the theme in place — the `field` (69 dp) floor this app's shell fixes, with the three STOP
 *    actions naming `floor` (76 dp) where UX-00 §5.2 asks for it, the field density, the
 *    distributor's own name and logo (UX-00 §11), and this app's string namespace.
 * 3. Hand expo-router's navigation to the kit, so `<Link>` and the shell can move.
 * 4. Gate on the session: no session, and every route redirects to `/sign-in`.
 * 5. Refuse a role delivery-service does not serve, as a SCREEN rather than as a redirect.
 * 6. Start the sync engine. This is the offline-before-pilot app (docs/23 §5.4): every delivery,
 *    proof, receipt and return is written to the device and replayed in order.
 * 7. Track the trip — and ONLY the trip (ADR 0012): the breadcrumbs go to `/gps/points` on their own,
 *    never through the queue, and the tracker is mounted here so it survives every push between the
 *    stop, the door and the collect screens.
 */
import { ApiProvider, useApi, useQuery, useSession } from '@dos/api-client/react'
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
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { boot, deviceId } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import { useTripTracking, type TripTracking } from '../src/lib/gps'
import { pickCurrentTrip, useLocalTrips } from '../src/lib/local'
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

function Shell(): React.JSX.Element {
  const { session, hydrating, signOut, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const onSignIn = pathname === '/sign-in'
  const onChangePassword = pathname === '/change-password'

  /** docs/23 §0 X2: a temporary password a manager read out loud is changed before anything else. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * A role delivery-service does not serve.
   *
   * docs/22 §2: "a service serves only its roles (any other role gets 403 before business logic)".
   * `auth-service` will sign anyone in — it does not know which app asked — so without this a manager
   * typing their own username here would get the crew's chrome drawn around an empty road while every
   * call, the sync manifest included, answered 403. The service's own sentence is the screen, the
   * engine is not started, the tracker is not started, and the only button signs them out.
   */
  const wrongRole = session !== null && session.role !== 'delivery'

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
      : wrongRole
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
   * frame, stopping the engine and throwing away its store — with a driver's unsent deliveries and
   * receipts in it. It is mounted for the life of the app and switched with `enabled`; the token is
   * waited for, because the access token is never persisted and starting the engine without one
   * spends a 401 on every cold start.
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
            label: strings['d12.title'],
            onPress: () => {
              router.push('/settings')
            },
          },
          {
            id: 'trips',
            label: strings['d11.title'],
            onPress: () => {
              router.push('/trips')
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

  const live = session !== null && !hydrating && !mustChangePassword && !wrongRole

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <Offline tenantId={session?.tenant.id ?? null} enabled={live}>
        <Tracking enabled={live}>{content}</Tracking>
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
 * `tenantId` is not decoration: `schemaVersion` hashes the ROLE's tables, so a driver who works for
 * two distributors gets the same hash from both, and without the tenant on the engine the second
 * one's delta would land on the first one's rows.
 *
 * `tables` is deliberately absent — the manifest's own nineteen tables for this role are what a crew
 * phone needs, and choosing a subset here would be this app quietly disagreeing with the server about
 * what a stop is.
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
      databaseName="dos-delivery.db"
    >
      {children}
    </OfflineProvider>
  )
}

const TrackingContext = createContext<TripTracking | null>(null)

/** What D1 and D2 read to tell the driver, honestly, whether the office can see the vehicle. */
export function useTracking(): TripTracking | null {
  return useContext(TrackingContext)
}

/**
 * The trip tracker, mounted above every screen so it survives the pushes between the stop, the door
 * and the collect screens — and torn down the moment the trip stops being `active`.
 *
 * The trip comes from the DEVICE, not from a read: a driver in a dead spot is exactly who this is
 * for, and a tracker that waited for `trips.get` to answer would stop tracking at the first tunnel.
 * Consent comes from the service, because a granted `location_consents` row is the office's record
 * and the phone must not invent one; with no answer yet (a cold start with no signal) it is treated
 * as not granted, which is the safe direction for a DPDP notice.
 */
function Tracking({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const api = useApi()
  const device = useMemo(() => deviceId(), [])
  const { rows } = useLocalTrips()
  const trip = pickCurrentTrip(rows)
  const consent = useQuery(['consent', 'mine'], () => api.api.delivery.consents.get({}), {
    enabled,
    staleTime: 300_000,
  })
  const granted = consent.data?.item?.granted === true
  const tracking = useTripTracking({
    tripId: trip?.id ?? null,
    deviceId: device,
    enabled: enabled && granted && trip?.state === 'active',
  })
  return <TrackingContext.Provider value={tracking}>{children}</TrackingContext.Provider>
}

interface ChromeProps {
  can: (item: NavItem) => boolean
  pathname: string
  tenant: React.ComponentProps<typeof AppShell>['tenant']
  account: React.ComponentProps<typeof AppShell>['account']
  children: React.ReactNode
}

/**
 * The shell, plus the one piece of chrome a van cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the tray, which is where a refused delivery becomes a piece of work. There is never a "Sync
 * now" button (UX-00 §6.11).
 */
function Chrome({ can, pathname, tenant, account, children }: ChromeProps): React.JSX.Element {
  const router = useRouter()
  const status = useSyncStatus()

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === '/attention' ? { ...item, badge: status.rejected } : item,
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
            router.push('/attention')
          }}
        />
      }
    >
      {children}
    </AppShell>
  )
}
