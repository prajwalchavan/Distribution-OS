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
import { sessionIdentity } from '@dos/api-client'
import { ApiProvider, useApi, useSession } from '@dos/api-client/react'
import { connectionStateFrom, openStore, SyncEngine } from '@dos/offline'
import { OfflineProvider, useLeaveSession, useSyncStatus } from '@dos/offline/react'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { boot, deviceId } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import {
  leaveNow,
  sendNowThenLeave,
  tapLeave,
  type Leaving,
  type LeaveSteps,
} from '../src/lib/leave'
import { LeaveSheet } from '../src/lib/leave-sheet'
import { SECTIONS } from '../src/nav'
import { strings } from '../src/strings'

/** This app's device-store prefix (DOS-167). `storeNameFor` adds the person and the distributor. */
const STORE_PREFIX = 'dos-warehouse'

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
  const { session, hydrating, signOut, signOutOnDevice, switchDistributor } = useSession()
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
        identity={identity}
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
  /** Sign out on this phone at once, handing back the server's revoke (DOS-167 addendum (y)). */
  signOutOnDevice: () => () => Promise<void>
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
        item.href === '/pick' ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

  /**
   * What the leave flow (`src/lib/leave.ts`) needs of the device and the session. It decides on
   * `waiting()` — this hand's file, counted once the engine has opened it — and never on the status
   * snapshot, which reads 0 until then: a sign-out tapped on a cold start took the one-tap path on that 0
   * and deleted what the hand had kept on this phone, with no sheet.
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
              router.push('/pick/attention')
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
