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
import { sessionIdentity } from '@dos/api-client'
import { ApiProvider, useApi, useQuery, useSession } from '@dos/api-client/react'
import { connectionStateFrom, openStore, SyncEngine } from '@dos/offline'
import { leaveDecision, OfflineProvider, useLeaveSession, useSyncStatus } from '@dos/offline/react'
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
import type { ApiClient, Session } from '@dos/api-client'
import type { SyncIdentity } from '@dos/offline'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { StatusBar } from 'expo-status-bar'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { boot, deviceId } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import { useTripTracking, type TripTracking } from '../src/lib/gps'
import { LeaveSheet } from '../src/lib/leave-sheet'
import { pickCurrentTrip, useLocalTrips } from '../src/lib/local'
import { SECTIONS } from '../src/nav'
import { strings } from '../src/strings'

/** This app's device-store prefix (DOS-167). `storeNameFor` adds the person and the distributor. */
const STORE_PREFIX = 'dos-delivery'

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

  /** Who the device store belongs to (DOS-167): this person, inside this distributorship. */
  const identity = useMemo(() => sessionIdentity(session), [session])

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

  /*
   * AND MOVE OUT OF THE COMMIT. `navigatorReady` says the navigator EXISTS; it does not say React has
   * finished committing the tree it belongs to, and on a phone `router.replace` inside that commit
   * still answers "Can't perform a React state update on a component that hasn't mounted yet",
   * naming expo-router's own `<ContextNavigator/>` — measured on the Pixel 7 in the delivery gate,
   * on the launch where the session restores a frame after `hydrating` clears and the redirect fires
   * twice. A zero timer is exactly what the message asks for: do the work after the mount.
   */
  useEffect(() => {
    if (!navigatorReady || redirectTo === null || redirectTo === pathname) return
    const move = setTimeout(() => {
      router.replace(redirectTo)
    }, 0)
    return () => {
      clearTimeout(move)
    }
  }, [navigatorReady, redirectTo, router, pathname])

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
      session={session}
      signOut={signOut}
      switchDistributor={switchDistributor}
      tenant={{
        current: {
          id: session.tenant.id,
          name: session.tenant.displayName,
          roleLabel: session.role,
        },
        choices,
      }}
      account={{
        name: session.user.name,
        roleLabel: session.role,
        /*
         * ONLY WHAT THE NAVIGATION DOES NOT ALREADY CARRY.
         *
         * This app has no tab bar, so `AppShell` puts BOTH the nav sections and these account items
         * into one ⋯ sheet — and "Me" and "Trip history" are already destinations in `SECTIONS`.
         * Measured on the Pixel 7: the sheet read Today · Day summary · Expenses · Attention · Trip
         * history · Me · **Me** · **Your trips** · Change your password — the same two screens twice,
         * under two different names, on this app's only way of getting around.
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
  )

  const live = session !== null && !hydrating && !mustChangePassword && !wrongRole

  return (
    <ThemeProvider touch={APP.touch} density={APP.density} tenant={tenantBrand} strings={strings}>
      <Offline identity={identity} enabled={live}>
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
 * The device database is this person's own file inside this distributorship (DOS-167): another
 * driver who signs in on this van's phone, or this driver at another distributor, opens a different
 * file and starts from nothing, because one book's trips, shops and cash are never another's to read.
 * The engine also checks the file's stamp against `identity` before it reads a single row, and a
 * switch simply stops the engine on one file and starts it on the other.
 *
 * `tables` is deliberately absent — the manifest's own nineteen tables for this role are what a crew
 * phone needs, and choosing a subset here would be this app quietly disagreeing with the server about
 * what a stop is.
 */
function Offline({
  identity,
  enabled,
  children,
}: {
  identity: SyncIdentity | null
  enabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const api = useApi()
  const device = useMemo(() => deviceId(), [])
  return (
    <OfflineProvider
      api={api.api}
      deviceId={device}
      identity={identity}
      storePrefix={STORE_PREFIX}
      enabled={enabled}
      storeFactory={openStore}
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

/** The person's files at their OTHER distributors, swept at a sign-out that leaves nothing unsent. */
function otherIdentities(session: Session): SyncIdentity[] {
  return session.memberships
    .filter((membership) => membership.tenantId !== session.tenant.id)
    .map((membership) => ({
      userId: session.user.id,
      tenantId: membership.tenantId,
      role: membership.role,
    }))
}

type ShellTenant = NonNullable<React.ComponentProps<typeof AppShell>['tenant']>
type ShellAccount = NonNullable<React.ComponentProps<typeof AppShell>['account']>

/** How the person asked to leave: signing out, or switching to another distributor. */
type Leaving = { mode: 'signOut' } | { mode: 'switch'; tenantId: string }

interface ChromeProps {
  can: (item: NavItem) => boolean
  pathname: string
  session: Session
  /** The switcher without its handler: a switch goes through the leave flow below. */
  tenant: Omit<ShellTenant, 'onSwitch'>
  /** The account menu without its sign-out: signing out goes through the leave flow below. */
  account: Omit<ShellAccount, 'onSignOut'>
  signOut: () => Promise<void>
  switchDistributor: (tenantId: string) => Promise<unknown>
  children: React.ReactNode
}

/**
 * The shell, plus the one piece of chrome a van cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the tray, which is where a refused delivery becomes a piece of work. There is never a "Sync
 * now" button (UX-00 §6.11).
 *
 * LEAVING IS DECIDED HERE, inside the provider, because it needs the device (DOS-167; founder,
 * 2026-09-13). With nothing queued and nothing refused, "Sign out" is one tap: this driver's file is
 * deleted, their files at other distributors are deleted where nothing waits in them, and only then is
 * the session cleared. With anything waiting, the leave sheet names the count and the person: "Send
 * now" while there is a signal, or sign out keeping them on this phone for this driver only. A switch
 * wipes nothing — the changes wait in this distributor's file — and asks only when something is
 * waiting.
 */
function Chrome({
  can,
  pathname,
  session,
  tenant,
  account,
  signOut,
  switchDistributor,
  children,
}: ChromeProps): React.JSX.Element {
  const router = useRouter()
  const status = useSyncStatus()
  const device = useLeaveSession()
  const [asking, setAsking] = useState<Leaving | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === '/attention' ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

  /** The leaving itself, once there is nothing left to ask. */
  const go = useCallback(
    async (to: Leaving, keepQueue: boolean): Promise<void> => {
      if (to.mode === 'switch') {
        try {
          await switchDistributor(to.tenantId)
        } finally {
          setAsking(null)
        }
        return
      }
      // The engine ends BEFORE the session is cleared: "Send now" needed the token, and the revoke may
      // wait out the 20 s deadline with no signal.
      try {
        await device.end({ keepQueue })
      } catch {
        // Signed out regardless: the next person opens a different file whatever happened to this one.
      }
      if (!keepQueue)
        await SyncEngine.sweepIdentityStores(openStore, STORE_PREFIX, otherIdentities(session))
      await signOut()
    },
    [device, session, signOut, switchDistributor],
  )

  const run = useCallback((step: () => Promise<void>): void => {
    setBusy(true)
    void step().finally(() => {
      setBusy(false)
    })
  }, [])

  const leave = useCallback(
    (to: Leaving): void => {
      if (busy) return
      if (leaveDecision(device) === 'leave') {
        run(() => go(to, false))
        return
      }
      setSent(false)
      setAsking(to)
    },
    [busy, device, go, run],
  )

  const sendNow = useCallback((): void => {
    if (asking === null || busy) return
    const to = asking
    run(async () => {
      const after = await device.sendNow()
      setSent(true)
      if (leaveDecision(after) === 'leave') await go(to, false)
    })
  }, [asking, busy, device, go, run])

  const keep = useCallback((): void => {
    if (asking === null || busy) return
    const to = asking
    run(() => go(to, true))
  }, [asking, busy, go, run])

  const cancel = useCallback((): void => {
    if (!busy) setAsking(null)
  }, [busy])

  return (
    <>
      <AppShell
        sections={sections}
        can={can}
        activeHref={pathname}
        onNavigate={(href) => {
          router.push(href)
        }}
        tenant={{
          ...tenant,
          onSwitch: (tenantId) => {
            leave({ mode: 'switch', tenantId })
          },
        }}
        account={{
          ...account,
          onSignOut: () => {
            leave({ mode: 'signOut' })
          },
        }}
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
      <LeaveSheet
        open={asking !== null}
        mode={asking?.mode ?? 'signOut'}
        pending={device.pending}
        rejected={device.rejected}
        online={device.online}
        name={session.user.name}
        tenantName={session.tenant.displayName}
        busy={busy}
        note={sent && device.online ? status.lastError : null}
        onSendNow={sendNow}
        onLeave={keep}
        onCancel={cancel}
      />
    </>
  )
}
