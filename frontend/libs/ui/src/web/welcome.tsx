/**
 * docs/29 §1 Welcome — the first screen of every app, for React DOM.
 *
 * Four things and no fifth: the Distribution OS wordmark, one line saying what the product is, this
 * app's own name, and one button that opens today's sign-in form unchanged. This is one of exactly
 * two surfaces where the product's own mark appears at all (the other is the console's chrome): the
 * moment a session exists, the distributor's own name and logo take over (UX-00 §11).
 *
 * SHOWN ONCE PER DEVICE, not on every launch. A driver at 6 am opens straight into the trip. The
 * "once" is a flag in `platform.storage` set the moment **Sign in** is pressed — not when the
 * sign-in succeeds, because a wrong password is not a reason to read the introduction again — and
 * cleared by the root layout whenever the session goes away, whichever of an app's sign-out paths
 * got there.
 *
 * The flag is read SYNCHRONOUSLY here, which is a thing only the web half can do: `localStorage` is
 * synchronous, so a returning device renders the form on its first frame with no flash of a screen
 * it has already been past. The native half reads SecureStore, which is not, and says so in its own
 * file — the one real difference between the two implementations of this component.
 */
import { useCallback, useEffect, useState } from 'react'

import { storage } from '../platform/storage.web.js'
import { appShortName } from '../strings.js'
import { useTheme } from '../theme.js'
import { space } from '../tokens.js'
import type { LandingGate, LandingProps, WelcomeProps } from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'
import { TenantLogo } from './feedback.js'
import { Screen, Stack } from './layout.js'

/** One key, one device. Its presence is the whole state; the value is never read. */
const SEEN_KEY = 'dos.welcome.seen'

/** Has this device already been past the welcome? */
export function welcomeSeen(): boolean {
  return storage.getItemSync(SEEN_KEY) !== null
}

/** "Sign in" was pressed. The welcome has done its work until somebody signs out. */
export function markWelcomeSeen(): void {
  storage.setItemSync(SEEN_KEY, '1')
}

/** The session is gone: the next person on this device gets the welcome. */
export function clearWelcomeSeen(): void {
  storage.setItemSync(SEEN_KEY, null)
}

export function Welcome({ appTitle, role, children, testID }: WelcomeProps): React.JSX.Element {
  const theme = useTheme()
  const [seen, setSeen] = useState(welcomeSeen)
  const enter = useCallback(() => {
    markWelcomeSeen()
    setSeen(true)
  }, [])

  if (seen) return <>{children}</>

  return (
    <Screen testID={testID}>
      <Stack gap={6} maxWidth={420} center>
        <Stack gap={2}>
          {/* The wordmark is TYPESET, not an image: one product name, three targets, no asset. */}
          <Txt field="hero" desk="kpi" as="h1" testID="welcome-wordmark">
            {theme.t('welcome.product')}
          </Txt>
          <Txt field="body" desk="body" color={theme.colors.text.secondary}>
            {theme.t(role === 'platform_admin' ? 'welcome.console' : 'welcome.tagline')}
          </Txt>
        </Stack>
        <Txt field="title" desk="pageTitle" testID="welcome-app">
          {appShortName(appTitle)}
        </Txt>
        <Button
          label={theme.t('welcome.signIn')}
          onPress={enter}
          variant="primary"
          fullWidth
          testID="welcome-sign-in"
        />
      </Stack>
    </Screen>
  )
}

// ---------------------------------------------------------------------------
// docs/29 §1 Landing — two seconds of where you are
// ---------------------------------------------------------------------------

/** Two seconds: long enough to read three short lines, short enough that nobody waits. */
const LANDING_HOLD_MS = 2000
export { LANDING_HOLD_MS }

/**
 * Has a session just ARRIVED? — which is not the same question as "is there a session".
 *
 * `previous` is what the last SETTLED render saw: `undefined` before hydration has ever finished,
 * `null` for signed out, the session's key otherwise. So the landing starts on a fresh sign-in and
 * on a distributor switch, and never on the launch that restored a session — a driver who opens the
 * app at 6 am is not told where he is, he is taken there.
 */
export function landingStarts(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && next !== null && next !== previous
}

/**
 * Has a session just GONE? — the sibling rule, and the only moment the welcome may be re-armed.
 *
 * "There is no session" is NOT that moment. That is the state a device sits in for the whole of a
 * launch nobody has signed into, for a sign-in somebody opened and walked away from, and for every
 * launch after a sign-out. Clearing the flag whenever that state is seen deletes it on those
 * launches too, so the welcome comes back on the next launch, and on the one after — exactly what
 * docs/29 §1's "shown once per device, not on every launch" forbids. Only a `previous` holding a
 * real session with `next` holding none is somebody signing out.
 */
export function sessionEnded(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && previous !== null && next === null
}

/**
 * The gate every root layout asks. `sessionKey` identifies the open distributorship AND the person
 * (`${tenantId}:${userId}`), so a switch and a different sign-in both count as an arrival.
 *
 * The state is adjusted DURING the render that sees the change, not in an effect afterwards: React
 * re-renders before committing, so the home never paints for a frame behind the landing that was
 * about to cover it. `signedOut` rides that same state, so it is true on the one render that saw
 * the session go and false on every render after it — a transition, not a condition.
 */
export function useLandingGate(hydrating: boolean, sessionKey: string | null): LandingGate {
  const [state, setState] = useState<{
    key: string | null | undefined
    show: boolean
    signedOut: boolean
  }>({ key: undefined, show: false, signedOut: false })
  if (!hydrating && state.key !== sessionKey) {
    setState({
      key: sessionKey,
      show: landingStarts(state.key, sessionKey),
      signedOut: sessionEnded(state.key, sessionKey),
    })
  }
  const done = useCallback(() => {
    setState((previous) => ({ ...previous, show: false }))
  }, [])
  return { show: state.show, signedOut: state.signedOut, done }
}

export function Landing({
  tenantName,
  logoUrl,
  personName,
  appTitle,
  onDone,
  holdMs = LANDING_HOLD_MS,
  testID,
}: LandingProps): React.JSX.Element {
  const theme = useTheme()
  useEffect(() => {
    const timer = setTimeout(onDone, holdMs)
    return () => {
      clearTimeout(timer)
    }
  }, [onDone, holdMs])

  return (
    <div
      data-testid={testID}
      role="status"
      aria-live="polite"
      style={{
        // OVER the app, not instead of it: the navigator underneath stays mounted, so the redirect
        // this sign-in started is not stranded behind two seconds of introduction. 60 clears the
        // kit's own overlays (Dialog and Sheet sit at 50) and the shell's rail (30).
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[6],
        background: theme.colors.bg.ground,
      }}
    >
      <Stack gap={4} align="center" testID="landing-panel">
        <TenantLogo size="card" name={tenantName} logoUrl={logoUrl} />
        <Txt field="title" desk="pageTitle" as="h1" testID="landing-tenant">
          {tenantName}
        </Txt>
        <Txt field="body" desk="body" testID="landing-person">
          {personName}
        </Txt>
        <Txt field="label" desk="meta" color={theme.colors.text.secondary} testID="landing-app">
          {theme.t('landing.app', { name: appShortName(appTitle) })}
        </Txt>
      </Stack>
    </div>
  )
}
