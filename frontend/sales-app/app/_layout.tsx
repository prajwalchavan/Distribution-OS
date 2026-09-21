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
import { sessionIdentity } from '@dos/api-client'
import { ApiProvider, useApi, useSession } from '@dos/api-client/react'
import { openStore, SyncEngine } from '@dos/offline'
import { OfflineProvider, useLeaveSession, useSyncStatus } from '@dos/offline/react'
import { connectionStateFrom, consoleSink } from '@dos/offline'
import {
  AppShell,
  Button,
  ConnectionStrip,
  EmptyState,
  Landing,
  Screen,
  Skeleton,
  Stack,
  ThemeProvider,
  clearWelcomeSeen,
  setRouterNavigate,
  useLandingGate,
  useStrings,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { ApiClient, Session } from '@dos/api-client'
import type { SyncIdentity } from '@dos/offline'
import type { NavItem, TenantChoice } from '@dos/ui'
import type { PermissionRole } from '@dos/contracts'
import { Slot, useRootNavigationState, usePathname, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { boot, deviceId } from '../src/api'
import { APP, absoluteUrl } from '../src/config'
import { forgetDraftsOf } from '../src/lib/draft'
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
const STORE_PREFIX = 'dos-sales'

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
  const { session, hydrating, signOut, signOutOnDevice, switchDistributor } = useSession()
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

  /*
   * AND MOVE OUT OF THE COMMIT (DOS-055). `navigatorReady` says the navigator EXISTS; it does not say React has
   * finished committing the tree it belongs to, and on a phone `router.replace` inside that commit still answers
   * "Can't perform a React state update on a component that hasn't mounted yet", naming expo-router's own
   * `<ContextNavigator/>` — LogBox over the whole app on the first tap, measured on the Pixel 7 in the warehouse
   * gate. A zero timer is exactly what the message asks for: do the work after the mount. The route this app is
   * already on is not a move at all, and the timer is cancelled when the answer changes before it fires.
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
   * docs/29 §1 — the two seconds after a fresh sign-in, and the welcome the next person gets.
   *
   * `useLandingGate` answers one question: has a session just ARRIVED (a sign-in, or a switch to
   * another distributorship), as against "is there a session". A launch that restored one is never
   * held up: a driver at 6 am is taken to the trip, not told where he is. The panel COVERS the app
   * rather than replacing it, so the navigator underneath stays mounted and the redirect this
   * sign-in started is not stranded behind it.
   *
   * The welcome flag is cleared HERE rather than on each sign-out button, so every way out of this
   * app — the account menu, a settings screen, an expired session — gives the next person on this
   * device the welcome back.
   *
   * On the gate's `signedOut`, which is the RENDER A SESSION WENT AWAY ON, never on the condition
   * "there is no session". That condition is also true on a launch nobody has signed into, on a
   * sign-in somebody abandoned, and on every launch after the sign-out that already cleared the
   * flag — clear it there and the welcome returns on the next launch and on every launch after it,
   * which is the one thing docs/29 §1 rules out.
   */
  const landing = useLandingGate(
    hydrating,
    session === null ? null : `${session.tenant.id}:${session.user.id}`,
  )
  useEffect(() => {
    if (landing.signedOut) clearWelcomeSeen()
  }, [landing.signedOut])
  const landingPanel =
    landing.show && session !== null ? (
      <Landing
        tenantName={session.tenant.displayName}
        logoUrl={absoluteUrl(session.tenant.logoUrl)}
        personName={session.user.name}
        appTitle={APP.title}
        onDone={landing.done}
      />
    ) : null

  /**
   * ONE `<OfflineProvider>`, ABOVE the gate — not inside it.
   *
   * It used to sit in the signed-in branch only, and that cost a rep their queue: the branch above
   * returns a bare skeleton while the session settles, which UNMOUNTED the provider, stopped the engine
   * and threw away its store — and on the web fallback that store is in memory (docs/27 §2), so five
   * queued lines and a whole pull went with it. Measured: queue an order in a dead spot, reload, and the
   * needs-attention tray reads "0 waiting" over an order the rep was told was saved.
   *
   * So the provider is mounted for the life of the app and switched with `enabled`. A signed-out app
   * runs no engine; a signed-in one runs exactly one, whatever the gate is rendering underneath.
   *
   * AND NOT WHILE `hydrating` (DOS-089). `SessionStore` sets that flag in its constructor and nowhere else:
   * it is true for exactly one window, a cold start with a remembered session, where there is a person and
   * no access token yet. Starting the engine into it meant the first thing every launch did was
   * `GET /sync/manifest` with no Authorization header — a 401, a refresh, and the same call again. The
   * provider still stays mounted through it; only the engine waits, which is the whole of the fix.
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
        identity={identity}
        enabled={session !== null && !hydrating && !mustChangePassword && !wrongRole}
      >
        {content}
      </Offline>
      {landingPanel}
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
 * The shell, plus the one piece of chrome this app cannot do without: the connection strip.
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
        item.href === '/orders' ? { ...item, badge: status.rejected } : item,
      ),
    }))
  }, [status.rejected])

  /**
   * What the leave flow (`src/lib/leave.ts`) needs of the device and the session. It decides on
   * `waiting()` — this rep's file, counted once the engine has opened it — and never on the status
   * snapshot, which reads 0 until then: a sign-out tapped on a cold start took the one-tap path on that 0
   * and deleted an order the rep had kept on this phone, with no sheet.
   */
  const steps = useMemo<LeaveSteps>(
    () => ({
      waiting: device.waiting,
      sendNow: device.sendNow,
      end: device.end,
      sweep: () =>
        SyncEngine.sweepIdentityStores(openStore, STORE_PREFIX, otherIdentities(session)),
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
              router.push('/orders/attention')
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
