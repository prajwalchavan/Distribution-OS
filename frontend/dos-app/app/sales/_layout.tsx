/**
 * The SALES group's layout — what stays with the group after the one-app merge (docs/31 §1.4).
 *
 * Everything an install does once now happens once, at `app/_layout.tsx`: `boot()`, the router
 * bridge, the single `<ApiProvider>`, the status bar, the session gate, the redirect ladder and the
 * landing. This file is what is left, and every line of it is the SALESPERSON's rather than the
 * app's:
 *
 * 1. the theme — the 69 dp field touch floor and the field density of `GROUPS.sales` (UX-00 §5.2),
 *    the distributor's own name and logo, and THIS GROUP's string record, swapped in whole (§3: 71
 *    keys carry a different value for a different audience, so records are never merged);
 * 2. the group base, through `<GroupProvider>`, so no screen under here writes `/sales` itself;
 * 3. the sync engine, with the prefix `GROUPS.sales.offline` — one device file per person per
 *    distributor per elected role (§4), mounted ABOVE the chrome and switched with `enabled`;
 * 4. the shell: this group's sections, the permission filter, the connection strip, the tenant
 *    switcher, the account menu and the leave flow that guards both.
 *
 * WHAT IS NOT HERE, and must not come back. There is no redirect effect (§6.1: the ladder lives in
 * one place now) and no wrong-role screen (§1.3, ruling B3: the person elects a role at sign-in, and
 * a refused election is answered at the chooser). When the elected role's group is not this one, this
 * layout paints NOTHING — not a shell, not a spinner, not one frame of another role's data (ruling
 * Q2) — and the root's ladder moves them.
 */
import { groupOf, sessionIdentity } from '@dos/api-client'
import { useApi, useSession } from '@dos/api-client/react'
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
  ThemeProvider,
  goTo,
  routeFor,
  useGo,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { Session } from '@dos/api-client'
import type { SyncIdentity } from '@dos/offline'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'

import { deviceId } from '../../src/api'
import { GROUPS, absoluteUrl } from '../../src/config'
import { forgetDraftsOf } from '../../src/groups/sales/lib/draft'
import {
  leaveNow,
  sendNowThenLeave,
  tapLeave,
  type Leaving,
  type LeaveSteps,
} from '../../src/groups/sales/lib/leave'
import { LeaveSheet } from '../../src/groups/sales/lib/leave-sheet'
import { SECTIONS } from '../../src/groups/sales/nav'
import { strings } from '../../src/groups/sales/strings'

/** This group's segment: the base under `app/`, and the key into `GROUPS` (docs/31 §6.4 (b)). */
const GROUP = 'sales'

/**
 * The device-store prefix, from the group rather than a constant in this file (docs/31 §4).
 *
 * `storeNameFor` adds the person and the distributor; the prefix is what keeps a phone that is a rep
 * in the morning and a driver in the afternoon on two clean files instead of one mixed one.
 */
const STORE_PREFIX = GROUPS.sales.offline

export default function SalesLayout(): React.JSX.Element {
  const { session, hydrating, signOutOnDevice, switchDistributor } = useSession()
  const pathname = usePathname()

  /** docs/23 §0 X2: a password somebody else chose. The root holds them on `/change-password`. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /** Ruling Q2: this group renders only for the role that elected it. */
  const mine = session !== null && groupOf(session.role) === GROUP

  const tenantBrand = useMemo(
    () =>
      session
        ? { name: session.tenant.displayName, logoUrl: absoluteUrl(GROUP, session.tenant.logoUrl) }
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

  /**
   * ONE `<OfflineProvider>`, ABOVE the chrome — not inside it.
   *
   * It used to sit in the signed-in branch only, and that cost a rep their queue: the branch above
   * returned a bare skeleton while the session settled, which UNMOUNTED the provider, stopped the
   * engine and threw away its store — and on the web fallback that store is in memory (docs/27 §2),
   * so five queued lines and a whole pull went with it. So it is mounted for the life of this group
   * and switched with `enabled`.
   *
   * AND NOT WHILE `hydrating` (DOS-089). `SessionStore` sets that flag in its constructor and nowhere
   * else: it is true for exactly one window, a cold start with a remembered session, where there is a
   * person and no access token yet. Starting the engine into it meant the first thing every launch did
   * was `GET /sync/manifest` with no Authorization header — a 401, a refresh, and the same call again.
   */
  const ready = mine && !hydrating && !mustChangePassword

  return (
    <ThemeProvider
      touch={GROUPS.sales.touch}
      density={GROUPS.sales.density}
      tenant={tenantBrand}
      strings={strings}
    >
      <GroupProvider group={GROUP}>
        <Offline identity={identity} enabled={ready}>
          {session !== null && mine && !hydrating && !mustChangePassword ? (
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
                items: [
                  {
                    id: 'profile',
                    label: strings['x4.title'],
                    onPress: () => {
                      goTo(GROUP, '/settings', false)
                    },
                  },
                  {
                    id: 'change-password',
                    label: strings['app.changePassword'],
                    onPress: () => {
                      // A root route of the whole install, not this group's: `routeFor` leaves it alone.
                      goTo(GROUP, '/change-password', false)
                    },
                  },
                ],
              }}
            >
              <Slot />
            </Chrome>
          ) : null}
        </Offline>
      </GroupProvider>
    </ThemeProvider>
  )
}

/**
 * The sync engine, started once per signed-in session.
 *
 * The device database is this person's own file inside this distributorship (DOS-167): a colleague
 * who signs in on this phone, or this rep at another distributor, opens a different file and starts
 * from nothing, because the shops, dues and sync position of one book are never another's to read.
 * The engine also checks the file's stamp against `identity` before it reads a single row, and a
 * switch simply stops the engine on one file and starts it on the other.
 *
 * `tables` is deliberately absent — the whole read set the manifest publishes for this role is what a
 * rep needs on the phone, and choosing a subset here would be this app quietly disagreeing with the
 * server about what a beat is.
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
      /* S-139 (ruling 3 (dd)): the `offline:` lines go where a support call and a QA gate can read them. */
      onLog={consoleSink}
    >
      {children}
    </OfflineProvider>
  )
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
 * The shell, plus the one piece of chrome this group cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the needs-attention tray, which is where a rejected write becomes a piece of work. There is
 * never a "Sync now" button (UX-00 §6.11).
 *
 * LEAVING IS DECIDED HERE, inside the provider, because it needs the device (DOS-167; founder,
 * 2026-09-13). With nothing queued and nothing refused, "Sign out" is one tap: the session is cleared
 * on this phone first (addendum (y)), then this rep's file is deleted, their files at other distributors
 * are deleted where nothing waits in them, and their order drafts are forgotten. With anything waiting, the leave sheet
 * names the count and the person: "Send now" while there is a signal, or sign out keeping them on this
 * phone for this rep only. A switch wipes nothing — the changes wait in this distributor's file — and
 * asks only when something is waiting.
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
  const go = useGo()
  const status = useSyncStatus()
  const device = useLeaveSession()
  const [asking, setAsking] = useState<Leaving | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    const orders = routeFor(GROUP, '/orders')
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === orders ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

  /**
   * What the leave flow (`src/groups/sales/lib/leave.ts`) needs of the device and the session. It
   * decides on `waiting()` — this rep's file, counted once the engine has opened it — and never on the
   * status snapshot, which reads 0 until then: a sign-out tapped on a cold start took the one-tap path
   * on that 0 and deleted an order the rep had kept on this phone, with no sheet.
   */
  const steps = useMemo<LeaveSteps>(
    () => ({
      waiting: device.waiting,
      sendNow: device.sendNow,
      end: device.end,
      // DEVICE-WIDE (docs/31 §4): every field prefix, not only this group's engine.
      sweep: () =>
        SyncEngine.sweepDeviceStores(openStore, FIELD_STORE_PREFIXES, deviceIdentities(session)),
      forgetDrafts: () => forgetDraftsOf(session.user.id),
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

  return (
    <>
      <AppShell
        sections={sections}
        can={can}
        activeHref={pathname}
        homeHref={routeFor(GROUP, '/')}
        onNavigate={(href) => {
          go.push(href)
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
              go.push('/orders/attention')
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
    </>
  )
}
