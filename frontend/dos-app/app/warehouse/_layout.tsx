/**
 * The GODOWN group's layout — `app/warehouse/**`, everything at `/warehouse/…` (docs/31 §1.4).
 *
 * The six per-role apps are one app now, and the six root layouts are one root plus six of these.
 * What lifted to `app/_layout.tsx`, written once and NOT recreated here: `boot()`,
 * `setRouterNavigate`, `<ApiProvider>`, `<StatusBar style="dark" />`, the session gate and the
 * redirect ladder (§1.3 steps 7-8), the landing panel and the welcome re-arm (step 9). What stays,
 * because it is this group's and no other's:
 *
 * 1. The theme — the **76 dp floor** touch target UX-00 §5.2 fixes for a godown ("≥ 76 dp on every
 *    warehouse screen"), the field density, the distributor's own name and logo (UX-00 §11), and this
 *    group's string namespace, SWAPPED in rather than merged (§3: `word.pcs` is _pc_ at a desk and
 *    _pieces_ in a rep's sentence, and 71 keys carry a different value per audience).
 * 2. `<GroupProvider>`, so every screen below reaches `useGo()` and no screen writes `/warehouse`.
 * 3. The sync engine. A godown is a steel shed: the picking sheet reads the DEVICE and the picks
 *    queue in the outbox (`src/groups/warehouse/lib/local.ts`, `…/queue.ts`), which is the one flow
 *    docs/23 §4.4 names as needing to survive a dead spot. The store prefix is
 *    `GROUPS.warehouse.offline` (§4) — the elected GROUP's, not a file-local constant, so a phone
 *    that is a driver's in the morning and a godown hand's in the afternoon keeps two clean files.
 * 4. The shell: this group's `SECTIONS`, its badge, its connection strip and its leave flow.
 *
 * A session whose elected role belongs to another group paints NOTHING here, not for one frame
 * (architect's ruling Q2) — the root's ladder is already moving that person to their own group. The
 * old wrong-role screen is gone with it (§1.3): with a group per role there is no wrong app to be in,
 * and a refused election is said at the chooser (ruling B3).
 */
import { groupOf as groupForRole, sessionIdentity } from '@dos/api-client'
import { useApi, useSession } from '@dos/api-client/react'
import { connectionStateFrom, consoleSink, openStore, SyncEngine } from '@dos/offline'
import { OfflineProvider, useLeaveSession, useSyncStatus } from '@dos/offline/react'
import { AppShell, ConnectionStrip, GroupProvider, ThemeProvider, routeFor } from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { Session } from '@dos/api-client'
import type { SyncIdentity } from '@dos/offline'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, usePathname, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'

import { deviceId } from '../../src/api'
import { GROUPS, absoluteUrl } from '../../src/config'
import {
  leaveNow,
  sendNowThenLeave,
  tapLeave,
  type Leaving,
  type LeaveSteps,
} from '../../src/groups/warehouse/lib/leave'
import { LeaveContext } from '../../src/groups/warehouse/lib/leave-context'
import { LeaveSheet } from '../../src/groups/warehouse/lib/leave-sheet'
import { GROUP, SECTIONS } from '../../src/groups/warehouse/nav'
import { strings } from '../../src/groups/warehouse/strings'

/** This group's row of the one `GROUPS` table: the touch floor, the density and the store prefix. */
const GODOWN = GROUPS.warehouse

/** The device-store prefix (DOS-167). `storeNameFor` adds the person and the distributor. */
const STORE_PREFIX = GODOWN.offline

/** `/warehouse` — the home of this group, which lights only when the person is exactly on it. */
const HOME = routeFor(GROUP, '/')

export default function WarehouseLayout(): React.JSX.Element {
  const { session, hydrating, signOutOnDevice, switchDistributor } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  /**
   * Is the elected role in the token this group's? `GROUP_OF` is total over `MembershipRole`
   * (ruling Q2), so an unmapped role answers `null` here and paints nothing while the root signs
   * the person out — never another role's screens.
   */
  const mine = session !== null && groupForRole(session.role) === GROUP

  /** docs/23 §0 X2: a temporary password a manager read out loud is changed before anything else. */
  const mustChangePassword = session?.user.mustChangePassword === true

  /** Everything below is drawn only when this session belongs here and is allowed past the door. */
  const ready = mine && !mustChangePassword

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
   * ONE `<OfflineProvider>`, ABOVE the gate — not inside it. `hydrating` flips true whenever the
   * client refreshes the access token, and a provider inside the gate would be unmounted for that
   * frame, stopping the engine and throwing away its store (in memory on the web fallback, docs/27
   * §2) — with a picker's unsent lines in it. It is mounted for the life of the group and switched
   * with `enabled`.
   */
  const content =
    session !== null && ready ? (
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
              id: 'me',
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
    ) : null

  return (
    <GroupProvider group={GROUP}>
      <ThemeProvider
        touch={GODOWN.touch}
        density={GODOWN.density}
        tenant={tenantBrand}
        strings={strings}
      >
        {/*
         * `!hydrating` is part of the switch, not decoration. A restored session is real the instant
         * the snapshot is read, but the ACCESS token is never persisted (`src/api.ts`) — so starting
         * the engine before the refresh lands sent `GET /sync/manifest` with no bearer and took a
         * **401 on every single cold start**, one console error and one wasted round trip per launch,
         * measured on all twenty routes. The client's own transparent refresh then retried it and the
         * app worked, which is exactly why it went unnoticed. The provider stays MOUNTED through the
         * refresh (see above); only its first call now waits for a token.
         */}
        <Offline identity={identity} enabled={ready && !hydrating}>
          {content}
        </Offline>
      </ThemeProvider>
    </GroupProvider>
  )
}

/**
 * The sync engine, started once per signed-in session.
 *
 * The device database is this person's own file inside this distributorship (DOS-167): another hand
 * who signs in on the godown's shared phone, or this hand at another distributor, opens a different
 * file and starts from nothing, because one book's picking sheets and stock are never another's to
 * read. The engine also checks the file's stamp against `identity` before it reads a single row, and
 * a switch simply stops the engine on one file and starts it on the other.
 *
 * `tables` is deliberately absent — the manifest's own thirteen tables for this role are what a
 * godown phone needs, and choosing a subset here would be this app quietly disagreeing with the
 * server about what a picking sheet is.
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
 * The shell, plus the one piece of chrome a godown cannot do without: the connection strip.
 *
 * It reads the ENGINE's status, not a query's error — `online` here means "the radio is on and the
 * last call reached a service", and the pending and rejected counts are the outbox's own. Tapping it
 * opens the tray, which is where a rejected pick becomes a piece of work. There is never a "Sync now"
 * button (UX-00 §6.11).
 *
 * LEAVING IS DECIDED HERE, inside the provider, because it needs the device (DOS-167; founder,
 * 2026-09-13). With nothing queued and nothing refused, "Sign out" is one tap: the session is cleared
 * on this phone first (addendum (y)), then this hand's file is deleted, and their files at other
 * distributors are deleted where nothing waits in them. With anything waiting, the leave sheet names the count and the person: "Send
 * now" while there is a signal, or sign out keeping them on this phone for this hand only. A switch
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

  const sections = useMemo(() => {
    if (status.rejected === 0) return SECTIONS
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.href === routeFor(GROUP, '/pick') ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

  /**
   * What the leave flow (`src/groups/warehouse/lib/leave.ts`) needs of the device and the session. It
   * decides on `waiting()` — this hand's file, counted once the engine has opened it — and never on
   * the status snapshot, which reads 0 until then: a sign-out tapped on a cold start took the one-tap
   * path on that 0 and deleted what the hand had kept on this phone, with no sheet.
   */
  const steps = useMemo<LeaveSteps>(
    () => ({
      waiting: device.waiting,
      sendNow: device.sendNow,
      end: device.end,
      sweep: () =>
        SyncEngine.sweepIdentityStores(openStore, STORE_PREFIX, otherIdentities(session)),
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
   * EVERY "SIGN OUT" IN THE APP TAKES THIS FLOW (addendum (z1)). The Settings screen's button is handed `leave` through
   * `useLeave()`: calling `useSession().signOut()` there skipped the sheet, `end()` and the sweep.
   */
  return (
    <LeaveContext.Provider value={leave}>
      <AppShell
        sections={sections}
        can={can}
        activeHref={pathname}
        homeHref={HOME}
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
              router.push(routeFor(GROUP, '/pick/attention'))
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
