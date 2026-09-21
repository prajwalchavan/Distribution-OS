/**
 * The DELIVERY group's layout: what the crew's app is, now that it is a group of the one app.
 *
 * docs/31 §1.4. The root layout (`app/_layout.tsx`) owns everything an install has once — `boot()`,
 * `setRouterNavigate`, the one `<ApiProvider>`, the status bar, the session gate, the redirect ladder
 * and the landing panel. None of that is repeated here. What is left is what makes this group the
 * crew's app rather than the owner's:
 *
 * 1. The theme: the 69 dp `field` touch floor (UX-00 §5.2) with the three STOP actions naming `floor`
 *    (76 dp) where they need it, the field density, the distributor's own name and logo (UX-00 §11),
 *    and THIS group's string namespace — swapped in whole, never merged (docs/31 §3).
 * 2. The shell: the crew's own `SECTIONS`, its badge, its connection strip, its switcher and account
 *    menu, and the leave flow every sign-out in this group takes.
 * 3. The sync engine. This is the offline-before-pilot app (docs/23 §5.4): every delivery, proof,
 *    receipt and return is written to the device and replayed in order. The store prefix comes from
 *    `GROUPS.delivery.offline`, not a literal — one person on a shared van phone keeps one clean file
 *    per elected role (docs/31 §4, ruling on DOS-167).
 * 4. The trip tracker — and ONLY the trip (ADR 0012): the breadcrumbs go to `/gps/points` on their
 *    own, never through the queue, and the tracker is mounted here so it survives every push between
 *    the stop, the door and the collect screens.
 *
 * There is no wrong-role screen any more (docs/31 §1.3, ruling B3): the election happens at sign-in
 * and the root's ladder takes a person to their own group. What this layout owes ruling Q2 is that a
 * group which is NOT the elected one paints nothing at all — not one frame of another role's data —
 * while that redirect runs.
 */
import { sessionIdentity, GROUP_OF } from '@dos/api-client'
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  connectionStateFrom,
  consoleSink,
  FIELD_STORE_PREFIXES,
  openStore,
  SyncEngine,
} from '@dos/offline'
import { OfflineProvider, useLeaveSession, useSyncStatus } from '@dos/offline/react'
import {
  AppShell,
  ConnectionStrip,
  GroupProvider,
  Screen,
  Skeleton,
  ThemeProvider,
  routeFor,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import NetInfo from '@react-native-community/netinfo'
import type { Session } from '@dos/api-client'
import type { SyncIdentity } from '@dos/offline'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { deviceId } from '../../src/api'
import { GROUPS, absoluteUrl } from '../../src/config'
import { useTripTracking, type TripTracking } from '../../src/groups/delivery/lib/gps'
import {
  leaveNow,
  sendNowThenLeave,
  tapLeave,
  type Leaving,
  type LeaveSteps,
} from '../../src/groups/delivery/lib/leave'
import { LeaveContext } from '../../src/groups/delivery/lib/leave-context'
import { LeaveSheet } from '../../src/groups/delivery/lib/leave-sheet'
import { pickCurrentTrip, useLocalTrips } from '../../src/groups/delivery/lib/local'
import { SECTIONS } from '../../src/groups/delivery/nav'
import { strings } from '../../src/groups/delivery/strings'

/** This group, once — the segment in the URL, the key in `GROUPS`, the base every route literal gets. */
const GROUP = 'delivery'
const { touch, density, offline: STORE_PREFIX } = GROUPS.delivery

export default function DeliveryLayout(): React.JSX.Element {
  const { session, hydrating, signOutOnDevice, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  /** docs/23 §0 X2: a temporary password a manager read out loud is changed before anything else. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /**
   * RULING Q2 — a group that is not the elected one paints NOTHING.
   *
   * Every group's route tree is registered (expo-router has no supported way to hide a branch), so a
   * typed URL or a stale bookmark can mount this layout under an owner's token. The root's ladder is
   * already moving the person; what this must not do is draw a frame of the crew's chrome, start the
   * engine on a store this token has no business opening, or spend a 403 on the consent query first.
   */
  const mine = session !== null && GROUP_OF[session.role] === GROUP

  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(GROUP, session.tenant.logoUrl) }
        : null,
    [session],
  )

  /** Who the device store belongs to (DOS-167): this person, inside this distributorship. */
  const identity = useMemo(() => (mine ? sessionIdentity(session) : null), [mine, session])

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

  const live = mine && !hydrating && !mustChangePassword

  /**
   * ONE `<OfflineProvider>`, ABOVE the gate — not inside it. `hydrating` flips true whenever the
   * client refreshes the access token, and a provider inside the gate would be unmounted for that
   * frame, stopping the engine and throwing away its store — with a driver's unsent deliveries and
   * receipts in it. It is mounted for the life of the group and switched with `enabled`; the token is
   * waited for, because the access token is never persisted and starting the engine without one
   * spends a 401 on every cold start.
   */
  const content =
    live && session !== null ? (
      <Chrome
        can={can}
        pathname={pathname}
        session={session}
        signOutOnDevice={signOutOnDevice}
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
           * This group has no tab bar, so `AppShell` puts BOTH the nav sections and these account
           * items into one ⋯ sheet — and "Me" and "Trip history" are already destinations in
           * `SECTIONS`. Measured on the Pixel 7: the sheet read Today · Day summary · Expenses ·
           * Attention · Trip history · Me · **Me** · **Your trips** · Change your password — the same
           * two screens twice, under two different names, on this app's only way of getting around.
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
    ) : (
      <Screen>
        <Skeleton rows={4} />
      </Screen>
    )

  return (
    <GroupProvider group={GROUP}>
      <ThemeProvider touch={touch} density={density} tenant={tenantBrand} strings={strings}>
        <Offline identity={identity} enabled={live}>
          <Tracking enabled={live}>{content}</Tracking>
        </Offline>
      </ThemeProvider>
    </GroupProvider>
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
 * The prefix is `GROUPS.delivery.offline` (docs/31 §4). It already named a ROLE rather than a
 * codebase, so `storeNameFor` and `STORE_APP_LETTERS` are untouched by the merge: the owner who
 * drives on Tuesdays elects `delivery`, and his afternoon gets its own clean file beside his morning.
 *
 * `tables` is deliberately absent — the manifest's own nineteen tables for this role are what a crew
 * phone needs, and choosing a subset here would be this group quietly disagreeing with the server
 * about what a stop is.
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
      watchRadio={watchRadio}
      /* S-139 (ruling 3 (dd)): the `offline:` lines go where a support call and a QA gate can read them. */
      onLog={consoleSink}
    >
      {children}
    </OfflineProvider>
  )
}

/**
 * THE VAN'S RADIO (DOS-068). A browser fires `online` / `offline` events and the provider listens to them by
 * itself; a phone fires neither, and React Native's `navigator` carries no `onLine`, so the engine fell back on
 * "nothing says otherwise" and a driver in airplane mode kept a green strip and "Updated just now" over a phone
 * that was reaching nothing (measured on the Pixel 7, ping "Network is unreachable").
 *
 * NetInfo is the platform's own answer, and it is the whole of what is asked of it here: one boolean, handed to
 * the engine, which decides what to do with it — a radio that comes back clears the backoff and drains the queue
 * rather than waiting out the poll. It is a HINT and never the verdict: the strip still needs the last call to
 * have reached a service, because the office can be unreachable with four bars. The package resolves per platform
 * on its own (`.web` internals in a browser), so this one line serves the website, Android and iOS.
 *
 * Module scope, not a new closure per render: the provider holds the subscription for the life of the engine.
 */
function watchRadio(onChange: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null until NetInfo has probed; the radio itself is what this reports.
    onChange(state.isConnected !== false)
  })
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

/**
 * EVERY FILE THIS PERSON COULD HAVE ON THIS DEVICE — this distributorship and their others.
 *
 * It used to be their OTHER distributorships only, and with six installs that was the whole of it:
 * signing out of the sales app could not reach a delivery store, because the delivery app was a
 * different install with its own storage. One app is one install (docs/31 §4, architect's
 * amendment): the owner who reps in the morning and drives in the afternoon has a `dos-sales` file
 * and a `dos-delivery` file under the same person and the same distributor, and a sign-out that
 * swept only the running engine's prefix would leave the other on a phone he hands over.
 *
 * So this distributorship is in the list too, and the sweep runs over all three field prefixes. The
 * rule underneath is untouched: a file with anything queued, sending or refused is KEPT and said,
 * never deleted to tidy a device.
 */
function deviceIdentities(session: Session): SyncIdentity[] {
  const here: SyncIdentity = {
    userId: session.user.id,
    tenantId: session.tenant.id,
    role: session.role,
  }
  return [
    here,
    ...session.memberships
      .filter((membership) => membership.tenantId !== session.tenant.id)
      .map((membership) => ({
        userId: session.user.id,
        tenantId: membership.tenantId,
        role: membership.role,
      })),
  ]
}

type ShellTenant = NonNullable<React.ComponentProps<typeof AppShell>['tenant']>
type ShellAccount = NonNullable<React.ComponentProps<typeof AppShell>['account']>

interface ChromeProps {
  can: (item: NavItem) => boolean
  pathname: string
  session: Session
  /** The switcher without its handler: a switch goes through the leave flow below. */
  tenant: Omit<ShellTenant, 'onSwitch'>
  /** The account menu without its sign-out: signing out goes through the leave flow below. */
  account: Omit<ShellAccount, 'onSignOut'>
  /** Sign out on this phone at once, run the leaving, then revoke on the server (DOS-167 addendum (y)). */
  signOutOnDevice: (leave: (stored: Promise<void>) => Promise<void>) => Promise<void>
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
 * 2026-09-13). With nothing queued and nothing refused, "Sign out" is one tap: the session is cleared
 * on this phone first (addendum (y)), then this driver's file is deleted, and their files at other
 * distributors are deleted where nothing waits in them. With anything waiting, the leave sheet names the count and the person: "Send
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
  signOutOnDevice,
  switchDistributor,
  children,
}: ChromeProps): React.JSX.Element {
  const router = useRouter()
  const status = useSyncStatus()
  const device = useLeaveSession()
  const [asking, setAsking] = useState<Leaving | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  /** The tray's own destination, based once: `SECTIONS` carries it the same way (docs/31 §1.1). */
  const attention = routeFor(GROUP, '/attention')

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === attention ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected, attention])

  /**
   * What the leave flow (`src/groups/delivery/lib/leave.ts`) needs of the device and the session. It
   * decides on `waiting()` — this driver's file, counted once the engine has opened it — and never on
   * the status snapshot, which reads 0 until then: a sign-out tapped on a cold start took the one-tap
   * path on that 0 and deleted what the driver had kept on this phone, with no sheet.
   */
  const steps = useMemo<LeaveSteps>(
    () => ({
      waiting: device.waiting,
      sendNow: device.sendNow,
      end: device.end,
      // DEVICE-WIDE (docs/31 §4): every field prefix, not only this group's engine.
      sweep: () =>
        SyncEngine.sweepDeviceStores(openStore, FIELD_STORE_PREFIXES, deviceIdentities(session)),
      signOutOnDevice,
      switchDistributor,
    }),
    [device.waiting, device.sendNow, device.end, session, signOutOnDevice, switchDistributor],
  )

  /** One leave step at a time: a second tap before `busy` has rendered is swallowed too. */
  const running = useRef(false)
  const run = useCallback((step: () => Promise<void>): void => {
    if (running.current) return
    running.current = true
    setBusy(true)
    void step().finally(() => {
      running.current = false
      setBusy(false)
    })
  }, [])

  const leave = useCallback(
    (to: Leaving): void => {
      if (asking !== null) return
      run(async () => {
        if ((await tapLeave(to, steps)) === 'ask') {
          setSent(false)
          setAsking(to)
        }
      })
    },
    [asking, run, steps],
  )

  const sendNow = useCallback((): void => {
    if (asking === null) return
    const to = asking
    run(async () => {
      let next: 'ask' | 'left' | null = null
      try {
        next = await sendNowThenLeave(to, steps)
      } finally {
        setSent(true)
        // Left, or a switch that failed (a failed send is 'ask'): the sheet closes.
        if (next !== 'ask') setAsking(null)
      }
    })
  }, [asking, run, steps])

  const keep = useCallback((): void => {
    if (asking === null) return
    const to = asking
    run(async () => {
      try {
        await leaveNow(to, true, steps)
      } finally {
        setAsking(null)
      }
    })
  }, [asking, run, steps])

  const cancel = useCallback((): void => {
    if (!running.current) setAsking(null)
  }, [])

  /*
   * EVERY "SIGN OUT" IN THE GROUP TAKES THIS FLOW (addendum (z1)). The Settings screen's button is handed `leave`
   * through `useLeave()`: calling `useSession().signOut()` there skipped the sheet, `end()` and the sweep.
   */
  return (
    <LeaveContext.Provider value={leave}>
      <AppShell
        sections={sections}
        can={can}
        activeHref={pathname}
        homeHref={routeFor(GROUP, '/')}
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
              router.push(attention)
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
        persistent={device.persistent}
        name={session.user.name}
        tenantName={session.tenant.displayName}
        busy={busy}
        note={sent && device.online ? status.lastError : null}
        onSendNow={sendNow}
        onLeave={keep}
        onCancel={cancel}
      />
    </LeaveContext.Provider>
  )
}
