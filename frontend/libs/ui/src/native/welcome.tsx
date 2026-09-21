/**
 * docs/29 §1 Welcome — the first screen of every app, for React Native.
 *
 * Same four things as the web half, against the same contract in `src/types.ts`: the Distribution OS
 * wordmark, one line saying what the product is, this app's own name, and one button that opens
 * today's sign-in form unchanged. Read that file's header for why the screen exists at all.
 *
 * THE ONE DIFFERENCE, and it is the reason this component is a pair rather than one file: on a phone
 * the flag lives in SecureStore, whose read is asynchronous. `getItemSync` answers only out of the
 * write-through cache, which on a cold launch is empty — so seeding the state from it would show a
 * returning driver the introduction again for a frame. This half therefore renders NOTHING until the
 * one read comes back. That is a frame or two on the screen a person is about to type into anyway,
 * and it is the honest trade: never a flash of a screen this device has already been past.
 */
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import { storage } from '../platform/storage.native.js'
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

/**
 * Has this device already been past the welcome — as far as the cache knows.
 *
 * True is always true (nothing writes the key but `markWelcomeSeen`); false may simply mean the
 * cache has not been filled yet, which is why the component reads it asynchronously as well.
 */
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

export function Welcome({
  appTitle,
  role,
  children,
  testID,
}: WelcomeProps): React.JSX.Element | null {
  const theme = useTheme()
  // `null` is "the one read has not come back yet" — neither screen, rather than the wrong one.
  const [seen, setSeen] = useState<boolean | null>(() => (welcomeSeen() ? true : null))

  useEffect(() => {
    let live = true
    void storage.getItem(SEEN_KEY).then((value) => {
      if (live) setSeen(value !== null)
    })
    return () => {
      live = false
    }
  }, [])

  const enter = useCallback(() => {
    markWelcomeSeen()
    setSeen(true)
  }, [])

  if (seen === null) return null
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

/**
 * NO ANIMATION, and therefore nothing for `prefers-reduced-motion` to switch off. docs/29 asks for
 * "no animation, just a short hold" under that preference; the hold is the whole effect for
 * everybody, which is also what keeps this half and the web half saying the same thing. A van phone
 * spends no frames on a fade.
 */
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
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={{
        // OVER the app, not instead of it: the navigator underneath stays mounted, so the redirect
        // this sign-in started is not stranded behind two seconds of introduction.
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 60,
        elevation: 60,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[6],
        backgroundColor: theme.colors.bg.ground,
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
    </View>
  )
}
