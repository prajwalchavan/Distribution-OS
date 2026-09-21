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

import { storage } from '../platform/storage.native.js'
import { appShortName } from '../strings.js'
import { useTheme } from '../theme.js'
import type { WelcomeProps } from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'
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
